// Collega gli ISIN di data/import-requests.json a un simbolo Yahoo con dati storici reali e salva
// gli strumenti in data/imported-instruments.json (sempre presenti nell'app, segnati come importati).
// Ordine dei tentativi: ticker Xetra dalla lista ufficiale Deutsche Börse → ticker indicato nel file
// → ricerca Yahoo per ISIN (borse in euro prima). Uso: node scripts/resolve-imports.js
import fs from 'node:fs';
import { downloadXetraCsv } from '../lib/xetra.js';
import { parseInstrumentCsv } from '../lib/importer.js';
import { historyEur } from '../lib/market.js';
import { search } from '../lib/yahoo.js';
import { isEuroListing, hasImplausibleJumps } from '../lib/universe.js';
import { isValidIsin } from '../public/js/isin.js';

const REQUESTS = process.env.IMPORT_REQUESTS || 'data/import-requests.json';
const OUT = process.env.IMPORTED || 'data/imported-instruments.json';
const UNRESOLVED = process.env.IMPORT_UNRESOLVED || 'data/import-unresolved.json';
const MIN_WEEKS = 26; // almeno 6 mesi di storico per essere utile
const log = (...a) => console.log(...a);

const requests = JSON.parse(fs.readFileSync(REQUESTS, 'utf8')).instruments.filter((r) => isValidIsin(r.isin));
const previous = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : [];
const done = new Map(previous.map((i) => [i.isin, i]));
// Ricontrollo della qualità dei dati già collegati: le quotazioni con salti impossibili si ricollegano
// cercando un'altra borsa (es. quella principale del paese d'origine).
let recheck = 0;
await Promise.all(
  Array.from({ length: 4 }, async (_, w) => {
    for (let k = w; k < previous.length; k += 4) {
      const it = previous[k];
      if (it.type === 'crypto') continue;
      const h = await historyEur(it.symbol).catch(() => null);
      if (h && hasImplausibleJumps(h.closesEur.slice(-521))) {
        done.delete(it.isin);
        recheck++;
      }
    }
  }),
);
if (recheck) console.log(`Da ricollegare per dati anomali: ${recheck}`);
const todo = requests.filter((r) => !done.has(r.isin));
log(`Richieste: ${requests.length}, già risolte: ${requests.length - todo.length}, da risolvere: ${todo.length}`);

let xetra = new Map();
try {
  const { text } = await downloadXetraCsv(() => {});
  for (const r of parseInstrumentCsv(text).rows) if (r.symbol) xetra.set(r.isin, r.symbol);
  log(`Lista Xetra: ${xetra.size} ISIN`);
} catch (e) {
  log(`ATTENZIONE lista Xetra non disponibile: ${e.message}`);
}

const how = { xetra: 0, hint: 0, search: 0 };
const unresolved = [];
let i = 0;
let n = 0;
await Promise.all(
  Array.from({ length: 4 }, async () => {
    while (i < todo.length) {
      const req = todo[i++];
      const tried = new Set();
      const attempts = [];
      if (xetra.has(req.isin)) attempts.push([xetra.get(req.isin), 'xetra']);
      const old = previous.find((p) => p.isin === req.isin);
      if (old) tried.add(old.symbol); // quotazione già scartata per dati anomali
      let resolved = null;
      for (const [symbol, source] of attempts) resolved ||= await tryListing(req, symbol, source, tried);
      // Azioni USA/Canada non su Xetra: quotazione principale (liquida e con i dati degli analisti)
      // invece di quelle secondarie tedesche (.F), spesso poco scambiate.
      if (!resolved && req.type === 'stock' && /^(US|CA)/.test(req.isin)) {
        const primary = (await search(req.isin).catch(() => [])).find((h) => h.type === 'stock' && !h.symbol.includes('.'));
        if (primary) resolved = await tryListing(req, primary.symbol, 'search', tried);
      }
      if (!resolved && req.hint) resolved = await tryListing(req, req.hint, 'hint', tried);
      if (!resolved) {
        const hits = (await search(req.isin).catch(() => [])).filter((h) => h.type === req.type || (req.type === 'etf' && h.type === 'etf'));
        const ordered = [...hits.filter((h) => isEuroListing(h.symbol)), ...hits.filter((h) => !isEuroListing(h.symbol))];
        for (const h of ordered.slice(0, 6)) resolved ||= await tryListing(req, h.symbol, 'search', tried);
      }
      if (resolved) {
        done.set(req.isin, resolved);
        how[resolved.via]++;
      } else unresolved.push({ isin: req.isin, name: req.name, type: req.type, tried: [...tried] });
      if (++n % 250 === 0) log(`  ${n}/${todo.length}`);
    }
  }),
);

async function tryListing(req, symbol, via, tried) {
  if (!symbol || tried.has(symbol)) return null;
  tried.add(symbol);
  try {
    const h = await historyEur(symbol);
    if (h.closesEur.length < MIN_WEEKS) return null;
    if (req.type !== 'crypto' && hasImplausibleJumps(h.closesEur.slice(-521))) return null; // dati errati
    // Data dell'ultima quotazione: scarta i simboli fermi da più di 30 giorni (delistati o illiquidi)
    if (Date.now() / 1000 - h.timestamps.at(-1) > 30 * 86400) return null;
    return {
      symbol,
      isin: req.isin,
      name: req.name || h.name || symbol,
      type: req.type,
      ...(req.category ? { category: req.category } : {}),
      via,
    };
  } catch {
    return null;
  }
}

const list = requests.map((r) => done.get(r.isin)).filter(Boolean);
fs.writeFileSync(OUT, JSON.stringify(list) + '\n');
fs.writeFileSync(UNRESOLVED, JSON.stringify(unresolved, null, 0) + '\n');
log(`Risolti in questo giro: Xetra ${how.xetra}, ticker del file ${how.hint}, ricerca ${how.search}; non risolti ${unresolved.length}`);
log(`Totale importati: ${list.length} (${list.filter((x) => x.type === 'stock').length} azioni, ${list.filter((x) => x.type === 'etf').length} ETF)`);
