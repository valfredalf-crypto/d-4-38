// Adattatori dei provider lato BROWSER, per la modalità "client" (sito statico senza backend).
// Le chiamate alle API vengono fatte direttamente dal browser con la chiave dell'utente.
// Ogni funzione richiama onEvent({ type: 'thinking'|'text'|'meta', ... }).
import { CATALOG } from './catalog.js';

const ANTHROPIC_VERSION = '2023-06-01';

// Info provider per il client: la chiave non è mai nell'ambiente (envKey = false).
export function browserInfo() {
  return Object.fromEntries(Object.entries(CATALOG).map(([id, p]) => [id, {
    label: p.label, keyUrl: p.keyUrl, supportsThinking: p.supportsThinking,
    models: p.models, defaultModel: p.defaultModel, envKey: false,
  }]));
}

async function* sseLines(res) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) !== -1) {
      const raw = buf.slice(0, i); buf = buf.slice(i + 2);
      const event = (raw.match(/^event:\s*(.*)$/m) || [])[1] || '';
      const data = raw.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('\n');
      if (data) yield { event: event.trim(), data };
    }
  }
}

async function failIfNotOk(res, label) {
  if (res.ok) return;
  let detail = '';
  try { detail = JSON.stringify(await res.json()); } catch { detail = await res.text().catch(() => ''); }
  throw new Error(`${label}: HTTP ${res.status}. ${detail.slice(0, 500)}`);
}

async function claude({ model, system, messages, thinking, effort, maxTokens, apiKey, signal }, onEvent) {
  const body = {
    model, max_tokens: maxTokens, system, messages, stream: true,
    thinking: thinking ? { type: 'adaptive', display: 'summarized' } : { type: 'disabled' },
    output_config: { effort: effort || 'high' },
  };
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', signal,
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': ANTHROPIC_VERSION, 'anthropic-dangerous-direct-browser-access': 'true', accept: 'text/event-stream' },
    body: JSON.stringify(body),
  });
  await failIfNotOk(res, 'Claude');
  for await (const { event, data } of sseLines(res)) {
    if (data === '[DONE]') break;
    let j; try { j = JSON.parse(data); } catch { continue; }
    if (event === 'content_block_delta') {
      const d = j.delta || {};
      if (d.type === 'thinking_delta' && d.thinking) onEvent({ type: 'thinking', text: d.thinking });
      else if (d.type === 'text_delta' && d.text) onEvent({ type: 'text', text: d.text });
    } else if (event === 'message_delta') onEvent({ type: 'meta', model, stopReason: j.delta?.stop_reason, usage: j.usage });
    else if (event === 'error') throw new Error(`Claude: ${j.error?.message || data}`);
  }
}

async function gemini({ model, system, messages, thinking, maxTokens, apiKey, signal }, onEvent) {
  const contents = messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
  const body = { contents, generationConfig: { maxOutputTokens: maxTokens, temperature: 0.7, ...(thinking ? { thinkingConfig: { includeThoughts: true } } : {}) } };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, { method: 'POST', signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  await failIfNotOk(res, 'Gemini');
  for await (const { data } of sseLines(res)) {
    if (data === '[DONE]') break;
    let j; try { j = JSON.parse(data); } catch { continue; }
    const cand = j.candidates?.[0];
    for (const part of cand?.content?.parts || []) {
      if (typeof part.text !== 'string') continue;
      onEvent(part.thought ? { type: 'thinking', text: part.text } : { type: 'text', text: part.text });
    }
    if (j.usageMetadata || cand?.finishReason) onEvent({ type: 'meta', model, stopReason: cand?.finishReason, usage: j.usageMetadata });
  }
}

async function openai({ model, system, messages, effort, maxTokens, apiKey, signal }, onEvent) {
  const reasoning = /^(o\d|gpt-5)/.test(model);
  const msgs = system ? [{ role: 'system', content: system }, ...messages] : messages;
  const body = { model, messages: msgs, stream: true, max_completion_tokens: maxTokens };
  if (!reasoning) body.temperature = 0.7;
  if (reasoning && effort) body.reasoning_effort = effort === 'xhigh' || effort === 'max' ? 'high' : effort;
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST', signal, headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` }, body: JSON.stringify(body),
  });
  await failIfNotOk(res, 'OpenAI');
  for await (const { data } of sseLines(res)) {
    if (data === '[DONE]') break;
    let j; try { j = JSON.parse(data); } catch { continue; }
    const d = j.choices?.[0]?.delta || {};
    if (d.content) onEvent({ type: 'text', text: d.content });
    if (j.choices?.[0]?.finish_reason || j.usage) onEvent({ type: 'meta', model, stopReason: j.choices?.[0]?.finish_reason, usage: j.usage });
  }
}

export async function streamBrowser(opts, onEvent) {
  if (!opts.apiKey) throw new Error(`Chiave API mancante per ${CATALOG[opts.provider]?.label || opts.provider}. Aprila da ⚙️ Impostazioni.`);
  if (opts.provider === 'claude') return claude(opts, onEvent);
  if (opts.provider === 'google') return gemini(opts, onEvent);
  if (opts.provider === 'openai') return openai(opts, onEvent);
  throw new Error('Provider non gestito: ' + opts.provider);
}
