// Test unitari per i motori (provider), inclusi quelli gratuiti:
// "subscription" (abbonamento via Claude Code) e "ollama" (locale).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PROVIDERS, providersInfo, resolveKey, stream } from '../lib/providers.js';
import { CATALOG, ENV_KEYS, FREE_PROVIDERS } from '../public/js/catalog.js';

test('il motore abbonamento è il primo del catalogo (default dell\'app)', () => {
  assert.equal(Object.keys(CATALOG)[0], 'subscription');
  assert.equal(CATALOG.subscription.defaultModel, 'claude-opus-4-8');
});

test('subscription e ollama sono gratuiti (nessun credito API) e locali', () => {
  for (const id of ['subscription', 'ollama']) {
    assert.equal(CATALOG[id].free, true, `${id} dovrebbe essere free`);
    assert.equal(CATALOG[id].local, true, `${id} dovrebbe essere local`);
    assert.equal(ENV_KEYS[id], null, `${id} non deve usare una variabile chiave`);
  }
  assert.ok(FREE_PROVIDERS.includes('subscription'));
  assert.ok(FREE_PROVIDERS.includes('ollama'));
});

test('i motori a consumo NON sono gratuiti', () => {
  for (const id of ['claude', 'google', 'openai']) {
    assert.equal(CATALOG[id].free, false, `${id} consuma crediti`);
  }
});

test('webllm: motore browser gratuito, escluso dal lato server', () => {
  assert.equal(CATALOG.webllm.free, true);
  assert.equal(CATALOG.webllm.browserOnly, true);
  assert.equal(ENV_KEYS.webllm, null);
  // Il server non deve esporre un motore che funziona solo nel browser.
  assert.ok(!('webllm' in providersInfo()), 'webllm non deve comparire in providersInfo (server)');
});

test('providersInfo espone free/local senza perdere i modelli', () => {
  const info = providersInfo();
  assert.equal(info.subscription.free, true);
  assert.equal(info.subscription.local, true);
  assert.equal(info.claude.free, false);
  assert.equal(info.claude.local, false);
  assert.ok(info.subscription.models.some((m) => m.id === 'claude-opus-4-8'));
});

test('resolveKey: i motori locali non hanno chiave d\'ambiente', () => {
  assert.equal(resolveKey('subscription', ''), null);
  assert.equal(resolveKey('ollama', ''), null);
  // la chiave esplicita (se mai passata) vince comunque
  assert.equal(resolveKey('ollama', 'x'), 'x');
});

test('stream: i motori locali NON richiedono una chiave (nessun throw sincrono)', () => {
  // Non consumiamo l'iteratore: verifichiamo solo che la validazione della chiave
  // non blocchi i provider locali.
  assert.doesNotThrow(() => stream({ provider: 'subscription', model: 'claude-opus-4-8', system: 's', messages: [{ role: 'user', content: 'x' }], apiKey: null }));
  assert.doesNotThrow(() => stream({ provider: 'ollama', model: 'llama3.1', system: 's', messages: [{ role: 'user', content: 'x' }], apiKey: null }));
});

test('stream: i motori a consumo richiedono una chiave (throw 401)', () => {
  assert.throws(() => stream({ provider: 'claude', model: 'claude-opus-4-8', messages: [], apiKey: null }), (e) => e.status === 401);
  assert.throws(() => stream({ provider: 'openai', model: 'gpt-4o', messages: [], apiKey: '' }), (e) => e.status === 401);
});

test('stream: provider sconosciuto lancia 400', () => {
  assert.throws(() => stream({ provider: 'inesistente', messages: [], apiKey: 'x' }), (e) => e.status === 400);
});
