import test from 'node:test';
import assert from 'node:assert/strict';
import { activeFilters, passes, parseNum } from '../public/js/filters.js';

test('filtri sugli indicatori', () => {
  assert.equal(parseNum('1,5'), 1.5);
  assert.equal(parseNum(' '), null);
  assert.equal(parseNum('abc'), null);
  const a = activeFilters({ ratio: { max: '1' }, netGain: { min: '10' }, maxLoss: { max: '' } });
  assert.deepEqual(a, [{ key: 'ratio', min: null, max: 1 }, { key: 'netGain', min: 0.1, max: null }]);
  assert.ok(passes({ ratio: 0.8, netGain: 0.25 }, a));
  assert.ok(!passes({ ratio: 1.2, netGain: 0.25 }, a));
  assert.ok(!passes({ ratio: Infinity, netGain: -0.1 }, a)); // ∞ non è < 1
  assert.ok(!passes({ ratio: null, netGain: 0.3 }, a)); // senza previsione: escluso
  assert.ok(!passes({ ratio: 0.5, netGain: 0.05 }, a));
  assert.ok(passes({ maxLoss: 0.35 }, activeFilters({ maxLoss: { max: 40 } })));
  assert.ok(!passes({ maxLoss: 0.45 }, activeFilters({ maxLoss: { max: 40 } })));
  assert.ok(passes({ anything: 1 }, activeFilters({})));
});
