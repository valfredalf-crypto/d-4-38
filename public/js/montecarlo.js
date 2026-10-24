// Motore Monte Carlo condiviso tra browser (Web Worker), CLI e test.
// Lavora su chiusure settimanali in EUR: ogni passo della simulazione è una settimana.

export const WEEKS_PER_YEAR = 52;
/** Soglie di rendimento netto per le probabilità (0 = non perdere, 0.25 = almeno +25%, …). */
export const PROB_THRESHOLDS = [0, 0.1, 0.25, 0.5, 1];

// PRNG deterministico (mulberry32) per risultati riproducibili.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function gaussian(rand) {
  let u = 0;
  while (u === 0) u = rand();
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function logReturns(prices) {
  const out = [];
  for (let i = 1; i < prices.length; i++) {
    const a = prices[i - 1];
    const b = prices[i];
    if (a > 0 && b > 0) out.push(Math.log(b / a));
  }
  return out;
}

export function percentile(sorted, p) {
  if (!sorted.length) return NaN;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

// Massimo drawdown storico (picco → minimo) di una serie di prezzi.
export function historicalMaxDrawdown(prices) {
  let peak = -Infinity;
  let mdd = 0;
  for (const p of prices) {
    if (p > peak) peak = p;
    if (peak > 0) mdd = Math.max(mdd, 1 - p / peak);
  }
  return mdd;
}

export const DEFAULT_OPTIONS = {
  years: 5,           // orizzonte di simulazione
  sims: 2000,         // numero di traiettorie
  method: 'bootstrap', // 'bootstrap' (blocchi di rendimenti storici) | 'gbm' (moto browniano geometrico)
  blockWeeks: 4,      // lunghezza blocchi nel bootstrap: preserva parte dell'autocorrelazione
  lookbackYears: 10,  // quanti anni di storico usare per stimare la distribuzione
  minYears: 2,        // storico minimo richiesto
  amount: 1000,       // capitale investito (€)
  orderCost: 1,       // costo per ordine Trade Republic (€) — applicato in acquisto e vendita
  spreadPct: 0,       // spread/markup stimato (%) applicato una volta in acquisto
  taxRate: 26,        // tassazione plusvalenze (%) — 26% in Italia
  lossMetric: 'mdd_p95', // 'mdd_p95' | 'mdd_median' | 'final_p5'
  gainMetric: 'median',  // 'median' | 'mean'
  seed: 0,
  // Parametri prospettici (annuali, rendimento logaritmico e volatilità). Se valorizzati, i rendimenti
  // storici vengono ricentrati e riscalati: si conserva la forma della distribuzione (code grasse,
  // asimmetrie) ma media e volatilità diventano quelle attese.
  targetDrift: null,
  targetVol: null,
};

// Applica costi e tasse a un rendimento lordo di prezzo: restituisce il guadagno netto in % del capitale.
export function netReturn(grossReturn, o) {
  const amount = o.amount;
  const invested = Math.max(amount - o.orderCost, 0) * (1 - o.spreadPct / 100);
  const proceeds = invested * (1 + grossReturn) - o.orderCost;
  const profit = proceeds - amount;
  const afterTax = profit > 0 ? profit * (1 - o.taxRate / 100) : profit;
  return afterTax / amount;
}

/**
 * Simula `sims` traiettorie di `years` anni partendo dalle chiusure settimanali `prices`.
 * Per ogni traiettoria registra rendimento finale e massimo drawdown (perdita massima picco→minimo).
 */
export function simulate(prices, options = {}) {
  const o = { ...DEFAULT_OPTIONS, ...options };
  const lookback = Math.round(o.lookbackYears * WEEKS_PER_YEAR) + 1;
  const series = prices.slice(-lookback);
  const rets = logReturns(series);
  const historyYears = rets.length / WEEKS_PER_YEAR;
  if (historyYears < o.minYears) {
    return { ok: false, reason: `Storico insufficiente (${historyYears.toFixed(1)} anni, minimo ${o.minYears})`, historyYears };
  }

  const n = rets.length;
  const histMu = rets.reduce((s, r) => s + r, 0) / n;
  const histSigma = Math.sqrt(rets.reduce((s, r) => s + (r - histMu) ** 2, 0) / (n - 1));
  let mu = histMu;
  let sigma = histSigma;
  if (o.targetDrift != null || o.targetVol != null) {
    mu = o.targetDrift != null ? o.targetDrift / WEEKS_PER_YEAR : histMu;
    sigma = o.targetVol != null ? o.targetVol / Math.sqrt(WEEKS_PER_YEAR) : histSigma;
    const a = histSigma > 0 ? sigma / histSigma : 1;
    for (let i = 0; i < n; i++) rets[i] = mu + a * (rets[i] - histMu);
  }
  const steps = Math.round(o.years * WEEKS_PER_YEAR);
  const checkpointEvery = 13; // trimestrale, per il grafico a ventaglio
  const nCheck = Math.floor(steps / checkpointEvery) + 1;
  const rand = mulberry32(o.seed || hashString(String(prices.length) + ':' + prices[prices.length - 1]));

  const finals = new Float64Array(o.sims);
  const mdds = new Float64Array(o.sims);
  const fan = Array.from({ length: nCheck }, () => new Float64Array(o.sims));
  const block = Math.max(1, Math.min(o.blockWeeks, n));

  for (let s = 0; s < o.sims; s++) {
    let v = 0;
    let peak = 0;
    let mdd = 0;
    let pos = 0;
    let left = 0;
    for (let t = 1; t <= steps; t++) {
      let r;
      if (o.method === 'gbm') {
        r = mu + sigma * gaussian(rand);
      } else {
        if (left === 0) {
          pos = Math.floor(rand() * n);
          left = block;
        }
        r = rets[pos];
        pos = (pos + 1) % n;
        left--;
      }
      v += r;
      if (v > peak) peak = v;
      else {
        const dd = 1 - Math.exp(v - peak);
        if (dd > mdd) mdd = dd;
      }
      if (t % checkpointEvery === 0) fan[t / checkpointEvery][s] = v;
    }
    finals[s] = Math.exp(v) - 1;
    mdds[s] = mdd;
  }

  const sortedFinals = Array.from(finals).sort((a, b) => a - b);
  const sortedMdd = Array.from(mdds).sort((a, b) => a - b);
  const nets = sortedFinals.map((r) => netReturn(r, o)); // monotona → resta ordinata
  const meanNet = nets.reduce((s, x) => s + x, 0) / nets.length;

  const fanBands = fan.map((col, i) => {
    const sorted = Array.from(col).sort((a, b) => a - b);
    const q = (p) => (i === 0 ? 0 : Math.exp(percentile(sorted, p)) - 1);
    return { week: i * checkpointEvery, p5: q(0.05), p25: q(0.25), p50: q(0.5), p75: q(0.75), p95: q(0.95) };
  });

  // Istogramma dei rendimenti netti (40 classi tra p1 e p99)
  const lo = percentile(nets, 0.01);
  const hi = percentile(nets, 0.99);
  const bins = 40;
  const width = (hi - lo) / bins || 1;
  const histogram = new Array(bins).fill(0);
  for (const x of nets) {
    const b = Math.min(bins - 1, Math.max(0, Math.floor((x - lo) / width)));
    histogram[b]++;
  }

  const stats = {
    ok: true,
    historyYears,
    annualDrift: mu * WEEKS_PER_YEAR,
    annualVol: sigma * Math.sqrt(WEEKS_PER_YEAR),
    histDrift: histMu * WEEKS_PER_YEAR,
    histVol: histSigma * Math.sqrt(WEEKS_PER_YEAR),
    historicalMdd: historicalMaxDrawdown(series),
    grossMedian: percentile(sortedFinals, 0.5),
    netP5: percentile(nets, 0.05),
    netP25: percentile(nets, 0.25),
    netMedian: percentile(nets, 0.5),
    netP75: percentile(nets, 0.75),
    netP95: percentile(nets, 0.95),
    netMean: meanNet,
    probLoss: nets.filter((x) => x < 0).length / nets.length,
    // Probabilità di ottenere almeno ciascun rendimento netto di PROB_THRESHOLDS (stesso ordine)
    probAtLeast: PROB_THRESHOLDS.map((t) => nets.filter((x) => x >= t).length / nets.length),
    // Perdita definitiva a fine orizzonte nello scenario sfavorevole (5% peggiore) ÷ guadagno tipico (mediano)
    finalLoss: Math.max(0, -percentile(nets, 0.05)),
    ratioFinal: (() => {
      const loss = Math.max(0, -percentile(nets, 0.05));
      const gain = percentile(nets, 0.5);
      return gain > 0 ? loss / gain : Infinity;
    })(),
    mddMedian: percentile(sortedMdd, 0.5),
    mddP95: percentile(sortedMdd, 0.95),
    fan: fanBands,
    histogram: { lo, width, counts: histogram },
  };
  return { ...stats, ...score(stats, o) };
}

/**
 * Rapporto perdita massima / guadagno netto: più è basso, migliore è lo strumento.
 * Con guadagno netto ≤ 0 il rapporto non ha senso → Infinity (in fondo alla classifica).
 */
export function score(stats, options = {}) {
  const o = { ...DEFAULT_OPTIONS, ...options };
  let maxLoss;
  if (o.lossMetric === 'mdd_median') maxLoss = stats.mddMedian;
  else if (o.lossMetric === 'final_p5') maxLoss = Math.max(0, -stats.netP5);
  else maxLoss = stats.mddP95;
  const netGain = o.gainMetric === 'mean' ? stats.netMean : stats.netMedian;
  const ratio = netGain > 0 ? maxLoss / netGain : Infinity;
  return { maxLoss, netGain, ratio };
}
