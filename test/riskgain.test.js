import test from 'node:test';
import assert from 'node:assert/strict';
import { normInv, riskGain, RG_POINTS } from '../public/js/riskgain.js';
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
