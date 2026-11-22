// LS Exchange (Lang & Schwarz): la borsa su cui esegue Trade Republic. Prezzi e storici pubblici del sito
// ls-x.de, usati come fonte per gli strumenti che Yahoo non quota o quota su borse secondarie poco liquide
// (prezzi diversi da quelli di Trade Republic). Simbolo interno: "LS:<instrumentId>", sempre in EUR.
import { cached } from './cache.js';

const HOUR = 3600e3;
const BASE = 'https://www.ls-x.de/_rpc/json';
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (tr-montecarlo)', Accept: 'application/json' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const isLsSymbol = (s) => /^LS:\d+$/.test(String(s || ''));
export const lsSymbol = (id) => `LS:${id}`;
const idOf = (s) => Number(String(s).slice(3));

// Poche richieste alla volta verso ls-x.de (rispetto del sito)
let active = 0;
const queue = [];
async function slot(fn) {
  if (active >= 3) await new Promise((r) => queue.push(r));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    queue.shift()?.();
  }
}

async function getJson(url) {
  return slot(async () => {
    for (let a = 0; ; a++) {
      try {
        const r = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(20000) });
        if ((r.status === 429 || r.status >= 500) && a < 3) {
          await sleep(1500 * (a + 1));
          continue;
        }
        if (!r.ok) throw new Error(`LS HTTP ${r.status}`);
        return await r.json();
      } catch (e) {
        if (a >= 2) throw e;
        await sleep(800 * (a + 1));
      }
    }
  });
}

/** Strumento LS per ISIN: { id, name, category } oppure { none: true } (cache 30 giorni). */
export async function lsSearch(isin) {
  return cached(`ls_search_${isin}`, 30 * 24 * HOUR, async () => {
    const j = await getJson(`${BASE}/.lstc/instrument/search/main?q=${encodeURIComponent(isin)}&localeId=2`);
    const hit = (Array.isArray(j) ? j : []).find((x) => x.isin === isin && Number.isFinite(Number(x.instrumentId)));
    return hit ? { id: Number(hit.instrumentId), name: hit.displayname || null, category: hit.categorySymbol || null } : { none: true };
  });
}

const chartUrl = (id, series, container) =>
  `${BASE}/instrument/chart/dataForInstrument?container=${container}&instrumentId=${id}&marketId=1&quotetype=mid&series=${series}&type=mini&localeId=2`;

/** Chiusure giornaliere (ultimo prezzo di ogni giorno) dal 2014: { timestamps[s], closes[], isin }. */
export async function lsDaily(symbol) {
  const id = idOf(symbol);
  return cached(`ls_daily_${id}`, 12 * HOUR, async () => {
    const j = await getJson(chartUrl(id, 'history', 'chart1'));
    const data = j?.series?.history?.data || [];
    const byDay = new Map();
    for (const [ms, p] of data) if (Number.isFinite(ms) && p > 0) byDay.set(Math.floor(ms / 864e5), [ms, p]);
    const days = [...byDay.values()].sort((a, b) => a[0] - b[0]);
    if (!days.length) throw new Error(`LS ${id}: nessuno storico`);
    return { isin: j?.info?.isin || null, timestamps: days.map(([ms]) => Math.floor(ms / 1000)), closes: days.map(([, p]) => p) };
  });
}

// Lunedì 00:00 UTC della settimana (stesso raggruppamento delle serie settimanali di Yahoo)
const weekStart = (sec) => {
  const d = Math.floor(sec / 86400);
  return (d - ((d + 3) % 7)) * 86400; // 1970-01-01 era giovedì
};

/** Serie settimanale in EUR (ultima chiusura di ogni settimana, ultimi 10 anni), stesso formato di historyEur. */
export async function lsHistoryEur(symbol) {
  const d = await lsDaily(symbol);
  const from = Date.now() / 1000 - 10 * 365.25 * 86400;
  const weeks = new Map();
  for (let k = 0; k < d.timestamps.length; k++) if (d.timestamps[k] >= from) weeks.set(weekStart(d.timestamps[k]), d.closes[k]);
  const ts = [...weeks.keys()].sort((a, b) => a - b);
  // ultima settimana: data reale dell'ultimo prezzo (come Yahoo), per il controllo dei dati fermi
  const timestamps = ts.map((t, k) => (k === ts.length - 1 ? d.timestamps.at(-1) : t));
  return { symbol, currency: 'EUR', exchange: 'LSX', name: null, timestamps, closesEur: ts.map((t) => +weeks.get(t).toPrecision(8)) };
}

