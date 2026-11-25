import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateSolid, oscLimit } from '../public/js/solid-alerts.js';

const NOW = Date.UTC(2026, 10, 25, 12, 0);
const base = { symbol: 'AAA.DE', isin: 'DE000AAAAAA1', name: 'Alfa', price: 100, changePct: 0.004, vol: 0.2, h: { hD: 0.004, hW: 0.03, hW2: 0.02, hM: 0.06 }, np: { d7: 0.004, d30: 0.02, y1: 0.05, y3: 0.14, y5: 0.25 }, solid: true };
const run = (item, prevWatch = {}, prevSet = null, now = NOW) => evaluateSolid([item], prevWatch, prevSet, now, 10000);
const kinds = (r) => r.alerts.map((a) => a.level + ':' + a.key.split(':')[0]);

test('notifiche sezione solidi: prima rilevazione, nessun avviso e nessun «entra»', () => {
  const r = run(base);
  assert.deepEqual(r.set, ['AAA.DE']);
  assert.deepEqual(r.alerts, []);
  assert.equal(r.watch['AAA.DE'].ref, 100);
  assert.equal(r.watch['AAA.DE'].peak, 100);
});

test('notifiche sezione solidi: nuovo ingresso (solo da un elenco precedente)', () => {
  assert.deepEqual(kinds(run(base, {}, ['ZZZ'])), ['new:snew']);
  assert.deepEqual(kinds(run(base, {}, ['AAA.DE'])), []);
});

test('notifiche sezione solidi: calo previsto a breve', () => {
  assert.deepEqual(kinds(run({ ...base, np: { ...base.np, d7: -0.002 } }, {}, ['AAA.DE'])), ['warn:sf7']);
  const s = run({ ...base, np: { ...base.np, d7: -0.002, d30: -0.01 } }, {}, ['AAA.DE']);
  assert.deepEqual(kinds(s), ['sell:sf']);
  assert.match(s.alerts[0].text, /−?-?20 € a 7 giorni/);
  assert.match(s.alerts[0].text, /-100 € a 30 giorni/);
});

test('notifiche sezione solidi: oscillazioni (soglia di protezione, giorno in calo, giorno in rialzo)', () => {
  assert.ok(Math.abs(oscLimit(0.1) - 0.02) < 1e-9 && oscLimit(0.6) > 0.07);
  // massimo 120, ora 100: −16,7% oltre la soglia di protezione (2 dev. std settimanali di vol 20% = 6%)
  const w = { 'AAA.DE': { ref: 100, refAt: NOW - 864e5, peak: 120, peakAt: NOW - 864e5 } };
  assert.deepEqual(kinds(run(base, w, ['AAA.DE'])), ['sell:sstop']);
  assert.deepEqual(kinds(run({ ...base, changePct: -0.03 }, {}, ['AAA.DE'])), ['warn:sday']);
  assert.deepEqual(kinds(run({ ...base, changePct: 0.03 }, {}, ['AAA.DE'])), ['osc:sup']);
  assert.deepEqual(kinds(run({ ...base, changePct: 0.01 }, {}, ['AAA.DE'])), []);
});

test('notifiche sezione solidi: esce dalla sezione (previsioni peggiorate = uscita, crescita ferma = attenzione)', () => {
  const out = run({ ...base, solid: false, np: { ...base.np, y3: 0.05 } }, {}, ['AAA.DE']);
  assert.deepEqual(kinds(out), ['sell:sx']);
  assert.match(out.alerts[0].text, /a 3 anni \+500 €/);
  assert.deepEqual(out.set, []);
  assert.deepEqual(out.watch, {}); // un'uscita non lascia riferimenti
  const ferma = run({ ...base, solid: false, h: { ...base.h, hW: -0.01 } }, {}, ['AAA.DE']);
  assert.deepEqual(kinds(ferma), ['warn:sx']);
  assert.match(ferma.alerts[0].text, /1 settimana -1,0%/);
  // fuori dalla sezione e non lo era: nessun avviso
  assert.deepEqual(run({ ...base, solid: false }, {}, ['ZZZ']).alerts, []);
});

test('notifiche sezione solidi: rafforzamento (previsione migliorata, ritracciamento con previsioni intatte)', () => {
  const w = (b, peak = 100) => ({ 'AAA.DE': { ref: 100, refAt: NOW - 5 * 864e5, peak, peakAt: NOW - 864e5, base: { at: NOW - 3600e3, ...b } } });
  assert.deepEqual(kinds(run(base, w({ y5: 0.2, d30: 0.02 }), ['AAA.DE'])), ['buy:sbu5']); // +5 punti a 5 anni
  assert.deepEqual(kinds(run(base, w({ y5: 0.25, d30: 0.005 }), ['AAA.DE'])), ['buy:sbu30']);
  assert.deepEqual(kinds(run(base, w({ y5: 0.25, d30: 0.02 }, 106), ['AAA.DE'])), ['buy:sbud']); // −5,7% dal massimo, soglia 6%
  // niente rafforzamento se c'è un calo previsto
  assert.deepEqual(kinds(run({ ...base, np: { ...base.np, d7: -0.001 } }, w({ y5: 0.2, d30: 0.02 }), ['AAA.DE'])), ['warn:sf7']);
});

test('notifiche sezione solidi: ordine per urgenza e riferimenti giornalieri', () => {
  const w = { 'AAA.DE': { ref: 100, refAt: NOW - 864e5, peak: 120, peakAt: NOW - 864e5, base: { at: NOW - 2 * 864e5, y5: 0.25, d30: 0.02 } } };
  const r = evaluateSolid([{ ...base, changePct: 0.03 }, { ...base, symbol: 'BBB.DE', np: { ...base.np, d7: -1, d30: -1 } }], w, ['AAA.DE', 'BBB.DE'], NOW, 10000);
  assert.deepEqual(kinds(r), ['sell:sstop', 'sell:sf', 'osc:sup']);
  assert.ok(r.watch['AAA.DE'].base.at === NOW); // base di più di un giorno fa: rinnovata
  assert.equal(r.watch['AAA.DE'].peak, 120);
});
