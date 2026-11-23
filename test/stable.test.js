import test from 'node:test';
import assert from 'node:assert/strict';
import { ema, bandOf, stabilizeRanks } from '../public/js/stable.js';

const names = (n) => Array.from({ length: n }, (_, i) => 'S' + i);

test('media mobile: primo valore, poi ci si sposta di una frazione', () => {
  assert.equal(ema(null, 0.1), 0.1);
  assert.ok(Math.abs(ema(0.1, 0.2, 0.3) - 0.13) < 1e-12);
  assert.equal(ema(NaN, 0.5), 0.5);
});

test('banda morta: 20% della posizione, almeno 1', () => {
  assert.equal(bandOf(1), 1);
  assert.equal(bandOf(5), 1);
  assert.equal(bandOf(20), 4);
  assert.equal(bandOf(100), 20);
});

test('senza storico: classifica vera', () => {
  const r = stabilizeRanks(['B', 'A', 'C'], null);
  assert.deepEqual([...r.entries()], [['B', 1], ['A', 2], ['C', 3]]);
});

test('piccoli scambi non cambiano l\'ordine mostrato', () => {
  const prev = new Map(names(50).map((s, i) => [s, i + 1]));
  // nuova classifica vera: scambi di vicini (rumore)
  const ord = names(50);
  [ord[0], ord[1]] = [ord[1], ord[0]];
  [ord[9], ord[10]] = [ord[10], ord[9]];
  [ord[29], ord[31]] = [ord[31], ord[29]];
  const st = stabilizeRanks(ord, prev);
  assert.deepEqual([...st.keys()], names(50)); // ordine precedente invariato
});

test('uno spostamento grande si vede', () => {
  const prev = new Map(names(50).map((s, i) => [s, i + 1]));
  const ord = names(50);
  const [x] = ord.splice(40, 1); // da posizione 41 a 1: salto enorme
  ord.unshift(x);
  const st = stabilizeRanks(ord, prev);
  assert.equal(st.get('S40'), 1);
  assert.equal(new Set(st.values()).size, 50); // posizioni dense e uniche
});

test('nuovi strumenti entrano alla posizione vera', () => {
  const prev = new Map([['A', 1], ['B', 2]]);
  const st = stabilizeRanks(['A', 'N', 'B'], prev);
  assert.equal(st.get('A'), 1);
  assert.equal(st.size, 3);
});
