import test from 'node:test';
import assert from 'node:assert/strict';
import { project, projectShort, projectAny, projectPortfolio, normCdf, normalizeHorizons, horizonShort, horizonLong, horizonExp, daysToYears, isShortHorizon, HORIZON_PRESETS } from '../public/js/projection.js';
import { mulberry32 } from '../public/js/montecarlo.js';

test('normCdf: valori noti', () => {
  assert.ok(Math.abs(normCdf(0) - 0.5) < 1e-7);
  assert.ok(Math.abs(normCdf(1.96) - 0.975) < 1e-4);
  assert.ok(Math.abs(normCdf(-1) - 0.158655) < 1e-5);
});

test('etichette e normalizzazione degli orizzonti (giorni e anni)', () => {
  assert.equal(horizonShort(daysToYears(7)), '7gg');
  assert.equal(horizonShort(5), '5a');
  assert.equal(horizonLong(daysToYears(30)), '30 giorni');
  assert.equal(horizonLong(daysToYears(1)), '1 giorno');
  assert.equal(horizonLong(1), '1 anno');
  assert.equal(horizonLong(7), '7 anni');
  assert.equal(horizonExp(daysToYears(60)), '60/365');
  assert.ok(isShortHorizon(daysToYears(60)) && !isShortHorizon(1));
  assert.deepEqual(normalizeHorizons([7, daysToYears(30), 7, -1, 'x', 0]), [daysToYears(30), 7]);
  assert.deepEqual(normalizeHorizons([]), [5, 7]);
  assert.deepEqual(normalizeHorizons(undefined, [1]), [1]);
  assert.equal(HORIZON_PRESETS.length, 9);
});

test('project: orizzonti interi invariati, dividendo in proporzione per frazioni d’anno', () => {
  const p = { cagr: 0.07, ter: 0, tax: 0.26, net: 0.07, div: 0.02 };
  // 5 anni: stesso risultato di prima (5 dividendi interi)
  const five = project(p, 10000, 5);
  let div = 0;
  for (let t = 0; t < 5; t++) div += 10000 * (1.05) ** t * 0.02;
  assert.ok(Math.abs(five.gross - (10000 * 1.05 ** 5 + div)) < 1e-6);
  // 30 giorni: ≈ 1/12 del dividendo annuo, non un anno intero
  const m = project(p, 10000, daysToYears(30));
  assert.ok(m.gross - 10000 * 1.05 ** (30 / 365) < 10000 * 0.02 * (30 / 365) + 1e-6);
});

test('projectShort senza volatilità: deterministico, imposta solo sul guadagno, costi 2 × ordine', () => {
  const y = daysToYears(7);
  const mu = 1.07 ** y - 1;
  const r = projectShort({ cagr: 0.07, ter: 0, tax: 0.26 }, 10000, y, { orderCost: 1 });
  assert.ok(Math.abs(r.netGain - (10000 * mu * 0.74 - 2)) < 1e-9);
  assert.equal(r.pProfit, null);
  assert.equal(r.costs, 2);
  // CAGR negativo: nessun credito d'imposta
  const neg = projectShort({ cagr: -0.2, ter: 0, tax: 0.26 }, 10000, y, { orderCost: 0 });
  assert.ok(neg.netGain < 0 && Math.abs(neg.tax) < 1e-12);
});

test('projectShort con volatilità: coincide con una simulazione lognormale indipendente', () => {
  const y = daysToYears(30);
  const cap = 10000;
  const prm = { cagr: 0.08, ter: 0.002, tax: 0.26, net: 0.078 };
  const vol = 0.3;
  const r = projectShort(prm, cap, y, { vol, orderCost: 1 });
  // Monte Carlo: 1+R lognormale con E[1+R] = (1+net)^T
  const rnd = mulberry32(7);
  const gauss = () => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());
  const s = vol * Math.sqrt(y);
  const a = Math.log(1.078 ** y) - (s * s) / 2;
  let sum = 0, wins = 0;
  const N = 400000;
  for (let i = 0; i < N; i++) {
    const g = cap * (Math.exp(a + s * gauss()) - 1);
    sum += g - (g > 0 ? g * 0.26 : 0) - 2;
    if (g > 0) wins++;
  }
  assert.ok(Math.abs(r.netGain - sum / N) < 3, `${r.netGain} vs ${sum / N}`);
  assert.ok(Math.abs(r.pProfit - wins / N) < 0.005);
  assert.ok(r.low < 0 && r.high > 0 && r.low < r.netGain && r.netGain < r.high);
  // la volatilità aumenta l'imposta attesa rispetto al caso deterministico
  const det = projectShort(prm, cap, y, { orderCost: 1 });
  assert.ok(r.netGain < det.netGain);
});

