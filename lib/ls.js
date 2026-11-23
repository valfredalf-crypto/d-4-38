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
  if (active >= 6) await new Promise((r) => queue.push(r));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    queue.shift()?.();
  }
}

// Interruttore: se LS Exchange non risponde (guasto, oppure la protezione del sito respinge le richieste automatiche) dopo 5
// errori di fila le richieste si sospendono per 10 minuti e poi si riprova con poche richieste. Nel frattempo valgono gli storici
// salvati e le quotazioni della fonte di riserva: l'aggiornamento resta rapido e non si insiste su un sito che sta dicendo di no.
const LS_COOLDOWN = 10 * 60e3;
let fails = 0;
let downUntil = 0;
export const lsDown = () => Date.now() < downUntil;
function noteFail(reason) {
  if (++fails >= 5 && !lsDown()) {
    downUntil = Date.now() + LS_COOLDOWN;
    console.warn(`LS Exchange non risponde (${reason}): richieste sospese per 10 minuti, prezzi dalla fonte di riserva`);
  }
}
const DOWN = 'LS Exchange non disponibile';

async function getJson(url) {
  if (lsDown()) throw new Error(DOWN);
  return slot(async () => {
    for (let a = 0; ; a++) {
      if (lsDown()) throw new Error(DOWN);
      let r;
      try {
        r = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(20000) });
      } catch (e) {
        noteFail(e.name || 'rete');
        if (a >= 1) throw e;
        await sleep(800);
        continue;
      }
      if (r.status === 429 || r.status >= 500) {
        noteFail(`HTTP ${r.status}`);
        if (a >= 1) throw new Error(`LS HTTP ${r.status}`);
        await sleep(1500);
        continue;
      }
      if (!r.ok) throw new Error(`LS HTTP ${r.status}`);
      let j;
      try {
        j = await r.json();
      } catch {
        noteFail('risposta non valida');
        throw new Error('LS: risposta non valida');
      }
      fails = 0;
      return j;
    }
  });
}

/** Strumento LS per ISIN: { id, name, category } oppure { none: true } (cache 30 giorni). */
export async function lsSearch(isin) {
  return cached(`ls_search_${isin}`, 30 * 24 * HOUR, async () => {
    const j = await getJson(`${BASE}/.lstc/instrument/search/main?q=${encodeURIComponent(isin)}&localeId=2`);
    const hit = (Array.isArray(j) ? j : []).find((x) => x.isin === isin && Number.isFinite(Number(x.instrumentId)));
    return hit ? { id: Number(hit.instrumentId), name: hit.displayname || null, category: hit.categorySymbol || null } : { none: true };
  }, () => true, 180 * 24 * HOUR);
}

const chartUrl = (id, series, container) =>
  `${BASE}/instrument/chart/dataForInstrument?container=${container}&instrumentId=${id}&marketId=1&quotetype=mid&series=${series}&type=mini&localeId=2`;

// Lunedì 00:00 UTC della settimana (stesso raggruppamento delle serie settimanali di Yahoo)
const weekStart = (sec) => {
  const d = Math.floor(sec / 86400);
  return (d - ((d + 3) % 7)) * 86400; // 1970-01-01 era giovedì
};

/**
 * Storico compatto di LS Exchange (cache 6 ore): ultima chiusura di ogni settimana negli ultimi 10 anni e di ogni giorno negli
 * ultimi 2 anni. { isin, wTs[s], wCl[], dTs[s], dCl[] }
 */
