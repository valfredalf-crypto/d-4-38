// Adattatori dei provider AI con streaming normalizzato.
// Ogni adattatore è un async generator che produce eventi:
//   { type: 'thinking', text }  -> ragionamento (solo modelli che lo espongono)
//   { type: 'text', text }      -> contenuto della risposta
//   { type: 'meta', usage, model, stopReason }
// Gli errori vengono lanciati come eccezioni con .status quando possibile.
//
// Nessuna dipendenza esterna: usa la fetch globale di Node (>=18) e i Web Streams.
import { CATALOG, ENV_KEYS } from '../public/js/catalog.js';

const ANTHROPIC_VERSION = '2023-06-01';

// Catalogo provider/modelli (metadati condivisi con il browser).
export const PROVIDERS = CATALOG;

export function providersInfo() {
  // Versione serializzabile per il frontend: indica anche se la chiave è presente nell'ambiente.
  return Object.fromEntries(
    Object.entries(PROVIDERS).map(([id, p]) => [id, {
      label: p.label, keyUrl: p.keyUrl, supportsThinking: p.supportsThinking,
      models: p.models, defaultModel: p.defaultModel, envKey: Boolean(process.env[ENV_KEYS[id]]),
    }]),
  );
}

// --- Parser SSE generico su un corpo fetch ---------------------------------
async function* sseLines(res) {
  const decoder = new TextDecoder();
  let buf = '';
  for await (const chunk of res.body) {
    buf += decoder.decode(chunk, { stream: true });
    let idx;
    // Gli eventi SSE sono separati da una riga vuota.
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const raw = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const data = raw.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('\n');
      const event = (raw.split('\n').find((l) => l.startsWith('event:')) || '').slice(6).trim();
      if (data) yield { event, data };
    }
  }
  if (buf.trim()) {
    const data = buf.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('\n');
    if (data) yield { event: '', data };
  }
}

async function errorFrom(res, provider) {
  let detail = '';
  try { detail = JSON.stringify(await res.json()); } catch { detail = await res.text().catch(() => ''); }
  const msg = `${PROVIDERS[provider].label}: HTTP ${res.status}. ${detail.slice(0, 600)}`;
  throw Object.assign(new Error(msg), { status: res.status });
}

// --- Claude (Anthropic) -----------------------------------------------------
async function* claudeStream({ model, system, messages, thinking, effort, maxTokens, apiKey, signal }) {
  const body = {
    model, max_tokens: maxTokens, system, messages, stream: true,
    thinking: thinking ? { type: 'adaptive', display: 'summarized' } : { type: 'disabled' },
    output_config: { effort: effort || 'high' },
  };
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', signal,
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': ANTHROPIC_VERSION, accept: 'text/event-stream' },
    body: JSON.stringify(body),
  });
  if (!res.ok) return errorFrom(res, 'claude');
  let blockType = null;
  for await (const { event, data } of sseLines(res)) {
    if (data === '[DONE]') break;
    let json; try { json = JSON.parse(data); } catch { continue; }
    if (event === 'content_block_start') blockType = json.content_block?.type;
    else if (event === 'content_block_delta') {
      const d = json.delta || {};
      if (d.type === 'thinking_delta' && d.thinking) yield { type: 'thinking', text: d.thinking };
      else if (d.type === 'text_delta' && d.text) yield { type: 'text', text: d.text };
    } else if (event === 'message_delta') {
      yield { type: 'meta', model, stopReason: json.delta?.stop_reason, usage: json.usage };
    } else if (event === 'error') {
      throw new Error(`Claude: ${json.error?.message || data}`);
    }
  }
}

