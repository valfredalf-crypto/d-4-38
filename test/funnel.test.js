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

test('Max Growth Score: storico + prospettive, volatilità, concentrazione, value, boost globale', async () => {
  const { maxGrowthScore, phase1Check } = await import('../public/js/funnel.js');
  const world = maxGrowthScore({ type: 'etf', name: 'iShares Core MSCI World UCITS ETF (Acc)' }, { cagrHist: 0.12 }, { expected: 0.088, vol: 0.13, top10: 0.28 }, 0.002);
  const tech = maxGrowthScore({ type: 'etf', name: 'iShares S&P 500 Information Technology Sector UCITS ETF' }, { cagrHist: 0.232 }, { expected: 0.117, vol: 0.25, top10: 0.7 }, 0.0015);
  const nasdaq = maxGrowthScore({ type: 'etf', name: 'iShares NASDAQ 100 UCITS ETF (Acc)' }, { cagrHist: 0.187 }, { expected: 0.098, vol: 0.21, top10: 0.5 }, 0.003);
  assert.ok(world.score > tech.score, `${world.score} vs ${tech.score}`);
  assert.ok(world.score > nasdaq.score, `${world.score} vs ${nasdaq.score}`);
  const value = maxGrowthScore({ type: 'etf', name: 'HSBC MSCI World Value Screened UCITS ETF USD Acc' }, { cagrHist: 0.12, cagr10: 0.1 }, null, null, { aum: { value: 5e9, currency: 'EUR' } });
  assert.ok(Math.abs(value.score - 0.102) < 1e-12);
  assert.equal(phase1Check({ type: 'etf' }, { aum: { value: 222e6, currency: 'EUR' } }, 'acc').pass, false);
  assert.equal(phase1Check({ type: 'etf' }, { ter: 0.004 }, 'acc').pass, false);
  assert.equal(phase1Check({ type: 'etf' }, {}, 'dist').pass, false);
  assert.equal(phase1Check({ type: 'etf' }, { aum: { value: 2e9, currency: 'EUR' }, ter: 0.002 }, 'acc').pass, true);
});

test('Max Growth Score: ETF piccoli, giovani o con strategie speciali sotto quelli puri', async () => {
  const { maxGrowthScore } = await import('../public/js/funnel.js');
  const fwd = { expected: 0.09, vol: 0.14, top10: 0.2 };
  const pure = maxGrowthScore({ type: 'etf', name: 'iShares Core MSCI World UCITS ETF (Acc)' }, { cagrHist: 0.1, cagr10: 0.1 }, fwd, 0.002, { aum: { value: 100e9, currency: 'EUR' } });
  const special = maxGrowthScore({ type: 'etf', name: 'Invesco Global Active ESG Equity UCITS ETF' }, { cagrHist: 0.12 }, fwd, 0.003, { aum: { value: 0.7e9, currency: 'EUR' } });
  assert.ok(pure.score > special.score, `${pure.score} vs ${special.score}`);
  assert.ok(special.special > 0 && special.small > 0 && special.young > 0);
});
