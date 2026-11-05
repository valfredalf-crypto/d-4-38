// Adattatori dei provider AI con streaming normalizzato.
// Ogni adattatore è un async generator che produce eventi:
//   { type: 'thinking', text }  -> ragionamento (solo modelli che lo espongono)
//   { type: 'text', text }      -> contenuto della risposta
//   { type: 'meta', usage, model, stopReason }
// Gli errori vengono lanciati come eccezioni con .status quando possibile.
//
// Nessuna dipendenza esterna: usa la fetch globale di Node (>=18) e i Web Streams.
import { spawn } from 'node:child_process';
import { CATALOG, ENV_KEYS } from '../public/js/catalog.js';

const ANTHROPIC_VERSION = '2023-06-01';

// Catalogo provider/modelli (metadati condivisi con il browser).
export const PROVIDERS = CATALOG;

export function providersInfo() {
  // Versione serializzabile per il frontend (modalità server). Esclude i motori
  // "browserOnly" (es. WebLLM) che funzionano solo lato browser sul sito statico.
  return Object.fromEntries(
    Object.entries(PROVIDERS)
      .filter(([, p]) => !p.browserOnly)
      .map(([id, p]) => [id, {
        label: p.label, keyUrl: p.keyUrl, supportsThinking: p.supportsThinking,
        models: p.models, defaultModel: p.defaultModel,
        free: Boolean(p.free), local: Boolean(p.local),
        envKey: Boolean(ENV_KEYS[id] && process.env[ENV_KEYS[id]]),
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

// --- Ollama (locale, GRATIS, nessun credito API) ---------------------------
// Ollama espone un'API locale su http://localhost:11434 e produce JSON
// delimitato da newline (NDJSON), non SSE. Richiede Ollama installato e in
// esecuzione sul computer dell'utente, senza alcuna chiave.
async function* ndjsonLines(res) {
  const decoder = new TextDecoder();
  let buf = '';
  for await (const chunk of res.body) {
    buf += decoder.decode(chunk, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (line) yield line;
    }
  }
  if (buf.trim()) yield buf.trim();
}

async function* ollamaStream({ model, system, messages, maxTokens, signal }) {
  const host = (process.env.OLLAMA_HOST || 'http://localhost:11434').replace(/\/+$/, '');
  const msgs = system ? [{ role: 'system', content: system }, ...messages] : messages;
  const body = { model, messages: msgs, stream: true, options: { num_predict: maxTokens } };
  let res;
  try {
    res = await fetch(`${host}/api/chat`, {
      method: 'POST', signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw Object.assign(
      new Error(`Impossibile raggiungere Ollama su ${host}. Avvia Ollama (\`ollama serve\`) e scarica un modello (\`ollama pull ${model}\`). Dettaglio: ${e.message}`),
      { status: 503 },
    );
  }
  if (!res.ok) return errorFrom(res, 'ollama');
  for await (const line of ndjsonLines(res)) {
    let json; try { json = JSON.parse(line); } catch { continue; }
    if (json.error) throw Object.assign(new Error(`Ollama: ${json.error}`), { status: 502 });
    const text = json.message?.content;
    if (text) yield { type: 'text', text };
    if (json.done) {
      yield { type: 'meta', model, stopReason: json.done_reason || 'stop', usage: { input_tokens: json.prompt_eval_count, output_tokens: json.eval_count } };
    }
  }
}

// --- Claude via abbonamento (CLI Claude Code locale) -----------------------
// Instrada la generazione attraverso la CLI `claude` con cui l'utente è già
// loggato (abbonamento Pro/Max): NON consuma crediti API e non richiede chiavi.
// Richiede Claude Code installato localmente. Generazione pura: nessun tool,
// nessun prompt di permessi, un solo turno.
function cliMissingMsg(bin, e) {
  return `Impossibile avviare la CLI di Claude Code ('${bin}'). Installa Claude Code e accedi col tuo abbonamento `
    + `(https://www.anthropic.com/claude-code), oppure imposta CLAUDE_CLI_BIN sul percorso del binario. Dettaglio: ${e?.message || e}`;
}

async function* claudeCliStream({ model, system, messages, thinking, signal }) {
  const bin = process.env.CLAUDE_CLI_BIN || 'claude';
  // La CLI è single-turn: concateniamo l'eventuale storia della chat.
  const prompt = (Array.isArray(messages) ? messages : [])
    .map((m) => (m.role === 'assistant' ? `# Risposta precedente dell'assistente\n${m.content}` : m.content))
    .join('\n\n---\n\n') || 'Ciao';

  const args = [
    '-p',
    '--output-format', 'stream-json',
    '--include-partial-messages',
    '--verbose',
    '--model', model,
    '--max-turns', '1',
    '--permission-prompts', 'none',
    '--strict-mcp-config',
    '--allowedTools', '', // nessun tool: solo generazione di testo
  ];
  if (system) args.push('--system-prompt', system);

  const env = { ...process.env };
  if (thinking) env.MAX_THINKING_TOKENS = env.MAX_THINKING_TOKENS || '16000';

  let child;
  try {
    child = spawn(bin, args, { env, stdio: ['pipe', 'pipe', 'pipe'], signal });
  } catch (e) {
    throw Object.assign(new Error(cliMissingMsg(bin, e)), { status: 503 });
  }
  let spawnErr = null;
  child.on('error', (e) => { spawnErr = e; });
  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d.toString(); });
  child.stdin.on('error', () => { /* ignora EPIPE se il processo termina subito */ });
  child.stdin.end(prompt);

  let sawText = false;
  try {
    for await (const line of ndjsonLines({ body: child.stdout })) {
      let j; try { j = JSON.parse(line); } catch { continue; }
      if (j.type === 'stream_event' && j.event?.type === 'content_block_delta') {
        const d = j.event.delta || {};
        if (d.type === 'text_delta' && d.text) { sawText = true; yield { type: 'text', text: d.text }; }
        else if (d.type === 'thinking_delta' && d.thinking) yield { type: 'thinking', text: d.thinking };
      } else if (j.type === 'assistant' && !sawText && Array.isArray(j.message?.content)) {
        // Fallback se i chunk parziali non fossero disponibili.
        for (const b of j.message.content) {
          if (b.type === 'text' && b.text) { sawText = true; yield { type: 'text', text: b.text }; }
          else if (b.type === 'thinking' && b.thinking) yield { type: 'thinking', text: b.thinking };
        }
      } else if (j.type === 'result') {
        if (!sawText && typeof j.result === 'string' && j.result) { sawText = true; yield { type: 'text', text: j.result }; }
        if (j.subtype && j.subtype !== 'success') {
          throw Object.assign(new Error(`Claude Code: ${j.subtype}. ${(j.result || stderr || '').toString().slice(0, 400)}`), { status: 502 });
        }
        yield { type: 'meta', model, stopReason: j.subtype || 'success', usage: j.usage };
      }
    }
  } finally {
    try { if (child && !child.killed) child.kill(); } catch { /* già terminato */ }
  }
  if (spawnErr) throw Object.assign(new Error(cliMissingMsg(bin, spawnErr)), { status: 503 });
  if (!sawText) throw Object.assign(new Error(`Claude Code non ha prodotto output. ${stderr.slice(0, 400) || 'Verifica di aver eseguito l\'accesso con `claude` e che il modello sia disponibile.'}`), { status: 502 });
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
  const info = PROVIDERS[provider];
  if (!info) throw Object.assign(new Error(`Provider sconosciuto: ${provider}`), { status: 400 });
  // I provider locali (Ollama) non richiedono chiave: girano gratis in locale.
  if (!info.local && !opts.apiKey) throw Object.assign(new Error(`Chiave API mancante per ${info.label}.`), { status: 401 });
  if (provider === 'subscription') return claudeCliStream(opts);
  if (provider === 'ollama') return ollamaStream(opts);
  if (provider === 'claude') return claudeStream(opts);
  if (provider === 'google') return geminiStream(opts);
  if (provider === 'openai') return openaiStream(opts);
  throw Object.assign(new Error('Provider non gestito'), { status: 400 });
}
