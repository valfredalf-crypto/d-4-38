// Stima prospettica di rendimento atteso e volatilità per i prossimi anni.
// Combina lo storico con evidenze di mercato recenti invece di proiettare il passato tale e quale:
//  • equilibrio (CAPM): tasso privo di rischio + beta × premio per il rischio azionario
//  • consenso analisti: prezzo obiettivo a 12 mesi (scontato per il noto ottimismo) + dividendi,
//    applicato al solo primo anno e poi convergente all'equilibrio
//  • volatilità: media tra lungo periodo, regime recente (EWMA) e volatilità implicita delle opzioni
import { logReturns, WEEKS_PER_YEAR } from './montecarlo.js';
import { CALIBRATION } from './calibration.js';

export const BASE_OUTLOOK = {
  mode: 'forward',        // 'forward' (prospettico) | 'historical' (solo storico)
  riskFree: 2.0,          // % annuo, tasso privo di rischio in EUR
  equityPremium: 5.0,     // % annuo, premio per il rischio azionario globale
  cryptoPremium: 0.0,     // % annuo, premio aggiuntivo per le crypto (nessun fondamentale: prudenza)
  weightHistory: 0.3,
  weightEquilibrium: 0.4,
  weightAnalysts: 0.3,
  weightFundamentals: 0.3, // crescita attesa degli utili e valutazione (modello Grinold-Kroner)
  growthHaircut: 0.6,     // quota creduta della crescita attesa dagli analisti oltre quella di lungo periodo
  longRunGrowth: 4.0,     // % annuo: crescita nominale di lungo periodo verso cui convergono gli utili
  fairPE: 18,             // P/E di lungo periodo del mercato azionario
  peReversion: 0.5,       // quota della distanza dal P/E di lungo periodo che si chiude in 5 anni
  maxValuation: 0.04,     // limite annuo (±) del contributo della rivalutazione/svalutazione del P/E
  analystHaircut: 0.5,    // quota del rialzo implicito nei target che viene creduta
  priorUncertainty: 5.0,  // % annuo: incertezza sul rendimento di equilibrio (governa la credibilità dello storico)
  minAnalysts: 3,
  ewmaLambda: 0.97,       // decadimento settimanale per la volatilità recente
  betaYears: 5,
  minStockBeta: 0.5,      // beta minimo per le singole azioni (dopo l'aggiustamento di Blume)
  ewmaWeight: 0.4,        // peso della volatilità recente (EWMA) rispetto a quella di lungo periodo
  regimeUncertainty: 4.0, // % annuo: quanto cambia il rendimento medio da un regime di mercato all'altro
  fullHistoryYears: 5,    // sotto questi anni di dati reali la credibilità dello storico si riduce in proporzione
  maxSharpe: 1.0,         // rendimento storico oltre il tasso privo di rischio limitato a maxSharpe × volatilità
  volScale: 1.0,          // correzione complessiva della volatilità (tarata sulle perdite massime reali)
};

// Valori in uso: predefiniti + eventuale taratura dal backtest.
export const DEFAULT_OUTLOOK = { ...BASE_OUTLOOK, ...(CALIBRATION.outlook || {}) };

const WEEK = 7 * 86400;

export function weekKey(ts) {
  // Le chiusure settimanali di borse diverse possono avere timestamp leggermente diversi.
  return Math.floor((ts + 3 * 86400) / WEEK);
}

/** Beta settimanale rispetto al benchmark (MSCI World in EUR), con aggiustamento di Blume verso 1. */
export function estimateBeta(ts, prices, bTs, bPrices, years = 5) {
  if (!bTs?.length) return null;
  const bMap = new Map();
  for (let i = 0; i < bTs.length; i++) bMap.set(weekKey(bTs[i]), bPrices[i]);
  const a = [];
  const b = [];
  for (let i = 0; i < ts.length; i++) {
    const v = bMap.get(weekKey(ts[i]));
    if (v != null) {
      a.push(prices[i]);
      b.push(v);
    }
  }
  const n = Math.min(a.length, Math.round(years * WEEKS_PER_YEAR) + 1);
  const ra = logReturns(a.slice(-n));
  const rb = logReturns(b.slice(-n));
  const m = Math.min(ra.length, rb.length);
  if (m < WEEKS_PER_YEAR) return null;
  const ma = ra.reduce((s, x) => s + x, 0) / m;
  const mb = rb.reduce((s, x) => s + x, 0) / m;
  let cov = 0;
  let varB = 0;
  for (let i = 0; i < m; i++) {
    cov += (ra[i] - ma) * (rb[i] - mb);
    varB += (rb[i] - mb) ** 2;
  }
  if (varB === 0) return null;
  const raw = cov / varB;
  return { raw, adjusted: 0.67 * raw + 0.33 };
}

