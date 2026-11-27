// Prezzo medio e prezzo minimo su 52 settimane e su 90 giorni, dai prezzi di chiusura in EUR (non aggiustati per i
// dividendi, come nei grafici di Trade Republic). Funzioni pure (testabili), usate dalla pipeline dei dati.

/** Finestre in giorni e numero minimo di sedute perché media e minimo abbiano senso. */
export const RANGE_WINDOWS = { 365: 120, 90: 30 };

/**
 * Media e minimo dei prezzi di chiusura negli ultimi `days` giorni, compreso il prezzo attuale come ultimo dato.
 * timestamps in secondi, closes in EUR. null se le sedute nella finestra sono meno di `minSessions`.
 */
export function priceRange(timestamps, closes, price, now = Date.now(), days = 365, minSessions = RANGE_WINDOWS[days] ?? 20) {
  const from = now / 1000 - days * 86400;
  let sum = 0;
  let n = 0;
  let min = Infinity;
  for (let i = 0; i < timestamps.length; i++) {
    const v = closes[i];
    if (timestamps[i] < from || !(v > 0)) continue;
    sum += v;
    n++;
    if (v < min) min = v;
  }
  if (n < minSessions) return null;
  if (price > 0) {
    sum += price;
    n++;
    if (price < min) min = price;
  }
  return { avg: sum / n, min, n };
}

const p6 = (x) => +x.toPrecision(6);
/** Campi pubblicati con le quotazioni: a52/l52 (medio e minimo a 52 settimane), a90/l90 (a 90 giorni), in EUR. */
export function rangeFields(timestamps, closes, price, now = Date.now()) {
  const y = priceRange(timestamps, closes, price, now, 365);
  const q = priceRange(timestamps, closes, price, now, 90);
  return { ...(y ? { a52: p6(y.avg), l52: p6(y.min) } : {}), ...(q ? { a90: p6(q.avg), l90: p6(q.min) } : {}) };
}

/** Distanza del prezzo attuale da un riferimento (medio o minimo), in frazione; null se manca un dato. */
export const distanceFrom = (price, ref) => (price > 0 && ref > 0 ? price / ref - 1 : null);
