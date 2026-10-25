// Calcolo completo di quotazioni + previsioni per tutti gli strumenti (parametri predefiniti).
// Usato dalla pubblicazione del sito (build-static) e dagli aggiornamenti live (live-loop).
import { listInstruments } from './store.js';
import { historyEur, quotesMany, outlook, holdings, recentEur, performanceFrom } from './market.js';
import { marketFundamentals } from '../public/js/outlook.js';
import { analyze, applyLivePrice, isFundHolding, BENCHMARK_SYMBOL, CRYPTO_BENCHMARK_SYMBOL, DEFAULT_SETTINGS, tableResult, tableQuote } from '../public/js/analyze.js';

const MAX_HOLDING_LOOKUPS = 600;
// Solo i campi delle stime che servono al calcolo (il file pubblicato resta piccolo).
const ESTIMATE_FIELDS = ['forwardPE', 'analysts', 'growthLongTerm', 'epsGrowthNext', 'revenueGrowthNext', 'dividendYield'];
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

export async function computeSnapshot({ onData } = {}) {
  const instruments = listInstruments();
  const quotes = await quotesMany(instruments.map((i) => i.symbol));
  const benchmark = await historyEur(BENCHMARK_SYMBOL).catch(() => null);
  const cryptoBenchmark = await historyEur(CRYPTO_BENCHMARK_SYMBOL).catch(() => null);
  const results = {};
  let ok = 0;
  // 1) dati: storici ed evidenze (in parallelo, dalla cache quando possibile)
  const data = new Map();
  let i = 0;
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (i < instruments.length) {
        const inst = instruments[i++];
        try {
          const [history, fundamentals, comp] = await Promise.all([
            historyEur(inst.symbol),
            inst.type !== 'crypto' ? outlook(inst.outlookSymbol || inst.symbol).catch(() => null) : null,
            inst.type === 'etf' ? holdings(inst.symbol).catch(() => null) : null,
          ]);
          const q = quotes[inst.symbol];
          if (q) {
            const recent = await recentEur(inst.symbol).catch(() => null);
            q.perf = performanceFrom(recent, q.priceEur);
          }
          data.set(inst.symbol, { history, fundamentals, comp: comp?.holdings?.length ? comp : null });
        } catch (e) {
          results[inst.symbol] = { error: e.message };
          console.warn(`! ${inst.symbol}: ${e.message}`);
        }
      }
    }),
  );
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
    const d = data.get(inst.symbol);
    if (!d) continue;
    try {
      const q = quotes[inst.symbol];
      const r = analyze({ instrument: inst, history: applyLivePrice(d.history, q?.priceEur), benchmark, cryptoBenchmark, fundamentals: d.fundamentals, holdings: d.fundamentals?.lookThrough, market: mkt?.expected, marketGrowth: mkt?.growth }, DEFAULT_SETTINGS);
      results[inst.symbol] = tableResult(r.sim.ok ? r : { error: r.sim.reason });
      ok++;
    } catch (e) {
      results[inst.symbol] = { error: e.message };
    }
  }
  const slimQuotes = Object.fromEntries(Object.entries(quotes).map(([k, q]) => [k, tableQuote(q)]));
  return { instruments, quotes: slimQuotes, results, ok, market: mkt, key: JSON.stringify(DEFAULT_SETTINGS), generatedAt: new Date().toISOString() };
}