export async function lsHist(symbol) {
  const id = idOf(symbol);
  // 24 ore (con scadenze sfalsate): le chiusure cambiano una volta al giorno e il prezzo attuale arriva dalla quotazione. Con 6 ore
  // ogni nuovo job dei dati live riscaricava tutti gli storici prima di pubblicare (oltre un'ora di dati fermi).
  return cached(`ls_hist2_${id}`, 24 * HOUR, async () => {
    const j = await getJson(chartUrl(id, 'history', 'chart1'));
    const data = j?.series?.history?.data || [];
    const byDay = new Map();
    for (const [ms, p] of data) if (Number.isFinite(ms) && p > 0) byDay.set(Math.floor(ms / 864e5), [ms, p]);
    const days = [...byDay.values()].sort((a, b) => a[0] - b[0]);
    if (!days.length) throw new Error(`LS ${id}: nessuno storico`);
    const now = Date.now() / 1000;
    const weeks = new Map();
    const dTs = [];
    const dCl = [];
    for (const [ms, p] of days) {
      const t = Math.floor(ms / 1000);
      if (t >= now - 10 * 365.25 * 86400) weeks.set(weekStart(t), [t, p]);
      if (t >= now - 2 * 365.25 * 86400) {
        dTs.push(t);
        dCl.push(p);
      }
    }
    const wk = [...weeks.entries()].sort((a, b) => a[0] - b[0]);
    return { isin: j?.info?.isin || null, wTs: wk.map(([w]) => w), wLast: wk.at(-1)?.[1][0] ?? null, wCl: wk.map(([, [, p]]) => p), dTs, dCl };
  }, () => true, 10 * 24 * HOUR); // LS non raggiungibile: vale lo storico salvato (fino a 10 giorni), il prezzo attuale arriva dalla quotazione
}

/** Serie settimanale in EUR (ultima chiusura di ogni settimana, ultimi 10 anni), stesso formato di historyEur. */
export async function lsHistoryEur(symbol) {
  const d = await lsHist(symbol);
  // ultima settimana: data reale dell'ultimo prezzo (come Yahoo), per il controllo dei dati fermi
  const timestamps = d.wTs.map((t, k) => (k === d.wTs.length - 1 && d.wLast ? d.wLast : t));
  return { symbol, currency: 'EUR', exchange: 'LSX', name: null, timestamps, closesEur: d.wCl.map((x) => +x.toPrecision(8)) };
}

/** Chiusure giornaliere degli ultimi 2 anni in EUR (per i rendimenti recenti). */
export async function lsRecentEur(symbol) {
  const d = await lsHist(symbol);
  return { timestamps: d.dTs, closesEur: d.dCl.map((x) => +x.toPrecision(8)) };
}

// Quotazioni a due velocità: gli strumenti «caldi» (grandi, a leva, in forte movimento) si aggiornano a ogni giro (4 minuti), gli
// altri a rotazione entro ~25 minuti. Così un giro completo dei dati live dura pochi minuti anche con oltre 12.000 strumenti.
let hotQuotes = null;
export function setHotQuotes(set) {
  hotQuotes = set instanceof Set && set.size ? set : null;
}
export const quoteTtl = (symbol) => (!hotQuotes || hotQuotes.has(symbol) ? 4 : 25) * 60e3;

/** Quotazione attuale su LS Exchange (cache 20 minuti): stesso formato di quote(). */
export async function lsQuote(symbol) {
  const id = idOf(symbol);
  return cached(`ls_quote_${id}`, quoteTtl(symbol), async () => {
    const j = await getJson(chartUrl(id, 'intraday', 'chart2'));
    const pts = (j?.series?.intraday?.data || []).filter(([ms, p]) => Number.isFinite(ms) && p > 0);
    const prev = (j?.info?.plotlines || []).find((p) => p.id === 'previousDay')?.value;
    let price = pts.at(-1)?.[1];
    let marketTime = pts.length ? Math.floor(pts.at(-1)[0] / 1000) : null;
    let previousClose = prev > 0 ? prev : null;
    if (!(price > 0)) {
      const d = await lsHist(symbol); // nessuno scambio oggi: ultima chiusura
      price = d.dCl.at(-1);
      previousClose = d.dCl.at(-2) ?? null;
      marketTime = d.dTs.at(-1);
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
