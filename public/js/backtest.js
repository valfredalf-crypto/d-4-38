// Backtest del modello: ci si mette a una data passata (T0 = 5 anni fa), si prevede usando solo i
// dati disponibili fino a T0 e si confronta con quanto è successo davvero da T0 a oggi.
// Funzioni pure: usate dalla pubblicazione del sito e dal server locale; il browser mostra il risultato.
import { netReturn, historicalMaxDrawdown, logReturns, WEEKS_PER_YEAR, DEFAULT_OPTIONS } from './montecarlo.js';
import { analyze } from './analyze.js';

const r4 = (x) => (Number.isFinite(x) ? Math.round(x * 1e4) / 1e4 : x === Infinity ? 1e9 : null);

/**
 * Prevede (fino a T0) e misura (da T0 a oggi) per un singolo strumento; null se lo storico è troppo corto.
 * `preYears`: se indicato, finge che prima di T0 esistessero solo quegli anni di dati (test degli storici brevi).
 */
export function backtestOne({ instrument, history, benchmark }, settings, mode, { originWeeksAgo = null, sims = 1000, preYears = null } = {}) {
  const mc = { ...DEFAULT_OPTIONS, ...settings.mc, sims };
  const o = { ...mc };
  if (instrument.type === 'crypto') o.spreadPct = settings.mc.cryptoSpreadPct ?? o.spreadPct;
  const ts = history.timestamps;
  const prices = history.closesEur;
  const horizon = Math.round(o.years * WEEKS_PER_YEAR);
  // Data di partenza: `originWeeksAgo` settimane fa (predefinito: esattamente l'orizzonte, cioè 5 anni fa).
  const i0 = prices.length - 1 - (originWeeksAgo ?? horizon);
  if (i0 < Math.round(o.minYears * WEEKS_PER_YEAR) || i0 + horizon > prices.length - 1) return null;
  const t0 = ts[i0];
  const iStart = preYears ? Math.max(0, i0 - Math.round(preYears * WEEKS_PER_YEAR)) : 0;
  const preHistory = { timestamps: ts.slice(iStart, i0 + 1), closesEur: prices.slice(iStart, i0 + 1) };
  const post = prices.slice(i0, i0 + horizon + 1);
  // Benchmark troncato a T0: nessuna informazione successiva entra nella previsione.
  let bench = null;
  if (benchmark?.timestamps?.length) {
    const k = benchmark.timestamps.findIndex((t) => t > t0);
    const end = k === -1 ? benchmark.timestamps.length : k;
    bench = { timestamps: benchmark.timestamps.slice(0, end), closesEur: benchmark.closesEur.slice(0, end) };
  }
  // Stessa analisi dell'app (storico ricostruito con l'indice incluso), senza analisti (non disponibili storicamente).
  const { forward: fwd, sim } = analyze({ instrument, history: preHistory, benchmark: bench, fundamentals: null }, { mc: { ...mc, seed: 12345 }, outlook: { ...settings.outlook, mode } });
  if (!fwd || !sim.ok) return null;
  const gross = post.at(-1) / post[0] - 1;
  const rets = logReturns(post);
  const mean = rets.reduce((a, x) => a + x, 0) / rets.length;
  const vol = Math.sqrt(rets.reduce((a, x) => a + (x - mean) ** 2, 0) / (rets.length - 1)) * Math.sqrt(WEEKS_PER_YEAR);
  return {
    symbol: instrument.symbol,
    type: instrument.type,
    t0,
    short: !!preYears,
    pred: {
      netMedian: r4(sim.netMedian),
      netMean: r4(sim.netMean),
      netP5: r4(sim.netP5),
      netP25: r4(sim.netP25),
      netP75: r4(sim.netP75),
      netP95: r4(sim.netP95),
      mddMedian: r4(sim.mddMedian),
      mddP95: r4(sim.mddP95),
      probLoss: r4(sim.probLoss),
      ratio: r4(sim.ratio),
      vol: r4(sim.annualVol),
      expected: r4(fwd.expected),
    },
    real: { net: r4(netReturn(gross, o)), mdd: r4(historicalMaxDrawdown(post)), vol: r4(vol) },
  };
}

// --- statistiche
function ranks(values) {
  const idx = values.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const r = new Array(values.length);
  for (let i = 0; i < idx.length; ) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2;
    i = j + 1;
  }
  return r;
}

/** Correlazione di Spearman (sui ranghi): 1 = stesso ordine, 0 = nessuna relazione. */
export function spearman(xs, ys) {
  const n = xs.length;
  if (n < 3) return null;
  const rx = ranks(xs);
  const ry = ranks(ys);
  const mx = (n - 1) / 2;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    num += (rx[i] - mx) * (ry[i] - mx);
    dx += (rx[i] - mx) ** 2;
    dy += (ry[i] - mx) ** 2;
  }
  return dx && dy ? num / Math.sqrt(dx * dy) : null;
}

const share = (rows, f) => (rows.length ? rows.filter(f).length / rows.length : null);
const avg = (xs) => (xs.length ? xs.reduce((a, x) => a + x, 0) / xs.length : null);
const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Divide in 5 gruppi uguali secondo `key` crescente (gruppo 1 = valori più bassi). */
function quintiles(rows, key, better = 'low') {
  const sorted = [...rows].sort((a, b) => (better === 'low' ? key(a) - key(b) : key(b) - key(a)));
  const out = [];
  for (let q = 0; q < 5; q++) {
    const part = sorted.slice(Math.floor((q * sorted.length) / 5), Math.floor(((q + 1) * sorted.length) / 5));
    out.push({
      n: part.length,
      predicted: r4(median(part.map(key))),
      realNetMean: r4(avg(part.map((r) => r.real.net))),
      realNetMedian: r4(median(part.map((r) => r.real.net))),
      realMddMedian: r4(median(part.map((r) => r.real.mdd))),
      realLossShare: r4(share(part, (r) => r.real.net < 0)),
    });
  }
  return out;
}

