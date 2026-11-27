// Proiezione deterministica di portafoglio: stesso algoritmo del documento tecnico PRJ-FIN-2026-018.
//   1) CAGR lordo, TER e aliquota fiscale del portafoglio = medie ponderate per il peso di ogni strumento
//   2) CAGR netto pre-tasse = CAGR lordo − TER
//   3) montante lordo = capitale × (1 + CAGR netto)^anni; plusvalenza = montante − capitale
//   4) imposta = plusvalenza × aliquota ponderata; guadagno netto = plusvalenza − imposta
// Tutti i tassi sono frazioni (0,066 = 6,6 %). I pesi vengono normalizzati alla loro somma.

/** Portafoglio del documento: Core-Satellite 60/20/20 (LS80 + Nasdaq 100 + US Health Care). */
export const GEMINI_PORTFOLIO = {
  capital: 12000,
  years: [5, 7],
  rows: [
    { isin: 'IE00BMVB5R75', name: 'Vanguard LifeStrategy 80', weight: 0.6, ter: 0.0025, cagr: 0.066, tax: 0.235, mdd: 0.25 },
    { isin: 'IE00BMFKG444', name: 'Nasdaq 100', weight: 0.2, ter: 0.002, cagr: 0.1, tax: 0.26, mdd: 0.5 },
    { isin: 'IE00BWBXM617', name: 'US Health Care', weight: 0.2, ter: 0.0015, cagr: 0.09, tax: 0.26, mdd: 0.2 },
  ],
};

/** Medie ponderate dei parametri (pesi normalizzati). */
export function weightedParams(rows) {
  const valid = rows.filter((r) => r && r.weight > 0 && Number.isFinite(r.cagr));
  const wSum = valid.reduce((a, r) => a + r.weight, 0);
  if (!(wSum > 0)) return null;
  const avg = (k) => valid.reduce((a, r) => a + (r.weight / wSum) * (Number.isFinite(r[k]) ? r[k] : 0), 0);
  const cagr = avg('cagr');
  const ter = avg('ter');
  const tax = avg('tax');
  return { cagr, ter, tax, net: cagr - ter, weightSum: wSum };
}

/** Proiezione a `years` anni di `capital` con i parametri ponderati. */
export function project(params, capital, years) {
  // Strumenti a distribuzione (params.div = rendimento da dividendo annuo): il dividendo esce dal fondo
  // ogni anno, è tassato subito e non viene reinvestito (Trade Republic non lo fa in automatico); il
  // prezzo cresce quindi al tasso netto meno il dividendo. Senza dividendo la formula resta quella del
  // documento: capitale × (1 + CAGR − TER)^anni, imposta sulla plusvalenza a fine periodo.
  const div = Number.isFinite(params.div) && params.div > 0 ? params.div : 0;
  const g = params.net - div;
  const priceFinal = capital * (1 + g) ** years;
  let divCash = 0;
  const fullYears = Math.floor(years + 1e-9);
  for (let t = 0; t < fullYears; t++) divCash += capital * (1 + g) ** t * div;
  const rest = years - fullYears; // orizzonti non interi (es. 30 giorni): dividendo in proporzione al periodo
  if (rest > 1e-9) divCash += capital * (1 + g) ** fullYears * div * rest;
  const priceGain = priceFinal - capital;
  const priceTax = priceGain > 0 ? priceGain * params.tax : 0; // nessun credito d'imposta su una minusvalenza
  const divTax = divCash * params.tax;
  const gross = priceFinal + divCash;
  const gain = gross - capital;
  const netGain = priceGain - priceTax + divCash - divTax;
  return { years, gross, gain, tax: priceTax + divTax, priceGain, divTax, netGain, finalCapital: capital + netGain, netPct: netGain / capital };
}