export function ewmaVol(rets, lambda) {
  if (!rets.length) return NaN;
  const mean = rets.reduce((s, x) => s + x, 0) / rets.length;
  let v = rets.reduce((s, x) => s + (x - mean) ** 2, 0) / rets.length;
  for (const r of rets) v = lambda * v + (1 - lambda) * (r - mean) ** 2;
  return Math.sqrt(v * WEEKS_PER_YEAR);
}

/**
 * @param {object} p
 * @param {'stock'|'etf'|'crypto'} p.type
 * @param {number[]} p.timestamps, p.prices  storico settimanale in EUR
 * @param {object} [p.benchmark]  { timestamps, closesEur }
 * @param {object} [p.fundamentals]  output di /api/outlook
 * @param {object} [p.holdings]      solo ETF: partecipazioni con le relative stime (vedi holdingsFundamentals)
 * @param {number} p.years  orizzonte
 * @param {number} p.lookbackYears
 */
export function forwardParams(p, settings = {}) {
  const s = { ...DEFAULT_OUTLOOK, ...settings };
  const lookback = Math.round(p.lookbackYears * WEEKS_PER_YEAR) + 1;
  const rets = logReturns(p.prices.slice(-lookback));
  if (rets.length < 2) return null;
  const n = rets.length;
  const muW = rets.reduce((a, x) => a + x, 0) / n;
  const sdW = Math.sqrt(rets.reduce((a, x) => a + (x - muW) ** 2, 0) / (n - 1));
  const sigmaReal = sdW * Math.sqrt(WEEKS_PER_YEAR);
  // Volatilità di lungo periodo: sullo storico ricostruito con l'indice (se lo storico reale è breve),
  // così include anche crisi precedenti alla nascita dello strumento.
  let sigmaLong = sigmaReal;
  if (p.riskPrices && p.riskPrices.length > p.prices.length) {
    const rr = logReturns(p.riskPrices.slice(-lookback));
    const m = rr.reduce((a, x) => a + x, 0) / rr.length;
    sigmaLong = Math.sqrt(rr.reduce((a, x) => a + (x - m) ** 2, 0) / (rr.length - 1)) * Math.sqrt(WEEKS_PER_YEAR);
  }
  const histLog = muW * WEEKS_PER_YEAR;
  // Media aritmetica dallo storico; con volatilità estreme il termine σ²/2 esploderebbe: limitato.
  const histArith = Math.min(1, Math.max(-0.5, Math.exp(histLog + Math.min(sigmaReal, 0.8) ** 2 / 2) - 1));

  if (s.mode === 'historical') {
    return { mode: 'historical', drift: histLog, vol: sigmaLong, expected: histArith, components: { history: histArith }, weights: { history: 1 } };
  }

  // --- Volatilità prospettica
  const sigmaEwma = ewmaVol(rets, s.ewmaLambda);
  const f = p.fundamentals || {};
  const sigmaImpl = f.impliedVol > 0 ? f.impliedVol : null;
  // Lungo periodo + regime recente (+ implicita dalle opzioni, quando c'è, con peso 0,3).
  const wE = Math.min(Math.max(s.ewmaWeight, 0), 1);
  const blend = (1 - wE) * sigmaLong + wE * sigmaEwma;
  const vol = s.volScale * (sigmaImpl ? 0.7 * blend + 0.3 * sigmaImpl : blend);

  // --- Rendimento atteso di equilibrio
  const rf = s.riskFree / 100;
  const betaEst = estimateBeta(p.timestamps, p.prices, p.benchmark?.timestamps, p.benchmark?.closesEur, s.betaYears);
  // Beta grezzo: media tra la stima settimanale contro l'MSCI World in EUR e quella pubblicata da Yahoo
  // (5 anni, mensile); poi aggiustamento di Blume verso 1. Per le singole azioni minimo `minStockBeta`:
  // un beta vicino a zero (o negativo) di un'azienda quotata è quasi sempre un artefatto di un periodo
  // in cui il titolo si è mosso per motivi propri, non una vera assenza di rischio di mercato.
  const rawBetas = [betaEst?.raw, f.beta].filter((b) => b != null && Number.isFinite(b));
  // Limite matematico: β = ρ·σ/σ_mercato ≤ σ/σ_mercato. Uno strumento quasi fermo (monetario,
  // obbligazionario breve) non può avere beta alto, anche quando il beta non si riesce a stimare.
  let sigmaM = 0.15;
  if (p.benchmark?.closesEur?.length > 60) {
    const rb = logReturns(p.benchmark.closesEur.slice(-lookback));
    const mb = rb.reduce((a, x) => a + x, 0) / rb.length;
    sigmaM = Math.sqrt(rb.reduce((a, x) => a + (x - mb) ** 2, 0) / (rb.length - 1)) * Math.sqrt(WEEKS_PER_YEAR) || 0.15;
  }
  const betaBound = Math.max(sigmaLong, sigmaReal) / sigmaM;
  const betaRaw = Math.min(rawBetas.length ? rawBetas.reduce((a, b) => a + b, 0) / rawBetas.length : 1, betaBound);
  // Aggiustamento di Blume (verso 1) solo per le singole azioni: per un ETF il beta stimato su un
  // portafoglio diversificato è stabile, e un monetario o obbligazionario ha davvero beta ≈ 0.
  let beta = p.type === 'stock' ? Math.max(0.67 * betaRaw + 0.33, s.minStockBeta) : Math.max(betaRaw, 0);
  const equilibrium = p.type === 'crypto' ? rf + s.cryptoPremium / 100 : rf + Math.max(beta, 0) * (s.equityPremium / 100);

  // --- Storico "credibile": shrinkage bayesiano (modello normale-normale) verso l'equilibrio.
  // L'incertezza sulla media storica ha due parti: il rumore statistico σ²/T e l'incertezza di
  // "regime" (la media di un periodo cambia da un ciclo di mercato all'altro anche con tanti dati).
  // Inoltre con meno di `fullHistoryYears` anni lo storico copre un solo regime (es. solo il
  // post-Covid) e la credibilità si riduce in proporzione: non si proietta un periodo eccezionale.
  const years = n / WEEKS_PER_YEAR;
  const histVar = sigmaLong ** 2 / Math.max(years, 1e-9) + (s.regimeUncertainty / 100) ** 2;
  const precHist = 1 / histVar;
  const precPrior = 1 / (s.priorUncertainty / 100) ** 2;
  const credibility = (precHist / (precHist + precPrior)) * Math.min(1, years / s.fullHistoryYears);
  // Limite di Sharpe: nessuno strumento sostiene a lungo un rendimento oltre il tasso privo di rischio
  // superiore a ~1 volta la sua volatilità; oltre, è un periodo eccezionale o un dato anomalo
  // (es. ETF obbligazionari a brevissimo termine con prezzi aggiustati sempre in salita).
  const histCapped = Math.min(histArith, rf + s.maxSharpe * Math.max(sigmaLong, sigmaReal));
  const historyShrunk = equilibrium + credibility * (histCapped - equilibrium);

  // --- Consenso analisti (solo primo anno, poi equilibrio)
  let analysts = null;
  let analystUpside = null;
  if (f.targetMean > 0 && f.price > 0 && (f.analysts || 0) >= s.minAnalysts) {
    analystUpside = Math.max(-0.5, Math.min(0.5, f.targetMean / f.price - 1));
    const year1 = analystUpside * s.analystHaircut + (f.dividendYield || 0);
    analysts = (year1 + (p.years - 1) * equilibrium) / p.years;
  }

  // --- Fondamentali (Grinold-Kroner): dividendo + crescita degli utili + variazione della valutazione
  let fundamentalsEst = fundamentalsReturn(f, s, p.years);
  // Senza stime proprie (ETF, azioni non coperte dagli analisti): prospettive di crescita e valutazione
  // del mercato azionario, in proporzione al beta (un monetario o obbligazionario con β≈0 riceve il
  // tasso privo di rischio). Le crypto non hanno utili: nessuna componente di crescita.
  // ETF: prospettive di crescita delle partecipazioni effettive (stime per titolo + P/E del fondo).
  if (!fundamentalsEst && p.type === 'etf' && p.holdings) fundamentalsEst = holdingsFundamentals(p.holdings, s, p.market, p.marketGrowth, p.years);
  if (!fundamentalsEst && p.type !== 'crypto' && Number.isFinite(p.market)) {
    fundamentalsEst = {
      expected: rf + Math.max(beta, 0) * (p.market - rf),
      source: 'market',
      market: p.market,
      beta,
      // crescita degli utili "sottostante": solo per strumenti di tipo azionario (beta ≥ 0,45);
      // obbligazionari, monetari e oro non hanno utili da far crescere
      growth: Number.isFinite(p.marketGrowth) && beta >= 0.45 ? p.marketGrowth * beta : null,
    };
  }

  const parts = [
    ['history', historyShrunk, s.weightHistory],
    ['equilibrium', equilibrium, s.weightEquilibrium],
    ['analysts', analysts, s.weightAnalysts],
    ['fundamentals', fundamentalsEst?.expected ?? null, s.weightFundamentals],
  ].filter(([, v, w]) => v != null && Number.isFinite(v) && w > 0);
  const wSum = parts.reduce((a, [, , w]) => a + w, 0) || 1;
  // Limiti di realismo per il rendimento annuo atteso
  const expected = Math.min(0.5, Math.max(-0.3, parts.reduce((a, [, v, w]) => a + (v * w) / wSum, 0)));
  // Rendimento logaritmico coerente con media aritmetica `expected` e volatilità `vol`.
  const drift = Math.log(1 + Math.max(expected, -0.95)) - vol ** 2 / 2;

  return {
    mode: 'forward',
    drift,
    vol,
    expected,
    beta,
    betaRaw: rawBetas.length ? betaRaw : null,
    sigmaLong,
    sigmaEwma,
    sigmaImpl,
    analystUpside,
    credibility,
    historyRaw: histArith,
    historyYears: years,
    backfilledYears: p.riskPrices && p.riskPrices.length > p.prices.length ? (Math.min(p.riskPrices.length, lookback) - p.prices.slice(-lookback).length) / WEEKS_PER_YEAR : 0,
    components: { history: historyShrunk, equilibrium, analysts, fundamentals: fundamentalsEst?.expected ?? null },
    fundamentalsDetail: fundamentalsEst,
    expectedGrowth: fundamentalsEst?.growth ?? null, // crescita annua degli utili attesa nei 5 anni
    growthSource: fundamentalsEst ? fundamentalsEst.source || 'own' : null,
    weights: Object.fromEntries(parts.map(([k, , w]) => [k, w / wSum])),
  };
}

