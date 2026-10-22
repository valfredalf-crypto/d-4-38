import test from 'node:test';
import assert from 'node:assert/strict';
import { forwardParams, estimateBeta, ewmaVol } from '../public/js/outlook.js';
import { mulberry32 } from '../public/js/montecarlo.js';

const WEEK = 7 * 86400;
function series(n, seed, scale = 1, base = null) {
  const r = mulberry32(seed);
  const ts = [];
  const p = [100];
  const rets = [];
  for (let i = 0; i < n; i++) {
    ts.push(1_500_000_000 + i * WEEK);
    if (i) {
      const z = (r() - 0.5) * 0.06;
      const x = base ? base[i - 1] * scale + z * 0.3 : z;
      rets.push(x);
      p.push(p[i - 1] * Math.exp(x));
    }
  }
  return { ts, p, rets };
}

test('beta: serie = 1.5 × benchmark + rumore', () => {
  const b = series(400, 1);
  const a = series(400, 2, 1.5, b.rets);
  const beta = estimateBeta(a.ts, a.p, b.ts, b.p, 5);
  assert.ok(Math.abs(beta.raw - 1.5) < 0.1, String(beta.raw));
  assert.ok(Math.abs(beta.adjusted - (0.67 * beta.raw + 0.33)) < 1e-12);
});

test('EWMA reagisce al regime recente', () => {
  const calm = Array.from({ length: 300 }, (_, i) => (i % 2 ? 0.01 : -0.01));
  const stormy = [...calm, ...Array.from({ length: 30 }, (_, i) => (i % 2 ? 0.06 : -0.06))];
  assert.ok(ewmaVol(stormy, 0.97) > ewmaVol(calm, 0.97) * 2);
});

test('modello prospettico: pesi, analisti e coerenza log/aritmetico', () => {
  const b = series(520, 1);
  const a = series(520, 2, 1.0, b.rets);
  const base = { type: 'stock', timestamps: a.ts, prices: a.p, benchmark: { timestamps: b.ts, closesEur: b.p }, years: 5, lookbackYears: 10 };
  const noAnalysts = forwardParams(base, {});
  assert.equal(noAnalysts.components.analysts, null);
  assert.ok(Math.abs(noAnalysts.weights.history + noAnalysts.weights.equilibrium - 1) < 1e-12);
  assert.ok(Math.abs(Math.log(1 + noAnalysts.expected) - noAnalysts.vol ** 2 / 2 - noAnalysts.drift) < 1e-12);

  const bullish = forwardParams({ ...base, fundamentals: { price: 100, targetMean: 130, analysts: 20, dividendYield: 0.02 } }, {});
  const bearish = forwardParams({ ...base, fundamentals: { price: 100, targetMean: 80, analysts: 20 } }, {});
  assert.ok(bullish.expected > bearish.expected);
  // year1 = 30%×0.5 + 2% = 17%, poi equilibrio per 4 anni
  const eq = bullish.components.equilibrium;
  assert.ok(Math.abs(bullish.components.analysts - (0.17 + 4 * eq) / 5) < 1e-12);
  // pochi analisti → ignorati
  const few = forwardParams({ ...base, fundamentals: { price: 100, targetMean: 200, analysts: 1 } }, {});
  assert.equal(few.components.analysts, null);
});

test('crypto: equilibrio = risk-free + premio crypto', () => {
  const a = series(300, 5);
  const f = forwardParams({ type: 'crypto', timestamps: a.ts, prices: a.p, years: 5, lookbackYears: 10 }, { riskFree: 2, cryptoPremium: 3 });
  assert.ok(Math.abs(f.components.equilibrium - 0.05) < 1e-12);
});

test('modalità solo storico', () => {
  const a = series(300, 5);
  const f = forwardParams({ type: 'etf', timestamps: a.ts, prices: a.p, years: 5, lookbackYears: 10 }, { mode: 'historical' });
  assert.equal(f.mode, 'historical');
  assert.deepEqual(Object.keys(f.components), ['history']);
});

test('shrinkage: lo storico di uno strumento molto volatile pesa poco', () => {
  const mk = (vol, drift) => {
    const ts = [];
    const p = [100];
    for (let i = 0; i < 521; i++) {
      ts.push(1_500_000_000 + i * WEEK);
      if (i) p.push(p[i - 1] * Math.exp(drift / 52 + (i % 2 ? 1 : -1) * vol / Math.sqrt(52)));
    }
    return { ts, p };
  };
  const calm = mk(0.15, 0.08);
  const wild = mk(0.8, 0.8);
  const fc = forwardParams({ type: 'etf', timestamps: calm.ts, prices: calm.p, years: 5, lookbackYears: 10 }, {});
  const fw = forwardParams({ type: 'crypto', timestamps: wild.ts, prices: wild.p, years: 5, lookbackYears: 10 }, {});
  assert.ok(fc.credibility > 0.4 && fc.credibility < 0.6, String(fc.credibility));
  assert.ok(fw.credibility < 0.06, String(fw.credibility));
  assert.ok(fw.components.history < fw.historyRaw);
  const eq = fw.components.equilibrium;
  assert.ok(Math.abs(fw.components.history - (eq + fw.credibility * (fw.historyRaw - eq))) < 1e-12);
});
