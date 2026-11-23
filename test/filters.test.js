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

test('filtri patrimonio (milioni di €) e TER (%): scala corretta e righe senza dato escluse', async () => {
  const { activeFilters, passes } = await import('../public/js/filters.js');
  const a = activeFilters({ aum: { min: '500' }, ter: { max: '0,25' } });
  assert.deepEqual(a, [{ key: 'aum', min: 500, max: null }, { key: 'ter', min: null, max: 0.0025 }]);
  assert.equal(passes({ aum: 1200, ter: 0.002 }, a), true);
  assert.equal(passes({ aum: 300, ter: 0.002 }, a), false); // patrimonio troppo basso
  assert.equal(passes({ aum: 1200, ter: 0.004 }, a), false); // TER troppo alto
  assert.equal(passes({ aum: null, ter: null }, a), false); // azioni/ETF senza dato
});
