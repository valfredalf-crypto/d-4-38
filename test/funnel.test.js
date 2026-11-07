import test from 'node:test';
import assert from 'node:assert/strict';
import { purityOk, funnelCheck } from '../public/js/funnel.js';

test('imbuto: purezza', () => {
  assert.ok(purityOk('iShares Core MSCI World UCITS ETF (Acc)'));
  assert.ok(purityOk('Vanguard FTSE All-World UCITS ETF (Acc)'));
  assert.ok(purityOk('iShares MSCI ACWI UCITS ETF (Acc)'));
  assert.ok(purityOk('Xtrackers MSCI World UCITS ETF 1C'));
  assert.ok(!purityOk('HSBC MSCI World Value Screened UCITS ETF USD Acc'));
  assert.ok(!purityOk('iShares MSCI World Quality Dividend Advanced UCITS ETF'));
  assert.ok(!purityOk('iShares MSCI ACWI SRI UCITS ETF'));
  assert.ok(!purityOk('iShares Core S&P 500 UCITS ETF'));
  assert.ok(!purityOk('Xtrackers MSCI World Information Technology UCITS ETF'));
  assert.ok(!purityOk('iShares Core MSCI World UCITS ETF EUR Hedged (Dist)'));
});

test('imbuto: tasse, dimensioni, costo', () => {
  const eunl = { type: 'etf', name: 'iShares Core MSCI World UCITS ETF (Acc)' };
  assert.equal(funnelCheck(eunl, { aum: { value: 131.8e9, currency: 'EUR' }, ter: 0.002 }, 'acc').pass, true);
  assert.equal(funnelCheck(eunl, { aum: { value: 131.8e9, currency: 'EUR' }, ter: 0.002 }, 'dist').failed, 'acc');
  assert.equal(funnelCheck(eunl, { aum: { value: 222e6, currency: 'EUR' }, ter: 0.002 }, 'acc').failed, 'size');
  assert.equal(funnelCheck(eunl, { aum: { value: 5e9, currency: 'EUR' }, ter: 0.004 }, 'acc').failed, 'cost');
  assert.equal(funnelCheck(eunl, {}, 'acc').failed, 'size');
});

test('Max Growth Score: penalità value, boost indici globali, fase 1', async () => {
  const { maxGrowthScore, phase1Check } = await import('../public/js/funnel.js');
  const world = maxGrowthScore({ type: 'etf', name: 'iShares Core MSCI World UCITS ETF (Acc)' }, { cagrHist: 0.12, cagrYears: 10 });
  assert.ok(Math.abs(world.score - 0.125) < 1e-12);
  const value = maxGrowthScore({ type: 'etf', name: 'HSBC MSCI World Value Screened UCITS ETF USD Acc' }, { cagrHist: 0.12 });
  assert.ok(Math.abs(value.score - 0.102) < 1e-12);
  assert.equal(phase1Check({ type: 'etf' }, { aum: { value: 222e6, currency: 'EUR' } }, 'acc').pass, false);
  assert.equal(phase1Check({ type: 'etf' }, { ter: 0.004 }, 'acc').pass, false);
  assert.equal(phase1Check({ type: 'etf' }, {}, 'dist').pass, false);
  assert.equal(phase1Check({ type: 'etf' }, { aum: { value: 2e9, currency: 'EUR' }, ter: 0.002 }, 'acc').pass, true);
});
