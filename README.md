# Simulador de Eletrificação de Frotas (ICE → EV)

Protótipo de workshop: ajuda donos de empresas em Portugal a ver quanto poupariam — em euros e em CO₂ — ao trocar veículos a combustão por elétricos.

**Demo:** https://joaopinto6.github.io/ICEtoEV-demo/

## Funcionalidades
- **3 modos:** Rápido, Detalhado (vários grupos de veículos) ou **Conversa com IA**
- Custo total a N anos, poupança anual, recuperação do investimento e CO₂ evitado (com equivalências)
- Regras fiscais portuguesas (Tributação Autónoma, IVA, IUC, incentivo Fundo Ambiental) como pressupostos editáveis
- Preços de combustível em tempo real via [API Aberta](https://api.apiaberta.pt) (com valores de reserva sem ligação)
- Gráfico de custo acumulado com ponto de equilíbrio
- Relatório final escrito por IA (Gemini)
- **Conversa por voz (local):** o assistente fala em português europeu (Piper, voz `pt_PT-tugão-medium`) e pode responder ao microfone (Whisper base). Os modelos (~140 MB) são descarregados na 1.ª utilização e correm no navegador — o áudio não sai do computador.

> ⚠ Valores fiscais **indicativos**. Confirme com o seu contabilista.

## Chave da IA
A chave **não está no repositório**. No site publicado, use o botão **🔑 Chave de IA** — a chave fica guardada apenas no seu navegador.
Para uso local, copie `config.example.js` para `config.js` e coloque a sua chave (o `config.js` está no `.gitignore`).

## Executar localmente
O microfone exige `http://localhost` ou `https`, por isso use o servidor incluído:
```bash
node serve.js
```
e abra http://localhost:5174

## Testes
```bash
node tests.js
```

## Ficheiros
- `index.html` — interface
- `calc.js` — motor de cálculo (sem HTML, testado)
- `voice.js` — voz local (TTS Piper + STT Whisper)
- `serve.js` — servidor local para testes
- `tests.js` — testes automáticos
