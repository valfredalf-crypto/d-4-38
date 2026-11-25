import test from 'node:test';
import assert from 'node:assert/strict';
import { SOLID_MIN, solidRecent, solidPass } from '../public/js/solid.js';

test('sezione «Solidi e in crescita»: netto alto a 1, 3 e 5 anni e prezzo in crescita recente', () => {
  assert.deepEqual(SOLID_MIN, { y1: 0, y3: 0.1, y5: 0.2 }); // su 10.000 €: 0 €, 1.000 €, 2.000 €
  const up = { hD: 0.012, hW: 0.03, hW2: 0.01, hM: 0.07 };
  const np = { y1: 0.045, y3: 0.13, y5: 0.22 };
  assert.equal(solidPass(np, up), true);
  // una sola finestra in calo o ferma: escluso
  for (const k of ['hW', 'hW2', 'hM']) {
    assert.equal(solidPass(np, { ...up, [k]: -0.001 }), false);
    assert.equal(solidPass(np, { ...up, [k]: 0 }), false);
    assert.equal(solidPass(np, { ...up, [k]: null }), false);
  }
  // oggi in calo o fermo: escluso; senza prezzo di oggi (mercato chiuso): non si esclude
  assert.equal(solidPass(np, { ...up, hD: -0.004 }), false);
  assert.equal(solidPass(np, { ...up, hD: 0 }), false);
  assert.equal(solidPass(np, { ...up, hD: null }), true);
  assert.equal(solidRecent({ ...up, hD: null }), true);
  // netto più probabile: positivo a 1 anno, oltre il 10% a 3 anni, oltre il 20% a 5 anni (soglie strette)
  assert.equal(solidPass({ ...np, y1: 0 }, up), false);
  assert.equal(solidPass({ ...np, y1: -0.02 }, up), false);
  assert.equal(solidPass({ ...np, y3: 0.1 }, up), false);
  assert.equal(solidPass({ ...np, y5: 0.2 }, up), false);
  assert.equal(solidPass({ ...np, y5: 0.2001 }, up), true);
  // senza previsione o senza storico: escluso, mai un errore
  assert.equal(solidPass({ y1: undefined, y3: 0.2, y5: 0.3 }, up), false);
  assert.equal(solidPass(null, up), false);
  assert.equal(solidPass(np, null), false);
  assert.equal(solidPass(np, {}), false);
  assert.equal(solidPass({ y1: NaN, y3: 0.2, y5: 0.3 }, up), false);
});
