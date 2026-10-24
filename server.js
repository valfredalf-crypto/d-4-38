// Server HTTP senza dipendenze: serve l'interfaccia (public/) e fa da proxy ai dati di mercato.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { listInstruments, addInstruments, removeInstrument, universe } from './lib/store.js';
import { historyEur, quote, outlook, recentEur, performanceFrom } from './lib/market.js';
import { search, pickListing } from './lib/yahoo.js';
import { parseInstrumentCsv } from './lib/importer.js';
import { cached } from './lib/cache.js';
import { runBacktest, backtestPayload } from './public/js/backtest.js';
import { DEFAULT_SETTINGS, BENCHMARK_SYMBOL, CRYPTO_BENCHMARK_SYMBOL } from './public/js/analyze.js';
import { CALIBRATION } from './public/js/calibration.js';

const PORT = Number(process.env.PORT || 3000);
const PUBLIC = path.resolve('public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json' };
const MAX_IMPORT_RESOLVE = 500;

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readBody(req, limit = 20e6) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw Object.assign(new Error('Payload troppo grande'), { status: 413 });
    chunks.push(c);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function mapLimit(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k]).catch((e) => ({ error: e.message }));
      }
    }),
  );
  return out;
}

async function importCsv(text) {
  const { format, rows } = parseInstrumentCsv(text);
  const ready = [];
  const unresolved = [];
  const toResolve = [];
  const known = new Set(listInstruments().flatMap((i) => [i.symbol, i.isin]).filter(Boolean));
  for (const r of rows) {
    if (known.has(r.isin) || known.has(r.symbol)) continue; // già presente: niente ricerca superflua
    (r.symbol && r.type ? ready : toResolve).push(r);
  }
  // Le righe senza simbolo/tipo vengono risolte cercando l'ISIN (o il ticker) su Yahoo Finance.
  const batch = toResolve.slice(0, MAX_IMPORT_RESOLVE);
  const resolved = await mapLimit(batch, 4, async (r) => {
    const hits = await search(r.isin || r.symbol);
    const hit = r.symbol ? hits.find((h) => h.symbol === r.symbol) || pickListing(hits) : pickListing(hits);
    return hit ? { ...r, symbol: hit.symbol, type: r.type || hit.type, name: r.name || hit.name } : null;
  });
  resolved.forEach((r, k) => (r && r.symbol ? ready.push(r) : unresolved.push(batch[k].isin || batch[k].symbol)));
  const skipped = toResolve.length - batch.length;
  const added = addInstruments(ready);
  return { format, parsed: rows.length, added, unresolved, skipped };
}

const routes = {
  'GET /api/meta': async () => ({ ...universe().meta, mock: process.env.MOCK === '1' }),
  'GET /api/instruments': async () => listInstruments(),
  'POST /api/instruments': async (req) => {
    const body = JSON.parse(await readBody(req));
    return { added: addInstruments(Array.isArray(body) ? body : [body]) };
  },
  'DELETE /api/instruments': async (req, url) => {
    removeInstrument(url.searchParams.get('symbol'));
    return { ok: true };
  },
  'GET /api/search': async (req, url) => search(url.searchParams.get('q') || ''),
  'GET /api/history': async (req, url) => historyEur(url.searchParams.get('symbol')),
  'GET /api/outlook': async (req, url) => {
    const symbol = url.searchParams.get('symbol');
    const inst = listInstruments().find((i) => i.symbol === symbol);
    return outlook(inst?.outlookSymbol || symbol);
  },
  'GET /api/quotes': async (req, url) => {
    const symbols = (url.searchParams.get('symbols') || '').split(',').filter(Boolean).slice(0, 200);
    const list = await mapLimit(symbols, 8, async (s) => {
      const q = await quote(s);
      const recent = await recentEur(s).catch(() => null);
      return { ...q, perf: performanceFrom(recent, q.priceEur) };
    });
    return Object.fromEntries(symbols.map((s, k) => [s, list[k]]));
  },
  'POST /api/import': async (req) => importCsv(await readBody(req)),
  'GET /api/backtest': async () =>
    cached('backtest_local', 12 * 3600e3, async () => {
      const list = listInstruments();
      const benchmark = await historyEur(BENCHMARK_SYMBOL).catch(() => null);
      const cryptoBenchmark = await historyEur(CRYPTO_BENCHMARK_SYMBOL).catch(() => null);
      const items = [];
      for (const instrument of list) {
        const history = await historyEur(instrument.symbol).catch(() => null);
        if (history) items.push({ instrument, history, benchmark, cryptoBenchmark });
      }
      const report = (() => {
        try {
          return JSON.parse(fs.readFileSync('data/calibration-report.json', 'utf8'));
        } catch {
          return null;
        }
      })();
      return backtestPayload(runBacktest(items, DEFAULT_SETTINGS), { generatedAt: new Date().toISOString(), calibration: report, calibrationInUse: CALIBRATION });
    }),
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const handler = routes[`${req.method} ${url.pathname}`];
  if (handler) {
    try {
      send(res, 200, await handler(req, url));
    } catch (e) {
      send(res, e.status || 502, { error: e.message });
    }
    return;
  }
  if (req.method !== 'GET') return send(res, 405, { error: 'Metodo non consentito' });
  const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
  const file = path.resolve(PUBLIC, rel);
  if (!file.startsWith(PUBLIC + path.sep)) return send(res, 403, { error: 'Vietato' });
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, { error: 'Non trovato' });
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`TR Monte Carlo in ascolto su http://localhost:${PORT}${process.env.MOCK === '1' ? '  (MODALITÀ DEMO: dati sintetici)' : ''}`);
});
