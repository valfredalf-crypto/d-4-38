import test from 'node:test';
import assert from 'node:assert/strict';
import { analystView, blendWithModel } from '../public/js/analysts.js';

const near = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) < e, `${a} ≠ ${b}`);

test('senza prezzo obiettivo: nessuna vista, vale il modello', () => {
  assert.equal(analystView({ upside: null }), null);
  assert.equal(blendWithModel(null, 0.08), 0.08);
});

test('ottimismo: del rialzo positivo si crede metà; il ribasso resta intero', () => {
  near(analystView({ upside: 0.2, analysts: 10, mom26: 0.02 }).value, 0.1);
  near(analystView({ upside: -0.1, analysts: 10, mom26: -0.02 }).value, -0.1);
});

test('pochi analisti pesano poco, molti pesano tanto', () => {
  near(analystView({ upside: 0.2, analysts: 3 }).weight, 3 / 8);
  near(analystView({ upside: 0.2, analysts: 30 }).weight, 30 / 35);
  near(analystView({ upside: 0.2 }).weight, 0.5); // ETF: media dei titoli del fondo
});

test('caso WashTec: prezzo −26% in 6 mesi, obiettivo +50% con 3 analisti → previsione vicina al modello, non +34%', () => {
  const v = analystView({ upside: 0.5, analysts: 3, mom26: -0.26 });
  assert.equal(v.stale, true);
  near(v.value, ((0.5 + (1.5 * 0.74 - 1)) / 2) * 0.5); // ≈ +15%
  const base = blendWithModel(v, 0.104);
  assert.ok(base > 0.1 && base < 0.14, String(base)); // prima: (0,50 + 0,184) / 2 = 0,34
});

test('obiettivo in ritardo anche al rialzo: prezzo salito molto sopra l\'obiettivo', () => {
  const v = analystView({ upside: -0.2, analysts: 10, mom26: 0.4 });
  assert.equal(v.stale, true);
  near(v.value, (-0.2 + 0) / 2); // al prezzo di 6 mesi fa l'obiettivo era sopra: ribasso dimezzato
});

test('movimento del prezzo coerente con il rialzo: nessuna correzione per ritardo', () => {
  assert.equal(analystView({ upside: 0.3, analysts: 8, mom26: 0.2 }).stale, false);
  assert.equal(analystView({ upside: 0.3, analysts: 8, mom26: -0.1 }).stale, false);
});

test('la previsione cresce con il rialzo degli analisti (a parità del resto)', () => {
  const f = (u) => blendWithModel(analystView({ upside: u, analysts: 12, mom26: 0 }), 0.07);
  assert.ok(f(0.4) > f(0.2) && f(0.2) > f(0) && f(0) > f(-0.2));
});

test('mediana ponderata: una previsione estrema non trascina il risultato (la media sì)', async () => {
  const { weightedMedian } = await import('../public/js/analysts.js');
  const base = [{ value: 0.08, weight: 1 }, { value: 0.1, weight: 1 }, { value: 0.12, weight: 1 }];
  near(weightedMedian(base), 0.1);
  const out = weightedMedian([...base.slice(0, 2), { value: 5, weight: 1 }]); // terza previsione assurda: +500%
  near(out, 0.1); // la mediana resta sulla previsione centrale
  assert.equal(weightedMedian([]), null);
  near(weightedMedian([{ value: 0.07, weight: 2 }]), 0.07);
});

test('mediana ponderata: chi è più affidabile pesa di più; risultato continuo e compreso tra le previsioni', async () => {
  const { weightedMedian } = await import('../public/js/analysts.js');
  const lo = weightedMedian([{ value: 0.05, weight: 3 }, { value: 0.2, weight: 1 }]);
  const hi = weightedMedian([{ value: 0.05, weight: 1 }, { value: 0.2, weight: 3 }]);
  assert.ok(lo > 0.05 && lo < 0.125 && hi > 0.125 && hi < 0.2);
  // continuità: un piccolo cambio di peso sposta poco il risultato
  const a = weightedMedian([{ value: 0.05, weight: 1 }, { value: 0.1, weight: 1 }, { value: 0.2, weight: 1 }]);
  const b = weightedMedian([{ value: 0.05, weight: 1.01 }, { value: 0.1, weight: 1 }, { value: 0.2, weight: 1 }]);
  assert.ok(Math.abs(a - b) < 0.002);
});

test('previsione combinata WashTec: mediana ponderata vicina al modello, lontana dal +50% degli analisti', async () => {
  const { combineForecasts } = await import('../public/js/analysts.js');
  const analyst = analystView({ upside: 0.5, analysts: 3, mom26: -0.26 });
  const c = combineForecasts({ analyst, fundamentals: 0.184, evidence: 0.55, model: 0.104 });
  assert.equal(c.parts.length, 3);
  assert.ok(c.value > 0.104 && c.value < 0.16, String(c.value));
  near(c.parts.find((p) => p.id === 'analisti').weight, (3 / 8) * 0.5); // pochi analisti e obiettivo in ritardo
  // senza analisti e fondamentali resta il modello
  near(combineForecasts({ model: 0.07 }).value, 0.07);
});
