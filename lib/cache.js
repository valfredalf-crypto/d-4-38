// Cache su disco con scadenza (data/cache) + deduplica delle richieste concorrenti.
import fs from 'node:fs/promises';
import path from 'node:path';

const DIR = path.resolve(process.env.CACHE_DIR || 'data/cache');
const inflight = new Map();

function file(key) {
  return path.join(DIR, key.replace(/[^A-Za-z0-9._=-]/g, '_') + '.json');
}

// keep(value) === false: il valore viene restituito ma non salvato (es. risposta con errore).
// Scadenza "sfalsata" per chiave (75–125% del TTL): gli aggiornamenti di migliaia di strumenti
// si distribuiscono nel tempo invece di arrivare tutti insieme (meno blocchi da Yahoo).
function jitter(key) {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return 0.75 + ((h >>> 0) % 1000) / 2000;
}

export async function cached(key, ttlMs, fn, keep = () => true) {
  try {
    const { at, value } = JSON.parse(await fs.readFile(file(key), 'utf8'));
    if (Date.now() - at < ttlMs * jitter(key)) return value;
  } catch {
    /* miss */
  }
  if (inflight.has(key)) return inflight.get(key);
  const p = (async () => {
    const value = await fn();
    if (!keep(value)) return value;
    await fs.mkdir(DIR, { recursive: true });
    await fs.writeFile(file(key), JSON.stringify({ at: Date.now(), value }));
    return value;
  })().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}
