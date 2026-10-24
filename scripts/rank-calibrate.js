// Quale indicatore ordina meglio gli strumenti per il rendimento netto REALE dei 5 anni successivi?
// Per ogni strumento con storico sufficiente si prevede con i soli dati disponibili 5 e 7 anni fa e si
// confronta la classifica prodotta da ciascun indicatore candidato con i rendimenti poi realizzati
// (correlazione dei ranghi di Spearman, e rendimento reale medio del decile migliore/peggiore).
// Scelta sul 70% degli strumenti (taratura), confermata sul 30% mai visto (verifica).
// Uso: node scripts/rank-calibrate.js   (eseguito da .github/workflows/rank-calibrate.yml)
import fs from 'node:fs';
import { listInstruments } from '../lib/store.js';
import { historyEur } from '../lib/market.js';
import { backtestOne, spearman } from '../public/js/backtest.js';
import { BENCHMARK_SYMBOL, CRYPTO_BENCHMARK_SYMBOL, DEFAULT_SETTINGS } from '../public/js/analyze.js';
import { hashString } from '../public/js/montecarlo.js';
import { hasImplausibleJumps } from '../lib/universe.js';

const SIMS = Number(process.env.RANK_SIMS || 500);
const ORIGINS = [260, 364]; // 5 e 7 anni fa
const log = (...a) => console.log(...a);

// Indicatori candidati: funzione delle previsioni fatte a T0 → punteggio (più alto = strumento preferito)
const CANDIDATES = {
  'media (guadagno medio)': (p) => p.netMean,
  'mediana': (p) => p.netMedian,
  'guadagno probabile 75%': (p) => p.netP25,
  'Kelly (γ=1)': (p) => p.ce?.[1],
  'equivalente certo γ=0,5': (p) => p.ce?.[0.5],
  'equivalente certo γ=1,5': (p) => p.ce?.[1.5],
  'equivalente certo γ=2': (p) => p.ce?.[2],
  'prudente (γ=3)': (p) => p.ce?.[3],
  'guadagno bilanciato': (p) => p.balanced,
  'P(≥ +50%)': (p) => p.p50,
  'P(≥ +25%)': (p) => p.p25q,
  'media × P(non perdere)': (p) => p.netMean * (1 - p.probLoss),
  'media × √P(≥ +50%)': (p) => p.netMean * Math.sqrt(p.p50 ?? 0),
  'media − perdita 5% peggiore': (p) => p.netMean - Math.max(0, -p.netP5),
  'rendimento atteso annuo': (p) => p.expected,
  'media / volatilità': (p) => p.netMean / Math.max(p.vol, 0.02),
  'rapporto perdita/guadagno (inverso)': (p) => (p.ratio > 0 && Number.isFinite(p.ratio) ? -p.ratio : -1e9),
};

const all = listInstruments();
const benchmark = await historyEur(BENCHMARK_SYMBOL);
const cryptoBenchmark = await historyEur(CRYPTO_BENCHMARK_SYMBOL).catch(() => null);
const pool = [];
let i = 0;
await Promise.all(
  Array.from({ length: 4 }, async () => {
    while (i < all.length) {
      const inst = all[i++];
      const history = await historyEur(inst.symbol).catch(() => null);
      if (!history || history.closesEur.length < 52 * 7 + 1) continue;
      if (inst.type !== 'crypto' && hasImplausibleJumps(history.closesEur)) continue;
      pool.push({ instrument: inst, history, benchmark, cryptoBenchmark });
    }
  }),
);
const isValidation = (it) => hashString(it.instrument.symbol + ':val') % 10 < 3;
log(`Strumenti con almeno 7 anni di storico: ${pool.length}`);

// Previsioni a T0 (5 e 7 anni fa) e risultato reale
const rows = [];
const t0 = Date.now();
for (const it of pool) {
  for (const originWeeksAgo of ORIGINS) {
    try {
      const r = backtestOne(it, DEFAULT_SETTINGS, 'forward', { originWeeksAgo, sims: SIMS });
      if (r) rows.push({ ...r, val: isValidation(it) });
    } catch {
      /* saltato */
    }
  }
}
log(`${rows.length} previsioni (${Math.round((Date.now() - t0) / 1000)} s)`);

function evaluate(list, fn) {
  const ok = list.filter((r) => Number.isFinite(fn(r.pred)));
  if (ok.length < 30) return null;
  const xs = ok.map((r) => fn(r.pred));
  const ys = ok.map((r) => r.real.net);
  const sorted = ok.map((r, k) => [xs[k], r.real.net]).sort((a, b) => b[0] - a[0]);
  const dec = Math.max(1, Math.floor(sorted.length / 10));
  const avg = (a) => a.reduce((s, x) => s + x[1], 0) / a.length;
  const med = (a) => { const v = a.map((x) => x[1]).sort((p, q) => p - q); return v[Math.floor(v.length / 2)]; };
  return {
    n: ok.length,
    rankCorr: spearman(xs, ys),
    topDecileReal: avg(sorted.slice(0, dec)), // rendimento reale medio del 10% preferito dall'indicatore
    topDecileMedian: med(sorted.slice(0, dec)),
    bottomDecileReal: avg(sorted.slice(-dec)),
    topDecileLossShare: sorted.slice(0, dec).filter((x) => x[1] < 0).length / dec,
  };
}

