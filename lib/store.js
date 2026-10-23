// Universo strumenti = lista iniziale verificata (data/instruments.json) + modifiche dell'utente.
import fs from 'node:fs';
import path from 'node:path';

const SEED = path.resolve('data/instruments.json');
// Universo selezionato automaticamente (scripts/build-universe.js); se manca si usa la lista iniziale.
const UNIVERSE = path.resolve(process.env.UNIVERSE || 'data/universe.json');
// Strumenti aggiunti per ISIN dalla versione online (scripts/manage-isin.js): sempre in lista.
const EXTRA = path.resolve(process.env.EXTRA_INSTRUMENTS || 'data/extra-instruments.json');

export function loadExtra() {
  try {
    return JSON.parse(fs.readFileSync(EXTRA, 'utf8'));
  } catch {
    return [];
  }
}

// Strumenti importati in blocco da file di ISIN (scripts/resolve-imports.js): sempre in lista.
const IMPORTED = path.resolve(process.env.IMPORTED || 'data/imported-instruments.json');
export function loadImported() {
  try {
    return JSON.parse(fs.readFileSync(IMPORTED, 'utf8'));
  } catch {
    return [];
  }
}

export function saveExtra(list) {
  fs.writeFileSync(EXTRA, JSON.stringify(list, null, 1) + '\n');
}
const USER = path.resolve(process.env.USER_INSTRUMENTS || 'data/user-instruments.json');

function loadUser() {
  try {
    const u = JSON.parse(fs.readFileSync(USER, 'utf8'));
    return { added: u.added || [], removed: u.removed || [] };
  } catch {
    return { added: [], removed: [] };
  }
}

function saveUser(u) {
  fs.mkdirSync(path.dirname(USER), { recursive: true });
  fs.writeFileSync(USER, JSON.stringify(u, null, 1));
}

export function seed() {
  return JSON.parse(fs.readFileSync(SEED, 'utf8'));
}

export function universe() {
  if (process.env.UNIVERSE !== 'off' && fs.existsSync(UNIVERSE)) return JSON.parse(fs.readFileSync(UNIVERSE, 'utf8'));
  return seed();
}

export function listInstruments() {
  const { meta, instruments } = universe();
  const u = loadUser();
  const removed = new Set(u.removed);
  const bySymbol = new Map();
  for (const i of instruments) bySymbol.set(i.symbol, { ...i, source: 'seed', note: meta.notes?.[i.symbol] || null });
  const isins = new Set(instruments.map((i) => i.isin).filter(Boolean));
  for (const [list, source] of [[loadExtra(), 'extra'], [loadImported(), 'import']]) {
    for (const i of list) {
      if (bySymbol.has(i.symbol) || (i.isin && isins.has(i.isin))) continue;
      if (i.isin) isins.add(i.isin);
      const { via, ...rest } = i;
      bySymbol.set(i.symbol, { ...rest, source });
    }
  }
  for (const i of u.added) if (!bySymbol.has(i.symbol)) bySymbol.set(i.symbol, { ...i, source: 'user' });
  return [...bySymbol.values()].filter((i) => !removed.has(i.symbol));
}

export function addInstruments(list) {
  const u = loadUser();
  const current = listInstruments();
  const existing = new Set(current.map((i) => i.symbol));
  const isins = new Set(current.map((i) => i.isin).filter(Boolean));
  let added = 0;
  for (const i of list) {
    if (!i.symbol || !['stock', 'etf', 'crypto'].includes(i.type)) continue;
    u.removed = u.removed.filter((s) => s !== i.symbol);
    if (existing.has(i.symbol) || (i.isin && isins.has(i.isin))) continue;
    if (i.isin) isins.add(i.isin);
    u.added.push({ symbol: i.symbol, isin: i.isin || null, name: i.name || i.symbol, type: i.type });
    existing.add(i.symbol);
    added++;
  }
  saveUser(u);
  return added;
}

export function removeInstrument(symbol) {
  const u = loadUser();
  u.added = u.added.filter((i) => i.symbol !== symbol);
  if (!u.removed.includes(symbol)) u.removed.push(symbol);
  saveUser(u);
}
