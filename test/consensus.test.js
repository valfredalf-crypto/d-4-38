import test from 'node:test';
import assert from 'node:assert/strict';
import { targetUpside, rawDividend, recoLabel, compareConsensus, compareDividend, doubtfulTarget, AN_MIN_RELIABLE, DIV_EXTREME, ETF_UPSIDE_CAP } from '../public/js/consensus.js';
import { tableResult } from '../public/js/analyze.js';

test('potenziale degli analisti: prezzo obiettivo ÷ prezzo − 1, non limitato', () => {
  assert.ok(Math.abs(targetUpside({ targetMean: 13.25, price: 2.26, analysts: 1 }) - (13.25 / 2.26 - 1)) < 1e-12);
  assert.ok(targetUpside({ targetMean: 13.25, price: 2.26, analysts: 1 }) > 4.8); // oltre il +50% del modello
  assert.ok(Math.abs(targetUpside({ targetMean: 90, price: 100, analysts: 12 }) + 0.1) < 1e-12);
  assert.equal(targetUpside({ targetMean: 13.25, price: 2.26, analysts: 0 }), null);
  assert.equal(targetUpside({ targetMean: 13.25, price: 2.26, analysts: null }), null);
  assert.equal(targetUpside({ targetMean: null, price: 2.26, analysts: 5 }), null);
  assert.equal(targetUpside({ targetMean: 10, price: 0, analysts: 5 }), null);
  assert.equal(targetUpside(null), null);
  assert.equal(AN_MIN_RELIABLE, 3);
});

test('dividendo dichiarato: senza il limite dell\'8% del modello', () => {
  assert.equal(rawDividend({ dividendYield: 0.1809 }), 0.1809);
  assert.equal(rawDividend({ dividendYield: 0.03 }), 0.03);
  assert.equal(rawDividend({ dividendYield: 0 }), null);
  assert.equal(rawDividend({ dividendYield: null }), null);
  assert.equal(rawDividend({ dividendYield: 7 }), null);
  assert.equal(rawDividend(null), null);
});

test('giudizio degli analisti in italiano', () => {
  assert.equal(recoLabel('buy'), 'Acquista');
  assert.equal(recoLabel('hold'), 'Tieni');
  assert.equal(recoLabel('sell'), 'Vendi (forte)');
  assert.equal(recoLabel('none'), '');
  assert.equal(recoLabel(undefined), '');
});

test('classifica: valori attendibili per potenziale decrescente, poi quelli dubbi, in fondo chi non ha analisti per dividendo', () => {
  const rows = [
    { n: 'senza nulla', anUp: null, divY: null },
    { n: 'solo dividendo 2%', anUp: null, divY: 0.02 },
    { n: '+20% div 1%', anUp: 0.2, divY: 0.01 },
    { n: '+485% 1 analista', anUp: 4.85, anWarn: true, divY: null },
    { n: '+20% div 5%', anUp: 0.2, divY: 0.05 },
    { n: 'solo dividendo 9%', anUp: null, divY: 0.09 },
    { n: '-10%', anUp: -0.1, divY: 0.07 },
    { n: '+30% 2 analisti', anUp: 0.3, anWarn: true, divY: 0.03 },
    { n: '+20% senza div', anUp: 0.2, divY: null },
    { n: 'solo dividendo 169%', anUp: null, divY: 1.69 },
  ];
  const sorted = [...rows].sort((a, b) => compareConsensus(a, b));
  assert.deepEqual(sorted.map((r) => r.n), ['+20% div 5%', '+20% div 1%', '+20% senza div', '-10%', '+485% 1 analista', '+30% 2 analisti', 'solo dividendo 9%', 'solo dividendo 2%', 'solo dividendo 169%', 'senza nulla']);
  // ordine crescente: si inverte il potenziale dentro ogni fascia, le fasce restano nello stesso ordine
  const asc = [...rows].sort((a, b) => compareConsensus(a, b, 1));
  assert.deepEqual(asc.map((r) => r.n).slice(0, 2), ['-10%', '+20% div 5%']);
  assert.deepEqual(asc.map((r) => r.n).slice(4, 6), ['+30% 2 analisti', '+485% 1 analista']);
  assert.equal(asc.at(-1).n, 'senza nulla');
  assert.equal(compareConsensus({ anUp: 0.1, divY: 0.02 }, { anUp: 0.1, divY: 0.02 }), 0);
});

test('classifica per dividendo: prima i rendimenti ordinari, poi quelli oltre il 12%, in fondo chi non ne ha', () => {
  const rows = [{ n: 'niente', divY: null }, { n: '169%', divY: 1.69 }, { n: '4%', divY: 0.04 }, { n: '12%', divY: 0.12 }, { n: '20%', divY: 0.2 }, { n: '8%', divY: 0.08 }];
  assert.deepEqual([...rows].sort((a, b) => compareDividend(a, b)).map((r) => r.n), ['12%', '8%', '4%', '169%', '20%', 'niente']);
  assert.deepEqual([...rows].sort((a, b) => compareDividend(a, b, 1)).map((r) => r.n), ['4%', '8%', '12%', '20%', '169%', 'niente']);
  assert.equal(DIV_EXTREME, 0.12);
  assert.ok(ETF_UPSIDE_CAP > 0.49 && ETF_UPSIDE_CAP < 0.5);
});

test('dati pubblicati: potenziale non limitato, numero di analisti, giudizio e dividendo dichiarato', () => {
  const sim = { maxLoss: 0.3, netGain: 0.2 };
  const t = tableResult({ forward: { expected: 0.07, analystUpside: 0.5, analystCount: 4, targetUpside: 4.8628, targetAnalysts: 4, reco: 'hold', divRaw: 0.1809 }, sim });
  assert.equal(t.forward.upside, 0.5);
  assert.equal(t.forward.tgtUp, 4.8628);
  assert.equal(t.forward.tgtN, 4);
  assert.equal(t.forward.reco, 'hold');
  assert.equal(t.forward.divRaw, 0.1809);
  const none = tableResult({ forward: { expected: 0.07 }, sim });
  assert.equal('tgtUp' in none.forward, false);
  assert.equal('divRaw' in none.forward, false);
});

test('potenziale da prendere con cautela: pochi analisti o rialzo oltre il +100%', () => {
  assert.equal(doubtfulTarget(4.85, 1), true); // 2020 Bulkers: obiettivo fissato prima del maxi-dividendo
  assert.equal(doubtfulTarget(0.2, 2), true);
  assert.equal(doubtfulTarget(1.4, 20), true);
  assert.equal(doubtfulTarget(0.35, 12), false);
  assert.equal(doubtfulTarget(0.35, null), false); // ETF: media sui titoli del fondo
  assert.equal(doubtfulTarget(-0.2, 8), false);
});

test('dati pubblicati: 10° percentile degli scenari (netto nel 90% degli scenari)', () => {
  const t = tableResult({ forward: { expected: 0.07 }, sim: { netP10: -0.21347, netP25: -0.06, netMedian: 0.18 } });
  assert.equal(t.sim.netP10, -0.2135);
  assert.equal('netP10' in tableResult({ forward: {}, sim: { netP25: -0.06 } }).sim, false);
});
