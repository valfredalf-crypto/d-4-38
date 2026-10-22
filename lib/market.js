// Dati di mercato normalizzati in EUR: storico settimanale, quotazioni, evidenze prospettiche.
import { chart, fundamentals } from './yahoo.js';
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
  return cached(`hist_${symbol}_10y`, 12 * HOUR, async () => {
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

/** Quotazione corrente (ritardata secondo la borsa di riferimento) in valuta locale e in EUR. */
export async function quote(symbol) {
  return cached(`quote_${symbol}`, 60e3, async () => {
    const c = await chart(symbol, { range: '1d', interval: '1d' });
    const [cur, div] = normalizeCurrency(c.currency);
    const rate = cur === 'EUR' ? 1 : await fxSpot(cur);
    const price = c.price;
    const prev = c.previousClose;
    return {
      symbol,
      currency: c.currency,
      price,
      priceEur: price != null ? price / div / rate : null,
      changePct: price != null && prev ? price / prev - 1 : null,
      marketTime: c.marketTime,
    };
  });
}

/** Evidenze recenti per la stima prospettica; il prezzo obiettivo resta nella valuta dello strumento. */
export async function outlook(symbol) {
  return cached(`outlook_${symbol}`, 12 * HOUR, () => fundamentals(symbol));
}
