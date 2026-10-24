// Analisi completa di uno strumento: parametri prospettici + simulazione Monte Carlo.
import { simulate, DEFAULT_OPTIONS, historicalMaxDrawdown, WEEKS_PER_YEAR } from './montecarlo.js';
import { cleanDividend, forwardParams, DEFAULT_OUTLOOK } from './outlook.js';
import { backfillWithProxy } from './backfill.js';

export const BENCHMARK_SYMBOL = 'EUNL.DE'; // iShares Core MSCI World (EUR) per il calcolo del beta
export const CRYPTO_BENCHMARK_SYMBOL = 'BTC-EUR'; // riferimento per ricostruire lo storico delle crypto giovani

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
    forward: {
      expected: r4(r.forward?.expected),
      growth: r4(r.forward?.expectedGrowth),
      growthSource: r.forward?.growthSource ?? null,
      ...(r.forward?.fundamentalsDetail?.source === 'holdings' ? { coverage: r4(r.forward.fundamentalsDetail.coverage) } : {}),
      ...(r.forward?.fundamentalsDetail?.evidence != null ? { evidence: r4(r.forward.fundamentalsDetail.evidence) } : {}),
    },
    sim: {
      maxLoss: r4(s.maxLoss),
      mddMedian: r4(s.mddMedian),
      netGain: r4(s.netGain),
      netP25: r4(s.netP25),
      netMedian: r4(s.netMedian),
      netMean: r4(s.netMean),
      ratio: r4(s.ratio),
      finalLoss: r4(s.finalLoss),
      expGain: r4(s.expGain),
      expLoss: r4(s.expLoss),
      balanced: r4(s.balanced),
      ratioFinal: r4(s.ratioFinal),
      probLoss: r4(s.probLoss),
      ce1: r4(s.ce1),
      ce3: r4(s.ce3),
      ce: s.ce ? Object.fromEntries(Object.entries(s.ce).map(([k, v]) => [k, r4(v)])) : null,
      ...(s.distYield > 0 ? { distYield: r4(s.distYield), distDrag: r4(s.distDrag) } : {}),
      probAtLeast: s.probAtLeast ? s.probAtLeast.map(r4) : null,
    },
  };
}

export function tableQuote(q) {
  if (!q) return null;
  return { priceEur: r4(q.priceEur), changePct: r4(q.changePct), price: q.price, currency: q.currency, ...(q.perf ? { perf: q.perf } : {}) };
}

/** Fattore di leva dedotto dal nome ("2x", "3X", "Leveraged" → 2 se non indicato); 1 per i prodotti normali. */
export function leverageOf(name = '') {
  const m = /(\d)\s*[xX]\b|\b[xX]\s*(\d)\b/.exec(name);
  if (m) return Number(m[1] || m[2]) || 1;
  return /leverag|lev\.|a leva/i.test(name) ? 2 : 1;
}

/**
 * Strumento che paga i dividendi all'investitore: azioni, ed ETF a distribuzione. Per gli ETF il dato
 * decisivo è il rendimento da dividendo riportato da Yahoo (gli ETF ad accumulazione non ne hanno);
 * in mancanza si guarda il nome.
 */
export function distributesDividends(inst, fundamentals = null) {
  if (inst.type === 'stock') return true;
  if (inst.type !== 'etf') return false;
  if (fundamentals && Number.isFinite(fundamentals.dividendYield)) return fundamentals.dividendYield > 0.002;
  return /\b(dist|dis|distr|distributing|inc|income|1d|2d|3d|4d)\b|\(d\)|\bd\b\s*$|-d\b|\bdis\)|\bdist\)/i.test(inst.name || '');
}

