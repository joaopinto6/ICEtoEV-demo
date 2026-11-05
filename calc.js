// Motor de cálculo — sem HTML, usado pela página (index.html) e pelos testes (tests.js).
// Todos os valores por defeito são INDICATIVOS e devem ser verificados.
(function (root) {
  const DEFAULTS = {
    years: 5,                       // horizonte da análise (anos)
    // €/L, €/L, €/kWh. Combustíveis: último valor da API Aberta (05/11/2026), usado se não houver ligação.
    prices: { diesel: 2.27, petrol: 2.05, electricity: 0.20 },
    vehicles: {
      car: { label: 'Ligeiro de passageiros', icePrice: 32000, evPrice: 38000,
             iceCons: 5.5, evCons: 16, iceMaint: 0.05, evMaint: 0.03 },
      van: { label: 'Comercial (carrinha)',  icePrice: 35000, evPrice: 45000,
             iceCons: 8,   evCons: 22, iceMaint: 0.06, evMaint: 0.035 },
    },
    tax: {
      vatRate: 0.23,                // IVA
      evVatCap: 62500,              // limite (sem IVA) para dedução do IVA em ligeiros elétricos
      taBrackets: [                 // Tributação Autónoma — ligeiros de passageiros a combustão
        { upTo: 27500, rate: 0.08 },
        { upTo: 35000, rate: 0.25 },
        { upTo: Infinity, rate: 0.32 },
      ],
      iucIce: 150,                  // €/ano por veículo a combustão; elétricos isentos
      incentive: 0,                 // Fundo Ambiental, € por veículo elétrico
    },
    co2: { diesel: 2.65, petrol: 2.31, grid: 0.12, tree: 20, flight: 50 }, // kg/L, kg/L, kg/kWh, kg/ano, kg/voo
  };

  function taRate(priceWithVat, tax) {
    const b = tax.taBrackets.find((x) => priceWithVat < x.upTo);
    return b ? b.rate : 0;
  }

  // Devolve lista de erros em português (vazia = válido).
  function validateFleet(groups) {
    const errors = [];
    if (!Array.isArray(groups) || groups.length === 0) {
      errors.push('Adicione pelo menos um grupo de veículos.');
      return errors;
    }
    groups.forEach((g, i) => {
      const n = groups.length > 1 ? ` (linha ${i + 1})` : '';
      if (!Number.isInteger(g.count) || g.count < 1) errors.push(`Indique um número de veículos válido (≥ 1)${n}.`);
      if (!Number.isFinite(g.kmYear) || g.kmYear <= 0) errors.push(`Indique os km por ano (> 0)${n}.`);
      if (!['car', 'van'].includes(g.type)) errors.push(`Tipo de veículo inválido${n}.`);
      if (!['diesel', 'petrol'].includes(g.fuel)) errors.push(`Combustível inválido${n}.`);
    });
    return errors;
  }

  // Calcula um grupo: { type, fuel, count, kmYear }
  function simulateGroup(g, A, co2Mode) {
    const v = A.vehicles[g.type];
    const km = g.count * g.kmYear;
    const isCar = g.type === 'car';
    const vatOf = (p) => p - p / (1 + A.tax.vatRate);

    // Energia e manutenção (anual)
    const litres = km * v.iceCons / 100;
    const kwh = km * v.evCons / 100;
    const iceEnergy = litres * A.prices[g.fuel];
    const evEnergy = kwh * A.prices.electricity;
    const iceMaint = km * v.iceMaint;
    const evMaint = km * v.evMaint;
    const iceIuc = g.count * A.tax.iucIce;
    // Tributação Autónoma (simplificada): só ligeiros de passageiros a combustão, sobre custos de utilização.
    const iceTa = isCar ? (iceEnergy + iceMaint) * taRate(v.icePrice, A.tax) : 0;

    // Compra (líquida de IVA recuperável e incentivos)
    // Comerciais: IVA dedutível em ambos. Ligeiros: só o elétrico, até ao limite.
    const iceVatBack = isCar ? 0 : vatOf(v.icePrice);
    const evVatBack = !isCar || v.evPrice / (1 + A.tax.vatRate) <= A.tax.evVatCap ? vatOf(v.evPrice) : 0;
    const icePurchase = g.count * (v.icePrice - iceVatBack);
    const evPurchase = g.count * (v.evPrice - evVatBack - A.tax.incentive);

    const iceAnnual = iceEnergy + iceMaint + iceIuc + iceTa;
    const evAnnual = evEnergy + evMaint;

    const iceCo2 = litres * A.co2[g.fuel];
    const evCo2 = co2Mode === 'grid' ? kwh * A.co2.grid : 0;

    return { iceEnergy, evEnergy, iceMaint, evMaint, iceIuc, iceTa, icePurchase, evPurchase,
             iceAnnual, evAnnual, iceCo2, evCo2 };
  }

  // Simula a frota inteira. co2Mode: 'tailpipe' (escape = 0) ou 'grid' (rede nacional).
  function simulate(groups, assumptions, co2Mode) {
    const A = assumptions || DEFAULTS;
    const errors = validateFleet(groups);
    if (errors.length) return { ok: false, errors };

    const t = {};
    groups.map((g) => simulateGroup(g, A, co2Mode)).forEach((r) => {
      for (const k in r) t[k] = (t[k] || 0) + r[k];
    });

    t.annualSavings = t.iceAnnual - t.evAnnual;
    t.extraInvestment = t.evPurchase - t.icePurchase;
    t.iceTco = t.icePurchase + t.iceAnnual * A.years;
    t.evTco = t.evPurchase + t.evAnnual * A.years;
    t.tcoSavings = t.iceTco - t.evTco;
    // Payback: 0 = imediato; null = não recupera
    t.paybackYears = t.extraInvestment <= 0 ? 0 : t.annualSavings > 0 ? t.extraInvestment / t.annualSavings : null;
    t.co2AvoidedKg = t.iceCo2 - t.evCo2;
    t.trees = t.co2AvoidedKg / A.co2.tree;
    t.flights = t.co2AvoidedKg / A.co2.flight;
    t.vehicles = groups.reduce((s, g) => s + g.count, 0);
    t.years = A.years;
    return { ok: true, ...t };
  }

  // Preços de combustível em tempo real (média nacional). Ver parseFuelPrices.
  const FUEL_API_URL = 'https://api.apiaberta.pt/v1/fuel/prices';

  // Extrai gasóleo e gasolina 95 da resposta da API. Devolve null se o formato não for o esperado.
  function parseFuelPrices(json) {
    const rows = json && Array.isArray(json.data) ? json.data : null;
    if (!rows) return null;
    const pick = (slug) => rows.find((r) => r && r.fuel_slug === slug);
    const d = pick('diesel'), p = pick('gasoline_95');
    const ok = (r) => r && typeof r.avg_price_eur === 'number' && r.avg_price_eur > 0 && r.avg_price_eur < 10;
    if (!ok(d) || !ok(p)) return null;
    return { diesel: d.avg_price_eur, petrol: p.avg_price_eur, date: d.date || null,
             stations: d.station_count || null };
  }

  // Custo acumulado ano a ano (ano 0 = compra). Usado pelo gráfico.
  function costSeries(r) {
    const pts = [];
    for (let y = 0; y <= r.years; y++)
      pts.push({ year: y, ice: r.icePurchase + r.iceAnnual * y, ev: r.evPurchase + r.evAnnual * y });
    return pts;
  }

  // ---------- Relatório por IA (Gemini) ----------
  // A IA só redige: todos os números vêm de simulate(), nunca são calculados pelo modelo.
  function buildReportPrompt(r, fleet, A, co2Mode, priceNote) {
    const E = (x) => formatEur(x), N = formatNum;
    const fuelName = { diesel: 'gasóleo', petrol: 'gasolina' };
    const typeName = { car: 'ligeiros de passageiros', van: 'comerciais' };
    const groups = fleet.map((g) => `- ${g.count} ${typeName[g.type]} a ${fuelName[g.fuel]}, ${N(g.kmYear)} km/ano cada`).join('\n');
    const payback = r.paybackYears === 0 ? 'imediato (o elétrico já é mais barato na compra, após IVA e incentivos)'
                  : r.paybackYears === null ? 'não recupera nas condições indicadas' : `${N(r.paybackYears, 1)} anos`;
    return `És um consultor de frotas empresariais em Portugal. Escreve um relatório curto, em português de Portugal,
para o dono de uma empresa que está a ponderar substituir veículos a combustão por elétricos.

REGRAS:
- Usa APENAS os números abaixo. Não inventes valores, taxas nem incentivos.
- Tom claro e profissional, sem jargão técnico. Máximo ~350 palavras.
- Formato Markdown simples: títulos "## ", listas "- ", negrito "**". Sem tabelas, sem HTML.
- Secções: ## Resumo, ## Benefícios financeiros, ## Benefícios ambientais, ## Riscos e pontos a confirmar, ## Próximos passos.
- Em "Riscos e pontos a confirmar" lembra que os valores fiscais são indicativos e devem ser confirmados com o contabilista,
  e que a análise não inclui valor residual, carregadores nem financiamento.

FROTA (${N(r.vehicles)} veículos):
${groups}

RESULTADOS (horizonte de ${r.years} anos):
- Poupança anual em custos de utilização: ${E(r.annualSavings)}
- Poupança total em ${r.years} anos: ${E(r.tcoSavings)}
- Custo total combustão: ${E(r.iceTco)} | elétrico: ${E(r.evTco)}
- Compra líquida (após IVA recuperável e incentivos) combustão: ${E(r.icePurchase)} | elétrico: ${E(r.evPurchase)}
- Recuperação do investimento extra: ${payback}
- Energia por ano: combustão ${E(r.iceEnergy)} | elétrico ${E(r.evEnergy)}
- Manutenção por ano: combustão ${E(r.iceMaint)} | elétrico ${E(r.evMaint)}
- Impostos por ano na combustão (IUC + Tributação Autónoma): ${E(r.iceIuc + r.iceTa)} | elétrico: ${E(0)}
- CO₂ por ano: combustão ${N(r.iceCo2 / 1000, 2)} t | elétrico ${N(r.evCo2 / 1000, 2)} t | evitado ${N(r.co2AvoidedKg / 1000, 2)} t
- Equivalências: ${N(r.trees)} árvores durante um ano, ou ${N(r.flights)} voos Lisboa–Porto
- Emissões dos elétricos contadas: ${co2Mode === 'grid' ? 'incluindo a produção de eletricidade na rede nacional' : 'só no escape (zero)'}

PRESSUPOSTOS: gasóleo ${A.prices.diesel} €/L, gasolina ${A.prices.petrol} €/L (${priceNote || 'valores por defeito'}),
eletricidade ${A.prices.electricity} €/kWh, incentivo Fundo Ambiental ${E(A.tax.incentive)} por elétrico.`;
  }

  // ---------- Conversa com IA (recolha de dados) ----------
  const CHAT_GREETING = 'Olá! Sou o assistente do simulador. Vou fazer-lhe algumas perguntas rápidas sobre a sua frota '
    + 'para calcular quanto pouparia ao passar para veículos elétricos.\n\n**Para começar: quantos veículos tem a sua empresa, e são ligeiros de passageiros, comerciais (carrinhas) ou ambos?**';

  const CHAT_SCHEMA = {
    type: 'OBJECT',
    properties: {
      reply: { type: 'STRING', description: 'Mensagem para o utilizador, em português de Portugal.' },
      done: { type: 'BOOLEAN', description: 'true só depois de o utilizador confirmar o resumo final.' },
      fleet: { type: 'ARRAY', description: 'Todos os grupos de veículos recolhidos até agora.', items: {
        type: 'OBJECT',
        properties: {
          type: { type: 'STRING', enum: ['car', 'van'] },
          fuel: { type: 'STRING', enum: ['diesel', 'petrol'] },
          count: { type: 'INTEGER' },
          kmYear: { type: 'INTEGER' },
        },
        required: ['type', 'fuel', 'count', 'kmYear'] } },
      co2Mode: { type: 'STRING', enum: ['tailpipe', 'grid'], nullable: true },
      years: { type: 'INTEGER', nullable: true },
      incentive: { type: 'NUMBER', nullable: true },
      electricityPrice: { type: 'NUMBER', nullable: true },
    },
    required: ['reply', 'done', 'fleet'],
  };

  function chatSystemPrompt(A) {
    return `És o assistente de um simulador que compara uma frota empresarial a combustão com uma frota elétrica, em Portugal.
Conversa de forma natural e simpática, em português de Portugal, com o dono de uma empresa (não é técnico).

OBJETIVO: recolher, uma ou duas perguntas de cada vez, estes dados:
1. Grupos de veículos: para cada grupo, tipo (ligeiro de passageiros = "car"; comercial/carrinha = "van"),
   combustível atual (gasóleo = "diesel"; gasolina = "petrol"), número de veículos e km por veículo por ano.
   Se o utilizador não souber os km, sugere valores típicos (ligeiro ~20 000 km/ano, comercial ~30 000 km/ano) e pede confirmação.
2. Como contar as emissões dos elétricos: só no escape ("tailpipe") ou incluindo a rede elétrica nacional ("grid"). Explica em 1 frase.
3. (Opcional, pergunta numa só mensagem) se sabe o preço que paga pela eletricidade (por defeito ${A.prices.electricity} €/kWh),
   se tem direito a algum incentivo do Fundo Ambiental por veículo (por defeito ${A.tax.incentive} €), e o horizonte da análise
   (por defeito ${A.years} anos). Se não souber, usa os valores por defeito (deixa esses campos a null).

REGRAS:
- Em "fleet" devolve SEMPRE a lista completa e atualizada de grupos recolhidos até agora (não só o último).
- Não calcules poupanças nem dês números de resultados — o simulador faz isso.
- Quando tiveres tudo, mostra um resumo curto em lista e pergunta "Confirma?". Só depois de o utilizador confirmar, põe done = true
  e responde com uma frase curta a dizer que vais mostrar os resultados.
- Se o utilizador quiser corrigir algo, atualiza os dados e volta a pedir confirmação.
- Respostas curtas (máximo ~80 palavras). Podes usar **negrito** e listas "- ".
- Os códigos "car", "van", "diesel", "petrol", "tailpipe" e "grid" são só para os campos JSON: NUNCA os escrevas em "reply".
  Na conversa usa sempre: ligeiro de passageiros, comercial/carrinha, gasóleo, gasolina, "só no escape", "incluindo a rede nacional".
- No resumo final, usa uma lista com um item por linha.
- Se perguntarem algo fora do tema, responde numa frase e volta à recolha de dados.`;
  }

  function chatRequestBody(history, A) {
    return {
      systemInstruction: { parts: [{ text: chatSystemPrompt(A) }] },
      contents: history.map((m) => ({ role: m.role, parts: [{ text: m.text }] })),
      generationConfig: { temperature: 0.3, maxOutputTokens: 800, responseMimeType: 'application/json', responseSchema: CHAT_SCHEMA },
    };
  }

  // Lê e limpa uma resposta da conversa. Nunca confia cegamente no modelo.
  function parseChatTurn(json) {
    const raw = parseGeminiText(json);
    if (!raw) return null;
    let o;
    try { o = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch { return null; }
    if (!o || typeof o.reply !== 'string' || !o.reply.trim()) return null;
    const fleet = (Array.isArray(o.fleet) ? o.fleet : [])
      .map((g) => ({ type: g && g.type, fuel: g && g.fuel, count: Math.round(Number(g && g.count)), kmYear: Math.round(Number(g && g.kmYear)) }))
      .filter((g) => ['car', 'van'].includes(g.type) && ['diesel', 'petrol'].includes(g.fuel)
        && g.count >= 1 && g.count <= 100000 && g.kmYear > 0 && g.kmYear <= 500000);
    const co2Mode = ['tailpipe', 'grid'].includes(o.co2Mode) ? o.co2Mode : null;
    const num = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null);
    const overrides = { years: num(o.years, 1, 15), incentive: num(o.incentive, 0, 20000), electricityPrice: num(o.electricityPrice, 0.03, 1) };
    // "Pronto" só se o modelo disser que sim E os dados passarem a mesma validação do formulário.
    const ready = o.done === true && validateFleet(fleet).length === 0;
    return { reply: o.reply.trim(), ready, fleet, co2Mode, overrides };
  }

  function applyChatOverrides(A, o) {
    const B = structuredClone(A); // mantém Infinity nos escalões da Tributação Autónoma
    if (o && o.years != null) B.years = Math.round(o.years);
    if (o && o.incentive != null) B.tax.incentive = o.incentive;
    if (o && o.electricityPrice != null) B.prices.electricity = o.electricityPrice;
    return B;
  }

  // Modelos a tentar, por ordem (principal, depois alternativo), sem repetidos nem vazios.
  function modelsToTry(cfg) {
    return [cfg && cfg.geminiModel, cfg && cfg.geminiFallbackModel].filter((m, i, a) => m && a.indexOf(m) === i);
  }
  // Só erros do lado do servidor (sobrecarga) justificam tentar outro modelo.
  // 429 = limite do utilizador; 400/403 = pedido/chave inválidos → não mudar de modelo.
  const isRetryableStatus = (s) => s === 500 || s === 503 || s === 504;

  function geminiRequestBody(prompt) {
    return { contents: [{ role: 'user', parts: [{ text: prompt }] }],
             generationConfig: { temperature: 0.4, maxOutputTokens: 1500 } };
  }

  // Junta o texto da resposta (ignora partes de "pensamento"). null se não houver texto.
  function parseGeminiText(json) {
    const parts = json && json.candidates && json.candidates[0] && json.candidates[0].content
      ? json.candidates[0].content.parts || [] : [];
    const text = parts.filter((p) => p && typeof p.text === 'string' && !p.thought).map((p) => p.text).join('').trim();
    return text || null;
  }

  // Markdown mínimo → HTML seguro: escapa TUDO primeiro, depois converte só ##, **, - .
  function mdToHtml(md) {
    const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(\S(?:.*?\S)?)\*/g, '<em>$1</em>');
    const out = []; let list = false;
    for (const raw of String(md).split(/\r?\n/)) {
      const line = raw.trim();
      const isItem = /^[-*] /.test(line);
      if (list && !isItem) { out.push('</ul>'); list = false; }
      if (!line) continue;
      if (/^#{1,3} /.test(line)) out.push(`<h4>${inline(line.replace(/^#{1,3} /, ''))}</h4>`);
      else if (isItem) { if (!list) { out.push('<ul>'); list = true; } out.push(`<li>${inline(line.slice(2))}</li>`); }
      else out.push(`<p>${inline(line)}</p>`);
    }
    if (list) out.push('</ul>');
    return out.join('\n');
  }

  const eur = new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' });
  const num = (d) => new Intl.NumberFormat('pt-PT', { maximumFractionDigits: d, minimumFractionDigits: d });
  const formatEur = (x) => eur.format(x);
  const formatNum = (x, d = 0) => num(d).format(x);

  const api = { DEFAULTS, FUEL_API_URL, costSeries, parseFuelPrices, buildReportPrompt, geminiRequestBody, CHAT_GREETING, chatSystemPrompt, chatRequestBody, parseChatTurn, applyChatOverrides, modelsToTry, isRetryableStatus, parseGeminiText, mdToHtml, simulate, simulateGroup, validateFleet, taRate, formatEur, formatNum };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FleetCalc = api;
})(typeof window !== 'undefined' ? window : globalThis);
