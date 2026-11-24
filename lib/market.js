// Dati di mercato normalizzati in EUR: storico settimanale, quotazioni, evidenze prospettiche.
import { chart, fundamentals, quoteBatch, etfHoldings, news as yNews } from './yahoo.js';
import { cached } from './cache.js';
import { isLsSymbol, lsHistoryEur, lsRecentEur, lsQuote } from './ls.js';

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

// Cambio attuale e chiusura del giorno prima (per la variazione di oggi in EUR)
async function fxQuote(cur) {
  return cached(`fxq_${cur}`, 5 * 60e3, async () => {
    const c = await chart(`EUR${cur}=X`, { range: '1d', interval: '1d' });
    return { rate: c.price, prev: c.previousClose ?? null };
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

/**
 * Raggruppamenti/frazionamenti di azioni non corretti da Yahoo (salto settimanale oltre ×12) falserebbero
 * rendimenti e rischio: si tiene solo lo storico successivo all'ultimo salto. Le crypto sono escluse
 * (a volte si muovono davvero così). Restituisce {timestamps, closes, cut} con cut = posizioni scartate.
 */
export function trimAtBreak(timestamps, closes, maxLog = Math.log(12)) {
  let cut = 0;
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1] > 0 && closes[i] > 0 && Math.abs(Math.log(closes[i] / closes[i - 1])) > maxLog) cut = i;
  }
  return cut ? { timestamps: timestamps.slice(cut), closes: closes.slice(cut), cut } : { timestamps, closes, cut: 0 };
}

/** Storico settimanale (fino a 10 anni) con prezzi aggiustati per dividendi, convertito in EUR. */
export async function historyEur(symbol) {
  const h = isLsSymbol(symbol) ? await lsHistoryEur(symbol) : await rawHistoryEur(symbol); // LS Exchange: prezzi di Trade Republic
  if (/-(USD|EUR)$/i.test(symbol)) return h; // crypto: salti grandi possibili
  // Il taglio si applica anche ai dati già in cache (salvati prima di questa correzione)
  const t = trimAtBreak(h.timestamps, h.closesEur);
  return t.cut ? { ...h, timestamps: t.timestamps, closesEur: t.closes } : h;
}

async function rawHistoryEur(symbol) {
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

const berlinFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23' });
function berlin(sec) {
  const p = Object.fromEntries(berlinFmt.formatToParts(new Date(sec * 1000)).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute), weekend: p.weekday === 'Sat' || p.weekday === 'Sun' };
}

/** Giorno (a Berlino) dell'ultima seduta di LS Exchange già iniziata: lun-ven dalle 7:30, la borsa su cui esegue Trade Republic. */
export function tradingDay(now = Date.now()) {
  let t = now / 1000;
  for (let k = 0; k < 8; k++) {
    const b = berlin(t);
    if (!b.weekend && (k > 0 || b.minutes >= 450)) return b.day;
    t -= 86400;
  }
  return berlin(now / 1000).day;
}

/**
 * Prezzo attuale e riferimento per la «variazione di oggi» come la intende Trade Republic: dal prezzo di chiusura del giorno
 * prima al prezzo attuale. Una quotazione della borsa d'origine riporta invece la variazione della sua ultima seduta: prima
 * dell'apertura (es. azioni USA al mattino) sarebbe quella di ieri. Regole:
 * - seduta di oggi: riferimento = chiusura precedente, prezzo = ultimo scambio (o quello dopo la chiusura, se più recente);
 * - seduta non ancora aperta: riferimento = ultima chiusura, prezzo = scambi prima dell'apertura/dopo la chiusura di oggi;
 * - nessun prezzo di oggi: nessuna variazione (meglio nessun dato che quello di ieri).
 * Restituisce { price, time, ref } nella valuta della quotazione (ref null = variazione di oggi non disponibile).
 */
export function sessionView({ price, previousClose, marketTime, prePrice, preTime, postPrice, postTime }, now = Date.now()) {
  const nowS = now / 1000;
  const recent = (p, t) => p > 0 && Number.isFinite(t) && t > (marketTime || 0) && nowS - t < 20 * 3600;
  let cur = price;
  let time = marketTime ?? null;
  if (recent(prePrice, preTime)) [cur, time] = [prePrice, preTime];
  if (recent(postPrice, postTime) && postTime > time) [cur, time] = [postPrice, postTime];
  if (!(price > 0) || !marketTime) return { price: cur, time, ref: previousClose > 0 ? previousClose : null };
  const day = tradingDay(now);
  let ref = null;
  if (berlin(marketTime).day >= day) ref = previousClose;
  else if (time > marketTime && berlin(time).day >= day) ref = price;
  return { price: cur, time, ref: ref > 0 ? ref : null };
}

