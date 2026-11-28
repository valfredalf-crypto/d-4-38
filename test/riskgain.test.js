import test from 'node:test';
import assert from 'node:assert/strict';
import { normInv, riskGain, RG_POINTS, probNetAtLeast, netQuantile } from '../public/js/riskgain.js';
import { normCdf, projectShort } from '../public/js/projection.js';
import { LOSS_AVERSION, credibleGain, percentile, netReturn, mulberry32 } from '../public/js/montecarlo.js';

test('quantile della normale: valori noti e inverso della funzione di ripartizione', () => {
  assert.ok(Math.abs(normInv(0.5)) < 1e-9);
  assert.ok(Math.abs(normInv(0.1) + 1.2815515655446004) < 1e-7);
  assert.ok(Math.abs(normInv(0.05) + 1.6448536269514722) < 1e-7);
  assert.ok(Math.abs(normInv(0.975) - 1.959963984540054) < 1e-7);
  for (const p of [0.001, 0.02, 0.3, 0.75, 0.99]) assert.ok(Math.abs(normCdf(normInv(p)) - p) < 1e-6, String(p));
});

test('guadagno bilanciato e corretto per il rischio: senza volatilità non c’è distribuzione', () => {
  assert.equal(riskGain({ lnMean: 0.05, sigma: 0 }), null);
  assert.equal(riskGain({ lnMean: NaN, sigma: 0.2 }), null);
  assert.equal(riskGain(), null);
});

test('guadagno corretto per il rischio = guadagno mediano − perdita al 5° percentile (stessa formula della scheda)', () => {
  const lnMean = 0.06;
  const sigma = 0.2;
  const x = riskGain({ lnMean, sigma, tax: 0.26, costs: 0.0002 });
  const med = (Math.exp(lnMean) - 1) * (1 - 0.26) - 0.0002;
  assert.ok(Math.abs(x.median - med) < 1e-12);
  const p5 = Math.exp(lnMean - 1.6448536269514722 * sigma) - 1 - 0.0002; // in perdita: nessuna imposta
  assert.ok(p5 < 0);
  assert.ok(Math.abs(x.finalLoss + p5) < 1e-6);
  assert.ok(Math.abs(x.riskAdj - (med + p5)) < 1e-6);
  assert.ok(Math.abs(x.balanced - (x.expGain - LOSS_AVERSION * x.expLoss)) < 1e-12);
});

test('guadagno bilanciato: coincide con il calcolo sugli scenari simulati della stessa distribuzione', () => {
  const lnMean = 0.18;
  const sigma = 0.35;
  const rand = mulberry32(7);
  const nets = [];
  for (let k = 0; k < 200000; k++) {
    let u = 0;
    while (u === 0) u = rand();
    const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
    const g = Math.exp(lnMean + z * sigma) - 1;
    nets.push(g - (g > 0 ? g * 0.26 : 0));
  }
  nets.sort((a, b) => a - b);
  const p75 = percentile(nets, 0.75);
  const expGain = nets.reduce((a, x) => a + credibleGain(x, p75), 0) / nets.length;
  const expLoss = nets.reduce((a, x) => a + Math.max(-x, 0), 0) / nets.length;
  const x = riskGain({ lnMean, sigma, tax: 0.26, costs: 0 });
  assert.ok(Math.abs(x.expGain - expGain) < 0.004, `${x.expGain} vs ${expGain}`);
  assert.ok(Math.abs(x.expLoss - expLoss) < 0.002, `${x.expLoss} vs ${expLoss}`);
  assert.ok(Math.abs(x.balanced - (expGain - LOSS_AVERSION * expLoss)) < 0.008);
  assert.ok(Math.abs(x.median - percentile(nets, 0.5)) < 0.004);
  assert.ok(Math.abs(x.finalLoss - Math.max(0, -percentile(nets, 0.05))) < 0.004);
  assert.equal(RG_POINTS, 400);
});

test('più rischio a parità di previsione: i due indicatori scendono; non si perde più del capitale', () => {
  const calm = riskGain({ lnMean: 0.07, sigma: 0.1 });
  const wild = riskGain({ lnMean: 0.07, sigma: 0.6 });
  assert.ok(wild.balanced < calm.balanced);
  assert.ok(wild.riskAdj < calm.riskAdj);
  const crash = riskGain({ lnMean: -3, sigma: 2, costs: 0.5 });
  assert.ok(crash.finalLoss <= 1 && crash.expLoss <= 1 && crash.median >= -1);
});

