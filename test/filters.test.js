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

test('i tre indicatori di prezzo aprono l\'elenco: prezzo attuale, prezzo più probabile, differenza', async () => {
  const { INDICATORS, PX_DIFF_LEVELS, activeFilters, passes } = await import('../public/js/filters.js');
  assert.deepEqual(INDICATORS.slice(0, 3).map((x) => x.key), ['price', 'pxMed', 'pxDiff']);
  assert.match(INDICATORS[0].label, /Prezzo attuale/);
  assert.match(INDICATORS[1].label, /Prezzo più probabile/);
  assert.match(INDICATORS[2].label, /Differenza/);
  assert.equal(new Set(INDICATORS.map((x) => x.key)).size, INDICATORS.length, 'nessun indicatore doppio');
  assert.deepEqual(PX_DIFF_LEVELS, [0, 2, 5, 10]);
  const a = activeFilters({ price: { max: '50' }, pxMed: { min: '10' }, pxDiff: { min: '5' } });
  assert.deepEqual(a.map((x) => [x.key, x.min, x.max]), [['price', null, 50], ['pxMed', 10, null], ['pxDiff', 0.05, null]]);
  assert.equal(passes({ price: 20, pxMed: 21.5, pxDiff: 0.075 }, a), true);
  assert.equal(passes({ price: 20, pxMed: 20.4, pxDiff: 0.02 }, a), false);
});

test('indicatori su prezzo medio e minimo a 52 settimane e 90 giorni: prezzi in euro e distanze in percentuale', async () => {
  const { INDICATORS, RANGE_COLS, RANGE_KEYS, activeFilters, passes } = await import('../public/js/filters.js');
  assert.deepEqual(RANGE_COLS.map((x) => x[0]), ['avg52', 'min52', 'avg90', 'min90']);
  assert.deepEqual(RANGE_KEYS, ['avg52', 'dA52', 'min52', 'dL52', 'avg90', 'dA90', 'min90', 'dL90', 'pm6Now', 'sA52', 'sA90', 'pm6L52']);
  for (const [k, d] of RANGE_COLS) {
    assert.ok(INDICATORS.some((x) => x.key === k && !x.pct), k);
    assert.ok(INDICATORS.some((x) => x.key === d && x.pct), d);
  }
  assert.equal(new Set(INDICATORS.map((x) => x.key)).size, INDICATORS.length, 'nessun indicatore doppio');
  // esempio: prezzo attuale al massimo il 10% sopra il minimo a 52 settimane e sotto la media a 90 giorni
  const a = activeFilters({ dL52: { max: '10' }, dA90: { max: '0' } });
  assert.deepEqual(a.map((x) => [x.key, x.min, x.max]), [['dL52', null, 0.1], ['dA90', null, 0]]);
  assert.equal(passes({ dL52: 0.08, dA90: -0.02 }, a), true);
  assert.equal(passes({ dL52: 0.3, dA90: -0.02 }, a), false);
  assert.equal(passes({ dL52: 0.08, dA90: null }, a), false);
});

test('filtro prezzo più probabile a 6 mesi rispetto al minimo a 52 settimane e differenze medio − minimo', async () => {
  const { INDICATORS, SPREAD_COLS, PM6_DAYS, PM6_LEVELS, activeFilters, passes } = await import('../public/js/filters.js');
  const { distanceFrom } = await import('../public/js/range.js');
  assert.deepEqual(SPREAD_COLS.map((x) => x[0]), ['pm6Now', 'sA52', 'sA90', 'pm6L52']);
  assert.equal(PM6_DAYS, 180);
  assert.deepEqual(PM6_LEVELS, [10, 20, 30, 50]);
  for (const [k] of SPREAD_COLS) assert.ok(INDICATORS.some((x) => x.key === k && x.pct), k);
  assert.match(INDICATORS.find((x) => x.key === 'pm6L52').label, /6 mesi − minimo 52 settimane\) ÷ minimo 52 settimane/);
  // la formula: (prezzo più probabile a 6 mesi − minimo 52 settimane) ÷ minimo 52 settimane
  assert.ok(Math.abs(distanceFrom(42, 31.55) - (42 - 31.55) / 31.55) < 1e-12);
  assert.ok(Math.abs(distanceFrom(21.39, 17.94) - (21.39 - 17.94) / 17.94) < 1e-12);
  const a = activeFilters({ pm6L52: { min: '30' } });
  assert.deepEqual(a.map((x) => [x.key, x.min]), [['pm6L52', 0.3]]);
  assert.equal(passes({ pm6L52: distanceFrom(42, 31.55) }, a), true); // +33,1%
  assert.equal(passes({ pm6L52: distanceFrom(40, 31.55) }, a), false); // +26,8%
  assert.equal(passes({ pm6L52: null }, a), false);
});

