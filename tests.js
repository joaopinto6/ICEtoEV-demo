// Executar com:  node tests.js
const assert = require('node:assert/strict');
const C = require('./calc.js');
// Pressupostos fixos para os testes: os números calculados à mão não mudam quando os preços reais mudam.
const FIX = structuredClone(C.DEFAULTS);
FIX.prices = { diesel: 1.60, petrol: 1.75, electricity: 0.20 };

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  PASS ', name); }
  catch (e) { failed++; console.log('  FAIL ', name, '\n        ', e.message); }
}
const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.01, `${msg}: esperado ${b}, obtido ${a}`);
const norm = (s) => s.replace(/\s/g, ' '); // Intl usa espaços não separáveis

const quick = [{ type: 'car', fuel: 'diesel', count: 10, kmYear: 20000 }];

console.log('\nTeste 1 — Modo rápido dá os valores calculados à mão');
test('combustível 17 600 € vs eletricidade 6 400 €', () => {
  const r = C.simulate(quick, FIX, 'tailpipe');
  assert.ok(r.ok);
  close(r.iceEnergy, 17600, 'combustível');
  close(r.evEnergy, 6400, 'eletricidade');
});
test('formato português: "17 600,00 €"', () => {
  assert.equal(norm(C.formatEur(17600)), '17 600,00 €');
});

console.log('\nTeste 2 — Alternância de emissões');
test('escape: 29,15 t evitadas', () => {
  const r = C.simulate(quick, FIX, 'tailpipe');
  close(r.iceCo2, 29150, 'CO2 combustão'); close(r.evCo2, 0, 'CO2 elétrico'); close(r.co2AvoidedKg, 29150, 'evitado');
});
test('rede: 25,31 t evitadas (elétrico 3,84 t)', () => {
  const r = C.simulate(quick, FIX, 'grid');
  close(r.evCo2, 3840, 'CO2 elétrico'); close(r.co2AvoidedKg, 25310, 'evitado');
});
test('lado combustão igual nos dois modos', () => {
  const a = C.simulate(quick, FIX, 'tailpipe'), b = C.simulate(quick, FIX, 'grid');
  assert.equal(a.iceCo2, b.iceCo2);
  assert.equal(a.annualSavings, b.annualSavings); // € não depende do modo de CO2
});

console.log('\nTeste 3 — Modo detalhado soma corretamente e entradas inválidas são tratadas');
const cars = { type: 'car', fuel: 'diesel', count: 5, kmYear: 20000 };
const vans = { type: 'van', fuel: 'diesel', count: 3, kmYear: 30000 };
test('5 ligeiros + 3 comerciais = soma dos grupos simulados à parte', () => {
  const both = C.simulate([cars, vans], FIX, 'grid');
  const a = C.simulate([cars], FIX, 'grid'), b = C.simulate([vans], FIX, 'grid');
  for (const k of ['iceAnnual', 'evAnnual', 'icePurchase', 'evPurchase', 'iceCo2', 'evCo2', 'iceTco', 'evTco'])
    close(both[k], a[k] + b[k], k);
  assert.equal(both.vehicles, 8);
});
test('Tributação Autónoma só nos ligeiros', () => {
  assert.ok(C.simulate([cars], FIX, 'grid').iceTa > 0);
  assert.equal(C.simulate([vans], FIX, 'grid').iceTa, 0);
});
test('0 veículos / campos vazios → mensagem, sem NaN', () => {
  const r0 = C.simulate([{ type: 'car', fuel: 'diesel', count: 0, kmYear: 20000 }], FIX, 'grid');
  const rN = C.simulate([{ type: 'car', fuel: 'diesel', count: NaN, kmYear: NaN }], FIX, 'grid');
  const rE = C.simulate([], FIX, 'grid');
  for (const r of [r0, rN, rE]) { assert.equal(r.ok, false); assert.ok(r.errors.length > 0); }
  assert.equal(rN.errors.length, 2);
});

