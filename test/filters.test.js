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

test('filtri netto più probabile in euro: 6 periodi, soglia stretta (maggiore di), sommabili', async () => {
  const { INDICATORS, NP_FILTER_PERIODS, NP_FILTER_LEVELS, npFilterKey, activeFilters, passes } = await import('../public/js/filters.js');
  assert.deepEqual(NP_FILTER_PERIODS.map(([d]) => d), [7, 30, 90, 365, 1095, 1825]);
  assert.deepEqual(NP_FILTER_LEVELS, [0, 1000, 2000, 3000]);
  for (const [d] of NP_FILTER_PERIODS) assert.ok(INDICATORS.some((x) => x.key === npFilterKey(d) && x.eur && x.strict && !x.pct));
  const a = activeFilters({ npEur7: { min: '0' }, npEur365: { min: '1000' } });
  assert.deepEqual(a, [{ key: 'npEur7', min: 0, max: null, strict: true }, { key: 'npEur365', min: 1000, max: null, strict: true }]);
  assert.equal(passes({ npEur7: 12.5, npEur365: 1000.01 }, a), true);
  assert.equal(passes({ npEur7: 0, npEur365: 2500 }, a), false); // 0 € non è maggiore di 0
  assert.equal(passes({ npEur7: 30, npEur365: 1000 }, a), false); // 1.000 € esatti non sono maggiori di 1.000
  assert.equal(passes({ npEur7: -4, npEur365: 5000 }, a), false);
  assert.equal(passes({ npEur7: null, npEur365: 5000 }, a), false); // senza previsione: escluso
  // gli altri indicatori restano «maggiore o uguale»
  assert.equal(passes({ netGain: 0.1 }, activeFilters({ netGain: { min: '10' } })), true);
});

test('filtro guadagno netto medio degli scenari in euro: soglia stretta, sommabile ai periodi', async () => {
  const { INDICATORS, MEAN_KEY, activeFilters, passes } = await import('../public/js/filters.js');
  assert.equal(MEAN_KEY, 'netMeanEur');
  assert.ok(INDICATORS.some((x) => x.key === MEAN_KEY && x.eur && x.strict && !x.pct));
  const a = activeFilters({ [MEAN_KEY]: { min: '2000' }, npEur365: { min: '0' } });
  assert.deepEqual(a, [{ key: 'npEur365', min: 0, max: null, strict: true }, { key: MEAN_KEY, min: 2000, max: null, strict: true }]);
  assert.equal(passes({ netMeanEur: 2000.5, npEur365: 10 }, a), true);
  assert.equal(passes({ netMeanEur: 2000, npEur365: 10 }, a), false);
  assert.equal(passes({ netMeanEur: 5000, npEur365: -1 }, a), false);
  assert.equal(passes({ netMeanEur: null, npEur365: 10 }, a), false);
});
