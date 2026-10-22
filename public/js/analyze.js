// Analisi completa di uno strumento: parametri prospettici + simulazione Monte Carlo.
import { simulate, DEFAULT_OPTIONS } from './montecarlo.js';
import { forwardParams } from './outlook.js';

export const BENCHMARK_SYMBOL = 'EUNL.DE'; // iShares Core MSCI World (EUR) per il calcolo del beta

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