console.log('\nTeste 4 — Leitura da API de preços de combustível');
const sample = { data: [
  { fuel_slug: 'diesel_colored', avg_price_eur: 1.877 },
  { fuel_slug: 'diesel', avg_price_eur: 2.273, date: '2026-11-05', station_count: 2891 },
  { fuel_slug: 'gasoline_95', avg_price_eur: 2.052 },
] };
test('extrai gasóleo simples e gasolina 95 (ignora gasóleo colorido)', () => {
  const p = C.parseFuelPrices(sample);
  assert.deepEqual(p, { diesel: 2.273, petrol: 2.052, date: '2026-11-05', stations: 2891 });
});
test('resposta inválida → null (a página usa os valores por defeito)', () => {
  assert.equal(C.parseFuelPrices(null), null);
  assert.equal(C.parseFuelPrices({ error: 'rate limit' }), null);
  assert.equal(C.parseFuelPrices({ data: [{ fuel_slug: 'diesel', avg_price_eur: 2.27 }] }), null); // falta gasolina
  assert.equal(C.parseFuelPrices({ data: [{ fuel_slug: 'diesel', avg_price_eur: 'x' }, { fuel_slug: 'gasoline_95', avg_price_eur: 2 }] }), null);
});

console.log('\nTeste 5 — Relatório por IA (sem chamar a API)');
test('o prompt contém os números da simulação, formatados em pt-PT', () => {
  const r = C.simulate(quick, FIX, 'grid');
  const p = C.buildReportPrompt(r, quick, FIX, 'grid', 'teste');
  for (const s of [C.formatEur(r.annualSavings), C.formatEur(r.tcoSavings), '25,31 t', '10 ligeiros de passageiros a gasóleo', 'rede nacional'])
    assert.ok(p.includes(s), `falta "${s}" no prompt`);
  assert.ok(!/NaN|undefined/.test(p), 'prompt com NaN/undefined');
});
test('lê o texto da resposta e ignora partes de "pensamento"', () => {
  const json = { candidates: [{ content: { parts: [{ text: 'a pensar…', thought: true }, { text: '## Resumo\n' }, { text: 'Poupa.' }] } }] };
  assert.equal(C.parseGeminiText(json), '## Resumo\nPoupa.');
  assert.equal(C.parseGeminiText({ error: { message: 'x' } }), null);
  assert.equal(C.parseGeminiText({ candidates: [{ finishReason: 'SAFETY' }] }), null);
});
test('Markdown → HTML seguro (HTML do modelo é escapado)', () => {
  const html = C.mdToHtml('## Resumo\nPoupa **muito**.\n- um\n- dois\n<script>alert(1)</script>');
  assert.ok(html.includes('<h4>Resumo</h4>'));
  assert.ok(html.includes('<strong>muito</strong>'));
  assert.equal(C.mdToHtml('*Nota: zero.*'), '<p><em>Nota: zero.</em></p>');
  assert.ok(html.includes('<ul>\n<li>um</li>\n<li>dois</li>\n</ul>'));
  assert.ok(!html.includes('<script>') && html.includes('&lt;script&gt;'));
});

test('modelo alternativo: ordem certa, sem repetidos, só em erros do servidor', () => {
  assert.deepEqual(C.modelsToTry({ geminiModel: 'a', geminiFallbackModel: 'b' }), ['a', 'b']);
  assert.deepEqual(C.modelsToTry({ geminiModel: 'a', geminiFallbackModel: 'a' }), ['a']);
  assert.deepEqual(C.modelsToTry({ geminiModel: 'a' }), ['a']);
  for (const s of [500, 503, 504]) assert.equal(C.isRetryableStatus(s), true, `HTTP ${s}`);
  for (const s of [200, 400, 403, 429]) assert.equal(C.isRetryableStatus(s), false, `HTTP ${s}`);
});

