// Relay server for the browser-based remote desktop.
//
// Pure Node.js, zero npm dependencies. It does three things:
//   1. Serves the browser viewer (public/).
//   2. Receives a live MJPEG stream from each device agent and fans it out to
//      every connected viewer as `multipart/x-mixed-replace` (an <img> renders
//      it natively, so no WebSocket / WebRTC and no plugins are needed).
//   3. Relays input events (mouse/keyboard) from the viewer back to the agent
//      through a long-polled queue.
//
// Everything is gated behind a shared access token (RC_TOKEN). See README.md.

import http from 'node:http';
import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, 'public');

const PORT = Number(process.env.RC_PORT || process.argv.find(a => a.startsWith('--port='))?.slice(7) || 8787);
const HOST = process.env.RC_HOST || '0.0.0.0';

// --- access token -----------------------------------------------------------
let TOKEN = process.env.RC_TOKEN
  || process.argv.find(a => a.startsWith('--token='))?.slice(8)
  || '';
if (!TOKEN) {
  TOKEN = crypto.randomBytes(12).toString('base64url');
  console.log('\n  ⚠  Nessun RC_TOKEN impostato: ne ho generato uno casuale.');
  console.log('      Usa lo stesso token nel viewer e in ogni agente:\n');
  console.log(`      RC_TOKEN=${TOKEN}\n`);
}

