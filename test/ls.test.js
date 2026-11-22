import test from 'node:test';
import assert from 'node:assert/strict';
import { compareSeries, isLsSymbol, lsSymbol } from '../lib/ls.js';
import { lsTotalReturn } from '../lib/snapshot.js';

const WEEK = 7 * 86400;
// Serie settimanale tipo Yahoo (domenica 23:00 UTC = lunedì 00:00 CET) e tipo LS (lunedì 00:00 UTC)
const t0 = Date.UTC(2024, 0, 7, 23) / 1000; // domenica 7/1/2024 23:00 UTC
function series(n, f, offset = 0) {
  const timestamps = [];
  const closesEur = [];
  for (let k = 0; k < n; k++) {
    timestamps.push(t0 + offset + k * WEEK);
    closesEur.push(f(k));
  }
  return { timestamps, closesEur };
}
const wave = (k) => 100 * Math.exp(0.002 * k + 0.04 * Math.sin(k * 1.7) + 0.03 * Math.cos(k * 0.9));

test('LS: simboli', () => {
  assert.equal(lsSymbol(44039), 'LS:44039');
  assert.ok(isLsSymbol('LS:44039'));
  assert.ok(!isLsSymbol('EUNL.DE'));
  assert.ok(!isLsSymbol('LS:abc'));
});

test('LS: stessa quotazione → ok', () => {
  const a = series(104, wave);
  const ls = series(104, (k) => wave(k) * 1.003, 3600);
  const c = compareSeries(a, ls);
  assert.equal(c.ok, true);
  assert.ok(c.corr > 0.99);
  assert.ok(Math.abs(c.level - 1.003) < 1e-3);
});

test('LS: livello diverso (>5%) → da sostituire', () => {
  const a = series(104, wave);
  const ls = series(104, (k) => wave(k) * 1.3, 3600);
  assert.equal(compareSeries(a, ls).ok, false);
});

test('LS: andamento scorrelato (borsa illiquida) → da sostituire', () => {
  const a = series(104, wave);
  const ls = series(104, (k) => 100 * Math.exp(0.05 * Math.sin(k * 2.9 + 1) + 0.04 * Math.cos(k * 0.37)), 3600);
  const c = compareSeries(a, ls);
  assert.equal(c.ok, false);
  assert.ok(c.corr < 0.8);
});

test('LS: storico troppo corto → nessun giudizio', () => {
  assert.equal(compareSeries(series(5, wave), series(5, wave, 3600)).ok, null);
});

test('LS: rendimento totale con dividendo solo per i simboli LS', () => {
  const h = series(53, () => 100);
  const f = { dividendYield: 0.04 };
  const adj = lsTotalReturn({ symbol: 'LS:1' }, h, f);
  assert.equal(adj.closesEur.at(-1), 100);
  assert.ok(Math.abs(adj.closesEur[0] - 100 / 1.04) < 0.05); // un anno prima: prezzo scontato del dividendo
  assert.equal(lsTotalReturn({ symbol: 'EUNL.DE' }, h, f), h); // Yahoo: già aggiustato
  assert.equal(lsTotalReturn({ symbol: 'LS:1' }, h, { dividendYield: 0 }), h);
  assert.equal(lsTotalReturn({ symbol: 'LS:1' }, h, null), h);
});
