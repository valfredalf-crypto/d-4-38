// Sezione «Qualità»: strumenti con qualità della crescita, asimmetria del rischio e rendimento atteso migliori a 1, 3 e 5 anni.
// Tre voti da 0 a 1, stesso peso; il punteggio (0–100) è la loro media.
//   crescita   = crescita degli utili attesa × (½ + ½ × quota confermata dalle evidenze); 15% l'anno = voto pieno
//   asimmetria = media sui tre periodi di 1 ÷ (1 + perdita nel 5% peggiore ÷ guadagno tipico): 0 → 1, 1 → ½, ∞ → 0
//   rendimento = media sui tre periodi del rendimento atteso annualizzato; 15% l'anno = voto pieno
// Entra nella sezione solo chi supera i controlli della scheda: crescita degli utili di almeno il 2% senza «value trap»,
// guadagno tipico positivo (asimmetria non infinita) e rendimento atteso positivo a 1, 3 e 5 anni.
export const Q = { minGrowth: 0.02, trapYield: 0.06, trapGrowth: 0.03, fullGrowth: 0.15, fullReturn: 0.15, evidenceDefault: 0.5 };

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;

/** Stesso controllo della scheda («Qualità della crescita»): dividendo alto senza crescita = possibile value trap. */
export function growthQuality({ growth, evidence = null, dividendYield = 0 } = {}) {
  if (!Number.isFinite(growth)) return null;
  const y = Number.isFinite(dividendYield) ? dividendYield : 0;
  const trap = y > Q.trapYield && growth < Q.trapGrowth;
  const ev = Number.isFinite(evidence) ? clamp01(evidence) : null;
  return { growth, evidence: ev, trap, ok: !trap && growth >= Q.minGrowth, value: growth * (0.5 + 0.5 * (ev ?? Q.evidenceDefault)) };
}

/** Rendimento annuo equivalente a un rendimento totale su `years` anni. */
export const annualized = (total, years) => (Number.isFinite(total) && years > 0 ? (total > -1 ? (1 + total) ** (1 / years) - 1 : -1) : null);

/**
 * @param asym [a1, a3, a5] asimmetria del rischio per periodo (Infinity se il guadagno tipico non è positivo)
 * @param ret  [[totale, anni], …] rendimento atteso del periodo e sua durata, nello stesso ordine
 */
export function qualityScore({ growth, evidence = null, dividendYield = 0, asym, ret } = {}) {
  const quality = growthQuality({ growth, evidence, dividendYield });
  if (!quality) return null;
  if (!Array.isArray(asym) || !Array.isArray(ret) || !asym.length || asym.length !== ret.length) return null;
  if (asym.some((a) => a == null || Number.isNaN(a)) || ret.some((x) => !Array.isArray(x) || !Number.isFinite(x[0]) || !(x[1] > 0))) return null;
  const ann = ret.map(([t, y]) => annualized(t, y));
  const sq = clamp01(quality.value / Q.fullGrowth);
  const sa = mean(asym.map((a) => (Number.isFinite(a) ? 1 / (1 + Math.max(0, a)) : 0)));
  const sr = mean(ann.map((x) => clamp01(x / Q.fullReturn)));
  const pass = quality.ok && asym.every((a) => Number.isFinite(a)) && ret.every(([t]) => t > 0);
  return { score: (100 * (sq + sa + sr)) / 3, sq, sa, sr, pass, quality, ann };
}
