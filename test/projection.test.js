import test from 'node:test';
import assert from 'node:assert/strict';
import { GEMINI_PORTFOLIO, projectPortfolio, weightedParams } from '../public/js/projection.js';

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
