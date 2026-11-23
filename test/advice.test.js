import test from 'node:test';
import assert from 'node:assert/strict';
import { parityTol, gapThreshold, parityGroup, chooseByMaxGrowth } from '../public/js/advice.js';

const c = (symbol, median, growth, mg) => ({ symbol, median, growth, mg });

test('tolleranza e scarto crescono con l\'orizzonte', () => {
  assert.ok(parityTol(0.05, 365) > parityTol(0.05, 7));
  assert.ok(gapThreshold(0.05, 365) > gapThreshold(0.05, 7));
  assert.ok(Math.abs(parityTol(0.2, 30) - 0.02) < 1e-12); // 10% del migliore
  assert.equal(parityTol(0.01, 30), 0.003); // minimo 0,3 punti a 30 gg
});

test('a parità di netto più probabile e crescita vince il Max Growth più alto', () => {
  const cands = [c('A', 0.1, 0.1, 0.05), c('B', 0.095, 0.1, 0.12), c('C', 0.092, 0.095, 0.08)];
  const g = parityGroup(cands, 30);
  assert.equal(g.group.length, 3);
  const { target, tie } = chooseByMaxGrowth(g.group);
  assert.equal(target.symbol, 'B'); // non il primo per netto, ma il Max Growth maggiore tra i pari
  assert.equal(tie, true);
});

test('chi ha un netto più probabile nettamente inferiore resta fuori anche con Max Growth altissimo', () => {
  const cands = [c('A', 0.1, 0.1, 0.05), c('B', 0.06, 0.1, 0.4)];
  const g = parityGroup(cands, 30);
  assert.deepEqual(g.group.map((x) => x.symbol), ['A']);
  assert.equal(chooseByMaxGrowth(g.group).target.symbol, 'A');
  assert.equal(chooseByMaxGrowth(g.group).tie, false);
});

test('crescita attesa molto più bassa → non è a parità', () => {
  const cands = [c('A', 0.1, 0.15, 0.05), c('B', 0.099, 0.05, 0.3)];
  assert.deepEqual(parityGroup(cands, 30).group.map((x) => x.symbol), ['A']);
});

test('senza Max Growth decide il netto più probabile; elenco vuoto → nessuna destinazione', () => {
  const cands = [c('A', 0.1, null, null), c('B', 0.098, null, null)];
  const r = chooseByMaxGrowth(parityGroup(cands, 30).group);
  assert.equal(r.target.symbol, 'A');
  assert.equal(r.tie, false);
  assert.equal(parityGroup([], 30), null);
});
