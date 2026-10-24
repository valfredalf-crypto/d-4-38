// Storico ricostruito con un indice di riferimento ("backfill con proxy") per gli strumenti con
// pochi anni di dati: per le settimane mancanti il rendimento è β × rendimento dell'MSCI World
// + una variabilità specifica estratta dai residui reali dello strumento. Serve SOLO per stimare
// rischio e perdite (così le simulazioni includono crisi come 2020 e 2022 anche per strumenti nati
// dopo); il rendimento atteso usa esclusivamente i dati reali.
import { logReturns, mulberry32, hashString, WEEKS_PER_YEAR } from './montecarlo.js';
import { weekKey } from './outlook.js';

export function backfillWithProxy(history, benchmark, { lookbackYears = 10, seedKey = '', minOverlapWeeks = 52 } = {}) {
  const ts = history?.timestamps || [];
  const prices = history?.closesEur || [];
  const target = Math.round(lookbackYears * WEEKS_PER_YEAR) + 1;
  if (!ts.length || prices.length >= target || !benchmark?.timestamps?.length) return null;

  // Rendimenti settimanali appaiati (strumento, indice) nel periodo comune
  const bIndex = new Map(benchmark.timestamps.map((t, i) => [weekKey(t), i]));
  const pairs = [];
  for (let i = 1; i < ts.length; i++) {
    const a = bIndex.get(weekKey(ts[i - 1]));
    const b = bIndex.get(weekKey(ts[i]));
    if (a == null || b == null || b !== a + 1) continue;
    const ri = Math.log(prices[i] / prices[i - 1]);
    const rb = Math.log(benchmark.closesEur[b] / benchmark.closesEur[a]);
    if (Number.isFinite(ri) && Number.isFinite(rb)) pairs.push([ri, rb]);
  }
  if (pairs.length < minOverlapWeeks) return null;
  const mi = pairs.reduce((s, p) => s + p[0], 0) / pairs.length;
  const mb = pairs.reduce((s, p) => s + p[1], 0) / pairs.length;
  let cov = 0;
  let varB = 0;
  for (const [ri, rb] of pairs) {
    cov += (ri - mi) * (rb - mb);
    varB += (rb - mb) ** 2;
  }
  if (!(varB > 0)) return null;
  const beta = cov / varB;
  const residuals = pairs.map(([ri, rb]) => ri - mi - beta * (rb - mb));

  // Settimane dell'indice precedenti al primo dato reale, a ritroso
  const firstWeek = weekKey(ts[0]);
  const before = [];
  for (let i = 0; i < benchmark.timestamps.length; i++) if (weekKey(benchmark.timestamps[i]) < firstWeek) before.push(i);
  const missing = Math.min(target - prices.length, before.length - 1);
  if (missing < 1) return null;
  const rand = mulberry32(hashString(`backfill:${seedKey}`));
  const outTs = [];
  const outP = [];
  let p = prices[0];
  for (let k = 0; k < missing; k++) {
    const i = before[before.length - 1 - k];
    const rb = Math.log(benchmark.closesEur[i + 1] / benchmark.closesEur[i]);
    const r = mi + beta * (rb - mb) + residuals[Math.floor(rand() * residuals.length)];
    p = p / Math.exp(r);
    outTs.push(benchmark.timestamps[i]);
    outP.push(p);
  }
  outTs.reverse();
  outP.reverse();
  return {
    timestamps: [...outTs, ...ts],
    closesEur: [...outP, ...prices],
    backfilledWeeks: missing,
    beta,
    residualVol: Math.sqrt(residuals.reduce((s, x) => s + x * x, 0) / residuals.length) * Math.sqrt(WEEKS_PER_YEAR),
  };
}
