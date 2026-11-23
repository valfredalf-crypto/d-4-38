// Calcolo completo di quotazioni + previsioni per tutti gli strumenti (parametri predefiniti).
// Usato dalla pubblicazione del sito (build-static) e dagli aggiornamenti live (live-loop).
import { listInstruments } from './store.js';
import { isLsSymbol, lsSearch, lsSymbol, lsQuote } from './ls.js';
import { historyEur, quotesMany, outlook, holdings, recentEur, performanceFrom, fundInfo } from './market.js';
import { purityOk } from '../public/js/funnel.js';
import { marketFundamentals } from '../public/js/outlook.js';
import { analyze, radarEstimate, priorEstimate, momentumStats, applyLivePrice, isFundHolding, BENCHMARK_SYMBOL, CRYPTO_BENCHMARK_SYMBOL, DEFAULT_SETTINGS, tableResult, tableQuote } from '../public/js/analyze.js';

const MAX_HOLDING_LOOKUPS = 600;
// Solo i campi delle stime che servono al calcolo (il file pubblicato resta piccolo).
const ESTIMATE_FIELDS = ['forwardPE', 'analysts', 'growthLongTerm', 'epsGrowthNext', 'revenueGrowthNext', 'dividendYield', 'targetMean', 'price']; // targetMean/price: prezzo obiettivo dei titoli dell'ETF
function lookThrough(comp, bySymbol) {
  return {
    ...comp,
    holdings: comp.holdings.map((h) => {
      const f = bySymbol.get(h.symbol);
      return { symbol: h.symbol, name: h.name ?? null, weight: h.weight, fundamentals: f ? Object.fromEntries(ESTIMATE_FIELDS.map((k) => [k, f[k] ?? null])) : null };
    }),
  };
}

/**
 * Fondo di fondi (es. Vanguard LifeStrategy: le partecipazioni sono altri ETF): si scende di un livello,
 * sostituendo ogni ETF partecipato con i suoi titoli (peso = peso del fondo × peso del titolo nel fondo),
 * sommando i titoli ripetuti. Così la stima di crescita nasce dalle società realmente possedute.
 * `fetchHoldings(symbol)` restituisce la composizione di un ETF (o null). Restituisce null se non è un
 * fondo di fondi o se nessuna composizione dei fondi partecipati è disponibile.
 */
export async function expandFundOfFunds(comp, fetchHoldings) {
  const hs = comp?.holdings || [];
  const funds = hs.filter((h) => isFundHolding(h));
  if (!funds.length || funds.length * 2 < hs.length) return null;
  const merged = new Map();
  const add = (h, w) => {
    if (!(w > 0) || !h?.symbol) return;
    const cur = merged.get(h.symbol);
    if (cur) cur.weight += w;
    else merged.set(h.symbol, { symbol: h.symbol, name: h.name ?? null, weight: w });
  };
  let expanded = 0;
  for (const h of hs) {
    if (!isFundHolding(h)) {
      add(h, h.weight);
      continue;
    }
    const sub = await fetchHoldings(h.symbol).catch(() => null);
    if (!sub?.holdings?.length) continue;
    expanded++;
    for (const x of sub.holdings) if (!isFundHolding(x)) add(x, h.weight * x.weight);
  }
  if (!expanded) return null;
  return { ...comp, holdings: [...merged.values()].sort((a, b) => b.weight - a.weight), fundOfFunds: true, fundsExpanded: expanded, fundsTotal: funds.length };
}

// Le serie di LS Exchange sono prezzi semplici: per gli strumenti che distribuiscono dividendi si aggiunge il
// rendimento da dividendo (come le chiusure aggiustate di Yahoo), così storico e previsioni restano coerenti.
export function lsTotalReturn(inst, history, fundamentals) {
  const y = fundamentals?.dividendYield;
  if (!history || !isLsSymbol(inst.symbol) || !(y > 0 && y < 0.15) || !history.timestamps?.length) return history;
  const tEnd = history.timestamps.at(-1);
  const g = Math.log(1 + y) / (365.25 * 86400);
  return { ...history, closesEur: history.closesEur.map((c, k) => +(c * Math.exp(-g * (tEnd - history.timestamps[k]))).toPrecision(8)) };
}

