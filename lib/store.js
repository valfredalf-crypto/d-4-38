// Universo strumenti = lista iniziale verificata (data/instruments.json) + modifiche dell'utente.
import fs from 'node:fs';
import path from 'node:path';

const SEED = path.resolve('data/instruments.json');
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

export function listInstruments() {
  const { meta, instruments } = seed();
  const u = loadUser();
  const removed = new Set(u.removed);
  const bySymbol = new Map();
  for (const i of instruments) bySymbol.set(i.symbol, { ...i, source: 'seed', note: meta.notes?.[i.symbol] || null });
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