// --- Google AI Studio (Gemini) ---------------------------------------------
async function* geminiStream({ model, system, messages, thinking, maxTokens, apiKey, signal }) {
  const contents = messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
  const body = {
    contents,
    generationConfig: { maxOutputTokens: maxTokens, temperature: 0.7, ...(thinking ? { thinkingConfig: { includeThoughts: true } } : {}) },
  };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, { method: 'POST', signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) return errorFrom(res, 'google');
  for await (const { data } of sseLines(res)) {
    if (data === '[DONE]') break;
    let json; try { json = JSON.parse(data); } catch { continue; }
    const cand = json.candidates?.[0];
    for (const part of cand?.content?.parts || []) {
      if (typeof part.text !== 'string') continue;
      yield part.thought ? { type: 'thinking', text: part.text } : { type: 'text', text: part.text };
    }
    if (json.usageMetadata || cand?.finishReason) {
      yield { type: 'meta', model, stopReason: cand?.finishReason, usage: json.usageMetadata };
    }
  }
}

// --- OpenAI (ChatGPT / Codex) ----------------------------------------------
async function* openaiStream({ model, system, messages, effort, maxTokens, apiKey, signal }) {
  const reasoning = /^(o\d|gpt-5)/.test(model); // modelli "reasoning": niente temperature
  const msgs = system ? [{ role: 'system', content: system }, ...messages] : messages;
  const body = { model, messages: msgs, stream: true, max_completion_tokens: maxTokens };
  if (!reasoning) body.temperature = 0.7;
  if (reasoning && effort) body.reasoning_effort = effort === 'xhigh' || effort === 'max' ? 'high' : effort;
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST', signal,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) return errorFrom(res, 'openai');
  for await (const { data } of sseLines(res)) {
    if (data === '[DONE]') break;
    let json; try { json = JSON.parse(data); } catch { continue; }
    const delta = json.choices?.[0]?.delta || {};
    if (delta.content) yield { type: 'text', text: delta.content };
    if (json.choices?.[0]?.finish_reason || json.usage) {
      yield { type: 'meta', model, stopReason: json.choices?.[0]?.finish_reason, usage: json.usage };
    }
  }
}

// --- Mock (modalità DEMO, senza chiavi) ------------------------------------
async function* mockStream({ mode, thinking }) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  if (thinking) {
    for (const t of ['Analizzo la richiesta… ', 'Valuto la struttura migliore… ', 'Compongo la risposta.']) {
      yield { type: 'thinking', text: t }; await sleep(120);
    }
  }
  const demo = `# Risposta DEMO (modalità mock)

Questa è una risposta **simulata**: non è stata contattata nessuna API.
Per ottenere risultati reali, collega una chiave (Claude, Google AI Studio o OpenAI) dalle Impostazioni.

- Modalità richiesta: \`${mode}\`
- Nessun costo, nessuna rete esterna.

\`\`\`js
console.log("Codex Studio è pronto. Collega una chiave per iniziare.");
\`\`\`
`;
  for (const chunk of demo.match(/[\s\S]{1,24}/g) || []) { yield { type: 'text', text: chunk }; await sleep(20); }
  yield { type: 'meta', model: 'mock', stopReason: 'end_turn', usage: null };
}

// --- Dispatch ---------------------------------------------------------------
export function resolveKey(provider, bodyKey) {
  const env = ENV_KEYS[provider] && process.env[ENV_KEYS[provider]];
  return (bodyKey && bodyKey.trim()) || env || null;
}

export function stream(opts) {
  if (process.env.MOCK === '1') return mockStream(opts);
  const { provider } = opts;
  if (!PROVIDERS[provider]) throw Object.assign(new Error(`Provider sconosciuto: ${provider}`), { status: 400 });
  if (!opts.apiKey) throw Object.assign(new Error(`Chiave API mancante per ${PROVIDERS[provider].label}.`), { status: 401 });
  if (provider === 'claude') return claudeStream(opts);
  if (provider === 'google') return geminiStream(opts);
  if (provider === 'openai') return openaiStream(opts);
  throw Object.assign(new Error('Provider non gestito'), { status: 400 });
}