test('il modello delle previsioni pubblica i parametri della distribuzione e il mediano coincide', () => {
  const cap = 10000;
  const h = projectShort({ cagr: 0.08, ter: 0.002, tax: 0.26, net: 0.078 }, cap, 3, { vol: 0.18, orderCost: 1, positions: 1 });
  assert.ok(Number.isFinite(h.lnMean));
  const x = riskGain({ lnMean: h.lnMean, sigma: h.sigma, tax: 0.26, costs: h.costs / cap });
  assert.ok(Math.abs(x.median * cap - h.medianNet) < 1e-6);
  // 10° percentile del modello: sta tra la perdita al 5° percentile e il mediano
  assert.ok(h.p10Net / cap > -x.finalLoss && h.p10Net / cap < x.median);
  const flat = projectShort({ cagr: 0.03, ter: 0, tax: 0.26, net: 0.03 }, cap, 1, {});
  assert.equal(flat.lnMean, null);
  // la formula del netto per scenario è quella della simulazione: imposta solo sui guadagni
  assert.ok(Math.abs(netReturn(-0.1, { amount: cap, orderCost: 0, spreadPct: 0, taxRate: 26 }) + 0.1) < 1e-12);
});

test('probabilità di rendimento netto a 1 e 3 anni: coerenti con gli scenari simulati e con il modello delle previsioni', () => {
  const dist = { lnMean: 0.1, sigma: 0.3, tax: 0.26, costs: 0.0002 };
  const rand = mulberry32(11);
  const nets = [];
  for (let k = 0; k < 200000; k++) {
    let u = 0;
    while (u === 0) u = rand();
    const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
    const g = Math.exp(dist.lnMean + z * dist.sigma) - 1;
    nets.push(g - (g > 0 ? g * dist.tax : 0) - dist.costs);
  }
  let prev = 1;
  for (const th of [-0.2, 0, 0.1, 0.25, 0.5, 1]) {
    const p = probNetAtLeast(dist, th);
    const sim = nets.filter((x) => x >= th).length / nets.length;
    assert.ok(Math.abs(p - sim) < 0.005, `${th}: ${p} vs ${sim}`);
    assert.ok(p <= prev, 'soglia più alta, probabilità più bassa');
    prev = p;
  }
  assert.equal(probNetAtLeast(dist, -1.5), 1);
  assert.equal(probNetAtLeast({ lnMean: 0.1, sigma: 0 }, 0), null);
  nets.sort((a, b) => a - b);
  for (const p of [0.05, 0.25, 0.5, 0.75, 0.95]) assert.ok(Math.abs(netQuantile(dist, p) - percentile(nets, p)) < 0.01, String(p));
  assert.ok(Math.abs(netQuantile(dist, 0.5) - riskGain(dist).median) < 1e-12);
  assert.ok(Math.abs(probNetAtLeast(dist, netQuantile(dist, 0.25)) - 0.75) < 1e-6);
  // «almeno pari» coincide (a meno dei costi degli ordini) con la probabilità di guadagno del netto più probabile
  const cap = 10000;
  const h = projectShort({ cagr: 0.06, ter: 0, tax: 0.26, net: 0.06 }, cap, 1, { vol: 0.25, orderCost: 1, positions: 1 });
  const d1 = { lnMean: h.lnMean, sigma: h.sigma, tax: 0.26, costs: h.costs / cap };
  assert.ok(Math.abs(probNetAtLeast(d1, 0) - h.pProfit) < 0.002);
  assert.ok(Math.abs(netQuantile(d1, 0.5) * cap - h.medianNet) < 1e-6);
  assert.ok(Math.abs(netQuantile(d1, 0.1) * cap - h.p10Net) < 0.01);
});

test('equivalente certo di Kelly sulla distribuzione del modello: media geometrica dei risultati, come negli scenari simulati', async () => {
  const { certaintyEquivalent } = await import('../public/js/montecarlo.js');
  const dist = { lnMean: 0.08, sigma: 0.3, tax: 0.26, costs: 0.0002 };
  const x = riskGain(dist);
  // stesso calcolo dell'equivalente certo degli scenari (γ = 1) sugli stessi 400 punti
  const nets = [];
  for (let k = 0; k < RG_POINTS; k++) { const g = Math.exp(dist.lnMean + normInv((k + 0.5) / RG_POINTS) * dist.sigma) - 1; nets.push(Math.max(-1, g - (g > 0 ? g * dist.tax : 0) - dist.costs)); }
  assert.ok(Math.abs(x.kelly - certaintyEquivalent(nets, 1)) < 1e-12);
  // Kelly sta sotto la media dei risultati e non sopra il mediano gonfiato dai guadagni: più rischio, valore più basso
  const mean = nets.reduce((a, b) => a + b, 0) / nets.length;
  assert.ok(x.kelly < mean);
  assert.ok(riskGain({ ...dist, sigma: 0.6 }).kelly < x.kelly);
  // quasi senza rischio coincide con il guadagno netto
  const calm = riskGain({ lnMean: 0.05, sigma: 0.0005, tax: 0.26, costs: 0 });
  assert.ok(Math.abs(calm.kelly - (Math.exp(0.05) - 1) * 0.74) < 1e-4);
});
