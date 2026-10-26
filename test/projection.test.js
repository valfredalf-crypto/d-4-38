import test from 'node:test';
import assert from 'node:assert/strict';
import { GEMINI_PORTFOLIO, projectPortfolio, weightedParams, portfolioRisk, stressTest, classifyPortfolio, portfolioStress, stockScenarios, totalPortfolioStress } from '../public/js/projection.js';

// Il documento arrotonda le potenze a mano (17.261,28 contro 17.259,63 esatti): tolleranza di pochi euro.
test('proiezione deterministica: riproduce i numeri del documento PRJ-FIN-2026-018', () => {
  const p = projectPortfolio(GEMINI_PORTFOLIO);
  assert.ok(Math.abs(p.params.cagr - 0.0776) < 1e-9);
  assert.ok(Math.abs(p.params.ter - 0.0022) < 1e-9);
  assert.ok(Math.abs(p.params.tax - 0.245) < 1e-9);
  assert.ok(Math.abs(p.params.net - 0.0754) < 1e-9);
  const [y5, y7] = p.horizons;
  assert.ok(Math.abs(y5.gross - 17261.28) < 5, `montante 5a ${y5.gross}`);
  assert.ok(Math.abs(y5.netGain - 3972.27) < 5, `netto 5a ${y5.netGain}`);
  assert.ok(Math.abs(y7.gross - 19963.2) < 5, `montante 7a ${y7.gross}`);
  assert.ok(Math.abs(y7.netGain - 6012.22) < 5, `netto 7a ${y7.netGain}`);
});

test('proiezione deterministica: pesi normalizzati e nessuna imposta su una perdita', () => {
  const w = weightedParams([{ weight: 2, cagr: 0.1, ter: 0, tax: 0.26 }, { weight: 2, cagr: 0.0, ter: 0, tax: 0.26 }]);
  assert.ok(Math.abs(w.cagr - 0.05) < 1e-12);
  const loss = projectPortfolio({ rows: [{ weight: 1, cagr: -0.05, ter: 0.002, tax: 0.26 }], capital: 1000, years: [5] });
  assert.equal(loss.horizons[0].tax, 0);
  assert.ok(loss.horizons[0].netGain < 0);
  assert.equal(weightedParams([]), null);
});

test('portfolioRisk (modulo 4): MDD ponderato −29% del documento e volatilità con covarianza', () => {
  const r = portfolioRisk(GEMINI_PORTFOLIO.rows);
  assert.ok(Math.abs(r.mdd - 0.29) < 1e-12, String(r.mdd));
  assert.equal(r.mddCoverage, 1);
  assert.equal(r.vol, null);
  const v = portfolioRisk([{ weight: 0.5, vol: 0.2 }, { weight: 0.5, vol: 0.2 }], 1);
  assert.ok(Math.abs(v.vol - 0.2) < 1e-12);
  const v2 = portfolioRisk([{ weight: 0.5, vol: 0.2 }, { weight: 0.5, vol: 0.2 }], 0);
  assert.ok(Math.abs(v2.vol - 0.2 / Math.SQRT2) < 1e-12);
  assert.equal(portfolioRisk([]), null);
});

test('stressTest: impatto proporzionale al beta e tempo di recupero al CAGR netto', () => {
  const [corr, bear] = stressTest({ beta: 0.85, netCagr: 0.0754, capital: 12000 });
  assert.ok(Math.abs(corr.impact - 0.085) < 1e-12);
  assert.ok(Math.abs(bear.impact - 0.255) < 1e-12);
  assert.ok(Math.abs(bear.capitalAfter - 12000 * 0.745) < 1e-6);
  assert.ok(bear.recoveryMonths > 40 && bear.recoveryMonths < 60, String(bear.recoveryMonths));
  assert.equal(stressTest({ beta: 1, netCagr: -0.01, capital: 1000 })[0].recoveryMonths, null);
  assert.equal(stressTest({ beta: 0, netCagr: 0.03, capital: 1000 })[1].impact, 0);
});

