import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { isValidIsin } from '../lib/isin.js';
import { parseInstrumentCsv, mapType } from '../lib/importer.js';
import { convertSeries, normalizeCurrency } from '../lib/market.js';

test('ISIN: cifra di controllo', () => {
  for (const ok of ['US0378331005', 'IE00B4L5Y983', 'DE0007164600', 'IE00B53SZB19', 'NL0015435975', 'GB00BVZK7T90']) assert.ok(isValidIsin(ok), ok);
  for (const ko of ['US0378331006', 'IE00B53SL201', 'XX', '', null]) assert.ok(!isValidIsin(ko), String(ko));
});

test('universo iniziale: ISIN validi, simboli unici, tipi ammessi', () => {
  const { meta, instruments } = JSON.parse(fs.readFileSync('data/instruments.json', 'utf8'));
  assert.ok(meta.verifiedAt);
  const symbols = new Set();
  for (const i of instruments) {
    assert.ok(!symbols.has(i.symbol), `duplicato ${i.symbol}`);
    symbols.add(i.symbol);
    assert.ok(['stock', 'etf', 'crypto'].includes(i.type));
    if (i.type !== 'crypto') assert.ok(isValidIsin(i.isin), `${i.symbol} ${i.isin}`);
    else assert.match(i.symbol, /-EUR$/);
  }
  const isins = instruments.filter((i) => i.isin).map((i) => i.isin);
  assert.equal(new Set(isins).size, isins.length, 'ISIN duplicati');
});

test('import CSV formato Xetra', () => {
  const csv = [
    'Market:;XETR',
    'Date Last Update:;22.10.2026',
    'Product Status;Instrument Status;Instrument;ISIN;Product ID;Instrument ID;WKN;Mnemonic;MIC Code;CCP eligible Code;Trading Model Type;Product Assignment Group;Product Assignment Group Description;Instrument Type;Currency',
    'Active;Active;ISHSIII-CORE MSCI WLD DLA;IE00B4L5Y983;1;1;A0RPWH;EUNL;XETR;Y;CT;ETF1;ETFs;ETF;EUR',
    'Active;Active;SAP SE O.N.;DE0007164600;2;2;716460;SAP;XETR;Y;CT;DAX1;DAX;CS;EUR',
    'Active;Active;SOME BOND;DE000ABC1234;3;3;ABC123;XYZ1;XETR;Y;CT;BND;Bonds;BOND;EUR',
    'Active;Active;BAD ISIN;DE0007164601;4;4;1;BAD;XETR;Y;CT;X;X;CS;EUR',
  ].join('\n');
  const { format, rows } = parseInstrumentCsv(csv);
  assert.equal(format, 'xetra');
  assert.deepEqual(rows.map((r) => [r.symbol, r.type]), [['EUNL.DE', 'etf'], ['SAP.DE', 'stock']]);
});

test('import elenco semplice di ISIN', () => {
  const { format, rows } = parseInstrumentCsv('IE00B4L5Y983\nUS0378331005\nnot-an-isin!\n');
  assert.equal(format, 'list');
  assert.deepEqual(rows, [{ isin: 'IE00B4L5Y983' }, { isin: 'US0378331005' }]);
});

test('import CSV generico con virgole e virgolette', () => {
  const { rows } = parseInstrumentCsv('Name,ISIN,Ticker,Type\n"Apple, Inc.",US0378331005,AAPL,Stock\n');
  assert.deepEqual(rows[0], { isin: 'US0378331005', name: 'Apple, Inc.', symbol: 'AAPL', type: 'stock', currency: null });
  assert.equal(mapType('ETC'), 'etf');
  assert.equal(mapType('Warrant'), null);
});

test('conversione in EUR con cambio storico e pence', () => {
  assert.deepEqual(normalizeCurrency('GBp'), ['GBP', 100]);
  assert.deepEqual(normalizeCurrency('USD'), ['USD', 1]);
  // prezzi USD, cambio EURUSD 1.0 poi 1.25
  const out = convertSeries([10, 20, 30], [100, 100, 125], 1, [5, 25], [1.0, 1.25]);
  assert.deepEqual(out, [100, 100, 100]);
});

test('rendimenti recenti: settimana, mese, da inizio anno', async () => {
  const { performanceFrom } = await import('../lib/market.js');
  const day = 86400;
  const now = Date.UTC(2026, 9, 23, 12) / 1000; // 23 ott 2026
  const ts = [Date.UTC(2025, 11, 31, 9) / 1000, Date.UTC(2026, 0, 2, 9) / 1000, Date.UTC(2026, 8, 23, 9) / 1000, now - 7 * day - 3600, now - 2 * day];
  const cl = [100, 101, 120, 150, 160];
  const p = performanceFrom({ timestamps: ts, closesEur: cl }, 165, now * 1000);
  assert.equal(p.ytd, 0.65); // da 100 (31 dic) a 165
  assert.equal(p.m, 0.375); // da 120 (23 set) a 165
  assert.equal(p.w, 0.1); // da 150 (7 giorni fa) a 165
  assert.equal(p.m3, 0.6337); // da 101 (2 gen, ultima chiusura prima del 23 lug) a 165
  assert.equal(p.y, null); // lo storico non arriva a un anno fa
  assert.equal(performanceFrom({ timestamps: [now - day], closesEur: [10] }, 11, now * 1000).ytd, null); // nessuna chiusura dell'anno scorso
});