/**
 * Rendimento atteso dai fondamentali (Grinold-Kroner), annuo sull'orizzonte:
 *   dividendo + crescita media degli utili + variazione annua del P/E.
 * - crescita: consenso analisti a 5 anni (o, in mancanza, anno prossimo), creduta solo in parte
 *   (`growthHaircut`) e che rallenta linearmente fino alla crescita di lungo periodo;
 * - valutazione: il P/E atteso chiude una parte (`peReversion`) della distanza dal P/E di lungo periodo.
 * null se mancano P/E atteso, stime di crescita o copertura sufficiente degli analisti.
 */
export function fundamentalsReturn(f, settings = {}, years = 5) {
  const s = { ...DEFAULT_OUTLOOK, ...settings };
  if (!f || !(f.forwardPE > 0) || (f.analysts || 0) < s.minAnalysts) return null;
  const gL = s.longRunGrowth / 100;
  let g0;
  if (Number.isFinite(f.growthLongTerm)) {
    g0 = Math.max(-0.1, Math.min(0.4, f.growthLongTerm)); // stima a 5 anni: stime estreme limitate
  } else {
    // Solo stima del prossimo anno: limitata a +25% e, se ci sono le stime dei ricavi, a non più di
    // 10 punti sopra la crescita dei ricavi. Un balzo degli utili con ricavi fermi è un rimbalzo dopo
    // un anno negativo (non si ripete per 5 anni); una crescita trainata dai ricavi è più duratura.
    let g1 = Number.isFinite(f.epsGrowthNext) ? f.epsGrowthNext : Number.isFinite(f.revenueGrowthNext) ? f.revenueGrowthNext : null;
    if (g1 == null) return null;
    if (Number.isFinite(f.revenueGrowthNext)) g1 = Math.min(g1, f.revenueGrowthNext + 0.1);
    g0 = Math.max(-0.1, Math.min(0.25, g1));
  }
  const gStart = gL + s.growthHaircut * (g0 - gL);
  const growth = (gStart + gL) / 2; // media di un rallentamento lineare da gStart a gL
  const pe = Math.max(5, Math.min(80, f.forwardPE));
  const peTarget = pe + s.peReversion * (s.fairPE - pe);
  // Un P/E molto basso (o alto) spesso riflette problemi (o qualità) strutturali: il ritorno verso il
  // P/E di lungo periodo è limitato a ±maxValuation l'anno
  const valuation = Math.max(-s.maxValuation, Math.min(s.maxValuation, (peTarget / pe) ** (1 / years) - 1));
  const dividend = Math.max(0, Math.min(0.1, f.dividendYield || 0));
  const expected = (1 + growth) * (1 + valuation) - 1 + dividend;
  return { expected, growth, valuation, dividend, pe, peTarget, growthInput: g0 };
}