test('Max Growth Score tra gli indicatori filtrabili (in ogni sezione, anche «Netto più probabile»)', async () => {
  const { INDICATORS, activeFilters, passes } = await import('../public/js/filters.js');
  assert.ok(INDICATORS.some((x) => x.key === 'maxGrowth' && x.pct));
  assert.equal(new Set(INDICATORS.map((x) => x.key)).size, INDICATORS.length, 'nessun indicatore doppio');
  const a = activeFilters({ maxGrowth: { min: '8' } });
  assert.deepEqual(a.map((x) => [x.key, x.min]), [['maxGrowth', 0.08]]);
  assert.equal(passes({ maxGrowth: 0.089 }, a), true);
  assert.equal(passes({ maxGrowth: 0.05 }, a), false);
  assert.equal(passes({ maxGrowth: null }, a), false);
});

test('differenza tra prezzo più probabile a 6 mesi e prezzo attuale: colonna, indicatore e pulsanti rapidi', async () => {
  const { INDICATORS, SPREAD_COLS, PM6_NOW_LEVELS, activeFilters, passes } = await import('../public/js/filters.js');
  assert.equal(SPREAD_COLS[0][0], 'pm6Now');
  assert.match(SPREAD_COLS[0][1], /6 mesi − prezzo attuale/);
  assert.ok(INDICATORS.some((x) => x.key === 'pm6Now' && x.pct));
  assert.ok(INDICATORS.some((x) => x.key === 'pm6' && !x.pct));
  assert.match(INDICATORS.find((x) => x.key === 'pm6Now').label, /6 mesi − prezzo attuale\) ÷ prezzo attuale/);
  assert.equal(new Set(INDICATORS.map((x) => x.key)).size, INDICATORS.length, 'nessun indicatore doppio');
  assert.deepEqual(PM6_NOW_LEVELS, [0, 2, 5, 10]);
  // esempio: prezzo attuale 21,17 €, più probabile a 6 mesi 22,16 € → +4,7%
  const d = 22.16 / 21.17 - 1;
  const a = activeFilters({ pm6Now: { min: '2' } });
  assert.deepEqual(a.map((x) => [x.key, x.min]), [['pm6Now', 0.02]]);
  assert.equal(passes({ pm6Now: d }, a), true);
  assert.equal(passes({ pm6Now: 0.01 }, a), false);
  assert.equal(passes({ pm6Now: null }, a), false);
});

test('rischio: stress test, guadagno efficiente, bilanciato e corretto per il rischio a 1, 3 e 5 anni; filtri sulle probabilità', async () => {
  const { INDICATORS, RG_PERIODS, RISK_KEYS, PROB_FILTERS, balKey, radjKey, activeFilters, passes } = await import('../public/js/filters.js');
  assert.deepEqual(RG_PERIODS.map(([d]) => d), [365, 1095, 1825]);
  assert.deepEqual(RISK_KEYS, ['stress', 'effNet', 'bal365', 'bal1095', 'bal1825', 'radj365', 'radj1095', 'radj1825']);
  for (const k of ['stress', 'plausible', balKey(365), balKey(1095), 'balanced', radjKey(365), radjKey(1095), 'riskAdj', 'probLoss', 'prob50']) assert.ok(INDICATORS.some((x) => x.key === k && x.pct), k);
  assert.equal(new Set(INDICATORS.map((x) => x.key)).size, INDICATORS.length, 'nessun indicatore doppio');
  assert.deepEqual(PROB_FILTERS.map(([k]) => k), ['probLoss', 'prob50']);
  // probabilità di perdita tra 5% e 20%, probabilità di guadagno oltre il 50% tra 30% e 80%
  const a = activeFilters({ probLoss: { min: '5', max: '20' }, prob50: { min: '30', max: '80' } });
  assert.equal(passes({ probLoss: 0.12, prob50: 0.45 }, a), true);
  assert.equal(passes({ probLoss: 0.25, prob50: 0.45 }, a), false);
  assert.equal(passes({ probLoss: 0.12, prob50: 0.9 }, a), false);
  assert.equal(passes({ probLoss: 0.02, prob50: 0.45 }, a), false);
  assert.equal(passes({ probLoss: null, prob50: 0.45 }, a), false);
  // stress test: perdita fino al 25% (numero positivo)
  const s = activeFilters({ stress: { max: '25' } });
  assert.equal(passes({ stress: 0.2 }, s), true);
  assert.equal(passes({ stress: 0.3 }, s), false);
});
