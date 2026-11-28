// Guadagno bilanciato crescita/rischio e guadagno corretto per il rischio a 1 e 3 anni.
// Stesse definizioni della scheda dello strumento a 5 anni (montecarlo.js), applicate alla distribuzione del modello delle
// previsioni (lo stesso del «netto più probabile»): 1 + rendimento lordo lognormale, imposta solo sui guadagni, costi degli ordini.
//   guadagno bilanciato = guadagni attesi (oltre il 75° percentile pesano sempre meno) − 2,25 × perdite attese
//   guadagno corretto per il rischio = guadagno tipico (mediano) − perdita finale nel caso sfavorevole (5° percentile)
import { LOSS_AVERSION, credibleGain } from './montecarlo.js';
import { normCdf } from './projection.js';

/** Quantile della normale standard (algoritmo di Acklam, errore relativo < 1,2e-9). */
export function normInv(p) {
  if (!(p > 0 && p < 1)) return p === 0 ? -Infinity : p === 1 ? Infinity : NaN;
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const lo = 0.02425;
  if (p < lo) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - lo) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  const q = p - 0.5;
  const r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/** Scenari equiprobabili usati per le medie (punti medi dei quantili: deterministico, niente estrazioni casuali). */
export const RG_POINTS = 400;
const Z = Array.from({ length: RG_POINTS }, (_, k) => normInv((k + 0.5) / RG_POINTS));
const Z05 = normInv(0.05);
const Z75 = normInv(0.75);

/**
 * @param lnMean media del logaritmo di (1 + rendimento lordo del periodo)
 * @param sigma  volatilità del periodo (σ annua × √anni)
 * @param tax    aliquota sulle plusvalenze (frazione): si paga solo se lo scenario chiude in guadagno
 * @param costs  costi degli ordini in frazione del capitale
 * Restituisce frazioni del capitale; null senza volatilità (non c'è una distribuzione).
 */
export function riskGain({ lnMean, sigma, tax = 0.26, costs = 0 } = {}) {
  if (!Number.isFinite(lnMean) || !(sigma > 0)) return null;
  const t = Number.isFinite(tax) ? tax : 0.26;
  const c = Number.isFinite(costs) ? costs : 0;
  const net = (z) => {
    const g = Math.exp(lnMean + z * sigma) - 1;
    return Math.max(-1, g - (g > 0 ? g * t : 0) - c); // non si può perdere più del capitale
  };
  const p75 = net(Z75);
  const median = net(0);
  const finalLoss = Math.max(0, -net(Z05));
  let eg = 0;
  let el = 0;
  for (const z of Z) {
    const x = net(z);
    eg += credibleGain(x, p75);
    if (x < 0) el -= x;
  }
  const expGain = eg / RG_POINTS;
  const expLoss = el / RG_POINTS;
  return { expGain, expLoss, balanced: expGain - LOSS_AVERSION * expLoss, median, finalLoss, riskAdj: median - finalLoss };
}

/**
 * Probabilità che il rendimento netto del periodo sia almeno `threshold` (frazione: 0 = almeno pari, 0.25 = almeno +25%),
 * sulla stessa distribuzione di riskGain. Il netto cresce con il lordo, quindi basta il lordo che dà quel netto:
 * netto = lordo − imposta (solo sui guadagni) − costi.
 */
export function probNetAtLeast({ lnMean, sigma, tax = 0.26, costs = 0 } = {}, threshold = 0) {
  if (!Number.isFinite(lnMean) || !(sigma > 0) || !Number.isFinite(threshold)) return null;
  const t = Number.isFinite(tax) ? tax : 0.26;
  const y = threshold + (Number.isFinite(costs) ? costs : 0);
  const gross = y > 0 ? y / (1 - t) : y;
  if (gross <= -1) return 1; // non si può perdere più del capitale
  return 1 - normCdf((Math.log(1 + gross) - lnMean) / sigma);
}

/** Rendimento netto al percentile `p` (0,05 = caso sfavorevole, 0,5 = mediano) della stessa distribuzione. */
export function netQuantile({ lnMean, sigma, tax = 0.26, costs = 0 } = {}, p = 0.5) {
  if (!Number.isFinite(lnMean) || !(sigma > 0) || !(p > 0 && p < 1)) return null;
  const t = Number.isFinite(tax) ? tax : 0.26;
  const g = Math.exp(lnMean + normInv(p) * sigma) - 1;
  return Math.max(-1, g - (g > 0 ? g * t : 0) - (Number.isFinite(costs) ? costs : 0));
}
