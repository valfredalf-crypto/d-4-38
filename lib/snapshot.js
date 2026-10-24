// Calcolo completo di quotazioni + previsioni per tutti gli strumenti (parametri predefiniti).
// Usato dalla pubblicazione del sito (build-static) e dagli aggiornamenti live (live-loop).
import { listInstruments } from './store.js';
import { historyEur, quotesMany, outlook, recentEur, performanceFrom } from './market.js';
import { marketFundamentals } from '../public/js/outlook.js';
import { analyze, applyLivePrice, BENCHMARK_SYMBOL, CRYPTO_BENCHMARK_SYMBOL, DEFAULT_SETTINGS, tableResult, tableQuote } from '../public/js/analyze.js';

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
          const [history, fundamentals] = await Promise.all([
            historyEur(inst.symbol),
            inst.type !== 'crypto' ? outlook(inst.outlookSymbol || inst.symbol).catch(() => null) : null,
          ]);
          onData?.(inst, history, fundamentals);
          const q = quotes[inst.symbol];
          if (q) {
            const recent = await recentEur(inst.symbol).catch(() => null);
            q.perf = performanceFrom(recent, q.priceEur);
          }
          data.set(inst.symbol, { history, fundamentals });
        } catch (e) {
          results[inst.symbol] = { error: e.message };
          console.warn(`! ${inst.symbol}: ${e.message}`);
        }
      }
    }),
  );
  // 2) prospettive di crescita del mercato azionario (dalle azioni con stime, pesate per capitalizzazione)
  const mkt = marketFundamentals(instruments.filter((x) => x.type === 'stock').map((x) => data.get(x.symbol)?.fundamentals), DEFAULT_SETTINGS.outlook);
  // 3) previsioni
  for (const inst of instruments) {
    const d = data.get(inst.symbol);
    if (!d) continue;
    try {
      const q = quotes[inst.symbol];
      const r = analyze({ instrument: inst, history: applyLivePrice(d.history, q?.priceEur), benchmark, cryptoBenchmark, fundamentals: d.fundamentals, market: mkt?.expected, marketGrowth: mkt?.growth }, DEFAULT_SETTINGS);
      results[inst.symbol] = tableResult(r.sim.ok ? r : { error: r.sim.reason });
      ok++;
    } catch (e) {
      results[inst.symbol] = { error: e.message };
    }
  }
  const slimQuotes = Object.fromEntries(Object.entries(quotes).map(([k, q]) => [k, tableQuote(q)]));
  return { instruments, quotes: slimQuotes, results, ok, market: mkt, key: JSON.stringify(DEFAULT_SETTINGS), generatedAt: new Date().toISOString() };
}
