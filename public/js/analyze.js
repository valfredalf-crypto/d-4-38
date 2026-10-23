// Analisi completa di uno strumento: parametri prospettici + simulazione Monte Carlo.
import { simulate, DEFAULT_OPTIONS } from './montecarlo.js';
import { forwardParams, DEFAULT_OUTLOOK } from './outlook.js';

export const BENCHMARK_SYMBOL = 'EUNL.DE'; // iShares Core MSCI World (EUR) per il calcolo del beta

const { targetDrift, targetVol, seed, ...MC_DEFAULTS } = DEFAULT_OPTIONS;
export const DEFAULT_SETTINGS = { mc: { ...MC_DEFAULTS, cryptoSpreadPct: 0 }, outlook: { ...DEFAULT_OUTLOOK } };

// Nome file sicuro per i dati statici di uno strumento (versione GitHub Pages).
export function fileKey(symbol) {
  return String(symbol).replace(/[^A-Za-z0-9._-]/g, '_');
}

/**
 * Inserisce la quotazione corrente come ultima chiusura settimanale (la settimana in corso),
 * così le previsioni seguono il prezzo aggiornato. Variazioni assurde (>50%) vengono ignorate.
 */
export function applyLivePrice(history, priceEur) {
  const n = history?.closesEur?.length;
  if (!n || !(priceEur > 0)) return history;
  const last = history.closesEur[n - 1];
  if (Math.abs(priceEur / last - 1) > 0.5) return history;
  const closesEur = history.closesEur.slice();
  closesEur[n - 1] = priceEur;
  return { ...history, closesEur };
}

// Risultato senza i dati dei grafici, per salvarlo/pubblicarlo in forma compatta.
export function compactResult(r) {
  if (r.error) return { error: r.error };
  return { forward: r.forward, sim: { ...r.sim, fan: undefined, histogram: undefined } };
}

// Solo i numeri della tabella (per pubblicare migliaia di strumenti ogni pochi minuti):
// il dettaglio di uno strumento viene comunque ricalcolato nel browser quando lo si apre.
const r4 = (x) => (Number.isFinite(x) ? Math.round(x * 1e4) / 1e4 : x === Infinity ? null : x ?? null);
export function tableResult(r) {
  if (r.error) return { error: r.error };
  const s = r.sim;
  return {
    forward: { expected: r4(r.forward?.expected) },
    sim: { maxLoss: r4(s.maxLoss), netGain: r4(s.netGain), netMedian: r4(s.netMedian), netMean: r4(s.netMean), ratio: r4(s.ratio), probLoss: r4(s.probLoss) },
  };
}

export function tableQuote(q) {
  if (!q) return null;
  return { priceEur: r4(q.priceEur), changePct: r4(q.changePct), price: q.price, currency: q.currency, ...(q.perf ? { perf: q.perf } : {}) };
}

export function analyze({ instrument, history, benchmark, fundamentals }, settings) {
  const o = { ...DEFAULT_OPTIONS, ...settings.mc };
  if (instrument.type === 'crypto') o.spreadPct = settings.mc.cryptoSpreadPct ?? o.spreadPct;
  const prices = history.closesEur;
  const fwd = forwardParams(
    {
      type: instrument.type,
      timestamps: history.timestamps,
      prices,
      benchmark: instrument.symbol === BENCHMARK_SYMBOL ? null : benchmark,
      fundamentals,
      years: o.years,
      lookbackYears: o.lookbackYears,
    },
    settings.outlook,
  );
  const sim = simulate(prices, { ...o, targetDrift: fwd?.drift ?? null, targetVol: fwd?.vol ?? null });
  return { forward: fwd, sim };
}
