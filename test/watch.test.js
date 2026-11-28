import test from 'node:test';
import assert from 'node:assert/strict';
import { WATCH_KEY, FAV_FOLDER, WATCH_MAX, parseWatch, addWatch, removeWatch, safeFileName, cardFileName, cardDocument } from '../public/js/watch.js';

const A = { symbol: 'LS:1', isin: 'CA74167K1093', name: 'Primaris REIT', type: 'stock' };
const B = { symbol: 'EUNL.DE', isin: 'IE00B4L5Y983', name: 'iShares Core MSCI World', type: 'etf' };

test('watch list: aggiunta in cima, niente doppioni, data e prezzo della prima volta', () => {
  assert.equal(WATCH_KEY, 'trmc.watch');
  assert.equal(FAV_FOLDER, 'Strumenti preferiti');
  let l = addWatch([], A, { now: 1000, price: 12.5 });
  l = addWatch(l, B, { now: 2000, price: 100 });
  assert.deepEqual(l.map((x) => x.symbol), ['EUNL.DE', 'LS:1']);
  l = addWatch(l, A, { now: 3000, price: 99 });
  assert.deepEqual(l.map((x) => x.symbol), ['LS:1', 'EUNL.DE']);
  assert.equal(l[0].at, 1000);
  assert.equal(l[0].px, 12.5);
  assert.deepEqual(removeWatch(l, 'LS:1').map((x) => x.symbol), ['EUNL.DE']);
  assert.equal(addWatch(l, null).length, 2);
  assert.equal(addWatch([], A, { now: 1, price: NaN })[0].px, null);
});

test('watch list: lettura dalla memoria del browser tollera dati rovinati', () => {
  assert.deepEqual(parseWatch(null), []);
  assert.deepEqual(parseWatch('non è json'), []);
  assert.deepEqual(parseWatch('{"a":1}'), []);
  const l = parseWatch(JSON.stringify([{ symbol: 'X', isin: 'IE00B4L5Y983', name: 'Nome', type: 'etf', at: 5, px: 3 }, { symbol: 'X' }, null, { isin: 'senza simbolo' }, { symbol: 'Y', px: -1, at: 'ieri' }]));
  assert.deepEqual(l, [{ symbol: 'X', isin: 'IE00B4L5Y983', name: 'Nome', type: 'etf', at: 5, px: 3 }, { symbol: 'Y', isin: '', name: 'Y', type: '', at: 0, px: null }]);
  const many = Array.from({ length: WATCH_MAX + 20 }, (_, k) => ({ symbol: 'S' + k }));
  assert.equal(parseWatch(many).length, WATCH_MAX);
  // andata e ritorno
  const rt = addWatch(addWatch([], A, { now: 10, price: 1.5 }), B, { now: 20, price: 2 });
  assert.deepEqual(parseWatch(JSON.stringify(rt)), rt);
});

test('nome del file della scheda: valido su Windows, con ISIN, nome e data', () => {
  assert.equal(safeFileName('A/B\\C:D*E?F"G<H>I|J'), 'A B C D E F G H I J');
  assert.equal(safeFileName('  nome.  '), 'nome');
  assert.equal(safeFileName(''), 'scheda');
  assert.equal(safeFileName('CON'), '_CON');
  assert.equal(safeFileName('x'.repeat(300)).length, 110);
  const now = new Date(2026, 10, 28, 9, 5).getTime();
  assert.equal(cardFileName(A, now), 'CA74167K1093 - Primaris REIT - 2026-11-28 0905.html');
  assert.equal(cardFileName({ symbol: 'BTC-EUR', name: 'Bitcoin: EUR?' }, now), 'BTC-EUR - Bitcoin EUR - 2026-11-28 0905.html');
  assert.ok(!/[\\/:*?"<>|]/.test(cardFileName({ symbol: 'A:B', isin: '', name: 'x/y|z' }, now)));
});

test('pagina della scheda: autonoma, con titolo, data, avviso e senza HTML iniettato dal nome', () => {
  const html = cardDocument({ title: 'Primaris <b>REIT</b>', sub: 'LS:1 · CA74167K1093 · Azione', bodyHtml: '<div class="kpis"><div class="kpi">ok</div></div>', css: 'body{color:red}</style><script>x</script>', exportedAt: '28/11/2026, 09:05', dataAt: '28/11, 03:03', source: 'https://example.org/app/' });
  assert.ok(html.startsWith('<!doctype html>'));
  assert.ok(html.includes('Primaris &lt;b&gt;REIT&lt;/b&gt;'));
  assert.ok(!html.includes('<b>REIT</b>'));
  assert.ok(html.includes('<main id="d-body">'));
  assert.ok(html.includes('<div class="kpi">ok</div>'));
  assert.ok(html.includes('Scheda esportata il 28/11/2026, 09:05'));
  assert.ok(html.includes('dati del modello aggiornati al 28/11, 03:03'));
  assert.ok(html.includes('non una raccomandazione'));
  assert.ok(!/<\/style><script>/.test(html), 'il foglio di stile non può chiudere il proprio blocco');
  assert.equal((html.match(/<\/style>/g) || []).length, 2);
  const min = cardDocument({ title: 'X' });
  assert.ok(min.includes('<title>X · scheda TR Monte Carlo</title>'));
  assert.ok(!min.includes('apri l’app'));
});