function tokenOk(provided) {
  if (typeof provided !== 'string' || provided.length === 0) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(TOKEN);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// --- device registry ---------------------------------------------------------
const OFFLINE_MS = 12_000;        // no activity for this long => device is gone
const INPUT_POLL_MS = 25_000;     // agent long-poll hold time

/** @type {Map<string, Device>} */
const devices = new Map();

/**
 * @typedef {Object} Device
 * @property {string} id
 * @property {string} name
 * @property {string} os
 * @property {number} width
 * @property {number} height
 * @property {object} caps
 * @property {number} lastSeen
 * @property {Buffer|null} lastFrame
 * @property {Set<http.ServerResponse>} viewers
 * @property {Array<object>} inputQueue
 * @property {Array<{res:http.ServerResponse,timer:NodeJS.Timeout}>} inputWaiters
 */

function getDevice(id) {
  let d = devices.get(id);
  if (!d) {
    d = {
      id, name: id, os: 'unknown', width: 0, height: 0, caps: {},
      lastSeen: Date.now(), lastFrame: null,
      viewers: new Set(), inputQueue: [], inputWaiters: [],
    };
    devices.set(id, d);
  }
  return d;
}

function isOnline(d) { return Date.now() - d.lastSeen < OFFLINE_MS; }

// Periodically drop long-dead devices and close their dangling connections.
setInterval(() => {
  const now = Date.now();
  for (const [id, d] of devices) {
    if (now - d.lastSeen > OFFLINE_MS * 3 && d.viewers.size === 0 && d.inputWaiters.length === 0) {
      devices.delete(id);
    }
  }
}, 10_000).unref();

// --- MJPEG frame splitter ----------------------------------------------------
// Splits a raw MJPEG byte stream into individual JPEG frames (SOI..EOI).
const SOI = Buffer.from([0xff, 0xd8]);
const EOI = Buffer.from([0xff, 0xd9]);
function makeJpegSplitter(onFrame) {
  let buf = Buffer.alloc(0);
  const MAX = 24 * 1024 * 1024; // guard against runaway buffering
  return (chunk) => {
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
    for (;;) {
      const soi = buf.indexOf(SOI);
      if (soi < 0) { if (buf.length > 2) buf = buf.subarray(buf.length - 1); break; }
      const eoi = buf.indexOf(EOI, soi + 2);
      if (eoi < 0) { if (soi > 0) buf = buf.subarray(soi); if (buf.length > MAX) buf = buf.subarray(buf.length - 2); break; }
      onFrame(buf.subarray(soi, eoi + 2));
      buf = buf.subarray(eoi + 2);
    }
  };
}

// Parse width/height from a JPEG SOFn marker.
export function jpegSize(buf) {
  let i = 2;
  while (i < buf.length - 9) {
    if (buf[i] !== 0xff) { i++; continue; }
    const m = buf[i + 1];
    // SOF0..SOF15 carry the frame geometry, except DHT(C4)/DAC(CC)/RSTn.
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    }
    if (m === 0xd8 || m === 0xd9 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
    const len = buf.readUInt16BE(i + 2);
    i += 2 + len;
  }
  return null;
}

// --- helpers -----------------------------------------------------------------
function tokenFrom(req, u) {
  return u.searchParams.get('token') || req.headers['x-rc-token'] || '';
}
function send(res, code, body, headers = {}) {
  res.writeHead(code, { 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}
function sendJson(res, code, obj) {
  send(res, code, JSON.stringify(obj), { 'Content-Type': 'application/json' });
}
function readBody(req, limit = 4 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on('data', c => { n += c.length; if (n > limit) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
async function serveStatic(res, pathname) {
  const rel = normalize(pathname === '/' ? '/index.html' : pathname).replace(/^(\.\.[/\\])+/, '');
  const file = join(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR)) return send(res, 403, 'forbidden');
  try {
    const data = await readFile(file);
    const ext = rel.slice(rel.lastIndexOf('.'));
    send(res, 200, data, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  } catch { send(res, 404, 'not found'); }
}

// --- input queue plumbing ----------------------------------------------------
function flushInput(d) {
  if (!d.inputQueue.length || !d.inputWaiters.length) return;
  const batch = d.inputQueue;
  d.inputQueue = [];
  for (const w of d.inputWaiters) { clearTimeout(w.timer); try { sendJson(w.res, 200, { events: batch }); } catch {} }
  d.inputWaiters = [];
}

// --- request router ----------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const p = u.pathname;

  try {
    // ---- agent: open a streaming upload of MJPEG ---------------------------
    if (p.startsWith('/ingest/') && req.method === 'POST') {
      if (!tokenOk(tokenFrom(req, u))) return send(res, 401, 'unauthorized');
      const id = decodeURIComponent(p.slice('/ingest/'.length));
      const d = getDevice(id);
      const split = makeJpegSplitter((frame) => {
        d.lastFrame = frame;
        d.lastSeen = Date.now();
        if (!d.width) { const s = jpegSize(frame); if (s) { d.width = s.w; d.height = s.h; } }
        for (const vr of d.viewers) {
          try {
            vr.write(`--rcframe\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.length}\r\n\r\n`);
            vr.write(frame); vr.write('\r\n');
          } catch { d.viewers.delete(vr); }
        }
      });
      req.on('data', split);
      req.on('end', () => send(res, 200, 'ok'));
      req.on('error', () => {});
      return;
    }

    // ---- viewer: live MJPEG stream -----------------------------------------
    if (p.startsWith('/stream/') && req.method === 'GET') {
      if (!tokenOk(tokenFrom(req, u))) return send(res, 401, 'unauthorized');
      const id = decodeURIComponent(p.slice('/stream/'.length));
      const d = getDevice(id);
      res.writeHead(200, {
        'Content-Type': 'multipart/x-mixed-replace; boundary=rcframe',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache', 'Connection': 'close', 'X-Accel-Buffering': 'no',
      });
      d.viewers.add(res);
      if (d.lastFrame) {
        res.write(`--rcframe\r\nContent-Type: image/jpeg\r\nContent-Length: ${d.lastFrame.length}\r\n\r\n`);
        res.write(d.lastFrame); res.write('\r\n');
      }
      req.on('close', () => d.viewers.delete(res));
      return;
    }

    // ---- agent: register / heartbeat ---------------------------------------
    if (p === '/api/register' && req.method === 'POST') {
      if (!tokenOk(tokenFrom(req, u))) return sendJson(res, 401, { error: 'unauthorized' });
      const body = JSON.parse((await readBody(req, 64 * 1024)).toString() || '{}');
      const id = String(body.id || crypto.randomBytes(4).toString('hex'));
      const d = getDevice(id);
      d.name = String(body.name || d.name).slice(0, 80);
      d.os = String(body.os || d.os).slice(0, 40);
      if (body.width) d.width = body.width | 0;
      if (body.height) d.height = body.height | 0;
      if (body.caps && typeof body.caps === 'object') d.caps = body.caps;
      d.lastSeen = Date.now();
      return sendJson(res, 200, { id, inputPollMs: INPUT_POLL_MS });
    }

    // ---- agent: long-poll for pending input --------------------------------
    if (p.startsWith('/input/') && req.method === 'GET') {
      if (!tokenOk(tokenFrom(req, u))) return sendJson(res, 401, { error: 'unauthorized' });
      const d = getDevice(decodeURIComponent(p.slice('/input/'.length)));
      d.lastSeen = Date.now();
      if (d.inputQueue.length) { const b = d.inputQueue; d.inputQueue = []; return sendJson(res, 200, { events: b }); }
      const waiter = { res, timer: setTimeout(() => {
        d.inputWaiters = d.inputWaiters.filter(w => w !== waiter);
        try { sendJson(res, 200, { events: [] }); } catch {}
      }, INPUT_POLL_MS) };
      d.inputWaiters.push(waiter);
      req.on('close', () => { clearTimeout(waiter.timer); d.inputWaiters = d.inputWaiters.filter(w => w !== waiter); });
      return;
    }

    // ---- viewer: push input ------------------------------------------------
    if (p.startsWith('/input/') && req.method === 'POST') {
      if (!tokenOk(tokenFrom(req, u))) return sendJson(res, 401, { error: 'unauthorized' });
      const d = getDevice(decodeURIComponent(p.slice('/input/'.length)));
      const body = JSON.parse((await readBody(req, 256 * 1024)).toString() || '{}');
      const evts = Array.isArray(body.events) ? body.events : [];
      if (d.inputQueue.length < 2000) d.inputQueue.push(...evts);
      flushInput(d);
      return sendJson(res, 200, { ok: true });
    }

    // ---- viewer: list devices ----------------------------------------------
    if (p === '/api/devices' && req.method === 'GET') {
      if (!tokenOk(tokenFrom(req, u))) return sendJson(res, 401, { error: 'unauthorized' });
      const list = [...devices.values()].filter(isOnline).map(d => ({
        id: d.id, name: d.name, os: d.os, width: d.width, height: d.height,
        caps: d.caps, streaming: !!d.lastFrame, viewers: d.viewers.size,
      }));
      return sendJson(res, 200, { devices: list });
    }

    if (p === '/api/health') return sendJson(res, 200, { ok: true, devices: devices.size });

    // ---- static viewer ------------------------------------------------------
    if (req.method === 'GET') return serveStatic(res, p);

    send(res, 404, 'not found');
  } catch (err) {
    try { send(res, 500, 'error: ' + err.message); } catch {}
  }
});

server.requestTimeout = 0;   // allow long-lived ingest / stream connections
server.headersTimeout = 0;
server.listen(PORT, HOST, () => {
  console.log(`\n  Remote-desktop relay in ascolto su http://${HOST}:${PORT}`);
  console.log(`  Apri il viewer nel browser e usa il token qui sopra.\n`);
});
