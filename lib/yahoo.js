// Client minimale per i dati pubblici di Yahoo Finance (storico, quotazioni, ricerca).
// Nessuna API key: gestisce in automatico cookie + crumb quando Yahoo li richiede.
import { mockChart, mockSearch, mockFundamentals, mockQuoteBatch } from './mock.js';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const HOSTS = ['https://query1.finance.yahoo.com', 'https://query2.finance.yahoo.com'];
const MOCK = process.env.MOCK === '1';

let session = null; // { cookie, crumb }

// Limita le richieste parallele verso Yahoo per evitare blocchi (HTTP 429).
const MAX_CONCURRENT = Number(process.env.YAHOO_CONCURRENCY || 4);
let active = 0;
const queue = [];
async function limited(fn) {
  if (active >= MAX_CONCURRENT) await new Promise((r) => queue.push(r));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    queue.shift()?.();
  }
}

async function getSession() {
  if (session) return session;
  const res = await fetch('https://fc.yahoo.com', { headers: { 'User-Agent': UA }, redirect: 'manual' });
  const cookie = (res.headers.getSetCookie?.() || [res.headers.get('set-cookie')])
    .filter(Boolean)
    .map((c) => c.split(';')[0])
    .join('; ');
  const cr = await fetch(`${HOSTS[0]}/v1/test/getcrumb`, { headers: { 'User-Agent': UA, Cookie: cookie } });
  const crumb = (await cr.text()).trim();
  session = { cookie, crumb };
  return session;
}

async function yget(path, { crumb = false } = {}) {
  return limited(async () => {
    let lastErr;
    if (crumb) await getSession().catch(() => {});
    for (let attempt = 0; attempt < 3; attempt++) {
      const host = HOSTS[attempt % HOSTS.length];
      const headers = { 'User-Agent': UA, Accept: 'application/json' };
      let url = host + path;
      if ((crumb || attempt > 0) && session) {
        headers.Cookie = session.cookie;
        url += (url.includes('?') ? '&' : '?') + 'crumb=' + encodeURIComponent(session.crumb);
      }
      try {
        const res = await fetch(url, { headers, signal: AbortSignal.timeout(20000) });
        if (res.ok) return await res.json();
        if (res.status === 404) {
          const body = await res.json().catch(() => null);
          const desc = body?.chart?.error?.description || 'simbolo non trovato';
          throw Object.assign(new Error(desc), { status: 404 });
        }
        if (res.status === 401 || res.status === 403) {
          session = null;
          await getSession().catch(() => {});
        }
        if (res.status === 429) await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
        lastErr = new Error(`Yahoo HTTP ${res.status}`);
      } catch (e) {
        if (e.status === 404) throw e;
        lastErr = e;
      }
    }
    throw lastErr;
  });
}

/** Serie storica: restituisce { symbol, currency, timestamps[], closes[] } (chiusure aggiustate per dividendi). */
export async function chart(symbol, { range = '10y', interval = '1wk' } = {}) {
  if (MOCK) return mockChart(symbol, { range, interval });
  const json = await yget(
    `/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&includeAdjustedClose=true&events=div,split`,
  );
  const result = json?.chart?.result?.[0];
  if (!result) throw new Error(json?.chart?.error?.description || 'Nessun dato');
  const meta = result.meta || {};
  const ts = result.timestamp || [];
  const adj = result.indicators?.adjclose?.[0]?.adjclose;
  const close = result.indicators?.quote?.[0]?.close || [];
  const series = adj && adj.some((x) => x != null) ? adj : close;
  const timestamps = [];
  const closes = [];
  for (let i = 0; i < ts.length; i++) {
    const v = series[i];
    if (v != null && Number.isFinite(v) && v > 0) {
      timestamps.push(ts[i]);
      closes.push(v);
    }
  }
  return {
    symbol: meta.symbol || symbol,
    currency: meta.currency || null,
    exchange: meta.fullExchangeName || meta.exchangeName || null,
    name: meta.longName || meta.shortName || null,
    price: meta.regularMarketPrice ?? null,
    previousClose: meta.chartPreviousClose ?? meta.previousClose ?? null,
    marketTime: meta.regularMarketTime ?? null,
    timestamps,
    closes,
  };
}

const TYPE_MAP = { EQUITY: 'stock', ETF: 'etf', CRYPTOCURRENCY: 'crypto', MUTUALFUND: 'etf' };

/** Ricerca per nome, ticker o ISIN. */
export async function search(q) {
  if (MOCK) return mockSearch(q);
  const json = await yget(`/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=15&newsCount=0&listsCount=0`);
  return (json.quotes || [])
    .filter((x) => TYPE_MAP[x.quoteType])
    .map((x) => ({
      symbol: x.symbol,
      name: x.longname || x.shortname || x.symbol,
      type: TYPE_MAP[x.quoteType],
      exchange: x.exchDisp || x.exchange,
    }));
}