test('classifyPortfolio: tipo dal rischio (volatilità o MDD)', () => {
  assert.equal(classifyPortfolio({ vol: 0.05 }).type, 'prudente');
  assert.equal(classifyPortfolio({ vol: 0.10 }).type, 'moderato');
  assert.equal(classifyPortfolio({ vol: 0.135 }).type, 'bilanciato');
  assert.equal(classifyPortfolio({ vol: 0.20 }).type, 'dinamico');
  assert.equal(classifyPortfolio({ vol: 0.40 }).type, 'speculativo');
  // senza volatilità ripiega sull'MDD (0,60 × 0,45 = 0,27 → dinamico/speculativo)
  assert.equal(classifyPortfolio({ mdd: 0.60 }).type, 'speculativo');
  assert.equal(classifyPortfolio({}), null);
});

test('portfolioStress: scenari derivati da σ_p e MDD_p del portafoglio', () => {
  const r = portfolioStress({ vol: 0.12, mdd: 0.3, netCagr: 0.07, capital: 10000 });
  assert.equal(r.length, 3);
  assert.ok(Math.abs(r[0].drop - 0.12) < 1e-9); // 1σ
  assert.ok(Math.abs(r[1].drop - 0.24) < 1e-9); // 2σ (< mdd)
  assert.ok(Math.abs(r[2].drop - 0.30) < 1e-9); // MDD
  assert.ok(Math.abs(r[2].capitalAfter - 7000) < 1e-6);
  assert.ok(r[2].recoveryMonths > 50 && r[2].recoveryMonths < 70);
  // senza volatilità: solo lo scenario MDD
  assert.equal(portfolioStress({ mdd: 0.4, netCagr: 0.05, capital: 1000 }).length, 1);
  // CAGR nullo: nessun recupero
  assert.equal(portfolioStress({ vol: 0.1, netCagr: 0, capital: 1000 })[0].recoveryMonths, null);
});

test('stockScenarios: metodo azioni del documento 010 (base/bull/bear, niente TER)', () => {
  const s = stockScenarios({ capital: 2400, cagr: 0.156, tax: 0.26, mdd: 0.4, years: 5 });
  // base: 2400 × 1,156^5 = 4954,3 → plus 2554,3 − 26% = netto ~1890
  assert.ok(Math.abs(s.base.netGain - 1890) < 5, String(s.base.netGain));
  assert.ok(Math.abs(s.base.finalCapital - 4290) < 5);
  // bull: CAGR × 1,4 = 21,84%
  assert.ok(Math.abs(s.bullCagr - 0.2184) < 1e-9);
  assert.ok(s.bull.netGain > s.base.netGain);
  // bear: perdita = MDD, nessuna imposta
  assert.ok(Math.abs(s.bear.netGain + 2400 * 0.4) < 1e-6);
  assert.equal(stockScenarios({ capital: 0, cagr: 0.1 }), null);
});

test('totalPortfolioStress (doc 041): crash al picco, MDD ponderato, recovery', () => {
  const items = [
    { name: 'A', amount: 6000, cagr: 0.1, ter: 0, mdd: 0.5 },
    { name: 'B', amount: 4000, cagr: 0.06, ter: 0.002, mdd: 0.3 },
  ];
  const s = totalPortfolioStress({ items, years: 5 });
  assert.ok(Math.abs(s.capital - 10000) < 1e-9);
  // MDD ponderato = 0,6×0,5 + 0,4×0,3 = 0,42
  assert.ok(Math.abs(s.mdd - 0.42) < 1e-9);
  assert.ok(s.peak > s.capital);
  assert.ok(Math.abs(s.postCrash - s.peak * (1 - 0.42)) < 1e-6);
  assert.ok(s.recoveryMonths > 0);
  assert.equal(s.breakdown.length, 2);
  assert.equal(totalPortfolioStress({ items: [] }), null);
});
