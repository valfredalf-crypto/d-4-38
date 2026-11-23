import test from 'node:test';
import assert from 'node:assert/strict';
import { stopDistance, dayDropLimit, isMonitored, updateWatch, evaluateHolding, evaluateAlerts, dueAlerts, COOLDOWN_MS } from '../public/js/alerts.js';

const NOW = Date.parse('2026-11-23T10:00:00Z');
const base = { symbol: 'APP', name: 'AppLovin', amount: 1939.51, vol: 0.7, leveraged: false, price: 100, changePct: 0.01, fc: { 7: { median: 0.04, p: 0.6 }, 14: { median: 0.07, p: 0.65 }, 30: { median: 0.1, p: 0.7 } } };
const watch = (ref, peak) => ({ ref, refAt: NOW - 5 * 864e5, peak, peakAt: NOW - 864e5 });

test('soglie: crescono con la volatilità e sono limitate', () => {
  assert.equal(stopDistance(0.05), 0.06);
  assert.equal(stopDistance(5), 0.3);
  assert.ok(stopDistance(0.7) > stopDistance(0.4));
  assert.ok(dayDropLimit(0.1) >= 0.05);
  assert.ok(dayDropLimit(1.5) > dayDropLimit(0.5));
});

test('sorveglianza: solo strumenti volatili, a leva o con alto guadagno atteso', () => {
  assert.equal(isMonitored({ vol: 0.15, fc: { 30: { median: 0.01 } } }), false);
  assert.equal(isMonitored({ vol: 0.5 }), true);
  assert.equal(isMonitored({ vol: 0.1, leveraged: true }), true);
  assert.equal(isMonitored({ vol: 0.1, fc: { 30: { median: 0.08 } } }), true);
  assert.deepEqual(evaluateHolding({ ...base, vol: 0.12, fc: { 7: { median: -0.05 }, 30: { median: -0.05 } } }, watch(100, 100), NOW), []);
});

test('riferimento e massimo si aggiornano solo al rialzo', () => {
  let w = updateWatch(null, 50, 1);
  assert.deepEqual([w.ref, w.peak], [50, 50]);
  w = updateWatch(w, 60, 2);
  assert.deepEqual([w.ref, w.peak], [50, 60]);
  w = updateWatch(w, 55, 3);
  assert.deepEqual([w.ref, w.peak], [50, 60]);
  assert.equal(updateWatch(null, null, 1), null);
});

test('nessun avviso con previsione positiva e prezzo vicino al massimo', () => {
  const a = evaluateHolding({ ...base, price: 101 }, watch(100, 101), NOW).filter((x) => x.level !== 'trim');
  assert.deepEqual(a, []);
});

test('previsione a breve negativa → vendi prima che cali', () => {
  const a = evaluateHolding({ ...base, fc: { 7: { median: -0.01, p: 0.45 }, 14: { median: -0.02 }, 30: { median: -0.03, p: 0.4 } } }, watch(100, 100), NOW);
  assert.equal(a[0].level, 'sell');
  assert.match(a[0].title, /vendi o riduci/);
});

test('solo 7 giorni negativo → attenzione, non vendita', () => {
  const a = evaluateHolding({ ...base, fc: { 7: { median: -0.01 }, 30: { median: 0.05 } } }, watch(100, 100), NOW);
  assert.equal(a[0].level, 'warn');
});

test('soglia di protezione: scatta oltre la distanza dal massimo e indica la perdita in euro', () => {
  const stop = stopDistance(0.7);
  const a = evaluateHolding({ ...base, price: 120 * (1 - stop - 0.01) }, watch(100, 120), NOW);
  const s = a.find((x) => x.key.startsWith('stop:'));
  assert.ok(s);
  assert.equal(s.level, 'sell');
  assert.match(s.text, /€/);
  const b = evaluateHolding({ ...base, price: 120 * (1 - stop + 0.01) }, watch(100, 120), NOW);
  assert.ok(!b.some((x) => x.key.startsWith('stop:')));
});

test('calo forte in giornata', () => {
  const a = evaluateHolding({ ...base, price: 95, changePct: -0.12 }, watch(100, 100), NOW);
  assert.ok(a.some((x) => x.key.startsWith('day:')));
});

test('restituita metà del guadagno', () => {
  const a = evaluateHolding({ ...base, price: 108 }, watch(100, 120), NOW);
  assert.ok(a.some((x) => x.key.startsWith('gb:')));
});

test('obiettivo raggiunto: invito a incassare, senza notifica sul dispositivo', () => {
  const alerts = evaluateHolding({ ...base, price: 112 }, watch(100, 112), NOW);
  const tp = alerts.find((x) => x.key.startsWith('tp:'));
  assert.ok(tp);
  assert.equal(tp.level, 'trim');
  assert.deepEqual(dueAlerts(alerts.filter((x) => x.level === 'trim'), {}, NOW), []);
});

test('valutazione di più posizioni: ordine per gravità e posizioni uscite tolte dal controllo', () => {
  const holds = [{ ...base, symbol: 'A', price: 112 }, { ...base, symbol: 'B', fc: { 7: { median: -0.02 }, 30: { median: -0.03 } } }];
  const prev = { A: watch(100, 112), B: watch(100, 100), GONE: watch(1, 1) };
  const { alerts, watch: w } = evaluateAlerts(holds, prev, NOW);
  assert.equal(alerts[0].level, 'sell');
  assert.ok(!('GONE' in w));
});

test('notifiche: stesso avviso non ripetuto per 6 ore, poi sì', () => {
  const a = [{ key: 'stop:APP:12000', level: 'sell' }];
  const sent = {};
  assert.equal(dueAlerts(a, sent, NOW).length, 1);
  assert.equal(dueAlerts(a, sent, NOW + 3600e3).length, 0);
  assert.equal(dueAlerts(a, sent, NOW + COOLDOWN_MS + 1).length, 1);
});