/** Chiusure giornaliere degli ultimi 2 anni in EUR (per i rendimenti recenti). */
export async function lsRecentEur(symbol) {
  const d = await lsDaily(symbol);
  const from = Date.now() / 1000 - 2 * 365.25 * 86400;
  const k0 = d.timestamps.findIndex((t) => t >= from);
  const k = k0 < 0 ? d.timestamps.length : k0;
  return { timestamps: d.timestamps.slice(k), closesEur: d.closes.slice(k).map((x) => +x.toPrecision(8)) };
}

/** Quotazione attuale su LS Exchange (cache 20 minuti): stesso formato di quote(). */
export async function lsQuote(symbol) {
  const id = idOf(symbol);
  return cached(`ls_quote_${id}`, 20 * 60e3, async () => {
    const j = await getJson(chartUrl(id, 'intraday', 'chart2'));
    const pts = (j?.series?.intraday?.data || []).filter(([ms, p]) => Number.isFinite(ms) && p > 0);
    const prev = (j?.info?.plotlines || []).find((p) => p.id === 'previousDay')?.value;
    let price = pts.at(-1)?.[1];
    let marketTime = pts.length ? Math.floor(pts.at(-1)[0] / 1000) : null;
    let previousClose = prev > 0 ? prev : null;
    if (!(price > 0)) {
      const d = await lsDaily(symbol); // nessuno scambio oggi: ultima chiusura
      price = d.closes.at(-1);
      previousClose = d.closes.at(-2) ?? null;
      marketTime = d.timestamps.at(-1);
    }
    return {
      symbol,
      currency: 'EUR',
      price,
      priceEur: price,
      changePct: price > 0 && previousClose > 0 ? price / previousClose - 1 : null,
      marketTime,
    };
  });
}

/**
 * Confronto tra una serie settimanale (es. Yahoo) e quella di LS Exchange: correlazione dei rendimenti
 * settimanali e rapporto mediano dei prezzi nelle ultime 8 settimane. ok=false se la quotazione non
 * rispecchia il prezzo di Trade Republic (livello diverso >5% o andamento poco correlato).
 */
export function compareSeries(a, ls, { weeks = 104 } = {}) {
  const pairs = [];
  let p = 0;
  for (let k = 0; k < a.timestamps.length; k++) {
    const t = weekStart(a.timestamps[k] + 2 * 86400); // timestamp Yahoo di borse europee: domenica sera UTC
    while (p < ls.timestamps.length && weekStart(ls.timestamps[p]) < t) p++;
    if (p < ls.timestamps.length && weekStart(ls.timestamps[p]) === t) pairs.push([a.closesEur[k], ls.closesEur[p]]);
  }
  const last = pairs.slice(-weeks).filter(([x, y]) => x > 0 && y > 0);
  if (last.length < 8) return { ok: null, n: last.length };
  const r8 = last.slice(-8).map(([x, y]) => y / x).sort((x, y) => x - y);
  const level = r8[4];
  const ra = [];
  const rl = [];
  for (let k = 1; k < last.length; k++) {
    ra.push(Math.log(last[k][0] / last[k - 1][0]));
    rl.push(Math.log(last[k][1] / last[k - 1][1]));
  }
  const mean = (v) => v.reduce((s, x) => s + x, 0) / v.length;
  const ma = mean(ra);
  const ml = mean(rl);
  const sa = Math.sqrt(mean(ra.map((x) => (x - ma) ** 2)));
  const sl = Math.sqrt(mean(rl.map((x) => (x - ml) ** 2)));
  const corr = sa > 0 && sl > 0 ? mean(ra.map((x, k) => (x - ma) * (rl[k] - ml))) / (sa * sl) : null;
  const volLs = sl * Math.sqrt(52);
  // con volatilità molto bassa (monetari, obbligazionari brevi) la correlazione è solo rumore: conta il livello
  const badCorr = last.length >= 26 && volLs >= 0.08 && corr != null && corr < 0.8;
  const badLevel = Math.abs(level - 1) > 0.05;
  return { ok: !(badCorr || badLevel), n: last.length, corr: corr == null ? null : +corr.toFixed(3), level: +level.toFixed(4), volLs: +volLs.toFixed(3) };
}
