import test from 'node:test';
import assert from 'node:assert/strict';
import { priceRange, rangeFields, distanceFrom, RANGE_WINDOWS } from '../public/js/range.js';
import { performanceFrom } from '../lib/market.js';

const NOW = Date.UTC(2026, 10, 27, 10);
const DAY = 86400;
// 400 sedute giornaliere: prezzo che sale da 30 a 40 con un minimo a 28 circa 60 giorni fa e uno a 25 circa 300 giorni fa
function series() {
  const ts = [];
  const cl = [];
  for (let k = 400; k >= 1; k--) {
    ts.push(NOW / 1000 - k * DAY);
    let v = 30 + (10 * (400 - k)) / 400;
    if (k === 60) v = 28;
    if (k === 300) v = 25;
    if (k === 390) v = 10; // fuori dalle 52 settimane: non deve contare
    cl.push(v);
  }
  return { ts, cl };
}

test('prezzo medio e minimo a 52 settimane e a 90 giorni: finestra giusta, prezzo attuale compreso', () => {
  const { ts, cl } = series();
  const y = priceRange(ts, cl, 40.5, NOW, 365);
  const q = priceRange(ts, cl, 40.5, NOW, 90);
  assert.equal(y.min, 25);
  assert.equal(q.min, 28);
  assert.equal(y.n, 365 + 1); // 365 chiusure nella finestra + il prezzo attuale
  assert.equal(q.n, 90 + 1);
  // media calcolata a mano sulle stesse chiusure
  const inWin = (d) => cl.filter((_, i) => ts[i] >= NOW / 1000 - d * DAY);
  const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  assert.ok(Math.abs(y.avg - mean([...inWin(365), 40.5])) < 1e-9);
  assert.ok(Math.abs(q.avg - mean([...inWin(90), 40.5])) < 1e-9);
  assert.ok(q.avg > y.avg, 'prezzo in salita: la media a 90 giorni è più alta di quella a 52 settimane');
  assert.ok(y.min <= y.avg && q.min <= q.avg);
  // il prezzo attuale può essere il nuovo minimo
  assert.equal(priceRange(ts, cl, 20, NOW, 90).min, 20);
});

test('poche sedute nella finestra: nessun valore', () => {
  const ts = [];
  const cl = [];
  for (let k = 20; k >= 1; k--) { ts.push(NOW / 1000 - k * DAY); cl.push(50 + k); }
  assert.equal(priceRange(ts, cl, 50, NOW, 90), null);
  assert.equal(priceRange(ts, cl, 50, NOW, 365), null);
  assert.deepEqual(rangeFields(ts, cl, 50, NOW), {});
  assert.deepEqual(RANGE_WINDOWS, { 365: 120, 90: 30 });
});

test('campi pubblicati con le quotazioni e distanza del prezzo attuale', () => {
  const { ts, cl } = series();
  const f = rangeFields(ts, cl, 40.5, NOW);
  assert.deepEqual(Object.keys(f), ['a52', 'l52', 'a90', 'l90']);
  assert.equal(f.l52, 25);
  assert.equal(f.l90, 28);
  assert.ok(f.a52 > 30 && f.a52 < 40 && f.a90 > f.a52);
  assert.ok(Math.abs(distanceFrom(40.5, f.l52) - 0.62) < 1e-9);
  assert.equal(distanceFrom(40.5, null), null);
  assert.equal(distanceFrom(0, 30), null);
  // dentro le variazioni storiche calcolate dalla pipeline
  const perf = performanceFrom({ timestamps: ts, closesEur: cl }, 40.5, NOW);
  assert.equal(perf.l52, 25);
  assert.equal(perf.l90, 28);
  assert.equal(perf.a52, f.a52);
  assert.equal(perf.a90, f.a90);
});