// ---------- orizzonti brevi (giorni) ----------
// Gli orizzonti si esprimono in anni (frazioni: giorni / 365). Sotto 1 anno il montante deterministico
// CAGR − TER non basta: in 7-60 giorni la volatilità pesa più del rendimento atteso, e i costi fissi degli
// ordini (1 € in acquisto + 1 € in vendita su Trade Republic) sono una frazione rilevante del guadagno.
export const DAYS_PER_YEAR = 365;
/** Scelte rapide: 7, 30, 60, 90 giorni e 1, 3, 5, 7, 10 anni. */
export const HORIZON_PRESETS = [7, 30, 60, 90].map((d) => d / DAYS_PER_YEAR).concat([1, 3, 5, 7, 10]);
export const daysToYears = (d) => d / DAYS_PER_YEAR;
export const isShortHorizon = (y) => y < 1 - 1e-9;
const horizonDays = (y) => Math.max(1, Math.round(y * DAYS_PER_YEAR));
/** «30gg» oppure «5a» (etichette compatte). */
export function horizonShort(y) {
  return isShortHorizon(y) ? `${horizonDays(y)}gg` : `${+(+y).toFixed(2)}a`;
}
/** «30 giorni» / «1 giorno» / «5 anni» / «1 anno». */
export function horizonLong(y) {
  if (isShortHorizon(y)) {
    const d = horizonDays(y);
    return d === 1 ? '1 giorno' : `${d} giorni`;
  }
  const n = +(+y).toFixed(2);
  return n === 1 ? '1 anno' : `${n} anni`;
}
/** Esponente leggibile del montante: «7/365» per i giorni, «5» per gli anni. */
export function horizonExp(y) {
  return isShortHorizon(y) ? `${horizonDays(y)}/${DAYS_PER_YEAR}` : String(+(+y).toFixed(2));
}
/** Orizzonti validi (numeri > 0), senza doppioni, in ordine crescente, al massimo 6; vuoto → predefiniti. */
export function normalizeHorizons(list, fallback = [5, 7]) {
  const seen = [];
  for (const v of Array.isArray(list) ? list : []) {
    const y = Number(v);
    if (Number.isFinite(y) && y > 0 && y <= 100 && !seen.some((s) => Math.abs(s - y) < 1e-9)) seen.push(y);
  }
  const out = seen.sort((a, b) => a - b).slice(0, 6);
  return out.length ? out : fallback.slice();
}

/**
 * Correzione del CAGR con la TENDENZA RECENTE per gli orizzonti brevi (7-90 giorni). In pochi giorni/settimane il CAGR di
 * lungo periodo (prospettive di crescita, equilibrio di mercato, decadimento dei prodotti a leva) pesa poco: contano le
 * ultime evidenze di mercato. Si mescola il rendimento atteso dal modello (`net`, annuo) con la deriva logaritmica
 * osservata sulla finestra più breve ≥ 2 × orizzonte tra 1, 4, 13 e 26 settimane, assumendo che continui in parte
 * (persistenza `rho`, default 25%: effetto momentum di serie storica, debole ma presente su 1-12 mesi). L'effetto sul
 * periodo non può superare ±0,5 σ·√T, così uno strappo non produce stime irrealistiche.
 * Restituisce { net: CAGR netto equivalente per l'orizzonte, tilt: effetto (log) sul periodo, window, rho }.
 */
// Persistenza usata quando NON è automatica (CAGR inserito a mano): 0 = il valore dell'utente vale così com'è.
// Nel portafoglio il default è automatico (autoRho): il trend prosegue solo se le previsioni lo confermano.
export const MOMENTUM_RHO = 0;

/**
 * Persistenza automatica: il trend di mercato attuale prosegue (100%) se va nella stessa direzione della previsione
 * (modello con analisti/fondamentali o previsione di mercato verificata), altrimenti si ignora (0%).
 */
export function autoRho(forecastNet, trendNet) {
  if (!Number.isFinite(forecastNet) || !Number.isFinite(trendNet)) return 0;
  return Math.sign(forecastNet) !== 0 && Math.sign(forecastNet) === Math.sign(trendNet) ? 1 : 0;
}
export function momentumTilt({ net, vol, mom, years, rho = MOMENTUM_RHO }) {
  rho = Number.isFinite(rho) ? rho : MOMENTUM_RHO;
  if (!mom || !(years > 0)) return { net, tilt: 0, window: null, rho };
  const wins = [[1, mom.w1], [4, mom.w4], [13, mom.w13], [26, mom.w26]].filter(([, r]) => Number.isFinite(r) && r > -0.99);
  if (!wins.length) return { net, tilt: 0, window: null, rho };
  // finestra almeno doppia dell'orizzonte e mai sotto 4 settimane: il rendimento di 1 settimana è troppo rumoroso (e nel
  // fine settimana vale 0, perché la nuova barra settimanale ripete il prezzo del venerdì)
  const [k, R] = wins.find(([kk]) => kk >= Math.max(2 * years * 52, 4)) ?? wins[wins.length - 1];
  // deriva logaritmica annua osservata (crescita mediana): + σ²/2 per confrontarla con il rendimento MEDIO del modello
  const trend = (Math.log(1 + R) / k) * 52 + (Number.isFinite(vol) && vol > 0 ? (vol * vol) / 2 : 0);
  const prior = Math.log(1 + Math.max(net, -0.99));
  let adj = rho * (trend - prior);
  if (Number.isFinite(vol) && vol > 0) {
    const cap = (2 * vol) / Math.sqrt(years); // limite di sicurezza ±2 σ·√T sul periodo (solo contro dati anomali)
    adj = Math.max(-cap, Math.min(cap, adj));
  }
  return { net: Math.exp(prior + adj) - 1, tilt: adj * years, window: k, rho };
}

