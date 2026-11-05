// Codex Studio — server HTTP senza dipendenze.
// Serve l'interfaccia (public/) e fa da proxy in streaming verso i provider AI
// (Claude, Google AI Studio, OpenAI), così le chiavi restano lato server ed si evita la CORS.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRequest } from './public/js/prompts.js';
import { stream, providersInfo, resolveKey, PROVIDERS } from './lib/providers.js';

const PORT = Number(process.env.CODEX_PORT || process.env.PORT || 4100);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(HERE, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readBody(req, limit = 8e6) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw Object.assign(new Error('Payload troppo grande'), { status: 413 });
    chunks.push(c);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function sseWrite(res, type, data) {
  res.write(`event: ${type}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

async function handleGenerate(req, res) {
  const body = JSON.parse(await readBody(req));
  const { provider = 'claude', mode = 'chat', payload = {}, options = {}, key = '' } = body;
  if (!PROVIDERS[provider] && process.env.MOCK !== '1') {
    return sendJson(res, 400, { error: `Provider sconosciuto: ${provider}` });
  }
  const info = PROVIDERS[provider] || PROVIDERS.claude;
  const model = (body.model && info.models.some((m) => m.id === body.model)) ? body.model : info.defaultModel;
  const apiKey = resolveKey(provider, key);
  const { system, messages } = buildRequest(mode, payload);

  const thinking = Boolean(options.thinking) && info.supportsThinking;
  const effort = EFFORTS.has(options.effort) ? options.effort : 'high';
  const maxTokens = Math.min(Math.max(Number(options.maxTokens) || 16000, 512), 64000);

  // Avvia lo stream del provider PRIMA di aprire l'SSE, così un errore (es. chiave
  // mancante o HTTP non-ok) torna come JSON pulito con lo stato corretto.
  const controller = new AbortController();
  req.on('close', () => controller.abort());
  let gen;
  try {
    gen = stream({ provider, model, system, messages, thinking, effort, maxTokens, apiKey, signal: controller.signal, mode });
    var first = await gen.next(); // consuma il primo evento: qui emergono gli errori HTTP
  } catch (e) {
    return sendJson(res, e.status || 502, { error: e.message });
  }

  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' });
  sseWrite(res, 'start', { provider, model, thinking, effort });
  try {
    if (!first.done && first.value) sseWrite(res, first.value.type, first.value);
    for await (const ev of gen) sseWrite(res, ev.type, ev);
    sseWrite(res, 'done', {});
  } catch (e) {
    if (!controller.signal.aborted) sseWrite(res, 'error', { message: e.message });
  }
  res.end();
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (req.method === 'GET' && url.pathname === '/api/providers') {
    return sendJson(res, 200, { providers: providersInfo(), mock: process.env.MOCK === '1' });
  }
  if (req.method === 'POST' && url.pathname === '/api/generate') {
    try { return await handleGenerate(req, res); }
    catch (e) {
      if (!res.headersSent) return sendJson(res, e.status || 502, { error: e.message });
      try { sseWrite(res, 'error', { message: e.message }); res.end(); } catch { /* chiuso */ }
      return;
    }
  }

  // File statici
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'Metodo non consentito' });
  const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
  const file = path.join(PUBLIC, rel);
  if (!file.startsWith(PUBLIC + path.sep)) return sendJson(res, 403, { error: 'Vietato' });
  fs.readFile(file, (err, data) => {
    if (err) return sendJson(res, 404, { error: 'Non trovato' });
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  const demo = process.env.MOCK === '1' ? '  (MODALITÀ DEMO: risposte simulate, nessuna chiave richiesta)' : '';
  console.log(`Codex Studio in ascolto su http://localhost:${PORT}${demo}`);
});