const groups = { tutti: (r) => true, azioni: (r) => r.type === 'stock', etf: (r) => r.type === 'etf' };
const report = { generatedAt: new Date().toISOString(), rows: rows.length, origins: ORIGINS, sims: SIMS, results: {} };
const r4 = (x) => (x == null ? null : Math.round(x * 1e4) / 1e4);
for (const [gname, gf] of Object.entries(groups)) {
  const train = rows.filter((r) => gf(r) && !r.val);
  const valid = rows.filter((r) => gf(r) && r.val);
  log(`\n=== ${gname}: taratura ${train.length}, verifica ${valid.length}`);
  log('indicatore | corr. ranghi (taratura) | corr. (verifica) | reale medio 10% migliore | mediana 10% migliore | % in perdita nel 10% migliore | reale medio 10% peggiore');
  const out = [];
  for (const [name, fn] of Object.entries(CANDIDATES)) {
    const a = evaluate(train, fn);
    const b = evaluate(valid, fn);
    if (!a || !b) continue;
    out.push({ name, train: a, valid: b });
    log(`${name} | ${a.rankCorr?.toFixed(3)} | ${b.rankCorr?.toFixed(3)} | ${(a.topDecileReal * 100).toFixed(0)}% | ${(a.topDecileMedian * 100).toFixed(0)}% | ${(a.topDecileLossShare * 100).toFixed(0)}% | ${(a.bottomDecileReal * 100).toFixed(0)}%`);
  }
  out.sort((x, y) => y.train.rankCorr - x.train.rankCorr);
  log(`→ migliore in taratura: ${out[0].name} (verifica ${out[0].valid.rankCorr.toFixed(3)})`);
  report.results[gname] = out.map((o) => ({ name: o.name, train: Object.fromEntries(Object.entries(o.train).map(([k, v]) => [k, r4(v)])), valid: Object.fromEntries(Object.entries(o.valid).map(([k, v]) => [k, r4(v)])) }));
}
// --- Indicatore complessivo: taratura dei pesi delle penalità sul rendimento reale.
// complessivo = equivalente certo(γ) − wLoss × perdita attesa − wDD × max(0, perdita max − 40%)
//               − wAsym × max(0, perdita finale sfavorevole − guadagno tipico)
// (concentrazione e dividendo non sono testabili sul passato: restano regole fisse)
const GRID = { gamma: [0, 0.5, 1], wLoss: [0, 0.5, 1, 1.5, 2], wDD: [0, 0.25, 0.5, 1], wAsym: [0, 0.5, 1] };
const composite = (w) => (p) => {
  const base = w.gamma === 0 ? p.netMean : p.ce?.[w.gamma];
  if (base == null || p.expLoss == null) return NaN;
  return base - w.wLoss * p.expLoss - w.wDD * Math.max(0, p.mddP95 - 0.4) - w.wAsym * Math.max(0, Math.max(0, -p.netP5) - Math.max(p.netMedian, 0));
};
const combos = [];
for (const gamma of GRID.gamma) for (const wLoss of GRID.wLoss) for (const wDD of GRID.wDD) for (const wAsym of GRID.wAsym) combos.push({ gamma, wLoss, wDD, wAsym });
report.composite = {};
for (const [gname, gf] of Object.entries(groups)) {
  const train = rows.filter((r) => gf(r) && !r.val);
  const valid = rows.filter((r) => gf(r) && r.val);
  const scored = combos
    .map((w) => ({ w, train: evaluate(train, composite(w)), valid: evaluate(valid, composite(w)) }))
    .filter((x) => x.train && x.valid)
    // obiettivo: ordinare bene (correlazione) E non mettere perdenti in cima (quota in perdita del decile migliore)
    .sort((a, b) => b.train.rankCorr - 0.5 * b.train.topDecileLossShare - (a.train.rankCorr - 0.5 * a.train.topDecileLossShare));
  log(`\n=== COMPLESSIVO ${gname}: migliori 8 combinazioni (taratura → verifica)`);
  for (const x of scored.slice(0, 8)) log(`γ=${x.w.gamma} wLoss=${x.w.wLoss} wDD=${x.w.wDD} wAsym=${x.w.wAsym} | corr ${x.train.rankCorr.toFixed(3)} → ${x.valid.rankCorr.toFixed(3)} | 10% migliore reale ${(x.valid.topDecileReal * 100).toFixed(0)}% mediana ${(x.valid.topDecileMedian * 100).toFixed(0)}% in perdita ${(x.valid.topDecileLossShare * 100).toFixed(0)}%`);
  const base = { w: { gamma: 0.5, wLoss: 0, wDD: 0, wAsym: 0 } };
  const b = evaluate(valid, composite(base.w));
  log(`riferimento solo efficiente γ=0,5: verifica corr ${b.rankCorr.toFixed(3)} | 10% migliore reale ${(b.topDecileReal * 100).toFixed(0)}% in perdita ${(b.topDecileLossShare * 100).toFixed(0)}%`);
  report.composite[gname] = scored.slice(0, 8).map((x) => ({ w: x.w, train: Object.fromEntries(Object.entries(x.train).map(([k, v]) => [k, r4(v)])), valid: Object.fromEntries(Object.entries(x.valid).map(([k, v]) => [k, r4(v)])) }));
}
fs.mkdirSync('data', { recursive: true });
fs.writeFileSync('data/rank-calibration.json', JSON.stringify(report, null, 1));
