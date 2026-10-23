// Calcolo completo di quotazioni + previsioni per tutti gli strumenti (parametri predefiniti).
// Usato dalla pubblicazione del sito (build-static) e dagli aggiornamenti live (live-loop).
import { listInstruments } from './store.js';
import { historyEur, quotesMany, outlook } from './market.js';
import { analyze, applyLivePrice, BENCHMARK_SYMBOL, DEFAULT_SETTINGS, compactResult } from '../public/js/analyze.js';

export async function computeSnapshot({ onData } = {}) {
  const instruments = listInstruments();
  const quotes = await quotesMany(instruments.map((i) => i.symbol));
  const benchmark = await historyEur(BENCHMARK_SYMBOL).catch(() => null);
  const results = {};
  let ok = 0;
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
          const r = analyze({ instrument: inst, history: applyLivePrice(history, q?.priceEur), benchmark, fundamentals }, DEFAULT_SETTINGS);
          results[inst.symbol] = compactResult(r.sim.ok ? r : { error: r.sim.reason });
          ok++;
        } catch (e) {
          results[inst.symbol] = { error: e.message };
          console.warn(`! ${inst.symbol}: ${e.message}`);
        }
      }
    }),
  );
  return { instruments, quotes, results, ok, key: JSON.stringify(DEFAULT_SETTINGS), generatedAt: new Date().toISOString() };
}
