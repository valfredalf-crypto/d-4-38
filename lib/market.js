// Dati di mercato normalizzati in EUR: storico settimanale, quotazioni, evidenze prospettiche.
import { chart, fundamentals, quoteBatch } from './yahoo.js';
import { cached } from './cache.js';

const HOUR = 3600e3;

// Valute in sottounità (pence, agorot, ...) → valuta principale e divisore.
const SUBUNITS = { GBp: ['GBP', 100], GBX: ['GBP', 100], ILA: ['ILS', 100], ZAc: ['ZAR', 100] };

export function normalizeCurrency(cur) {
  if (!cur) return ['EUR', 1];
  return SUBUNITS[cur] || [cur.toUpperCase(), 1];
}

async function fxHistory(cur) {
  return cached(`fx_${cur}_10y`, 12 * HOUR, () => chart(`EUR${cur}=X`, { range: '10y', interval: '1wk' }));
}

async function fxSpot(cur) {
  return cached(`fxspot_${cur}`, 5 * 60e3, async () => {
    const c = await chart(`EUR${cur}=X`, { range: '1d', interval: '1d' });
    return c.price;
  });
}

// Converte una serie in valuta locale in EUR usando il cambio EUR/XXX dell'ultima data disponibile ≤ t.
export function convertSeries(timestamps, closes, divisor, fxTs, fxCloses) {
  const out = [];
  let j = 0;
  for (let i = 0; i < timestamps.length; i++) {
    while (j + 1 < fxTs.length && fxTs[j + 1] <= timestamps[i]) j++;
    const rate = fxCloses[j];
    out.push(closes[i] / divisor / rate);
  }
  return out;
}

/** Storico settimanale (fino a 10 anni) con prezzi aggiustati per dividendi, convertito in EUR. */
export async function historyEur(symbol) {
  return cached(`hist_${symbol}_10y`, 24 * HOUR, async () => {
    const c = await chart(symbol, { range: '10y', interval: '1wk' });
    const [cur, div] = normalizeCurrency(c.currency);
    let closesEur = c.closes.map((x) => x / div);
    if (cur !== 'EUR') {
      const fx = await fxHistory(cur);
      closesEur = convertSeries(c.timestamps, c.closes, div, fx.timestamps, fx.closes);
    }
    return {
      symbol,
      currency: c.currency,
      exchange: c.exchange,
      name: c.name,
      timestamps: c.timestamps,
      closesEur: closesEur.map((x) => +x.toPrecision(8)),
    };
  });
}

async function toQuote(symbol, { price, previousClose, currency, marketTime }) {
  const [cur, div] = normalizeCurrency(currency);
  const rate = cur === 'EUR' ? 1 : await fxSpot(cur);
  return {
    symbol,
    currency,
    price,
    priceEur: price != null ? price / div / rate : null,
    changePct: price != null && previousClose ? price / previousClose - 1 : null,
    marketTime,
  };
}

// --- Rendimenti recenti (settimana, mese, da inizio anno) da chiusure giornaliere dell'ultimo anno
async function fxDaily(cur) {
  return cached(`fxd_${cur}_2y`, 12 * HOUR, () => chart(`EUR${cur}=X`, { range: '2y', interval: '1d' }));
}

/** Chiusure giornaliere degli ultimi 2 anni (aggiustate per dividendi) in EUR. */
export async function recentEur(symbol) {
  return cached(`recent_${symbol}_2y`, 12 * HOUR, async () => {
    const c = await chart(symbol, { range: '2y', interval: '1d' });
    const [cur, div] = normalizeCurrency(c.currency);
    let closesEur = c.closes.map((x) => x / div);
    if (cur !== 'EUR') {
      const fx = await fxDaily(cur);
      closesEur = convertSeries(c.timestamps, c.closes, div, fx.timestamps, fx.closes);
    }
    return { timestamps: c.timestamps, closesEur: closesEur.map((x) => +x.toPrecision(8)) };
  });
}

const r4 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 1e4) / 1e4);

/**
 * Rendimenti lordi in EUR fino al prezzo attuale: ultima settimana (dalla chiusura di 7 giorni fa),
 * ultimo mese, 3 mesi e 1 anno (stesso giorno di 1/3/12 mesi prima) e da inizio anno
 * (ultima chiusura dell'anno scorso). null se lo storico non arriva così indietro.
 */
export function performanceFrom(recent, priceEur, now = Date.now()) {
  const ts = recent?.timestamps || [];
  const cl = recent?.closesEur || [];
  if (!ts.length) return null;
  const price = priceEur > 0 ? priceEur : cl.at(-1);
  const closeAtOrBefore = (sec, strict = false) => {
    let v = null;
    for (let i = 0; i < ts.length && (strict ? ts[i] < sec : ts[i] <= sec); i++) v = cl[i];
    return v;
  };
  const d = new Date(now);
  const monthsAgo = (k) => {
    const x = new Date(now);
    x.setUTCMonth(d.getUTCMonth() - k);
    return x.getTime() / 1000;
  };
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1) / 1000;
  const ret = (base) => (base > 0 ? r4(price / base - 1) : null);
  return {
    w: ret(closeAtOrBefore(now / 1000 - 7 * 86400)),
    m: ret(closeAtOrBefore(monthsAgo(1))),
    m3: ret(closeAtOrBefore(monthsAgo(3))),
    y: ret(closeAtOrBefore(monthsAgo(12))),
    ytd: ret(closeAtOrBefore(yearStart, true)),
  };
}

/** Quotazione corrente (ritardata secondo la borsa di riferimento) in valuta locale e in EUR. */
export async function quote(symbol) {
  return cached(`quote_${symbol}`, 60e3, async () => {
    const c = await chart(symbol, { range: '1d', interval: '1d' });
    return toQuote(symbol, c);
  });
}

/**
 * Quotazioni di molti simboli: richieste a blocchi di 100; i simboli mancanti nel blocco
 * (o tutti, se la richiesta a blocchi non è disponibile) vengono chiesti uno per uno.
 */
export async function quotesMany(symbols) {
  const out = {};
  for (let k = 0; k < symbols.length; k += 100) {
    const chunk = symbols.slice(k, k + 100);
    const batch = await quoteBatch(chunk).catch(() => ({}));
    for (const s of chunk) if (batch[s]) out[s] = await toQuote(s, batch[s]);
  }
  const missing = symbols.filter((s) => !out[s]);
  let i = 0;
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (i < missing.length) {
        const s = missing[i++];
        const q = await quote(s).catch(() => null);
        if (q) out[s] = q;
      }
    }),
  );
  return out;
}

/** Evidenze recenti per la stima prospettica; il prezzo obiettivo resta nella valuta dello strumento. */
export async function outlook(symbol) {
  return cached(`outlook3_${symbol}`, 12 * HOUR, () => fundamentals(symbol), (v) => !v?.error);
}
