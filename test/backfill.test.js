import test from 'node:test';
import assert from 'node:assert/strict';
import { backfillWithProxy } from '../public/js/backfill.js';
import { mulberry32, historicalMaxDrawdown } from '../public/js/montecarlo.js';
import { analyze, DEFAULT_SETTINGS } from '../public/js/analyze.js';

const WEEK = 7 * 86400;
function market() {
  // 10 anni di indice con un crollo del 35% a metà periodo
  const r = mulberry32(3);
  const ts = [];
  const p = [100];
  for (let i = 0; i < 521; i++) {
    ts.push(1_500_000_000 + i * WEEK);
    if (i) {
      const z = (r() - 0.5) * 0.04;
      const crash = i >= 200 && i < 210 ? -0.045 : 0;
      p.push(p[i - 1] * Math.exp(0.0012 + z + crash));
    }
  }
  return { timestamps: ts, closesEur: p };
}

test('backfill: ricostruisce gli anni mancanti con beta e include le crisi passate', () => {
  const m = market();
  // Strumento nato 3 anni fa (ultime 157 settimane), beta ≈ 0,8 sull'indice
  const r = mulberry32(9);
  const start = 521 - 157;
  const ts = m.timestamps.slice(start);
  const p = [50];
  for (let i = 1; i < ts.length; i++) {
    const rb = Math.log(m.closesEur[start + i] / m.closesEur[start + i - 1]);
    p.push(p[i - 1] * Math.exp(0.8 * rb + (r() - 0.5) * 0.01));
  }
  const h = { timestamps: ts, closesEur: p };
  const f = backfillWithProxy(h, m, { lookbackYears: 10, seedKey: 'X' });
  assert.ok(f);
  assert.ok(Math.abs(f.beta - 0.8) < 0.1, String(f.beta));
  assert.equal(f.closesEur.length, 521 - 1); // indice 521 punti → 520 rendimenti ricostruibili
  assert.deepEqual(f.closesEur.slice(-p.length), p); // i dati reali restano invariati
  assert.ok(historicalMaxDrawdown(f.closesEur) > historicalMaxDrawdown(p) + 0.1); // la crisi entra nel rischio
  // Nessun backfill se lo storico è già lungo
  assert.equal(backfillWithProxy(m, m, { lookbackYears: 10 }), null);

  // Nell'analisi completa: perdita massima prevista più alta con il backfill, rendimento solo dai dati reali
  const withB = analyze({ instrument: { symbol: 'X', type: 'etf' }, history: h, benchmark: m }, DEFAULT_SETTINGS);
  const noB = analyze({ instrument: { symbol: 'X', type: 'etf' }, history: h, benchmark: null }, DEFAULT_SETTINGS);
  assert.ok(withB.sim.mddP95 > noB.sim.mddP95, `${withB.sim.mddP95} vs ${noB.sim.mddP95}`);
  assert.ok(withB.sim.backfilledYears > 6);
  assert.ok(Math.abs(withB.forward.historyRaw - noB.forward.historyRaw) < 1e-12);
});

test('crypto giovane: storico ricostruito con Bitcoin', () => {
  const btc = market();
  const start = 521 - 157;
  const coin = { timestamps: btc.timestamps.slice(start), closesEur: btc.closesEur.slice(start).map((v, i) => v * (1 + 0.001 * (i % 3))) };
  const r = analyze({ instrument: { symbol: 'NEW-EUR', type: 'crypto' }, history: coin, benchmark: null, cryptoBenchmark: btc }, DEFAULT_SETTINGS);
  assert.ok(r.sim.backfilledYears > 6);
  assert.equal(r.sim.backfillProxy, 'Bitcoin');
  const self = analyze({ instrument: { symbol: 'BTC-EUR', type: 'crypto' }, history: coin, benchmark: null, cryptoBenchmark: btc }, DEFAULT_SETTINGS);
  assert.equal(self.sim.backfilledYears, 0); // Bitcoin non si ricostruisce con se stesso
});
