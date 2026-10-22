// Import di elenchi di strumenti da CSV.
// Supporta: lista "All tradable instruments" di Xetra (Deutsche Börse) e CSV generici con colonne
// ISIN / nome / simbolo / tipo, oppure semplici elenchi di ISIN o ticker (uno per riga).
import { isValidIsin } from './isin.js';

function splitLine(line, delim) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (q && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else q = !q;
    } else if (ch === delim && !q) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

export function mapType(raw) {
  const t = String(raw || '').toUpperCase();
  if (/ETF|ETC|ETN|ETP|FUND|FON/.test(t)) return 'etf';
  if (/CRYPTO/.test(t)) return 'crypto';
  if (t === 'CS' || /STOCK|SHARE|EQUITY|AKTIE|AZIONE/.test(t)) return 'stock';
  return t ? null : 'stock';
}

export function parseInstrumentCsv(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  const headerIdx = lines.findIndex((l) => /\bisin\b/i.test(l) && /[;,\t]/.test(l));
  if (headerIdx === -1) {
    // Elenco semplice: un ISIN o un ticker per riga
    const rows = [];
    for (const l of lines) {
      const tok = l.trim().split(/[;,\t\s]+/)[0].toUpperCase();
      if (isValidIsin(tok)) rows.push({ isin: tok });
      else if (/^[A-Z0-9.^=-]{1,15}$/.test(tok)) rows.push({ symbol: tok });
    }
    return { format: 'list', rows };
  }
  const header = lines[headerIdx];
  const delim = [';', '\t', ','].reduce((best, d) => (header.split(d).length > header.split(best).length ? d : best), ';');
  const cols = splitLine(header, delim).map((c) => c.toLowerCase());
  // Per ogni nome candidato: prima corrispondenza esatta, poi parziale (es. "Instrument Type" ≠ "Trading Model Type").
  const find = (...names) => {
    for (const n of names) {
      const exact = cols.indexOf(n);
      if (exact !== -1) return exact;
    }
    for (const n of names) {
      const partial = cols.findIndex((c) => c.includes(n));
      if (partial !== -1) return partial;
    }
    return -1;
  };
  const iIsin = find('isin');
  const iName = find('instrument', 'name', 'nome', 'instrument name', 'description');
  const iMnemonic = cols.findIndex((c) => c === 'mnemonic');
  const iSymbol = find('symbol', 'ticker', 'simbolo');
  const iType = find('instrument type', 'type', 'tipo');
  const iCurrency = find('currency');
  const iStatus = cols.flatMap((c, k) => (c === 'instrument status' || c === 'product status' ? [k] : []));
  const xetra = iMnemonic !== -1;
  const rows = [];
  for (const line of lines.slice(headerIdx + 1)) {
    const f = splitLine(line, delim);
    const isin = (f[iIsin] || '').toUpperCase();
    if (!isValidIsin(isin)) continue;
    if (iStatus.some((k) => f[k] && !/^active$/i.test(f[k]))) continue; // sospesi/scaduti
    const type = iType !== -1 ? mapType(f[iType]) : null;
    if (iType !== -1 && !type) continue; // obbligazioni, warrant, ecc.
    let symbol = null;
    if (xetra && f[iMnemonic]) symbol = `${f[iMnemonic].toUpperCase()}.DE`;
    else if (iSymbol !== -1 && f[iSymbol]) symbol = f[iSymbol].toUpperCase();
    rows.push({
      isin,
      name: iName !== -1 ? f[iName] : null,
      symbol,
      type: type || null,
      currency: iCurrency !== -1 ? f[iCurrency] : null,
    });
  }
  return { format: xetra ? 'xetra' : 'csv', rows };
}
