import test from 'node:test';
import assert from 'node:assert/strict';
import { expandFundOfFunds } from '../lib/snapshot.js';

const sub = {
  'VWRA.L': { holdings: [{ symbol: 'AAPL', name: 'Apple', weight: 0.05 }, { symbol: 'MSFT', name: 'Microsoft', weight: 0.04 }] },
  'VNRA.L': { holdings: [{ symbol: 'AAPL', name: 'Apple', weight: 0.08 }, { symbol: 'NVDA', name: 'NVIDIA', weight: 0.07 }] },
};
const fetchHoldings = async (s) => sub[s] || null;

test('expandFundOfFunds: fondo di fondi scomposto nei titoli sottostanti, pesi moltiplicati e sommati', async () => {
  const comp = {
    stockPosition: 0.8,
    bondPosition: 0.2,
    pe: 22,
    holdings: [
      { symbol: 'VWRA.L', name: 'Vanguard FTSE All-World ETF', weight: 0.5 },
      { symbol: 'VNRA.L', name: 'Vanguard FTSE North America', weight: 0.3 },
      { symbol: 'VAGF', name: 'Vanguard Global Aggt Bd ETF', weight: 0.2 },
    ],
  };
  const ex = await expandFundOfFunds(comp, fetchHoldings);
  assert.ok(ex);
  assert.equal(ex.fundOfFunds, true);
  assert.equal(ex.stockPosition, 0.8);
  assert.equal(ex.fundsExpanded, 2);
  const w = Object.fromEntries(ex.holdings.map((h) => [h.symbol, h.weight]));
  assert.ok(Math.abs(w.AAPL - (0.5 * 0.05 + 0.3 * 0.08)) < 1e-12);
  assert.ok(Math.abs(w.MSFT - 0.02) < 1e-12);
  assert.ok(Math.abs(w.NVDA - 0.021) < 1e-12);
  assert.equal(ex.holdings[0].symbol, 'AAPL');
  assert.ok(!ex.holdings.some((h) => /ETF/.test(h.name || '')));
});

test('expandFundOfFunds: null per un ETF normale o senza composizioni dei fondi partecipati', async () => {
  assert.equal(await expandFundOfFunds({ holdings: [{ symbol: 'AAPL', name: 'Apple', weight: 0.1 }] }, fetchHoldings), null);
  assert.equal(await expandFundOfFunds({ holdings: [{ symbol: 'XXX', name: 'Some UCITS ETF', weight: 0.9 }] }, fetchHoldings), null);
});

test('isFundHolding: nomi accorciati da Yahoo dei fondi Vanguard e società di gestione quotate', async () => {
  const { isFundHolding } = await import('../public/js/analyze.js');
  for (const n of ['Vanguard FTSE North America', 'Vanguard FTSE Emerg Markets', 'iShares Core MSCI World', 'Invesco S&P 500', 'Amundi MSCI Europe', 'Xtrackers DAX']) assert.equal(isFundHolding({ name: n }), true, n);
  for (const n of ['Invesco Ltd', 'Amundi SA', 'Franklin Resources Inc', 'Apple Inc', 'Vanguard Inc']) assert.equal(isFundHolding({ name: n }), n === 'Vanguard Inc', n);
});
