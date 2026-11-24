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

test('variazione di oggi come Trade Republic: riferimento alla chiusura del giorno prima', async () => {
  const { sessionView, tradingDay } = await import('../lib/market.js');
  const at = (d, h, m = 0) => Date.UTC(2026, 10, d, h - 1, m) / 1000; // ora di Berlino (UTC+1), novembre 2026
  // martedì 24 novembre, 11:00: azione USA con seduta chiusa lunedì alle 22:00
  const now = at(24, 11) * 1000;
  assert.equal(tradingDay(now), '2026-11-24');
  const usa = { price: 165, previousClose: 125, marketTime: at(23, 22) };
  // con scambi prima dell'apertura: prezzo attuale e variazione dalla chiusura di ieri (non il +32% di ieri)
  assert.deepEqual(sessionView({ ...usa, prePrice: 157, preTime: at(24, 10, 59) }, now), { price: 157, time: at(24, 10, 59), ref: 165 });
  // senza prezzi di oggi: nessuna variazione, resta l'ultima chiusura
  assert.deepEqual(sessionView(usa, now), { price: 165, time: at(23, 22), ref: null });
  // scambi dopo la chiusura fino a notte: contano come movimento di oggi
  assert.deepEqual(sessionView({ ...usa, postPrice: 160, postTime: at(24, 1, 30) }, now), { price: 160, time: at(24, 1, 30), ref: 165 });
  // seduta di oggi aperta: riferimento = chiusura precedente
  assert.deepEqual(sessionView({ price: 130, previousClose: 131, marketTime: at(24, 10, 40) }, now), { price: 130, time: at(24, 10, 40), ref: 131 });
  // fine settimana e lunedì prima delle 7:30: vale ancora la seduta di venerdì; dalle 7:30 non più
  const fri = { price: 100, previousClose: 90, marketTime: at(20, 17, 35) };
  assert.equal(tradingDay(at(21, 12) * 1000), '2026-11-20');
  assert.equal(sessionView(fri, at(21, 12) * 1000).ref, 90);
  assert.equal(tradingDay(at(23, 7) * 1000), '2026-11-20');
  assert.equal(sessionView(fri, at(23, 7) * 1000).ref, 90);
  assert.equal(tradingDay(at(23, 8) * 1000), '2026-11-23');
  assert.equal(sessionView(fri, at(23, 8) * 1000).ref, null);
  // prezzi fuori seduta vecchi (oltre 20 ore) ignorati
  assert.equal(sessionView({ ...usa, prePrice: 157, preTime: at(22, 10) }, now).price, 165);
});

test('storico nella sezione netto più probabile: variazioni non credibili scartate', async () => {
  const { histValues } = await import('../public/js/history.js');
  const etf = { type: 'etf' };
  const stock = { type: 'stock' };
  // valori normali: passano tali e quali
  assert.deepEqual(histValues(stock, { changePct: -0.0478, perf: { w: 0.0052, w2: -0.03, m: -0.2346, y: -0.0863 } }), { hD: -0.0478, hW: 0.0052, hW2: -0.03, hM: -0.2346, hY: -0.0863 });
  // dati mancanti: null, mai NaN o undefined
  assert.deepEqual(histValues(stock, { changePct: null }), { hD: null, hW: null, hW2: null, hM: null, hY: null });
  assert.deepEqual(histValues(stock, undefined), { hD: null, hW: null, hW2: null, hM: null, hY: null });
  // ETF non a leva a +110% in un giorno: chiusura precedente sbagliata
  assert.equal(histValues(etf, { changePct: 1.1031, perf: { w: -0.0081 } }).hD, null);
  assert.equal(histValues({ type: 'etf', leveraged: true }, { changePct: 0.31, perf: { w: 0.4 } }).hD, 0.31);
  // azione a +789% oggi ma −12% nella settimana: incoerente; +109% oggi e +105% nella settimana: reale
  assert.equal(histValues(stock, { changePct: 7.8889, perf: { w: -0.1241 } }).hD, null);
  assert.equal(histValues(stock, { changePct: 1.0908, perf: { w: 1.05 } }).hD, 1.0908);
  // raggruppamenti non corretti dalla fonte
  assert.equal(histValues(stock, { changePct: null, perf: { w: 9999.0005 } }).hW, null);
  assert.equal(histValues({ type: 'etf', leveraged: true }, { changePct: 0.1, perf: { y: 598.2 } }).hY, null);
  assert.equal(histValues(stock, { changePct: 0, perf: { y: 13.15 } }).hY, 13.15);
});