// Preferenza di borsa quando un ISIN è quotato su più mercati: prima le quotazioni in EUR
// (Xetra è la più vicina ai prezzi di Trade Republic / LS Exchange).
const SUFFIX_PREFERENCE = ['.DE', '.F', '.MI', '.PA', '.AS', '.MC', '.BR', '.VI', '.LS', '.HE', '.IR'];
export function pickListing(results) {
  if (!results.length) return null;
  for (const suf of SUFFIX_PREFERENCE) {
    const hit = results.find((r) => r.symbol.endsWith(suf));
    if (hit) return hit;
  }
  return results[0];
}

const raw = (v) => (v && typeof v === 'object' ? v.raw ?? null : v ?? null);

/**
 * Evidenze di mercato recenti per le stime prospettiche:
 * consenso analisti (prezzo obiettivo a 12 mesi), beta, dividend yield, volatilità implicita delle opzioni.
 * Ogni campo può essere null: ETF europei e crypto in genere non hanno copertura analisti né opzioni.
 */
export async function fundamentals(symbol) {
  if (MOCK) return mockFundamentals(symbol);
  const out = {
    symbol,
    currency: null,
    price: null,
    targetMean: null,
    targetLow: null,
    targetHigh: null,
    analysts: null,
    recommendation: null,
    recommendationMean: null,
    beta: null,
    dividendYield: null,
    forwardPE: null,
    impliedVol: null,
    impliedVolDays: null,
  };
  try {
    const json = await yget(
      `/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=financialData,summaryDetail,defaultKeyStatistics,price`,
      { crumb: true },
    );
    const r = json?.quoteSummary?.result?.[0] || {};
    const fd = r.financialData || {};
    const sd = r.summaryDetail || {};
    const ks = r.defaultKeyStatistics || {};
    out.currency = r.price?.currency || null;
    out.price = raw(fd.currentPrice) ?? raw(r.price?.regularMarketPrice);
    out.targetMean = raw(fd.targetMeanPrice);
    out.targetLow = raw(fd.targetLowPrice);
    out.targetHigh = raw(fd.targetHighPrice);
    out.analysts = raw(fd.numberOfAnalystOpinions);
    out.recommendation = fd.recommendationKey || null;
    out.recommendationMean = raw(fd.recommendationMean);
    out.beta = raw(sd.beta) ?? raw(ks.beta3Year) ?? raw(ks.beta);
    out.dividendYield = raw(sd.dividendYield) ?? raw(sd.yield) ?? raw(sd.trailingAnnualDividendYield);
    out.forwardPE = raw(sd.forwardPE) ?? raw(ks.forwardPE);
  } catch (e) {
    out.error = e.message;
  }
  // Volatilità implicita: solo strumenti USA con opzioni quotate.
  if (!symbol.includes('.') && !symbol.includes('-')) {
    try {
      Object.assign(out, await impliedVolatility(symbol));
    } catch {
      /* nessuna catena opzioni disponibile */
    }
  }
  return out;
}

// Volatilità implicita at-the-money sulla scadenza più vicina a ~90 giorni (media call/put).
async function impliedVolatility(symbol) {
  const first = await yget(`/v7/finance/options/${encodeURIComponent(symbol)}`, { crumb: true });
  const res = first?.optionChain?.result?.[0];
  const dates = res?.expirationDates || [];
  if (!dates.length) return {};
  const now = Date.now() / 1000;
  const target = now + 90 * 86400;
  const exp = dates.reduce((best, d) => (Math.abs(d - target) < Math.abs(best - target) ? d : best), dates[0]);
  const chainJson =
    exp === dates[0] ? first : await yget(`/v7/finance/options/${encodeURIComponent(symbol)}?date=${exp}`, { crumb: true });
  const chain = chainJson?.optionChain?.result?.[0];
  const spot = chain?.quote?.regularMarketPrice;
  const opts = chain?.options?.[0];
  if (!spot || !opts) return {};
  const atm = (list) =>
    (list || [])
      .filter((o) => o.impliedVolatility > 0.01 && o.impliedVolatility < 5)
      .sort((a, b) => Math.abs(a.strike - spot) - Math.abs(b.strike - spot))
      .slice(0, 2)
      .map((o) => o.impliedVolatility);
  const ivs = [...atm(opts.calls), ...atm(opts.puts)];
  if (!ivs.length) return {};
  return {
    impliedVol: ivs.reduce((s, x) => s + x, 0) / ivs.length,
    impliedVolDays: Math.round((exp - now) / 86400),
  };
}

/**
 * Quotazioni di molti simboli in una sola richiesta (fino a ~100 per chiamata).
 * Restituisce { simbolo: { price, previousClose, currency, marketTime } } per i simboli trovati.
 */
export async function quoteBatch(symbols) {
  if (MOCK) return mockQuoteBatch(symbols);
  const json = await yget(`/v7/finance/quote?symbols=${symbols.map(encodeURIComponent).join(',')}`, { crumb: true });
  const out = {};
  for (const q of json?.quoteResponse?.result || []) {
    if (q.regularMarketPrice == null) continue;
    out[q.symbol] = {
      price: q.regularMarketPrice,
      previousClose: q.regularMarketPreviousClose ?? null,
      currency: q.currency || null,
      marketTime: q.regularMarketTime ?? null,
    };
  }
  return out;
}