export function analyze({ instrument, history, benchmark, cryptoBenchmark, fundamentals, holdings, market, marketGrowth }, settings) {
  const o = { ...DEFAULT_OPTIONS, ...settings.mc };
  if (instrument.type === 'crypto') o.spreadPct = settings.mc.cryptoSpreadPct ?? o.spreadPct;
  const prices = history.closesEur;
  const realYears = (prices.length - 1) / WEEKS_PER_YEAR;
  if (realYears < o.minYears) {
    return { forward: null, sim: { ok: false, reason: `Storico insufficiente (${realYears.toFixed(1)} anni, minimo ${o.minYears})`, historyYears: realYears } };
  }
  // Controllo qualità: per azioni ed ETF un movimento ×3 o ÷3 in una settimana indica dati errati
  // (tipico di quotazioni secondarie poco scambiate): meglio "n.d." che previsioni inventate.
  if (instrument.type !== 'crypto') {
    const lb = prices.slice(-(Math.round(o.lookbackYears * WEEKS_PER_YEAR) + 1));
    for (let i = 1; i < lb.length; i++) {
      if (lb[i - 1] > 0 && lb[i] > 0 && Math.abs(Math.log(lb[i] / lb[i - 1])) > Math.log(3)) {
        return { forward: null, sim: { ok: false, reason: 'Dati di prezzo non affidabili (salti anomali nello storico)', historyYears: realYears } };
      }
    }
  }
  // Prezzo fermo (delistato, sospeso o quasi mai scambiato): volatilità e perdite risulterebbero
  // falsamente basse. Oltre il 30% di settimane senza variazioni negli ultimi 2 anni → n.d.
  if (instrument.type !== 'crypto') {
    const recent = prices.slice(-105);
    let flat = 0;
    for (let i = 1; i < recent.length; i++) if (recent[i] === recent[i - 1]) flat++;
    if (recent.length > 20 && flat / (recent.length - 1) > 0.3) {
      return { forward: null, sim: { ok: false, reason: 'Prezzo fermo o poco scambiato: previsioni non affidabili', historyYears: realYears } };
    }
  }
  const bench = instrument.symbol === BENCHMARK_SYMBOL ? null : benchmark;
  // Storico breve: rischio stimato su uno storico ricostruito con un riferimento
  // (MSCI World per azioni ed ETF, Bitcoin per le crypto).
  const proxy = instrument.type === 'crypto' ? (instrument.symbol === CRYPTO_BENCHMARK_SYMBOL ? null : cryptoBenchmark) : bench;
  const filled = proxy ? backfillWithProxy(history, proxy, { lookbackYears: o.lookbackYears, seedKey: instrument.symbol }) : null;
  const fwd = forwardParams(
    {
      type: instrument.type,
      leverage: leverageOf(instrument.name),
      timestamps: history.timestamps,
      prices,
      riskPrices: filled?.closesEur,
      market: Number.isFinite(market) ? market : null,
      marketGrowth: Number.isFinite(marketGrowth) ? marketGrowth : null,
      benchmark: bench,
      fundamentals,
      holdings: holdings || null,
      years: o.years,
      lookbackYears: o.lookbackYears,
    },
    settings.outlook,
  );
  // Dividendi distribuiti (ETF a distribuzione, azioni): in Italia tassati al 26% all'incasso, non a fine
  // periodo. Rispetto a un accumulo l'unica differenza, reinvestendo il netto, è l'anticipo dell'imposta:
  // il capitale che compone è minore. Costo del differimento ≈ tassa × dividendo × rendimento × (anni−1)/2
  // all'anno, sottratto alla deriva della simulazione (la tassa finale resta sul guadagno complessivo).
  const distYield = distributesDividends(instrument, fundamentals) ? cleanDividend(fundamentals?.dividendYield) : 0;
  const distDrag = distYield > 0 && fwd ? (o.taxRate / 100) * distYield * Math.max(fwd.expected, 0) * ((o.years - 1) / 2) : 0;
  const sim = simulate(filled ? filled.closesEur : prices, { ...o, targetDrift: fwd ? fwd.drift - distDrag : null, targetVol: fwd?.vol ?? null });
  if (sim.ok) {
    sim.distYield = distYield;
    sim.distDrag = distDrag;
    // Indicatori "storici" mostrati: solo sui dati reali
    const lookback = Math.round(o.lookbackYears * WEEKS_PER_YEAR) + 1;
    sim.historicalMdd = historicalMaxDrawdown(prices.slice(-lookback));
    sim.historyYears = Math.min(realYears, o.lookbackYears);
    sim.backfilledYears = filled ? filled.backfilledWeeks / WEEKS_PER_YEAR : 0;
    sim.backfillProxy = filled ? (instrument.type === 'crypto' ? 'Bitcoin' : 'MSCI World') : null;
  }
  return { forward: fwd, sim };
}
