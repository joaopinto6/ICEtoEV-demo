// Voz local para a conversa com IA — tudo corre no navegador, sem servidores de voz.
//  • Fala (TTS): Piper, voz "pt_PT-tugão-medium" (português europeu). Reserva: voz pt-PT do sistema.
//  • Escuta (STT): Whisper "base" (multilingue, quantizado) via transformers.js.
// Os modelos só são descarregados na primeira utilização e ficam guardados no navegador.
const { speechText, splitSentences } = window.FleetCalc;   // funções puras, testadas em tests.js

const PIPER_URL = 'https://cdn.jsdelivr.net/npm/@mintplex-labs/piper-tts-web@1.0.5/+esm';
const TRANSFORMERS_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1';
const VOICE_ID = 'pt_PT-tugão-medium';
// O "+esm" do jsDelivr resolve a dependência onnxruntime-web para 1.27.0, mas o Piper aponta por defeito
// para os ficheiros WASM da 1.18.0 (nomes diferentes → "no available backend"). Apontamos para os da mesma versão.
const PIPER_WASM = {
  onnxWasm: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/',
  piperData: 'https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize.data',
  piperWasm: 'https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize.wasm',
};
const STT_MODEL = 'onnx-community/whisper-base'; // trocar por 'onnx-community/whisper-small' para melhor precisão (~250 MB)
const MAX_RECORD_MS = 60000;
const SILENCE_RMS = 0.006;                         // abaixo disto consideramos que não houve fala

// ---------------- Fala (TTS) ----------------
let piper = null, piperReady = null, session = null;
let ttsEngine = null;                              // 'piper' | 'system' | null
let speakToken = 0, current = null;

function loadTTS(onProgress) {
  if (!piperReady) {
    piperReady = (async () => {
      piper = await import(PIPER_URL);
      const stored = await piper.stored().catch(() => []);
      if (!stored.includes(VOICE_ID)) {
        await piper.download(VOICE_ID, (p) => { if (onProgress && p.total) onProgress(p.loaded / p.total); });
      }
      // TtsSession é um singleton: tem de ser criado ANTES de qualquer predict() para usar estes caminhos.
      session = await piper.TtsSession.create({ voiceId: VOICE_ID, wasmPaths: PIPER_WASM });
      ttsEngine = 'piper';
      return 'piper';
    })().catch((err) => {
      console.warn('Piper indisponível — a usar a voz do sistema:', err);
      piperReady = null;
      if (systemVoice()) { ttsEngine = 'system'; return 'system'; }
      throw new Error('Não foi possível carregar uma voz em português.');
    });
  }
  return piperReady;
}

function systemVoice() {
  const vs = (window.speechSynthesis && speechSynthesis.getVoices()) || [];
  const pt = vs.filter((v) => /^pt[-_]PT/i.test(v.lang));
  return pt.find((v) => v.localService) || pt[0] || null;
}

function playBlob(blob, token) {
  return new Promise((resolve) => {
    if (token !== speakToken) return resolve();
    const url = URL.createObjectURL(blob);
    const a = new Audio(url);
    current = a;
    const done = () => { URL.revokeObjectURL(url); if (current === a) current = null; resolve(); };
    a.onended = done; a.onerror = done;
    a.play().catch(done);
  });
}

function speakSystem(text, token) {
  return new Promise((resolve) => {
    const v = systemVoice();
    if (!v || token !== speakToken) return resolve();
    const u = new SpeechSynthesisUtterance(text);
    u.voice = v; u.lang = v.lang; u.rate = 1.02;
    u.onend = resolve; u.onerror = resolve;
    speechSynthesis.speak(u);
  });
}

// Lê uma mensagem (Markdown) em voz alta, frase a frase. Uma nova chamada interrompe a anterior.
async function speak(md) {
  stop();
  const token = speakToken;
  const parts = splitSentences(speechText(md));
  if (!parts.length) return;
  const engine = await loadTTS();
  if (token !== speakToken) return;
  if (engine === 'system') { for (const s of parts) { if (token !== speakToken) return; await speakSystem(s, token); } return; }
  emit('speaking', true);
  try {
    let next = session.predict(parts[0]);
    for (let i = 0; i < parts.length; i++) {
      const blob = await next;
      if (token !== speakToken) return;
      if (i + 1 < parts.length) next = session.predict(parts[i + 1]); // prepara a frase seguinte enquanto esta toca
      await playBlob(blob, token);
    }
  } catch (err) {
    console.warn('Erro na síntese de voz:', err);
  } finally { if (token === speakToken) emit('speaking', false); }
}

