import test from 'node:test';
import assert from 'node:assert/strict';
import { fingerprint, outputHash, resultInvalid, intervalCoverage, rotatingSample, summarize } from '../lib/verify.js';

const good = { forward: { expected: 0.08, vol: 0.2 }, sim: { probLoss: 0.2, netGain: 0.3 }, mom: { w1: 0.01, w4: -0.02 } };
const base = { reproChecked: 60, reproMismatch: [], total: 1000, invalid: [], stale: 10, excluded: 3, priceMismatch: 0, lsCompared: 20, lsDeviating: [], coverage: { n: 900, share: 0.9 }, samples: [] };

test('impronte: stessi dati → stessa impronta, dati diversi → impronta diversa', () => {
  const h = { timestamps: [1, 2, 3], closesEur: [10, 11, 12] };
  assert.equal(fingerprint(h, 12), fingerprint({ timestamps: [1, 2, 3], closesEur: [10, 11, 12] }, 12));
  assert.notEqual(fingerprint(h, 12), fingerprint(h, 12.01));
  assert.notEqual(fingerprint(h, 12), fingerprint({ timestamps: [1, 2, 3], closesEur: [10, 11, 12.5] }, 12));
  assert.equal(outputHash(good), outputHash(JSON.parse(JSON.stringify(good))));
});

test('previsioni non valide riconosciute; errori e previsioni corrette no', () => {
  assert.equal(resultInvalid(good), false);
  assert.equal(resultInvalid({ error: 'x' }), false);
  assert.equal(resultInvalid({ ...good, forward: { expected: NaN, vol: 0.2 } }), true);
  assert.equal(resultInvalid({ ...good, forward: { expected: 0.1, vol: 0 } }), true);
  assert.equal(resultInvalid({ ...good, sim: { probLoss: 1.2 } }), true);
  assert.equal(resultInvalid({ ...good, mom: { w1: -1.5 } }), true);
});

test('copertura degli intervalli: serie regolare dentro, salto anomalo fuori', () => {
  const calm = { closesEur: Array.from({ length: 80 }, (_, k) => 100 * Math.exp(0.001 * k + 0.02 * Math.sin(k))) };
  const jump = { closesEur: calm.closesEur.map((x, k) => (k >= 78 ? x * 2 : x)) };
  const c = intervalCoverage([calm, jump], 4);
  assert.equal(c.n, 2);
  assert.equal(c.inside, 1);
  assert.equal(intervalCoverage([{ closesEur: [1, 2, 3] }], 4).n, 0); // storico troppo corto
});

test('campione che ruota: deterministico nella stessa ora, diverso nel tempo, mai più di k', () => {
  const list = Array.from({ length: 1000 }, (_, i) => i);
  const a = rotatingSample(list, 20, 3600e3 * 5);
  assert.deepEqual(a, rotatingSample(list, 20, 3600e3 * 5 + 1000));
  assert.notDeepEqual(a, rotatingSample(list, 20, 3600e3 * 6));
  assert.equal(a.length, 20);
  assert.deepEqual(rotatingSample([1, 2], 20), [1, 2]);
});

test('esito: tutto in ordine → ok', () => {
  const v = summarize(base);
  assert.equal(v.status, 'ok');
  assert.ok(v.checks.every((c) => c.level === 'ok'));
});

test('esito: risultato non riproducibile → fail (non si pubblica)', () => {
  const v = summarize({ ...base, reproMismatch: ['AAA'] });
  assert.equal(v.status, 'fail');
  assert.equal(v.checks.find((c) => c.id === 'repro').level, 'fail');
});

test('esito: pochi numeri non validi → avviso; molti → fail', () => {
  assert.equal(summarize({ ...base, invalid: ['A'] }).status, 'warn');
  assert.equal(summarize({ ...base, invalid: Array.from({ length: 10 }, (_, i) => 'S' + i) }).status, 'fail');
});

test('esito: prezzi lontani da LS Exchange o copertura anomala → avviso', () => {
  assert.equal(summarize({ ...base, lsDeviating: ['A', 'B', 'C', 'D', 'E', 'F'] }).status, 'warn');
  assert.equal(summarize({ ...base, coverage: { n: 900, share: 0.6 } }).status, 'warn');
  assert.equal(summarize({ ...base, stale: 200 }).status, 'warn');
});

test('riparazione automatica: pochi strumenti esclusi → si pubblica con avviso; troppi → non si pubblica', () => {
  const few = summarize({ ...base, quarantined: ['A', 'B'] });
  assert.equal(few.status, 'warn');
  assert.equal(few.checks.find((c) => c.id === 'repair').level, 'warn');
  const many = summarize({ ...base, quarantined: Array.from({ length: 30 }, (_, i) => 'S' + i) });
  assert.equal(many.status, 'fail');
  assert.equal(summarize({ ...base, quarantined: [] }).status, 'ok');
});
