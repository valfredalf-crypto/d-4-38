// Aggiunge o rimuove uno strumento per ISIN (richiesta dalla versione online tramite issue GitHub).
// Uso: ISSUE_TITLE="Aggiungi ISIN IE00B4L5Y983" RESULT_FILE=esito.md node scripts/manage-isin.js
import fs from 'node:fs';
import { listInstruments, loadExtra, saveExtra } from '../lib/store.js';
import { search } from '../lib/yahoo.js';
import { historyEur } from '../lib/market.js';
import { isValidIsin } from '../public/js/isin.js';
import { isEuroListing } from '../lib/universe.js';
import { downloadXetraCsv } from '../lib/xetra.js';
import { parseInstrumentCsv } from '../lib/importer.js';

// Ticker Xetra dalla lista ufficiale Deutsche Börse (es. ISIN senza quotazioni utili nella ricerca Yahoo).
async function xetraListing(isin) {
  try {
    const { text } = await downloadXetraCsv(() => {});
    const row = parseInstrumentCsv(text).rows.find((r) => r.isin === isin && r.symbol);
    return row ? { symbol: row.symbol, name: row.name, type: row.type, exchange: 'Xetra' } : null;
  } catch {
    return null;
  }
}

export function parseRequest(title) {
  const m = String(title || '').trim().match(/^(aggiungi|rimuovi)\s+isin\s*:?\s*([A-Za-z0-9]{12})\b/i);
  if (!m) return null;
  return { action: m[1].toLowerCase() === 'aggiungi' ? 'add' : 'remove', isin: m[2].toUpperCase() };
}

const TYPE_LABEL = { stock: 'azione', etf: 'ETF/ETC', crypto: 'crypto' };

async function add(isin) {
  const existing = listInstruments().find((i) => i.isin === isin);
  if (existing) return { ok: true, msg: `ℹ️ **${existing.name}** (${existing.symbol}, ${isin}) è già nella lista.` };
  const hits = (await search(isin).catch(() => [])).filter((h) => ['stock', 'etf', 'crypto'].includes(h.type));
  // Prima Xetra (lista ufficiale, prezzi in euro vicini a Trade Republic), poi le altre borse in euro, poi il resto.
  const xetra = await xetraListing(isin);
  const ordered = [
    ...(xetra ? [{ ...xetra, type: xetra.type || hits[0]?.type || 'etf' }] : []),
    ...hits.filter((h) => isEuroListing(h.symbol) && h.symbol !== xetra?.symbol),
    ...hits.filter((h) => !isEuroListing(h.symbol)),
  ];
  if (!ordered.length) return { ok: false, msg: `❌ Nessuno strumento trovato per l'ISIN ${isin} (né su Yahoo Finance né nella lista Xetra).` };
  for (const hit of ordered) {
    try {
      const h = await historyEur(hit.symbol);
      if (h.closesEur.length < 10) continue;
      const inst = { symbol: hit.symbol, isin, name: h.name || hit.name, type: hit.type, addedAt: new Date().toISOString() };
      saveExtra([...loadExtra().filter((i) => i.isin !== isin), inst]);
      const years = (h.closesEur.length / 52).toFixed(1);
      const warn = h.closesEur.length < 104 ? ` ⚠️ Solo ${years} anni di storico: serve almeno 2 anni per la previsione.` : '';
      return { ok: true, changed: true, msg: `✅ Aggiunto **${inst.name}** (${TYPE_LABEL[inst.type]}, ${inst.symbol} · ${hit.exchange || ''}). Sarà nell'app tra pochi minuti.${warn}` };
    } catch {
      /* prova la quotazione successiva */
    }
  }
  return { ok: false, msg: `❌ Trovato l'ISIN ${isin} (${ordered.map((h) => h.symbol).join(', ')}) ma senza dati storici utilizzabili.` };
}

function remove(isin) {
  const extra = loadExtra();
  const hit = extra.find((i) => i.isin === isin);
  if (hit) {
    saveExtra(extra.filter((i) => i.isin !== isin));
    return { ok: true, changed: true, msg: `🗑️ Rimosso **${hit.name}** (${hit.symbol}, ${isin}).` };
  }
  const auto = listInstruments().find((i) => i.isin === isin);
  if (auto) return { ok: false, msg: `ℹ️ **${auto.name}** fa parte della selezione automatica (migliori previsioni): non si può rimuovere singolarmente.` };
  return { ok: false, msg: `ℹ️ L'ISIN ${isin} non è nella lista.` };
}

export async function handle(title) {
  const req = parseRequest(title);
  if (!req) return { ok: false, msg: '❌ Titolo non valido. Usa: `Aggiungi ISIN <codice>` oppure `Rimuovi ISIN <codice>`.' };
  if (!isValidIsin(req.isin)) return { ok: false, msg: `❌ ${req.isin} non è un ISIN valido (cifra di controllo errata).` };
  return req.action === 'add' ? add(req.isin) : remove(req.isin);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const res = await handle(process.env.ISSUE_TITLE ?? process.argv.slice(2).join(' '));
  console.log(res.msg);
  if (process.env.RESULT_FILE) fs.writeFileSync(process.env.RESULT_FILE, res.msg + '\n');
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `changed=${res.changed ? 'true' : 'false'}\n`);
  process.exitCode = res.ok ? 0 : 1;
}