/**
 * Prodotto a leva/short con ribilanciamento GIORNALIERO: rendimento a `years` se il sottostante varia di `move` (es. −0,10),
 * con volatilità del sottostante `sigmaU`. ln P = L·ln S + (L − L²)/2·σ²·T + (1 − L)·rf·T − TER·T (L negativo per gli short):
 * con il sottostante fermo il prodotto perde per il decadimento da ribilanciamento, tanto più quanto è volatile.
 */
export function leveredScenario({ L, sigmaU, years, move, rf = 0.02, ter = 0 }) {
  if (!Number.isFinite(L) || L === 0 || !(1 + move > 0)) return null;
  const s = Number.isFinite(sigmaU) ? sigmaU : 0;
  return Math.exp(L * Math.log(1 + move) + ((L - L * L) / 2) * s * s * years + (1 - L) * rf * years - ter * years) - 1;
}

/** Funzione di ripartizione della normale standard (Abramowitz–Stegun 26.2.17, errore < 1e-7). */
export function normCdf(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp((-x * x) / 2);
  const p = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x > 0 ? 1 - p : p;
}

/**
 * Guadagno netto atteso a orizzonte BREVE (< 1 anno) di `capital` euro.
 *   μ_T  = (1 + CAGR − TER)^T − 1            rendimento atteso del periodo (T in anni)
 *   σ_T  = σ·√T                               volatilità del periodo (σ annua del modello)
 *   1+R ~ lognormale con E[1+R] = 1 + μ_T     (il capitale non scende sotto zero)
 *   imposta attesa = aliquota × capitale × E[max(R,0)]   (nessun credito d'imposta sulle perdite),
 *     E[max(R,0)] = (1+μ_T)·Φ(d1) − Φ(d2), d2 = ln-media/σ_T, d1 = d2 + σ_T  (formula chiusa)
 *   costi = 2 × costo ordine × posizioni      (acquisto + vendita)
 *   netto atteso = capitale × μ_T − imposta attesa − costi
 * Senza σ: imposta solo se μ_T > 0 (caso deterministico). Restituisce anche probabilità di guadagno e
 * intervallo tipico (16°–84° percentile, circa ±1σ) del guadagno netto.
 */
