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

test('il guadagno netto medio non è un filtro: la media è influenzata da pochi scenari estremi', async () => {
  const { INDICATORS } = await import('../public/js/filters.js');
  assert.ok(!INDICATORS.some((x) => x.key === 'netMeanEur'));
  // al suo posto il valore mediano degli scenari, in euro e con soglia stretta
  const { SIM_KEY, activeFilters, passes } = await import('../public/js/filters.js');
  assert.ok(INDICATORS.some((x) => x.key === SIM_KEY && x.eur && x.strict && !x.pct));
  const a = activeFilters({ [SIM_KEY]: { min: '2000' } });
  assert.deepEqual(a, [{ key: SIM_KEY, min: 2000, max: null, strict: true }]);
  assert.equal(passes({ [SIM_KEY]: 2000.5 }, a), true);
  assert.equal(passes({ [SIM_KEY]: 2000 }, a), false);
  assert.equal(passes({ [SIM_KEY]: null }, a), false);
});

test('filtro probabilità di guadagno a 5 anni: in punti percentuali, maggiore o uguale', async () => {
  const { INDICATORS, SIM_P_KEY, SIM_P_LEVELS, activeFilters, passes } = await import('../public/js/filters.js');
  assert.deepEqual(SIM_P_LEVELS, [70, 80, 90]);
  assert.ok(INDICATORS.some((x) => x.key === SIM_P_KEY && x.pct && !x.strict));
  const a = activeFilters({ [SIM_P_KEY]: { min: '90' } });
  assert.deepEqual(a, [{ key: SIM_P_KEY, min: 0.9, max: null }]);
  assert.equal(passes({ simP: 0.9 }, a), true); // il 90% esatto passa
  assert.equal(passes({ simP: 0.8999 }, a), false);
  assert.equal(passes({ simP: null }, a), false); // senza scenari: escluso
});

test('filtri probabilità di guadagno a 1 e 3 anni: in punti percentuali, sommabili a quello a 5 anni', async () => {
  const { INDICATORS, P_GAIN_PERIODS, pGainKey, SIM_P_KEY, activeFilters, passes } = await import('../public/js/filters.js');
  assert.deepEqual(P_GAIN_PERIODS.map(([d]) => d), [365, 1095]);
  for (const [d] of P_GAIN_PERIODS) assert.ok(INDICATORS.some((x) => x.key === pGainKey(d) && x.pct && !x.strict));
  const a = activeFilters({ pG365: { min: '70' }, pG1095: { min: '80' }, [SIM_P_KEY]: { min: '90' } });
  assert.deepEqual(a.map((x) => [x.key, x.min]), [['pG365', 0.7], ['pG1095', 0.8], [SIM_P_KEY, 0.9]]);
  assert.equal(passes({ pG365: 0.71, pG1095: 0.8, simP: 0.93 }, a), true);
  assert.equal(passes({ pG365: 0.69, pG1095: 0.9, simP: 0.93 }, a), false);
  assert.equal(passes({ pG365: 0.9, pG1095: null, simP: 0.93 }, a), false);
});

test('filtri analisti e dividendi: potenziale e dividendo in punti percentuali, analisti come numero', async () => {
  const { INDICATORS, AN_KEYS, activeFilters, passes } = await import('../public/js/filters.js');
  assert.deepEqual(AN_KEYS, ['anUp', 'divY']);
  assert.ok(INDICATORS.some((x) => x.key === 'anUp' && x.pct));
  assert.ok(INDICATORS.some((x) => x.key === 'anN' && !x.pct));
  assert.ok(INDICATORS.some((x) => x.key === 'divY' && x.pct));
  const a = activeFilters({ anUp: { min: '25' }, anN: { min: '3' }, divY: { min: '2' } });
  assert.deepEqual(a.map((x) => [x.key, x.min]), [['anUp', 0.25], ['anN', 3], ['divY', 0.02]]);
  assert.equal(passes({ anUp: 0.3, anN: 5, divY: 0.021 }, a), true);
  assert.equal(passes({ anUp: 4.85, anN: 1, divY: 0.18 }, a), false);
  assert.equal(passes({ anUp: 0.3, anN: null, divY: 0.05 }, a), false);
});

test('filtri sul netto nel 90% degli scenari: in euro, soglia stretta, anche negativa', async () => {
  const { INDICATORS, P90_KEYS, P90_LEVELS, p90Key, SIM_P90_KEY, activeFilters, passes } = await import('../public/js/filters.js');
  assert.deepEqual(P90_KEYS, ['p90e365', 'p90e1095', 'simP90']);
  assert.equal(p90Key(365), 'p90e365');
  for (const k of P90_KEYS) assert.ok(INDICATORS.some((x) => x.key === k && x.eur && x.strict && !x.pct));
  assert.ok(P90_LEVELS.includes(0) && P90_LEVELS.some((x) => x < 0));
  const a = activeFilters({ p90e365: { min: '-1000' }, [SIM_P90_KEY]: { min: '0' } });
  assert.deepEqual(a.map((x) => [x.key, x.min, x.strict]), [['p90e365', -1000, true], [SIM_P90_KEY, 0, true]]);
  assert.equal(passes({ p90e365: -999, simP90: 1 }, a), true);
  assert.equal(passes({ p90e365: -1000, simP90: 1 }, a), false);
  assert.equal(passes({ p90e365: 200, simP90: 0 }, a), false);
  assert.equal(passes({ p90e365: 200, simP90: null }, a), false);
});

test('filtro sulla differenza tra prezzo più probabile e prezzo attuale: in punti percentuali', async () => {
  const { INDICATORS, PX_KEYS, activeFilters, passes } = await import('../public/js/filters.js');
  assert.deepEqual(PX_KEYS, ['price', 'pxMed', 'pxDiff']);
  assert.ok(INDICATORS.some((x) => x.key === 'pxDiff' && x.pct));
  const a = activeFilters({ pxDiff: { min: '2' } });
  assert.deepEqual(a.map((x) => [x.key, x.min]), [['pxDiff', 0.02]]);
  assert.equal(passes({ pxDiff: 0.021 }, a), true);
  assert.equal(passes({ pxDiff: 0.019 }, a), false);
  assert.equal(passes({ pxDiff: null }, a), false);
});