function stop() {
  speakToken++;
  if (current) { current.pause(); current = null; }
  if (window.speechSynthesis) speechSynthesis.cancel();
  emit('speaking', false);
}

// ---------------- Escuta (STT) ----------------
let asr = null, asrReady = null;
let rec = null, stream = null, chunks = [], autoStop = null;

function loadSTT(onProgress) {
  if (!asrReady) {
    asrReady = (async () => {
      const { pipeline } = await import(TRANSFORMERS_URL);
      const files = {};
      asr = await pipeline('automatic-speech-recognition', STT_MODEL, {
        dtype: 'q8', device: 'wasm',
        progress_callback: (p) => {
          if (p.status === 'progress' && p.file && p.total) {
            files[p.file] = { loaded: p.loaded, total: p.total };
            const t = Object.values(files).reduce((a, f) => ({ l: a.l + f.loaded, t: a.t + f.total }), { l: 0, t: 0 });
            if (onProgress) onProgress(t.l / t.t);
          }
        },
      });
      return asr;
    })().catch((err) => { asrReady = null; throw err; });
  }
  return asrReady;
}

async function startRecording() {
  if (rec) return;
  stop();                                            // não gravar a própria voz do assistente
  stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
  chunks = [];
  rec = new MediaRecorder(stream);
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  rec.start();
  autoStop = setTimeout(() => emit('autostop', true), MAX_RECORD_MS);
  emit('recording', true);
}

// Pára a gravação e devolve o texto transcrito ('' se não houve fala).
function stopRecording() {
  return new Promise((resolve, reject) => {
    if (!rec) return resolve('');
    clearTimeout(autoStop);
    const r = rec;
    r.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      rec = null; stream = null;
      emit('recording', false);
      try {
        const blob = new Blob(chunks, { type: r.mimeType || 'audio/webm' });
        const audio = await decodeTo16kMono(blob);
        if (audio.length < 16000 * 0.4 || rms(audio) < SILENCE_RMS) return resolve('');
        await loadSTT();
        const out = await asr(audio, { language: 'portuguese', task: 'transcribe', chunk_length_s: 30 });
        resolve(String((out && out.text) || '').trim());
      } catch (err) { reject(err); }
    };
    r.stop();
  });
}

async function decodeTo16kMono(blob) {
  const ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
  try {
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer()); // reamostra para 16 kHz
    if (buf.numberOfChannels === 1) return buf.getChannelData(0);
    const a = buf.getChannelData(0), b = buf.getChannelData(1), m = new Float32Array(a.length);
    for (let i = 0; i < a.length; i++) m[i] = (a[i] + b[i]) / 2;
    return m;
  } finally { ctx.close(); }
}
const rms = (x) => { let s = 0; for (let i = 0; i < x.length; i++) s += x[i] * x[i]; return Math.sqrt(s / x.length); };

// ---------------- Eventos para a página ----------------
const target = new EventTarget();
function emit(type, detail) { target.dispatchEvent(new CustomEvent(type, { detail })); }

window.Voice = {
  loadTTS, speak, stop, loadSTT, startRecording, stopRecording,
  get ttsEngine() { return ttsEngine; },
  get isRecording() { return !!rec; },
  on: (type, fn) => target.addEventListener(type, (e) => fn(e.detail)),
  supported: () => !!(navigator.mediaDevices && window.MediaRecorder && window.isSecureContext),
  // só para testes: transcreve um Float32Array a 16 kHz
  _transcribe: async (audio) => { await loadSTT(); return (await asr(audio, { language: 'portuguese', task: 'transcribe' })).text; },
  _decode: decodeTo16kMono,
};
window.dispatchEvent(new Event('voice:ready'));
