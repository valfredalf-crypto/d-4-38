// Device agent — runs on the machine you want to control.
//
// Single file, zero npm dependencies. It:
//   1. probes the screen resolution,
//   2. registers with the relay,
//   3. streams the screen (ffmpeg MJPEG) to the relay, and
//   4. long-polls the relay for input events and injects them.
//
// Usage:
//   node agent.js --server https://relay.example --token SECRET --name "Mac ufficio"
//   node agent.js --demo --server http://localhost:8787 --token SECRET   # no real screen

import http from 'node:http';
import https from 'node:https';
import crypto from 'node:crypto';
import { URL } from 'node:url';
import { startCapture, probeSize, hasFfmpeg, osLabel } from './lib/capture.js';
import { createInjector } from './lib/inject.js';

// --- args --------------------------------------------------------------------
// Supports both "--name value" and "--name=value"; flag() is for booleans.
const argv = process.argv.slice(2);
function flag(name) { return argv.includes(`--${name}`) || argv.some(a => a.startsWith(`--${name}=`)); }
function opt(name, def) {
  const i = argv.findIndex(a => a === `--${name}` || a.startsWith(`--${name}=`));
  if (i < 0) return def;
  const a = argv[i];
  if (a.includes('=')) return a.slice(a.indexOf('=') + 1);
  const next = argv[i + 1];
  return (next && !next.startsWith('--')) ? next : def;
}
const SERVER = opt('server', process.env.RC_SERVER || 'http://localhost:8787');
const TOKEN = opt('token', process.env.RC_TOKEN || '');
const NAME = opt('name', process.env.RC_NAME || osLabel());
const DEMO = flag('demo');
const NO_INPUT = flag('no-input');
const FPS = Number(opt('fps', 8));
const QUALITY = Number(opt('quality', 7));
const SCALE = opt('scale', '');                    // e.g. "1280:-1"
const DISPLAY = opt('display', process.env.DISPLAY || ':0.0');
const AV_INPUT = opt('av-input', '1:none');
let ID = opt('id', crypto.randomBytes(4).toString('hex'));

if (!TOKEN) { console.error('Errore: manca il token. Usa --token <SECRET> (lo stesso del relay).'); process.exit(1); }
if (!hasFfmpeg()) { console.error('Errore: ffmpeg non trovato nel PATH. Installalo (è ciò che cattura lo schermo).'); process.exit(1); }

const base = new URL(SERVER);
const client = base.protocol === 'https:' ? https : http;
const capOpt = { fps: FPS, quality: QUALITY, scale: SCALE, display: DISPLAY, avInput: AV_INPUT, demo: DEMO };

// --- tiny HTTP helpers -------------------------------------------------------
function reqJson(method, path, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(path, base);
    u.searchParams.set('token', TOKEN);
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const r = client.request(u, { method, headers: { 'Content-Type': 'application/json', ...(data ? { 'Content-Length': data.length } : {}) } }, (res) => {
      const chunks = []; res.on('data', c => chunks.push(c));
      res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}')); } catch { resolve({}); } });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

// --- screen streaming --------------------------------------------------------
let size = { w: 1280, h: 720 };
let injector;

function startIngest() {
  const u = new URL(`/ingest/${encodeURIComponent(ID)}`, base);
  u.searchParams.set('token', TOKEN);
  const { proc, stdout } = startCapture(capOpt);
  const upload = client.request(u, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'Transfer-Encoding': 'chunked' } }, (res) => {
    res.resume();
  });
  stdout.pipe(upload);
  const restart = (why) => {
    console.error(`[capture] interrotta (${why}); riprovo tra 2s…`);
    try { proc.kill('SIGKILL'); } catch {}
    try { upload.destroy(); } catch {}
    setTimeout(startIngest, 2000);
  };
  proc.on('close', () => restart('ffmpeg terminato'));
  upload.on('error', () => restart('connessione relay persa'));
  console.log('[capture] streaming schermo attivo');
}

// --- input loop --------------------------------------------------------------
async function inputLoop() {
  for (;;) {
    try {
      const { events } = await reqJson('GET', `/input/${encodeURIComponent(ID)}`);
      if (events && events.length) await injector.apply(events);
    } catch {
      await new Promise(r => setTimeout(r, 1500));
    }
  }
}

// --- heartbeat ---------------------------------------------------------------
async function heartbeat() {
  for (;;) {
    try { await reqJson('POST', '/api/register', { id: ID, name: NAME, os: osLabel(), width: size.w, height: size.h, caps: injector.caps }); } catch {}
    await new Promise(r => setTimeout(r, 5000));
  }
}

// --- main --------------------------------------------------------------------
(async () => {
  const probed = probeSize(capOpt);
  if (probed) size = probed;
  injector = createInjector({ display: DISPLAY, size, noInput: NO_INPUT });

  const reg = await reqJson('POST', '/api/register', { id: ID, name: NAME, os: osLabel(), width: size.w, height: size.h, caps: injector.caps });
  if (reg.id) ID = reg.id;

  console.log('\n────────────────────────────────────────────────────────');
  console.log('  QUESTO COMPUTER È ORA CONTROLLABILE DA REMOTO');
  console.log(`  Nome:        ${NAME}`);
  console.log(`  Relay:       ${SERVER}`);
  console.log(`  Risoluzione: ${size.w}×${size.h}`);
  console.log(`  Input:       mouse=${injector.caps.mouse} tastiera=${injector.caps.keyboard} (${injector.caps.tool || 'n/d'})`);
  if (!injector.caps.mouse && !NO_INPUT) console.log('  ⚠  Nessuno strumento di input trovato: solo visualizzazione.');
  if (NO_INPUT) console.log('  Modalità sola visualizzazione (--no-input).');
  console.log('  Premi Ctrl+C per fermare e revocare l\'accesso.');
  console.log('────────────────────────────────────────────────────────\n');

  startIngest();
  inputLoop();
  heartbeat();
})().catch(err => { console.error('Agente terminato:', err.message); process.exit(1); });
