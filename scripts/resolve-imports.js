// Collega gli ISIN di data/import-requests.json a un simbolo Yahoo con dati storici reali e salva
// gli strumenti in data/imported-instruments.json (sempre presenti nell'app, segnati come importati).
// Ordine dei tentativi: ticker Xetra dalla lista ufficiale Deutsche Börse → ticker indicato nel file
// → ricerca Yahoo per ISIN (borse in euro prima). Uso: node scripts/resolve-imports.js
import fs from 'node:fs';
import { downloadXetraCsv } from '../lib/xetra.js';
import { parseInstrumentCsv } from '../lib/importer.js';
import { historyEur } from '../lib/market.js';
import { search } from '../lib/yahoo.js';
import { isEuroListing, hasImplausibleJumps, isLeveraged } from '../lib/universe.js';
import { isValidIsin } from '../public/js/isin.js';
import { lsSearch, lsSymbol, isLsSymbol } from '../lib/ls.js';

const REQUESTS = process.env.IMPORT_REQUESTS || 'data/import-requests.json';
const OUT = process.env.IMPORTED || 'data/imported-instruments.json';
const UNRESOLVED = process.env.IMPORT_UNRESOLVED || 'data/import-unresolved.json';
const MIN_WEEKS = Number(process.env.MIN_WEEKS) || 8; // storico minimo (≈2 mesi): gli strumenti recenti entrano in elenco, la previsione a 5 anni richiede ≥1 anno (minYears)
const log = (...a) => console.log(...a);
// Tempo massimo di lavoro: poi si salva e il workflow riparte da dove si è fermato (niente lavoro perso al timeout)
const DEADLINE = Date.now() + (Number(process.env.TIME_BUDGET_MIN) || 200) * 60e3;
const LS_RECHECK_DAYS = 7;
const today = new Date().toISOString().slice(0, 10);
// Prodotti a leva/short: salti settimanali ampi sono normali (×3 non è più un dato errato), soglia ×12.
// Nomi concordi: almeno 3 parole e ≥ 80% di quelle della quotazione presenti nel nome del catalogo.
const words = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
const sameName = (catalogName, listingName) => {
  const a = new Set(words(catalogName));
  const b = words(listingName);
  return b.length >= 3 && b.filter((w) => a.has(w)).length / b.length >= 0.8;
};
const jumpLimit = (name) => (isLeveraged(name) ? Math.log(12) : undefined);

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
      if (h && hasImplausibleJumps(h.closesEur.slice(-521), jumpLimit(it.name))) {
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

const how = { xetra: 0, hint: 0, search: 0, name: 0, ls: 0 };
const unresolved = [];
let i = 0;
let n = 0;
await Promise.all(
  Array.from({ length: 4 }, async () => {
    while (i < todo.length && Date.now() < DEADLINE) {
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
      // Stesso ISIN su altre quotazioni che Yahoo classifica diversamente (es. ETC visto come «stock»), poi ricerca
      // per nome: accettata solo se il nome della quotazione concorda con quello del catalogo.
      if (!resolved) {
        const byIsin = (await search(req.isin).catch(() => [])).filter((h) => ['stock', 'etf'].includes(h.type) && !/\.SG$/.test(h.symbol));
        const ord = [...byIsin.filter((h) => isEuroListing(h.symbol)), ...byIsin.filter((h) => !isEuroListing(h.symbol))];
        for (const h of ord.slice(0, 6)) resolved ||= await tryListing(req, h.symbol, 'search', tried);
      }
      if (!resolved && req.name && req.type === 'etf') {
        const byName = (await search(req.name).catch(() => [])).filter((h) => h.type === 'etf' || h.type === 'stock');
        const ord = [...byName.filter((h) => isEuroListing(h.symbol)), ...byName.filter((h) => !isEuroListing(h.symbol))];
        for (const h of ord.slice(0, 5)) resolved ||= await tryListing(req, h.symbol, 'name', tried, true);
      }
      // Nessuna quotazione Yahoo valida: LS Exchange, la borsa di Trade Republic (stessi prezzi dell'app TR)
      if (!resolved) {
        const ls = await lsSearch(req.isin).catch(() => null);
        if (ls?.id) resolved = await tryListing(req, lsSymbol(ls.id), 'ls', tried);
        if (resolved) resolved.lsChk = today;
      }
      if (resolved) {
        done.set(req.isin, resolved);
        how[resolved.via]++;
      } else unresolved.push({ isin: req.isin, name: req.name, type: req.type, tried: [...tried] });
      if (++n % 250 === 0) log(`  ${n}/${todo.length}`);
    }
  }),
);

async function tryListing(req, symbol, via, tried, checkName = false) {
  if (!symbol || tried.has(symbol)) return null;
  tried.add(symbol);
  try {
    const h = await historyEur(symbol);
    if (h.closesEur.length < MIN_WEEKS) return null;
    if (checkName && !sameName(req.name, h.name)) return null; // ricerca per nome: solo se il nome concorda
    if (req.type !== 'crypto' && hasImplausibleJumps(h.closesEur.slice(-521), jumpLimit(req.name))) return null; // dati errati
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

// Prezzi come in Trade Republic: TR esegue su LS Exchange, quindi prezzi e storico di ogni strumento vengono da LS Exchange
// (ISIN trovato, storico sufficiente, quotazione recente, dati coerenti). Yahoo resta per le stime degli analisti e la
// composizione dei fondi (outlookSymbol) e come ripiego per gli strumenti che LS Exchange non ha o non quota più.
const LS_VER = 2;
const FRESH_DAYS = 14;
const age = (h) => (Date.now() / 1000 - h.timestamps.at(-1)) / 86400;
const lsGood = (h, name) => h.closesEur.length >= MIN_WEEKS && age(h) <= FRESH_DAYS && !hasImplausibleJumps(h.closesEur.slice(-521), jumpLimit(name));
const stale = (d) => !d || (Date.parse(today) - Date.parse(d)) / 864e5 >= LS_RECHECK_DAYS;
const toCheck = [...done.values()].filter((it) => it.type !== 'crypto' && it.isin && (it.lsVer !== LS_VER || stale(it.lsChk)));
const lsFix = { checked: 0, toLs: 0, backToYahoo: 0, absent: 0 };
let c = 0;
await Promise.all(
  Array.from({ length: 4 }, async () => {
    while (c < toCheck.length && Date.now() < DEADLINE) {
      const it = toCheck[c++];
      try {
        const onLs = isLsSymbol(it.symbol);
        const ls = onLs ? { id: Number(it.symbol.slice(3)) } : await lsSearch(it.isin);
        if (!ls?.id) {
          done.set(it.isin, { ...it, lsVer: LS_VER, lsChk: today });
          lsFix.absent++;
          continue;
        }
        let lsErr = false;
        const lh = await historyEur(lsSymbol(ls.id)).catch((e) => {
          lsErr = !/nessuno storico/.test(e.message); // errore di rete o sito non disponibile: nessuna decisione
          return null;
        });
        if (lsErr) continue;
        lsFix.checked++;
        if (lh && lsGood(lh, it.name)) {
          if (!onLs) {
            const { via, ...rest } = it;
            done.set(it.isin, { ...rest, symbol: lsSymbol(ls.id), outlookSymbol: it.outlookSymbol || it.symbol, via: 'ls', lsVer: LS_VER, lsChk: today });
            lsFix.toLs++;
          } else done.set(it.isin, { ...it, lsVer: LS_VER, lsChk: today });
        } else if (onLs && it.outlookSymbol) {
          // LS Exchange non quota più lo strumento: si torna a Yahoo se ha dati recenti
          const yh = await historyEur(it.outlookSymbol).catch(() => null);
          if (yh && lsGood(yh, it.name)) {
            const { outlookSymbol, via, ...rest } = it;
            done.set(it.isin, { ...rest, symbol: it.outlookSymbol, via: 'yahoo', lsVer: LS_VER, lsChk: today });
            lsFix.backToYahoo++;
          } else done.set(it.isin, { ...it, lsVer: LS_VER, lsChk: today });
        } else done.set(it.isin, { ...it, lsVer: LS_VER, lsChk: today });
      } catch {
        /* LS non raggiungibile: si riprova al prossimo giro */
      }
      if ((lsFix.checked + lsFix.absent) % 500 === 0) log(`  LS: ${lsFix.checked + lsFix.absent}/${toCheck.length}`);
    }
  }),
);
log(`Prezzi da LS Exchange: controllati ${lsFix.checked}, passati a LS ${lsFix.toLs}, tornati a Yahoo ${lsFix.backToYahoo}, non quotati su LS ${lsFix.absent}, da fare ${toCheck.length - c}`);
const pending = Math.max(0, todo.length - i) + Math.max(0, toCheck.length - c);
if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `pending=${pending}\n`);
if (pending) log(`Tempo esaurito: ${pending} operazioni rimandate al prossimo giro`);

const list = requests.map((r) => done.get(r.isin)).filter(Boolean);
fs.writeFileSync(OUT, JSON.stringify(list) + '\n');
fs.writeFileSync(UNRESOLVED, JSON.stringify(unresolved, null, 0) + '\n');
log(`Risolti in questo giro: Xetra ${how.xetra}, ticker del file ${how.hint}, ricerca ${how.search}, per nome ${how.name}, LS Exchange ${how.ls}; non risolti ${unresolved.length}`);
log(`Totale importati: ${list.length} (${list.filter((x) => x.type === 'stock').length} azioni, ${list.filter((x) => x.type === 'etf').length} ETF)`);