/** Quantile normale del 10%: sotto questo valore finisce 1 caso su 10. */
export const Z_P10 = -1.2815515655446004;
export function projectShort(params, capital, years, { vol = null, orderCost = 1, positions = 1, momRho } = {}) {
  const net0 = Number.isFinite(params.net) ? params.net : params.cagr - (params.ter || 0);
  const tr = params.mom ? momentumTilt({ net: net0, vol, mom: params.mom, years, rho: momRho }) : null; // tendenza recente
  const net = tr ? tr.net : net0;
  const tax = Number.isFinite(params.tax) ? params.tax : 0.26;
  const mu = (1 + net) ** years - 1;
  const costs = 2 * Math.max(0, orderCost) * Math.max(1, positions);
  const sigma = Number.isFinite(vol) && vol > 0 ? vol * Math.sqrt(years) : 0;
  let gainRate = mu;
  let expTaxRate;
  let pProfit = null;
  let quant = null;
  let medianGross = mu; // variazione lorda nel caso mediano: senza volatilità coincide con quella attesa
  if (sigma > 0) {
    const a = Math.log(1 + mu) - (sigma * sigma) / 2; // media del logaritmo
    const d2 = a / sigma;
    const d1 = d2 + sigma;
    // ETC/ETN/ETP (redditi diversi): le minusvalenze compensano le plusvalenze → imposta sul guadagno medio atteso
    // Default: perdite compensabili (zainetto fiscale / altre plusvalenze) → imposta = aliquota × guadagno atteso.
    // `taxPrudent` (solo ETF UCITS): perdite non compensate → imposta sui soli scenari in guadagno (più alta con σ grande).
    const prudent = params.taxPrudent && !params.symTax;
    expTaxRate = prudent ? tax * Math.max(0, (1 + mu) * normCdf(d1) - normCdf(d2)) : tax * Math.max(0, mu); // mai imposta negativa
    pProfit = normCdf((a - Math.log(1 + costs / Math.max(capital, 1e-9))) / sigma); // guadagno dopo i costi degli ordini
    const at = (z) => {
      const g = capital * (Math.exp(a + z * sigma) - 1);
      return g - (g > 0 ? g * tax : 0) - costs;
    };
    quant = { low: at(-1), high: at(1), median: at(0), p10: at(Z_P10) };
    medianGross = Math.exp(a) - 1; // metà dei casi sopra, metà sotto (prima di costi e imposte) // mediana = esito più probabile (metà dei casi sopra, metà sotto)
  } else expTaxRate = tax * Math.max(0, mu);
  const taxEur = capital * expTaxRate;
  const gain = capital * gainRate;
  const netGain = gain - taxEur - costs;
  return {
    years,
    gross: capital + gain,
    gain,
    tax: taxEur,
    costs,
    netGain,
    finalCapital: capital + netGain,
    netPct: capital > 0 ? netGain / capital : 0,
    short: true,
    mu, // rendimento lordo atteso nel periodo (con la tendenza recente)
    netUsed: net, // CAGR netto equivalente usato per l'orizzonte (annuo)
    trend: tr && tr.window ? { tilt: tr.tilt, window: tr.window, rho: tr.rho } : null,
    sigma,
    pProfit,
    low: quant?.low ?? null,
    high: quant?.high ?? null,
    medianNet: quant?.median ?? netGain, // netto nel caso mediano (più probabile)
    p10Net: quant?.p10 ?? null, // netto raggiunto o superato in 9 casi su 10 (10° percentile); null senza volatilità
    medianGross,
  };
}

/**
 * Imposta complessiva di più posizioni. `parts` = [{ h (risultato di project/projectShort), rate (aliquota) }].
 * Default (compensazione): le minusvalenze compensano le plusvalenze → aliquota × somma delle plusvalenze (mai sotto zero);
 * i dividendi restano tassati a parte (redditi di capitale, non compensabili). `prudent`: somma delle imposte di ciascuna.
 */
export function portfolioTax(parts, prudent = false) {
  if (prudent) return parts.reduce((a, { h }) => a + (h.tax || 0), 0);
  const div = parts.reduce((a, { h }) => a + (h.divTax || 0), 0);
  const capGains = parts.reduce((a, { h, rate }) => a + rate * (Number.isFinite(h.priceGain) ? h.priceGain : h.gain), 0);
  return div + Math.max(0, capGains);
}

/** `project` per orizzonti ≥ 1 anno (algoritmo 019), `projectShort` sotto l'anno. Stessa forma di risultato. */
export function projectAny(params, capital, years, opts = {}) {
  return isShortHorizon(years) ? projectShort(params, capital, years, opts) : project(params, capital, years);
}

