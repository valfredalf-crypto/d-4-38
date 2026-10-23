// Cache su disco con scadenza (data/cache) + deduplica delle richieste concorrenti.
import fs from 'node:fs/promises';
import path from 'node:path';

const DIR = path.resolve(process.env.CACHE_DIR || 'data/cache');
const inflight = new Map();

function file(key) {
  return path.join(DIR, key.replace(/[^A-Za-z0-9._=-]/g, '_') + '.json');
}

// keep(value) === false: il valore viene restituito ma non salvato (es. risposta con errore).
export async function cached(key, ttlMs, fn, keep = () => true) {
  try {
    const { at, value } = JSON.parse(await fs.readFile(file(key), 'utf8'));
    if (Date.now() - at < ttlMs) return value;
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
