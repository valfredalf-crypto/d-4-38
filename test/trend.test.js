import test from 'node:test';
import assert from 'node:assert/strict';
import { trend30, trendScore, TREND_MIN_SESSIONS } from '../public/js/trend.js';

const DAY = 86400;
const NOW = Date.UTC(2026, 10, 25, 16) ; // 25 nov 2026, 16:00 UTC (ms)
// chiusure giornaliere alle 16:30 UTC dei giorni precedenti (ieri, l'altro ieri, …)
const series = (values) => ({ ts: values.map((_, i) => NOW / 1000 - (values.length - i) * DAY + 1800), cl: values });

test('crescita a 30 giorni: salita regolare dell’1% a seduta', () => {
  const vals = Array.from({ length: 40 }, (_, k) => 100 * 1.01 ** k);
  const { ts, cl } = series(vals);
  const t = trend30(ts, cl, null, NOW);
  assert.ok(t.sn >= 28 && t.sn <= 30);
  assert.ok(Math.abs(t.wm - 0.01) < 1e-4); // ogni incremento è +1%
  assert.ok(t.sl > 0.01 && t.sl < 0.014); // la curva cumulata sale di poco più dell’1% a seduta (capitalizzazione)
  assert.ok(Math.abs(trendScore(t) - (t.sl + t.wm) / 2) < 1e-12);
});

test('crescita a 30 giorni: più peso alle sedute recenti', () => {
  // stesso rendimento totale: prima fermo poi in salita (A), prima in salita poi fermo (B)
  const up = Array.from({ length: 10 }, (_, k) => 100 * 1.02 ** (k + 1));
  const a = series([...Array(21).fill(100), ...up]);
  const b = series([100, ...up, ...Array(20).fill(up[9])]);
  const ta = trend30(a.ts, a.cl, null, NOW);
  const tb = trend30(b.ts, b.cl, null, NOW);
  assert.ok(ta.wm > 0.012 && tb.wm < 0.004, `${ta.wm} ${tb.wm}`); // la salita recente pesa molto di più di quella vecchia
  assert.ok(ta.sl > 0 && tb.sl > 0);
  // discesa: entrambi negativi
  const d = series(Array.from({ length: 35 }, (_, k) => 100 * 0.99 ** k));
  const td = trend30(d.ts, d.cl, null, NOW);
  assert.ok(td.sl < 0 && td.wm < 0 && trendScore(td) < 0);
});

test('crescita a 30 giorni: prezzo attuale come ultima seduta, dati insufficienti o impossibili', () => {
  const vals = Array.from({ length: 35 }, () => 100);
  const { ts, cl } = series(vals);
  // prezzo di oggi +10% non ancora nello storico: è l’ultima seduta e pesa più di tutte
  const t = trend30(ts, cl, 110, NOW);
  assert.ok(t.wm > 0.01 && t.sl > 0);
  // prezzo uguale all’ultima chiusura (mercato chiuso): nessuna seduta aggiunta
  assert.equal(trend30(ts, cl, 100, NOW).sn, trend30(ts, cl, null, NOW).sn);
  // barra di oggi già nello storico: sostituita dal prezzo attuale, non duplicata
  const today = { ts: [...ts, NOW / 1000 - 600], cl: [...cl, 105] };
  const tt = trend30(today.ts, today.cl, 108, NOW);
  assert.equal(tt.sn, trend30(today.ts, today.cl, null, NOW).sn);
  assert.ok(tt.wm > trend30(today.ts, today.cl, null, NOW).wm);
  // poche sedute: nessun valore
  const few = series(Array.from({ length: TREND_MIN_SESSIONS - 2 }, (_, k) => 100 + k));
  assert.equal(trend30(few.ts, few.cl, null, NOW), null);
  // salto impossibile (raggruppamento non corretto): nessun valore
  const bad = series([...Array(20).fill(1), ...Array(15).fill(50)]);
  assert.equal(trend30(bad.ts, bad.cl, null, NOW), null);
  assert.equal(trend30([], [], 10, NOW), null);
  assert.equal(trendScore(null), null);
  assert.equal(trendScore({ sl: 0.01 }), null);
});

test('variazioni passate: la crescita a 30 giorni entra nei dati delle quotazioni', async () => {
  const { performanceFrom } = await import('../lib/market.js');
  const vals = Array.from({ length: 40 }, (_, k) => 100 * 1.01 ** k);
  const { ts, cl } = series(vals);
  const p = performanceFrom({ timestamps: ts, closesEur: cl }, cl.at(-1), NOW);
  assert.ok(p.sl > 0.009 && Math.abs(p.wm - 0.01) < 1e-4 && p.sn >= 28);
  // storico troppo corto: i campi mancano, le altre variazioni restano
  const s = performanceFrom({ timestamps: ts.slice(-3), closesEur: cl.slice(-3) }, cl.at(-1), NOW);
  assert.equal(s.sl, undefined);
  assert.ok('w' in s);
});