/** Proiezione completa del portafoglio sugli orizzonti indicati (`rows[].vol` opzionale: σ annua per gli orizzonti brevi). */
export function projectPortfolio({ rows, capital, years, rho = 0.65, orderCost = 1, momRho, taxPrudent = false }) {
  // Righe con CAGR automatico già corretto dalla tendenza (`cagrTrend`): per gli orizzonti ≥ 1 anno si usa il CAGR di
  // lungo periodo (`cagrLong`), per quelli brevi il valore del campo, senza aggiungere di nuovo la tendenza (mom = null).
  const longRows = rows.map((r) => (r && r.cagrTrend && Number.isFinite(r.cagrLong) ? { ...r, cagr: r.cagrLong } : r));
  const params = weightedParams(longRows);
  if (!params) return null;
  const used = rows.filter((r) => r && r.weight > 0 && Number.isFinite(r.cagr));
  const paramsShort = weightedParams(used);
  const vol = portfolioRisk(used.map((r) => ({ weight: r.weight, vol: r.vol })), rho)?.vol ?? null;
  const wSum = used.reduce((a, r) => a + r.weight, 0) || 1;
  return {
    params,
    paramsShort,
    horizons: years.map((y) => {
      if (!isShortHorizon(y)) return project(params, capital, y);
      // breve termine: CAGR di ogni strumento corretto con la sua tendenza recente, poi media ponderata
      let tilt = 0;
      const tilted = used.map((r) => {
        const t = momentumTilt({ net: r.cagr - (r.ter || 0), vol: r.vol, mom: r.mom, years: y, rho: momRho });
        tilt += (r.weight / wSum) * t.tilt;
        return { ...r, cagr: t.net + (r.ter || 0) };
      });
      const agg = projectShort(weightedParams(tilted), capital, y, { vol, orderCost, positions: used.length, momRho });
      // atteso e imposta per strumento: il regime fiscale cambia (ETF UCITS vs ETC/ETN) e la σ è quella di ciascuno
      const per = tilted.map((r) => projectShort({ cagr: r.cagr, ter: r.ter, tax: r.tax, net: r.cagr - (r.ter || 0), symTax: r.symTax, taxPrudent }, (capital * r.weight) / wSum, y, { vol: r.vol, orderCost, positions: 1 }));
      const gain = per.reduce((a, x) => a + x.gain, 0);
      // perdite compensate nel portafoglio: l'imposta complessiva non scende sotto zero
      const tax = portfolioTax(per.map((h, k) => ({ h, rate: Number.isFinite(tilted[k].tax) ? tilted[k].tax : 0.26 })), taxPrudent);
      const costs = per.reduce((a, x) => a + x.costs, 0);
      const netGain = gain - tax - costs;
      return { ...agg, mu: capital > 0 ? gain / capital : 0, gross: capital + gain, gain, tax, costs, netGain, finalCapital: capital + netGain, netPct: capital > 0 ? netGain / capital : 0, trend: used.some((r) => r.mom) ? { tilt, window: null, rho: momRho ?? MOMENTUM_RHO } : null };
    }),
  };
}

/**
 * MODULO 4 del documento PRJ-FIN-2026-019: quantificazione del rischio.
 *   MDD_p = Σ w_i × MDD storico_i (drawdown massimo teorico del portafoglio in una recessione severa)
 *   σ_p = √(Σ_i Σ_j w_i w_j σ_i σ_j ρ_ij), con ρ_ii = 1 e ρ_ij = `rho` tra asset diversi (0,65 nel documento)
 * Pesi normalizzati alla loro somma. Un asset senza MDD o σ non contribuisce al relativo calcolo
 * (la copertura è indicata in `mddCoverage` / `volCoverage`).
 */
export function portfolioRisk(rows, rho = 0.65) {
  const valid = rows.filter((r) => r && r.weight > 0);
  const wSum = valid.reduce((a, r) => a + r.weight, 0);
  if (!(wSum > 0)) return null;
  let mdd = 0;
  let mddCoverage = 0;
  for (const r of valid) {
    if (Number.isFinite(r.mdd)) {
      mdd += (r.weight / wSum) * Math.abs(r.mdd);
      mddCoverage += r.weight / wSum;
    }
  }
  const withVol = valid.filter((r) => Number.isFinite(r.vol));
  let variance = 0;
  let volCoverage = 0;
  for (const a of withVol) {
    volCoverage += a.weight / wSum;
    for (const b of withVol) variance += (a.weight / wSum) * (b.weight / wSum) * a.vol * b.vol * (a === b ? 1 : rho);
  }
  return { mdd, mddCoverage, vol: withVol.length ? Math.sqrt(variance) : null, volCoverage, rho };
}

/**
 * Valutazione del rischio come nel documento 018 (sezione 5): impatto di una correzione del mercato
 * (−10%) e di un bear market (−30%) in proporzione al beta, capitale temporaneo dopo il calo e tempo di
 * recupero in mesi al CAGR netto: mesi = 12 × ln(1 / (1 − impatto)) / ln(1 + CAGR netto).
 * Con CAGR netto ≤ 0 il recupero non avviene (null).
 */
