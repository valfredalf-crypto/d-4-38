// Test unitari (node:test) per la costruzione dei prompt e il catalogo provider.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRequest, MODES } from '../lib/prompts.js';
import { PROVIDERS, providersInfo, resolveKey } from '../lib/providers.js';

test('tutte le modalità producono system + messages validi', () => {
  for (const mode of MODES) {
    const { system, messages } = buildRequest(mode, mode === 'chat'
      ? { messages: [{ role: 'user', content: 'ciao' }] }
      : { title: 't', context: 'c', code: 'x', sql: 'select 1', description: 'd', request: 'r' });
    assert.equal(typeof system, 'string');
    assert.ok(system.length > 0);
    assert.ok(Array.isArray(messages) && messages.length > 0);
    assert.ok(['user', 'assistant'].includes(messages[0].role));
  }
});

test('modalità sconosciuta lancia errore 400', () => {
  assert.throws(() => buildRequest('inesistente', {}), (e) => e.status === 400);
});

test('doc: il template scelto compare nel system', () => {
  const { system } = buildRequest('doc', { template: 'specifica-api', title: 'X' });
  assert.match(system, /Specifica API/);
});

test('code traduci: istruzione di traduzione nel system', () => {
  const { system } = buildRequest('code', { task: 'traduci', code: 'print(1)', targetLanguage: 'Go' });
  assert.match(system, /[Tt]raduci/);
});

test('sql genera: include la richiesta in linguaggio naturale', () => {
  const { messages } = buildRequest('sql', { task: 'genera', request: 'totale vendite', dialect: 'PostgreSQL' });
  assert.match(messages[0].content, /totale vendite/);
});

test('chat: filtra i ruoli non validi e limita la storia', () => {
  const many = Array.from({ length: 60 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'm' + i }));
  const { messages } = buildRequest('chat', { messages: [...many, { role: 'system', content: 'ignora' }] });
  assert.ok(messages.length <= 40);
  assert.ok(messages.every((m) => m.role === 'user' || m.role === 'assistant'));
});

test('catalogo provider: Claude, Google e OpenAI presenti con modello di default valido', () => {
  for (const id of ['claude', 'google', 'openai']) {
    const p = PROVIDERS[id];
    assert.ok(p, `manca il provider ${id}`);
    assert.ok(p.models.some((m) => m.id === p.defaultModel), `default non valido per ${id}`);
  }
});

test('providersInfo non espone le chiavi, solo la presenza', () => {
  const info = providersInfo();
  for (const p of Object.values(info)) {
    assert.equal(typeof p.envKey, 'boolean');
    assert.ok(!('env' in p)); // il nome della variabile non serve al client
  }
});

test('resolveKey preferisce la chiave del body a quella d\'ambiente', () => {
  assert.equal(resolveKey('claude', 'sk-dal-body'), 'sk-dal-body');
  assert.equal(resolveKey('claude', ''), process.env.ANTHROPIC_API_KEY || null);
});
