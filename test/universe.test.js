import test from 'node:test';
import assert from 'node:assert/strict';
import { isLeveraged, mergeUnique, selectTop, isEuroListing, hasImplausibleJumps } from '../lib/universe.js';
import { findCsvLinks } from '../lib/xetra.js';
import { parseInstrumentCsv } from '../lib/importer.js';
import { applyLivePrice } from '../public/js/analyze.js';

test('esclusione prodotti a leva e short', () => {
  for (const n of ['LEVDAX X2', 'Xtrackers S&P 500 2x Leveraged Daily Swap', 'WisdomTree NASDAQ 100 3x Daily Leveraged', 'Lyxor Daily ShortDAX x2', 'Amundi ShortDAX Daily (-1x) Inverse', 'iShares Bitcoin Short', 'NASDAQ-3X']) {
    assert.ok(isLeveraged(n), n);
  }
  for (const n of ['iShares Core MSCI World', 'iShares $ Short Duration Corp Bond', 'Xtrackers II EUR Overnight Rate Swap', 'Vanguard FTSE All-World', 'SPDR Bloomberg 0-3 Year Euro Short-Term Corporate Bond', 'Xetra-Gold']) {
    assert.ok(!isLeveraged(n), n);
  }
});

test('unione senza doppioni per simbolo e ISIN (vince la prima lista)', () => {
  const a = [{ symbol: 'AAPL', isin: 'US0378331005', type: 'stock' }];
  const b = [{ symbol: 'APC.DE', isin: 'US0378331005', type: 'stock' }, { symbol: 'SAP.DE', isin: 'DE0007164600', type: 'stock' }, { symbol: 'AAPL', isin: null, type: 'stock' }];
  assert.deepEqual(mergeUnique(a, b).map((i) => i.symbol), ['AAPL', 'SAP.DE']);
});

test('selezione dei migliori N per gruppo', () => {
  const rows = [
    { inst: { symbol: 'a', type: 'stock' }, netGain: 0.1 },
    { inst: { symbol: 'b', type: 'stock' }, netGain: 0.5 },
    { inst: { symbol: 'c', type: 'stock' }, netGain: 0.3 },
    { inst: { symbol: 'd', type: 'etf' }, netGain: 0.2 },
    { inst: { symbol: 'e', type: 'etf' }, netGain: NaN },
  ];
  assert.deepEqual(selectTop(rows, 2).map((r) => r.inst.symbol), ['b', 'c', 'd']);
});

test('link al CSV Xetra (escluso quello di simulazione)', () => {
  const html = '<a href="/resource/blob/123/abc/data/t7-xetr-allTradableInstruments.csv">x</a><a href="/resource/blob/9/data/simulation-t7-xetr-allTradableInstruments.csv">s</a>';
  assert.deepEqual(findCsvLinks(html, 'https://www.cashmarket.deutsche-boerse.com/cash-en/x'), ['https://www.cashmarket.deutsche-boerse.com/resource/blob/123/abc/data/t7-xetr-allTradableInstruments.csv']);
});

test('import Xetra: solo strumenti attivi', () => {
  const csv = 'Product Status;Instrument Status;Instrument;ISIN;Mnemonic;Instrument Type\nActive;Active;SAP;DE0007164600;SAP;CS\nActive;Inactive;OLD;US0378331005;APC;CS\n';
  assert.deepEqual(parseInstrumentCsv(csv).rows.map((r) => r.symbol), ['SAP.DE']);
});

test('prezzo live come ultima chiusura (ignorati valori anomali)', () => {
  const h = { timestamps: [1, 2], closesEur: [100, 110] };
  assert.deepEqual(applyLivePrice(h, 112).closesEur, [100, 112]);
  assert.equal(applyLivePrice(h, 112).closesEur === h.closesEur, false);
  assert.equal(applyLivePrice(h, 1100), h);
  assert.equal(applyLivePrice(h, null), h);
});

test('fallback solo su borse in euro e scarto dei dati anomali', () => {
  assert.ok(isEuroListing('IE00B8HGT870.SG') && isEuroListing('ECRD.MI') && isEuroListing('sap.de'));
  assert.ok(!isEuroListing('1673.T') && !isEuroListing('3USL.L') && !isEuroListing('EYPT'));
  assert.ok(hasImplausibleJumps([10, 11, 40, 41]));
  assert.ok(!hasImplausibleJumps([10, 7, 12, 9]));
  assert.ok(isLeveraged('Amundi MSCI USA Daily (2x) Leveraged UCITS ETF Acc'));
  assert.ok(isLeveraged('LS Short Volatility Long Tech ETP'));
});