/**
 * Prospettive di un ETF a partire dalle sue partecipazioni (Grinold-Kroner "look-through"):
 * - quota coperta: media pesata di crescita e rendimento atteso di ogni titolo con stime degli analisti;
 * - resto della parte azionaria: crescita del mercato, valutazione dal P/E aggregato del fondo, dividendo del fondo;
 * - parte non azionaria (obbligazioni, liquidità): tasso privo di rischio, nessuna crescita degli utili.
 * `h` = { holdings: [{ symbol, weight, fundamentals }], stockPosition, pe, dividendYield }.
 * Restituisce null se le stime coprono meno del 10% del fondo (si usano allora le prospettive di mercato).
 */
export function holdingsFundamentals(h, settings = {}, market = null, marketGrowth = null, years = 5) {
  const s = { ...DEFAULT_OUTLOOK, ...settings };
  if (!h?.holdings?.length) return null;
  const rf = s.riskFree / 100;
  const stock = Number.isFinite(h.stockPosition) ? Math.max(0, Math.min(1, h.stockPosition)) : 1;
  if (stock < 0.5) return null; // fondo prevalentemente obbligazionario: le partecipazioni azionarie non lo descrivono
  let wc = 0;
  let sumE = 0;
  let sumG = 0;
  const used = [];
  for (const x of h.holdings) {
    const g = fundamentalsReturn(x.fundamentals, s, years);
    if (!g || !(x.weight > 0)) continue;
    wc += x.weight;
    sumE += x.weight * g.expected;
    sumG += x.weight * g.growth;
    used.push({ symbol: x.symbol, weight: x.weight, growth: g.growth, expected: g.expected });
  }
  wc = Math.min(wc, stock);
  if (wc < 0.1) return null;
  // Parte azionaria non coperta: crescita di mercato + rivalutazione/svalutazione verso il P/E equo
  const rest = stock - wc;
  const gM = Number.isFinite(marketGrowth) ? marketGrowth : s.longRunGrowth / 100;
  let restE = Number.isFinite(market) ? market : rf + 0.045;
  if (h.pe > 0) {
    const pe = Math.max(5, Math.min(80, h.pe));
    const peTarget = pe + s.peReversion * (s.fairPE - pe);
    const div = Math.max(0, Math.min(0.1, h.dividendYield || 0));
    const val = Math.max(-s.maxValuation, Math.min(s.maxValuation, (peTarget / pe) ** (1 / years) - 1));
    restE = (1 + gM) * (1 + val) - 1 + div;
  }
  const expected = sumE + rest * restE + (1 - stock) * rf;
  const growth = (sumG + rest * gM) / stock;
  return { expected, growth, source: 'holdings', coverage: wc, stock, pe: h.pe ?? null, top: used.slice(0, 10) };
}

/**
 * Prospettive del mercato azionario (Grinold-Kroner aggregato): media dei rendimenti attesi da
 * crescita e valutazione delle azioni con stime, pesata per capitalizzazione come un indice.
 */
export function marketFundamentals(list, settings = {}) {
  let w = 0;
  let sum = 0;
  let sumG = 0;
  let n = 0;
  for (const f of list) {
    if (!(f?.marketCap > 0)) continue;
    const g = fundamentalsReturn(f, settings, 5);
    if (!g) continue;
    sum += f.marketCap * g.expected;
    sumG += f.marketCap * g.growth;
    w += f.marketCap;
    n++;
  }
  return n >= 20 && w > 0 ? { expected: sum / w, growth: sumG / w, n } : null;
}