async function toQuote(symbol, raw) {
  const [cur, div] = normalizeCurrency(raw.currency);
  const fx = cur === 'EUR' ? { rate: 1, prev: 1 } : await fxQuote(cur);
  const v = sessionView(raw);
  // In EUR, come su Trade Republic: la variazione comprende quella del cambio dalla chiusura del giorno prima
  const fxMove = fx.prev > 0 && fx.rate > 0 && Math.abs(fx.prev / fx.rate - 1) < 0.1 ? fx.prev / fx.rate : 1;
  return {
    symbol,
    currency: raw.currency,
    price: v.price,
    priceEur: v.price != null ? v.price / div / fx.rate : null,
    changePct: v.price > 0 && v.ref > 0 ? (v.price / v.ref) * fxMove - 1 : null,
    marketTime: v.time,
  };
}

// --- Rendimenti recenti (settimana, mese, da inizio anno) da chiusure giornaliere dell'ultimo anno
async function fxDaily(cur) {
  return cached(`fxd_${cur}_2y`, 12 * HOUR, () => chart(`EUR${cur}=X`, { range: '2y', interval: '1d' }));
}

/** Chiusure giornaliere degli ultimi 2 anni in EUR: prezzi semplici, senza dividendi, come le variazioni di Trade Republic. */
export async function recentEur(symbol) {
  if (isLsSymbol(symbol)) return lsRecentEur(symbol);
  return cached(`recent3_${symbol}_2y`, 12 * HOUR, async () => {
    const c = await chart(symbol, { range: '2y', interval: '1d', adjusted: false });
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
 * Rendimenti lordi in EUR fino al prezzo attuale: ultima settimana e ultime due (dalla chiusura di 7 e di 14 giorni fa),
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
    w2: ret(closeAtOrBefore(now / 1000 - 14 * 86400)),
    m: ret(closeAtOrBefore(monthsAgo(1))),
    m3: ret(closeAtOrBefore(monthsAgo(3))),
    y: ret(closeAtOrBefore(monthsAgo(12))),
    ytd: ret(closeAtOrBefore(yearStart, true)),
  };
}

/** Quotazione corrente (ritardata secondo la borsa di riferimento) in valuta locale e in EUR. */
export async function quote(symbol) {
  if (isLsSymbol(symbol)) return lsQuote(symbol);
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
  const yahoo = symbols.filter((s) => !isLsSymbol(s)); // LS Exchange: una richiesta per strumento (sotto)
  for (let k = 0; k < yahoo.length; k += 100) {
    const chunk = yahoo.slice(k, k + 100);
    const batch = await quoteBatch(chunk).catch(() => ({}));
    for (const s of chunk) if (batch[s]) out[s] = await toQuote(s, batch[s]);
  }
  const missing = symbols.filter((s) => !out[s]);
  let i = 0;
  await Promise.all(
    Array.from({ length: 8 }, async () => {
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
/** Composizione degli ETF (cambia lentamente: cache di 3 giorni). */
export async function holdings(symbol) {
  return cached(`holdings3_${symbol}`, 72 * HOUR, () => etfHoldings(symbol).catch((e) => ({ error: e.message })), (v) => !v?.error);
}

export async function outlook(symbol) {
  return cached(`outlook3_${symbol}`, 12 * HOUR, () => fundamentals(symbol), (v) => !v?.error);
}

// Patrimonio (AUM) e TER del fondo da justETF, per ISIN (cache 7 giorni)
export async function fundInfo(isin) {
  const { justEtf } = await import('./justetf.js');
  return cached(`fundinfo1_${isin}`, 7 * 24 * HOUR, () => justEtf(isin).catch((e) => ({ error: e.message })), (v) => !v?.error);
}

// Notizie recenti per simbolo (cache 6 ore): solo informative
export async function newsFor(symbol) {
  return cached(`news1_${symbol}`, 6 * HOUR, () => yNews(symbol).catch((e) => ({ error: e.message })), (v) => Array.isArray(v));
}
