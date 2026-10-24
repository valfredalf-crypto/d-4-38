import test from 'node:test';
import assert from 'node:assert/strict';
import { simulate, netReturn, historicalMaxDrawdown, mulberry32, DEFAULT_OPTIONS, score } from '../public/js/montecarlo.js';

function gbmSeries(n, muAnnual, volAnnual, seed = 1) {
  const r = mulberry32(seed);
  const out = [100];
  for (let i = 1; i < n; i++) {
    const z = Math.sqrt(-2 * Math.log(r() || 1e-12)) * Math.cos(2 * Math.PI * r());
    out.push(out[i - 1] * Math.exp(muAnnual / 52 + (volAnnual / Math.sqrt(52)) * z));
  }
  return out;
}

test('drawdown storico', () => {
  assert.equal(historicalMaxDrawdown([100, 120, 60, 90, 130]), 0.5);
  assert.equal(historicalMaxDrawdown([1, 2, 3]), 0);
});

test('costi e tasse', () => {
  const o = { ...DEFAULT_OPTIONS, amount: 1000, orderCost: 1, spreadPct: 0, taxRate: 26 };
  // +100% lordo: 999*2 - 1 = 1997 → profitto 997 → netto 997*0.74
  assert.ok(Math.abs(netReturn(1, o) - (997 * 0.74) / 1000) < 1e-12);
  // in perdita non si pagano tasse
  assert.ok(Math.abs(netReturn(-0.5, o) - (999 * 0.5 - 1 - 1000) / 1000) < 1e-12);
});

test('simulazione: storico insufficiente', () => {
  const r = simulate(gbmSeries(50, 0.05, 0.2), { sims: 100 });
  assert.equal(r.ok, false);
});

test('simulazione: statistiche coerenti e riproducibili', () => {
  const prices = gbmSeries(520, 0.07, 0.18);
  const a = simulate(prices, { sims: 1500 });
  const b = simulate(prices, { sims: 1500 });
  assert.equal(a.ok, true);
  assert.deepEqual(a.netMedian, b.netMedian);
  assert.ok(a.netP5 <= a.netMedian && a.netMedian <= a.netP95);
  assert.ok(a.mddMedian <= a.mddP95 && a.mddP95 < 1);
  assert.equal(a.fan.length, 21);
  assert.equal(a.histogram.counts.reduce((s, x) => s + x, 0), 1500);
});

test('parametri prospettici: deriva e volatilità imposte', () => {
  const prices = gbmSeries(520, 0.3, 0.2, 7);
  for (const method of ['bootstrap', 'gbm']) {
    const r = simulate(prices, { sims: 4000, method, targetDrift: 0.05, targetVol: 0.15 });
    assert.ok(Math.abs(r.annualDrift - 0.05) < 1e-9);
    assert.ok(Math.abs(r.annualVol - 0.15) < 1e-9);
    // mediana del rendimento lordo a 5 anni ≈ exp(5·0.05) − 1 ≈ 28%
    assert.ok(Math.abs(r.grossMedian - (Math.exp(0.25) - 1)) < 0.06, `${method}: ${r.grossMedian}`);
  }
});

test('volatilità più alta → perdita massima maggiore', () => {
  const prices = gbmSeries(520, 0.08, 0.2, 3);
  const lo = simulate(prices, { sims: 2000, targetDrift: 0.06, targetVol: 0.1 });
  const hi = simulate(prices, { sims: 2000, targetDrift: 0.06, targetVol: 0.4 });
  assert.ok(hi.mddP95 > lo.mddP95);
  assert.ok(hi.ratio > lo.ratio);
});

test('rapporto con guadagno negativo = Infinity', () => {
  const s = score({ mddP95: 0.3, mddMedian: 0.2, netP5: -0.2, netMedian: -0.01, netMean: 0.02 }, {});
  assert.equal(s.ratio, Infinity);
  assert.ok(Math.abs(score({ mddP95: 0.3, netMedian: 0.6 }, {}).ratio - 0.5) < 1e-12);
});

test('probAtLeast: probabilità decrescenti con la soglia e coerenti con probLoss', () => {
  const prices = [];
  let p = 100;
  const rnd = mulberry32(7);
  for (let i = 0; i < 520; i++) prices.push((p *= Math.exp(0.002 + 0.03 * (rnd() - 0.5))));
  const s = simulate(prices, { sims: 500, seed: 1 });
  const v = s.probAtLeast;
  for (let i = 1; i < v.length; i++) assert.ok(v[i] <= v[i - 1]);
  assert.ok(Math.abs(s.probAtLeast[0] - (1 - s.probLoss)) < 1e-9);
});

test('ratioFinal: perdita finale nel 5% peggiore ÷ guadagno mediano', () => {
  const prices = [];
  let p = 100;
  const rnd = mulberry32(3);
  for (let i = 0; i < 520; i++) prices.push((p *= Math.exp(0.0015 + 0.06 * (rnd() - 0.5))));
  const s = simulate(prices, { sims: 800, seed: 2 });
  assert.ok(Math.abs(s.finalLoss - Math.max(0, -s.netP5)) < 1e-9);
  if (s.netMedian > 0) assert.ok(Math.abs(s.ratioFinal - s.finalLoss / s.netMedian) < 1e-9);
});
