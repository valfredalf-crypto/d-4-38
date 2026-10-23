import test from 'node:test';
import assert from 'node:assert/strict';
import { spearman, runBacktest, rowLoss, backtestOne } from '../public/js/backtest.js';
import { mulberry32, DEFAULT_OPTIONS } from '../public/js/montecarlo.js';
import { DEFAULT_OUTLOOK } from '../public/js/outlook.js';

const WEEK = 7 * 86400;
function gbm(n, mu, vol, seed) {
  const r = mulberry32(seed);
  const p = [100];
  const ts = [1_400_000_000];
  for (let i = 1; i < n; i++) {
    const z = Math.sqrt(-2 * Math.log(r() || 1e-12)) * Math.cos(2 * Math.PI * r());
    p.push(p[i - 1] * Math.exp((mu - vol * vol / 2) / 52 + (vol / Math.sqrt(52)) * z));
    ts.push(ts[i - 1] + WEEK);
  }
  return { timestamps: ts, closesEur: p };
}
const { targetDrift, targetVol, seed, ...mc } = DEFAULT_OPTIONS;
const settings = { mc: { ...mc, cryptoSpreadPct: 0 }, outlook: { ...DEFAULT_OUTLOOK } };

test('spearman', () => {
  assert.equal(spearman([1, 2, 3, 4], [10, 20, 30, 40]), 1);
  assert.equal(spearman([1, 2, 3, 4], [4, 3, 2, 1]), -1);
  assert.equal(spearman([1, 2], [1, 2]), null);
});

test('backtest: nessuna informazione dopo T0 entra nella previsione', () => {
  const h = gbm(521, 0.07, 0.2, 1);
  const a = backtestOne({ instrument: { symbol: 'X', type: 'etf' }, history: h }, settings, 'historical', { sims: 200 });
  // Stesso passato, futuro diverso (crollo): la previsione non deve cambiare, l'esito sì.
  const h2 = { ...h, closesEur: h.closesEur.map((v, i) => (i > 260 ? v * 0.3 : v)) };
  const b = backtestOne({ instrument: { symbol: 'X', type: 'etf' }, history: h2 }, settings, 'historical', { sims: 200 });
  assert.deepEqual(a.pred, b.pred);
  assert.ok(b.real.net < a.real.net && b.real.mdd > a.real.mdd);
});

test('backtest su dati sintetici: modello ben tarato vicino ai valori ideali', () => {
  const items = Array.from({ length: 150 }, (_, k) => ({ instrument: { symbol: `S${k}`, type: 'etf' }, history: gbm(521, 0.04 + (k % 5) * 0.02, 0.12 + (k % 7) * 0.04, 100 + k) }));
  const s = runBacktest(items, { ...settings, mc: { ...settings.mc, sims: 300 } }).modes.historical.summary;
  assert.equal(s.n, 150);
  assert.ok(s.returns.inside90 > 0.7 && s.returns.inside90 < 0.99, `forchetta ${s.returns.inside90}`);
  assert.ok(s.risk.mddAboveP95 < 0.2, `perdite ${s.risk.mddAboveP95}`);
  assert.ok(s.risk.volRankCorr > 0.8, `volatilità ${s.risk.volRankCorr}`); // la volatilità è persistente
});

test('punteggio: previsione centrata < previsione sbagliata', () => {
  const real = { net: 0.2, mdd: 0.3 };
  const good = { real, pred: { netP5: -0.2, netP25: 0.05, netMedian: 0.2, netP75: 0.35, netP95: 0.6, mddMedian: 0.3, mddP95: 0.5 } };
  const bad = { real, pred: { netP5: 0.6, netP25: 0.8, netMedian: 1.0, netP75: 1.2, netP95: 1.5, mddMedian: 0.05, mddP95: 0.1 } };
  assert.ok(rowLoss(good) < rowLoss(bad));
});