export const STRESS_SHOCKS = [
  { label: 'Correzione fisiologica', market: 0.1, sop: 'Nessuna azione. Mantenere le posizioni.' },
  { label: 'Recessione / bear market', market: 0.3, sop: 'Non vendere: sfruttare la flessibilità temporale fino al recupero.' },
];
export function stressTest({ beta, netCagr, capital, shocks = STRESS_SHOCKS }) {
  const b = Number.isFinite(beta) ? Math.max(0, beta) : 1;
  return shocks.map((sh) => {
    const impact = Math.min(0.99, b * sh.market);
    const after = capital * (1 - impact);
    const months = netCagr > 0 && impact > 0 ? (12 * Math.log(1 / (1 - impact))) / Math.log(1 + netCagr) : impact > 0 ? null : 0;
    return { ...sh, beta: b, impact, capitalAfter: after, recoveryMonths: months };
  });
}

/**
 * Classifica il tipo di portafoglio dal rischio, per adattare la quantificazione del rischio e lo stress
 * test. Usa la volatilità annua attesa σ_p (misura primaria); in mancanza ripiega sull'MDD storico
 * ponderato (convertito in volatilità equivalente ≈ MDD × 0,45). Restituisce null senza né σ né MDD.
 */
export const PORTFOLIO_TYPES = [
  { max: 0.07, type: 'prudente', label: 'Prudente', desc: 'Prevalenza di obbligazioni e strumenti a bassa oscillazione: cali contenuti e recupero rapido.', bear: 'Mantenere: il calo è contenuto e il recupero atteso è breve.' },
  { max: 0.12, type: 'moderato', label: 'Moderato', desc: 'Mix equilibrato con una componente difensiva importante: oscillazioni medie.', bear: 'Mantenere: la componente difensiva limita il calo; recupero in genere entro pochi anni.' },
  { max: 0.17, type: 'bilanciato', label: 'Bilanciato', desc: 'Esposizione azionaria prevalente ma diversificata: oscillazioni marcate, orizzonte pluriennale.', bear: 'Non vendere: sfruttare la flessibilità temporale; il recupero richiede alcuni anni.' },
  { max: 0.25, type: 'dinamico', label: 'Dinamico / aggressivo', desc: 'Forte esposizione azionaria, spesso concentrata su settori o aree a crescita: cali ampi e recupero lungo.', bear: 'Non vendere, ma attendersi un recupero lungo: servono anni e nervi saldi.' },
  { max: Infinity, type: 'speculativo', label: 'Molto aggressivo / speculativo', desc: 'Volatilità molto elevata (tecnologia concentrata, singole azioni, crypto): sono possibili perdite profonde e durature.', bear: 'Rischio di perdita anche permanente: valutare con attenzione la dimensione della posizione.' },
];
export function classifyPortfolio({ vol, mdd } = {}) {
  const v = Number.isFinite(vol) ? vol : null;
  const m = Number.isFinite(mdd) ? mdd : null;
  const score = v != null ? v : m != null ? m * 0.45 : null;
  if (score == null) return null;
  return { ...PORTFOLIO_TYPES.find((t) => score < t.max), vol: v, mdd: m, score };
}

/**
 * Stress test basato sul rischio effettivo del portafoglio (non su shock di mercato generici): gli scenari
 * derivano dalla volatilità attesa σ_p e dal drawdown massimo storico MDD_p, entrambi calcolati dalla
 * composizione (strumenti e pesi). Così gli scenari si ricalcolano quando cambia il portafoglio.
 *   - Correzione: calo pari a 1 × σ_p
 *   - Ribasso marcato: calo pari a 2 × σ_p (limitato all'MDD_p se disponibile e inferiore)
 *   - Recessione severa: calo pari all'MDD_p (drawdown massimo storico ponderato)
 * Per ogni scenario: capitale residuo e tempo di recupero in mesi al CAGR netto pre-tasse
 * (12 × ln(1 / (1 − calo)) / ln(1 + CAGR)). Con CAGR ≤ 0 il recupero non avviene (null).
 */
export function portfolioStress({ vol, mdd, netCagr, capital }) {
  const scen = [];
  if (Number.isFinite(vol) && vol > 0) {
    scen.push({ label: 'Correzione (−1σ)', drop: Math.min(0.99, vol), note: 'oscillazione ordinaria di un anno' });
    scen.push({ label: 'Ribasso marcato (−2σ)', drop: Math.min(0.99, Number.isFinite(mdd) ? Math.min(2 * vol, Math.max(mdd, vol)) : 2 * vol), note: 'ribasso raro ma possibile' });
  }
  if (Number.isFinite(mdd) && mdd > 0) {
    scen.push({ label: 'Recessione severa (MDD storico)', drop: Math.min(0.99, mdd), note: 'peggior crollo nello storico del portafoglio' });
  }
  return scen.map((sh) => {
    const after = capital * (1 - sh.drop);
    const months = netCagr > 0 && sh.drop > 0 ? (12 * Math.log(1 / (1 - sh.drop))) / Math.log(1 + netCagr) : sh.drop > 0 ? null : 0;
    return { ...sh, capitalAfter: after, recoveryMonths: months };
  });
}