export function summarize(rows) {
  if (!rows.length) return null;
  const pl = [0, 0.2, 0.4, 0.6, 0.8, 1.0001].slice(0, -1).map((lo, k, arr) => {
    const hi = k === arr.length - 1 ? 1.0001 : arr[k + 1];
    const part = rows.filter((r) => r.pred.probLoss >= lo && r.pred.probLoss < hi);
    return { from: lo, to: Math.min(1, hi), n: part.length, predicted: r4(avg(part.map((r) => r.pred.probLoss))), realized: r4(share(part, (r) => r.real.net < 0)) };
  });
  return {
    n: rows.length,
    risk: {
      mddAboveP95: r4(share(rows, (r) => r.real.mdd > r.pred.mddP95)), // atteso ≈ 5%
      mddAboveMedian: r4(share(rows, (r) => r.real.mdd > r.pred.mddMedian)), // atteso ≈ 50%
      mddRankCorr: r4(spearman(rows.map((r) => r.pred.mddMedian), rows.map((r) => r.real.mdd))),
      volRankCorr: r4(spearman(rows.map((r) => r.pred.vol), rows.map((r) => r.real.vol))),
    },
    returns: {
      inside90: r4(share(rows, (r) => r.real.net >= r.pred.netP5 && r.real.net <= r.pred.netP95)), // atteso ≈ 90%
      belowP5: r4(share(rows, (r) => r.real.net < r.pred.netP5)), // atteso ≈ 5%
      aboveP95: r4(share(rows, (r) => r.real.net > r.pred.netP95)), // atteso ≈ 5%
      aboveMedian: r4(share(rows, (r) => r.real.net > r.pred.netMedian)), // atteso ≈ 50%
      medianRankCorr: r4(spearman(rows.map((r) => r.pred.netMedian), rows.map((r) => r.real.net))),
      realNetMedian: r4(median(rows.map((r) => r.real.net))),
      predNetMedian: r4(median(rows.map((r) => r.pred.netMedian))),
    },
    byRatio: quintiles(rows, (r) => r.pred.ratio, 'low'),
    byMedian: quintiles(rows, (r) => r.pred.netMedian, 'high'),
    probLoss: pl.filter((b) => b.n > 0),
  };
}

/** Esegue il backtest su tutti gli strumenti con storico sufficiente, per il modello prospettico e per quello solo storico. */
export function runBacktest(items, settings) {
  const out = { modes: {}, rows: [] };
  for (const mode of ['forward', 'historical']) {
    const rows = [];
    for (const it of items) {
      try {
        const r = backtestOne(it, settings, mode);
        if (r) rows.push(r);
      } catch {
        /* strumento saltato */
      }
    }
    // Stessi strumenti fingendo di avere solo 3 anni di dati prima di T0 (es. ETF nati da poco)
    const short = [];
    for (const it of items) {
      try {
        const r = backtestOne(it, settings, mode, { preYears: 3 });
        if (r) short.push(r);
      } catch {
        /* strumento saltato */
      }
    }
    out.modes[mode] = {
      summary: summarize(rows),
      shortHistory: summarize(short),
      byType: Object.fromEntries(['stock', 'etf', 'crypto'].map((t) => [t, summarize(rows.filter((r) => r.type === t))])),
    };
    if (mode === 'forward') out.rows = rows;
  }
  const t0s = out.rows.map((r) => r.t0).sort((a, b) => a - b);
  out.t0 = t0s.length ? t0s[Math.floor(t0s.length / 2)] : null;
  return out;
}

// --- punteggio di precisione (più basso = meglio): "pinball loss" sui quantili previsti.
// Premia previsioni che centrano il valore tipico E hanno intervalli della giusta ampiezza.
function pinball(y, q, tau) {
  const d = y - q;
  return d >= 0 ? tau * d : (tau - 1) * d;
}

// Errore su rendimenti logaritmici (ln(1+r)) e con un tetto per strumento: un singolo caso estremo
// (o un dato errato) non può dominare la taratura.
const lg = (x) => Math.log(Math.max(1 + x, 0.01));
export function rowLossReturns(r) {
  const p = r.pred;
  const y = lg(r.real.net);
  const ret =
    pinball(y, lg(p.netP5), 0.05) + pinball(y, lg(p.netP25), 0.25) + pinball(y, lg(p.netMedian), 0.5) + pinball(y, lg(p.netP75), 0.75) + pinball(y, lg(p.netP95), 0.95);
  return Math.min(ret / 5, 2);
}

// Rischio: errore sullo scenario sfavorevole (95° percentile della perdita massima), cioè proprio la
// "Perdita massima" mostrata dall'app, più un peso minore sulla perdita tipica (mediana).
export function rowLossRisk(r) {
  return Math.min(0.75 * pinball(r.real.mdd, r.pred.mddP95, 0.95) + 0.25 * pinball(r.real.mdd, r.pred.mddMedian, 0.5), 2);
}

export function rowLoss(r) {
  return rowLossReturns(r) + rowLossRisk(r);
}

/** Dati da pubblicare: riepiloghi + punti per i grafici (previsto vs reale), in forma compatta. */
export function backtestPayload(bt, extra = {}) {
  return {
    ...extra,
    t0: bt.t0,
    modes: bt.modes,
    points: bt.rows.map((r) => [r.type[0], r.pred.netMedian, r.real.net, r.pred.mddP95, r.real.mdd, r.pred.netP5, r.pred.netP95]),
  };
}
