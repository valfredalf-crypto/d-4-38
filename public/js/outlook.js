// Stima prospettica di rendimento atteso e volatilità per i prossimi anni.
// Combina lo storico con evidenze di mercato recenti invece di proiettare il passato tale e quale:
//  • equilibrio (CAPM): tasso privo di rischio + beta × premio per il rischio azionario
//  • consenso analisti: prezzo obiettivo a 12 mesi (scontato per il noto ottimismo) + dividendi,
//    applicato al solo primo anno e poi convergente all'equilibrio
//  • volatilità: media tra lungo periodo, regime recente (EWMA) e volatilità implicita delle opzioni
import { logReturns, WEEKS_PER_YEAR } from './montecarlo.js';

export const DEFAULT_OUTLOOK = {
  mode: 'forward',        // 'forward' (prospettico) | 'historical' (solo storico)
  riskFree: 2.0,          // % annuo, tasso privo di rischio in EUR
  equityPremium: 5.0,     // % annuo, premio per il rischio azionario globale
  cryptoPremium: 0.0,     // % annuo, premio aggiuntivo per le crypto (nessun fondamentale: prudenza)
  weightHistory: 0.3,
  weightEquilibrium: 0.4,
  weightAnalysts: 0.3,
  analystHaircut: 0.5,    // quota del rialzo implicito nei target che viene creduta
  priorUncertainty: 5.0,  // % annuo: incertezza sul rendimento di equilibrio (governa la credibilità dello storico)
  minAnalysts: 3,
  ewmaLambda: 0.97,       // decadimento settimanale per la volatilità recente
  betaYears: 5,
  minStockBeta: 0.5,      // beta minimo per le singole azioni (dopo l'aggiustamento di Blume)
};

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
  const sigmaLong = sdW * Math.sqrt(WEEKS_PER_YEAR);
  const histLog = muW * WEEKS_PER_YEAR;
  const histArith = Math.exp(histLog + sigmaLong ** 2 / 2) - 1;

  if (s.mode === 'historical') {
    return { mode: 'historical', drift: histLog, vol: sigmaLong, expected: histArith, components: { history: histArith }, weights: { history: 1 } };
  }

  // --- Volatilità prospettica
  const sigmaEwma = ewmaVol(rets, s.ewmaLambda);
  const f = p.fundamentals || {};
  const sigmaImpl = f.impliedVol > 0 ? f.impliedVol : null;
  const vol = sigmaImpl
    ? 0.4 * sigmaLong + 0.3 * sigmaEwma + 0.3 * sigmaImpl
    : 0.6 * sigmaLong + 0.4 * sigmaEwma;

  // --- Rendimento atteso di equilibrio
  const rf = s.riskFree / 100;
  const betaEst = estimateBeta(p.timestamps, p.prices, p.benchmark?.timestamps, p.benchmark?.closesEur, s.betaYears);
  // Beta grezzo: media tra la stima settimanale contro l'MSCI World in EUR e quella pubblicata da Yahoo
  // (5 anni, mensile); poi aggiustamento di Blume verso 1. Per le singole azioni minimo `minStockBeta`:
  // un beta vicino a zero (o negativo) di un'azienda quotata è quasi sempre un artefatto di un periodo
  // in cui il titolo si è mosso per motivi propri, non una vera assenza di rischio di mercato.
  const rawBetas = [betaEst?.raw, f.beta].filter((b) => b != null && Number.isFinite(b));
  const betaRaw = rawBetas.length ? rawBetas.reduce((a, b) => a + b, 0) / rawBetas.length : 1;
  let beta = 0.67 * betaRaw + 0.33;
  if (p.type === 'stock') beta = Math.max(beta, s.minStockBeta);
  const equilibrium = p.type === 'crypto' ? rf + s.cryptoPremium / 100 : rf + Math.max(beta, 0) * (s.equityPremium / 100);

  // --- Storico "credibile": shrinkage bayesiano (modello normale-normale) verso l'equilibrio.
  // La media storica ha errore standard σ/√T: con molta volatilità e pochi anni è quasi rumore,
  // quindi pesa poco (es. 10 anni: indice globale ~50%, azione volatile ~20%, crypto ~5%).
  const years = n / WEEKS_PER_YEAR;
  const precHist = years / (sigmaLong ** 2 || 1e-9);
  const precPrior = 1 / (s.priorUncertainty / 100) ** 2;
  const credibility = precHist / (precHist + precPrior);
  const historyShrunk = equilibrium + credibility * (histArith - equilibrium);

  // --- Consenso analisti (solo primo anno, poi equilibrio)
  let analysts = null;
  let analystUpside = null;
  if (f.targetMean > 0 && f.price > 0 && (f.analysts || 0) >= s.minAnalysts) {
    analystUpside = Math.max(-0.5, Math.min(0.5, f.targetMean / f.price - 1));
    const year1 = analystUpside * s.analystHaircut + (f.dividendYield || 0);
    analysts = (year1 + (p.years - 1) * equilibrium) / p.years;
  }

  const parts = [
    ['history', historyShrunk, s.weightHistory],
    ['equilibrium', equilibrium, s.weightEquilibrium],
    ['analysts', analysts, s.weightAnalysts],
  ].filter(([, v, w]) => v != null && Number.isFinite(v) && w > 0);
  const wSum = parts.reduce((a, [, , w]) => a + w, 0) || 1;
  const expected = parts.reduce((a, [, v, w]) => a + (v * w) / wSum, 0);
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
    components: { history: historyShrunk, equilibrium, analysts },
    weights: Object.fromEntries(parts.map(([k, , w]) => [k, w / wSum])),
  };
}