test('projectAny e projectPortfolio: ≥ 1 anno = algoritmo 019, < 1 anno = algoritmo breve', () => {
  const p = { cagr: 0.07, ter: 0.002, tax: 0.26, net: 0.068 };
  assert.deepEqual(projectAny(p, 5000, 3), project(p, 5000, 3));
  assert.equal(projectAny(p, 5000, daysToYears(7)).short, true);
  const out = projectPortfolio({
    rows: [
      { weight: 6000, cagr: 0.07, ter: 0.002, tax: 0.26, vol: 0.15 },
      { weight: 4000, cagr: 0.1, ter: 0.003, tax: 0.26, vol: 0.2 },
    ],
    capital: 10000,
    years: [daysToYears(7), 5],
  });
  assert.equal(out.horizons[0].short, true);
  assert.equal(out.horizons[0].costs, 4); // 2 posizioni × 2 ordini × 1 €
  assert.ok(out.horizons[0].sigma > 0 && out.horizons[0].pProfit > 0.5);
  assert.ok(!out.horizons[1].short && out.horizons[1].netGain > 0);
});

test('trimAtBreak: tiene lo storico dopo un raggruppamento di azioni non corretto', async () => {
  const { trimAtBreak } = await import('../lib/market.js');
  const ts = [1, 2, 3, 4, 5, 6];
  const r = trimAtBreak(ts, [0.003, 0.0031, 0.0029, 15.8, 16, 15.5]);
  assert.deepEqual(r.closes, [15.8, 16, 15.5]);
  assert.deepEqual(r.timestamps, [4, 5, 6]);
  assert.equal(r.cut, 3);
  // salti normali (anche ×3) non tagliano nulla
  const ok = trimAtBreak(ts, [10, 12, 9, 30, 28, 31]);
  assert.equal(ok.cut, 0);
  assert.equal(ok.closes.length, 6);
});

test('provisionalEstimate: fattori base da uno storico breve (8+ settimane)', async () => {
  const { provisionalEstimate, analyze, DEFAULT_SETTINGS, isInverseProduct } = await import('../public/js/analyze.js');
  const rnd = mulberry32(3);
  const gauss = () => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());
  const N = 32;
  const ts = Array.from({ length: N }, (_, i) => 1_700_000_000 + i * 604800);
  const walk = (vol) => { let p = 100; return Array.from({ length: N }, () => (p *= Math.exp(vol * Math.sqrt(1 / 52) * gauss()))); };
  const bench = { timestamps: ts, closesEur: walk(0.15) };
  const own = { timestamps: ts, closesEur: bench.closesEur.map((x) => x * 1.001) }; // stessi rendimenti → beta ≈ 1
  const base = provisionalEstimate({ instrument: { name: 'MSCI World UCITS ETF', type: 'etf' }, history: own, benchmark: bench, market: 0.07, settings: DEFAULT_SETTINGS });
  assert.ok(base.provisional && base.weeks === N && base.vol > 0.05 && base.mdd >= 0);
  assert.ok(Math.abs(base.beta - 1) < 1e-6);
  assert.ok(Math.abs(base.cagr - 0.07) < 1e-3, String(base.cagr)); // rf + 1 × (m − rf) = m
  // troppo poco storico → nessuna stima
  assert.equal(provisionalEstimate({ instrument: {}, history: { closesEur: [1, 2, 3], timestamps: [1, 2, 3] } }), null);
  // leva long 3x: sopra al mercato ma ridotta dal decadimento; short/inverse: negativa; TER stimato 0,6%
  const levH = { timestamps: ts, closesEur: walk(0.9) };
  const lev = provisionalEstimate({ instrument: { name: 'Nasdaq 100 3x Daily Leveraged' }, history: levH, benchmark: bench, market: 0.07, settings: DEFAULT_SETTINGS });
  const inv = provisionalEstimate({ instrument: { name: 'WisdomTree Silver 3x Daily Short' }, history: levH, benchmark: bench, market: 0.07, settings: DEFAULT_SETTINGS });
  assert.equal(lev.leverage, 3);
  assert.ok(inv.inverse && inv.cagr < 0 && inv.cagr >= -0.6 && inv.ter === 0.006);
  assert.ok(lev.cagr <= 0.5 && lev.cagr >= -0.6);
  assert.ok(isInverseProduct('BTP (-2x) Inverse EUR') && isInverseProduct('Brent Crude Oil Short USD') && !isInverseProduct('Euro Short Duration Bond'));
  // analyze(): con storico < 1 anno restituisce la stima insieme al motivo
  const r = analyze({ instrument: { name: 'MSCI World UCITS ETF', type: 'etf' }, history: own, benchmark: bench, market: 0.07 }, DEFAULT_SETTINGS);
  assert.equal(r.sim.ok, false);
  assert.match(r.sim.reason, /Storico insufficiente/);
  assert.ok(r.estimate?.provisional);
});