const STALE_DAYS = 14;
export async function computeSnapshot({ onData } = {}) {
  let staleCount = 0;
  const instruments = listInstruments();
  const quotes = await quotesMany(instruments.filter((i) => i.source !== 'radar').map((i) => i.symbol));
  const benchmark = await historyEur(BENCHMARK_SYMBOL).catch(() => null);
  const cryptoBenchmark = await historyEur(CRYPTO_BENCHMARK_SYMBOL).catch(() => null);
  const results = {};
  let ok = 0;
  // 1) dati: storici ed evidenze (in parallelo, dalla cache quando possibile)
  const data = new Map();
  let i = 0;
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      while (i < instruments.length) {
        const inst = instruments[i++];
        if (inst.source === 'radar') continue; // nessun dato di mercato: vedi punto 3
        try {
          let [history, fundamentals, comp] = await Promise.all([
            historyEur(inst.symbol),
            inst.type !== 'crypto' && !(isLsSymbol(inst.symbol) && !inst.outlookSymbol) ? outlook(inst.outlookSymbol || inst.symbol).catch(() => null) : null,
            inst.type === 'etf' && !(isLsSymbol(inst.symbol) && !inst.outlookSymbol) ? holdings(inst.outlookSymbol || inst.symbol).catch(() => null) : null,
          ]);
          // Quotazione ferma (nessuno scambio da oltre 14 giorni): prezzi e storico da LS Exchange (la borsa di Trade Republic); se
          // nemmeno lì c'è un prezzo recente, lo strumento non ha dati attendibili e non entra nelle previsioni (niente «crolli» da dati vecchi)
          if (inst.type !== 'crypto' && Date.now() / 1000 - (history.timestamps?.at(-1) || 0) > STALE_DAYS * 86400) {
            let fixed = false;
            if (inst.isin && !isLsSymbol(inst.symbol)) {
              const ls = await lsSearch(inst.isin).catch(() => null);
              const lh = ls?.id ? await historyEur(lsSymbol(ls.id)).catch(() => null) : null;
              if (lh && Date.now() / 1000 - (lh.timestamps.at(-1) || 0) <= STALE_DAYS * 86400) {
                history = lh;
                const lq = await lsQuote(lsSymbol(ls.id)).catch(() => null);
                if (lq) quotes[inst.symbol] = lq;
                fixed = true;
              }
            }
            if (!fixed) {
              const last = new Date((history.timestamps?.at(-1) || 0) * 1000).toLocaleDateString('it-IT');
              results[inst.symbol] = { error: `Quotazione ferma dal ${last}: nessun prezzo recente` };
              staleCount++;
              continue;
            }
          }
          const histTr = lsTotalReturn(inst, history, fundamentals);
          const q = quotes[inst.symbol];
          if (q) {
            const recent = await recentEur(inst.symbol).catch(() => null);
            q.perf = performanceFrom(recent, q.priceEur);
          }
          data.set(inst.symbol, { history: histTr, fundamentals, comp: comp?.holdings?.length ? comp : null });
        } catch (e) {
          results[inst.symbol] = { error: e.message };
          console.warn(`! ${inst.symbol}: ${e.message}`);
        }
      }
    }),
  );
  if (staleCount) console.log(`Strumenti senza prezzo recente (fermi da oltre ${STALE_DAYS} giorni): ${staleCount}`);
  // 1a) fondi di fondi: le partecipazioni sono altri ETF → si scende ai titoli sottostanti
  for (const d of data.values()) {
    if (!d.comp) continue;
    const ex = await expandFundOfFunds(d.comp, (sym) => holdings(sym));
    if (ex) d.comp = ex;
  }
  // 1b) stime degli analisti per le partecipazioni degli ETF (look-through): si riusano quelle già
  // scaricate per gli strumenti dell'elenco, le altre si scaricano (prima le più pesanti nei fondi)
  const bySymbol = new Map();
  for (const inst of instruments) {
    const f = data.get(inst.symbol)?.fundamentals;
    if (f && !f.error) bySymbol.set(inst.outlookSymbol || inst.symbol, f);
  }
  const weightOf = new Map();
  for (const d of data.values()) for (const h of d.comp?.holdings || []) if (!bySymbol.has(h.symbol)) weightOf.set(h.symbol, (weightOf.get(h.symbol) || 0) + h.weight);
  const missing = [...weightOf.keys()].sort((a, b) => weightOf.get(b) - weightOf.get(a)).slice(0, MAX_HOLDING_LOOKUPS);
  let j = 0;
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (j < missing.length) {
        const sym = missing[j++];
        const f = await outlook(sym).catch(() => null);
        if (f && !f.error) bySymbol.set(sym, f);
      }
    }),
  );
  for (const inst of instruments) {
    const d = data.get(inst.symbol);
    if (!d) continue;
    if (d.comp) d.fundamentals = { ...(d.fundamentals || {}), lookThrough: lookThrough(d.comp, bySymbol) };
    onData?.(inst, d.history, d.fundamentals);
  }
  // 2) prospettive di crescita del mercato azionario (dalle azioni con stime, pesate per capitalizzazione)
  const mkt = marketFundamentals(instruments.filter((x) => x.type === 'stock').map((x) => data.get(x.symbol)?.fundamentals), DEFAULT_SETTINGS.outlook);
  // 3) previsioni
  for (const inst of instruments) {
    if (inst.source === 'radar') {
      const estimate = radarEstimate({ instrument: inst, vol: inst.radarVol, market: mkt?.expected, settings: DEFAULT_SETTINGS, mom: inst.radarMom });
      results[inst.symbol] = tableResult({ error: 'Nessun dato di mercato disponibile (strumento dal dataset radar)', estimate });
      continue;
    }
    const d = data.get(inst.symbol);
    if (!d) continue;
    try {
      const q = quotes[inst.symbol];
      const hist = applyLivePrice(d.history, q?.priceEur);
      const mom = momentumStats(hist.closesEur);
      const r = analyze({ instrument: inst, history: hist, benchmark, cryptoBenchmark, fundamentals: d.fundamentals, holdings: d.fundamentals?.lookThrough, market: mkt?.expected, marketGrowth: mkt?.growth }, DEFAULT_SETTINGS);
      results[inst.symbol] = tableResult(r.sim.ok ? { ...r, mom } : { error: r.sim.reason, estimate: r.estimate, mom });
      ok++;
    } catch (e) {
      results[inst.symbol] = { error: e.message };
    }
  }
  // 3b) ogni strumento deve essere utilizzabile nel portafoglio (anche per gli orizzonti brevi, 7-90 giorni): senza
  // previsione né stima dallo storico si usa la volatilità del dataset radar o, in ultima istanza, quella tipica della categoria
  for (const inst of instruments) {
    const r = results[inst.symbol];
    if (r && !r.error) continue;
    if (r?.estimate) continue;
    const opts = { instrument: inst, market: mkt?.expected, settings: DEFAULT_SETTINGS };
    const estimate = (Number.isFinite(inst.radarVol) ? radarEstimate({ ...opts, vol: inst.radarVol, mom: inst.radarMom }) : null) ?? priorEstimate(opts);
    if (estimate && inst.radarMom && !estimate.mom) estimate.mom = inst.radarMom;
    results[inst.symbol] = { ...(r || { error: 'Nessun dato di mercato disponibile' }), estimate };
  }
  // 4) dati del fondo per l'«imbuto» (TER da Yahoo; patrimonio e TER da justETF per gli indici globali puri)
  // tutti gli ETF (fase 1 dell'algoritmo Max Growth: patrimonio ≥ 500 mln); prima gli indici globali puri
  const pure = instruments.filter((x) => x.type === 'etf' && x.isin && results[x.symbol] && !results[x.symbol].error).sort((a, b) => Number(purityOk(b.name)) - Number(purityOk(a.name)));
  let k = 0;
  await Promise.all(
    Array.from({ length: 3 }, async () => {
      while (k < pure.length) {
        const inst = pure[k++];
        const fi = await fundInfo(inst.isin).catch(() => null);
        if (fi && !fi.error) results[inst.symbol].fund = { ...(results[inst.symbol].fund || {}), ...(fi.aum ? { aum: fi.aum } : {}), ...(Number.isFinite(fi.ter) ? { ter: fi.ter } : {}) };
      }
    }),
  );
  for (const inst of instruments) {
    const comp = data.get(inst.symbol)?.comp;
    const r = results[inst.symbol];
    if (!r || r.error || inst.type !== 'etf' || !Number.isFinite(comp?.ter)) continue;
    // TER di Yahoo quando justETF non lo fornisce
    if (!Number.isFinite(r.fund?.ter) && comp.ter >= 0.0003 && comp.ter < 0.03) r.fund = { ...(r.fund || {}), ter: comp.ter };
  }
  const slimQuotes = Object.fromEntries(Object.entries(quotes).map(([k, q]) => [k, tableQuote(q)]));
  return { instruments, quotes: slimQuotes, results, ok, market: mkt, key: JSON.stringify(DEFAULT_SETTINGS), generatedAt: new Date().toISOString() };
}