console.log('\nTeste 7 — Conversa com IA (sem chamar a API)');
const turnJson = (o) => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(o) }] } }] });
test('lê a resposta estruturada e limpa dados inválidos do modelo', () => {
  const t = C.parseChatTurn(turnJson({ reply: 'Ok!', done: false, co2Mode: 'grid', electricityPrice: 0.15, years: 99,
    fleet: [{ type: 'van', fuel: 'diesel', count: 4.4, kmYear: 30000 },
            { type: 'truck', fuel: 'diesel', count: 2, kmYear: 1000 },     // tipo desconhecido → removido
            { type: 'car', fuel: 'petrol', count: 0, kmYear: 20000 }] })); // 0 veículos → removido
  assert.equal(t.reply, 'Ok!');
  assert.deepEqual(t.fleet, [{ type: 'van', fuel: 'diesel', count: 4, kmYear: 30000 }]);
  assert.equal(t.co2Mode, 'grid');
  assert.equal(t.overrides.electricityPrice, 0.15);
  assert.equal(t.overrides.years, null);                              // 99 anos → ignorado
});
test('"pronto" só com done=true E frota válida', () => {
  const fleet = [{ type: 'car', fuel: 'diesel', count: 3, kmYear: 15000 }];
  assert.equal(C.parseChatTurn(turnJson({ reply: 'x', done: true, fleet })).ready, true);
  assert.equal(C.parseChatTurn(turnJson({ reply: 'x', done: false, fleet })).ready, false);
  assert.equal(C.parseChatTurn(turnJson({ reply: 'x', done: true, fleet: [] })).ready, false); // IA diz "pronto" sem dados
});
test('resposta não-JSON ou sem mensagem → null', () => {
  assert.equal(C.parseChatTurn({ candidates: [{ content: { parts: [{ text: 'olá, não sou JSON' }] } }] }), null);
  assert.equal(C.parseChatTurn(turnJson({ done: true, fleet: [] })), null);
  assert.ok(C.parseChatTurn({ candidates: [{ content: { parts: [{ text: '```json\n{"reply":"a","done":false,"fleet":[]}\n```' }] } }] }));
});
test('pedido: instrução de sistema + histórico + esquema JSON; ajustes aplicados sem alterar os originais', () => {
  const body = C.chatRequestBody([{ role: 'user', text: 'oi' }, { role: 'model', text: '{}' }], FIX);
  assert.equal(body.contents.length, 2); assert.equal(body.contents[1].role, 'model');
  assert.equal(body.generationConfig.responseMimeType, 'application/json');
  assert.ok(body.systemInstruction.parts[0].text.includes('done = true'));
  assert.ok(body.systemInstruction.parts[0].text.includes('NUNCA os escrevas'));
  const B = C.applyChatOverrides(FIX, { years: 8, incentive: 3000, electricityPrice: null });
  assert.equal(B.years, 8); assert.equal(B.tax.incentive, 3000); assert.equal(B.prices.electricity, FIX.prices.electricity);
  assert.equal(FIX.years, 5); assert.equal(B.tax.taBrackets[2].upTo, Infinity);
});

console.log('\nTeste 6 — Gráfico custo vs. tempo');
test('ano 0 = compra, último ano = custo total, uma linha por ano', () => {
  const r = C.simulate([cars, vans], FIX, 'grid');
  const s = C.costSeries(r);
  assert.equal(s.length, FIX.years + 1);
  close(s[0].ice, r.icePurchase, 'ano 0 combustão'); close(s[0].ev, r.evPurchase, 'ano 0 elétrico');
  close(s[s.length - 1].ice, r.iceTco, 'fim combustão'); close(s[s.length - 1].ev, r.evTco, 'fim elétrico');
});
test('as linhas cruzam-se no ponto de recuperação do investimento', () => {
  const A = structuredClone(FIX); A.vehicles.van.evPrice = 50000; // força investimento extra > 0
  const r = C.simulate([vans], A, 'grid');
  assert.ok(r.paybackYears > 0 && r.paybackYears < A.years, `payback ${r.paybackYears}`);
  close(r.icePurchase + r.iceAnnual * r.paybackYears, r.evPurchase + r.evAnnual * r.paybackYears, 'cruzamento');
});

console.log(`\n${passed} passaram, ${failed} falharam\n`);
process.exit(failed ? 1 : 0);