/**
 * Scenari per un portafoglio di AZIONI singole (metodo del documento PRJ-FIN-2026-010): le azioni non
 * hanno TER né rendimento di mercato garantito. Tre scenari a `years` anni sul capitale `capital` col
 * CAGR lordo ponderato `cagr` (media per importo) e imposta 26% sulle plusvalenze:
 *   - Base (target): capitalizzazione composta al CAGR atteso.
 *   - Bull (iper-crescita): CAGR maggiorato (× 1,4), i megatrend accelerano.
 *   - Bear (stress): perdita idiosincratica pari al drawdown massimo storico del portafoglio (MDD_p),
 *     nessuna imposta su una perdita; il capitale NON è garantito come negli ETF diversificati.
 */
export function stockScenarios({ capital, cagr, tax = 0.26, mdd, years = 5, bullFactor = 1.4 }) {
  if (!Number.isFinite(cagr) || !(capital > 0)) return null;
  const run = (g) => project({ cagr: g, ter: 0, tax, net: g }, capital, years);
  const base = run(cagr);
  const bullCagr = cagr * bullFactor;
  const bull = run(bullCagr);
  const loss = Number.isFinite(mdd) ? Math.min(0.95, Math.abs(mdd)) : null;
  const bear = loss != null ? { years, drop: loss, netGain: -capital * loss, finalCapital: capital * (1 - loss), netPct: -loss } : null;
  return { base, bull, bullCagr, bear, cagr, years };
}

/**
 * Stress test TOTALE del portafoglio (metodo del documento PRJ-FIN-2026-041): il crash avviene al picco
 * di fine orizzonte, quando il montante lordo è massimo. A ogni strumento si applica il suo MDD storico;
 * l'MDD del portafoglio è la media ponderata per peso (Σ wᵢ × MDDᵢ). Restituisce:
 *   - peak: montante lordo al termine di `years` (Σ importoᵢ × (1 + CAGRᵢ − TERᵢ)^years)
 *   - mdd: drawdown ponderato; crash: euro bruciati = peak × mdd; postCrash: valore al minimo
 *   - vsToday: valore post-crash − capitale investito (negativo = sotto il capitale di partenza)
 *   - recoveryMonths: tempo per tornare al picco componendo al CAGR netto ponderato
 *   - breakdown: per strumento peso, MDD e contributo al drawdown (wᵢ × MDDᵢ)
 * `items`: [{ name, amount, cagr, ter, mdd }]. Restituisce null senza capitale.
 */
export function totalPortfolioStress({ items, years = 5 }) {
  const valid = (items || []).filter((i) => i.amount > 0 && Number.isFinite(i.cagr));
  const capital = valid.reduce((a, i) => a + i.amount, 0);
  if (!(capital > 0)) return null;
  let peak = 0;
  let mdd = 0;
  let mddCov = 0;
  let netCagr = 0;
  const breakdown = [];
  for (const i of valid) {
    const net = i.cagr - (Number.isFinite(i.ter) ? i.ter : 0);
    const gross = i.amount * (1 + net) ** years;
    peak += gross;
    const w = i.amount / capital;
    netCagr += w * net;
    const m = Number.isFinite(i.mdd) ? Math.min(0.95, Math.abs(i.mdd)) : null;
    if (m != null) {
      mdd += w * m;
      mddCov += w;
    }
    breakdown.push({ name: i.name, weight: w, mdd: m, gross });
  }
  const crash = peak * mdd;
  const postCrash = peak - crash;
  const recoveryMonths = netCagr > 0 && mdd > 0 ? (12 * Math.log(1 / (1 - mdd))) / Math.log(1 + netCagr) : null;
  return { capital, years, peak, mdd, mddCov, crash, postCrash, vsToday: postCrash - capital, netCagr, recoveryMonths, breakdown };
}
