import test from 'node:test';
import assert from 'node:assert/strict';
import { Q, growthQuality, annualized, qualityScore } from '../public/js/quality.js';

test('qualità della crescita: stesso controllo della scheda (crescita minima, value trap) e peso delle evidenze', () => {
  assert.equal(growthQuality({ growth: null }), null);
  assert.equal(growthQuality(), null);
  const a = growthQuality({ growth: 0.142, evidence: 0.79, dividendYield: 0.037 });
  assert.equal(a.ok, true);
  assert.equal(a.trap, false);
  assert.ok(Math.abs(a.value - 0.142 * (0.5 + 0.5 * 0.79)) < 1e-12);
  // dividendo alto senza crescita: possibile value trap
  assert.equal(growthQuality({ growth: 0.025, dividendYield: 0.08 }).trap, true);
  assert.equal(growthQuality({ growth: 0.025, dividendYield: 0.08 }).ok, false);
  assert.equal(growthQuality({ growth: 0.04, dividendYield: 0.08 }).ok, true);
  // crescita sotto il 2%: non supera il controllo
  assert.equal(growthQuality({ growth: 0.01 }).ok, false);
  // senza dato sulle evidenze (ETF): peso neutro
  assert.ok(Math.abs(growthQuality({ growth: 0.1 }).value - 0.1 * (0.5 + 0.5 * Q.evidenceDefault)) < 1e-12);
  // più evidenze, più valore
  assert.ok(growthQuality({ growth: 0.1, evidence: 1 }).value > growthQuality({ growth: 0.1, evidence: 0 }).value);
});

test('rendimento annualizzato', () => {
  assert.ok(Math.abs(annualized(0.331, 3) - 0.1) < 1e-9);
  assert.ok(Math.abs(annualized(0.08, 1) - 0.08) < 1e-12);
  assert.equal(annualized(-1.2, 3), -1);
  assert.equal(annualized(NaN, 3), null);
});

test('punteggio qualità: media di tre voti, 0–100; entra solo chi supera i tre controlli a 1, 3 e 5 anni', () => {
  const base = { growth: 0.12, evidence: 0.8, dividendYield: 0.02, asym: [0.9, 0.5, 0.2], ret: [[0.09, 1], [0.3, 3], [0.6, 5]] };
  const s = qualityScore(base);
  assert.equal(s.pass, true);
  assert.ok(s.score > 0 && s.score <= 100);
  assert.ok(Math.abs(s.score - (100 * (s.sq + s.sa + s.sr)) / 3) < 1e-9);
  assert.ok(Math.abs(s.sa - (1 / 1.9 + 1 / 1.5 + 1 / 1.2) / 3) < 1e-12);
  // ogni voce migliore alza il punteggio
  assert.ok(qualityScore({ ...base, growth: 0.14 }).score > s.score);
  assert.ok(qualityScore({ ...base, asym: [0.5, 0.3, 0.1] }).score > s.score);
  assert.ok(qualityScore({ ...base, ret: [[0.12, 1], [0.4, 3], [0.8, 5]] }).score > s.score);
  // guadagno tipico non positivo in un periodo (asimmetria infinita): resta il punteggio, ma non entra nella sezione
  const inf = qualityScore({ ...base, asym: [Infinity, 0.5, 0.2] });
  assert.equal(inf.pass, false);
  assert.ok(inf.score < s.score);
  // rendimento atteso negativo in un periodo, crescita troppo bassa o value trap: non entra
  assert.equal(qualityScore({ ...base, ret: [[-0.01, 1], [0.3, 3], [0.6, 5]] }).pass, false);
  assert.equal(qualityScore({ ...base, growth: 0.01 }).pass, false);
  assert.equal(qualityScore({ ...base, growth: 0.025, dividendYield: 0.09 }).pass, false);
  // voti limitati tra 0 e 1
  const top = qualityScore({ growth: 0.4, evidence: 1, asym: [0, 0, 0], ret: [[0.5, 1], [2, 3], [5, 5]] });
  assert.ok(Math.abs(top.score - 100) < 1e-9);
  // dati mancanti: nessun punteggio
  assert.equal(qualityScore({ ...base, growth: null }), null);
  assert.equal(qualityScore({ ...base, asym: [0.9, null, 0.2] }), null);
  assert.equal(qualityScore({ ...base, ret: [[0.09, 1], [NaN, 3], [0.6, 5]] }), null);
  assert.equal(qualityScore({ ...base, asym: [0.9, 0.5] }), null);
});
