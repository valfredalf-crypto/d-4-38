import { BENCHMARK_SYMBOL, CRYPTO_BENCHMARK_SYMBOL, DEFAULT_SETTINGS, fileKey, compactResult, applyLivePrice, priorEstimate, priorVol, momentumStats, leveragedArith, underlyingOf, leverageOf, isInverseProduct } from './analyze.js';
import { viewFor, productViewFor } from './market-views.js';
import { isValidIsin } from './isin.js';
import { evaluateAlerts, dueAlerts } from './alerts.js';
import { parityGroup, chooseByMaxGrowth, gapThreshold } from './advice.js';
import { ema, stabilizeRanks } from './stable.js';
import { histValues } from './history.js';
import { SOLID_MIN, solidRecent, solidPass } from './solid.js';
import { trendScore } from './trend.js';
import { distanceFrom } from './range.js';
import { evaluateSolid, stampAlerts } from './solid-alerts.js';
import { analystView, combineForecasts } from './analysts.js';
import { AN_MIN_RELIABLE, AN_EXTREME, ETF_UPSIDE_CAP, DIV_EXTREME, doubtfulTarget, compareConsensus, compareDividend, recoLabel } from './consensus.js';
import { INDICATORS, PRESETS, NP_FILTER_PERIODS, NP_FILTER_LEVELS, SIM_KEY, SIM_P_KEY, SIM_P_LEVELS, P_GAIN_PERIODS, pGainKey, p90Key, SIM_P90_KEY, P90_KEYS, P90_LEVELS, AN_KEYS, PX_KEYS, PX_DIFF_LEVELS, RANGE_COLS, RANGE_KEYS, SPREAD_COLS, PM6_DAYS, PM6_LEVELS, PM6_NOW_LEVELS, RG_PERIODS, balKey, radjKey, asymKey, RISK_KEYS, PROB_FILTERS, AN_UP_LEVELS, AN_N_LEVELS, DIV_LEVELS, npFilterKey, parseNum, activeFilters, passes } from './filters.js';
import { riskGain, probNetAtLeast, netQuantile } from './riskgain.js';
import { WATCH_KEY, FAV_FOLDER, parseWatch, addWatch, removeWatch, cardFileName, cardDocument } from './watch.js';
import { netReturn, DEFAULT_OPTIONS, PROB_THRESHOLDS } from './montecarlo.js';
import { funnelCheck, aumEur, phase1Check, maxGrowthScore } from './funnel.js';
import { project, projectAny, projectShort, portfolioTax, momentumTilt, MOMENTUM_RHO, autoRho, leveredScenario, projectPortfolio, portfolioRisk, stressTest, classifyPortfolio, portfolioStress, totalPortfolioStress, GEMINI_PORTFOLIO, HORIZON_PRESETS, daysToYears, isShortHorizon, horizonShort, horizonLong, horizonExp, normalizeHorizons } from './projection.js';

// Rendimenti passati netti con le stesse regole del guadagno netto (costi ordine, spread, tasse).
function netPerf(gross, inst) {
  if (gross == null || !Number.isFinite(gross)) return null;
  const o = { ...DEFAULT_OPTIONS, ...state.settings.mc };
  if (inst.type === 'crypto') o.spreadPct = state.settings.mc.cryptoSpreadPct ?? o.spreadPct;
  return netReturn(gross, o);
}

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

// Versione statica (GitHub Pages): i dati sono file JSON generati periodicamente, senza server.
const STATIC = document.documentElement.hasAttribute('data-static');
const TYPE_LABEL = { stock: 'Azione', etf: 'ETF/ETC', crypto: 'Crypto' };
const PAGE = 150;

// Sezione di apertura: «Netto più probabile» (dal 27/11/2026, prima era «Max Growth»). Chi aveva ancora «Max Growth»
// come sezione salvata passa una sola volta alla nuova; dopo, la scelta fatta dal menu resta quella salvata.
const START_FUNNEL = (() => {
  try {
    const v = localStorage.getItem('trmc.funnel2');
    if (!localStorage.getItem('trmc.npDefault')) {
      localStorage.setItem('trmc.npDefault', '1');
      if (!v || v === 'maxgrowth') {
        localStorage.setItem('trmc.funnel2', 'short');
        return 'short';
      }
    }
    return v || 'short';
  } catch {
    return 'short';
  }
})();
const state = {
  instruments: [],
  quotes: {},
  data: new Map(), // symbol → { history, fundamentals }
  results: {}, // symbol → { forward, sim } | { error }
  priced: {}, // symbol → prezzo EUR usato nell'ultima previsione (per ricalcolare solo se cambia)
  benchmark: null,
  settings: loadSettings(),
  view: { np: Number(localStorage.getItem('trmc.np')) || 30, type: 'all', q: '', onlyComputed: false, allEtf: localStorage.getItem('trmc.allEtf') === '1', distFilter: localStorage.getItem('trmc.distFilter') || 'all', funnel: START_FUNNEL, scenario: localStorage.getItem('trmc.scenario') || '', nr5Mode: localStorage.getItem('trmc.nr5Mode') || 'std', sort: { key: START_FUNNEL === 'maxgrowth' ? 'maxGrowth' : 'projOpt', dir: -1 }, limit: PAGE, filters: loadFilters() },
  running: false,
  stop: false,
};

// ---------- persistenza locale (solo comodità: tutto funziona anche senza)
// I filtri NON vengono ripristinati alla riapertura: filtri dimenticati riducevano la lista senza che
// fosse evidente. Ogni visita parte con tutti gli strumenti.
function loadFilters() {
  try {
    localStorage.removeItem('trmc.filters');
  } catch {
    /* niente */
  }
  return {};
}
function store(key, value) {
  try {
    if (value === undefined) return JSON.parse(localStorage.getItem(key));
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    return null;
  }
}
// Tiene solo le chiavi previste da DEFAULT_SETTINGS: così una configurazione vecchia salvata nel browser
// (chiavi non più usate) non altera la firma delle impostazioni e i risultati precalcolati restano validi.
function pickKnown(src, def) {
  const out = {};
  for (const k of Object.keys(def)) out[k] = src && k in src ? src[k] : def[k];
  return out;
}
function loadSettings() {
  const s = store('trmc.settings');
  return {
    mc: pickKnown(s?.mc, DEFAULT_SETTINGS.mc),
    outlook: pickKnown(s?.outlook, DEFAULT_SETTINGS.outlook),
  };
}
const settingsKey = () => JSON.stringify(state.settings);
// Confronto robusto della firma delle impostazioni: l'ordine delle chiavi nel JSON non conta (browser
// diversi o versioni diverse possono serializzarle in ordine diverso). Evita che i risultati precalcolati
// vengano scartati per una semplice differenza di ordine, costringendo a premere «Calcola classifica».
function canon(v) {
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
  return JSON.stringify(v);
}
const keyMatches = (k) => {
  if (k == null) return false;
  try {
    return canon(typeof k === 'string' ? JSON.parse(k) : k) === canon(state.settings);
  } catch {
    return false;
  }
};
const RESULTS_FORMAT = 4;
function saveResults() {
  const compact = {};
  for (const [k, r] of Object.entries(state.results)) compact[k] = compactResult(r);
  store('trmc.results', { v: RESULTS_FORMAT, key: settingsKey(), day: state.dataVersion || new Date().toDateString(), results: compact });
}
async function loadResults() {
  const saved = store('trmc.results');
  // copie salvate con un formato precedente (es. senza TER/patrimonio del fondo): si scartano e si ricaricano i dati completi
  if (saved && saved.v === RESULTS_FORMAT && keyMatches(saved.key) && saved.day === (state.dataVersion || new Date().toDateString())) {
    state.results = saved.results || {};
  } else if (STATIC) {
    // Classifica precalcolata con i parametri predefiniti
    const pre = await api('/api/results').catch(() => null);
    if (pre && keyMatches(pre.key)) state.results = pre.results;
  }
}

// ---------- API
function staticPath(path) {
  const u = new URL(path, 'http://x');
  const sym = u.searchParams.get('symbol');
  const map = {
    '/api/meta': 'data/meta.json',
    '/api/instruments': 'data/instruments.json',
    '/api/quotes': 'data/quotes.json',
    '/api/results': 'data/results.json',
    '/api/backtest': 'data/backtest.json',
    '/api/news': 'data/news.json',
    '/api/history': `data/history/${fileKey(sym)}.json`,
    '/api/outlook': `data/outlook/${fileKey(sym)}.json`,
  };
  if (!map[u.pathname]) throw new Error('Funzione non disponibile nella versione online');
  // meta.json mai dalla cache (GitHub Pages la tiene 10 minuti): dice quale versione dei dati caricare;
  // gli altri file usano la versione come chiave, quindi si rinnovano solo quando cambiano.
  if (u.pathname === '/api/meta') return `${map[u.pathname]}?t=${Date.now()}`;
  return `${map[u.pathname]}?v=${encodeURIComponent(state.dataVersion || '')}`;
}

async function api(path, opts) {
  const res = await fetch(STATIC ? staticPath(path) : path, opts);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

// ---------- formattazione
const nf2 = new Intl.NumberFormat('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const eur0 = (x) => String(Math.round(x)).replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ' €';
const nf1 = new Intl.NumberFormat('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nf4 = new Intl.NumberFormat('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 6 });
function pct(x, sign = false, digits = 1) {
  if (x == null || !Number.isFinite(x)) return '–';
  const s = (x * 100).toLocaleString('it-IT', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return (sign && x > 0 ? '+' : '') + s + '%';
}
function eur(x) {
  if (x == null || !Number.isFinite(x)) return '–';
  return (x >= 1 ? nf2 : nf4).format(x) + ' €';
}
function cls(x) {
  return x > 0 ? 'pos' : x < 0 ? 'neg' : '';
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// ---------- worker pool
const POOL = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1));
const workers = [];
const pending = new Map();
let jobId = 0;
let rr = 0;
function getWorker() {
  if (workers.length < POOL) {
    const w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    w.onmessage = (e) => {
      const { id, result, error } = e.data;
      const p = pending.get(id);
      pending.delete(id);
      error ? p.reject(new Error(error)) : p.resolve(result);
    };
    workers.push(w);
    return w;
  }
  return workers[rr++ % workers.length];
}
function runAnalysis(payload) {
  return new Promise((resolve, reject) => {
    const id = ++jobId;
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ id, payload });
  });
}

// ---------- dati
async function getBenchmark() {
  if (!state.benchmark) state.benchmark = await api(`/api/history?symbol=${encodeURIComponent(BENCHMARK_SYMBOL)}`).catch(() => null);
  return state.benchmark;
}

async function getData(inst) {
  if (state.data.has(inst.symbol)) return state.data.get(inst.symbol);
  const q = encodeURIComponent(inst.symbol);
  const needsOutlook = state.settings.outlook.mode === 'forward' && inst.type !== 'crypto';
  const [history, fundamentals] = await Promise.all([
    api(`/api/history?symbol=${q}`),
    needsOutlook ? api(`/api/outlook?symbol=${q}`).catch(() => null) : null,
  ]);
  const d = { history, fundamentals };
  state.data.set(inst.symbol, d);
  return d;
}

async function analyzeOne(inst) {
  const d = await getData(inst);
  const benchmark = state.settings.outlook.mode === 'forward' ? await getBenchmark() : null;
  const price = state.quotes[inst.symbol]?.priceEur;
  const history = applyLivePrice(d.history, price);
  if (inst.type === 'crypto' && !state.cryptoBenchmark) {
    state.cryptoBenchmark = await api(`/api/history?symbol=${encodeURIComponent(CRYPTO_BENCHMARK_SYMBOL)}`).catch(() => null);
  }
  const cryptoBenchmark = inst.type === 'crypto' ? state.cryptoBenchmark : null;
  const r = await runAnalysis({ instrument: inst, history, benchmark, cryptoBenchmark, fundamentals: d.fundamentals, holdings: d.fundamentals?.lookThrough, market: state.market?.expected, marketGrowth: state.market?.growth, settings: state.settings });
  const fund = state.results[inst.symbol]?.fund; // dati del fondo (patrimonio, TER) dal server
  const mom = momentumStats(history.closesEur);
  state.results[inst.symbol] = r.sim.ok ? { ...(fund ? { ...r, fund } : r), mom } : { error: r.sim.reason, ...(r.estimate ? { estimate: r.estimate } : {}), mom };
  state.priced[inst.symbol] = price;
  return state.results[inst.symbol];
}

// ---------- aggiornamento automatico (ogni 60 s): quotazioni → previsioni
async function recomputeChanged() {
  const list = state.instruments.filter((i) => {
    const r = state.results[i.symbol];
    const p = state.quotes[i.symbol]?.priceEur;
    return r && !r.error && p > 0 && p !== state.priced[i.symbol];
  });
  for (const inst of list) {
    if (state.running) return; // un calcolo completo ha la precedenza
    await analyzeOne(inst).catch(() => {});
  }
  if (list.length) {
    saveResults();
    render();
  }
}

// Versione online: nuovi dati pubblicati dall'automazione (ogni ~15 minuti)
// Versione dell'app in uso (dal ?v= aggiunto in pubblicazione): se ne esce una nuova, la pagina si
// ricarica da sola invece di restare alla copia in cache del telefono.
const APP_BUILD = new URL(import.meta.url).searchParams.get('v');
function reloadIfNewBuild(meta) {
  if (!APP_BUILD || !meta?.build || meta.build === APP_BUILD) return false;
  if (new URLSearchParams(location.search).get('b') === meta.build) return false; // già ricaricata: niente cicli
  location.replace(`${location.pathname}?b=${meta.build}${location.hash}`);
  return true;
}
async function checkNewData() {
  const meta = await fetch(`data/meta.json?t=${Date.now()}`).then((r) => r.json());
  if (reloadIfNewBuild(meta)) return;
  if (meta.generatedAt === state.dataVersion) return;
  state.dataVersion = meta.generatedAt;
  if (state.meta) state.meta.verify = meta.verify;
  const [instruments, quotes, pre] = await Promise.all([api('/api/instruments'), api('/api/quotes'), api('/api/results').catch(() => null)]);
  const arrived = instruments.filter((i) => state.pendingIsins?.includes(i.isin));
  state.instruments = instruments;
  state.quotes = quotes;
  state.data.clear();
  state.backtest = null;
  if (arrived.length) {
    state.pendingIsins = state.pendingIsins.filter((x) => !arrived.some((i) => i.isin === x));
    const m = $('#isin-msg');
    if (m) m.innerHTML = `<span class="pos">Aggiunto: ${arrived.map((i) => esc(i.name)).join(', ')}.</span>`;
  }
  if (pre && keyMatches(pre.key)) {
    state.results = pre.results;
    state.priced = Object.fromEntries(Object.entries(quotes).map(([k, q]) => [k, q?.priceEur]));
  } else {
    state.priced = {}; // parametri personalizzati: ricalcolo nel browser
  }
  updateStaticBanner(meta);
  render();
  if ($('#portfolio')?.open && !$('#pf-body')?.contains(document.activeElement)) renderPortfolio(); // nuovi dati: aggiorna le stime (non mentre si digita)
}

// Versione online: quotazioni e previsioni aggiornate ogni ~5 minuti in orario di borsa
// (workflow live.yml → ramo live-data, letto da raw.githubusercontent.com).
// force (pulsante «Aggiorna ora»): lettura diretta da GitHub, senza la copia intermedia che può essere vecchia fino a 5 minuti.
async function checkLiveData(force = false) {
  const m = state.meta;
  if (!m?.repo) return false;
  const branch = m.liveBranch || 'live-data';
  let res = null;
  if (force) res = await fetch(`https://api.github.com/repos/${m.repo}/contents/live.json?ref=${branch}&t=${Date.now()}`, { headers: { Accept: 'application/vnd.github.raw+json' }, cache: 'no-store' }).catch(() => null);
  if (!res?.ok) res = await fetch(`https://raw.githubusercontent.com/${m.repo}/${branch}/live.json${force ? `?t=${Date.now()}` : ''}`, { cache: force ? 'no-store' : 'no-cache' });
  if (!res.ok) return false;
  const live = await res.json();
  if (!live.generatedAt || live.generatedAt <= (state.liveVersion || state.dataVersion || '')) return false;
  state.liveVersion = live.generatedAt;
  if (live.market) state.market = live.market;
  if (live.verify) state.verify = live.verify;
  const known = new Set(state.instruments.map((i) => i.symbol));
  for (const [k, q] of Object.entries(live.quotes || {})) {
    if (!known.has(k) || !q) continue;
    const old = state.quotes[k]?.perf;
    // campi che il job dei dati live pubblica solo dopo il riavvio sul nuovo codice: nel frattempo restano quelli già noti
    let keep = null;
    if (q.perf && old) for (const f of ['sl', 'wm', 'sn', 'a52', 'l52', 'a90', 'l90']) if (q.perf[f] == null && old[f] != null) (keep ||= {})[f] = old[f];
    state.quotes[k] = keep ? { ...q, perf: { ...q.perf, ...keep } } : q;
  }
  if (keyMatches(live.key)) {
    for (const [k, r] of Object.entries(live.results || {})) {
      if (!known.has(k)) continue;
      // i dati del fondo (TER, patrimonio) non sempre sono negli aggiornamenti live: si conservano quelli già noti
      const prev = state.results[k];
      const prevFund = prev?.fund;
      let nr = r && !r.fund && prevFund ? { ...r, fund: prevFund } : r;
      // il 10° percentile degli scenari arriva dal job dei dati live solo dopo il suo riavvio sul nuovo codice:
      // nel frattempo resta quello calcolato alla pubblicazione (stessi scenari a 5 anni, cambia poco da un'ora all'altra)
      if (nr?.sim && nr.sim.netP10 == null && Number.isFinite(prev?.sim?.netP10)) nr = { ...nr, sim: { ...nr.sim, netP10: prev.sim.netP10 } };
      state.results[k] = nr;
      state.priced[k] = live.quotes?.[k]?.priceEur;
    }
    saveResults();
  }
  return true;
}

// Pulsante «Aggiorna ora»: scarica subito gli ultimi dati pubblicati (sito + dati live + crypto), anche con gli aggiornamenti
// automatici disattivati, e dice se è arrivato qualcosa di nuovo.
async function manualRefresh() {
  if (state.refreshing) return;
  state.refreshing = true;
  state.refreshMsg = 'Aggiornamento in corso…';
  updateStaticBanner({ generatedAt: state.dataVersion });
  for (let k = 0; k < 40 && (state.ticking || state.running); k++) await new Promise((r) => setTimeout(r, 250)); // aggiornamento automatico in corso
  state.ticking = true;
  const before = [state.dataVersion, state.liveVersion].filter(Boolean).sort().at(-1);
  try {
    await checkNewData().catch(() => {});
    await checkLiveData(true).catch(() => {});
    state.liveReady = true;
    await liveCrypto().catch(() => {});
    checkSellAlerts();
    const after = [state.dataVersion, state.liveVersion].filter(Boolean).sort().at(-1);
    const hm = (d) => new Date(d).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
    state.refreshMsg = after && after !== before ? `Aggiornato adesso: dati delle ${hm(after)}.` : `Hai già gli ultimi dati pubblicati (${after ? hm(after) : 'n/d'}): il prossimo aggiornamento automatico arriva appena pronto.`;
  } catch (e) {
    state.refreshMsg = 'Aggiornamento non riuscito: controlla la connessione e riprova.';
  } finally {
    state.ticking = false;
    state.refreshing = false;
  }
  updateStaticBanner({ generatedAt: state.dataVersion });
  render();
  if ($('#portfolio')?.open && !$('#pf-body')?.contains(document.activeElement)) renderPortfolio();
  setTimeout(() => {
    state.refreshMsg = null;
    updateStaticBanner({ generatedAt: state.dataVersion });
  }, 15000);
}

// Versione online: prezzi crypto in tempo reale da Coinbase (API pubblica, nessuna chiave).
async function liveCrypto() {
  const res = await fetch('https://api.coinbase.com/v2/exchange-rates?currency=EUR');
  if (!res.ok) return;
  const rates = (await res.json())?.data?.rates || {};
  let n = 0;
  for (const inst of state.instruments) {
    if (inst.type !== 'crypto') continue;
    const base = inst.symbol.replace(/-EUR$/, '').replace(/\d+$/, '');
    const rate = Number(rates[base]);
    const q = state.quotes[inst.symbol];
    if (!(rate > 0) || !q) continue;
    if (q.prevEur == null) q.prevEur = q.priceEur && q.changePct != null ? q.priceEur / (1 + q.changePct) : null;
    q.priceEur = 1 / rate;
    q.changePct = q.prevEur ? q.priceEur / q.prevEur - 1 : q.changePct;
    q.live = true;
    n++;
  }
  if (n) state.liveAt = new Date();
}

function updateStaticBanner(meta) {
  const b = $('#static-banner');
  b.hidden = false;
  const fmt = (d) => new Date(d).toLocaleString('it-IT', { dateStyle: 'medium', timeStyle: 'short' });
  const latest = [meta.generatedAt, state.liveVersion].filter(Boolean).sort().at(-1);
  // età dei dati: in orario di borsa (lun–ven, 6–22 UTC) oltre 20 minuti senza aggiornamenti viene segnalato
  const ageMin = latest ? Math.max(0, Math.round((Date.now() - new Date(latest).getTime()) / 60e3)) : null;
  const now = new Date();
  const market = now.getUTCDay() >= 1 && now.getUTCDay() <= 5 && now.getUTCHours() >= 6 && now.getUTCHours() < 22;
  const age = ageMin == null ? '' : ageMin < 1 ? 'meno di 1 minuto fa' : ageMin < 120 ? `${ageMin} min fa` : `${Math.round(ageMin / 60)} ore fa`;
  b.textContent =
    `Ultimo aggiornamento automatico: ${latest ? fmt(latest) : 'n/d'}${age ? ` (${age})` : ''}` +
    (market && ageMin > 20 ? ' ⚠️ dati fermi: tocca «Aggiorna ora»' : '') +
    (state.liveAt ? ` · crypto in tempo reale alle ${state.liveAt.toLocaleTimeString('it-IT')}` : '') +
    '. Azioni ed ETF si aggiornano ogni pochi minuti in orario di borsa; previsioni ricalcolate a ogni aggiornamento.';
  const rb = document.createElement('button');
  rb.type = 'button';
  rb.id = 'refresh-now';
  rb.className = 'refresh-btn';
  rb.textContent = state.refreshing ? 'Aggiornamento…' : 'Aggiorna ora';
  rb.disabled = !!state.refreshing;
  rb.title = 'Scarica subito gli ultimi dati pubblicati';
  rb.addEventListener('click', manualRefresh);
  b.append(' ', rb);
  if (state.refreshMsg) {
    const rm = document.createElement('span');
    rm.className = 'refresh-msg';
    rm.textContent = state.refreshMsg;
    b.append(' ', rm);
  }
  // Verifica automatica eseguita a ogni aggiornamento (riproducibilità, dati, modello): esito e dettagli
  const v = [state.verify, state.meta?.verify].filter(Boolean).sort((a, b2) => (a.at < b2.at ? 1 : -1))[0];
  if (v) {
    const warn = v.checks.filter((c) => c.level !== 'ok');
    const s = document.createElement('button');
    s.type = 'button';
    s.className = `verify-chip ${v.status}`;
    s.textContent = v.status === 'ok' ? '✅ Verifica dati e modelli superata' : `⚠️ Verifica: ${warn.length} ${warn.length === 1 ? 'avviso' : 'avvisi'}`;
    s.title = 'Tocca per i dettagli della verifica';
    s.addEventListener('click', () => alert(`Verifica automatica del ${fmt(v.at)}\n\n${v.checks.map((c) => `${c.level === 'ok' ? '✅' : c.level === 'warn' ? '⚠️' : '❌'} ${c.label}: ${c.text}`).join('\n\n')}${v.samples?.length ? `\n\nImpronte (dati → risultato) di controllo:\n${v.samples.map((x) => `${x.symbol}: ${x.inputs} → ${x.output}`).join('\n')}` : ''}`));
    b.append(' ', s);
  }
  b.dataset.generatedAt = meta.generatedAt;
}

async function liveTick() {
  if (!$('#auto-quotes').checked || document.hidden || state.running || state.ticking) return; // niente aggiornamenti sovrapposti
  state.ticking = true;
  try {
    if (STATIC) {
      await checkNewData().catch(() => {});
      await checkLiveData().catch(() => {});
      state.liveReady = true;
      await liveCrypto().catch(() => {});
      checkSellAlerts();
      updateStaticBanner({ generatedAt: state.dataVersion });
      render();
      if ($('#portfolio')?.open && !$('#pf-body')?.contains(document.activeElement)) renderPortfolio(); // aggiorna le stime del portafoglio (non mentre si digita)
    } else {
      await refreshQuotes(visibleSymbols());
      checkSellAlerts();
    }
    await recomputeChanged();
  } catch (e) {
    console.warn('aggiornamento', e);
  } finally {
    state.ticking = false;
  }
}

async function runAll(list) {
  if (state.running) return;
  state.running = true;
  state.stop = false;
  $('#btn-run').disabled = true;
  const prog = $('#progress');
  prog.hidden = false;
  let done = 0;
  let errors = 0;
  const update = () => {
    prog.style.setProperty('--p', `${(done / list.length) * 100}%`);
    $('.label', prog).textContent = `${done}/${list.length} analizzati${errors ? ` · ${errors} senza dati` : ''}`;
  };
  update();
  let i = 0;
  let lastRender = 0;
  const workersN = 4;
  await Promise.all(
    Array.from({ length: workersN }, async () => {
      while (i < list.length && !state.stop) {
        const inst = list[i++];
        try {
          const r = await analyzeOne(inst);
          if (r.error) errors++;
        } catch (e) {
          state.results[inst.symbol] = { error: e.message };
          errors++;
        }
        done++;
        update();
        if (Date.now() - lastRender > 700) {
          lastRender = Date.now();
          render();
        }
      }
    }),
  );
  state.running = false;
  $('#btn-run').disabled = false;
  prog.hidden = true;
  saveResults();
  render();
  refreshQuotes(visibleSymbols().filter((s) => !state.quotes[s]));
}

async function refreshQuotes(symbols) {
  if (STATIC) {
    if (!Object.keys(state.quotes).length) state.quotes = await api('/api/quotes').catch(() => ({}));
    return render();
  }
  for (let k = 0; k < symbols.length; k += 100) {
    const chunk = symbols.slice(k, k + 100);
    try {
      Object.assign(state.quotes, await api(`/api/quotes?symbols=${chunk.map(encodeURIComponent).join(',')}`));
    } catch (e) {
      console.warn('quotazioni', e);
    }
  }
  render();
}

// ---------- vista
function filtered() {
  const { type, q, onlyComputed, allEtf, distFilter } = state.view;
  const needle = q.trim().toLowerCase();
  const code = needle.replace(/[\s-]/g, ''); // ISIN o ticker anche scritti con spazi/trattini
  const active = activeFilters(state.view.filters);
  // L'imbuto si applica solo quando i dati dei fondi (patrimonio) sono stati pubblicati
  const fundData = Object.values(state.results).some((r) => r?.fund?.aum);
  const funnelOn = state.view.funnel === 'on' && fundData; // modalità breve: nessun imbuto, tutti gli strumenti
  const phase1On = state.view.funnel === 'maxgrowth';
  const levTab = type === 'lev';
  const solid = solidMode();
  const watch = watchMode();
  return state.instruments.filter((i) => {
    if (watch && !watchSet.has(i.symbol)) return false;
    if (levTab) {
      if (!(i.leveraged && i.type === 'etf')) return false;
    } else if (type === 'growth') {
      if (i.growth == null) return false;
    } else if (type === 'bond') {
      if (!isBond(i)) return false;
    } else if (type === 'etf') {
      if (i.type !== 'etf' || isBond(i)) return false; // i bond hanno la loro scheda, qui solo ETF non obbligazionari
    } else if (type !== 'all' && i.type !== type) return false;
    if (onlyComputed && !(state.results[i.symbol] && !state.results[i.symbol].error)) return false;
    if (solid && !solidOf(i)) return false;
    // Accumulazione / distribuzione: è una caratteristica dei fondi (ETF), non delle azioni singole. Il filtro
    // si applica quindi solo agli ETF (bond compresi); le azioni e le crypto non vengono mai escluse da qui,
    // altrimenti «Accumulazione» svuoterebbe la scheda Azioni (le azioni distribuiscono tutte dividendi).
    if (distFilter && distFilter !== 'all' && i.type === 'etf' && distKind(i) !== distFilter) return false;
    // Imbuto degli ETF globali (purezza, accumulazione, patrimonio ≥ 1 mld, TER ≤ 0,25%): gli ETF bocciati
    // escono dalla classifica (non nella scheda Bond e non quando si cerca per nome/ISIN)
    if (funnelOn && !levTab && i.type === 'etf' && type !== 'bond' && !needle && !funnelOf(i).pass) return false;
    // Algoritmo Max Growth, fase 1: fuori distribuzione, patrimonio < 500 mln, TER > 0,30%
    if (phase1On && !levTab && (i.type === 'etf' || i.type === 'stock') && type !== 'bond' && !needle && !phase1Check(i, state.results[i.symbol]?.fund, distKind(i), state.results[i.symbol]?.forward).pass) return false;

    // ETF: in elenco solo quelli con la stima costruita dalla composizione reale (partecipazioni, pesi, stime
    // dei singoli titoli); gli altri (stima dal mercato × β) sono nascosti salvo richiesta.
    // Chi cerca per nome/ISIN, o nella scheda Bond (obbligazionari, stima dal mercato), si mostrano comunque.
    if (!allEtf && !shortMode() && !needle && !levTab && type !== 'bond' && i.type === 'etf' && !hasHoldingsEstimate(i)) return false;
    if (needle && !`${i.name} ${i.symbol} ${i.isin || ''}`.toLowerCase().includes(needle) && !(code && `${i.symbol} ${i.isin || ''}`.toLowerCase().replace(/[\s-]/g, '').includes(code))) return false;
    return !active.length || passes(rowValues(i), active);
  });
}

// ---------- pannello filtri sugli indicatori
function saveFilters() {
  /* non salvati: vedi loadFilters */
}

function updateFiltersUi() {
  rowKeyCache.at = -1;
  const n = activeFilters(state.view.filters).length;
  const badge = $('#filters-count');
  badge.hidden = !n;
  badge.textContent = n;
  for (const el of $$('#filters-panel input[data-key]')) {
    const v = state.view.filters[el.dataset.key]?.[el.dataset.bound] ?? '';
    if (document.activeElement !== el) el.value = v;
    el.classList.toggle('on', String(v).trim() !== '');
  }
  for (const b of $$('#filters-panel [data-npf]')) {
    const f = state.view.filters[b.dataset.npf];
    const on = !!f && parseNum(f.min) === Number(b.dataset.min) && parseNum(f.max) == null;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
  }
  const capEl = $('#npf-cap');
  if (capEl) capEl.textContent = eur0(state.settings.mc.amount || 10000);
  for (const el of $$('#filters-panel .npf-cap2')) el.textContent = eur0(state.settings.mc.amount || 10000);
  const total = filtered().length;
  const bar = $('#active-filters');
  if (bar) {
    const act = activeFilters(state.view.filters);
    bar.hidden = !act.length;
    const fmt = (ind, x) => (x == null ? '' : ind.eur ? eur0(x) : ind.pct ? nf1.format(x * 100) + '%' : nf2.format(x));
    bar.innerHTML = act.length
      ? `<b>Filtri attivi:</b> ${act
          .map((a) => {
            const ind = INDICATORS.find((x) => x.key === a.key);
            const txt = a.min != null && a.max != null ? `${fmt(ind, a.min)} – ${fmt(ind, a.max)}` : a.min != null ? `${a.strict ? '>' : '≥'} ${fmt(ind, a.min)}` : `≤ ${fmt(ind, a.max)}`;
            return `<span class="chip">${esc(ind.label)} ${txt} <button type="button" data-unfilter="${a.key}" title="Togli questo filtro">✕</button></span>`;
          })
          .join(' ')} · <b>${total.toLocaleString('it-IT')}</b> strumenti su ${state.instruments.length.toLocaleString('it-IT')} <button type="button" class="ghost small" data-unfilter="*">Togli tutti i filtri</button>`
      : '';
  }
  $('#filters-summary').textContent = n ? `${n} filtr${n === 1 ? 'o' : 'i'} attiv${n === 1 ? 'o' : 'i'} · ${total.toLocaleString('it-IT')} strumenti corrispondono` : 'Nessun filtro attivo';
}

function buildFiltersPanel() {
  $('#filters-panel .filters-grid').innerHTML = INDICATORS.map(
    (ind) => `<div class="frow"><span>${esc(ind.label)}${ind.pct ? ' <span class="unit">%</span>' : ''}</span>
      <input data-key="${ind.key}" data-bound="min" inputmode="decimal" placeholder="min" aria-label="${esc(ind.label)} minimo">
      <input data-key="${ind.key}" data-bound="max" inputmode="decimal" placeholder="max" aria-label="${esc(ind.label)} massimo"></div>`,
  ).join('');
  const presets = $('#filters-panel .presets');
  PRESETS.forEach((p, k) => presets.insertAdjacentHTML('beforeend', `<button class="ghost" data-preset="${k}">${esc(p.label)}</button>`));
  presets.addEventListener('click', (e) => {
    const b = e.target.closest('[data-preset]');
    if (!b) return;
    // Un filtro rapido sostituisce quelli attivi (prima si sommavano, riducendo la lista senza volerlo);
    // un secondo clic sullo stesso lo toglie
    const preset = PRESETS[Number(b.dataset.preset)].filters;
    const same = JSON.stringify(activeFilters(state.view.filters)) === JSON.stringify(activeFilters(preset));
    state.view.filters = same ? {} : Object.fromEntries(Object.entries(preset).map(([k, v]) => [k, { ...v }]));
    applyFilters();
  });
  const npf = $('#filters-panel .np-filters');
  if (npf) {
    npf.innerHTML = `<div class="npf-title"><b>Probabilità a ${simYears()} anni</b> <span class="muted">sui ${simCount()} scenari simulati: scrivi il minimo e/o il massimo, in % (per esempio perdita max 20; guadagno &gt; 50% min 30)</span></div>${PROB_FILTERS.map(([k, l]) => `<div class="npf-row npf-mm"><span>${l}</span><input data-key="${k}" data-bound="min" inputmode="decimal" placeholder="min %" aria-label="Probabilità: ${l}, minimo in percentuale"><input data-key="${k}" data-bound="max" inputmode="decimal" placeholder="max %" aria-label="Probabilità: ${l}, massimo in percentuale"></div>`).join('')}<div class="npf-title npf-sep"><b>Netto più probabile</b> <span class="muted">su <span id="npf-cap"></span> investiti: solo gli strumenti sopra la soglia</span></div>${NP_FILTER_PERIODS.map(
      ([d, l]) => `<div class="npf-row"><span>${l}</span>${NP_FILTER_LEVELS.map((x) => `<button type="button" class="ghost" data-npf="${npFilterKey(d)}" data-min="${x}" aria-pressed="false" title="Mostra solo gli strumenti con netto più probabile a ${l} maggiore di ${eur0(x)}. Tocca ancora per togliere il filtro.">&gt; ${eur0(x)}</button>`).join('')}</div>`,
    ).join('')}<div class="npf-title npf-sep"><b>Prezzo più probabile rispetto al prezzo attuale</b> <span class="muted">differenza al periodo scelto nella barra (1 gg … 5 anni): positiva = il modello vede il prezzo più in alto</span></div><div class="npf-row"><span>Differenza</span>${PX_DIFF_LEVELS.map((x) => `<button type="button" class="ghost" data-npf="pxDiff" data-min="${x}" aria-pressed="false" title="Mostra solo gli strumenti con prezzo più probabile almeno il ${x}% sopra il prezzo attuale, al periodo scelto. Tocca ancora per togliere il filtro.">≥ ${x}%</button>`).join('')}</div><div class="npf-title npf-sep"><b>Prezzo più probabile a 6 mesi rispetto al prezzo attuale</b> <span class="muted">(prezzo più probabile a 6 mesi − prezzo attuale) ÷ prezzo attuale</span></div><div class="npf-row"><span>Sopra il prezzo</span>${PM6_NOW_LEVELS.map((x) => `<button type="button" class="ghost" data-npf="pm6Now" data-min="${x}" aria-pressed="false" title="Mostra solo gli strumenti il cui prezzo più probabile a 6 mesi è almeno il ${x}% sopra il prezzo attuale. Tocca ancora per togliere il filtro.">≥ ${x}%</button>`).join('')}</div><div class="npf-title npf-sep"><b>Prezzo più probabile a 6 mesi rispetto al minimo a 52 settimane</b> <span class="muted">(prezzo più probabile a 6 mesi − minimo 52 settimane) ÷ minimo 52 settimane</span></div><div class="npf-row"><span>Sopra il minimo</span>${PM6_LEVELS.map((x) => `<button type="button" class="ghost" data-npf="pm6L52" data-min="${x}" aria-pressed="false" title="Mostra solo gli strumenti il cui prezzo più probabile a 6 mesi è almeno il ${x}% sopra il minimo delle ultime 52 settimane. Tocca ancora per togliere il filtro.">≥ ${x}%</button>`).join('')}</div><div class="npf-title npf-sep"><b>Guadagno netto mediano su ${simCount()} scenari</b> <span class="muted">a ${simYears()} anni (metà degli scenari sopra, metà sotto), su <span class="npf-cap2"></span></span></div><div class="npf-row"><span>${simYears()} anni</span>${NP_FILTER_LEVELS.map((x) => `<button type="button" class="ghost" data-npf="${SIM_KEY}" data-min="${x}" aria-pressed="false" title="Mostra solo gli strumenti con valore mediano dei ${simCount()} scenari a ${simYears()} anni maggiore di ${eur0(x)}. Tocca ancora per togliere il filtro.">&gt; ${eur0(x)}</button>`).join('')}</div><div class="npf-title npf-sep"><b>Guadagno netto nel 90% degli scenari</b> <span class="muted">in euro: raggiunto o superato in 9 casi su 10 (1 e 3 anni dal modello delle previsioni, ${simYears()} anni dai ${simCount()} scenari simulati)</span></div>${[...P_GAIN_PERIODS.map(([d, l]) => [p90Key(d), l]), [SIM_P90_KEY, `${simYears()} anni`]].map(([k, l]) => `<div class="npf-row"><span>${l}</span>${P90_LEVELS.map((x) => `<button type="button" class="ghost" data-npf="${k}" data-min="${x}" aria-pressed="false" title="Mostra solo gli strumenti che a ${l} in 9 casi su 10 finiscono sopra ${eur0(x)}. Tocca ancora per togliere il filtro.">&gt; ${eur0(x)}</button>`).join('')}</div>`).join('')}<div class="npf-title npf-sep"><b>Analisti e dividendi</b> <span class="muted">potenziale = prezzo obiettivo medio a 12 mesi rispetto al prezzo; dividendo annuo lordo</span></div><div class="npf-row"><span>Potenziale</span>${AN_UP_LEVELS.map((x) => `<button type="button" class="ghost" data-npf="anUp" data-min="${x}" aria-pressed="false" title="Mostra solo gli strumenti con potenziale secondo gli analisti di almeno il ${x}%. Tocca ancora per togliere il filtro.">≥ ${x}%</button>`).join('')}</div><div class="npf-row"><span>Analisti</span>${AN_N_LEVELS.map((x) => `<button type="button" class="ghost" data-npf="anN" data-min="${x}" aria-pressed="false" title="Mostra solo le azioni seguite da almeno ${x} analisti. Tocca ancora per togliere il filtro.">≥ ${x}</button>`).join('')}</div><div class="npf-row"><span>Dividendo</span>${DIV_LEVELS.map((x) => `<button type="button" class="ghost" data-npf="divY" data-min="${x}" aria-pressed="false" title="Mostra solo gli strumenti con rendimento da dividendi di almeno il ${x}%. Tocca ancora per togliere il filtro.">≥ ${x}%</button>`).join('')}</div>`;
    npf.addEventListener('click', (e) => {
      const b = e.target.closest('[data-npf]');
      if (!b) return;
      const k = b.dataset.npf;
      const f = state.view.filters[k];
      // una soglia per periodo; un secondo clic sulla stessa la toglie
      if (f && parseNum(f.min) === Number(b.dataset.min) && parseNum(f.max) == null) delete state.view.filters[k];
      else state.view.filters[k] = { min: b.dataset.min };
      applyFilters();
    });
  }
  let t;
  $('#filters-panel').addEventListener('input', (e) => {
    const el = e.target.closest('input[data-key]');
    if (!el) return;
    const f = (state.view.filters[el.dataset.key] ||= {});
    f[el.dataset.bound] = el.value;
    clearTimeout(t);
    t = setTimeout(applyFilters, 250);
  });
  $('#active-filters')?.addEventListener('click', (e) => {
    const k = e.target.closest('[data-unfilter]')?.dataset.unfilter;
    if (!k) return;
    if (k === '*') state.view.filters = {};
    else delete state.view.filters[k];
    applyFilters();
  });
  $('#btn-filters-reset').addEventListener('click', () => {
    state.view.filters = {};
    applyFilters();
  });
  $('#btn-filters').addEventListener('click', () => {
    const panel = $('#filters-panel');
    panel.hidden = !panel.hidden;
    $('#btn-filters').setAttribute('aria-expanded', String(!panel.hidden));
  });
  updateFiltersUi();
}

function applyFilters() {
  saveFilters();
  state.view.limit = PAGE;
  render();
  updateFiltersUi();
  refreshQuotes(visibleSymbols().filter((s) => !state.quotes[s]));
}

const growthOf = (r) => (r && !r.error ? r.forward?.growth ?? r.forward?.expectedGrowth ?? null : null);
// Crescita attesa cumulata sull'orizzonte (la crescita è annua, i guadagni sono a 5 anni: vanno sommati nella stessa unità)
const growth5 = (r) => {
  const g = growthOf(r);
  return g == null ? 0 : (1 + g) ** (state.settings.mc.years || 5) - 1;
};
// Importo in euro sul capitale investito (impostazioni), per affiancare le percentuali in tabella
const eurAmt = (x, sign = true) => {
  if (x == null || !Number.isFinite(x)) return '';
  const v = x * (state.settings.mc.amount || 10000);
  return `<span class="eur">${sign && v > 0 ? '+' : ''}${Math.round(v).toLocaleString('it-IT')} €</span>`;
};
const hasHoldingsEstimate = (i) => state.results[i.symbol]?.forward?.growthSource === 'holdings';
// Accumulazione o distribuzione: per gli ETF con stima si usa il dato del modello (distYield > 0 =
// distribuisce), altrimenti il nome; le azioni distribuiscono (dividendi), le crypto nessuno.
const DIST_RE = /\b(dist|distr|distributing|distribution|distribuzione|dis|income|inc|1d|2d|3d|4d|5d)\b|\(d(ist)?\)|[-\s]d$/i;
const ACC_RE = /\b(acc|accumulating|accumulazione|thesaur|1c|2c|3c|4c|5c)\b|\(a?cc?\)|[-\s]c$/i;
function distKind(i) {
  // Il nome della classe di quote (Acc/Dist/C/D) è il segnale più affidabile; in mancanza si usa il dato
  // del modello (distYield > 0 = distribuisce); le azioni distribuiscono, le crypto nessuno.
  const name = i.name || '';
  if (DIST_RE.test(name)) return 'dist';
  if (ACC_RE.test(name)) return 'acc';
  const r = state.results[i.symbol];
  if (i.type === 'etf' && r && !r.error && r.sim) return r.sim.distYield > 0 ? 'dist' : 'acc';
  if (i.type === 'stock') return 'dist';
  return null;
}
const funnelOf = (i) => funnelCheck(i, state.results[i.symbol]?.fund, distKind(i));
// ETF obbligazionario (o monetario): riconosciuto dal nome. I bond ETF di solito non hanno una stima
// dalla composizione (sono obbligazioni, non azioni), quindi la scheda Bond li mostra comunque.
const BOND_RE = /\b(bond|bonds|obbligaz\w*|treasur\w*|govt|government bond|gilts?|bund|btp|oat|bonos|sovereign|aggregate|aggt|corporate|high[- ]yield|fixed income|reddito fisso|titoli di stato|inflation[- ]linked|tips|green bond|covered bond|money market|monetario|liquidity|ultrashort|senior loan|floating rate)\b/i;
const isBond = (i) => i.type === 'etf' && BOND_RE.test(i.name || '');
// Profili del Netto Reale 5A: coefficiente applicato alla perdita media nel 5% peggiore (ETF / azione singola)
export const NR5_MODES = {
  std: { label: 'Standard (½ ETF, ⅓ azioni)', etf: 0.5, stock: 1 / 3 },
  growth: { label: 'Più peso alla crescita (¼ ETF, ⅙ azioni)', etf: 0.25, stock: 1 / 6 },
  even: { label: 'Crescita e rischio 1:1', etf: 1, stock: 1 },
  risk: { label: 'Più peso al rischio (2:1)', etf: 2, stock: 2 },
};
const nr5Weight = (type) => (NR5_MODES[state.view.nr5Mode] || NR5_MODES.std)[type === 'stock' ? 'stock' : 'etf'];
const fracLabel = (k) => ({ 0.5: '½', 0.25: '¼', 1: '1', 2: '2' })[k] || (Math.abs(k - 1 / 3) < 1e-9 ? '⅓' : Math.abs(k - 1 / 6) < 1e-9 ? '⅙' : String(k));
// Algoritmo del documento PRJ-FIN-2026-019, applicato a ogni strumento. Modulo 1: CAGR atteso = rendimento
// annuo atteso dal modello (ERP + P/E e utili attesi), TER 0,20% per gli ETF (0 per azioni e crypto),
// aliquota effettiva dello strumento (12,5% sulla quota di titoli di Stato, 26% il resto). Modulo 2:
// montante composto. Modulo 3: imposta sulla plusvalenza. Modulo 4 (rischio): MDD storico dello strumento.
const DEFAULT_TER = { etf: 0.002, stock: 0, crypto: 0 };
// Scenari storici a CAGR lordo fisso per la classifica (selettore in alto): null = stima del modello.
// Scenari: miscela tra il rendimento di mercato dello scenario (pessimistico 2%, base 7%, ottimistico 10%)
// e il CAGR atteso del singolo strumento. Negli scenari base e ottimistico il CAGR dello strumento pesa di
// più, così le prospettive di crescita restano rilevanti: uno strumento più promettente resta sopra.
const SCENARIO_MARKET = { pess: 0.02, base: 0.07, opt: 0.1 };
const SCENARIO_WGROWTH = { pess: 0.35, base: 0.6, opt: 0.7 }; // peso del CAGR atteso dello strumento
function blendCagr(scKey, exp) {
  const m = SCENARIO_MARKET[scKey];
  if (!Number.isFinite(exp)) return m;
  const w = SCENARIO_WGROWTH[scKey];
  return Math.max(-0.1, Math.min(0.6, w * exp + (1 - w) * m));
}
function scenarioCagr(r) {
  const sc = state.view.scenario;
  if (SCENARIO_MARKET[sc] == null) return null; // Modello
  return blendCagr(sc, r?.forward?.expected);
}
// Prospettive del SOTTOSTANTE dei prodotti a leva/short: rendimento atteso e σ medi (mediana) degli ETF/ETC non a leva sullo
// stesso sottostante (es. argento → ETC sull'argento fisico), dal modello aggiornato a ogni pubblicazione.
const _undCache = new Map();
function underlyingView(inst) {
  const u = underlyingOf(inst?.name);
  if (!u || !u.proxy) return null;
  const key = `${u.key}|${state.dataVersion || ''}|${state.liveVersion || ''}`;
  if (_undCache.has(key)) return _undCache.get(key);
  const med = (a) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
  const c = state.instruments.filter((x) => !x.leveraged && x.type === 'etf' && u.proxy.test(x.name) && !/miner/i.test(x.name)).map((x) => state.results[x.symbol]).filter((r) => r && !r.error && Number.isFinite(r.forward?.expected));
  // previsione specifica (analisti sui titoli dell'ETF) se almeno metà degli ETF sul sottostante ce l'ha
  const ev = c.filter((r) => ['own', 'holdings'].includes(r.forward?.growthSource)).length * 2 >= c.length;
  const out = c.length ? { label: u.label, mu: med(c.map((r) => r.forward.expected)), vol: med(c.map((r) => r.forward.vol).filter(Number.isFinite)), n: c.length, ev } : null;
  _undCache.set(key, out);
  return out;
}
/** Rendimento atteso aritmetico per gli orizzonti brevi: per leva/short dal sottostante reale (vedi leveragedArith). */
function shortPrior(inst, cagr) {
  const rf = (state.settings.outlook?.riskFree ?? 2) / 100;
  // 1) previsione verificata per il singolo strumento (comportamento misurato nello scenario attuale)
  const pv = productViewFor(inst?.isin);
  if (pv) return { cagr: Math.max(-0.995, pv.annual), netOfTer: true, view: true, viewYears: Math.max(...Object.keys(pv.returns).map(Number)) / 365, src: `previsione per lo strumento: ${pct(pv.returns[30], true, 0)} a 30 gg, ${pct(pv.returns[60], true, 0)} a 60 gg (${pv.source})` };
  // Previsione di mercato verificata per il sottostante (fonte e data): vale per i prodotti a leva/short e per gli ETF/ETC
  // che replicano direttamente il sottostante (es. argento fisico), non per le società minerarie.
  const und = underlyingOf(inst?.name);
  const direct = und && !inst?.leveraged && inst?.type === 'etf' && und.proxy && und.proxy.test(inst.name) && !/miner/i.test(inst.name);
  const view = und && (inst?.leveraged || direct) ? viewFor(und.key) : null;
  if (view) {
    const uv = underlyingView(inst);
    const muU = view.geo + ((uv?.vol ?? 0) ** 2) / 2; // rendimento medio coerente con la previsione centrale
    const a = inst?.leveraged ? leveragedArith({ name: inst.name, mu: muU, rf }) : muU;
    if (a != null) return { cagr: a, view: true, viewYears: view.years, src: `previsione di mercato ${und.label}: ${pct(view.move, true, 1)} al ${view.targetDate.split('-').reverse().join('/')} (${view.source})` };
  }
  if (!inst?.leveraged) return { cagr, src: null };
  // sottostanti che non seguono la borsa (es. VIX): niente stima dal mercato azionario
  if (und?.noEquity) return { cagr, src: `sottostante ${und.label}: nessuna previsione affidabile (non si usa il mercato azionario)` };
  const u = underlyingView(inst);
  const mu = u?.mu ?? state.market?.expected ?? rf + 0.045;
  const a = leveragedArith({ name: inst.name, mu, rf });
  return a == null ? { cagr, src: null } : { cagr: a, src: u ? `sottostante ${u.label}: rendimento atteso ${pct(u.mu, true, 1)} (mediana di ${u.n} ETF/ETC)` : `sottostante non riconosciuto: mercato azionario ${pct(mu, true, 1)}` };
}
/**
 * CAGR per gli orizzonti brevi: previsione (verificata o del modello) e, con persistenza automatica, trend di mercato attuale
 * solo se confermato dalla previsione. `rho` impostato a mano (numero) forza la persistenza.
 */
function autoShort({ base, ter = 0, vol, mom, years, view = false, rho = null, evidence = true }) {
  const baseNet = base - ter;
  if (view || !mom) return { net: baseNet, window: null, rho: null, view };
  if (Number.isFinite(rho)) {
    const t = momentumTilt({ net: baseNet, vol, mom, years, rho });
    return { net: t.net, window: t.window, rho, view: false };
  }
  const full = momentumTilt({ net: baseNet, vol, mom, years, rho: 1 });
  // conferma solo da previsioni specifiche dello strumento; senza, il trend non viene esteso
  const r = evidence ? autoRho(baseNet, full.net) : 0;
  let net = r ? full.net : baseNet;
  let capped = false;
  if (r) {
    // il trend prosegue, ma non oltre quanto la previsione stessa ritiene raggiungibile: il movimento nel periodo non supera il
    // rendimento annuo previsto (evita di proiettare salti una tantum, es. offerte di acquisto o trimestrali)
    const move = (1 + net) ** years - 1;
    const lim = Math.abs(baseNet);
    if (Math.abs(move) > lim) { net = (1 + Math.sign(move) * lim) ** (1 / years) - 1; capped = true; }
  }
  return { net, window: full.window, rho: r, view: false, auto: true, noEvidence: !evidence, capped };
}
/** Scenari del sottostante per un prodotto a leva/short (σ del sottostante = σ del prodotto ÷ leva). */
function leverScenarios(inst, volProduct, years, ter = 0, capital = 1000) {
  if (!inst?.leveraged || !Number.isFinite(volProduct) || !(years > 0)) return null;
  const L0 = Math.max(1, leverageOf(inst.name));
  const L = isInverseProduct(inst.name) ? -L0 : L0;
  const sigmaU = volProduct / L0;
  const rf = (state.settings.outlook?.riskFree ?? 2) / 100;
  const label = underlyingOf(inst.name)?.label || 'sottostante';
  const pts = [-0.2, -0.1, 0, 0.1, 0.2].map((m) => ({ m, r: leveredScenario({ L, sigmaU, years, move: m, rf, ter }) }));
  // variazione del sottostante che serve per andare in pari (ricerca numerica)
  let lo = -0.9, hi = 3;
  const f = (m) => leveredScenario({ L, sigmaU, years, move: m, rf, ter });
  if (f(lo) * f(hi) < 0) for (let k = 0; k < 60; k++) { const mid = (lo + hi) / 2; if (f(lo) * f(mid) <= 0) hi = mid; else lo = mid; }
  return { label, pts, breakeven: f(-0.9) * f(3) < 0 ? (lo + hi) / 2 : null, capital };
}
function leverScenariosHtml(sc, years) {
  if (!sc) return '';
  const fmtR = (r) => `<b class="${cls(r)}">${r > 0 ? '+' : ''}${(r * 100).toFixed(0)}%</b>`;
  return `<div class="muted small-note" title="Prodotto a leva con ribilanciamento giornaliero: risultato a ${horizonLong(years)} secondo la variazione del ${sc.label}, con la volatilità attuale. Anche con il sottostante fermo si perde per il decadimento da ribilanciamento.">${sc.label} a ${horizonShort(years)}: ${sc.pts.map((p) => `${p.m === 0 ? 'fermo' : `${p.m > 0 ? '+' : ''}${p.m * 100}%`} → ${fmtR(p.r)}`).join(' · ')}${sc.breakeven != null ? ` · pari se ${sc.label} ${sc.breakeven > 0 ? '+' : ''}${(sc.breakeven * 100).toFixed(1)}%` : ''}</div>`;
}
// Classifica «Netto più probabile»: periodi da 7 giorni a 5 anni, stesso algoritmo del Portafoglio sul capitale impostato.
// Tutti i periodi usano la stessa previsione: media tra prezzo obiettivo degli analisti e crescita dei fondamentali (per gli
// ETF: media ponderata sui titoli), previsioni verificate, sottostante dei leva. Fino a 90 giorni anche il trend se confermato;
// da 1 anno niente trend a breve. Più probabile = esito mediano (volatilità del periodo inclusa).
const NP_PERIODS = [[1, '1 gg'], [7, '7 gg'], [14, '14 gg'], [30, '30 gg'], [60, '60 gg'], [90, '90 gg'], [365, '1 anno'], [1095, '3 anni'], [1825, '5 anni']];
const npLabel = (d) => NP_PERIODS.find(([x]) => x === d)?.[1] || `${d} gg`;
const NP_KEYS = NP_PERIODS.map(([d]) => 'np' + d);
// Storico accanto alle previsioni: variazioni lorde del prezzo in EUR (le stesse grandezze dei grafici di Trade Republic),
// ordinabili toccando l'intestazione (prima il rendimento più alto).
const HIST_COLS = [
  ['hD', 'Oggi', 'Variazione del prezzo di oggi: dalla chiusura del giorno prima al prezzo attuale'],
  ['hW', '1 sett.', 'Variazione del prezzo nell’ultima settimana (dalla chiusura di 7 giorni fa)'],
  ['hW2', '14 gg', 'Variazione del prezzo negli ultimi 14 giorni (dalla chiusura di 14 giorni fa)'],
  ['hM', '1 mese', 'Variazione del prezzo nell’ultimo mese'],
  ['hY', '1 anno', 'Variazione del prezzo nell’ultimo anno'],
];
const HIST_KEYS = HIST_COLS.map(([k]) => k);
const simYears = () => state.settings.mc.years || 5;
const simCount = () => eur0(state.settings.mc.sims || 2000).slice(0, -2);
const npViewSort = (key) => /^np\d+$/.test(key) || HIST_KEYS.includes(key) || key === 'tScore' || key === SIM_KEY || key === SIM_P_KEY || /^pG\d+$/.test(key) || P90_KEYS.includes(key) || AN_KEYS.includes(key) || PX_KEYS.includes(key) || RANGE_KEYS.includes(key) || key === 'expected' || key === 'mgScore';
const npSortKey = () => (/^np\d+$/.test(state.view.sort.key) ? state.view.sort.key : 'np' + state.view.np);
// Titoli a centesimi (prezzo sotto 0,50 €): spread e liquidità rendono inaffidabile ogni previsione, quindi nessun netto più probabile
const PENNY_MIN_EUR = 0.5;
// Prezzo più probabile: variazione lorda del prezzo nel caso mediano, tolti i dividendi distribuiti nel periodo
// (escono dal prezzo: chi accumula li tiene nel fondo, le crypto non ne hanno). Restituisce il moltiplicatore del prezzo.
function priceFactor(inst, r, grossFactor, years) {
  if (!Number.isFinite(grossFactor) || !(grossFactor > 0)) return null;
  const pays = inst.type !== 'crypto' && distKind(inst) !== 'acc';
  const dy = pays ? Math.max(0, Math.min(0.08, r.sim?.distYield ?? r.sim?.divYield ?? 0)) : 0;
  return grossFactor * (1 - dy) ** years;
}
function npStats(inst, days) {
  const r = resOf(inst);
  if (!r || r.error) return null;
  if (inst.type === 'stock' && (state.quotes[inst.symbol]?.priceEur ?? Infinity) < PENNY_MIN_EUR) return null;
  const pp = projParams(inst, r, inst.type === 'stock');
  if (!pp) return null;
  const cap = state.settings.mc.amount || 10000;
  const y = days / 365;
  const ter = pp.ter || 0;
  const base = Number.isFinite(pp.cagrShort) ? pp.cagrShort : pp.cagr; // previsione analisti / verificata / sottostante
  let net;
  if (y < 1) {
    const rho = Number.isFinite(state.portfolio?.momRho) ? state.portfolio.momRho : null;
    net = autoShort({ base, ter, vol: pp.vol, mom: r.mom, years: y, view: pp.shortView, evidence: pp.evidence, rho }).net;
  } else {
    // il prezzo obiettivo degli analisti è a 12 mesi: vale per il primo anno; dopo, crescita di lungo periodo (fondamentali/modello)
    // ogni previsione vale per il suo orizzonte: prezzo obiettivo 12 mesi, previsioni verificate fino alla loro data
    const vy = Math.min(y, pp.shortView && Number.isFinite(pp.shortViewYears) ? pp.shortViewYears : 1);
    // dopo il primo anno: rendimento atteso del modello (pesa storico, equilibrio, analisti e fondamentali secondo l'affidabilità),
    // lo stesso della classifica a 5 anni; non il solo CAGR dai fondamentali
    const long = Number.isFinite(r.forward?.expected) && !state.view.scenario ? r.forward.expected : pp.cagr;
    const g = (1 + base - ter) ** vy * (1 + long - ter) ** (y - vy);
    net = g > 0 ? g ** (1 / y) - 1 : -0.99;
  }
  net = smoothNet(inst, days, net); // media mobile degli ultimi aggiornamenti: niente oscillazioni tra un ricalcolo e l'altro
  const h = projectShort({ cagr: net + ter, ter, tax: pp.tax, net, symTax: symTaxOfInst(inst), ...(state.portfolio?.taxPrudent ? { taxPrudent: true } : {}) }, cap, y, { vol: pp.vol, orderCost: state.settings.mc.orderCost ?? 1, positions: 1 });
  const med = Math.max(-cap, h.medianNet); // non si può perdere più del capitale investito
  const avg = Math.max(-cap, h.netGain);
  return { median: med / cap, mean: avg / cap, p: h.pProfit, pxF: priceFactor(inst, r, 1 + h.medianGross, y), p10Eur: h.p10Net != null ? Math.max(-cap, h.p10Net) : null, medianEur: med, meanEur: avg, rate: base, periodMove: h.mu, estimated: !!r.estimated, src: pp.shortSrc || null, dist: Number.isFinite(h.lnMean) ? { lnMean: h.lnMean, sigma: h.sigma, tax: Number.isFinite(pp.tax) ? pp.tax : 0.26, costs: h.costs / cap } : null };
}
// Chiave delle impostazioni che influenzano il «netto più probabile» (calcolata al massimo ogni 50 ms: serve a ogni riga)
let npCfgCache = { at: -1, key: '' };
function npCfgKey() {
  const now = performance.now();
  if (now - npCfgCache.at > 50) npCfgCache = { at: now, key: JSON.stringify([state.settings?.mc, state.settings?.outlook, state.portfolio?.momRho, state.portfolio?.taxPrudent, state.view.scenario]) };
  return npCfgCache.key;
}
// Liscio: il tasso netto annuo di ogni strumento/periodo è la media mobile esponenziale (30% al nuovo dato) dei valori delle
// ultime versioni dei dati. Dentro la stessa versione il valore non cambia (nessuna oscillazione tra un ridisegno e l'altro);
// al passaggio dai dati statici ai dati live si riparte dal valore live; se cambiano le impostazioni si riparte da zero.
const npSmooth = new Map();
function smoothNet(inst, days, raw) {
  if (!Number.isFinite(raw)) return raw;
  const live = !!state.liveVersion;
  const base = state.liveVersion || state.dataVersion || '';
  const ver = inst.type === 'crypto' ? `${base}|${Math.floor(Date.now() / 300e3)}` : base; // crypto: prezzi ogni minuto, valore ogni 5
  const cfg = npCfgKey();
  const key = `${inst.symbol}|${days}`;
  const e = npSmooth.get(key);
  if (!e || e.cfg !== cfg || (live && !e.live)) {
    npSmooth.set(key, { ver, cfg, live, s: raw });
    return raw;
  }
  if (e.ver !== ver) {
    e.s = ema(e.s, raw, 0.3);
    e.ver = ver;
  }
  return e.s;
}
// Memoria dei valori per strumento: si ricalcolano solo quando cambiano i dati dello strumento (nuovo oggetto risultato) o
// le impostazioni. Ogni periodo si calcola solo quando serve (ordinamento: tutti; colonne: solo le righe mostrate).
const npMemo = new WeakMap();
function npCached(inst, d) {
  const r = state.results[inst.symbol];
  if (!r || r.error) return null;
  const key = `${npCfgKey()}|${state.liveVersion}`;
  let m = npMemo.get(r);
  if (!m || m.key !== key) npMemo.set(r, (m = { key, v: new Map() }));
  if (!m.v.has(d)) m.v.set(d, npStats(inst, d));
  return m.v.get(d);
}
// Guadagno bilanciato crescita/rischio e guadagno corretto per il rischio sulla distribuzione del modello delle previsioni
// (1 e 3 anni): si calcola solo quando serve e resta in memoria insieme alla previsione del periodo.
function rgCached(inst, d) {
  const x = npCached(inst, d);
  if (!x || !x.dist) return null;
  if (x.rg === undefined) x.rg = riskGain(x.dist);
  return x.rg;
}
// Posizioni stabili della classifica per periodo: si aggiornano solo con una nuova versione dei dati e chi si sposta di poco
// (meno del 20% della propria posizione) resta dov'era. Valgono per tutti gli strumenti; le schede filtrano da qui.
const npStable = new Map();
function stablePositions(days) {
  const ver = `${state.liveVersion || state.dataVersion || ''}|${state.instruments.length}`;
  const cfg = npCfgKey();
  const st = npStable.get(days);
  if (st && st.ver === ver && st.cfg === cfg) return st.pos;
  const arr = [];
  for (const i of state.instruments) {
    const v = npCached(i, days)?.median;
    if (Number.isFinite(v)) arr.push([i.symbol, v]);
  }
  arr.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  const pos = stabilizeRanks(arr.map((x) => x[0]), st && st.cfg === cfg ? st.pos : null);
  npStable.set(days, { ver, cfg, pos });
  return pos;
}
const shortMode = () => state.view.funnel === 'short' || state.view.funnel === 'solid' || state.view.funnel === 'analyst' || state.view.funnel === 'watch';
// Sezione «Watch list»: stesse colonne di «Netto più probabile», solo gli strumenti preferiti (aggiunti con «Condividi» dalla scheda).
// La lista è salvata in questo browser; ogni voce ricorda data e prezzo di quando è stata aggiunta.
const watchMode = () => state.view.funnel === 'watch';
let watchList = (() => {
  try {
    return parseWatch(localStorage.getItem(WATCH_KEY));
  } catch {
    return [];
  }
})();
let watchSet = new Set(watchList.map((x) => x.symbol));
const watchItem = (symbol) => (watchSet.has(symbol) ? watchList.find((x) => x.symbol === symbol) : null);
function setWatch(list) {
  watchList = list;
  watchSet = new Set(list.map((x) => x.symbol));
  try {
    localStorage.setItem(WATCH_KEY, JSON.stringify(list));
  } catch {
    /* memoria del browser non disponibile: la lista vale fino alla chiusura della pagina */
  }
}
const watchWhen = (t) => (t ? new Date(t).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');
const watchSince = (w, price) => `in Watch list dal ${watchWhen(w.at)}${w.px ? ` · prezzo allora ${pxFmt(w.px, w.px)}${price > 0 ? `, ora ${pxFmt(price, price)} (${pct(price / w.px - 1, true, 1)})` : ''}` : ''}`;
// Sezione «Analisti e dividendi»: stesse colonne di «Netto più probabile», con davanti il potenziale secondo gli analisti
// (prezzo obiettivo a 12 mesi) e il rendimento da dividendi; classifica per potenziale, poi per dividendo (consensus.js).
const analystMode = () => state.view.funnel === 'analyst';
function consensusValues(i, r) {
  const fw = r && !r.error ? r.forward : null;
  if (!fw) return { anUp: null, anN: null, anReco: null, anWarn: false, divY: null, divAcc: false };
  const stock = i.type === 'stock';
  // azioni: prezzo obiettivo medio ÷ prezzo − 1; ETF non a leva: media ponderata sui titoli del fondo
  const up = stock ? fw.tgtUp ?? fw.targetUpside ?? null : i.type === 'etf' && !i.leveraged ? fw.upside ?? fw.analystUpside ?? null : null;
  const n = stock && up != null ? fw.tgtN ?? fw.targetAnalysts ?? null : null;
  // dubbio: pochi analisti, rialzo oltre il +100%, oppure ETF fermo al tetto del +50% per titolo (non è una stima)
  const warn = up != null && (stock ? doubtfulTarget(up, n) : up >= ETF_UPSIDE_CAP);
  // dividendo: azioni = dichiarato dalla fonte; ETF = solo se distribuisce (dichiarato, altrimenti quello usato dal modello);
  // un ETF ad accumulazione non paga nulla all'investitore (reinveste), le crypto non hanno dividendi
  const acc = i.type !== 'stock' && i.type !== 'crypto' && distKind(i) === 'acc';
  const dist = r.sim?.distYield > 0 ? r.sim.distYield : null;
  const div = i.type === 'crypto' ? null : fw.divRaw ?? (stock || acc ? null : dist);
  return { anUp: up, anN: n, anReco: stock && up != null ? fw.reco ?? null : null, anWarn: warn, divY: div, divAcc: acc };
}
// Colonne aggiunte alle sezioni «Netto più probabile»: rendimento atteso annuo (tutti gli strumenti, crypto comprese),
// dividendo annuo (azioni ed ETF a distribuzione) e potenziale secondo gli analisti; in «Analisti e dividendi» il potenziale va per primo.
const AN_COLS = {
  expected: ['Rendimento atteso', 'Rend. atteso', 'Lo stesso «Rendimento atteso» della scheda dello strumento: rendimento annuo atteso dal modello per i prossimi anni, lordo (prima di costi e imposte): pesa storico, equilibrio di mercato, analisti e fondamentali secondo la loro affidabilità. Vale per azioni, ETF e criptovalute. È una stima, non una garanzia. Tocca per ordinare dal più alto.'],
  divY: ['Rendimento da dividendi', 'Rend. dividendi', 'Lo stesso «Rendimento da dividendi» della scheda dello strumento: annuo, lordo (imposta 26% all’incasso). Azioni ed ETF a distribuzione lo pagano; gli ETF ad accumulazione lo reinvestono nel fondo («accumula») e non pagano nulla; le criptovalute non hanno dividendi. ⚠ oltre il 12% è quasi sempre un dividendo straordinario o un dato anomalo: non si ripete ogni anno, e in classifica viene dopo i dividendi ordinari. Tocca per ordinare dal più alto.'],
  anUp: ['Potenziale analisti 12 mesi', 'Analisti 12m', 'Potenziale secondo gli analisti: prezzo obiettivo medio a 12 mesi rispetto al prezzo (per gli ETF: media ponderata sui titoli del fondo). Sotto: numero di analisti e giudizio prevalente; ⚠ con meno di 3 analisti, o con un rialzo oltre il +100%, il valore è poco attendibile. È una stima degli analisti, non del modello, e non è una garanzia. Tocca per ordinare dal più alto: prima i valori attendibili, poi quelli con ⚠; a parità, o senza analisti, vale il dividendo.'],
};
const anOrder = () => (analystMode() ? ['anUp', 'divY', 'expected'] : ['expected', 'divY', 'anUp']);
function anHeads() {
  return anOrder().map((k) => {
    const [l, s, tip] = AN_COLS[k];
    const th = document.createElement('th');
    const on = state.view.sort.key === k;
    th.className = 'num an-col' + (on ? ' sorted' : '');
    th.dataset.sort = k;
    th.title = tip;
    th.innerHTML = `<span class="l">${l}</span><span class="s">${s}</span>${on ? (state.view.sort.dir < 0 ? ' ▼' : ' ▲') : ''}`;
    return th;
  });
}
// Sul telefono le colonne degli indicatori sono fuori schermo: gli stessi tre valori compaiono sotto il nome dello strumento
const npNow = () => npLabel(state.view.np); // periodo scelto nella barra
const pxFmt = (x, ref) => (x == null || !Number.isFinite(x) ? '–' : Math.abs(x).toLocaleString('it-IT', { minimumFractionDigits: ref >= 1 ? 2 : 4, maximumFractionDigits: ref >= 1 ? 2 : 4 }) + ' €');
const eurDiff = (x, ref) => (x > 0 ? '+' : x < 0 ? '−' : '') + pxFmt(x, ref);
function pxHeads() {
  const l = npNow();
  return [
    ['price', 'Prezzo attuale', 'Prezzo', 'Ultimo prezzo in EUR. Tocca per ordinare.'],
    ['pxMed', `Prezzo più probabile ${l}`, `Più prob. ${l}`, `Prezzo più probabile a ${l} secondo il modello: valore mediano della previsione (metà dei casi sopra, metà sotto), prima di costi e imposte, tolti i dividendi distribuiti nel periodo. Il periodo è quello scelto nella barra qui sopra. Non è una garanzia. Tocca per ordinare.`],
    ['pxDiff', `Differenza ${l}`, `Diff. ${l}`, `Differenza tra il prezzo più probabile a ${l} e il prezzo attuale, in percentuale e in euro per quota. Positiva = il modello vede il prezzo più in alto; negativa = più in basso. Tocca per ordinare dalla più alta.`],
  ].map(([k, lab, s, tip]) => {
    const th = document.createElement('th');
    const on = state.view.sort.key === k;
    th.className = 'num px-col' + (on ? ' sorted' : '');
    th.dataset.sort = k;
    th.title = tip;
    th.innerHTML = `<span class="l">${lab}</span><span class="s">${s}</span>${on ? (state.view.sort.dir < 0 ? ' ▼' : ' ▲') : ''}`;
    return th;
  });
}
// Differenze sul minimo, in percentuale del minimo: prezzo medio − minimo a 52 settimane e a 90 giorni, e prezzo più
// probabile a 6 mesi − minimo a 52 settimane. Sotto la percentuale, i due prezzi da cui nasce.
// data e ora dei dati a cui si riferisce il prezzo attuale
const dataWhen = () => { const t = state.liveVersion || state.dataVersion; const d = t ? new Date(t) : null; return d && !Number.isNaN(d.getTime()) ? d.toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''; };
const SPREAD_TIPS = {
  pm6Now: 'Di quanto il prezzo più probabile a 6 mesi secondo il modello sta sopra (o sotto) il prezzo attuale: (prezzo più probabile a 6 mesi − prezzo attuale) ÷ prezzo attuale. Il prezzo attuale è quello dell’ultimo aggiornamento dei dati. Il prezzo più probabile è una stima, non una garanzia.',
  sA52: 'Di quanto il prezzo medio delle ultime 52 settimane sta sopra il minimo delle stesse 52 settimane: (medio − minimo) ÷ minimo.',
  sA90: 'Di quanto il prezzo medio degli ultimi 90 giorni sta sopra il minimo degli stessi 90 giorni: (medio − minimo) ÷ minimo.',
  pm6L52: 'Di quanto il prezzo più probabile a 6 mesi secondo il modello sta sopra il minimo delle ultime 52 settimane: (prezzo più probabile a 6 mesi − minimo) ÷ minimo. Il prezzo più probabile è una stima, non una garanzia.',
};
function rangeHeads() {
  return SPREAD_COLS.map(([k, l, s]) => {
    const th = document.createElement('th');
    const on = state.view.sort.key === k;
    th.className = 'num rg-col' + (on ? ' sorted' : '');
    th.dataset.sort = k;
    th.title = `${SPREAD_TIPS[k]}${k === 'pm6Now' && dataWhen() ? ` Dati aggiornati al ${dataWhen()}.` : ''} Prezzi di chiusura in EUR, prezzo attuale compreso, non aggiustati per i dividendi (come nei grafici di Trade Republic); il minimo è sulle chiusure, non sui minimi di giornata. Tocca per ordinare dal valore più alto.`;
    th.innerHTML = `<span class="l">${l}</span><span class="s">${s}</span>${on ? (state.view.sort.dir < 0 ? ' ▼' : ' ▲') : ''}`;
    return th;
  });
}
function rangeCells(r) {
  // [nome del prezzo in alto, prezzo in alto, prezzo di riferimento, nome del riferimento]
  const pair = { pm6Now: ['6 mesi', r.pm6, r.price, 'ora'], sA52: ['medio', r.avg52, r.min52, 'min'], sA90: ['medio', r.avg90, r.min90, 'min'], pm6L52: ['6 mesi', r.pm6, r.min52, 'min'] };
  return SPREAD_COLS.map(([k, l]) => {
    const x = r[k];
    const [name, top, low, ref] = pair[k];
    if (x == null || top == null || low == null) return `<td class="num rg-col muted" title="${l}: non disponibile (storico troppo corto, previsione mancante o dati non ancora arrivati)">–</td>`;
    return `<td class="num rg-col ${cls(x)}" title="${l}: ${pct(x, true, 1)} · ${name} ${pxFmt(top, r.price)}, ${ref === 'ora' ? 'prezzo attuale' : 'minimo'} ${pxFmt(low, r.price)}${ref === 'ora' ? (dataWhen() ? ` (dati del ${dataWhen()})` : '') : ` (prezzo attuale ${pxFmt(r.price, r.price)})`}."><b class="big">${pct(x, true, 1)}</b><span class="eur">${name} ${pxFmt(top, r.price)} · ${ref} ${pxFmt(low, r.price)}</span></td>`;
  }).join('');
}
// Max Growth Score (lo stesso della sezione «Max Growth»): rendimento annuo del punteggio e guadagno netto corrispondente
function mgNet(r) {
  if (r.maxGrowth == null) return null;
  const amt = state.settings.mc.amount || 10000;
  const yrs = state.settings.mc.years || 5;
  const tr = state.results[r.inst?.symbol]?.sim?.taxRate;
  const tx = Number.isFinite(tr) ? tr / 100 : 0.26;
  const g = amt * ((1 + r.maxGrowth) ** yrs - 1);
  return { net: Math.round(g > 0 ? g * (1 - tx) : g), yrs, amt };
}
function mgHead() {
  const th = document.createElement('th');
  const on = state.view.sort.key === 'mgScore';
  th.className = 'num mg-col' + (on ? ' sorted' : '');
  th.dataset.sort = 'mgScore';
  th.title = 'Max Growth Score, lo stesso della sezione «Max Growth»: ½ rendimento storico + ½ rendimento atteso, con correzioni per strategia, mercato globale, andamento recente, volatilità e concentrazione. In grande il guadagno netto corrispondente sul capitale impostato; sotto il rendimento annuo del punteggio. Vale per ETF e azioni. Tocca per ordinare dal più alto.';
  th.innerHTML = `<span class="l">Max Growth Score</span><span class="s">Max Growth</span>${on ? (state.view.sort.dir < 0 ? ' ▼' : ' ▲') : ''}`;
  return th;
}
function mgCell(r) {
  const m = mgNet(r);
  if (!m) return '<td class="num mg-col muted" title="Max Growth Score non disponibile per questo strumento (vale per ETF e azioni con previsione)">–</td>';
  return `<td class="num mg-col ${cls(r.maxGrowth)}" title="Max Growth Score: ${pct(r.maxGrowth, true, 2)} l'anno, pari a ${m.net > 0 ? '+' : ''}${eur0(m.net)} netti in ${m.yrs} anni su ${eur0(m.amt)}."><b class="big">${m.net > 0 ? '+' : ''}${eur0(m.net)}</b><span class="eur">${pct(r.maxGrowth, true, 1)}/anno</span></td>`;
}
// Rischio e guadagno pesato per il rischio, gli stessi indicatori della scheda dello strumento: perdita nello stress test,
// guadagno netto efficiente, guadagno bilanciato crescita/rischio e guadagno corretto per il rischio a 1, 3 e 5 anni.
const rgShort = (d) => (d === 1825 ? `${simYears()}a` : d === 365 ? '1a' : '3a');
const rgLong = (d, l) => (d === 1825 ? `${simYears()} anni` : l);
const rgSrc = (d) => (d === 1825 ? `sui ${simCount()} scenari simulati, come nella scheda dello strumento` : 'sulla distribuzione del modello delle previsioni (lo stesso del netto più probabile)');
const asymOf = (x, published = null) => (!x || x.median == null || x.finalLoss == null ? null : Number.isFinite(published) ? published : x.median > 0 ? x.finalLoss / x.median : Infinity);
const asymFmt = (x) => (x == null ? '–' : Number.isFinite(x) ? nf2.format(x) : '∞');
function riskHeads() {
  const cols = [
    ['stress', 'Perdita in stress test', 'Stress test', 'Perdita temporanea stimata se il mercato azionario scende del 30% (recessione / bear market): beta dello strumento × 30%, sul capitale impostato; sotto, la correzione fisiologica (mercato −10%). È lo stesso stress test della scheda dello strumento («Valutazione del rischio»). Senza beta si usa 1. Non vale per le criptovalute. È uno scenario, non una previsione. Tocca per ordinare dalla perdita più piccola.'],
    ['effNet', `Guadagno netto efficiente ${simYears()}a`, `Netto effic. ${simYears()}a`, `Lo stesso «Guadagno netto efficiente» della scheda dello strumento: guadagno sicuro che vale quanto l’insieme incerto dei ${simCount()} scenari a ${simYears()} anni (equivalente certo), al netto di imposte e costi, sul capitale impostato. Più rischio = valore più basso a parità di guadagno medio. Tocca per ordinare dal più alto.`],
    ...RG_PERIODS.map(([d, l]) => [balKey(d), `Guadagno bilanciato crescita/rischio ${rgLong(d, l)}`, `Bilanciato ${rgShort(d)}`, `Lo stesso «Guadagno bilanciato crescita/rischio» della scheda dello strumento, a ${rgLong(d, l)}: guadagni attesi (quelli estremi, oltre il 75° percentile, pesano sempre meno) − 2,25 × perdite attese, su tutti gli scenari, ${rgSrc(d)}. Una perdita pesa 2,25 volte un guadagno della stessa entità. Sotto, il valore in euro sul capitale impostato. Tocca per ordinare dal più alto.`]),
    ...RG_PERIODS.map(([d, l]) => [radjKey(d), `Guadagno corretto per il rischio ${rgLong(d, l)}`, `Corr. rischio ${rgShort(d)}`, `Lo stesso «Guadagno corretto per il rischio» della scheda dello strumento, a ${rgLong(d, l)}: guadagno tipico (mediano) − perdita finale nel caso sfavorevole (5% peggiore degli scenari), ${rgSrc(d)}. Sotto, il valore in euro sul capitale impostato. Tocca per ordinare dal più alto.`]),
    ...RG_PERIODS.map(([d, l]) => [asymKey(d), `Asimmetria del rischio ${rgLong(d, l)}`, `Asimmetria ${rgShort(d)}`, `La stessa «Asimmetria del rischio» della scheda dello strumento, a ${rgLong(d, l)}: perdita finale nel caso sfavorevole (5% peggiore degli scenari) ÷ guadagno tipico (mediano), ${rgSrc(d)}. Sotto 1 (✓) il guadagno tipico è più grande della perdita sfavorevole; da 1 in su (⚠) la perdita sfavorevole pesa di più; ∞ se il guadagno tipico non è positivo. Più basso = meglio. Tocca per ordinare dal più basso.`]),
  ];
  return cols.map(([k, lab, s, tip]) => {
    const th = document.createElement('th');
    const on = state.view.sort.key === k;
    th.className = 'num rk-col' + (on ? ' sorted' : '');
    th.dataset.sort = k;
    th.title = tip;
    th.innerHTML = `<span class="l">${lab}</span><span class="s">${s}</span>${on ? (state.view.sort.dir < 0 ? ' ▼' : ' ▲') : ''}`;
    return th;
  });
}
const sEur = (x) => `${x > 0 ? '+' : x < 0 ? '−' : ''}${eur0(Math.abs(x))}`;
function riskCells(r) {
  const amt = state.settings.mc.amount || 10000;
  const out = [];
  if (r.stress == null) out.push('<td class="num rk-col muted" title="Stress test non disponibile per questo strumento (criptovalute o previsione mancante)">–</td>');
  else out.push(`<td class="num rk-col ${r.stress > 0 ? 'neg' : ''}" title="Se il mercato azionario scende del 30%: perdita temporanea stimata ${pct(r.stress, false, 1)} = ${eur0(r.stress * amt)} su ${eur0(amt)} (beta ${r.stressBeta != null ? nf2.format(r.stressBeta) : 'non disponibile: usato 1,00'} × 30%). Con una correzione del 10%: ${pct(r.stressMild, false, 1)} = ${eur0(r.stressMild * amt)}. Scenario, non previsione."><b class="big">${r.stress > 0 ? '−' : ''}${eur0(r.stress * amt)}</b><span class="eur">${r.stress > 0 ? '−' : ''}${pct(r.stress, false, 1)} · corr. ${r.stressMild > 0 ? '−' : ''}${pct(r.stressMild, false, 1)}</span></td>`);
  if (r.effNet == null) out.push('<td class="num rk-col muted" title="Guadagno netto efficiente non disponibile: mancano gli scenari simulati per questo strumento">–</td>');
  else out.push(`<td class="num rk-col ${cls(r.effNet)}" title="Guadagno netto efficiente a ${simYears()} anni: ${sEur(r.effNet)} su ${eur0(amt)} (${pct(r.plausible, true, 1)}): equivalente certo dei ${simCount()} scenari, dopo imposte e costi."><b class="big">${sEur(r.effNet)}</b><span class="eur">${pct(r.plausible, true, 1)}</span></td>`);
  for (const [d, l] of RG_PERIODS) {
    const x = r['rg' + d];
    out.push(!x || x.balanced == null ? `<td class="num rk-col muted" title="Guadagno bilanciato a ${rgLong(d, l)} non disponibile (previsione o volatilità mancante)">–</td>` : `<td class="num rk-col ${cls(x.balanced)}" title="Guadagno bilanciato crescita/rischio a ${rgLong(d, l)}: guadagni attesi ${pct(x.expGain, true)} − 2,25 × perdite attese ${pct(x.expLoss)} = ${pct(x.balanced, true)} (${sEur(x.balanced * amt)} su ${eur0(amt)}), ${rgSrc(d)}."><b class="big">${pct(x.balanced, true, 1)}</b><span class="eur">${sEur(x.balanced * amt)}</span></td>`);
  }
  for (const [d, l] of RG_PERIODS) {
    const x = r['rg' + d];
    out.push(!x || x.riskAdj == null ? `<td class="num rk-col muted" title="Guadagno corretto per il rischio a ${rgLong(d, l)} non disponibile (previsione o volatilità mancante)">–</td>` : `<td class="num rk-col ${cls(x.riskAdj)}" title="Guadagno corretto per il rischio a ${rgLong(d, l)}: guadagno tipico ${pct(x.median, true)} − perdita finale sfavorevole ${pct(x.finalLoss)} = ${pct(x.riskAdj, true)} (${sEur(x.riskAdj * amt)} su ${eur0(amt)}), ${rgSrc(d)}."><b class="big">${pct(x.riskAdj, true, 1)}</b><span class="eur">${sEur(x.riskAdj * amt)}</span></td>`);
  }
  for (const [d, l] of RG_PERIODS) {
    const x = r['rg' + d];
    const v = r[asymKey(d)];
    out.push(v == null ? `<td class="num rk-col muted" title="Asimmetria del rischio a ${rgLong(d, l)} non disponibile (previsione o volatilità mancante)">–</td>` : `<td class="num rk-col ${v < 1 ? 'pos' : 'neg'}" title="Asimmetria del rischio a ${rgLong(d, l)}: perdita nel 5% peggiore −${pct(x.finalLoss)} contro guadagno tipico ${pct(x.median, true)} (rapporto ${asymFmt(v)}), ${rgSrc(d)}. ${v < 1 ? 'Sotto 1: il guadagno tipico supera la perdita sfavorevole.' : 'Da 1 in su: la perdita sfavorevole pesa più del guadagno tipico.'}"><b class="big">${asymFmt(v)}</b><span class="eur">${v < 1 ? '✓' : '⚠'} −${pct(x.finalLoss, false, 0)} / ${pct(x.median, true, 0)}</span></td>`);
  }
  return out.join('');
}
function pxCells(r) {
  const now = r.price;
  const med = r.pxMed;
  const d = r.pxDiff;
  const c1 = `<td class="num px-col">${pxFmt(now, now)}</td>`;
  if (med == null || d == null || now == null) return c1 + '<td class="num px-col muted" title="Prezzo più probabile non disponibile: manca la previsione per questo strumento">–</td><td class="num px-col muted">–</td>';
  const l = npNow();
  return `${c1}<td class="num px-col" title="Prezzo più probabile a ${l}: ${pxFmt(med, now)} (ora ${pxFmt(now, now)}). Valore mediano della previsione, prima di costi e imposte, tolti i dividendi distribuiti nel periodo."><b class="big">${pxFmt(med, now)}</b></td><td class="num px-col ${cls(d)}" title="A ${l} il prezzo più probabile è ${pct(d, true, 2)} rispetto a ora (${eurDiff(med - now, now)} per quota)."><b class="big">${pct(d, true, 1)}</b><span class="eur">${eurDiff(med - now, now)}</span></td>`;
}
function mInd(r) {
  const div = r.divY != null ? `${pct(r.divY, false, 1)}${r.divY > DIV_EXTREME ? ' ⚠' : r.divAcc ? ' (accumula)' : ''}` : r.divAcc ? 'accumula' : '–';
  const px = r.price != null && r.pxMed != null ? `Prezzo <b>${pxFmt(r.price, r.price)}</b> → <b>${pxFmt(r.pxMed, r.price)}</b> a ${npNow()} (<b class="${cls(r.pxDiff)}">${pct(r.pxDiff, true, 1)}</b>)` : r.price != null ? `Prezzo <b>${eur(r.price)}</b>` : null;
  const parts = [...(px ? [px] : []), `Rendimento atteso <b class="${cls(r.expected)}">${r.expected != null ? pct(r.expected, true, 1) : '–'}</b>`, `Rend. da dividendi <b>${div}</b>`];
  { const w = watchItem(r.inst?.symbol); if (w) parts.unshift(`⭐ ${watchSince(w, r.price)}`); }
  if (r.anUp != null) parts.push(`Analisti <b class="${cls(r.anUp)}">${pct(r.anUp, true, 0)}${r.anWarn ? ' ⚠' : ''}</b>`);
  { const m = mgNet(r); if (m) parts.push(`Max Growth <b class="${cls(r.maxGrowth)}">${m.net > 0 ? '+' : ''}${eur0(m.net)}</b> (${pct(r.maxGrowth, true, 1)}/anno)`); }
  if (r.avg52 != null) parts.push(`52 sett.: medio <b>${pxFmt(r.avg52, r.price)}</b> · minimo <b>${pxFmt(r.min52, r.price)}</b>`);
  if (r.avg90 != null) parts.push(`90 gg: medio <b>${pxFmt(r.avg90, r.price)}</b> · minimo <b>${pxFmt(r.min90, r.price)}</b>`);
  if (r.pm6Now != null) parts.push(`6 mesi: più probabile <b>${pxFmt(r.pm6, r.price)}</b>, <b class="${cls(r.pm6Now)}">${pct(r.pm6Now, true, 1)}</b> sul prezzo attuale${r.pm6L52 != null ? `, <b class="${cls(r.pm6L52)}">${pct(r.pm6L52, true, 1)}</b> sul minimo 52 sett.` : ''}`);
  {
    const amt = state.settings.mc.amount || 10000;
    const three = (key) => RG_PERIODS.map(([d]) => { const x = r['rg' + d]?.[key]; return `${rgShort(d)} <b class="${cls(x)}">${x != null ? pct(x, true, 1) : '–'}</b>`; }).join(' · ');
    if (r.stress != null || r.effNet != null) parts.push(`${r.stress != null ? `Stress test (mercato −30%) <b class="${r.stress > 0 ? 'neg' : ''}">${r.stress > 0 ? '−' : ''}${eur0(r.stress * amt)}</b>` : ''}${r.stress != null && r.effNet != null ? ' · ' : ''}${r.effNet != null ? `Guadagno netto efficiente ${simYears()}a <b class="${cls(r.effNet)}">${sEur(r.effNet)}</b>` : ''}`);
    if (RG_PERIODS.some(([d]) => r['rg' + d])) {
      parts.push(`Guadagno bilanciato crescita/rischio: ${three('balanced')}`);
      parts.push(`Guadagno corretto per il rischio: ${three('riskAdj')}`);
      parts.push(`Asimmetria del rischio: ${RG_PERIODS.map(([d]) => { const v = r[asymKey(d)]; return `${rgShort(d)} <b class="${v == null ? '' : v < 1 ? 'pos' : 'neg'}">${asymFmt(v)}</b>`; }).join(' · ')}`);
    }
    if (r.probLoss != null) parts.push(`Probabilità ${simYears()}a: perdita <b>${pct(r.probLoss, false, 0)}</b>${r.prob50 != null ? ` · guadagno &gt; 50% <b>${pct(r.prob50, false, 0)}</b>` : ''}`);
  }
  return `<span class="m-ind" title="Prezzo attuale → prezzo più probabile al periodo scelto (differenza) · rendimento atteso annuo del modello (lordo) · rendimento da dividendi annuo (lordo; gli ETF ad accumulazione reinvestono) · potenziale secondo gli analisti a 12 mesi">${parts.join('<br>')}</span>`;
}
function anCells(r) {
  const up = r.anUp;
  const few = r.anN != null && r.anN < AN_MIN_RELIABLE;
  const who = r.anN != null ? `${r.anN} ${r.anN === 1 ? 'analista' : 'analisti'}` : 'titoli del fondo';
  const reco = recoLabel(r.anReco);
  const odd = r.divY != null && r.divY > DIV_EXTREME;
  const cells = {
    anUp: up == null
      ? '<td class="num an-col muted" title="Nessun prezzo obiettivo degli analisti disponibile per questo strumento">–</td>'
      : `<td class="num an-col ${cls(up)}" title="Prezzo obiettivo medio a 12 mesi: ${pct(up, true, 1)} rispetto al prezzo · ${who}${reco ? ' · giudizio prevalente: ' + reco : ''}.${few ? ' Pochi analisti: valore poco attendibile.' : ''}${up > AN_EXTREME ? ' Rialzo oltre il +100%: spesso il prezzo obiettivo non è aggiornato dopo un evento straordinario (per esempio un maxi-dividendo che ha fatto scendere il prezzo): controlla la data della stima.' : ''}${r.anN == null && r.anWarn ? ' Valore al tetto del +50% per titolo: non è una stima attendibile.' : ''} Stima degli analisti, non del modello: non è una garanzia."><b class="big">${pct(up, true, 0)}</b><span class="eur">${r.anWarn ? '⚠ ' : ''}${who}${reco ? ' · ' + reco : ''}</span></td>`,
    divY: r.divY == null
      ? r.divAcc
        ? '<td class="num an-col muted" title="ETF ad accumulazione: reinveste i dividendi nel fondo e non paga nulla all’investitore">accumula</td>'
        : '<td class="num an-col muted" title="Nessun dividendo dichiarato per questo strumento">–</td>'
      : `<td class="num an-col" title="Rendimento da dividendi annuo: ${pct(r.divY, false, 2)} lordo (imposta 26% all’incasso).${odd ? ' Oltre il 12%: quasi sempre un dividendo straordinario o un dato anomalo, non si ripete ogni anno.' : ''}"><b class="big">${pct(r.divY, false, 1)}</b>${odd ? '<span class="eur">⚠ straordinario?</span>' : r.divAcc ? '<span class="eur">accumula: reinvestito</span>' : ''}</td>`,
    expected: r.expected == null
      ? '<td class="num an-col muted" title="Rendimento atteso non disponibile: storico insufficiente per una stima">–</td>'
      : `<td class="num an-col ${cls(r.expected)}" title="Rendimento annuo atteso dal modello: ${pct(r.expected, true, 2)} lordo, prima di costi e imposte. È una stima, non una garanzia."><b class="big">${pct(r.expected, true, 1)}</b></td>`,
  };
  return anOrder().map((k) => cells[k]).join('');
}
// Sezione «Solidi e in crescita»: stesse colonne di «Netto più probabile», ma solo gli strumenti con netto più probabile
// positivo e alto a 1, 3 e 5 anni e prezzo in crescita di recente (regole in solid.js). Prima lo storico (immediato), poi le previsioni.
const solidMode = () => state.view.funnel === 'solid';
function solidOf(i) {
  const h = histValues(i, state.quotes[i.symbol]);
  if (!solidRecent(h)) return false;
  return solidPass({ y1: npCached(i, 365)?.median, y3: npCached(i, 1095)?.median, y5: npCached(i, 1825)?.median }, h);
}
function projParams(i, r, growthForward = false, cagrOverride = null) {
  // Per le azioni, su richiesta (sezione portafoglio), si usa il CAGR fondamentale forward (crescita utili
  // + dividendo + valutazione: prospettive di crescita aggiornate, come nel metodo Gemini) invece del
  // rendimento atteso prudenziale mescolato con l'equilibrio CAPM. Con uno scenario selezionato si usa il
  // CAGR fisso dello scenario per tutti gli strumenti.
  let cagr = growthForward && Number.isFinite(r?.forward?.fundExpected) ? r.forward.fundExpected : r?.forward?.expected;
  if (Number.isFinite(cagrOverride)) cagr = cagrOverride;
  if (!Number.isFinite(cagr)) return null;
  const tax = Number.isFinite(r?.sim?.taxRate) ? r.sim.taxRate / 100 : 0.26;
  const ter = Number.isFinite(r?.fund?.ter) ? r.fund.ter : DEFAULT_TER[i.type] ?? 0; // TER reale del fondo se noto
  const div = i.type === 'etf' && Number.isFinite(r?.sim?.distYield) && r.sim.distYield > 0 ? r.sim.distYield : 0; // ETF a distribuzione
  // Azioni ed ETF con prezzo obiettivo degli analisti (per gli ETF: media ponderata dei titoli in portafoglio): a breve termine
  // la previsione è la media tra prezzo obiettivo (previsione diretta sul prezzo a 12 mesi) e crescita dei fondamentali.
  const target = (i.type === 'stock' || (i.type === 'etf' && !i.leveraged)) && Number.isFinite(r?.forward?.upside) ? r.forward.upside : null;
  // Il prezzo obiettivo non si prende per intero (public/js/analysts.js): si corregge se in ritardo rispetto al prezzo, si crede solo
  // metà del rialzo e pesa secondo il numero di analisti; il resto del peso va al rendimento atteso del modello (che include lo storico).
  const model = Number.isFinite(r?.forward?.expected) && !Number.isFinite(cagrOverride) ? r.forward.expected : cagr;
  const av = target != null ? analystView({ upside: target, analysts: i.type === 'stock' ? r.forward.analysts ?? r.forward.analystCount ?? 3 : null, mom26: r.mom?.w26, haircut: (state.settings.outlook?.analystHaircut ?? 0.5) }) : null;
  // Previsione più affidabile: MEDIANA PONDERATA per affidabilità di analisti, fondamentali e modello (regola fissa)
  const fundV = Number.isFinite(r?.forward?.fundExpected) && !Number.isFinite(cagrOverride) ? r.forward.fundExpected : null;
  const comb = av || fundV != null ? combineForecasts({ analyst: av, fundamentals: fundV, evidence: r?.forward?.evidence, model, estimated: !!r?.estimated }) : null;
  const sp = shortPrior(i, comb && Number.isFinite(comb.value) ? comb.value : cagr);
  if (comb && comb.parts.length > 1 && !sp.src) sp.src = `mediana ponderata per affidabilità di: ${comb.parts.map((x) => `${x.id} ${pct(x.value, true, 1)} (peso ${nf2.format(x.weight)})`).join(' · ')}${av ? ` — prezzo obiettivo ${pct(target, true, 1)}${i.type === 'etf' ? ' (media dei titoli del fondo)' : r.forward.analysts ? `, ${r.forward.analysts} analisti` : ''}${av.stale ? ', in ritardo sul prezzo (mosso molto in 6 mesi)' : ''}` : ''}`;
  // previsione SPECIFICA dello strumento (consenso analisti / stime sui titoli dell'ETF), non il solo rendimento di mercato
  const gs = r?.forward?.growthSource;
  const evidence = i.leveraged ? !!underlyingView(i)?.ev : !r?.estimated && (gs === 'own' || gs === 'holdings'); // leva: previsioni del sottostante
  // rendimenti misurati sui prezzi reali del prodotto: TER già incluso, si somma per non toglierlo due volte
  return { cagr, cagrShort: sp.netOfTer ? sp.cagr + ter : sp.cagr, shortSrc: sp.src, shortView: !!sp.view, shortViewYears: sp.viewYears ?? null, evidence, ter, tax, net: cagr - ter, div, mdd: Number.isFinite(r?.sim?.histMdd) ? r.sim.histMdd : null,
    // volatilità nulla (prezzo fermo: titolo non scambiato) non è un dato affidabile: si usa quella tipica della categoria
    vol: Number.isFinite(r?.forward?.vol) && r.forward.vol > 0.001 ? r.forward.vol : r?.forward ? priorVol(i) : null };
}
const s_tax = (i) => {
  const t = state.results[i.symbol]?.sim?.taxRate;
  return `imposta ${Number.isFinite(t) ? nf1.format(t) : '26'}%`;
};
function projOf(i, r, cagrOverride = null) {
  const pp = projParams(i, r, false, cagrOverride);
  if (!pp) return null;
  return project(pp, state.settings.mc.amount || 10000, state.settings.mc.years || 5);
}
/** NR5 ricalcolato secondo il profilo scelto: guadagno netto medio (estremi attenuati) − k × perdita media nel 5% peggiore. */
function estimateHtml(e, inst = null) {
  if (!e) return '';
  if (inst) { const sp = shortPrior(inst, e.cagrShort ?? e.cagr); e = { ...e, cagrShortUsed: sp.netOfTer ? sp.cagr + (e.ter || 0) : sp.cagr, shortSrc: sp.src, shortView2: !!sp.view }; }
  return `<div class="card"><h3>Stima provvisoria${e.weeks ? ` (${e.weeks} settimane di storico)` : e.source === 'prior' ? ' (valori tipici della categoria)' : ' (dal dataset radar)'}</h3>
    <p class="muted small-note">${esc(e.basis || '')}</p>
    <table class="mini"><tbody>
      <tr><td>CAGR atteso (lordo)</td><td class="num ${cls(e.cagr)}"><b>${pct(e.cagr, true, 2)}</b></td></tr>
      <tr><td>Volatilità annua σ</td><td class="num">${pct(e.vol, false, 1)}</td></tr>
      ${e.mom ? `<tr><td>Tendenza recente (1 / 4 / 13 / 26 sett.)</td><td class="num">${[e.mom.w1, e.mom.w4, e.mom.w13, e.mom.w26].map((v) => (v == null ? '–' : pct(v, true, 0))).join(' · ')}</td></tr>` : ''}
      <tr><td>Drawdown massimo osservato</td><td class="num neg">−${pct(e.mdd, false, 1)}</td></tr>
      ${e.beta != null ? `<tr><td>Beta verso il mercato azionario</td><td class="num">${nf2.format(e.beta)}</td></tr>` : ''}
      ${Number.isFinite(e.ter) ? `<tr><td>TER stimato</td><td class="num">${pct(e.ter, false, 2)}</td></tr>` : ''}
    </tbody></table>
    ${(() => {
      // Rendimento atteso a breve con la tendenza recente (stesso algoritmo del portafoglio), su 1.000 €
      const base = Number.isFinite(e.cagrShortUsed) ? e.cagrShortUsed : Number.isFinite(e.cagrShort) ? e.cagrShort : e.cagr;
      const prm = { cagr: base, ter: e.ter || 0, tax: 0.26, net: base - (e.ter || 0) };
      const rows = [7, 14, 30, 90].map((d) => {
        const t = autoShort({ base, ter: e.ter || 0, vol: e.vol, mom: e.mom, years: d / 365, view: !!e.shortView2, evidence: false, rho: Number.isFinite(state.portfolio?.momRho) ? state.portfolio.momRho : null });
        const c = t.net + (e.ter || 0);
        const h = projectH({ cagr: c, ter: e.ter || 0, tax: 0.26, net: t.net }, 1000, d / 365, e.vol, 1, null, !!e.leverage || !!e.inverse);
        return `<tr><td>${d} giorni</td><td class="num ${cls(h.mu)}">${pct(h.mu, true, 1)}</td><td class="num ${cls(h.netGain)}">${h.netGain > 0 ? '+' : ''}${Math.round(h.netGain).toLocaleString('it-IT')} €</td><td class="num ${cls(h.medianNet)}">${h.medianNet > 0 ? '+' : ''}${Math.round(h.medianNet).toLocaleString('it-IT')} €</td><td class="num">${h.pProfit != null ? pct(h.pProfit, false, 0) : '–'}</td></tr>`;
      });
      return `<h4 class="pf-h4" style="margin-top:12px">Orizzonti brevi (su 1.000 €)</h4>${e.shortSrc ? `<p class="muted small-note">Rendimento atteso medio dal ${esc(e.shortSrc)}: ${pct(base, true, 1)}/anno con la leva.</p>` : ''}
      <table class="mini"><thead><tr><th>Orizzonte</th><th class="num">Rendimento lordo atteso</th><th class="num">Netto atteso (media)</th><th class="num">Più probabile</th><th class="num">P(guadagno)</th></tr></thead><tbody>${rows.join('')}</tbody></table>${inst?.leveraged ? [30, 90].map((d) => leverScenariosHtml(leverScenarios(inst, e.vol, d / 365, e.ter || 0), d / 365)).join('') : ''}`;
    })()}
    <p class="muted small-note">Il Portafoglio usa questi valori (anche per gli orizzonti brevi) al posto della previsione a 5 anni, che richiede almeno 1 anno di storico. È una stima prudente: non entra in classifica.</p></div>`;
}
function nr5Of(sim, type) {
  if (!sim || sim.estimated) return null; // stima provvisoria: niente simulazione, niente NR5
  if (sim.expGain == null || sim.expLoss == null || sim.es5 == null) return sim.nr5 ?? null;
  return sim.expGain - sim.expLoss - nr5Weight(type) * sim.es5;
}
// Valori di riga in memoria: si ricalcolano solo se cambiano i dati dello strumento (risultato o quotazione: nuovi oggetti
// a ogni aggiornamento) o impostazioni/vista. Con oltre 13.000 strumenti ricalcolare tutto a ogni ridisegno bloccava l'app.
const rowMemo = new WeakMap();
let rowKeyCache = { at: -1, key: '' };
function rowKey() {
  const now = performance.now();
  if (now - rowKeyCache.at > 50) {
    const v = state.view;
    rowKeyCache = { at: now, key: JSON.stringify([state.settings, v.funnel, v.scenario, v.nr5Mode, v.type, v.distFilter, v.allEtf, state.portfolio?.momRho, state.portfolio?.taxPrudent, state.liveVersion, state.dataVersion]) };
  }
  return rowKeyCache.key;
}
function rowValues(i) {
  const key = rowKey();
  const rr = state.results[i.symbol];
  const qq = state.quotes[i.symbol];
  const m = rowMemo.get(i);
  if (m && m.key === key && m.r === rr && m.q === qq) return m.v;
  const v = rowValuesCalc(i);
  rowMemo.set(i, { key, r: rr, q: qq, v });
  return v;
}
function rowValuesCalc(i) {
  const r = state.results[i.symbol];
  const q = state.quotes[i.symbol];
  const sim = r && !r.error ? r.sim : null;
  // sezione «Netto più probabile»: tutti i periodi (1 gg … 5 anni), calcolati solo in quella sezione
  const npx = shortMode() ? (d) => npCached(i, d) : null;
  const v = {
    npx,
    // Guadagno netto efficiente a 5 anni secondo la prudenza scelta (fisco incluso nella simulazione)
    plausible: sim?.ce?.['0.5'] ?? sim?.ce1 ?? null,
    // Proiezione deterministica netta (CAGR composto − TER, imposta sulla plusvalenza), in frazione del capitale
    // Algoritmo 019: guadagno netto (moduli 1-3) e, come indicatore principale, netto − MDD storico (modulo 4)
    proj019: r && !r.error ? projOf(i, r, scenarioCagr(r))?.netPct ?? null : null,
    histMdd: sim?.histMdd ?? null,
    // Max Growth Score (ETF): CAGR storico 10a (già netto di TER/TD) −15% Value/High Div/Min Vol, +0,5% indici globali
    maxGrowth: (i.type === 'etf' || i.type === 'stock') && r && !r.error ? maxGrowthScore(i, sim, r.forward, r.fund?.ter, r.fund, q?.perf)?.score ?? null : null,
    // CAGR netto atteso: netto 019 × (1 − MDD storico), es. 13.248 € × (1 − 96%) = 530 €
    proj: (() => {
      const g = r && !r.error ? projOf(i, r, scenarioCagr(r))?.netPct ?? null : null;
      if (g == null) return null;
      return sim?.histMdd != null ? g * (1 - Math.min(1, sim.histMdd)) : g;
    })(),
    cagr: (() => { const sc = r && !r.error ? scenarioCagr(r) : null; if (sc != null) return sc; return r && !r.error ? r.forward?.expected ?? null : null; })(),
    // Guadagno finale ottimizzato: media dei 3 scenari (pessimistico 2%, moderato 7%, ottimistico 10%)
    // pesata per probabilità di crescita/perdita e volatilità. Alta volatilità sposta il peso dal migliore
    // al peggiore; più probabilità di perdita → più peso allo scenario pessimistico.
    // Rendimento netto corretto per il rischio (equivalente certo media-varianza): guadagno netto atteso
    // sui 3 scenari (pessimistico/moderato/ottimistico, pesati per probabilità di perdita e crescita) MENO
    // una penalità per la volatilità su 5 anni (γ·σ²·5). Penalizza forte gli strumenti molto volatili
    // (semiconduttori, singoli settori) e lascia in fondo i monetari a basso rendimento.
    projOpt: (() => {
      if (!r || r.error || !sim) return null;
      const exp = r.forward?.expected;
      if (!Number.isFinite(exp)) return null;
      const gp = projOf(i, r, blendCagr('pess', exp))?.netPct;
      const gm = projOf(i, r, blendCagr('base', exp))?.netPct;
      const go = projOf(i, r, blendCagr('opt', exp))?.netPct;
      if (gp == null || gm == null || go == null) return null;
      const pLoss = Number.isFinite(sim.probLoss) ? sim.probLoss : 0.2;
      const pGain = 1 - pLoss;
      // Con uno scenario selezionato l'indicatore usa il guadagno netto di quello scenario; con «Modello»
      // la media dei 3 scenari pesata per probabilità di perdita/crescita. In entrambi i casi poi si
      // sottraggono le penalità di volatilità e concentrazione.
      let egain;
      const scSel = scenarioCagr(r);
      if (scSel != null) {
        egain = projOf(i, r, scSel)?.netPct;
        if (egain == null) return null;
      } else {
        const wP = pLoss;
        const wO = pGain * 0.5;
        const wM = Math.max(0, 1 - wP - wO);
        egain = (wP * gp + wM * gm + wO * go) / (wP + wM + wO);
      }
      const vol = Number.isFinite(r.forward?.vol) ? r.forward.vol : 0.2;
      // Penalità di concentrazione: un ETF con i primi 10 titoli sopra il 30% (single-country, settore,
      // pochi titoli) è meno diversificato e più rischioso; gli indici ampi (World, All-World) non la subiscono.
      const top10 = Number.isFinite(r.forward?.top10) ? r.forward.top10 : null;
      const conc = top10 != null ? 0.5 * Math.max(0, top10 - 0.3) : 0;
      return egain - vol * vol * 5 - conc; // equivalente certo: rendimento atteso − rischio (volatilità) − concentrazione
    })(),
    // Netto Reale 5A (NR5): la classifica predefinita
    overall: nr5Of(sim, i.type),
    es5: sim?.es5 ?? null,
    sharpe: sim?.sharpe ?? null,
    sortino: sim?.sortino ?? null,
    growthEvidence: r && !r.error ? r.forward?.evidence ?? null : null,
    inst: i,
    name: i.name.toLowerCase(),
    type: i.type,
    price: q?.priceEur ?? null,
    // patrimonio (milioni di €) e TER del fondo: solo ETF, per i filtri
    aum: aumEur(r?.fund) != null ? aumEur(r.fund) / 1e6 : null,
    ter: Number.isFinite(r?.fund?.ter) ? r.fund.ter : null,
    change: q?.changePct ?? null,
    expected: r?.forward?.expected ?? null,
    expected5: r?.forward?.expected != null ? (1 + r.forward.expected) ** 5 - 1 : null,
    maxLoss: sim?.maxLoss ?? null,
    mddMedian: sim?.mddMedian ?? null,
    // Perdita tipica (drawdown mediano) / guadagno netto: ∞ se il guadagno è ≤ 0
    ratioMedian: sim && sim.mddMedian != null && sim.netGain != null ? (sim.netGain > 0 ? sim.mddMedian / sim.netGain : Infinity) : null,
    netGain: sim?.netGain ?? null,
    netMean: sim?.netMean ?? null,
    netP25: sim?.netP25 ?? null,
    finalLoss: sim?.finalLoss ?? null,
    // Guadagno tipico (mediano) meno la perdita definitiva nel caso sfavorevole: quanto guadagni, già "pagato" il rischio
    balanced: sim?.balanced ?? null,
    // Guadagno medio ÷ perdita max 5a (filtro): più alto è meglio
    meanOverLoss: sim && sim.netMean != null && sim.maxLoss != null ? (sim.maxLoss > 0 ? sim.netMean / sim.maxLoss : sim.netMean > 0 ? Infinity : 0) : null,
    // Guadagno bilanciato ÷ perdita max 5a (filtro): più alto è meglio
    balancedOverLoss: sim && sim.balanced != null && sim.maxLoss != null ? (sim.maxLoss > 0 ? sim.balanced / sim.maxLoss : sim.balanced > 0 ? Infinity : 0) : null,
    // Guadagno netto 019 (CAGR − TER, imposta) ÷ perdita max 5a: più alto è meglio
    net019OverLoss: (() => {
      const g = r && !r.error ? projOf(i, r, scenarioCagr(r))?.netPct ?? null : null;
      if (g == null || sim?.maxLoss == null) return null;
      return sim.maxLoss > 0 ? g / sim.maxLoss : g > 0 ? Infinity : 0;
    })(),
    // Media delle perdite (drawdown mediano e perdita max) ÷ (media dei guadagni mediano e medio + crescita
    // annua attesa degli utili, 0 se non disponibile): più basso è meglio; ∞ se il denominatore è ≤ 0
    riskGain: (() => {
      if (!sim || sim.mddMedian == null || sim.maxLoss == null || sim.netMedian == null || sim.netMean == null) return null;
      const den = (sim.netMedian + sim.netMean) / 2 + growth5(r);
      return den > 0 ? (sim.mddMedian + sim.maxLoss) / 2 / den : Infinity;
    })(),
    // Stesso indicatore con al numeratore solo la perdita max a 5 anni
    maxLossGain: (() => {
      if (!sim || sim.maxLoss == null || sim.netMedian == null || sim.netMean == null) return null;
      const den = (sim.netMedian + sim.netMean) / 2 + growth5(r);
      return den > 0 ? sim.maxLoss / den : Infinity;
    })(),
    // (Guadagno probabile 75% + crescita annua attesa, 0 se non disponibile) ÷ perdita max: più alto è meglio
    p25GrowthLoss: (() => {
      if (!sim || sim.maxLoss == null || sim.netP25 == null) return null;
      const num = sim.netP25 + growth5(r);
      return sim.maxLoss > 0 ? num / sim.maxLoss : num > 0 ? Infinity : 0;
    })(),
    // (Guadagno probabile 75% + crescita annua attesa, 0 se non disponibile) ÷ drawdown mediano: più alto è meglio
    p25GrowthDD: (() => {
      if (!sim || sim.mddMedian == null || sim.netP25 == null) return null;
      const num = sim.netP25 + growth5(r);
      return sim.mddMedian > 0 ? num / sim.mddMedian : num > 0 ? Infinity : 0;
    })(),
    riskAdj: sim && sim.finalLoss != null && sim.netMedian != null ? sim.netMedian - sim.finalLoss : null,
    // ratioFinal null con guadagno mediano ≤ 0 (Infinity non sopravvive al JSON) → ∞
    ratioFinal: sim && sim.finalLoss != null ? (sim.ratioFinal ?? (sim.netMedian > 0 ? null : Infinity)) : null,
    // probAtLeast è allineato a PROB_THRESHOLDS: [0, +10%, +25%, +50%, +100%]
    prob10: sim?.probAtLeast?.[1] ?? null,
    prob25: sim?.probAtLeast?.[2] ?? null,
    prob50: sim?.probAtLeast?.[3] ?? null,
    // Infinity non sopravvive al JSON (diventa null): con guadagno ≤ 0 il rapporto è ∞
    ratio: sim ? (sim.ratio ?? (sim.netGain > 0 ? null : Infinity)) : null,
    probLoss: sim?.probLoss ?? null,
    growth: i.growth ?? null,
    growthExp: r && !r.error ? r.forward?.growth ?? r.forward?.expectedGrowth ?? null : null,
    varM: q?.perf?.m ?? null,
    varM3: q?.perf?.m3 ?? null,
    varY: q?.perf?.y ?? null,
    ...histValues(i, q),
    tScore: trendScore(q?.perf),
    // prezzo medio e minimo a 52 settimane e a 90 giorni, e distanza del prezzo attuale da ciascuno
    avg52: q?.perf?.a52 ?? null,
    min52: q?.perf?.l52 ?? null,
    avg90: q?.perf?.a90 ?? null,
    min90: q?.perf?.l90 ?? null,
    dA52: distanceFrom(q?.priceEur, q?.perf?.a52),
    dL52: distanceFrom(q?.priceEur, q?.perf?.l52),
    dA90: distanceFrom(q?.priceEur, q?.perf?.a90),
    dL90: distanceFrom(q?.priceEur, q?.perf?.l90),
    // quanto il prezzo medio sta sopra il minimo, in frazione del minimo
    sA52: distanceFrom(q?.perf?.a52, q?.perf?.l52),
    sA90: distanceFrom(q?.perf?.a90, q?.perf?.l90),
    ...consensusValues(i, r),
    [SIM_KEY]: sim && Number.isFinite(sim.netMedian) && !(i.type === 'stock' && (q?.priceEur ?? Infinity) < PENNY_MIN_EUR) ? sim.netMedian * (state.settings.mc.amount || 10000) : null,
    simP: sim && Number.isFinite(sim.probLoss) && !(i.type === 'stock' && (q?.priceEur ?? Infinity) < PENNY_MIN_EUR) ? 1 - sim.probLoss : null,
    simP25: sim && Number.isFinite(sim.netP25) ? sim.netP25 * (state.settings.mc.amount || 10000) : null,
    [SIM_P90_KEY]: sim && Number.isFinite(sim.netP10) && !(i.type === 'stock' && (q?.priceEur ?? Infinity) < PENNY_MIN_EUR) ? Math.max(-1, sim.netP10) * (state.settings.mc.amount || 10000) : null, // non si può perdere più del capitale
    tSl: q?.perf?.sl ?? null,
    tWm: q?.perf?.wm ?? null,
    perfW: netPerf(q?.perf?.w, i),
    perfM: netPerf(q?.perf?.m, i),
    perfYtd: netPerf(q?.perf?.ytd, i),
    error: r?.error || null,
  };
  if (npx) {
    const sk = npSortKey();
    for (const [d] of NP_PERIODS) {
      const k = 'np' + d;
      if (k === sk) v[k] = npx(d)?.median ?? null;
      else Object.defineProperty(v, k, { enumerable: true, configurable: true, get: () => npx(d)?.median ?? null });
    }
  }
  // filtri «netto più probabile» in euro: valgono in ogni classifica; il valore si calcola solo se un filtro lo chiede
  for (const [d] of NP_FILTER_PERIODS) Object.defineProperty(v, npFilterKey(d), { enumerable: false, configurable: true, get: () => npCached(i, d)?.medianEur ?? null });
  for (const [d] of P_GAIN_PERIODS) Object.defineProperty(v, pGainKey(d), { enumerable: false, configurable: true, get: () => npCached(i, d)?.p ?? null });
  for (const [d] of P_GAIN_PERIODS) Object.defineProperty(v, p90Key(d), { enumerable: false, configurable: true, get: () => npCached(i, d)?.p10Eur ?? null });
  // prezzo più probabile al periodo scelto nella barra (1 gg … 5 anni) e differenza dal prezzo attuale
  Object.defineProperty(v, 'pxDiff', { enumerable: false, configurable: true, get: () => { const f = npCached(i, state.view.np)?.pxF; return f != null ? f - 1 : null; } });
  Object.defineProperty(v, 'pxMed', { enumerable: false, configurable: true, get: () => { const f = npCached(i, state.view.np)?.pxF; return f != null && q?.priceEur > 0 ? q.priceEur * f : null; } });
  // Max Growth Score nelle sezioni «Netto più probabile»: stesso valore della sezione Max Growth, con una chiave propria per l'ordinamento
  Object.defineProperty(v, 'mgScore', { enumerable: false, configurable: true, get: () => v.maxGrowth ?? null });
  // prezzo più probabile a 6 mesi e sua distanza dal minimo a 52 settimane: (prezzo a 6 mesi − minimo) ÷ minimo
  Object.defineProperty(v, 'pm6', { enumerable: false, configurable: true, get: () => { const f = npCached(i, PM6_DAYS)?.pxF; return f != null && q?.priceEur > 0 ? q.priceEur * f : null; } });
  Object.defineProperty(v, 'pm6Now', { enumerable: false, configurable: true, get: () => { const f = npCached(i, PM6_DAYS)?.pxF; return f != null && q?.priceEur > 0 ? f - 1 : null; } });
  Object.defineProperty(v, 'pm6L52', { enumerable: false, configurable: true, get: () => { const f = npCached(i, PM6_DAYS)?.pxF; return f != null && q?.priceEur > 0 ? distanceFrom(q.priceEur * f, q?.perf?.l52) : null; } });
  // rischio, come nella scheda dello strumento: perdita nello stress test (mercato −30% × beta; −10% per la correzione),
  // guadagno netto efficiente in euro, guadagno bilanciato crescita/rischio e guadagno corretto per il rischio a 1 e 3 anni
  // (distribuzione del modello delle previsioni) e a 5 anni (scenari simulati)
  const penny = i.type === 'stock' && (q?.priceEur ?? Infinity) < PENNY_MIN_EUR;
  const st = r && !r.error && i.type !== 'crypto' ? stressTest({ beta: r.forward?.beta, netCagr: 0, capital: 1 }) : null;
  v.stress = st ? st[1].impact : null;
  v.stressMild = st ? st[0].impact : null;
  v.stressBeta = st ? (Number.isFinite(r.forward?.beta) ? st[1].beta : null) : null;
  v.effNet = v.plausible != null && !penny ? v.plausible * (state.settings.mc.amount || 10000) : null;
  for (const [d] of RG_PERIODS) {
    const get = d === 1825
      ? () => (sim && !penny && sim.balanced != null && sim.finalLoss != null && sim.netMedian != null ? { balanced: sim.balanced, expGain: sim.expGain, expLoss: sim.expLoss, median: sim.netMedian, finalLoss: sim.finalLoss, riskAdj: sim.netMedian - sim.finalLoss } : null)
      : () => rgCached(i, d);
    Object.defineProperty(v, 'rg' + d, { enumerable: false, configurable: true, get });
    Object.defineProperty(v, balKey(d), { enumerable: false, configurable: true, get: () => get()?.balanced ?? null });
    Object.defineProperty(v, radjKey(d), { enumerable: false, configurable: true, get: () => get()?.riskAdj ?? null });
    // asimmetria del rischio: perdita finale nel 5% peggiore ÷ guadagno tipico; ∞ se il guadagno tipico non è positivo.
    // A 5 anni è il rapporto pubblicato con gli scenari (lo stesso della scheda).
    Object.defineProperty(v, asymKey(d), { enumerable: false, configurable: true, get: () => asymOf(get(), d === 1825 ? sim?.ratioFinal : null) });
  }
  return v;
}

function sortRows(rows) {
  const { key, dir } = state.view.sort;
  const k = key === 'rank' ? (shortMode() ? npSortKey() : 'projOpt') : key;
  if (shortMode() && /^np\d+$/.test(k)) {
    const pos = stablePositions(Number(k.slice(2)));
    return rows.sort((a, b) => {
      const pa = pos.get(a.inst.symbol);
      const pb = pos.get(b.inst.symbol);
      if ((pa == null) !== (pb == null)) return pa == null ? 1 : -1; // valori mancanti sempre in fondo
      if (pa == null) return a.name.localeCompare(b.name);
      return (pa - pb) * (dir < 0 ? 1 : -1);
    });
  }
  if (k === 'anUp') return rows.sort((a, b) => compareConsensus(a, b, dir) || a.name.localeCompare(b.name));
  if (k === 'divY') return rows.sort((a, b) => compareDividend(a, b, dir) || a.name.localeCompare(b.name));
  return rows.sort((a, b) => {
    const va = a[k];
    const vb = b[k];
    const na = va == null || (typeof va === 'number' && Number.isNaN(va));
    const nb = vb == null || (typeof vb === 'number' && Number.isNaN(vb));
    if (na !== nb) return na ? 1 : -1; // valori mancanti sempre in fondo
    // senza crescita a 30 giorni (dato non ancora arrivato): tra loro vale il rialzo dell'ultima settimana
    if (na && k === 'tScore' && a.hW !== b.hW && (a.hW != null || b.hW != null)) return (b.hW ?? -Infinity) - (a.hW ?? -Infinity);
    if (na) return a.name.localeCompare(b.name);
    if (typeof va === 'string') return va.localeCompare(vb) * dir;
    // A parità (es. rapporto 0 = nessuna perdita nemmeno nel caso sfavorevole) prima chi guadagna di più
    if (va === vb) return (b.netGain ?? -Infinity) - (a.netGain ?? -Infinity);
    return (va < vb ? -1 : 1) * dir;
  });
}

const mgMode = () => state.view.funnel === 'maxgrowth' && state.view.type !== 'bond' && state.view.type !== 'crypto';
function rankMap(rows) {
  // La posizione in classifica è sempre per guadagno netto 5a (algoritmo 019) decrescente, indipendentemente dall'ordinamento scelto.
  if (shortMode()) {
    const pos = stablePositions(Number(npSortKey().slice(2)));
    const ranked = rows.filter((r) => pos.has(r.inst.symbol)).sort((a, b) => pos.get(a.inst.symbol) - pos.get(b.inst.symbol));
    return new Map(ranked.map((r, k) => [r.inst.symbol, k + 1]));
  }
  const k = mgMode() ? 'maxGrowth' : 'projOpt';
  const ranked = rows.filter((r) => r[k] != null && Number.isFinite(r[k])).sort((a, b) => b[k] - a[k]);
  return new Map(ranked.map((r, k) => [r.inst.symbol, k + 1]));
}

function render() {
  rowKeyCache.at = -1;
  npCfgCache.at = -1; // impostazioni o vista possono essere appena cambiate
  // sezione «Netto più probabile»: barra dei periodi e intestazione
  const bar = $('#np-bar');
  if (bar) {
    bar.hidden = !shortMode();
    const cur = Number(npSortKey().slice(2));
    $$('#np-bar [data-np]').forEach((b) => b.classList.toggle('active', Number(b.dataset.np) === cur));
  }
  document.body.classList.toggle('np-mode', shortMode());
  // intestazioni delle 9 colonne dei periodi, subito dopo «Strumento»
  $$('#table thead th.np-col, #table thead th.px-col, #table thead th.rg-col, #table thead th.mg-col, #table thead th.sim-col, #table thead th.simp-col, #table thead th.rk-col, #table thead th.an-col, #table thead th.trend-col, #table thead th.hist-col').forEach((th) => th.remove());
  document.body.classList.toggle('solid-mode', solidMode());
  if (shortMode()) {
    const nameTh = $('#table thead th[data-sort="name"]');
    let after = nameTh;
    if (analystMode()) for (const th of anHeads()) { after.after(th); after = th; }
    for (const [d, l] of NP_PERIODS) {
      const th = document.createElement('th');
      th.className = 'num np-col' + (state.view.sort.key === 'np' + d ? ' sorted' : '');
      th.dataset.sort = 'np' + d;
      th.title = `Guadagno netto PIÙ PROBABILE a ${l} (esito mediano: metà dei casi meglio, metà peggio), sul capitale impostato, dopo imposta e costi. Tocca per ordinare.`;
      th.innerHTML = `<span class="l">Più probabile ${l}</span><span class="s">${l}</span>${state.view.sort.key === 'np' + d ? (state.view.sort.dir < 0 ? ' ▼' : ' ▲') : ''}`;
      after.after(th);
      after = th;
    }
    // prezzo attuale, prezzo più probabile al periodo scelto e differenza
    for (const th of pxHeads()) { after.after(th); after = th; }
    for (const th of rangeHeads()) { after.after(th); after = th; }
    { const th = mgHead(); after.after(th); after = th; }
    // guadagno netto sui 2.000 scenari simulati: valore mediano (attendibile), non la media
    {
      const th = document.createElement('th');
      const on = state.view.sort.key === SIM_KEY;
      th.className = 'num sim-col' + (on ? ' sorted' : '');
      th.dataset.sort = SIM_KEY;
      th.title = `Guadagno netto sui ${simCount()} scenari simulati a ${simYears()} anni, sul capitale impostato: valore MEDIANO (metà degli scenari finisce sopra, metà sotto), al netto di imposte, bollo, commissioni e spread. Si usa la mediana e non la media, che pochi scenari estremi gonfiano. Sotto: probabilità di guadagno e risultato raggiunto o superato in 3 scenari su 4. Tocca per ordinare.`;
      th.innerHTML = `<span class="l">Guadagno netto mediano ${simCount()} scenari ${simYears()}a</span><span class="s">Mediano ${simCount()} scen.</span>${on ? (state.view.sort.dir < 0 ? ' ▼' : ' ▲') : ''}`;
      after.after(th);
      after = th;
    }
    // guadagno netto raggiunto o superato nel 90% degli scenari, in euro: 1 e 3 anni dal modello delle previsioni, 5 anni dagli scenari simulati
    for (const [k, l, s, src] of [...P_GAIN_PERIODS.map(([d, l]) => [p90Key(d), l, d === 365 ? '1a' : '3a', 'secondo il modello delle previsioni (lo stesso del netto più probabile)']), [SIM_P90_KEY, `${simYears()} anni`, `${simYears()}a`, `sui ${simCount()} scenari simulati`]]) {
      const th = document.createElement('th');
      const on = state.view.sort.key === k;
      th.className = 'num simp-col' + (on ? ' sorted' : '');
      th.dataset.sort = k;
      th.title = `Guadagno netto a ${l} raggiunto o superato nel 90% degli scenari (9 casi su 10), in euro sul capitale impostato, ${src}, dopo imposta e costi. In 1 caso su 10 va peggio di così. Se è negativo, è la perdita che 9 volte su 10 non viene superata. Non è una garanzia. Tocca per ordinare dal più alto.`;
      th.innerHTML = `<span class="l">Netto nel 90% degli scenari ${l}</span><span class="s">90% scen. ${s}</span>${on ? (state.view.sort.dir < 0 ? ' ▼' : ' ▲') : ''}`;
      after.after(th);
      after = th;
    }
    for (const th of riskHeads()) { after.after(th); after = th; }
    if (!analystMode()) for (const th of anHeads()) { after.after(th); after = th; }
    // crescita degli ultimi 30 giorni: ordina la sezione «Solidi e in crescita»
    if (solidMode()) {
      const th = document.createElement('th');
      const on = state.view.sort.key === 'tScore';
      th.className = 'num trend-col' + (on ? ' sorted' : '');
      th.dataset.sort = 'tScore';
      th.title = 'Crescita degli ultimi 30 giorni, in rendimento per seduta: media tra la pendenza della curva del rendimento complessivo (retta sui prezzi di chiusura in EUR) e la media ponderata degli incrementi tra una seduta e l’altra, con più peso alle sedute recenti (il peso si dimezza ogni 5 sedute). Lorda, senza costi né imposte. Tocca per ordinare.';
      th.innerHTML = `<span class="l">Crescita 30 gg</span><span class="s">Cresc. 30 gg</span>${on ? (state.view.sort.dir < 0 ? ' ▼' : ' ▲') : ''}`;
      after.after(th);
      after = th;
    }
    // storico: variazioni di oggi, 1 settimana, 14 giorni, 1 mese, 1 anno
    for (const [k, l, tip] of HIST_COLS) {
      const th = document.createElement('th');
      th.className = 'num hist-col';
      th.dataset.sort = k;
      th.title = `${tip}, in EUR, lorda (senza costi né imposte). Tocca per ordinare dal rendimento più alto; tocca ancora per invertire.`;
      th.innerHTML = `<span class="l">Storico ${l}</span><span class="s">${l}</span>`;
      after.after(th);
      after = th;
    }
  }
  // «Netto più probabile»: all'apertura i dati statici (di ore fa) vengono sostituiti dopo pochi secondi da quelli live e la
  // classifica cambiava a vista d'occhio. Si mostra solo con i dati aggiornati (al massimo 25 s di attesa).
  if (STATIC && shortMode() && !state.liveReady && performance.now() < 25000) {
    $('#table tbody').innerHTML = '<tr><td colspan="48" class="muted">Carico gli ultimi dati di mercato… La classifica «Netto più probabile» si mostra solo con dati aggiornati, per non farla cambiare subito dopo l’apertura.</td></tr>';
    return;
  }
  const all = filtered();
  const rows = sortRows(all.map(rowValues));
  renderSolidAlerts();
  if (solidMode() && state.solidAlerts === undefined && !state.solidPending && (!STATIC || state.liveReady)) {
    state.solidPending = true;
    setTimeout(() => { checkSolidAlerts({ notify: false }); state.solidPending = false; }, 0);
  }
  const sn = $('#solid-note');
  if (sn) {
    sn.hidden = !solidMode() && !analystMode() && !watchMode();
    if (watchMode()) {
      const n = watchList.length;
      sn.innerHTML = n
        ? `<b>⭐ Watch list: ${n} ${n === 1 ? 'strumento preferito' : 'strumenti preferiti'}</b>${all.length !== n ? ` (${all.length} in questa scheda)` : ''} · si aggiungono con il pulsante «Condividi» nella scheda dello strumento, si tolgono con «Togli» · sotto il nome: data e prezzo di quando l’hai aggiunto e variazione da allora · stesse colonne di «Netto più probabile» · la lista è salvata in questo browser: su un altro telefono o PC va ricreata · <span class="muted">stime del modello, non una raccomandazione</span>`
        : '<b>⭐ Watch list vuota</b> · apri la scheda di uno strumento (tocca la riga) e premi «Condividi» in alto: lo strumento entra qui e la scheda viene salvata come file.';
    }
    if (analystMode()) {
      const withUp = rows.filter((x) => x.anUp != null).length;
      const withDiv = rows.filter((x) => x.divY != null).length;
      sn.innerHTML = `<b>Analisti e dividendi: ${withUp.toLocaleString('it-IT')} strumenti con prezzo obiettivo, ${withDiv.toLocaleString('it-IT')} con dividendo</b> · ordinati per potenziale secondo gli analisti (prezzo obiettivo medio a 12 mesi rispetto al prezzo), a parità o senza analisti per rendimento da dividendi · <b>⚠ valori poco attendibili, messi dopo quelli attendibili</b>: meno di ${AN_MIN_RELIABLE} analisti, rialzo oltre il +100% (spesso un prezzo obiettivo non aggiornato, per esempio dopo un maxi-dividendo), ETF fermi al tetto del +50%, dividendi oltre il 12% (straordinari) · per gli ETF media ponderata sui titoli del fondo · le criptovalute non hanno analisti né dividendi · fonte: consenso degli analisti e dividendi di Yahoo Finance, non i dati interni di Trade Republic (possono differire) · <span class="muted">stime degli analisti, non del modello: non sono una garanzia né una raccomandazione</span>`;
    }
    if (solidMode()) {
      const cap = state.settings.mc.amount || 10000;
      const at = state.liveVersion || state.dataVersion;
      sn.innerHTML = `<b>Solidi e in crescita: ${all.length.toLocaleString('it-IT')} ${all.length === 1 ? 'strumento' : 'strumenti'}</b> · netto più probabile maggiore di ${eur0(SOLID_MIN.y1 * cap)} a 1 anno, di ${eur0(SOLID_MIN.y3 * cap)} a 3 anni e di ${eur0(SOLID_MIN.y5 * cap)} a 5 anni (su ${eur0(cap)}) · prezzo in rialzo su 1 settimana, 14 giorni e 1 mese, oggi non in calo · ordinati per crescita degli ultimi 30 giorni: pendenza della curva del rendimento e media ponderata degli incrementi tra le sedute, con più peso alle recenti (tocca un'intestazione per cambiare) · dati delle ${at ? new Date(at).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : '–'}: l'elenco si ricalcola da solo a ogni aggiornamento dei dati (in orario di borsa circa ogni 10 minuti). Stime del modello, non una raccomandazione.`;
    }
  }
  const ranks = rankMap(rows);
  const finiteRatios = rows.map((r) => r.ratio).filter((x) => x != null && Number.isFinite(x));
  const maxRatio = Math.max(1, ...finiteRatios.map((x) => Math.min(x, 10)));
  const visible = rows.slice(0, state.view.limit);

  $('#table tbody').innerHTML = visible
    .map((r) => {
      const i = r.inst;
      const rank = ranks.get(i.symbol);
      let ratioCell = '<span class="muted">–</span>';
      if (r.error) ratioCell = `<span class="muted" title="${esc(r.error)}">n.d.</span>`;
      else if (r.ratio === Infinity) ratioCell = '<span class="neg" title="Guadagno netto mediano ≤ 0">∞</span>';
      else if (r.ratio != null) {
        const w = Math.max(4, 100 - (Math.min(r.ratio, 10) / maxRatio) * 100);
        ratioCell = `<span class="ratio-bar"><i style="width:${w}%"></i></span>${nf2.format(r.ratio)}`;
      }
      return `<tr data-symbol="${esc(i.symbol)}">
        <td class="num muted">${rank ?? ''}</td>
        <td><span class="name" title="${esc(i.name)}">${watchSet.has(i.symbol) ? `<span class="added-tag" title="${esc(watchSince(watchItem(i.symbol), r.price))}">⭐</span> ` : ''}${i.source === 'extra' || i.source === 'user' ? '<span class="added-tag">＋</span> ' : ''}${i.leveraged && i.type === 'etf' ? '<span class="added-tag" title="Prodotto a leva / short / inverse: la previsione a 5 anni è poco affidabile, usa orizzonti brevi">⚡</span> ' : ''}${esc(i.name)}</span><span class="ids">${(() => {
          const g = state.results[i.symbol]?.forward;
          const ge = g ? g.growth ?? g.expectedGrowth : null;
          if (i.growth != null) return `<span class="growth-tag" title="Selezione crescita: crescita attesa anno prossimo (consenso analisti)">🚀 ${pct(i.growth, true, 0)}</span> · `;
          return ge != null ? `<span class="growth-tag soft" title="Crescita annua degli utili attesa nei prossimi 5 anni">📈 ${pct(ge, true, 0)}</span> · ` : '';
        })()}${(() => {
          if (i.type !== 'etf') return '';
          const fc = funnelOf(i);
          return fc.pass ? `<span class="growth-tag" title="Imbuto superato: indice globale puro, accumulazione, ${esc(fc.reason)}">✅ imbuto</span> · ` : '';
        })()}${esc(i.symbol)}${i.isin ? ' · ' + esc(i.isin) : ''}</span>${shortMode() ? mInd(r) : ''}</td>
        ${analystMode() ? anCells(r) : ''}
        ${shortMode() ? NP_PERIODS.map(([d, l]) => { const x = r.npx?.(d); if (!x) return '<td class="num muted">–</td>'; const tip = `${l}: più probabile ${Math.round(x.medianEur)} € · atteso (media) ${Math.round(x.meanEur)} € · probabilità di guadagno ${x.p != null ? Math.round(x.p * 100) + '%' : 'n.d.'} · previsione ${pct(x.rate, true, 1)}/anno${x.estimated ? ' · stima provvisoria' : ''}${x.src ? ' · ' + esc(x.src) : ''}`; return `<td class="num ${cls(x.median)}" title="${tip}"><b class="big">${x.medianEur > 0 ? '+' : ''}${Math.round(x.medianEur).toLocaleString('it-IT')} €</b><span class="eur">${pct(x.median, true, 1)}${x.p != null ? ` · P ${pct(x.p, false, 0)}` : ''}</span></td>`; }).join('') : ''}
        ${shortMode() ? pxCells(r) : ''}
        ${shortMode() ? rangeCells(r) : ''}
        ${shortMode() ? mgCell(r) : ''}
        ${shortMode() ? (r[SIM_KEY] == null ? '<td class="num sim-col muted">–</td>' : `<td class="num sim-col ${cls(r[SIM_KEY])}" title="Valore mediano dei ${simCount()} scenari a ${simYears()} anni: ${eur0(r[SIM_KEY])}${r.simP != null ? ` · probabilità di guadagno ${pct(r.simP, false, 0)}` : ''}${r.simP25 != null ? ` · in 3 scenari su 4 il risultato è almeno ${eur0(r.simP25)}` : ''} · media di tutti gli scenari ${pct(r.netMean, true, 1)} (gonfiata dagli scenari estremi: non usarla come previsione)"><b class="big">${r[SIM_KEY] > 0 ? '+' : ''}${eur0(r[SIM_KEY])}</b><span class="eur">${r.simP != null ? `P ${pct(r.simP, false, 0)}` : ''}${r.simP25 != null ? ` · 3 su 4 ≥ ${r.simP25 > 0 ? '+' : ''}${eur0(r.simP25)}` : ''}</span></td>`) : ''}
        ${shortMode() ? [...P_GAIN_PERIODS.map(([d, l]) => [p90Key(d), l, r[pGainKey(d)]]), [SIM_P90_KEY, `${simYears()} anni`, r.simP]].map(([k, l, p]) => { const x = r[k]; return x == null ? '<td class="num simp-col muted">–</td>' : `<td class="num simp-col ${cls(x)}" title="In 9 casi su 10 il guadagno netto a ${l} è almeno ${eur0(x)}; in 1 caso su 10 va peggio.${p != null ? ` Probabilità di guadagno a ${l}: ${Math.round(p * 100)}%.` : ''}"><b class="big">${x > 0 ? '+' : ''}${eur0(x)}</b></td>`; }).join('') : ''}
        ${shortMode() ? riskCells(r) : ''}
        ${shortMode() && !analystMode() ? anCells(r) : ''}
        ${solidMode() ? (r.tScore == null ? '<td class="num trend-col muted" title="Crescita a 30 giorni non ancora disponibile per questo strumento">–</td>' : `<td class="num trend-col ${cls(r.tScore)}" title="Ultimi 30 giorni, per seduta: pendenza della curva del rendimento ${pct(r.tSl, true, 2)} · media ponderata degli incrementi (più peso alle sedute recenti) ${pct(r.tWm, true, 2)}"><b class="big">${pct(r.tScore, true, 2)}</b><span class="eur">pend. ${pct(r.tSl, true, 2)} · media ${pct(r.tWm, true, 2)}</span></td>`) : ''}
        ${shortMode() ? HIST_COLS.map(([k]) => `<td class="num hist-col ${cls(r[k])}">${pct(r[k], true, 2)}</td>`).join('') : ''}
        ${mgMode() ? (() => {
          const rr = state.results[i.symbol];
          const ter = rr?.fund?.ter;
          const mg = maxGrowthScore(i, rr?.sim, rr?.forward, ter, rr?.fund, state.quotes[i.symbol]?.perf);
          if (!mg) return '<td class="num muted">–</td>';
          const parts = [`storico ${mg.years || 5}a ${pct(mg.hist, true)}${mg.cagr10 != null ? ` (10a ${pct(mg.cagr10, true)})` : ''}${mg.anomalous ? ' <span class="neg">eccezionale/anomalo: escluso</span>' : ''}`];
          if (mg.exp != null) parts.push(`atteso ${pct(mg.exp, true)}`);
          if (mg.growth != null) parts.push(`crescita utili ${pct(mg.growth, true)}`);
          if (mg.stagnation) parts.push(`<span class="neg">− ${pct(mg.stagnation, false)} stagnazione</span>`);
          if (mg.special) parts.push(`<span class="neg">− ${pct(mg.special, false)} strategia speciale</span>`);
          if (mg.small) parts.push(`<span class="neg">− 0,5% ${mg.aum == null ? 'patrimonio n.d.' : 'patrimonio < 1 mld'}</span>`);
          if (mg.boost) parts.push('<span class="pos">+ 0,5% mercato globale</span>');
          if (mg.trend) parts.push(`<span class="${mg.trend > 0 ? 'pos' : 'neg'}">${mg.trend > 0 ? '+' : '−'} ${pct(Math.abs(mg.trend), false)} andamento recente (3m ${mg.m3 != null ? pct(mg.m3, true) : 'n.d.'}, 12m ${mg.y != null ? pct(mg.y, true) : 'n.d.'})</span>`);
          if (mg.risk) parts.push(`<span class="neg">− ${pct(mg.risk, false)} volatilità ${pct(mg.vol, false, 0)}</span>`);
          if (mg.conc) parts.push(`<span class="neg">− ${pct(mg.conc, false)} concentrazione/settore</span>`);
          const amt = state.settings.mc.amount || 10000;
          const yrs = state.settings.mc.years || 5;
          const tx = Number.isFinite(rr?.sim?.taxRate) ? rr.sim.taxRate / 100 : 0.26;
          const g = amt * ((1 + mg.score) ** yrs - 1);
          const net = Math.round(g > 0 ? g * (1 - tx) : g);
          return `<td class="num ${cls(mg.score)}"><b class="big">${net > 0 ? '+' : ''}${net.toLocaleString('it-IT')} €</b><span class="eur">${pct(mg.score, true)}/anno · guadagno netto ${yrs}a su ${amt.toLocaleString('it-IT')} € (imposta ${Math.round(tx * 100)}%)<span class="xl"> · ${parts.join(' · ')}${i.type === 'etf' ? ` · TER${Number.isFinite(ter) ? ' ' + pct(ter, false, 2) : ''} già nel prezzo` : ''}</span></span></td>`;
        })() : `<td class="num ${cls(r.projOpt)}"><b class="big">${r.projOpt == null ? '–' : `${r.projOpt > 0 ? '+' : ''}${Math.round(r.projOpt * (state.settings.mc.amount || 10000)).toLocaleString('it-IT')} €`}</b>${r.projOpt == null ? '' : `<span class="eur">${pct(r.projOpt, true)}<span class="xl"> · rendimento netto atteso (3 scenari) meno penalità per la volatilità</span></span>`}</td>`}
        <td class="num ${cls(r.proj019)}"><b class="big">${r.proj019 == null ? '–' : `${r.proj019 > 0 ? '+' : ''}${Math.round(r.proj019 * (state.settings.mc.amount || 10000)).toLocaleString('it-IT')} €`}</b>${r.proj019 == null ? '' : `<span class="eur">${pct(r.proj019, true)}<span class="xl"> · CAGR ${pct(r.cagr, false)} − TER ${pct(Number.isFinite(state.results[i.symbol]?.fund?.ter) ? state.results[i.symbol].fund.ter : DEFAULT_TER[i.type] ?? 0, false, 2)}, ${s_tax(i)}</span></span>`}</td>
        <td class="num ${cls(r.proj)}"><b class="big">${r.proj == null ? '–' : `${r.proj > 0 ? '+' : ''}${Math.round(r.proj * (state.settings.mc.amount || 10000)).toLocaleString('it-IT')} €`}</b>${r.proj == null ? '' : `<span class="eur">${pct(r.proj, true)}<span class="xl"> · netto 019 ${r.proj019 > 0 ? '+' : ''}${Math.round(r.proj019 * (state.settings.mc.amount || 10000)).toLocaleString('it-IT')} € (${pct(r.proj019, true)})${r.histMdd != null ? ` × (1 − <span class="neg">MDD storico ${pct(r.histMdd, false, 0)}</span>)` : ''} · CAGR atteso ${pct(r.cagr, false)} = ${r.cagr > 0 ? '+' : ''}${Math.round(r.cagr * (state.settings.mc.amount || 10000)).toLocaleString('it-IT')} €/anno</span></span>`}</td>
        <td class="num">${r.net019OverLoss == null ? '–' : r.net019OverLoss === Infinity || r.net019OverLoss > 99 ? '<span class="pos" title="Perdita massima quasi nulla (monetari, obbligazionari brevissimi): valore altissimo, ma il guadagno è piccolo">&gt;99</span>' : `<span class="${r.net019OverLoss >= 1 ? 'pos' : r.net019OverLoss < 0 ? 'neg' : ''}">${nf2.format(r.net019OverLoss)}</span>`}</td>
        <td class="num ${cls(r.growthExp)}">${pct(r.growthExp, true)}</td>
        <td class="num ${cls(r.riskAdj)}"><b class="big">${r.riskAdj == null ? '–' : `${r.riskAdj > 0 ? '+' : ''}${Math.round(r.riskAdj * (state.settings.mc.amount || 10000)).toLocaleString('it-IT')} €`}</b>${r.riskAdj == null ? '' : `<span class="eur">${pct(r.riskAdj, true)}</span>`}</td>
        <td class="num ${cls(r.overall)}"><b class="big">${r.overall == null ? '–' : `${r.overall > 0 ? '+' : ''}${Math.round(r.overall * (state.settings.mc.amount || 10000)).toLocaleString('it-IT')} €`}</b>${r.overall == null ? '' : `<span class="eur">${pct(r.overall, true)} · media ${pct(r.netMean, true)} − ${fracLabel(nr5Weight(r.inst.type))} × ${pct(r.es5)} (estremi attenuati)</span>`}</td>
        <td class="num ${cls(r.netP25)}"><b class="big">${r.netP25 == null ? '–' : `${r.netP25 > 0 ? '+' : ''}${Math.round(r.netP25 * (state.settings.mc.amount || 10000)).toLocaleString('it-IT')} €`}</b>${r.netP25 == null ? '' : `<span class="eur">${pct(r.netP25, true)}</span>`}</td>
        <td class="num">${r.balancedOverLoss == null ? '–' : r.balancedOverLoss === Infinity || r.balancedOverLoss > 99 ? '<span class="pos" title="Perdita massima quasi nulla (monetari, obbligazionari brevissimi): valore altissimo, ma il guadagno è piccolo">&gt;99</span>' : `<span class="${r.balancedOverLoss >= 1 ? 'pos' : r.balancedOverLoss < 0 ? 'neg' : ''}">${nf2.format(r.balancedOverLoss)}</span>`}</td>
        <td class="num">${r.meanOverLoss == null ? '–' : r.meanOverLoss === Infinity || r.meanOverLoss > 99 ? '<span class="pos" title="Perdita massima quasi nulla (monetari, obbligazionari brevissimi): valore altissimo, ma il guadagno è piccolo">&gt;99</span>' : `<span class="${r.meanOverLoss >= 1 ? 'pos' : r.meanOverLoss < 0 ? 'neg' : ''}">${nf2.format(r.meanOverLoss)}</span>`}</td>
        <td><span class="pill">${TYPE_LABEL[i.type]}</span></td>
        <td class="num">${eur(r.price)}</td>
        <td class="num ${cls(r.change)}">${pct(r.change, true, 2)}</td>
        <td class="num ${cls(r.varM)}">${pct(r.varM, true)}</td>
        <td class="num ${cls(r.varM3)}">${pct(r.varM3, true)}</td>
        <td class="num ${cls(r.varY)}">${pct(r.varY, true)}</td>
        <td class="num ${cls(r.expected)}">${pct(r.expected, true)}</td>
        <td class="num neg">${r.maxLoss != null ? '−' + pct(r.maxLoss) + eurAmt(-r.maxLoss) : '–'}</td>
        <td class="num neg">${r.mddMedian != null ? '−' + pct(r.mddMedian) + eurAmt(-r.mddMedian) : '–'}</td>
        <td class="num ${cls(r.netGain)}">${pct(r.netGain, true)}${eurAmt(r.netGain)}</td>
        <td class="num ${cls(r.netMean)}">${pct(r.netMean, true)}${eurAmt(r.netMean)}</td>
        <td class="num">${ratioCell}</td>
        <td class="num">${r.ratioFinal == null ? '–' : r.ratioFinal === Infinity ? '<span class="neg">∞</span>' : r.ratioFinal === 0 ? '<span class="pos" title="Nessuna perdita a fine 5 anni nemmeno nel caso sfavorevole (5% peggiore): tipico di monetari e obbligazionari a breve, che però guadagnano poco">0 ✓</span>' : `<span class="${r.ratioFinal < 1 ? 'pos' : ''}">${nf2.format(r.ratioFinal)}</span>`}</td>
        <td class="num ${cls(r.balanced)}"><b>${pct(r.balanced, true)}</b>${eurAmt(r.balanced)}</td>
        <td class="num">${r.ratioMedian == null ? '–' : r.ratioMedian === Infinity ? '<span class="neg">∞</span>' : nf2.format(r.ratioMedian)}</td>
        <td class="num">${pct(r.probLoss, false, 0)}</td>
        <td class="num">${pct(r.prob25, false, 0)}</td>
        <td class="num">${pct(r.prob50, false, 0)}</td>
        <td class="num ${cls(r.sharpe)}">${r.sharpe == null ? '–' : nf2.format(r.sharpe)}</td>
        <td class="num ${cls(r.sortino)}">${r.sortino == null ? '–' : nf2.format(r.sortino)}</td>
      </tr>`;
    })
    .join('');
  $('#empty').hidden = rows.length > 0;
  if ($('#filters-count')) {
    const n = activeFilters(state.view.filters).length;
    $('#filters-count').hidden = !n;
    $('#filters-count').textContent = n;
  }
  const moreBtn = $('#btn-more');
  moreBtn.hidden = rows.length <= state.view.limit;
  moreBtn.textContent = `Mostra altri (${rows.length - visible.length} rimanenti)`;

  for (const t of ['all', 'stock', 'etf', 'bond', 'crypto', 'growth', 'lev']) {
    $(`[data-count="${t}"]`).textContent = state.instruments.filter((i) => {
      if (t === 'growth') return i.growth != null;
      if (t === 'lev') return !!i.leveraged && i.type === 'etf'; // sempre contati, anche senza composizione
      if (t === 'bond') return isBond(i); // i bond si contano tutti, anche senza stima dalla composizione
      if (t === 'etf' && isBond(i)) return false; // i bond sono contati nella loro scheda
      const typeOk = t === 'all' || i.type === t;
      return typeOk && (state.view.allEtf || i.type !== 'etf' || hasHoldingsEstimate(i));
    }).length;
  }
  if (state.instruments.length) try { updateNotifsBadge(); } catch { /* niente */ }
  if (!state.alertsInit && state.instruments.length && Object.keys(state.quotes).length) { state.alertsInit = true; setTimeout(() => checkSellAlerts(), 0); }
  const th0 = $('#table th[data-sort="projOpt"], #table th[data-sort="maxGrowth"]');
  if (th0) {
    const mg = mgMode();
    th0.dataset.sort = mg ? 'maxGrowth' : 'projOpt';
    const l = th0.querySelector('.l');
    const sh = th0.querySelector('.s');
    if (l) l.textContent = mg ? 'Max Growth Score' : 'Rendimento netto corretto per il rischio';
    if (sh) sh.textContent = mg ? 'Max Growth' : 'Rend. rischio';
  }
  $$('#table th').forEach((th) => {
    const on = th.dataset.sort === state.view.sort.key;
    th.classList.toggle('sorted', on);
    th.dataset.dir = on ? (state.view.sort.dir > 0 ? '▲' : '▼') : '';
  });
}

function visibleSymbols() {
  const rows = sortRows(filtered().map(rowValues)).slice(0, state.view.limit);
  return rows.map((r) => r.inst.symbol);
}

// ---------- dettaglio
async function openDetail(symbol) {
  const inst = state.instruments.find((i) => i.symbol === symbol);
  if (!inst) return;
  const dlg = $('#detail');
  $('#d-title').textContent = inst.name;
  $('#d-sub').innerHTML = `${esc(inst.symbol)}${inst.isin ? ' · ' + esc(inst.isin) : ''} · ${TYPE_LABEL[inst.type]}${inst.note ? ` · <span class="neg">${esc(inst.note)}</span>` : ''}`;
  $('#d-body').innerHTML = '<p class="muted">Calcolo in corso…</p>';
  detailInst = inst;
  preloadCss();
  updateShareUi(true);
  dlg.showModal();
  try {
    let r = state.results[inst.symbol];
    if (!r || r.error || !r.sim.fan) r = await analyzeOne(inst);
    saveResults();
    render();
    if (r.error) {
      $('#d-body').innerHTML = `<p class="neg">${esc(r.error)}</p>${estimateHtml(r.estimate, inst)}${removeButton(inst)}`;
      bindRemove(inst);
      return;
    }
    renderDetail(inst, r, state.data.get(inst.symbol));
  } catch (e) {
    const est = state.results[inst.symbol]?.estimate;
    $('#d-body').innerHTML = `<p class="neg">${est ? 'Nessun dato di prezzo disponibile per questo strumento' : 'Impossibile recuperare i dati: ' + esc(e.message)}</p>${estimateHtml(est, inst)}${removeButton(inst)}`;
    bindRemove(inst);
  }
}

// ---------- «Condividi» nella scheda dello strumento: Watch list + file della scheda
// Il file è una pagina HTML autonoma (grafici compresi). Sul PC (Edge/Chrome) si scrive direttamente nella cartella scelta
// una volta sola, per esempio D:\Strumenti preferiti; sul telefono si apre il menu di condivisione del sistema
// (File, posta, Drive…) o parte il download: un sito non può scrivere da solo sul disco di un altro dispositivo.
let detailInst = null;
let cardCss = null;
const CARD_CSS_MIN = 'body{font-family:system-ui,sans-serif;line-height:1.4;color:#16202c}.muted{color:#667}.pos{color:#0a7d4f}.neg{color:#b3261e}.kpis{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:10px}.kpi,.card{border:1px solid #d9dde3;border-radius:10px;padding:10px;margin-bottom:10px}.kpi .v{font-size:20px;font-weight:700}table{border-collapse:collapse;width:100%}td,th{padding:4px 6px;border-bottom:1px solid #e6e9ee;text-align:left}.num{text-align:right}';
function preloadCss() {
  if (cardCss != null) return;
  cardCss = '';
  fetch('styles.css')
    .then((r) => (r.ok ? r.text() : ''))
    .then((t) => {
      cardCss = t;
    })
    .catch(() => {
      /* resta lo stile minimo */
    });
}
function shareMsg(html) {
  const el = $('#d-share-msg');
  if (!el) return;
  el.hidden = !html;
  el.innerHTML = html || '';
}
function updateShareUi(reset = false) {
  const on = !!detailInst && watchSet.has(detailInst.symbol);
  const b = $('#d-share');
  if (b) b.textContent = on ? '⭐ Condividi' : '☆ Condividi';
  const u = $('#d-unwatch');
  if (u) u.hidden = !on;
  if (reset) shareMsg(on ? `⭐ ${esc(watchSince(watchItem(detailInst.symbol), state.quotes[detailInst.symbol]?.priceEur))}` : '');
}
function buildCard(inst, now) {
  const src = $('#d-body');
  const clone = src.cloneNode(true);
  const canv = [...src.querySelectorAll('canvas')];
  [...clone.querySelectorAll('canvas')].forEach((cv, k) => {
    const img = document.createElement('img');
    img.className = 'chart';
    img.alt = 'grafico';
    try {
      img.src = canv[k].toDataURL('image/png');
    } catch {
      /* grafico non esportabile: resta il testo */
    }
    cv.replaceWith(img);
  });
  clone.querySelectorAll('button, input, select, script').forEach((el) => el.remove());
  return cardDocument({
    title: inst.name,
    sub: $('#d-sub').textContent,
    bodyHtml: clone.innerHTML,
    css: cardCss || CARD_CSS_MIN,
    exportedAt: new Date(now).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
    dataAt: dataWhen(),
    source: /^https?:/.test(location.href) ? location.origin + location.pathname : '',
  });
}
// cartella scelta sul PC: resta salvata in questo browser (IndexedDB), il permesso di scrittura si conferma con un clic
function favDb() {
  return new Promise((res, rej) => {
    const q = indexedDB.open('trmc-fs', 1);
    q.onupgradeneeded = () => q.result.createObjectStore('kv');
    q.onsuccess = () => res(q.result);
    q.onerror = () => rej(q.error);
  });
}
async function favGet() {
  const db = await favDb();
  return new Promise((res, rej) => {
    const q = db.transaction('kv').objectStore('kv').get('favDir');
    q.onsuccess = () => res(q.result || null);
    q.onerror = () => rej(q.error);
  });
}
async function favSet(handle) {
  const db = await favDb();
  return new Promise((res, rej) => {
    const t = db.transaction('kv', 'readwrite');
    t.objectStore('kv').put(handle, 'favDir');
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
  });
}
async function favDir(pick) {
  let dir = pick ? null : await favGet().catch(() => null);
  if (dir) {
    let p = dir.queryPermission ? await dir.queryPermission({ mode: 'readwrite' }) : 'granted';
    if (p !== 'granted' && dir.requestPermission) p = await dir.requestPermission({ mode: 'readwrite' });
    if (p === 'granted') return dir;
  }
  dir = await window.showDirectoryPicker({ id: 'trmc-preferiti', mode: 'readwrite' });
  await favSet(dir).catch(() => {
    /* la cartella andrà scelta di nuovo la prossima volta */
  });
  return dir;
}
function downloadCard(html, name) {
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
async function shareCard({ pick = false, download = false } = {}) {
  const inst = detailInst;
  if (!inst) return;
  const now = Date.now();
  const was = watchSet.has(inst.symbol);
  setWatch(addWatch(watchList, inst, { now, price: state.quotes[inst.symbol]?.priceEur ?? null }));
  updateShareUi();
  setTimeout(render, 60); // stella accanto al nome e sezione «Watch list» aggiornate
  const name = cardFileName(inst, now);
  const html = buildCard(inst, now);
  const head = was ? '⭐ Già nella Watch list' : '⭐ Aggiunto alla Watch list';
  const fsApi = typeof window.showDirectoryPicker === 'function';
  if (download) {
    downloadCard(html, name);
    shareMsg(`${head} · scheda scaricata: <b>${esc(name)}</b>`);
    return;
  }
  if (fsApi) {
    try {
      if (pick || !(await favGet().catch(() => null))) shareMsg(`${head} · nella finestra che si apre scegli la cartella «${FAV_FOLDER}» sul disco D (si fa una volta sola)…`);
      const dir = await favDir(pick);
      const fh = await dir.getFileHandle(name, { create: true });
      const w = await fh.createWritable();
      await w.write(new Blob([html], { type: 'text/html' }));
      await w.close();
      shareMsg(`${head} · scheda salvata nella cartella «${esc(dir.name)}»: <b>${esc(name)}</b> <button type="button" class="ghost small" data-share="folder">Cambia cartella</button>`);
      return;
    } catch (e) {
      if (e?.name === 'AbortError') {
        shareMsg(`${head} · cartella non scelta, file non salvato. <button type="button" class="ghost small" data-share="folder">Scegli la cartella</button> <button type="button" class="ghost small" data-share="download">Scarica il file</button>`);
        return;
      }
      /* scrittura non riuscita (permesso negato, cartella spostata): si scarica il file */
    }
  }
  if (!fsApi) {
    try {
      const file = new File([html], name, { type: 'text/html' });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: inst.name });
        shareMsg(`${head} · scheda condivisa: <b>${esc(name)}</b>`);
        return;
      }
    } catch (e) {
      if (e?.name === 'AbortError') {
        shareMsg(`${head} · condivisione del file annullata. <button type="button" class="ghost small" data-share="download">Scarica il file</button>`);
        return;
      }
      /* condivisione non disponibile: si scarica il file */
    }
  }
  downloadCard(html, name);
  shareMsg(`${head} · scheda scaricata: <b>${esc(name)}</b> (cartella dei download di questo dispositivo)`);
}
function bindShare() {
  $('#d-share')?.addEventListener('click', () => shareCard());
  $('#d-unwatch')?.addEventListener('click', () => {
    if (!detailInst) return;
    setWatch(removeWatch(watchList, detailInst.symbol));
    updateShareUi();
    shareMsg('Tolto dalla Watch list (i file già salvati restano dove sono).');
    render();
  });
  $('#d-share-msg')?.addEventListener('click', (e) => {
    const k = e.target.closest('[data-share]')?.dataset.share;
    if (k === 'folder') shareCard({ pick: true });
    else if (k === 'download') shareCard({ download: true });
  });
}

// Versione online: richieste di aggiunta/rimozione come issue GitHub (gestite da manage-isin.yml).
function issueUrl(action, isin) {
  const repo = state.meta?.repo;
  if (!repo) return null;
  const title = `${action} ISIN ${isin}`;
  const body = `Richiesta inviata dall'app TR Monte Carlo.\n\nL'esito verrà scritto qui automaticamente in pochi minuti.`;
  return `https://github.com/${repo}/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
}

function removeButton(inst) {
  if (STATIC) {
    if (inst.source !== 'extra' || !inst.isin || !state.meta?.repo) return '';
    return `<p><button id="d-remove" class="ghost small">Rimuovi dalla lista</button> <span class="muted">(strumento aggiunto da te: la rimozione passa da GitHub)</span></p>`;
  }
  return `<p><button id="d-remove" class="ghost small">Rimuovi dalla lista</button></p>`;
}
function bindRemove(inst) {
  $('#d-remove')?.addEventListener('click', async () => {
    if (STATIC) {
      window.open(issueUrl('Rimuovi', inst.isin), '_blank', 'noopener');
      return;
    }
    await api(`/api/instruments?symbol=${encodeURIComponent(inst.symbol)}`, { method: 'DELETE' });
    state.instruments = state.instruments.filter((i) => i.symbol !== inst.symbol);
    delete state.results[inst.symbol];
    $('#detail').close();
    render();
  });
}

// Scheda: probabilità di rendimento netto a 1 e 3 anni, dalla distribuzione del modello delle previsioni (la stessa del
// «netto più probabile» di quel periodo); a 5 anni restano i 2.000 scenari simulati.
// Differenziale nei riquadri delle probabilità: probabilità di guadagno netto di almeno una soglia − probabilità di perdita,
// in punti percentuali (calcolato sui valori mostrati, così la riga torna con le due sopra). Soglia scelta dall'utente:
// +25% a 1 e 3 anni (su periodi brevi +50% è raro per quasi tutti gli strumenti), +50% a 5 anni.
const PROB_DIFF_SHORT = 0.25;
const PROB_DIFF_LONG = 0.5;
function probDiffRow(pGain, pLoss, label, threshold) {
  const p50 = pGain;
  if (p50 == null || pLoss == null || !Number.isFinite(p50) || !Number.isFinite(pLoss)) return '';
  const th = pct(threshold, true, 0);
  const pts = Math.round(p50 * 100) - Math.round(pLoss * 100);
  const sign = pts > 0 ? '+' : pts < 0 ? '−' : '';
  return `<div class="prob-row prob-diff" title="Differenziale a ${label}: probabilità di guadagno netto di almeno ${th} (${pct(p50, false, 0)}) − probabilità di perdita (${pct(pLoss, false, 0)}) = ${sign}${Math.abs(pts)} punti percentuali. Positivo: è più probabile guadagnare almeno il ${th} che chiudere in perdita."><span>differenziale: almeno ${th} − in perdita</span><div class="bar"><i class="${pts < 0 ? 'neg-bar' : ''}" style="width:${Math.min(100, Math.abs(pts))}%"></i></div><b class="${cls(pts)}">${sign}${Math.abs(pts)} pt</b></div>`;
}
function probCardShort(inst, days, label) {
  const dist = npCached(inst, days)?.dist;
  if (!dist) return '';
  const pa = PROB_THRESHOLDS.map((t) => probNetAtLeast(dist, t));
  if (pa.some((x) => x == null)) return '';
  const q = (p) => pct(netQuantile(dist, p), true);
  return `<div class="card">
        <h3>Probabilità di rendimento netto a ${label}</h3>
        <div class="prob-bars">
          <div class="prob-row"><span>in perdita</span><div class="bar"><i class="neg-bar" style="width:${((1 - pa[0]) * 100).toFixed(1)}%"></i></div><b>${pct(1 - pa[0], false, 0)}</b></div>
          ${PROB_THRESHOLDS.map((t, k) => `<div class="prob-row"><span>${t === 0 ? 'almeno pari (≥ 0%)' : 'almeno ' + pct(t, true, 0)}</span><div class="bar"><i style="width:${(pa[k] * 100).toFixed(1)}%"></i></div><b>${pct(pa[k], false, 0)}</b></div>`).join('')}
          ${probDiffRow(pa[PROB_THRESHOLDS.indexOf(PROB_DIFF_SHORT)], 1 - pa[0], label, PROB_DIFF_SHORT)}
        </div>
        <div class="legend"><span>5%: ${q(0.05)}</span><span>25%: ${q(0.25)}</span><span>mediana: ${q(0.5)}</span><span>75%: ${q(0.75)}</span><span>95%: ${q(0.95)}</span></div>
        <p class="muted small-note">Netto di costi e tasse, a ${label}: distribuzione del modello delle previsioni, la stessa del «netto più probabile» di questo periodo (previsione di analisti e fondamentali, volatilità dello strumento). La mediana è il netto più probabile della tabella. A ${simYears()} anni valgono invece i ${simCount()} scenari simulati. Stima, non una garanzia.</p>
      </div>`;
}
function renderDetail(inst, r, d) {
  const { sim, forward: f } = r;
  const s = state.settings;
  const q = state.quotes[inst.symbol];
  const fu = d?.fundamentals || {};
  const lossLabel = { mdd_p95: 'max drawdown, 95° percentile', mdd_median: 'max drawdown mediano', final_p5: 'perdita finale, 5% peggiore' }[s.mc.lossMetric];
  const amt = s.mc.amount;
  const nr5 = nr5Of(sim, inst.type);
  const kNr5 = nr5Weight(inst.type);
  const pp = projParams(inst, r);
  const pj = projOf(inst, r);
  const pj7 = pp ? project(pp, amt, 7) : null;
  const comp = f?.components || {};
  const w = f?.weights || {};
  const compRow = (label, key, note) =>
    `<tr><td>${label}</td><td class="num">${comp[key] != null ? pct(comp[key], true) : '<span class="muted">n.d.</span>'}</td><td class="num">${w[key] != null ? pct(w[key], false, 0) : '–'}</td><td class="muted">${note}</td></tr>`;

  $('#d-body').innerHTML = `
    <div class="kpis">
      <div class="kpi"><div class="k">Prezzo</div><div class="v">${eur(q?.priceEur ?? d.history.closesEur.at(-1))}</div><div class="h ${cls(q?.changePct)}">${q ? (q.changePct == null ? 'variazione di oggi non ancora disponibile' : pct(q.changePct, true, 2) + ' oggi') : 'ultima chiusura settimanale'}</div></div>
      ${pj ? `<div class="kpi kpi-main"><div class="k">CAGR netto atteso ${s.mc.years}a su ${eur(amt)}</div><div class="v ${cls(pj.netGain * (1 - Math.min(1, pp.mdd ?? 0)))}">${pj.netGain * (1 - Math.min(1, pp.mdd ?? 0)) > 0 ? '+' : ''}${Math.round(pj.netGain * (1 - Math.min(1, pp.mdd ?? 0))).toLocaleString('it-IT')} € (${pct((pj.netGain * (1 - Math.min(1, pp.mdd ?? 0))) / amt, true)})</div><div class="h">guadagno netto 019 <b>${pj.netGain > 0 ? '+' : ''}${Math.round(pj.netGain).toLocaleString('it-IT')} €</b> (${pct(pj.netPct, true)})${pp.mdd != null ? ` × (1 − MDD storico <b class="neg">${pct(pp.mdd, false, 0)}</b>)` : ' (MDD storico n.d.)'} · CAGR atteso <b>${pct(pp.cagr, false, 2)}</b> = ${pp.cagr > 0 ? '+' : ''}${Math.round(pp.cagr * amt).toLocaleString('it-IT')} €/anno · Modulo 1: CAGR atteso ${pct(pp.cagr, false, 2)} − TER ${pct(pp.ter, false, 2)} = ${pct(pp.net, false, 2)} · Modulo 2: ${eur(amt)} × (1 + ${pct(pp.net, false, 2)})^${s.mc.years} = ${eur(Math.round(pj.gross))}, plusvalenza ${eur(Math.round(pj.gain))} · Modulo 3: imposta ${pct(pp.tax, false, 1)} = ${eur(Math.round(pj.tax))} · a 7 anni: <b>${pj7.netGain > 0 ? '+' : ''}${Math.round(pj7.netGain).toLocaleString('it-IT')} €</b>${pp.mdd != null ? ` · Modulo 4: MDD storico <b class="neg">−${pct(pp.mdd, false, 0)}</b> → capitale minimo ${eur(Math.round(amt * (1 - pp.mdd)))}${pp.vol != null ? `, volatilità ${pct(pp.vol, false, 1)}` : ''}` : ''}</div></div>` : ''}
      ${nr5 != null ? `<div class="kpi kpi-main"><div class="k">Netto Reale 5A (NR5) su ${eur(amt)}</div><div class="v ${cls(nr5)}">${nr5 > 0 ? '+' : ''}${Math.round(nr5 * amt).toLocaleString('it-IT')} €</div><div class="h">guadagno netto medio ${pct(sim.netMean, true)} − ${fracLabel(kNr5)} × perdita media nel 5% peggiore ${pct(sim.es5)} · profilo: ${(NR5_MODES[state.view.nr5Mode] || NR5_MODES.std).label} · netto vero per scenario: tasse italiane, bollo, commissioni e spread</div></div>` : ''}
      ${sim.ce1 != null ? `<div class="kpi"><div class="k">Guadagno netto efficiente ${s.mc.years}a</div><div class="v ${cls(sim.ce?.['0.5'] ?? sim.ce1)}">${(sim.ce?.['0.5'] ?? sim.ce1) > 0 ? '+' : ''}${Math.round((sim.ce?.['0.5'] ?? sim.ce1) * amt).toLocaleString('it-IT')} €</div><div class="h">equivalente certo tarato sul backtest (γ=0,5: ${sim.ce?.['0.5'] != null ? pct(sim.ce['0.5'], true) : '–'}) · Kelly: <b>${sim.ce1 > 0 ? '+' : ''}${Math.round(sim.ce1 * amt).toLocaleString('it-IT')} €</b> · se accetti tutto il rischio (media): <b>${sim.netMean > 0 ? '+' : ''}${Math.round(sim.netMean * amt).toLocaleString('it-IT')} €</b> · se sei prudente: <b>${sim.ce3 > 0 ? '+' : ''}${Math.round(sim.ce3 * amt).toLocaleString('it-IT')} €</b>${f?.fundamentalsDetail?.evidence != null ? ` · crescita confermata dalle evidenze al ${pct(f.fundamentalsDetail.evidence, false, 0)}` : ''}</div></div>` : ''}
      <div class="kpi"><div class="k">Perdita massima ${s.mc.years}a</div><div class="v neg">−${pct(sim.maxLoss)}</div><div class="h">${lossLabel}</div></div>
      <div class="kpi"><div class="k">Drawdown mediano ${s.mc.years}a</div><div class="v neg">−${pct(sim.mddMedian)}</div><div class="h">perdita dal picco al minimo nello scenario tipico</div></div>
      ${f?.expected != null ? `<div class="kpi"><div class="k">Rendimento atteso</div><div class="v ${cls(f.expected)}">${pct(f.expected, true)}/anno</div><div class="h">come in tabella ("Atteso / anno") · su ${s.mc.years} anni ${pct((1 + f.expected) ** s.mc.years - 1, true)} lordo (prima di costi e tasse)</div></div>` : ''}
      <div class="kpi"><div class="k">Crescita utili attesa</div><div class="v ${cls(f?.expectedGrowth)}">${f?.expectedGrowth != null ? pct(f.expectedGrowth, true) + '/anno' : 'n.d.'}</div><div class="h">${f?.expectedGrowth == null ? (inst.type === 'crypto' ? 'le crypto non hanno utili' : 'strumento non azionario o dati insufficienti') : f.growthSource === 'market' ? 'crescita del mercato × β ' + nf2.format(f.beta) : f.growthSource === 'holdings' ? `dalle partecipazioni del fondo (stime analisti sul ${pct(f.fundamentalsDetail.coverage, false, 0)} del portafoglio)` : 'consenso analisti, prudenziale, prossimi 5 anni'}</div></div>
      <div class="kpi"><div class="k">${s.mc.gainMetric === 'mean' ? 'Guadagno medio' : 'Guadagno mediano'} ${s.mc.years}a (classifica)</div><div class="v ${cls(sim.netGain)}">${pct(sim.netGain, true)}</div><div class="h">${s.mc.gainMetric === 'mean' ? 'media' : 'mediana'} · ${eur(amt * (1 + sim.netGain))} da ${eur(amt)}</div></div>
      <div class="kpi"><div class="k">Guadagno medio ${s.mc.years}a</div><div class="v ${cls(sim.netMean)}">${pct(sim.netMean, true)}</div><div class="h">media di tutti gli scenari: la alzano pochi scenari molto favorevoli. Non è il valore più probabile: guarda la mediana e la probabilità di guadagno.</div></div>
      <div class="kpi"><div class="k">Guadagno netto probabile ${s.mc.years}a</div><div class="v ${cls(sim.netP25)}">${pct(sim.netP25, true)}</div><div class="h">ottenuto o superato nel 75% degli scenari · ${eur(amt * (1 + sim.netP25))}</div></div>
      <div class="kpi"><div class="k">Rapporto perdita/guadagno</div><div class="v">${Number.isFinite(sim.ratio) ? nf2.format(sim.ratio) : '∞'}</div><div class="h">più basso = migliore</div></div>
      <div class="kpi"><div class="k">Rapporto perdita finale/guadagno</div><div class="v">${Number.isFinite(sim.ratioFinal) ? nf2.format(sim.ratioFinal) : '∞'}</div><div class="h">perdita a fine ${s.mc.years} anni nel 5% peggiore (${sim.finalLoss > 0 ? '−' + pct(sim.finalLoss) + ', ' + eur(amt * (1 - sim.finalLoss)) : 'nessuna perdita'}) ÷ guadagno mediano</div></div>
      ${sim.balanced != null ? `<div class="kpi"><div class="k">Guadagno bilanciato crescita/rischio ${s.mc.years}a</div><div class="v ${cls(sim.balanced)}">${pct(sim.balanced, true)}</div><div class="h">guadagni attesi ${pct(sim.expGain, true)} − 2,25 × perdite attese ${pct(sim.expLoss)} (su tutti gli scenari)</div></div>` : ''}
      <div class="kpi"><div class="k">Indice di Sharpe / Sortino</div><div class="v">${sim.sharpe != null ? nf2.format(sim.sharpe) : '–'} / ${sim.sortino != null ? nf2.format(sim.sortino) : '–'}</div><div class="h">(rendimento atteso − tasso privo di rischio) ÷ volatilità, ÷ deviazione negativa</div></div>
      <div class="kpi"><div class="k">Guadagno corretto per il rischio ${s.mc.years}a</div><div class="v ${cls(sim.netMedian - sim.finalLoss)}">${pct(sim.netMedian - sim.finalLoss, true)}</div><div class="h">guadagno tipico ${pct(sim.netMedian, true)} − perdita finale sfavorevole ${pct(sim.finalLoss)}</div></div>
      <div class="kpi"><div class="k">Rapporto drawdown mediano/guadagno</div><div class="v">${sim.netGain > 0 ? nf2.format(sim.mddMedian / sim.netGain) : '∞'}</div><div class="h">perdita tipica / guadagno tipico, più basso = migliore</div></div>
      <div class="kpi"><div class="k">Probabilità di perdita</div><div class="v">${pct(sim.probLoss, false, 0)}</div><div class="h">a fine orizzonte, netto costi</div></div>
      ${(() => {
        // Variazioni del prezzo lorde, in EUR: le stesse grandezze dei grafici di Trade Republic (il netto di costi e tasse sotto)
        const rv = rowValues(inst);
        const pf = q?.perf || {};
        if (pf.w == null && pf.m == null && pf.ytd == null) return '';
        const g = (label, v) => `<span>${label} <b class="${cls(v)}">${pct(v, true, 2)}</b></span>`;
        return `<div class="kpi"><div class="k">Variazione del prezzo</div><div class="perf-list">${g('1 settimana', pf.w)}${g('1 mese', pf.m)}${g('3 mesi', pf.m3)}${g('1 anno', pf.y)}${g('da inizio anno', pf.ytd)}</div><div class="h">in EUR fino al prezzo attuale, come nei grafici di Trade Republic. Al netto di costi e tasse: 1 settimana ${pct(rv.perfW, true)}, 1 mese ${pct(rv.perfM, true)}, da inizio anno ${pct(rv.perfYtd, true)}</div></div>`;
      })()}
    </div>
    <div class="grid2">
      <div class="card">
        <h3>Ventaglio Monte Carlo (${s.mc.sims.toLocaleString('it-IT')} scenari)</h3>
        <canvas id="c-fan"></canvas>
        <div class="legend"><span><i style="background:var(--fan-outer)"></i>5–95%</span><span><i style="background:var(--fan-inner)"></i>25–75%</span><span><i style="background:var(--chart-line)"></i>mediana</span></div>
      </div>
      <div class="card">
        <h3>Distribuzione del guadagno netto a ${s.mc.years} anni</h3>
        <canvas id="c-hist"></canvas>
        <div class="legend"><span>5%: ${pct(sim.netP5, true)}</span><span>25%: ${pct(sim.netP25, true)}</span><span>mediana: ${pct(sim.netMedian, true)}</span><span>75%: ${pct(sim.netP75, true)}</span><span>95%: ${pct(sim.netP95, true)}</span></div>
      </div>
      ${probCardShort(inst, 365, '1 anno')}
      ${probCardShort(inst, 1095, '3 anni')}
      ${sim.probAtLeast ? `<div class="card">
        <h3>Probabilità di rendimento netto a ${s.mc.years} anni</h3>
        <div class="prob-bars">
          <div class="prob-row"><span>in perdita</span><div class="bar"><i class="neg-bar" style="width:${(sim.probLoss * 100).toFixed(1)}%"></i></div><b>${pct(sim.probLoss, false, 0)}</b></div>
          ${PROB_THRESHOLDS.map((t, k) => `<div class="prob-row"><span>${t === 0 ? 'almeno pari (≥ 0%)' : 'almeno ' + pct(t, true, 0)}</span><div class="bar"><i style="width:${(sim.probAtLeast[k] * 100).toFixed(1)}%"></i></div><b>${pct(sim.probAtLeast[k], false, 0)}</b></div>`).join('')}
          ${probDiffRow(sim.probAtLeast[PROB_THRESHOLDS.indexOf(PROB_DIFF_LONG)], sim.probLoss, `${s.mc.years} anni`, PROB_DIFF_LONG)}
        </div>
        <p class="muted small-note">Netto di costi e tasse, su ${s.mc.sims.toLocaleString('it-IT')} scenari: il rendimento atteso include le prospettive di crescita${inst.type === 'etf' && f?.growthSource === 'holdings' ? ' delle partecipazioni' : ''}, il ventaglio include il rischio di perdita stimato (volatilità e drawdown).</p>
      </div>` : ''}
      ${f?.fundamentalsDetail?.source === 'holdings' && f.fundamentalsDetail.top?.length ? `<div class="card">
        <h3>Prospettive delle partecipazioni</h3>
        <table class="mini">
          <thead><tr><th>Titolo</th><th class="num">Peso</th><th class="num">Crescita utili</th><th class="num">Atteso / anno</th></tr></thead>
          <tbody>${f.fundamentalsDetail.top.map((h) => `<tr><td>${esc(h.symbol)}</td><td class="num">${pct(h.weight, false, 1)}</td><td class="num ${cls(h.growth)}">${pct(h.growth, true)}</td><td class="num ${cls(h.expected)}">${pct(h.expected, true)}</td></tr>`).join('')}</tbody>
        </table>
        <p class="muted small-note">Prime partecipazioni con stime degli analisti (crescita prudenziale, in rallentamento verso il lungo periodo). Copertura ${pct(f.fundamentalsDetail.coverage, false, 0)} del fondo; il resto segue crescita del mercato e P/E del fondo.</p>
      </div>` : ''}
      <div class="card">
        <h3>Verifica dei tre fattori: fisco, asimmetria del rischio, qualità della crescita</h3>
        <table class="mini"><tbody>
          ${(() => {
            const ok = (b) => (b ? '<span class="pos">✓</span>' : '<span class="neg">⚠</span>');
            const rows = [];
            // 1) Fisco italiano
            const dist = sim.distYield > 0;
            rows.push(`<tr><td>${ok(!dist || sim.distDrag < 0.004)}</td><td>Fisco (${sim.taxRate != null && sim.taxRate !== 26 ? `aliquota effettiva ${nf1.format(sim.taxRate)}%: quota di titoli di Stato al 12,5%` : '26% sui guadagni'}${dist ? ', dividendi tassati all\'incasso' : ''})</td><td class="muted">${inst.type === 'crypto' ? 'tassa del 26% sulle plusvalenze applicata a fine periodo' : dist ? `strumento a distribuzione (${pct(sim.distYield)}/anno): dividendi tassati al 26% a ogni stacco e non reinvestiti, già nel netto di ogni scenario` : 'accumulazione: tassa del 26% solo alla vendita, nessun aggravio'}</td></tr>`);
            // 2) Asimmetria del rischio
            const asym = Number.isFinite(sim.ratioFinal) ? sim.ratioFinal : Infinity;
            for (const [d, l] of [[365, '1 anno'], [1095, '3 anni']]) {
              const x = rgCached(inst, d);
              const a1 = asymOf(x);
              if (a1 == null) continue;
              rows.push(`<tr><td>${ok(a1 < 1)}</td><td>Asimmetria del rischio a ${l}</td><td class="muted">perdita a fine ${l} nel 5% peggiore −${pct(x.finalLoss)} contro guadagno tipico ${pct(x.median, true)} (rapporto ${asymFmt(a1)}); dalla distribuzione del modello delle previsioni</td></tr>`);
            }
            rows.push(`<tr><td>${ok(asym < 1)}</td><td>Asimmetria del rischio a ${s.mc.years} anni</td><td class="muted">perdita a fine ${s.mc.years} anni nel 5% peggiore −${pct(sim.finalLoss)} contro guadagno tipico ${pct(sim.netMedian, true)} (rapporto ${Number.isFinite(asym) ? nf2.format(asym) : '∞'}); calo temporaneo massimo −${pct(sim.maxLoss)}, da sopportare senza vendere</td></tr>`);
            // 3) Qualità della crescita (value trap)
            const y = fu.dividendYield || 0;
            const g = f?.expectedGrowth ?? null;
            const trap = y > 0.06 && (g == null || g < 0.03);
            const px = d?.history?.closesEur || [];
            const r5 = px.length > 260 ? px.at(-1) / px[px.length - 1 - 260] - 1 : null;
            rows.push(`<tr><td>${ok(!trap && (g == null || g >= 0.02))}</td><td>Qualità della crescita</td><td class="muted">crescita utili attesa ${g != null ? pct(g, true) + '/anno' : 'n.d.'}${f?.fundamentalsDetail?.evidence != null ? ` (confermata dalle evidenze al ${pct(f.fundamentalsDetail.evidence, false, 0)})` : ''}${f?.growthSource === 'holdings' ? ', dalle partecipazioni del fondo' : ''}; dividendo ${pct(y)}${trap ? ' — dividendo alto senza crescita: possibile value trap' : ''}; rendimento reale ultimi 5 anni ${r5 != null ? pct(r5, true) : 'n.d. (storico più corto)'}</td></tr>`);
            return rows.join('');
          })()}
        </tbody></table>
        ${nr5 != null ? (() => {
          const e = (x) => `${x > 0 ? '+' : ''}${Math.round(x * amt).toLocaleString('it-IT')} €`;
          return `<table class="mini"><tbody>
            <tr><td>Guadagno netto medio su ${s.mc.sims.toLocaleString('it-IT')} scenari (netto vero: ${sim.distYield > 0 ? `26% sui dividendi a ogni stacco e non reinvestiti, ` : ''}${sim.taxRate != null && sim.taxRate !== 26 ? `${nf1.format(sim.taxRate)}% effettivo alla vendita con 12,5% sulla quota di titoli di Stato` : '26% sulla plusvalenza alla vendita'}, nessun credito se in perdita, bollo 0,20%/anno, commissioni e spread)</td><td class="num ${cls(sim.netMean)}">${e(sim.netMean)}</td></tr>
            <tr><td>− attenuazione dei guadagni estremi (oltre il 75° percentile pesano sempre meno: evita i titoli-lotteria)</td><td class="num ${sim.netMean - (sim.expGain - sim.expLoss) > 0.0005 ? 'neg' : ''}">${sim.netMean - (sim.expGain - sim.expLoss) > 0.0005 ? e(-(sim.netMean - (sim.expGain - sim.expLoss))) : '0 €'}</td></tr>
            <tr><td>− ${fracLabel(kNr5)}${inst.type === 'stock' ? ' (azione singola)' : ''} × perdita media nel 5% peggiore degli scenari (−${pct(sim.es5)}) · profilo «${(NR5_MODES[state.view.nr5Mode] || NR5_MODES.std).label}»</td><td class="num neg">${e(-kNr5 * sim.es5)}</td></tr>
            <tr><th>= Netto Reale 5A (NR5)</th><th class="num ${cls(nr5)}">${e(nr5)}</th></tr>
          </tbody></table>`;
        })() : ''}
      </div>
      ${pp && inst.type !== 'crypto' ? `<div class="card"><h3>Valutazione del rischio (stress test e tempo di recupero)</h3>${stressTable({ beta: f?.beta, netCagr: pp.net, capital: amt })}</div>` : ''}
      <div class="card">
        <h3>Stima prospettica del rendimento annuo</h3>
        <table class="mini">
          <thead><tr><th>Componente</th><th class="num">Atteso</th><th class="num">Peso</th><th>Fonte</th></tr></thead>
          <tbody>
            ${compRow('Storico', 'history', f?.mode === 'forward' ? `${sim.historyYears.toFixed(1)} anni, grezzo ${pct(f.historyRaw, true)}, credibilità ${pct(f.credibility, false, 0)}` : `${sim.historyYears.toFixed(1)} anni di dati`)}
            ${f?.mode === 'forward' ? compRow('Equilibrio', 'equilibrium', inst.type === 'crypto' ? `risk-free ${s.outlook.riskFree}% + premio crypto ${s.outlook.cryptoPremium}%` : `risk-free ${s.outlook.riskFree}% + β ${nf2.format(f.beta)} × ${s.outlook.equityPremium}%`) : ''}
            ${f?.mode === 'forward' ? compRow('Analisti', 'analysts', fu.analysts ? `${fu.analysts} analisti, target ${nf2.format(fu.targetMean)} ${esc(fu.currency || '')} (${pct(f.analystUpside, true)}), ${esc(fu.recommendation || '')}` : 'nessuna copertura') : ''}
            ${f?.mode === 'forward' ? compRow('Crescita e valutazione', 'fundamentals', f.fundamentalsDetail?.source === 'holdings' ? `partecipazioni del fondo: crescita utili ponderata +${pct(f.fundamentalsDetail.growth, false)}/anno (stime analisti sul ${pct(f.fundamentalsDetail.coverage, false, 0)} del portafoglio, il resto come il mercato)${f.fundamentalsDetail.pe ? `, P/E del fondo ${nf2.format(f.fundamentalsDetail.pe)}` : ''}` : f.fundamentalsDetail?.source === 'market' ? `prospettive di crescita e valutazione del mercato azionario (${pct(f.fundamentalsDetail.market, true)}/anno) × β ${nf2.format(f.fundamentalsDetail.beta)}` : f.fundamentalsDetail ? `utili +${pct(f.fundamentalsDetail.growth, false)}/anno (stima analisti ${pct(f.fundamentalsDetail.growthInput, true)}, in rallentamento), P/E ${nf2.format(f.fundamentalsDetail.pe)} → ${nf2.format(f.fundamentalsDetail.peTarget)} (${pct(f.fundamentalsDetail.valuation, true)}/anno), dividendo ${pct(f.fundamentalsDetail.dividend)}` : (inst.type === 'crypto' ? 'non applicabile: le crypto non hanno utili né dividendi' : 'dati insufficienti')) : ''}
            <tr><th>Rendimento atteso</th><th class="num">${pct(f?.expected, true)}</th><th></th><th></th></tr>
            ${fu.revenueGrowthNext != null || fu.epsGrowthNext != null ? `<tr><td>Crescita ricavi anno prossimo</td><td class="num">${pct(fu.revenueGrowthNext, true)}</td><td></td><td class="muted">consenso analisti</td></tr>
            <tr><td>Crescita utili anno prossimo</td><td class="num">${pct(fu.epsGrowthNext, true)}</td><td></td><td class="muted">consenso analisti</td></tr>` : ''}
            ${fu.growthLongTerm != null ? `<tr><td>Crescita utili a lungo termine</td><td class="num">${pct(fu.growthLongTerm, true)}</td><td></td><td class="muted">annua, 5 anni</td></tr>` : ''}
          </tbody>
        </table>
      </div>
      <div class="card">
        <h3>Volatilità e rischio</h3>
        <table class="mini"><tbody>
          <tr><td>Volatilità usata nella simulazione</td><td class="num">${pct(sim.annualVol)}</td></tr>
          <tr><td>Volatilità storica (lungo periodo)</td><td class="num">${pct(sim.histVol)}</td></tr>
          ${f?.mode === 'forward' ? `<tr><td>Volatilità recente (EWMA)</td><td class="num">${pct(f.sigmaEwma)}</td></tr>
          <tr><td>Volatilità implicita opzioni</td><td class="num">${f.sigmaImpl ? pct(f.sigmaImpl) + ` <span class="muted">(${fu.impliedVolDays} gg)</span>` : '<span class="muted">n.d.</span>'}</td></tr>
          <tr><td>Beta vs MSCI World (EUR)</td><td class="num">${f.betaRaw != null ? nf2.format(f.betaRaw) : 'n.d.'} <span class="muted">(aggiustato ${nf2.format(f.beta)})</span></td></tr>` : ''}
          <tr><td>Max drawdown storico (${nf2.format(sim.historyYears)} anni reali)</td><td class="num neg">−${pct(sim.historicalMdd)}</td></tr>
          ${sim.backfilledYears > 0.1 ? `<tr><td colspan="2" class="muted">Storico breve: per il rischio i ${nf2.format(sim.backfilledYears)} anni mancanti sono ricostruiti con ${sim.backfillProxy || "l'indice di riferimento"}, così le simulazioni includono anche crisi passate. Il rendimento atteso usa solo i dati reali.</td></tr>` : ''}
          <tr><td>Max drawdown simulato: mediano / 95°</td><td class="num neg">−${pct(sim.mddMedian)} / −${pct(sim.mddP95)}</td></tr>
          ${fu.dividendYield ? `<tr><td>Rendimento da dividendi</td><td class="num">${pct(fu.dividendYield)}</td></tr>` : ''}
          ${sim.distYield > 0 ? `<tr><td colspan="2" class="muted">Dividendi distribuiti (${pct(sim.distYield)}/anno): tassati al 26% a ogni stacco e NON reinvestiti (Trade Republic non lo fa in automatico): si accumulano in contanti e non compongono. È il motivo per cui, a parità di indice, l'accumulazione rende di più; già incluso nel netto di ogni scenario.</td></tr>` : ''}
        </tbody></table>
      </div>
      <div class="card" style="grid-column: 1 / -1">
        <h3>Storico prezzi in EUR (aggiustati per dividendi)</h3>
        <canvas id="c-price"></canvas>
      </div>
    </div>
    ${removeButton(inst)}`;
  bindRemove(inst);
  drawFan($('#c-fan'), sim.fan, s.mc.years);
  drawHist($('#c-hist'), sim.histogram);
  drawPrice($('#c-price'), d.history);
}

// ---------- backtest
async function openBacktest() {
  const dlg = $('#backtest');
  $('#bt-body').innerHTML = '<p class="muted">Caricamento…</p>';
  $('#bt-sub').textContent = '';
  dlg.showModal();
  try {
    if (!state.backtest) state.backtest = await api('/api/backtest');
    renderBacktest(state.backtest);
  } catch (e) {
    $('#bt-body').innerHTML = `<p class="neg">Backtest non disponibile: ${esc(e.message)}</p>`;
  }
}

function verdict(value, good, mid, higherIsBetter = true) {
  if (value == null) return '';
  const ok = higherIsBetter ? value >= good : value <= good;
  const so = higherIsBetter ? value >= mid : value <= mid;
  return ok ? 'good' : so ? 'mid' : 'bad';
}
const VERDICT_LABEL = { good: 'buono', mid: 'discreto', bad: 'debole' };
const num2 = (x) => (x == null ? '–' : nf2.format(x));

function renderBacktest(bt) {
  const f = bt.modes?.forward?.summary;
  const h = bt.modes?.historical?.summary;
  if (!f) {
    $('#bt-body').innerHTML = '<p class="muted">Nessuno strumento con storico sufficiente (servono almeno 7 anni).</p>';
    return;
  }
  const date = (t) => new Date(t * 1000).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' });
  $('#bt-sub').textContent = `Previsioni fatte con i soli dati disponibili il ${date(bt.t0)} e confrontate con com'è andata davvero nei 5 anni successivi · ${f.n.toLocaleString('it-IT')} strumenti`;
  const vRisk = verdict(f.risk.mddAboveP95, 0.08, 0.15, false);
  const vRange = verdict(f.returns.inside90, 0.8, 0.65);
  const vRank = verdict(f.returns.medianRankCorr, 0.3, 0.1);
  const card = (v, title, value, expl) => `<div class="verdict ${v}"><div class="muted">${title}<span class="tag">${VERDICT_LABEL[v] || ''}</span></div><b>${value}</b><div class="muted">${expl}</div></div>`;
  const row = (label, key, fmt, expected, group = 'risk') =>
    `<tr><td>${label}</td><td class="num">${expected}</td><td class="num"><b>${fmt(f[group][key])}</b></td><td class="num">${fmt(h?.[group]?.[key])}</td></tr>`;
  const p0 = (x) => pct(x, false, 0);
  const q = f.byProj019Mdd || f.byProj019 || f.byRatio;
  const qIs019 = !!(f.byProj019Mdd || f.byProj019);
  const types = bt.modes.forward.byType || {};
  const TYPE_NAMES = { stock: 'Azioni', etf: 'ETF/ETC', crypto: 'Crypto' };
  const cal = bt.calibration;
  const calInUse = bt.calibrationInUse?.meta;
  const PARAM_NAMES = { regimeUncertainty: 'Incertezza di regime (%)', weightHistory: 'Peso dello storico', equityPremium: 'Premio rischio azionario (%)', priorUncertainty: "Incertezza sull'equilibrio (%)", minStockBeta: 'Beta minimo azioni', ewmaWeight: 'Peso volatilità recente', volScale: 'Scala della volatilità' };

  $('#bt-body').innerHTML = `
    <div class="verdicts">
      ${card(vRisk, 'Stima del rischio', p0(f.risk.mddAboveP95), 'strumenti che hanno perso più dello scenario sfavorevole previsto (ideale ≈ 5%)')}
      ${card(vRange, 'Intervallo di rendimento', p0(f.returns.inside90), 'risultati reali dentro la forchetta prevista 5–95% (ideale ≈ 90%)')}
      ${card(vRank, 'Capacità di ordinare', num2(f.returns.medianRankCorr), 'correlazione tra guadagno previsto e reale (0 = nessuna, 1 = perfetta)')}
    </div>

    <h3>Rischio: le perdite previste erano realistiche?</h3>
    <div class="scroll"><table>
      <thead><tr><th></th><th class="num">Ideale</th><th class="num">Modello prospettico</th><th class="num">Solo storico</th></tr></thead>
      <tbody>
        ${row('Perdita max reale oltre lo scenario sfavorevole (95°)', 'mddAboveP95', p0, '≈ 5%')}
        ${row('Perdita max reale oltre quella mediana prevista', 'mddAboveMedian', p0, '≈ 50%')}
        ${row('Ordine: perdita prevista vs reale (correlazione)', 'mddRankCorr', num2, 'alta')}
        ${row('Ordine: volatilità prevista vs reale (correlazione)', 'volRankCorr', num2, 'alta')}
      </tbody></table></div>

    <h3>Rendimento: le forchette previste contenevano il risultato?</h3>
    <div class="scroll"><table>
      <thead><tr><th></th><th class="num">Ideale</th><th class="num">Modello prospettico</th><th class="num">Solo storico</th></tr></thead>
      <tbody>
        ${row('Risultato reale dentro la forchetta 5–95%', 'inside90', p0, '≈ 90%', 'returns')}
        ${row('Sotto lo scenario peggiore (5%)', 'belowP5', p0, '≈ 5%', 'returns')}
        ${row('Sopra lo scenario migliore (95%)', 'aboveP95', p0, '≈ 5%', 'returns')}
        ${row('Sopra la mediana prevista', 'aboveMedian', p0, '≈ 50%', 'returns')}
        ${row('Ordine: guadagno previsto vs reale (correlazione)', 'medianRankCorr', num2, 'alta', 'returns')}
        ${f.returns.proj019RankCorr != null ? row('Ordine: guadagno netto 019 (CAGR − TER, imposta) vs reale', 'proj019RankCorr', num2, 'alta', 'returns') : ''}
        ${f.returns.proj019MddRankCorr != null ? row('Ordine: CAGR netto atteso (netto 019 × (1 − MDD storico)) vs reale', 'proj019MddRankCorr', num2, 'alta', 'returns') : ''}
        ${f.returns.nr5RankCorr != null ? row('Ordine: NR5 previsto vs reale', 'nr5RankCorr', num2, 'alta', 'returns') : ''}
        <tr><td>Guadagno netto mediano: previsto → reale</td><td></td><td class="num"><b>${pct(f.returns.predNetMedian, true)} → ${pct(f.returns.realNetMedian, true)}</b></td><td class="num">${pct(h?.returns?.predNetMedian, true)} → ${pct(h?.returns?.realNetMedian, true)}</td></tr>
      </tbody></table></div>

    <h3>La classifica funziona? (5 gruppi secondo ${f.byProj019Mdd ? 'CAGR netto atteso previsto' : qIs019 ? 'il guadagno netto 019 previsto' : 'il rapporto previsto'})</h3>
    <div class="scroll"><table>
      <thead><tr><th>Gruppo</th><th class="num">${f.byProj019Mdd ? 'CAGR netto atteso previsto' : qIs019 ? 'Netto 019 previsto' : 'Rapporto previsto'}</th><th class="num">Guadagno reale medio</th><th class="num">Guadagno reale mediano</th><th class="num">Perdita max reale</th><th class="num">In perdita</th></tr></thead>
      <tbody>${q
        .map(
          (g, k) => `<tr><td>${k === 0 ? '1 (migliori)' : k === 4 ? '5 (peggiori)' : k + 1}</td><td class="num">${qIs019 ? pct(g.predicted, true) : g.predicted >= 1e8 ? '∞' : num2(g.predicted)}</td><td class="num ${cls(g.realNetMean)}">${pct(g.realNetMean, true)}</td><td class="num ${cls(g.realNetMedian)}">${pct(g.realNetMedian, true)}</td><td class="num neg">−${pct(g.realMddMedian)}</td><td class="num">${p0(g.realLossShare)}</td></tr>`,
        )
        .join('')}</tbody></table></div>

    <h3>Probabilità di perdita: prevista vs reale</h3>
    <div class="scroll"><table>
      <thead><tr><th>Prevista</th><th class="num">Strumenti</th><th class="num">Media prevista</th><th class="num">Finiti in perdita</th></tr></thead>
      <tbody>${f.probLoss.map((b) => `<tr><td>${p0(b.from)}–${p0(b.to)}</td><td class="num">${b.n}</td><td class="num">${p0(b.predicted)}</td><td class="num"><b>${p0(b.realized)}</b></td></tr>`).join('')}</tbody></table></div>

    ${
      bt.modes.forward.shortHistory
        ? (() => {
            const sh = bt.modes.forward.shortHistory;
            return `<h3>Storici brevi: stessi strumenti con solo 3 anni di dati</h3>
      <p class="muted">Verifica per ETF e titoli nati da poco: il rendimento dei pochi anni disponibili non deve essere proiettato tale e quale, e il rischio non deve essere sottostimato.</p>
      <div class="scroll"><table>
        <thead><tr><th></th><th class="num">Ideale</th><th class="num">Storico breve</th><th class="num">Storico completo</th></tr></thead>
        <tbody>
          <tr><td>Perdita max reale oltre lo scenario sfavorevole</td><td class="num">≈ 5%</td><td class="num"><b>${p0(sh.risk.mddAboveP95)}</b></td><td class="num">${p0(f.risk.mddAboveP95)}</td></tr>
          <tr><td>Risultato reale dentro la forchetta 5–95%</td><td class="num">≈ 90%</td><td class="num"><b>${p0(sh.returns.inside90)}</b></td><td class="num">${p0(f.returns.inside90)}</td></tr>
          <tr><td>Sopra la mediana prevista</td><td class="num">≈ 50%</td><td class="num"><b>${p0(sh.returns.aboveMedian)}</b></td><td class="num">${p0(f.returns.aboveMedian)}</td></tr>
          <tr><td>Guadagno mediano previsto → reale</td><td></td><td class="num"><b>${pct(sh.returns.predNetMedian, true)} → ${pct(sh.returns.realNetMedian, true)}</b></td><td class="num">${pct(f.returns.predNetMedian, true)} → ${pct(f.returns.realNetMedian, true)}</td></tr>
        </tbody></table></div>`;
          })()
        : ''
    }

    <h3>Per tipo di strumento (modello prospettico)</h3>
    <div class="scroll"><table>
      <thead><tr><th></th><th class="num">Strumenti</th><th class="num">Dentro 5–95%</th><th class="num">Oltre perdita sfavorevole</th><th class="num">Correlazione guadagno</th></tr></thead>
      <tbody>${Object.entries(types)
        .filter(([, v]) => v)
        .map(([t, v]) => `<tr><td>${TYPE_NAMES[t]}</td><td class="num">${v.n}</td><td class="num">${p0(v.returns.inside90)}</td><td class="num">${p0(v.risk.mddAboveP95)}</td><td class="num">${num2(v.returns.medianRankCorr)}</td></tr>`)
        .join('')}</tbody></table></div>

    <h3>Guadagno previsto (mediano) vs reale</h3>
    <canvas id="bt-scatter"></canvas>
    <div class="legend"><span>ogni punto è uno strumento · linea tratteggiata = previsione perfetta</span></div>

    <h3>Taratura automatica del modello</h3>
    ${
      cal
        ? `<p>Ultima taratura: ${new Date(cal.generatedAt).toLocaleDateString('it-IT')} · ${cal.sample.pool.toLocaleString('it-IT')} strumenti con storico sufficiente, previsioni da ${cal.origins.join(', ')} anni fa, taratura su ${cal.sample.train} strumenti e verifica su ${cal.sample.validation} mai usati nella taratura.</p>
      <p>Errore delle previsioni sugli strumenti di verifica: <b>${num2(cal.loss.validationBefore * 100)} → ${num2(cal.loss.validationAfter * 100)}</b> (${pct(cal.loss.improvement, true)} di miglioramento) · ${cal.adopted ? '<b class="pos">parametri adottati</b>' : '<b>parametri non adottati</b> (nessun miglioramento sui dati di verifica)'}</p>
      <div class="scroll"><table><thead><tr><th>Parametro</th><th class="num">Predefinito</th><th class="num">Tarato</th></tr></thead><tbody>
        ${Object.keys(cal.params.after).map((k) => `<tr><td>${PARAM_NAMES[k] || k}</td><td class="num">${cal.params.before[k]}</td><td class="num"><b>${cal.params.after[k]}</b></td></tr>`).join('')}
      </tbody></table></div>
      <p class="muted">Sugli strumenti di verifica: forchetta 5–95% ${p0(cal.validation.before.returns.inside90)} → ${p0(cal.validation.after.returns.inside90)}, perdite oltre lo scenario sfavorevole ${p0(cal.validation.before.risk.mddAboveP95)} → ${p0(cal.validation.after.risk.mddAboveP95)}.</p>`
        : '<p class="muted">La taratura automatica non è ancora stata eseguita.</p>'
    }
    ${calInUse ? `<p class="muted">Parametri in uso nell'app: ${bt.calibrationInUse.meta.adopted === false ? 'predefiniti' : 'tarati il ' + new Date(calInUse.generatedAt).toLocaleDateString('it-IT')}.</p>` : ''}

    <h3>Limiti di questo test</h3>
    <ul class="muted">
      <li>Le stime degli analisti di 5 anni fa non sono disponibili: qui il modello lavora senza (nell'app le usa).</li>
      <li>Si testano solo strumenti che esistono ancora oggi: chi è fallito o è stato tolto dal listino manca, quindi i risultati sono un po' ottimistici.</li>
      <li>I periodi di 5 anni si sovrappongono e vengono da un solo decennio (con un mercato azionario molto favorevole): un decennio diverso può dare risultati diversi.</li>
      <li>Un buon backtest non garantisce previsioni future altrettanto buone.</li>
    </ul>`;
  drawBacktestScatter($('#bt-scatter'), bt.points || []);
}

function drawBacktestScatter(c, points) {
  const { ctx, w, h, color } = setupCanvas(c);
  const pad = { l: 52, r: 10, t: 10, b: 28 };
  const lo = -1;
  const hi = 3;
  const X = (v) => pad.l + ((Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * (w - pad.l - pad.r);
  const Y = (v) => pad.t + (1 - (Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * (h - pad.t - pad.b);
  axes(ctx, color, pad, w, h, lo, hi, (v) => pct(v, true, 0));
  ctx.fillStyle = color.line;
  ctx.globalAlpha = 0.35;
  for (const p of points) {
    if (p[1] == null || p[2] == null) continue;
    ctx.fillRect(X(p[1]) - 1.5, Y(p[2]) - 1.5, 3, 3);
  }
  ctx.globalAlpha = 1;
  ctx.strokeStyle = color.muted;
  ctx.setLineDash([5, 4]);
  ctx.beginPath();
  ctx.moveTo(X(lo), Y(lo));
  ctx.lineTo(X(hi), Y(hi));
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = color.muted;
  ctx.fillText('previsto →', w - pad.r - 60, h - 6);
  ctx.fillText('reale ↑', 4, pad.t + 10);
}

// ---------- grafici (canvas)
function setupCanvas(c) {
  const dpr = window.devicePixelRatio || 1;
  const w = c.clientWidth;
  const h = c.clientHeight;
  c.width = w * dpr;
  c.height = h * dpr;
  const ctx = c.getContext('2d');
  ctx.scale(dpr, dpr);
  const css = getComputedStyle(document.documentElement);
  const v = (n) => css.getPropertyValue(n).trim();
  return { ctx, w, h, color: { line: v('--chart-line'), grid: v('--chart-grid'), muted: v('--muted'), outer: v('--fan-outer'), inner: v('--fan-inner'), neg: v('--neg'), pos: v('--pos') } };
}

function axes(ctx, color, pad, w, h, yMin, yMax, fmt) {
  ctx.font = '11px system-ui, sans-serif';
  ctx.fillStyle = color.muted;
  ctx.strokeStyle = color.grid;
  ctx.lineWidth = 1;
  for (let k = 0; k <= 4; k++) {
    const val = yMin + ((yMax - yMin) * k) / 4;
    const y = pad.t + (h - pad.t - pad.b) * (1 - k / 4);
    ctx.beginPath();
    ctx.moveTo(pad.l, y);
    ctx.lineTo(w - pad.r, y);
    ctx.stroke();
    ctx.fillText(fmt(val), 4, y + 4);
  }
}

function drawFan(c, fan, years) {
  const { ctx, w, h, color } = setupCanvas(c);
  const pad = { l: 52, r: 10, t: 10, b: 22 };
  const yMin = Math.min(-0.5, ...fan.map((p) => p.p5));
  const yMax = Math.max(0.5, ...fan.map((p) => p.p95));
  const X = (k) => pad.l + ((w - pad.l - pad.r) * k) / (fan.length - 1);
  const Y = (v) => pad.t + (h - pad.t - pad.b) * (1 - (v - yMin) / (yMax - yMin));
  axes(ctx, color, pad, w, h, yMin, yMax, (v) => pct(v, true, 0));
  const band = (lo, hi, fill) => {
    ctx.beginPath();
    fan.forEach((p, k) => (k ? ctx.lineTo(X(k), Y(p[hi])) : ctx.moveTo(X(k), Y(p[hi]))));
    for (let k = fan.length - 1; k >= 0; k--) ctx.lineTo(X(k), Y(fan[k][lo]));
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  };
  band('p5', 'p95', color.outer);
  band('p25', 'p75', color.inner);
  ctx.beginPath();
  fan.forEach((p, k) => (k ? ctx.lineTo(X(k), Y(p.p50)) : ctx.moveTo(X(k), Y(p.p50))));
  ctx.strokeStyle = color.line;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.strokeStyle = color.muted;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(pad.l, Y(0));
  ctx.lineTo(w - pad.r, Y(0));
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = color.muted;
  for (let y = 0; y <= years; y++) {
    const k = Math.round((y * 52) / 13);
    if (k < fan.length) ctx.fillText(`${y}a`, X(k) - 6, h - 6);
  }
}

function drawHist(c, hist) {
  const { ctx, w, h, color } = setupCanvas(c);
  const pad = { l: 10, r: 10, t: 10, b: 22 };
  const max = Math.max(...hist.counts);
  const bw = (w - pad.l - pad.r) / hist.counts.length;
  hist.counts.forEach((n, k) => {
    const x0 = hist.lo + k * hist.width;
    const bh = ((h - pad.t - pad.b) * n) / max;
    ctx.fillStyle = x0 + hist.width / 2 < 0 ? color.neg : color.line;
    ctx.globalAlpha = 0.75;
    ctx.fillRect(pad.l + k * bw + 1, h - pad.b - bh, bw - 2, bh);
  });
  ctx.globalAlpha = 1;
  ctx.fillStyle = color.muted;
  ctx.font = '11px system-ui, sans-serif';
  const hi = hist.lo + hist.width * hist.counts.length;
  ctx.fillText(pct(hist.lo, true, 0), pad.l, h - 6);
  const t = pct(hi, true, 0);
  ctx.fillText(t, w - pad.r - ctx.measureText(t).width, h - 6);
  if (hist.lo < 0 && hi > 0) {
    const x = pad.l + ((0 - hist.lo) / (hi - hist.lo)) * (w - pad.l - pad.r);
    ctx.fillText('0%', x - 8, h - 6);
  }
}

function drawPrice(c, history) {
  const { ctx, w, h, color } = setupCanvas(c);
  const pad = { l: 64, r: 10, t: 10, b: 22 };
  const ys = history.closesEur;
  const ts = history.timestamps;
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const X = (k) => pad.l + ((w - pad.l - pad.r) * k) / (ys.length - 1);
  const Y = (v) => pad.t + (h - pad.t - pad.b) * (1 - (v - yMin) / (yMax - yMin || 1));
  axes(ctx, color, pad, w, h, yMin, yMax, (v) => eur(v));
  ctx.beginPath();
  ys.forEach((v, k) => (k ? ctx.lineTo(X(k), Y(v)) : ctx.moveTo(X(k), Y(v))));
  ctx.strokeStyle = color.line;
  ctx.lineWidth = 1.6;
  ctx.stroke();
  ctx.fillStyle = color.muted;
  let lastYear = null;
  ts.forEach((t, k) => {
    const y = new Date(t * 1000).getFullYear();
    if (y !== lastYear && k > 0) ctx.fillText(String(y), X(k) - 12, h - 6);
    lastYear = y;
  });
}

// ---------- parametri
function fillSettings() {
  for (const el of $$('#settings-form [name]')) {
    const [g, k] = el.name.split('.');
    el.value = state.settings[g][k];
  }
}
function readSettings() {
  const s = { mc: { ...state.settings.mc }, outlook: { ...state.settings.outlook } };
  for (const el of $$('#settings-form [name]')) {
    const [g, k] = el.name.split('.');
    s[g][k] = el.type === 'number' ? Number(el.value) : el.value;
  }
  return s;
}

async function recomputeComputed() {
  const symbols = Object.keys(state.results);
  state.results = {};
  const list = state.instruments.filter((i) => symbols.includes(i.symbol));
  if (list.length) await runAll(list);
  else render();
}

// ---------- aggiunta / import
async function doSearch(q) {
  const ul = $('#search-results');
  ul.innerHTML = '<li class="muted">Ricerca…</li>';
  try {
    const res = await api(`/api/search?q=${encodeURIComponent(q)}`);
    const have = new Set(state.instruments.map((i) => i.symbol));
    ul.innerHTML = res.length
      ? res
          .map(
            (r, k) => `<li><div><strong>${esc(r.name)}</strong><div class="muted">${esc(r.symbol)} · ${esc(r.exchange || '')} · ${TYPE_LABEL[r.type]}</div></div>
            ${have.has(r.symbol) ? '<span class="muted">già presente</span>' : `<button class="small" data-k="${k}">Aggiungi</button>`}</li>`,
          )
          .join('')
      : '<li class="muted">Nessun risultato</li>';
    $$('button[data-k]', ul).forEach((b) =>
      b.addEventListener('click', async () => {
        const r = res[Number(b.dataset.k)];
        const isin = /^[A-Z]{2}[A-Z0-9]{9}\d$/.test(q.trim().toUpperCase()) ? q.trim().toUpperCase() : null;
        await api('/api/instruments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...r, isin }) });
        b.outerHTML = '<span class="pos">aggiunto</span>';
        await loadInstruments();
      }),
    );
  } catch (e) {
    ul.innerHTML = `<li class="neg">${esc(e.message)}</li>`;
  }
}

async function doImport(file) {
  const out = $('#import-result');
  out.textContent = 'Importazione in corso (la risoluzione degli ISIN può richiedere qualche minuto)…';
  try {
    const r = await api('/api/import', { method: 'POST', body: await file.text() });
    out.innerHTML = `Formato: <strong>${esc(r.format)}</strong> · righe valide: ${r.parsed} · aggiunti: <strong>${r.added}</strong>${r.unresolved.length ? ` · non risolti: ${r.unresolved.length}` : ''}${r.skipped ? ` · oltre il limite (ripeti l'import): ${r.skipped}` : ''}`;
    await loadInstruments();
  } catch (e) {
    out.innerHTML = `<span class="neg">${esc(e.message)}</span>`;
  }
}

function exportCsv() {
  const rows = sortRows(filtered().map(rowValues));
  const ranks = rankMap(rows);
  const num = (x) => (x == null || !Number.isFinite(x) ? '' : String(+x.toFixed(6)).replace('.', ','));
  const lines = [['Posizione', 'Nome', 'Simbolo', 'ISIN', 'Tipo', 'CAGR netto atteso 5a', 'Guadagno netto 019 5a', 'MDD storico', 'CAGR atteso', 'Prezzo EUR', 'Var. 1 mese', 'Var. 3 mesi', 'Var. 1 anno', 'Rendimento atteso annuo', 'Crescita utili attesa', 'Perdita max 5a', 'Drawdown mediano 5a', 'Guadagno mediano 5a', 'Guadagno medio 5a', 'Rapporto', 'Rapporto DD mediano', 'Prob. perdita', 'Rend. netto 1 settimana', 'Rend. netto 1 mese', 'Rend. netto YTD', ...NP_PERIODS.map(([, l]) => `Netto più probabile ${l}`)].join(';')];
  for (const r of rows) {
    lines.push([ranks.get(r.inst.symbol) ?? '', `"${r.inst.name.replace(/"/g, '""')}"`, r.inst.symbol, r.inst.isin || '', r.inst.type, num(r.proj), num(r.proj019), num(r.histMdd), num(r.cagr), num(r.price), num(r.varM), num(r.varM3), num(r.varY), num(r.expected), num(r.growthExp), num(r.maxLoss), num(r.mddMedian), num(r.netGain), num(r.netMean), r.ratio === Infinity ? 'inf' : num(r.ratio), r.ratioMedian === Infinity ? 'inf' : num(r.ratioMedian), num(r.probLoss), num(r.perfW), num(r.perfM), num(r.perfYtd), ...NP_KEYS.map((k) => num(r[k]))].join(';'));
  }
  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `classifica-tr-montecarlo-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** Tabella «Valutazione del rischio»: stress test e tempo di recupero (sezione 5 del documento). */
// Scenari storici (CAGR lordo fisso 2% / 7% / 10%) su una lista di strumenti [{amount, ter, tax}], per
// orizzonte: stesso algoritmo 019 (CAGR − TER, montante composto, imposta), i totali sono la somma.
const HIST_SCEN = [
  { label: 'Pessimistico (mercato laterale / crisi)', cagr: 0.02, note: 'CAGR lordo 2%: se i prossimi anni vanno male' },
  { label: 'Base (media storica reale)', cagr: 0.07, note: 'CAGR lordo 7%: rendimento storico netto dell\'azionario globale' },
  { label: 'Ottimistico (massimo guadagno)', cagr: 0.1, note: 'CAGR lordo 10%: scenario favorevole' },
];
// Orizzonti brevi (giorni): algoritmo con volatilità del modello e costi degli ordini (projection.js);
// da 1 anno in su resta l'algoritmo 019. `vol` = σ annua dello strumento (null se ignota).
// `mom` = tendenza recente dello strumento (rendimenti 1/4/13/26 settimane): per gli orizzonti brevi corregge il CAGR.
// `symTax`: ETC/ETN/ETP (non UCITS): minusvalenze compensabili. `momRho`: persistenza della tendenza (impostabile nel portafoglio).
const projectH = (prm, cap, y, vol = null, positions = 1, mom = null, symTax = false) => projectAny({ ...prm, ...(mom ? { mom } : {}), ...(symTax ? { symTax } : {}), ...(state.portfolio?.taxPrudent ? { taxPrudent: true } : {}) }, cap, y, { vol, orderCost: state.settings.mc.orderCost ?? 1, positions, momRho: state.portfolio?.momRho });
const projectPortfolioH = (args) => projectPortfolio({ momRho: state.portfolio?.momRho, taxPrudent: !!state.portfolio?.taxPrudent, ...args });
// Risultato utilizzabile dal portafoglio: la previsione completa oppure, con storico < 1 anno, la stima provvisoria
// (CAGR, volatilità, MDD calcolati sui dati disponibili). Altrimenti l'oggetto con l'errore (o null).
function resOf(inst) {
  const r = state.results[inst.symbol];
  if (r && !r.error) return r;
  // nessuna previsione: stima dallo storico/dataset (build) oppure, per strumenti aggiunti dopo, valore tipico della categoria
  const e = r?.estimate || priorEstimate({ instrument: inst, market: state.market?.expected, settings: state.settings });
  if (!e) return r ?? null;
  return { estimated: true, mom: e.mom ?? null, forward: { expected: e.cagr, vol: e.vol, beta: e.beta }, sim: { estimated: true, histMdd: e.mdd, taxRate: 26 }, ...(Number.isFinite(e.ter) ? { fund: { ter: e.ter } } : {}) };
}
// Prodotti strutturati a leva (ISIN non IE/LU): ETC/ETN/ETP con redditi diversi, minusvalenze compensabili con le plusvalenze
const symTaxOfInst = (inst) => !!(inst?.leveraged && inst.isin && !/^(IE|LU)/.test(inst.isin));
function symTaxOf(code) {
  return symTaxOfInst(findByCode(code));
}
// CAGR automatico della riga: con orizzonti brevi selezionati è il CAGR del modello corretto con la tendenza recente
// (cagrTrend = true, cagrLong = CAGR di lungo periodo usato per gli orizzonti ≥ 1 anno).
const rowCagr = (row, y) => (row.cagrTrend && !isShortHorizon(y) && Number.isFinite(row.cagrLong) ? row.cagrLong : row.cagr);
const rowMom = (row) => (row.cagrTrend ? null : momOfCode(row.isin)); // tendenza già inclusa nel CAGR automatico
const prmAt = (prm, row, y) => {
  const c = rowCagr(row, y);
  return c === prm.cagr ? prm : { ...prm, cagr: c, net: c - (prm.ter || 0) };
};
function momOfCode(code) {
  const inst = findByCode(code);
  return (inst && resOf(inst)?.mom) || null;
}
function volOfCode(code) {
  const inst = findByCode(code);
  const r = inst ? resOf(inst) : null;
  return inst && r && !r.error && Number.isFinite(r.forward?.vol) ? r.forward.vol : null;
}
// Rendimento lordo atteso per gli orizzonti brevi con la tendenza recente (il CAGR dell'input è quello di lungo periodo)
const rowPrm = (row, noTer = false) => {
  if (!Number.isFinite(row.cagr)) return null;
  const ter = noTer ? 0 : Number.isFinite(row.ter) ? row.ter : 0;
  return { cagr: row.cagr, ter, tax: Number.isFinite(row.tax) ? row.tax : 0.26, net: row.cagr - ter };
};
function shortNoteHtml(prm, quota, vol, mom, isin, years) {
  if (!prm || !(quota > 0)) return '';
  const parts = years.filter(isShortHorizon).map((y) => {
    const h = projectH(prm, quota, y, vol, 1, mom, symTaxOf(isin));
    return `${horizonShort(y)} <b class="${cls(h.mu)}">${pct(h.mu, true, 1)}</b> <span class="muted">(≈ ${pct((h.netUsed ?? 0) + (prm.ter || 0), true, 0)}/anno)</span>`;
  });
  return parts.length ? `<div class="muted small-note" title="Rendimento lordo atteso nel periodo: CAGR del modello corretto con la tendenza recente dello strumento (prima di imposta e costi). Il CAGR nel campo è quello di lungo periodo.">con tendenza recente: ${parts.join(' · ')}</div>` : '';
}
function histScenariosHtml(items, years) {
  const valid = (items || []).filter((i) => i.amount > 0);
  const cap = valid.reduce((a, i) => a + i.amount, 0);
  if (!(cap > 0)) return '';
  const fmt2 = (x) => eur(Math.round(x * 100) / 100);
  const netOf = (cg, y) => valid.reduce((a, i) => a + projectH({ cagr: cg, ter: Number.isFinite(i.ter) ? i.ter : 0, tax: Number.isFinite(i.tax) ? i.tax : 0.26, net: cg - (Number.isFinite(i.ter) ? i.ter : 0) }, i.amount, y).netGain, 0);
  return `<h4 class="pf-h4" style="margin-top:14px">Scenari storici (pessimistico 2% · base 7% · ottimistico 10%)</h4>
    <p class="muted small-note">Stesso algoritmo (CAGR lordo − TER, montante composto, imposta sulla plusvalenza) con un rendimento di mercato fisso uguale per tutti, mantenendo TER e aliquota di ciascuno. Il 7% è il rendimento reale storico netto dell'azionario globale.</p>
    ${years
      .map(
        (y) => `<p class="muted small-note" style="margin:10px 0 4px"><b>A ${horizonLong(y)}</b> (${eur(Math.round(cap))} investiti)</p>
    <table class="mini"><thead><tr><th>Scenario</th><th class="num">CAGR lordo</th><th class="num">Guadagno netto</th><th class="num">Capitale finale</th></tr></thead><tbody>${HIST_SCEN
      .map((sc) => { const g = netOf(sc.cagr, y); return `<tr><td>${sc.label}<div class="muted small-note">${sc.note}</div></td><td class="num">${pct(sc.cagr, false, 0)}</td><td class="num ${cls(g)}"><b>${g > 0 ? '+' : ''}${fmt2(g)}</b> (${pct(g / cap, true)})</td><td class="num">${fmt2(cap + g)}</td></tr>`; })
      .join('')}</tbody></table>`,
      )
      .join('')}`;
}
function stressTable({ beta, netCagr, capital, betaNote = '', profile = null }) {
  const rows = stressTest({ beta, netCagr, capital });
  const months = (m) => (m == null ? '<span class="neg">nessun recupero con questo CAGR</span>' : m === 0 ? '–' : `≈ ${Math.round(m)} mesi`);
  // L'azione operativa sul bear market si adatta al tipo di portafoglio (prudente → speculativo)
  const sopFor = (x) => (profile?.bear && x.market >= 0.3 ? profile.bear : x.sop);
  return `<table class="mini"><thead><tr><th>Evento di mercato</th><th class="num">Impatto (β ${nf2.format(rows[0].beta)}${betaNote})</th><th class="num">Capitale temporaneo</th><th class="num">Tempo di recupero</th><th>Azione operativa</th></tr></thead><tbody>${rows
    .map((x) => `<tr><td>${x.label} (mercato −${pct(x.market, false, 0)})</td><td class="num neg">−${pct(x.impact, false, 1)}</td><td class="num">${eur(Math.round(x.capitalAfter))}</td><td class="num">${months(x.recoveryMonths)}</td><td class="muted">${sopFor(x)}</td></tr>`)
    .join('')}</tbody></table>
  <p class="muted small-note">Impatto = β × calo del mercato. Tempo di recupero = mesi necessari a tornare al capitale iniziale componendo al CAGR netto pre-tasse (${pct(netCagr, false, 2)}): 12 × ln(1 ÷ (1 − impatto)) ÷ ln(1 + CAGR).</p>`;
}

// ---------- proiezione di portafoglio (algoritmo deterministico del documento PRJ-FIN-2026-018)
// Codice portafoglio condivisibile: solo strumenti, importi e valori impostati a mano; le stime del
// modello si risincronizzano all'apertura. Base64 URL-safe di un JSON compatto.
function encodePortfolio(p) {
  const slim = (arr) => (arr || []).filter((r) => r.isin && (r.amount > 0 || r.weight > 0)).map((r) => ({ i: r.isin, a: Math.round(r.amount || 0), ...(r.manual && r.manual.length ? { c: r.cagr, t: r.ter, x: r.tax, d: r.mdd, m: r.manual } : {}) }));
  const o = { y: p.years || [5, 7], e: slim(p.rows), s: slim(p.stocks), b: slim(p.bonds) };
  try {
    return btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  } catch {
    return '';
  }
}
function decodePortfolio(str) {
  let code = String(str || '').trim();
  const m = code.match(/[#?&]pf=([A-Za-z0-9_-]+)/); // accetta anche un link completo
  if (m) code = m[1];
  if (!code) return null;
  try {
    const json = decodeURIComponent(escape(atob(code.replace(/-/g, '+').replace(/_/g, '/'))));
    const o = JSON.parse(json);
    const toRows = (arr) => (arr || []).map((r) => ({ isin: r.i, name: '', amount: r.a, ter: r.t, cagr: r.c ?? null, tax: r.x, mdd: r.d ?? null, manual: r.m || [] }));
    return { capital: 0, years: Array.isArray(o.y) ? o.y : [5, 7], rows: toRows(o.e), stocks: toRows(o.s), bonds: toRows(o.b) };
  } catch {
    return null;
  }
}

function loadPortfolio() {
  try {
    const p = JSON.parse(localStorage.getItem('trmc.portfolio') || 'null');
    if (p && (p.rows?.length || p.stocks?.length || p.bonds?.length)) {
      p.rows = Array.isArray(p.rows) ? p.rows : [];
      p.stocks = Array.isArray(p.stocks) ? p.stocks : [];
      p.bonds = Array.isArray(p.bonds) ? p.bonds : [];
      return p;
    }
  } catch {
    /* niente */
  }
  return { ...JSON.parse(JSON.stringify(GEMINI_PORTFOLIO)), stocks: [], bonds: [] };
}
function savePortfolio(p) {
  try {
    localStorage.setItem('trmc.portfolio', JSON.stringify(p));
  } catch {
    /* niente */
  }
}
// Indice per codice (ISIN, simbolo, simbolo senza borsa, crypto senza valuta): con oltre 13.000 strumenti la ricerca
// lineare, ripetuta per ogni riga e periodo, bloccava l'app. Si ricostruisce quando cambia l'elenco degli strumenti.
let codeIdx = null;
function codeIndex() {
  const list = state.instruments || [];
  if (codeIdx && codeIdx.list === list && codeIdx.n === list.length) return codeIdx;
  const norm = (s) => String(s || '').toUpperCase().replace(/[\s-]/g, '');
  const isin = new Map();
  const sym = new Map();
  const crypto = new Map();
  const put = (m, k, i) => { if (k && !m.has(k)) m.set(k, i); };
  for (const i of list) put(isin, (i.isin || '').toUpperCase(), i);
  for (const i of list) {
    // stesso ordine di priorità della ricerca lineare: il primo strumento in elenco vince
    put(sym, norm(i.symbol), i);
    put(sym, String(i.symbol || '').toUpperCase().split('.')[0], i);
  }
  for (const i of list) if (i.type === 'crypto') put(crypto, norm(i.symbol).replace(/EUR$/, ''), i);
  codeIdx = { list, n: list.length, isin, sym, crypto };
  return codeIdx;
}
function findByCode(code) {
  const c = (code || '').trim().toUpperCase().replace(/[\s-]/g, '');
  if (!c) return null;
  const x = codeIndex();
  // crypto scritte senza valuta (es. «LTC» → LTC-EUR)
  return x.isin.get(c) || x.sym.get(c) || x.crypto.get(c) || null;
}
function renderPortfolio() {
  const p = state.portfolio;
  // Le stime prese dal modello si aggiornano quando i dati vengono ricalcolati; i valori modificati a mano
  // (elencati in row.manual) restano. Così «aggiorna dati» aggiorna anche le stime del portafoglio.
  let pfChanged = false;
  const syncRow = (row, isStock) => {
    if (!row || !row.isin) return;
    const inst = findByCode(row.isin);
    const r = inst ? resOf(inst) : null;
    const pp = inst && r && !r.error ? projParams(inst, r, isStock) : null;
    if (!pp) return;
    const man = row.manual || [];
    const set = (f, v) => { if (v != null && !man.includes(f) && row[f] !== v) { row[f] = v; pfChanged = true; } };
    // CAGR automatico: con orizzonti brevi selezionati include la tendenza recente (riferimento: il più lungo tra i brevi)
    const refShort = Math.max(0, ...normalizeHorizons(p.years).filter(isShortHorizon));
    let auto = pp.cagr;
    let trendOn = false;
    if (refShort > 0 && !man.includes('cagr')) {
      const base = Number.isFinite(pp.cagrShort) ? pp.cagrShort : pp.cagr; // previsione (verificata, sottostante o modello)
      const t = autoShort({ base, ter: pp.ter || 0, vol: pp.vol, mom: r?.mom, years: refShort, view: pp.shortView, evidence: pp.evidence, rho: Number.isFinite(p.momRho) ? p.momRho : null });
      row.cagrNoEv = !!t.noEvidence;
      row.cagrRho = t.rho;
      row.cagrView = !!t.view;
      auto = Math.round((t.net + (pp.ter || 0)) * 1e4) / 1e4;
      trendOn = true;
      row.cagrWindow = t.window;
      row.cagrSrc = pp.shortSrc || null;
    }
    if (row.cagrTrend !== trendOn || row.cagrLong !== pp.cagr) { row.cagrTrend = trendOn; row.cagrLong = pp.cagr; pfChanged = true; }
    if (man.includes('cagr') && row.cagrTrend) { row.cagrTrend = false; pfChanged = true; }
    set('cagr', auto); set('ter', pp.ter); set('tax', pp.tax); set('mdd', pp.mdd);
  };
  for (const row of p.rows) syncRow(row, false);
  for (const row of p.stocks || []) syncRow(row, true);
  for (const row of p.bonds || []) syncRow(row, false);
  if (pfChanged) savePortfolio(p);
  const body = $('#pf-body');
  const pcIn = (v, d = 2) => (Number.isFinite(v) ? String(+(v * 100).toFixed(d)) : ''); // input numerici: punto decimale
  const years = normalizeHorizons(p.years); // anni o frazioni d'anno (giorni/365), crescenti
  // Sezione ETF a importi in euro: la % di ogni strumento si calcola dagli importi. Migrazione da vecchi
  // portafogli a pesi: se manca l'importo ma c'è il peso, si deriva dall'ultimo capitale noto.
  for (const row of p.rows) if (!Number.isFinite(row.amount) && Number.isFinite(row.weight)) row.amount = Math.round((p.capital || 12000) * row.weight);
  const wSum = p.rows.reduce((a, x) => a + (x.amount || 0), 0); // capitale ETF = somma degli importi
  if (wSum > 0) p.capital = wSum;
  const rowsHtml = p.rows
    .map((row, k) => {
      const inst = findByCode(row.isin);
      const r = inst ? resOf(inst) : null;
      const pp = inst && r && !r.error ? projParams(inst, r) : null;
      const kn = inst && r && !r.error ? nr5Of(r.sim, inst.type) : null;
      const shortNote = shortNoteHtml(rowPrm(row), row.amount || 0, pp?.vol, rowMom(row), row.isin, years);
      return `<tr data-k="${k}">
        <td><input data-bucket="rows" data-f="isin" value="${esc(row.isin || '')}" placeholder="ISIN o ticker" size="13"><div class="muted small-note">${inst ? esc(inst.name).slice(0, 48) + (!pp ? ` <span class="neg">· ${r?.error ? esc(r.error) : 'nessuna stima del modello'}: inserisci CAGR, TER, aliquota e MDD a mano</span>` : r?.estimated ? ' <span class="muted" title="Previsione a 5 anni non disponibile: CAGR, volatilità e MDD sono una stima provvisoria (storico, dataset o valore tipico della categoria)">· stima provvisoria</span>' : '') : row.name ? esc(row.name) + ' <span class="neg">(non in elenco: parametri inseriti a mano)</span>' : row.isin ? '<span class="neg">non in elenco: inserisci CAGR, TER, aliquota e MDD a mano</span>' : 'inserisci ISIN o ticker'}</div></td>
        <td class="num"><input data-bucket="rows" data-f="amount" type="number" step="100" min="0" value="${Number.isFinite(row.amount) ? row.amount : ''}" size="6"> €<div class="muted small-note">${wSum > 0 && Number.isFinite(row.amount) ? pct(row.amount / wSum, false, 1) + ' del capitale' : '% automatica'}</div></td>
        <td class="num"><input data-bucket="rows" data-f="ter" type="number" step="0.01" min="0" value="${pcIn(row.ter)}" size="4"> %</td>
        <td class="num"><input data-bucket="rows" data-f="cagr" type="number" step="0.1" value="${pcIn(row.cagr)}" size="5"> %${pp ? `<div class="muted small-note" title="Rendimento annuo atteso dal modello (premio per il rischio azionario, P/E e utili attesi)">modello (lungo periodo): ${pct(pp.cagr, false, 2)} <button class="ghost small" data-bucket="rows" data-use="cagr" data-k="${k}" data-v="${pp.cagr}">usa</button></div>` : ''}${row.cagrTrend ? `<div class="small-note pos" title="Valore calcolato automaticamente: CAGR del modello corretto con la tendenza recente (persistenza ${Math.round((p.momRho ?? MOMENTUM_RHO) * 100)}%). Usato per gli orizzonti brevi; per quelli ≥ 1 anno vale il CAGR di lungo periodo.">⚙ automatico per gli orizzonti brevi${row.cagrView ? '' : row.cagrWindow ? (row.cagrRho === 1 ? ` · trend attuale (ultime ${row.cagrWindow} sett.) confermato dalle previsioni` : row.cagrRho === 0 ? (row.cagrNoEv ? ` · trend attuale (ultime ${row.cagrWindow} sett.) non esteso: nessuna previsione specifica (analisti) per questo strumento` : ` · trend attuale (ultime ${row.cagrWindow} sett.) non confermato dalle previsioni: ignorato`) : ` · trend ultime ${row.cagrWindow} sett. con persistenza ${Math.round(row.cagrRho * 100)}%`) : ''}${row.cagrSrc ? ` · ${esc(row.cagrSrc)}` : ''}</div>` : ''}${shortNote}</td>
        <td class="num"><input data-bucket="rows" data-f="tax" type="number" step="0.1" min="0" value="${pcIn(row.tax, 1)}" size="4"> %${pp ? `<div class="muted small-note">effettiva: ${pct(pp.tax, false, 1)} <button class="ghost small" data-bucket="rows" data-use="tax" data-k="${k}" data-v="${pp.tax}">usa</button></div>` : ''}</td>
        <td class="num"><input data-bucket="rows" data-f="mdd" type="number" step="1" min="0" value="${pcIn(row.mdd, 0)}" size="4"> %${pp?.mdd != null ? `<div class="muted small-note">storico: ${pct(pp.mdd, false, 0)} <button class="ghost small" data-bucket="rows" data-use="mdd" data-k="${k}" data-v="${pp.mdd}">usa</button></div>` : ''}</td>
        ${(() => {
          // Guadagno netto atteso della quota: algoritmo 019 sui parametri della riga, per orizzonte, × (1 − MDD)
          const quota = row.amount || 0;
          if (!(quota > 0) || !Number.isFinite(row.cagr)) return '<td class="num muted">–</td><td class="num muted">–</td>';
          const prm = { cagr: row.cagr, ter: Number.isFinite(row.ter) ? row.ter : 0, tax: Number.isFinite(row.tax) ? row.tax : 0.26, net: row.cagr - (Number.isFinite(row.ter) ? row.ter : 0) };
          const cells = years.map((y) => {
            const h = projectH(prmAt(prm, row, y), quota, y, pp?.vol, 1, rowMom(row), symTaxOf(row.isin));
            const adj = !h.short && Number.isFinite(row.mdd) ? h.netGain * (1 - Math.min(1, row.mdd)) : null;
            const rng = h.short && h.low != null ? `<div class="muted small-note" title="Più probabile = esito mediano (metà dei casi meglio, metà peggio). Atteso = media, che con strumenti volatili è spinta in alto da pochi casi molto favorevoli. Intervallo tipico ≈ ±1σ (68%)">più probabile <b class="${cls(h.medianNet)}">${h.medianNet > 0 ? '+' : ''}${Math.round(h.medianNet).toLocaleString('it-IT')} €</b> · ${Math.round(h.low).toLocaleString('it-IT')} … ${Math.round(h.high).toLocaleString('it-IT')} € · P(+) ${pct(h.pProfit, false, 0)}</div>` : '';
            const lev = h.short && y === Math.max(...years.filter(isShortHorizon)) ? leverScenariosHtml(leverScenarios(inst, pp?.vol, y, Number.isFinite(row.ter) ? row.ter : 0), y) : '';
            return `<div class="${cls(h.netGain)}"><b>${h.netGain > 0 ? '+' : ''}${Math.round(h.netGain).toLocaleString('it-IT')} €</b> <span class="muted">${horizonShort(y)}</span></div>${adj != null ? `<div class="muted small-note">× (1 − MDD) = <b class="${cls(adj)}">${adj > 0 ? '+' : ''}${Math.round(adj).toLocaleString('it-IT')} €</b></div>` : ''}${rng}${lev}`;
          });
          return `<td class="num">${eur(Math.round(quota))}</td><td class="num">${cells.join('')}</td>`;
        })()}
        <td class="num">${kn != null ? `<span class="${cls(kn)}">${kn > 0 ? '+' : ''}${pct(kn, false)}</span>` : '<span class="muted">–</span>'}</td>
        <td><button class="ghost small" data-bucket="rows" data-del="${k}" aria-label="Rimuovi">✕</button></td>
      </tr>`;
    })
    .join('');
  const out = projectPortfolioH({ rows: p.rows.map((x) => ({ ...x, weight: x.amount || 0, vol: volOfCode(x.isin), mom: rowMom(x), symTax: symTaxOf(x.isin) })), capital: p.capital, years, rho: Number.isFinite(p.rho) ? p.rho : 0.65, orderCost: state.settings.mc.orderCost ?? 1 });
  const fmt = (x) => eur(Math.round(x * 100) / 100);
  const rho = Number.isFinite(p.rho) ? p.rho : 0.65;
  const rk = portfolioRisk(
    p.rows.map((row) => {
      const inst = findByCode(row.isin);
      const r = inst ? resOf(inst) : null;
      return { weight: row.amount || 0, mdd: Number.isFinite(row.mdd) ? row.mdd : null, vol: r && !r.error && Number.isFinite(r.forward?.vol) ? r.forward.vol : null };
    }),
    rho,
  );
  const profile = rk ? classifyPortfolio({ vol: rk.vol, mdd: rk.mdd }) : null;
  // Sezione €: azioni / bond con importo in euro diretto (non percentuale), stesso algoritmo 019
  const amountSection = (bucket, title) => {
    const arr = p[bucket] || [];
    const isStock = bucket === 'stocks';
    const cap = arr.reduce((a, r) => a + (r.amount || 0), 0);
    const paramsOf = (row) => (Number.isFinite(row.cagr) ? { cagr: row.cagr, ter: Number.isFinite(row.ter) ? row.ter : 0, tax: Number.isFinite(row.tax) ? row.tax : 0.26, net: row.cagr - (Number.isFinite(row.ter) ? row.ter : 0) } : null);
    const rowsH = arr
      .map((row, k) => {
        const inst = findByCode(row.isin);
        const r = inst ? resOf(inst) : null;
        const pp = inst && r && !r.error ? projParams(inst, r, isStock) : null;
        const prm = paramsOf(row);
        const shortNote = shortNoteHtml(prm, row.amount || 0, pp?.vol, rowMom(row), row.isin, years);
        // Guadagno netto atteso per ogni strumento, per orizzonte (azioni: base; bond: × (1 − MDD))
        const gain = row.amount > 0 && prm
          ? years.map((y) => {
              const h = projectH(prmAt(prm, row, y), row.amount, y, pp?.vol, 1, rowMom(row), symTaxOf(row.isin));
              const adj = !isStock && !h.short && Number.isFinite(row.mdd) ? h.netGain * (1 - Math.min(1, row.mdd)) : null;
              return `<div class="${cls(h.netGain)}"><b>${h.netGain > 0 ? '+' : ''}${Math.round(h.netGain).toLocaleString('it-IT')} €</b> <span class="muted">${horizonShort(y)}</span></div>${adj != null ? `<div class="muted small-note">netto atteso ${adj > 0 ? '+' : ''}${Math.round(adj).toLocaleString('it-IT')} €</div>` : ''}`;
            }).join('')
          : '<span class="muted">–</span>';
        const terCell = isStock ? '' : `<td class="num"><input data-bucket="${bucket}" data-f="ter" type="number" step="0.01" min="0" value="${pcIn(row.ter)}" size="4"> %</td>`;
        return `<tr data-bucket="${bucket}" data-k="${k}">
          <td><input data-bucket="${bucket}" data-f="isin" value="${esc(row.isin || '')}" placeholder="ISIN o ticker" size="13"><div class="muted small-note">${inst ? esc(inst.name).slice(0, 46) + (!pp ? ` <span class="neg">· ${r?.error ? esc(r.error) : 'nessuna stima'}: parametri a mano</span>` : r?.estimated ? ' <span class="muted">· stima provvisoria</span>' : '') : row.isin ? '<span class="neg">non in elenco: parametri a mano</span>' : 'inserisci ISIN o ticker'}</div></td>
          <td class="num"><input data-bucket="${bucket}" data-f="amount" type="number" step="100" min="0" value="${Number.isFinite(row.amount) ? row.amount : ''}" size="6"> €</td>
          ${terCell}
          <td class="num"><input data-bucket="${bucket}" data-f="cagr" type="number" step="0.1" value="${pcIn(row.cagr)}" size="5"> %${pp ? `<div class="muted small-note">modello: ${pct(pp.cagr, false, 2)} <button class="ghost small" data-bucket="${bucket}" data-use="cagr" data-k="${k}" data-v="${pp.cagr}">usa</button></div>` : ''}${shortNote}</td>
          <td class="num"><input data-bucket="${bucket}" data-f="tax" type="number" step="0.1" min="0" value="${pcIn(row.tax, 1)}" size="4"> %</td>
          <td class="num"><input data-bucket="${bucket}" data-f="mdd" type="number" step="1" min="0" value="${pcIn(row.mdd, 0)}" size="4"> %${pp?.mdd != null ? `<div class="muted small-note">storico: ${pct(pp.mdd, false, 0)} <button class="ghost small" data-bucket="${bucket}" data-use="mdd" data-k="${k}" data-v="${pp.mdd}">usa</button></div>` : ''}</td>
          <td class="num">${gain}</td>
          <td><button class="ghost small" data-bucket="${bucket}" data-del="${k}" aria-label="Rimuovi">✕</button></td>
        </tr>`;
      })
      .join('');
    // Totali come somma dei singoli strumenti (coerenti con la colonna per strumento)
    const valid = arr.filter((r) => r.amount > 0 && Number.isFinite(r.cagr));
    const totalFor = (y, mult = 1) => {
      const parts = valid.map((r) => ({ h: projectH({ ...paramsOf(r), cagr: rowCagr(r, y) * mult, net: rowCagr(r, y) * mult - (Number.isFinite(r.ter) && !isStock ? r.ter : 0) }, r.amount, y, volOfCode(r.isin), 1, rowMom(r), symTaxOf(r.isin)), rate: Number.isFinite(r.tax) ? r.tax : 0.26 }));
      // perdite compensate tra le posizioni (salvo «imposta prudente»)
      return parts.reduce((a, { h }) => a + h.gain - (h.costs || 0), 0) - portfolioTax(parts, !!p.taxPrudent);
    };
    const bearLoss = valid.reduce((a, r) => a + (Number.isFinite(r.mdd) ? r.amount * Math.min(0.95, Math.abs(r.mdd)) : 0), 0);
    const bearCov = valid.filter((r) => Number.isFinite(r.mdd)).reduce((a, r) => a + r.amount, 0);
    const og = cap > 0 ? projectPortfolioH({ rows: arr.map((r) => ({ ...r, weight: r.amount || 0, vol: volOfCode(r.isin), mom: rowMom(r), symTax: symTaxOf(r.isin) })), capital: cap, years, rho, orderCost: state.settings.mc.orderCost ?? 1 }) : null;
    const grk = cap > 0 ? portfolioRisk(arr.map((r) => { const inst = findByCode(r.isin); const res = inst ? resOf(inst) : null; return { weight: r.amount || 0, mdd: Number.isFinite(r.mdd) ? r.mdd : null, vol: res && !res.error && Number.isFinite(res.forward?.vol) ? res.forward.vol : null }; }), rho) : null;
    const prof = grk ? classifyPortfolio({ vol: grk.vol, mdd: grk.mdd }) : null;
    const note = isStock
      ? "Azioni singole (metodo del documento PRJ-FIN-2026-010): niente TER né rendimento di mercato garantito, imposta 26% sulle plusvalenze. Il CAGR del modello usa le prospettive di crescita aggiornate (fondamentali forward: crescita utili attesa + dividendo + valutazione). Il guadagno netto totale è la somma dei singoli titoli. Oltre allo scenario base sono mostrati Bull e Bear: nelle azioni singole il capitale NON è protetto come in un ETF diversificato."
      : "Stesso algoritmo degli ETF (019): CAGR atteso − TER, montante composto, imposta sulla plusvalenza, CAGR netto atteso × (1 − MDD).";
    let summary = '';
    if (og && isStock) {
      summary = `<table class="mini"><tbody>
        <tr><td>CAGR lordo atteso (ponderato per importo)</td><td class="num"><b>${pct(og.params.cagr, false, 2)}</b></td></tr>
        <tr><td>Aliquota fiscale</td><td class="num">${pct(og.params.tax, false, 2)}</td></tr>
        ${prof ? `<tr><td>Tipo</td><td class="num"><b>${prof.label}</b></td></tr>` : ''}
        ${grk ? `<tr><td>MDD<sub>p</sub> (drawdown storico ponderato)</td><td class="num neg">−${pct(grk.mdd, false, 1)}</td></tr>` : ''}
      </tbody></table>
      ${years
        .map((y) => {
          const base = totalFor(y, 1);
          const bull = totalFor(y, 1.4);
          const hasBear = bearCov > 0;
          return `<p class="muted small-note" style="margin:12px 0 4px"><b>Scenari a ${horizonLong(y)}</b> (${eur(Math.round(cap))} investiti) — guadagno netto totale azioni</p>
          <table class="mini"><thead><tr><th>Scenario</th><th class="num">Guadagno netto totale</th><th class="num">Capitale finale</th><th>Probabilità</th></tr></thead><tbody>
            <tr><td>Base (target)<div class="muted small-note">i megatrend si sviluppano come previsto</div></td><td class="num ${cls(base)}"><b>${base > 0 ? '+' : ''}${fmt(base)}</b> (${pct(base / cap, true)})</td><td class="num">${fmt(cap + base)}</td><td class="muted">Media</td></tr>
            <tr><td>Bull (iper-crescita)<div class="muted small-note">i megatrend accelerano (CAGR × 1,4)</div></td><td class="num pos">&gt; +${fmt(bull)} (${pct(bull / cap, true)})</td><td class="num">&gt; ${fmt(cap + bull)}</td><td class="muted">Bassa</td></tr>
            ${hasBear ? `<tr><td>Bear (stress): forte ribasso idiosincratico<div class="muted small-note">capitale non garantito; perdita ≈ MDD storico${bearCov < cap - 0.5 ? ` (su ${pct(bearCov / cap, false, 0)} con MDD)` : ''}</div></td><td class="num neg"><b>−${fmt(bearLoss)}</b> (${pct(-bearLoss / cap, true)})</td><td class="num">${fmt(cap - bearLoss)}</td><td class="muted">Media</td></tr>` : ''}
          </tbody></table>`;
        })
        .join('')}`;
    } else if (og) {
      summary = `<table class="mini"><tbody>
        <tr><td>CAGR lordo atteso (ponderato per importo)</td><td class="num">${pct(og.params.cagr, false, 2)}</td></tr>
        <tr><td>CAGR netto pre-tasse (CAGR − TER)</td><td class="num"><b>${pct(og.params.net, false, 2)}</b></td></tr>
        <tr><td>Aliquota fiscale ponderata</td><td class="num">${pct(og.params.tax, false, 2)}</td></tr>
        ${prof ? `<tr><td>Tipo</td><td class="num"><b>${prof.label}</b></td></tr>` : ''}
        ${grk ? `<tr><td>MDD<sub>p</sub> (drawdown storico ponderato)</td><td class="num neg">−${pct(grk.mdd, false, 1)}</td></tr>` : ''}
        ${grk && grk.vol != null ? `<tr><td>Volatilità attesa σ<sub>p</sub></td><td class="num">${pct(grk.vol, false, 1)} annua</td></tr>` : ''}
        ${years.map((y) => { const t = totalFor(y, 1); const adj = grk && !isShortHorizon(y) ? t * (1 - grk.mdd) : null; return `<tr><th>Guadagno netto totale ${horizonShort(y)} (${pct(t / cap, true)})</th><th class="num ${cls(t)}">${t > 0 ? '+' : ''}${fmt(t)}${adj != null ? ` · netto atteso ${adj > 0 ? '+' : ''}${fmt(adj)}` : ''}</th></tr>`; }).join('')}
      </tbody></table>`;
    } else {
      summary = `<p class="muted">Inserisci almeno uno strumento con importo e CAGR.</p>`;
    }
    const terCol = isStock ? '' : '<th class="num">TER</th>';
    const histItems = arr.map((r) => ({ amount: r.amount || 0, ter: isStock ? 0 : r.ter, tax: r.tax }));
    return `<h3 style="margin-top:24px">${title}</h3>
      <p class="muted small-note">${note} Qui l'importo da investire si indica in euro, non in percentuale. Totale investito: <b>${eur(Math.round(cap))}</b>.</p>
      <div style="margin:8px 0"><button class="ghost small" data-addbucket="${bucket}">+ Strumento</button></div>
      <div class="table-wrap"><table class="mini"><thead><tr><th>Strumento</th><th class="num">Importo €</th>${terCol}<th class="num">CAGR lordo</th><th class="num">Aliquota</th><th class="num">MDD storico</th><th class="num">Guadagno netto ${isStock ? 'per azione' : 'atteso'}</th><th></th></tr></thead><tbody>${rowsH}</tbody></table></div>
      ${summary}
      ${cap > 0 ? histScenariosHtml(histItems, years) : ''}`;
  };
  // Confronto: NR5 del modello, ponderato con gli stessi pesi (solo righe presenti in elenco con stima)
  let nr5W = 0;
  let nr5Cov = 0;
  for (const row of p.rows) {
    const inst = findByCode(row.isin);
    const r = inst ? resOf(inst) : null;
    const v = r && !r.error ? nr5Of(r.sim, inst.type) : null;
    if (v != null && row.amount > 0) {
      nr5W += row.amount * v;
      nr5Cov += row.amount;
    }
  }
  const mgCard = (() => {
    const holds = [...(p.rows || []), ...(p.stocks || [])].filter((r) => r.isin && r.amount > 0);
    const rowsMg = holds.map((h) => {
      const inst = findByCode(h.isin);
      const m = inst && (inst.type === 'etf' || inst.type === 'stock') ? mgOf(inst, h.amount, 5) : null;
      return { h, inst, m };
    }).filter((x) => x.m);
    if (!rowsMg.length) return '';
    const sc = rowsMg.filter((x) => x.m.score != null);
    const tot = rowsMg.reduce((a, x) => a + x.h.amount, 0);
    const totSc = sc.reduce((a, x) => a + x.h.amount, 0) || 1;
    const wScore = sc.reduce((a, x) => a + x.m.score * x.h.amount, 0) / totSc;
    const wNet = sc.reduce((a, x) => a + x.m.net, 0);
    const bm = bestMaxGrowth();
    let pfSnap = {};
    try { pfSnap = JSON.parse(localStorage.getItem('trmc.pfSnap') || '{}'); } catch { pfSnap = {}; }
    const tr = rowsMg.map(({ h, inst, m }) => {
      const adv = adviseHolding(inst, h.amount, h.amount / (tot || 1), pfSnap[inst.symbol]);
      const top = (bm[inst.type] || []).find((x) => x.symbol !== inst.symbol);
      const alt = top && (m.score == null || top.score >= m.score + 0.01) ? `${esc(top.name).slice(0, 36)} <span class="muted">${esc(top.isin || '')}</span> (${pct(top.score, true)})` : '<span class="pos">già tra i migliori</span>';
      return `<tr><td>${esc(inst.name).slice(0, 44)}<div class="muted small-note">${esc(inst.isin || inst.symbol)}${m.pass ? '' : ` · <span class="neg">${esc(m.reason || 'non supera il filtro')}</span>`}</div></td><td class="num">${eur(Math.round(h.amount))}</td>${m.score == null ? '<td class="num muted">–</td><td class="num muted">–</td>' : `<td class="num ${cls(m.score)}"><b>${pct(m.score, true)}</b>/anno</td><td class="num ${cls(m.net)}">${m.net > 0 ? '+' : ''}${eur(m.net)}</td>`}<td>${adv ? `<b>${ADVICE_LABEL[adv.action]}</b><div class="muted small-note">${adviceText(adv)}</div>` : alt}</td></tr>`;
    }).join('');
    return `<div class="card"><h3>Max Growth del portafoglio</h3>
      <p class="muted small-note">Stesso punteggio della classifica (storico 5 anni, rendimento atteso, crescita degli utili, meno rischio e concentrazione), ricalcolato a ogni aggiornamento dei dati di mercato. Azione suggerita per ogni strumento (vendi tutto, vendi una quota, rialloca verso uno strumento con trend positivo e alta crescita, aumenta, mantieni), ricalcolata a ogni aggiornamento; le notifiche 🔔 la segnalano. Indicazioni del modello, non consigli di investimento.</p>
      <div class="table-wrap"><table class="mini"><thead><tr><th>Strumento</th><th class="num">Importo</th><th class="num">Max Growth</th><th class="num">Guadagno netto 5a</th><th>Azione suggerita</th></tr></thead><tbody>${tr}
      <tr><th>Portafoglio (ETF e azioni)</th><th class="num">${eur(Math.round(tot))}</th><th class="num ${cls(wScore)}">${pct(wScore, true)}/anno</th><th class="num ${cls(wNet)}">${wNet > 0 ? '+' : ''}${eur(wNet)}</th><th></th></tr></tbody></table></div></div>`;
  })();
  body.innerHTML = `
    ${mgCard}
    <p class="muted">Algoritmo del documento PRJ-FIN-2026-019. Modulo 1: CAGR lordo, TER e aliquota ponderati per il peso, CAGR netto pre-tasse = CAGR − TER. Modulo 2: montante = capitale × (1 + CAGR netto)<sup>anni</sup>. Modulo 3: imposta sulla plusvalenza, guadagno netto = plusvalenza − imposta. Modulo 4: rischio = Σ peso × MDD storico e volatilità con covarianza. Nella sezione ETF si inserisce l'importo in euro di ogni strumento e la percentuale sul capitale è calcolata automaticamente.</p>
    <div class="row" style="flex-wrap:wrap;gap:12px;align-items:center;margin:8px 0">
      <span>Capitale investito (ETF): <b>${eur(Math.round(wSum))}</b> <span class="muted">(somma degli importi)</span></span>
      <span class="row" style="flex-wrap:wrap;gap:4px;align-items:center" title="Scegli uno o più orizzonti: giorni (algoritmo breve con volatilità e costi) o anni (algoritmo 019)"><b>Orizzonti</b>
        ${[...HORIZON_PRESETS, ...years.filter((y) => !HORIZON_PRESETS.some((h) => Math.abs(h - y) < 1e-9))].sort((a, b) => a - b).map((y) => { const on = years.some((v) => Math.abs(v - y) < 1e-9); return `<button class="tab small${on ? ' active' : ''}" data-h="${y}" aria-pressed="${on}" title="${on ? 'Togli' : 'Aggiungi'} l'orizzonte di ${horizonLong(y)}">${horizonShort(y)}</button>`; }).join('')}
        <input id="pf-hn" type="number" min="1" max="3650" step="1" placeholder="n" style="width:4.5em" aria-label="Orizzonte personalizzato"> <select id="pf-hu" aria-label="Unità"><option value="d">giorni</option><option value="y">anni</option></select> <button id="pf-hadd" class="ghost small">+ Orizzonte</button> <label class="muted small-note" title="Vuoto = automatica: il trend di mercato attuale prosegue solo se le previsioni (di mercato verificate o del modello con analisti) vanno nella stessa direzione, altrimenti prevale la previsione. Un numero forza la persistenza per tutti">persistenza tendenza <input id="pf-mrho" type="number" min="-50" max="100" step="5" placeholder="auto" value="${Number.isFinite(p.momRho) ? Math.round(p.momRho * 100) : ''}" style="width:4em"> %</label> <label class="muted small-note" title="Spuntato: le perdite non si compensano (imposta solo sugli scenari in guadagno, più alta con strumenti volatili). Non spuntato: imposta = aliquota × guadagno atteso (minusvalenze compensabili)"><input id="pf-taxp" type="checkbox"${p.taxPrudent ? ' checked' : ''}> imposta prudente</label>
      </span>
      ${years.some(isShortHorizon) ? `<span class="muted small-note" style="flex-basis:100%">Orizzonti brevi: guadagno netto atteso = capitale × rendimento atteso del periodo (previsioni di mercato verificate dove disponibili; altrimenti modello con analisti, più il trend attuale solo se le previsioni lo confermano) − imposta attesa − costi degli ordini. Imposta: aliquota × guadagno atteso (perdite compensabili con altre plusvalenze). Con «imposta prudente» per gli ETF UCITS si assume che le perdite non si compensino: l'imposta si calcola solo sugli scenari in guadagno ed è più alta con strumenti volatili. In pochi giorni il risultato reale oscilla molto più dell'atteso: guarda l'intervallo e la probabilità di guadagno. Per leva/short il rischio è ancora più alto.</span>` : ''}
      <button class="ghost small" data-addbucket="rows">+ Strumento (ETF)</button>
      <button id="pf-preset" class="ghost small" title="Core-Satellite 60/20/20: LS80 + Nasdaq 100 + US Health Care con i parametri del documento">Preset 60/20/20</button>
      <button id="pf-model" class="ghost small" title="Sostituisce CAGR e aliquota di ogni riga con le stime del modello per quello strumento">Usa stime del modello</button>
      <button id="pf-share" class="ghost small" title="Copia un link con il tuo portafoglio, da aprire su un altro dispositivo o incollare nell'app">Condividi</button>
      <button id="pf-import" class="ghost small" title="Incolla un link o codice portafoglio copiato da un altro dispositivo">Importa</button>
    </div>
    <div class="table-wrap"><table class="mini"><thead><tr><th>Strumento</th><th class="num">Importo €</th><th class="num">TER</th><th class="num">CAGR lordo</th><th class="num">Aliquota</th><th class="num" title="Drawdown massimo storico (modulo 4)">MDD storico</th><th class="num">Quota</th><th class="num" title="Guadagno netto atteso della quota (algoritmo 019: CAGR − TER, montante composto, imposta) per ogni orizzonte, e CAGR netto atteso = netto × (1 − MDD)">Guadagno netto atteso</th><th class="num" title="Netto Reale 5A del modello (simulazione), per confronto">NR5 modello</th><th></th></tr></thead><tbody>${rowsHtml}</tbody></table></div>
    ${out ? `
    <h3>Parametri ponderati</h3>
    <table class="mini"><tbody>
      <tr><td>CAGR lordo atteso (lungo periodo)</td><td class="num">${pct(out.params.cagr, false, 2)}</td></tr>
      ${years.some(isShortHorizon) && out.paramsShort && Math.abs(out.paramsShort.cagr - out.params.cagr) > 1e-6 ? `<tr><td>CAGR lordo atteso con tendenza recente (orizzonti brevi)</td><td class="num ${cls(out.paramsShort.cagr)}"><b>${pct(out.paramsShort.cagr, false, 2)}</b></td></tr>` : ''}
      <tr><td>TER</td><td class="num">${pct(out.params.ter, false, 2)}</td></tr>
      <tr><td>CAGR netto pre-tasse (CAGR − TER)</td><td class="num"><b>${pct(out.params.net, false, 2)}</b></td></tr>
      <tr><td>Aliquota fiscale</td><td class="num">${pct(out.params.tax, false, 2)}</td></tr>
    </tbody></table>
    ${out.horizons
      .map(
        (h) => `
    <h3>Scenario a ${horizonLong(h.years)}${h.short ? ' <span class="muted small-note">· algoritmo breve: volatilità, imposta attesa e costi degli ordini</span>' : ''}</h3>
    <table class="mini"><tbody>
      <tr><td>${h.short ? `Rendimento lordo atteso a ${horizonShort(h.years)} <span class="muted small-note">(previsioni attuali e trend se confermato, non il solo CAGR di lungo periodo)</span>` : `Montante lordo: ${eur(p.capital)} × (1 + ${pct(out.params.net, false, 2)})<sup>${horizonExp(h.years)}</sup>`}</td><td class="num">${fmt(h.gross)}${h.short ? ` <span class="muted small-note">(${pct(h.mu, true, 2)})</span>` : ''}</td></tr>
      <tr><td>Plusvalenza lorda</td><td class="num">${fmt(h.gain)}</td></tr>
      <tr><td>Imposta sostitutiva${h.short ? ' attesa' : ''} (${pct(out.params.tax, false, 2)})</td><td class="num neg">− ${fmt(h.tax)}</td></tr>
      ${h.short ? `<tr><td>Costi ordini (acquisto + vendita, ${eur(state.settings.mc.orderCost ?? 1)} ciascuno)</td><td class="num neg">− ${fmt(h.costs)}</td></tr>` : ''}
      <tr><th>Guadagno netto finale (${pct(h.netPct, true)})</th><th class="num ${cls(h.netGain)}">${h.netGain > 0 ? '+' : ''}${fmt(h.netGain)}</th></tr>
      <tr><td>Capitale netto a scadenza</td><td class="num"><b>${fmt(h.finalCapital)}</b></td></tr>
      ${h.short && h.trend && Math.abs(h.trend.tilt) > 1e-4 ? `<tr><td>Tendenza recente (momentum${h.trend.window ? `, ultime ${h.trend.window} sett.` : ''}; persistenza ${pct(h.trend.rho ?? 0.25, false, 0)}) <span class="muted small-note">già inclusa nel guadagno</span></td><td class="num ${cls(h.trend.tilt)}">${pct(h.trend.tilt, true, 1)} ≈ ${h.trend.tilt > 0 ? '+' : ''}${fmt(p.capital * h.trend.tilt)}</td></tr>` : ''}
      ${h.short && Number.isFinite(h.medianNet) ? `<tr><td>Guadagno netto più probabile (mediano) <span class="muted small-note">metà dei casi meglio, metà peggio</span></td><td class="num ${cls(h.medianNet)}"><b>${h.medianNet > 0 ? '+' : ''}${fmt(h.medianNet)}</b></td></tr>` : ''}
      ${h.short && h.pProfit != null ? `<tr><td>Probabilità di guadagno nel periodo (σ ${pct(h.sigma, false, 2)})</td><td class="num">${pct(h.pProfit, false, 0)}</td></tr><tr><td>Intervallo tipico del netto (≈ ±1σ, 68% degli scenari)</td><td class="num">${fmt(h.low)} … ${fmt(h.high)}</td></tr>` : ''}
      ${rk && !h.short ? `<tr><th>CAGR netto atteso: guadagno netto × (1 − MDD<sub>p</sub> ${pct(rk.mdd, false, 1)})</th><th class="num ${cls(h.netGain * (1 - rk.mdd))}">${h.netGain * (1 - rk.mdd) > 0 ? '+' : ''}${fmt(h.netGain * (1 - rk.mdd))} (${pct((h.netGain * (1 - rk.mdd)) / p.capital, true)})</th></tr>` : ''}
    </tbody></table>`,
      )
      .join('')}
    ${out ? histScenariosHtml(p.rows.map((r) => ({ amount: r.amount || 0, ter: r.ter, tax: r.tax })), years) : ''}
    ${(() => {
      // Proiezioni separate per classe di strumento (azioni, ETF, bond), stesso algoritmo 019
      const CLASSES = [
        { key: 'stock', label: 'Azioni' },
        { key: 'etf', label: 'ETF' },
        { key: 'bond', label: 'Bond' },
        { key: 'crypto', label: 'Crypto' },
      ];
      const classOf = (row) => {
        const inst = findByCode(row.isin);
        if (!inst) return 'altro';
        if (isBond(inst)) return 'bond';
        return inst.type || 'altro';
      };
      const groups = CLASSES.map((c) => {
        const rows = p.rows.filter((row) => row.amount > 0 && Number.isFinite(row.cagr) && classOf(row) === c.key);
        const gw = rows.reduce((a, r) => a + (r.amount || 0), 0);
        return { ...c, rows, gw };
      }).filter((g) => g.gw > 0);
      if (groups.length < 2) return ''; // una sola classe: la proiezione aggregata basta
      const row = (g) => {
        const gCap = p.capital * (g.gw / (wSum || 1));
        const og = projectPortfolioH({ rows: g.rows.map((x) => ({ ...x, vol: volOfCode(x.isin), mom: rowMom(x), symTax: symTaxOf(x.isin) })), capital: gCap, years, rho: Number.isFinite(p.rho) ? p.rho : 0.65, orderCost: state.settings.mc.orderCost ?? 1 });
        if (!og) return '';
        const grk = portfolioRisk(
          g.rows.map((r) => {
            const inst = findByCode(r.isin);
            const res = inst ? resOf(inst) : null;
            return { weight: r.weight, mdd: Number.isFinite(r.mdd) ? r.mdd : null, vol: res && !res.error && Number.isFinite(res.forward?.vol) ? res.forward.vol : null };
          }),
          Number.isFinite(p.rho) ? p.rho : 0.65,
        );
        const mdd = grk?.mdd ?? 0;
        const cells = og.horizons
          .map((h) => `<td class="num ${cls(h.netGain)}"><b>${h.netGain > 0 ? '+' : ''}${fmt(h.netGain)}</b> <span class="muted">${horizonShort(h.years)}</span>${mdd && !h.short ? `<div class="muted small-note">netto atteso ${h.netGain * (1 - mdd) > 0 ? '+' : ''}${fmt(h.netGain * (1 - mdd))}</div>` : ''}</td>`)
          .join('');
        return `<tr><td><b>${g.label}</b><div class="muted small-note">${pct(g.gw / (wSum || 1), false, 0)} del portafoglio${mdd ? ` · MDD ${pct(mdd, false, 0)}` : ''}</div></td><td class="num">${eur(Math.round(gCap))}</td><td class="num">${pct(og.params.cagr, false, 2)} − TER ${pct(og.params.ter, false, 2)}</td>${cells}</tr>`;
      };
      return `<h3>Proiezioni per classe di strumento (stesso algoritmo)</h3>
      <table class="mini"><thead><tr><th>Classe</th><th class="num">Quota</th><th class="num">CAGR lordo</th>${years.map((y) => `<th class="num">Guadagno netto ${horizonShort(y)}</th>`).join('')}</tr></thead><tbody>${groups.map(row).join('')}</tbody></table>
      <p class="muted small-note">Ogni classe usa lo stesso algoritmo 019 (CAGR atteso − TER, montante composto, imposta sulla plusvalenza) sulla quota di capitale che le spetta; «netto atteso» applica l'MDD storico ponderato della classe.</p>`;
    })()}
    <h3>Modulo 4: quantificazione del rischio</h3>
    ${(() => {
      if (!rk) return '';
      return `${profile ? `<p class="pf-type pf-${profile.type}">Tipo di portafoglio: <b>${profile.label}</b> <span class="muted">— ${profile.desc}</span></p>` : ''}
      <table class="mini"><tbody>
        <tr><td>MDD<sub>p</sub> = Σ peso × MDD storico (${pct(rk.mddCoverage, false, 0)} del portafoglio con MDD)</td><td class="num neg"><b>−${pct(rk.mdd, false, 1)}</b></td></tr>
        <tr><td>Flessione massima teorica in una recessione severa su ${eur(p.capital)}</td><td class="num neg">−${eur(Math.round(p.capital * rk.mdd))} → capitale protetto ${eur(Math.round(p.capital * (1 - rk.mdd)))} (${pct(1 - rk.mdd, false, 0)})</td></tr>
        <tr><td>Volatilità attesa σ<sub>p</sub> con covarianza (ρ tra asset diversi <input id="pf-rho" type="number" step="0.05" min="-1" max="1" value="${rho}" style="width:4.5em">; σ dei singoli dal modello, ${pct(rk.volCoverage, false, 0)} del portafoglio)</td><td class="num">${rk.vol != null ? pct(rk.vol, false, 1) + ' annua' : '<span class="muted">n.d.</span>'}</td></tr>
      </tbody></table>`;
    })()}
    <h3>Stress test e tempo di recupero${profile ? ` — portafoglio ${profile.label.toLowerCase()}` : ''}</h3>
    ${(() => {
      if (!rk) return '<p class="muted">Inserisci strumenti con volatilità o MDD per lo stress test.</p>';
      const scen = portfolioStress({ vol: rk.vol, mdd: rk.mdd, netCagr: out.params.net, capital: p.capital });
      if (!scen.length) return '<p class="muted">Volatilità e MDD del portafoglio non disponibili.</p>';
      const months = (m) => (m == null ? '<span class="neg">nessun recupero con questo CAGR</span>' : m === 0 ? '–' : `≈ ${Math.round(m)} mesi`);
      const bear = scen[scen.length - 1];
      return `<table class="mini"><thead><tr><th>Scenario del portafoglio</th><th class="num">Calo</th><th class="num">Capitale residuo</th><th class="num">Tempo di recupero</th><th>Azione operativa</th></tr></thead><tbody>${scen
        .map((x, k) => `<tr><td>${x.label}<div class="muted small-note">${x.note}</div></td><td class="num neg">−${pct(x.drop, false, 1)}</td><td class="num">${eur(Math.round(x.capitalAfter))}</td><td class="num">${months(x.recoveryMonths)}</td><td class="muted">${k === scen.length - 1 && profile?.bear ? profile.bear : k === 0 ? 'Nessuna azione: oscillazione fisiologica.' : 'Mantenere le posizioni.'}</td></tr>`)
        .join('')}</tbody></table>
      <p class="muted small-note">Gli scenari derivano dal rischio del portafoglio: σ<sub>p</sub> (volatilità attesa ${rk.vol != null ? pct(rk.vol, false, 1) : 'n.d.'}) e MDD<sub>p</sub> (drawdown massimo storico −${pct(rk.mdd, false, 1)}), ricalcolati da strumenti e pesi. Tempo di recupero = 12 × ln(1 ÷ (1 − calo)) ÷ ln(1 + CAGR netto ${pct(out.params.net, false, 2)}).</p>`;
    })()}
    <h3>Confronto con la simulazione</h3>
    <p class="muted">${nr5Cov > 0 ? `Netto Reale 5A del modello, ponderato con gli stessi pesi (${pct(nr5Cov / (wSum || 1), false, 0)} del portafoglio con stima): <b class="${cls(nr5W / nr5Cov)}">${nr5W / nr5Cov > 0 ? '+' : ''}${Math.round((nr5W / nr5Cov) * p.capital).toLocaleString('it-IT')} €</b> su ${eur(p.capital)} a ${state.settings.mc.years} anni. L'NR5 include il rischio di perdita (tutti gli scenari, non solo la media) e il netto vero per scenario; la proiezione deterministica no.` : 'Nessuno strumento del portafoglio è in elenco con una stima del modello.'}</p>` : '<p class="neg">Inserisci almeno uno strumento con importo e CAGR.</p>'}
    ${amountSection('stocks', 'Azioni (importi in €)')}
    ${amountSection('bonds', 'Bond (importi in €)')}
    ${(() => {
      // Scenario a 5 e 7 anni dell'INTERO portafoglio (ETF + Azioni + Bond), stesso algoritmo 019.
      // Ogni strumento è proiettato con i suoi parametri (CAGR, TER, aliquota) e i totali sono la somma.
      const nameOf = (row) => findByCode(row.isin)?.name || row.isin || 'strumento';
      const items = [
        ...p.rows.map((r) => ({ amount: r.amount || 0, cagr: r.cagr, cagrLong: r.cagrLong, cagrTrend: r.cagrTrend, ter: r.ter, tax: r.tax, mdd: r.mdd, vol: volOfCode(r.isin), mom: rowMom(r), symTax: symTaxOf(r.isin) })),
        ...(p.stocks || []).map((r) => ({ amount: r.amount, cagr: r.cagr, cagrLong: r.cagrLong, cagrTrend: r.cagrTrend, ter: 0, tax: r.tax, mdd: r.mdd, vol: volOfCode(r.isin), mom: rowMom(r), symTax: symTaxOf(r.isin) })),
        ...(p.bonds || []).map((r) => ({ amount: r.amount, cagr: r.cagr, cagrLong: r.cagrLong, cagrTrend: r.cagrTrend, ter: r.ter, tax: r.tax, mdd: r.mdd, vol: volOfCode(r.isin), mom: rowMom(r), symTax: symTaxOf(r.isin) })),
      ];
      const nSec = [p.rows.length > 0, (p.stocks || []).length > 0, (p.bonds || []).length > 0].filter(Boolean).length;
      if (nSec < 1) return '';
      const valid = items.filter((i) => i.amount > 0 && Number.isFinite(i.cagr));
      const totCap = valid.reduce((a, i) => a + i.amount, 0);
      if (!(totCap > 0)) return '';
      let mdd = 0;
      let mddCov = 0;
      for (const i of valid) if (Number.isFinite(i.mdd)) { mdd += (i.amount / totCap) * Math.min(0.95, Math.abs(i.mdd)); mddCov += i.amount / totCap; }
      const fmt2 = (x) => eur(Math.round(x * 100) / 100);
      const scenario = (y) => {
        let gross = 0, gain = 0, costs = 0;
        const parts = [];
        for (const i of valid) {
          const ci = rowCagr(i, y);
          const rate = Number.isFinite(i.tax) ? i.tax : 0.26;
          const h = projectH({ cagr: ci, ter: Number.isFinite(i.ter) ? i.ter : 0, tax: rate, net: ci - (Number.isFinite(i.ter) ? i.ter : 0) }, i.amount, y, i.vol, 1, i.mom, i.symTax);
          gross += h.gross; gain += h.gain; costs += h.costs || 0;
          parts.push({ h, rate });
        }
        const tax = portfolioTax(parts, !!p.taxPrudent); // perdite compensate tra le posizioni (salvo «imposta prudente»)
        const net = gain - tax - costs;
        const taxRate = gain > 0 ? tax / gain : 0;
        const adj = isShortHorizon(y) ? null : net * (1 - mdd);
        return `<h4 class="pf-h4">Scenario a ${horizonLong(y)}</h4>
        <table class="mini"><tbody>
          <tr><td>Montante lordo (${eur(Math.round(totCap))} investiti)</td><td class="num">${fmt2(gross)}</td></tr>
          <tr><td>Plusvalenza lorda</td><td class="num">${fmt2(gain)}</td></tr>
          <tr><td>${costs > 0 ? `Imposta attesa (aliquota media ${pct(taxRate, false, 2)})${p.taxPrudent ? ' <span class="muted small-note">(prudente: perdite non compensate)</span>' : ''}` : `Imposta (aliquota media ${pct(taxRate, false, 2)})`}</td><td class="num neg">− ${fmt2(tax)}</td></tr>
          ${costs > 0 ? `<tr><td>Costi ordini (acquisto + vendita)</td><td class="num neg">− ${fmt2(costs)}</td></tr>` : ''}
          <tr><th>Guadagno netto finale (${pct(net / totCap, true)})</th><th class="num ${cls(net)}">${net > 0 ? '+' : ''}${fmt2(net)}</th></tr>
          <tr><td>Capitale netto a scadenza</td><td class="num"><b>${fmt2(totCap + net)}</b></td></tr>
          ${adj != null ? `<tr><th>CAGR netto atteso: guadagno netto × (1 − MDD<sub>p</sub> ${pct(mdd, false, 1)})</th><th class="num ${cls(adj)}">${adj > 0 ? '+' : ''}${fmt2(adj)} (${pct(adj / totCap, true)})</th></tr>` : ''}
        </tbody></table>`;
      };
      // Scenari storici: stesso algoritmo 019 ma con un CAGR lordo fisso uguale per tutti (ipotesi di
      // rendimento del mercato), mantenendo il TER e l'aliquota di ogni strumento; i totali sono la somma.
      const SCEN = [
        { key: 'pess', label: 'Pessimistico (mercato laterale / crisi)', cagr: 0.02, note: 'CAGR lordo 2%: cosa succede se i prossimi 5 anni vanno male' },
        { key: 'base', label: 'Base (media storica reale)', cagr: 0.07, note: 'CAGR lordo 7%: rendimento storico netto dell\'azionario globale' },
        { key: 'opt', label: 'Ottimistico (massimo guadagno)', cagr: 0.1, note: 'CAGR lordo 10%: scenario favorevole' },
      ];
      const histNet = (fixedCagr, y) => valid.reduce((a, i) => a + projectH({ cagr: fixedCagr, ter: Number.isFinite(i.ter) ? i.ter : 0, tax: Number.isFinite(i.tax) ? i.tax : 0.26, net: fixedCagr - (Number.isFinite(i.ter) ? i.ter : 0) }, i.amount, y).netGain, 0);
      const histBlock = (y) => `<p class="muted small-note" style="margin:12px 0 4px"><b>Scenari storici a ${horizonLong(y)}</b> (${eur(Math.round(totCap))} investiti) — ipotesi di rendimento del mercato</p>
        <table class="mini"><thead><tr><th>Scenario</th><th class="num">CAGR lordo</th><th class="num">Guadagno netto totale</th><th class="num">Capitale finale</th></tr></thead><tbody>${SCEN
          .map((sc) => { const net = histNet(sc.cagr, y); return `<tr><td>${sc.label}<div class="muted small-note">${sc.note}</div></td><td class="num">${pct(sc.cagr, false, 0)}</td><td class="num ${cls(net)}"><b>${net > 0 ? '+' : ''}${fmt2(net)}</b> (${pct(net / totCap, true)})</td><td class="num">${fmt2(totCap + net)}</td></tr>`; })
          .join('')}</tbody></table>`;
      return `<h3 style="margin-top:26px">Scenario dell'intero portafoglio (ETF + Azioni + Bond)</h3>
      <p class="muted small-note">Tutte e tre le sezioni insieme, capitale totale <b>${eur(Math.round(totCap))}</b>. Ogni strumento è proiettato col suo CAGR, TER e aliquota (algoritmo 019); i totali sono la somma. Il CAGR netto atteso applica l'MDD storico ponderato del portafoglio.</p>
      ${years.map(scenario).join('')}
      <h4 class="pf-h4" style="margin-top:16px">Scenari storici (pessimistico 2% · base 7% · ottimistico 10%)</h4>
      <p class="muted small-note">Stesso algoritmo (CAGR lordo − TER, montante composto, imposta sulla plusvalenza), ma con un rendimento di mercato fisso uguale per tutti gli strumenti, mantenendo TER e aliquota di ciascuno. Il 7% è il rendimento reale storico netto dell'azionario globale degli ultimi 100 anni.</p>
      ${years.map(histBlock).join('')}`;
    })()}
    ${(() => {
      // Stress test TOTALE di tutto il portafoglio (ETF + Azioni + Bond), metodo del documento 041
      const nameOf = (row) => findByCode(row.isin)?.name || row.isin || 'strumento';
      const items = [
        ...p.rows.map((r) => ({ name: nameOf(r), amount: r.amount || 0, cagr: rowCagr(r, 1), ter: r.ter, mdd: r.mdd })),
        ...(p.stocks || []).map((r) => ({ name: nameOf(r), amount: r.amount, cagr: rowCagr(r, 1), ter: 0, mdd: r.mdd })),
        ...(p.bonds || []).map((r) => ({ name: nameOf(r), amount: r.amount, cagr: rowCagr(r, 1), ter: r.ter, mdd: r.mdd })),
      ];
      const nSections = [p.rows.length > 0, (p.stocks || []).length > 0, (p.bonds || []).length > 0].filter(Boolean).length;
      if (nSections < 1) return '';
      const yr = years.find((y) => !isShortHorizon(y)) ?? years[years.length - 1]; // il crash a lungo termine si calcola sul primo orizzonte ≥ 1 anno
      const ts = totalPortfolioStress({ items, years: yr });
      if (!ts) return '';
      const months = (m) => (m == null ? '<span class="neg">nessun recupero con questo CAGR</span>' : `≈ ${Math.round(m)} mesi (circa ${(m / 12).toFixed(1)} anni)`);
      const fmtk = (x) => eur(Math.round(x));
      const fme = (row) => `<tr><td>${esc(row.name).slice(0, 40)}</td><td class="num">${pct(row.weight, false, 1)}</td><td class="num neg">${row.mdd != null ? '−' + pct(row.mdd, false, 0) : '<span class="muted">n.d.</span>'}</td><td class="num neg">${row.mdd != null ? '−' + pct(row.weight * row.mdd, false, 1) : '–'}</td></tr>`;
      return `<h3 style="margin-top:26px">Stress test totale del portafoglio (Black Swan, documento 041)</h3>
      <p class="muted small-note">Tutto il portafoglio insieme (ETF + Azioni + Bond), capitale ${fmtk(ts.capital)}. Il crash avviene al picco di fine ${horizonLong(yr)}, quando il montante è massimo; a ogni strumento si applica il suo MDD storico e l'MDD del portafoglio è la media ponderata.</p>
      <table class="mini"><thead><tr><th>Strumento</th><th class="num">Peso</th><th class="num">MDD applicato</th><th class="num">Contributo (peso × MDD)</th></tr></thead><tbody>${ts.breakdown.map(fme).join('')}
        <tr><th>Totale portafoglio</th><th class="num">100%</th><th class="num neg">—</th><th class="num neg">−${pct(ts.mdd, false, 2)}</th></tr></tbody></table>
      <table class="mini"><tbody>
        <tr><td>Valore al picco (lordo) a ${horizonLong(yr)}</td><td class="num"><b>${fmtk(ts.peak)}</b></td></tr>
        <tr><td>Crash: drawdown ponderato −${pct(ts.mdd, false, 2)}${ts.mddCov < 0.999 ? ` (su ${pct(ts.mddCov, false, 0)} con MDD)` : ''}</td><td class="num neg">− ${fmtk(ts.crash)}</td></tr>
        <tr><th>Valore dopo il crash (fondo del barile)</th><th class="num">${fmtk(ts.postCrash)}</th></tr>
        <tr><td>Rispetto al capitale investito (${fmtk(ts.capital)})</td><td class="num ${cls(ts.vsToday)}">${ts.vsToday > 0 ? '+' : ''}${fmtk(ts.vsToday)} (${pct(ts.vsToday / ts.capital, true)})</td></tr>
        <tr><td>Tempo di recupero stimato (dal minimo al picco, al CAGR netto ${pct(ts.netCagr, false, 2)})</td><td class="num">${months(ts.recoveryMonths)}</td></tr>
      </tbody></table>
      <p class="muted small-note"><b>Regole d'ingaggio durante il crash (SOP):</b> 1) niente panic selling: vendere al minimo trasforma una flessione temporanea in perdita permanente. 2) Reinvestire i dividendi degli ETF a distribuzione comprando ciò che è sceso di più (abbassa il prezzo medio, accorcia il recupero). 3) Se hai nuova liquidità, iniettarla mentre il portafoglio è al minimo è la mossa più redditizia. Il recupero può estendere l'orizzonte di 3-4 anni oltre i ${horizonLong(yr)}.</p>`;
    })()}
  `;
  const bucketOf = (name) => (name === 'stocks' ? (p.stocks ||= []) : name === 'bonds' ? (p.bonds ||= []) : p.rows);
  const upd = (bucket, k, f, v) => {
    const arr = bucketOf(bucket);
    const row = arr[k];
    if (!row) return;
    if (f === 'isin') {
      row.isin = v.trim().toUpperCase();
      const inst = findByCode(row.isin);
      if (inst) {
        row.name = inst.name;
        // Nuovo strumento: CAGR atteso, TER, aliquota e MDD storico dal modello (l'utente può poi correggerli).
        // Per le azioni si usa il CAGR fondamentale forward (prospettive di crescita aggiornate, metodo Gemini).
        const r = resOf(inst);
        const pp = r && !r.error ? projParams(inst, r, bucket === 'stocks') : null;
        row.manual = []; // nuovo strumento: tutte le stime seguono il modello
        if (pp) {
          row.cagr = pp.cagr;
          row.tax = pp.tax;
          row.ter = pp.ter;
          row.mdd = pp.mdd ?? null;
        } else {
          row.cagr = null;
          row.mdd = null;
        }
      } else {
        row.name = '';
        row.cagr = null;
        row.mdd = null;
      }
    } else if (f === 'amount') {
      const n = parseFloat(String(v).replace(',', '.'));
      row.amount = Number.isFinite(n) ? Math.max(0, n) : null;
    } else {
      const n = parseFloat(String(v).replace(',', '.'));
      row[f] = Number.isFinite(n) ? n / 100 : null;
      row.manual = Array.from(new Set([...(row.manual || []), f])); // valore inserito a mano: non più sovrascritto dal modello
    }
    savePortfolio(p);
  };
  for (const inp of $$('#pf-body [data-bucket][data-f]')) {
    const k = +inp.closest('tr').dataset.k;
    inp.addEventListener('change', (e) => {
      upd(e.target.dataset.bucket, k, e.target.dataset.f, e.target.value);
      renderPortfolio();
    });
  }
  for (const b of $$('#pf-body [data-use][data-bucket]')) b.addEventListener('click', () => {
    const row = bucketOf(b.dataset.bucket)[+b.dataset.k];
    row[b.dataset.use] = +b.dataset.v;
    row.manual = (row.manual || []).filter((f) => f !== b.dataset.use); // torna a seguire il modello
    savePortfolio(p);
    renderPortfolio();
  });
  for (const b of $$('#pf-body [data-del][data-bucket]')) b.addEventListener('click', () => {
    bucketOf(b.dataset.bucket).splice(+b.dataset.del, 1);
    savePortfolio(p);
    renderPortfolio();
  });
  for (const b of $$('#pf-body [data-addbucket]')) b.addEventListener('click', () => {
    const bk = b.dataset.addbucket;
    if (bk === 'rows') p.rows.push({ isin: '', name: '', amount: null, ter: 0.002, cagr: null, tax: 0.26, mdd: null });
    else bucketOf(bk).push({ isin: '', name: '', amount: null, ter: bk === 'stocks' ? 0 : 0.002, cagr: null, tax: 0.26, mdd: null });
    savePortfolio(p);
    renderPortfolio();
  });
  $('#pf-preset').addEventListener('click', () => {
    // Il preset riguarda la parte ETF (a %): le sezioni Azioni e Bond in euro restano invariate.
    state.portfolio = { ...JSON.parse(JSON.stringify(GEMINI_PORTFOLIO)), stocks: p.stocks || [], bonds: p.bonds || [] };
    for (const row of state.portfolio.rows) {
      row.amount = Math.round((state.portfolio.capital || 12000) * (row.weight || 0)); // importi del documento (60/20/20 su 12.000 €)
      row.manual = ['cagr', 'ter', 'tax', 'mdd']; // valori del documento: fissi finché non si usa «Usa stime del modello»
    }
    savePortfolio(state.portfolio);
    renderPortfolio();
  });
  $('#pf-model').addEventListener('click', () => {
    const inStocks = new Set(p.stocks || []);
    for (const row of [...p.rows, ...(p.stocks || []), ...(p.bonds || [])]) {
      row.manual = []; // d'ora in poi segue sempre il modello
      const inst = findByCode(row.isin);
      const r = inst ? resOf(inst) : null;
      const pp = inst && r && !r.error ? projParams(inst, r, inStocks.has(row)) : null;
      if (pp) {
        row.cagr = pp.cagr;
        row.tax = pp.tax;
        row.ter = pp.ter;
        if (pp.mdd != null) row.mdd = pp.mdd;
      }
    }
    savePortfolio(p);
    renderPortfolio();
  });
  $('#pf-share')?.addEventListener('click', async () => {
    const code = encodePortfolio(p);
    const link = `${location.origin}${location.pathname}#pf=${code}`;
    let done = false;
    try {
      await navigator.clipboard.writeText(link);
      done = true;
    } catch {
      /* clipboard non disponibile */
    }
    const btn = $('#pf-share');
    if (btn) {
      btn.textContent = done ? '✓ Link copiato' : 'Copia manuale ↓';
      setTimeout(() => (btn.textContent = 'Condividi'), 2500);
    }
    if (!done) window.prompt('Copia questo link del portafoglio:', link);
  });
  $('#pf-import')?.addEventListener('click', () => {
    const txt = window.prompt('Incolla il link o il codice del portafoglio copiato dall\'altro dispositivo:');
    if (!txt) return;
    const imp = decodePortfolio(txt);
    if (!imp) {
      alert('Codice non valido.');
      return;
    }
    state.portfolio = imp;
    savePortfolio(imp);
    renderPortfolio();
  });
  $('#pf-capital')?.addEventListener('change', (e) => {
    p.capital = Math.max(0, parseFloat(e.target.value) || 0);
    savePortfolio(p);
    renderPortfolio();
  });
  $('#pf-rho')?.addEventListener('change', (e) => {
    p.rho = Math.max(-1, Math.min(1, parseFloat(String(e.target.value).replace(',', '.'))));
    if (!Number.isFinite(p.rho)) p.rho = 0.65;
    savePortfolio(p);
    renderPortfolio();
  });
  // Orizzonti: chip rapidi (7/30/60/90 giorni, 1-10 anni) + valore personalizzato in giorni o anni
  const setHorizons = (list) => {
    p.years = normalizeHorizons(list);
    savePortfolio(p);
    renderPortfolio();
  };
  for (const b of $$('#pf-body [data-h]')) b.addEventListener('click', () => {
    const y = Number(b.dataset.h);
    const cur = normalizeHorizons(p.years);
    const has = cur.some((v) => Math.abs(v - y) < 1e-9);
    if (has && cur.length === 1) return; // ne serve almeno uno
    setHorizons(has ? cur.filter((v) => Math.abs(v - y) >= 1e-9) : [...cur, y]);
  });
  $('#pf-taxp')?.addEventListener('change', (e) => {
    p.taxPrudent = !!e.target.checked;
    savePortfolio(p);
    renderPortfolio();
  });
  $('#pf-mrho')?.addEventListener('change', (e) => {
    const v = parseFloat(String(e.target.value).replace(',', '.'));
    p.momRho = Number.isFinite(v) ? Math.max(-0.5, Math.min(1, v / 100)) : null; // vuoto = automatica (previsioni)
    savePortfolio(p);
    renderPortfolio();
  });
  $('#pf-hadd')?.addEventListener('click', () => {
    const n = parseFloat(String($('#pf-hn').value).replace(',', '.'));
    if (!(n > 0)) return;
    setHorizons([...normalizeHorizons(p.years), $('#pf-hu').value === 'd' ? daysToYears(Math.round(n)) : n]);
  });
}
function openPortfolio() {
  if (!state.portfolio) state.portfolio = loadPortfolio();
  if (state.portfolio.rhoMode !== 2) { state.portfolio.momRho = null; state.portfolio.rhoMode = 2; savePortfolio(state.portfolio); } // nuova regola: persistenza automatica
  renderPortfolio();
  $('#portfolio').showModal();
}

// ---------- Notifiche: suggerimenti di riallocazione dai dati di mercato aggiornati
// Miglior strumento per classe (ETF con stima dalla composizione, azioni, bond) per rapporto
// rischio/rendimento (CAGR atteso × (1 − MDD)); in cache per versione dei dati.
// Max Growth di uno strumento (ETF/azioni): punteggio, esito fase 1, guadagno netto su un importo
function mgOf(inst, amount = 10000, years = 5) {
  const r = state.results[inst.symbol];
  if (!r || r.error) return null;
  const mg = maxGrowthScore(inst, r.sim, r.forward, r.fund?.ter, r.fund, state.quotes[inst.symbol]?.perf);
  const p1 = phase1Check(inst, r.fund, distKind(inst), r.forward);
  if (!mg) return { score: null, net: null, pass: false, reason: p1.reason || 'meno di 5 anni di storico: punteggio non calcolabile' };
  const tx = Number.isFinite(r.sim?.taxRate) ? r.sim.taxRate / 100 : 0.26;
  const g = amount * ((1 + mg.score) ** years - 1);
  return { ...mg, pass: p1.pass, reason: p1.reason || null, net: Math.round(g > 0 ? g * (1 - tx) : g) };
}
// Migliori strumenti Max Growth per classe (ETF / azioni), con i dati più recenti
function bestMaxGrowth() {
  const ver = state.liveVersion || state.dataVersion || '';
  if (state.bestMgCache?.v === ver) return state.bestMgCache.best;
  const best = { etf: [], stock: [] };
  for (const i of state.instruments) {
    if (i.type !== 'etf' && i.type !== 'stock') continue;
    if (i.type === 'etf' && (isBond(i) || state.results[i.symbol]?.forward?.growthSource !== 'holdings')) continue;
    const m = mgOf(i);
    if (!m || !m.pass || m.score == null) continue;
    best[i.type].push({ symbol: i.symbol, name: i.name, isin: i.isin, score: m.score, m3: m.m3, growth: m.growth });
  }
  for (const k of Object.keys(best)) best[k] = best[k].sort((a, b) => b.score - a.score).slice(0, 30);
  state.bestMgCache = { v: ver, best };
  return best;
}
// ---------- suggerimenti del portafoglio: incentrati sul NETTO PIÙ PROBABILE
// Il criterio è il guadagno netto più probabile (mediana, dopo imposta e costi) all'orizzonte scelto (periodo «Netto più probabile»,
// predefinito 30 gg). Il Max Growth entra solo a parità: tra gli strumenti con netto più probabile e prospettive di crescita
// equivalenti si suggerisce quello con il Max Growth più alto.
const ADVICE_DAYS = [1, 7, 14, 30, 60, 90, 365, 1095, 1825];
const adviceDays = () => {
  const d = Number(lsGet('trmc.advDays', 30));
  return ADVICE_DAYS.includes(d) ? d : 30; // scelto nella finestra delle notifiche: non cambia guardando altri periodi in classifica
};
const advClass = (i) => (isBond(i) ? 'bond' : i.type);
// strumenti troppo piccoli o poco liquidi non vengono mai suggeriti come destinazione
function advSizeOk(i, r) {
  if (i.type === 'etf') return (aumEur(r.fund) ?? 0) >= 100e6;
  if (i.type === 'stock') return (r.forward?.mcap ?? 0) >= 1e9;
  return false;
}
function npCandidates(inst, days) {
  const ver = state.liveVersion || state.dataVersion || '';
  const cls = advClass(inst);
  const key = `${ver}|${days}|${cls}|${inst.symbol}|${inst.leveraged ? 1 : 0}|${state.settings.mc.amount}|${state.settings.mc.orderCost}|${state.view.scenario}`;
  if (state.advCache?.ver !== ver) state.advCache = { ver, map: new Map() };
  if (state.advCache.map.has(key)) return state.advCache.map.get(key);
  const list = [];
  const hv = state.results[inst.symbol]?.forward?.vol;
  for (const i of state.instruments) {
    if (i.symbol === inst.symbol || advClass(i) !== cls || (i.type !== 'etf' && i.type !== 'stock')) continue;
    if (!!i.leveraged !== !!inst.leveraged) continue;
    const r = state.results[i.symbol];
    if (!r || r.error || !(state.quotes[i.symbol]?.priceEur > 0) || !advSizeOk(i, r)) continue;
    const cv = r.forward?.vol;
    if (Number.isFinite(hv) && Number.isFinite(cv) && cv > 1.6 * hv + 0.03) continue; // non si propone uno strumento molto più rischioso
    const x = npCached(i, days);
    if (!x || !(x.median > 0) || !(x.p >= 0.55)) continue;
    list.push({ symbol: i.symbol, name: i.name, isin: i.isin, median: x.median, p: x.p, vol: Number.isFinite(cv) ? cv : null, growth: Number.isFinite(r.forward?.growth) ? r.forward.growth : null });
  }
  list.sort((a, b) => b.median - a.median);
  const top = list.slice(0, 60);
  state.advCache.map.set(key, top);
  return top;
}
// Destinazione: i candidati con netto più probabile entro la tolleranza dal migliore e prospettive di crescita equivalenti
// formano la «parità»; tra questi vince il Max Growth più alto.
function pickTarget(cands, days) {
  const pg = parityGroup(cands, days);
  if (!pg) return null;
  const withMg = pg.group.map((c) => {
    const i = state.instruments.find((x) => x.symbol === c.symbol);
    const m = i ? mgOf(i, 10000, 5) : null;
    return { ...c, mg: Number.isFinite(m?.score) ? m.score : null };
  });
  const { target, tie } = chooseByMaxGrowth(withMg);
  return { target, tol: pg.tol, group: withMg, tie, bestMedian: pg.best.median };
}
// Azione suggerita per uno strumento del portafoglio: vendi tutto / vendi una quota / rialloca una quota / aumenta / mantieni
function adviseHolding(inst, amount, share, prevSnap) {
  const days = adviceDays();
  const mine = npCached(inst, days);
  if (!mine) return null;
  const m = mgOf(inst, amount, 5); // Max Growth: solo informativo e per gli spareggi
  const pick = pickTarget(npCandidates(inst, days), days);
  const t = pick?.target ?? null;
  const gap = t ? t.median - mine.median : 0;
  const thr = t ? gapThreshold(t.median, days) : Infinity; // scarto da considerare significativo
  const out = (action, frac, why, useTarget = true) => {
    const tt = frac > 0 && action !== 'buy' && useTarget ? t : null;
    return { action, frac, vol: state.results[inst.symbol]?.forward?.vol, eur: Math.round(amount * frac), target: tt, extra: tt ? (tt.median - mine.median) * amount * frac : null, why, m, days, mine, tie: !!(tt && pick.tie), group: pick?.group?.length ?? 0 };
  };
  const hz = npLabel(days);
  // 1) il netto più probabile è negativo: l'esito atteso è una perdita
  if (mine.median <= 0 && mine.p < 0.5) return out('sell', 1, `il netto più probabile a ${hz} è ${pct(mine.median, true)} (${eur(mine.median * amount)}) con probabilità di guadagno ${pct(mine.p, false, 0)}`);
  // 2) concentrazione: solo per azioni singole ed ETF poco diversificati
  const diversifiedEtf = inst.type === 'etf' && !(m?.conc > 0);
  if (share > 0.4 && !diversifiedEtf) return out('trim', Math.min(0.5, (share - 0.4) / share + 0.0001), `pesa ${pct(share, false, 0)} del portafoglio: riduci la concentrazione sotto il 40%`);
  // 3) un altro strumento ha un netto più probabile nettamente migliore
  const moveFrac = gap >= 2 * thr ? 0.5 : 0.3;
  if (t && gap >= thr && gap * amount * moveFrac >= 20) return out('move', moveFrac, `netto più probabile a ${hz}: ${pct(t.median, true)} contro ${pct(mine.median, true)} del tuo`);
  // 4) il tuo strumento è tra i migliori per netto più probabile
  if (t && mine.median > 0 && mine.p >= 0.55 && mine.median >= pick.bestMedian - pick.tol && share < 0.35) return out('buy', 0.2, `tra i più probabili a ${hz} (${pct(mine.median, true)}, probabilità di guadagno ${pct(mine.p, false, 0)})`, false);
  return out('hold', 0, `netto più probabile a ${hz} ${pct(mine.median, true)}: in linea con le alternative`, false);
}
const ADVICE_LABEL = { sell: '🔴 Vendi 100%', trim: '🟠 Vendi una quota', move: '🔄 Rialloca una quota', buy: '🟢 Aumenta', hold: '⚪ Mantieni' };
function adviceText(a) {
  const pctTxt = a.action === 'sell' ? '100%' : `${Math.round(a.frac * 100)}%`;
  const amt = eur(a.eur);
  const hz = npLabel(a.days);
  const t = a.target;
  const dest = t ? ` e compra ${esc(t.name).slice(0, 40)}${t.isin ? ' (' + esc(t.isin) + ')' : ''}: netto più probabile a ${hz} ${pct(t.median, true)} (probabilità di guadagno ${pct(t.p, false, 0)}${Number.isFinite(t.vol) ? `, volatilità ${pct(t.vol, false, 0)}${Number.isFinite(a.vol) ? ` contro ${pct(a.vol, false, 0)} del tuo` : ''}` : ''})${a.tie && Number.isFinite(t.mg) ? `. A parità di netto più probabile e di crescita attesa tra ${a.group} strumenti, scelto per il Max Growth più alto (${pct(t.mg, true)}/anno)` : ''}` : '';
  const extra = a.extra != null && a.extra > 0 ? ` Sull'importo spostato: +${eur(a.extra)} di netto più probabile in più a ${hz}.` : '';
  if (a.action === 'hold') return `${a.why}.`;
  if (a.action === 'buy') return `Aumenta la quota di circa ${pctTxt} (${amt}): ${a.why}.`;
  return `Vendi ${pctTxt} (${amt})${dest}. Motivo: ${a.why}.${extra}`;
}
function buildNotifications(save = false) {
  const p = state.portfolio || loadPortfolio();
  const holds = [
    ...(p.rows || []).map((r) => ({ ...r, section: 'etf' })),
    ...(p.stocks || []).map((r) => ({ ...r, section: 'stock' })),
    ...(p.bonds || []).map((r) => ({ ...r, section: 'bond' })),
  ].filter((r) => r.isin && r.amount > 0);
  if (!holds.length) return [];
  const total = holds.reduce((a, r) => a + (r.amount || 0), 0) || 1;
  let snap = {};
  try { snap = JSON.parse(localStorage.getItem('trmc.pfSnap') || '{}'); } catch { snap = {}; }
  const newSnap = {};
  const out = [];
  // avvisi di vendita (strumenti volatili / a breve termine): calcolati da checkSellAlerts a ogni aggiornamento dei prezzi
  for (const a of state.sellAlerts || []) out.push({ level: a.level === 'sell' ? 'sell' : a.level === 'trim' ? 'trim' : 'warn', icon: a.icon, title: esc(a.title), text: esc(a.text) });
  for (const h of holds) {
    const inst = findByCode(h.isin);
    if (!inst) continue;
    const r = state.results[inst.symbol];
    if (!r || r.error) continue;
    const isStock = h.section === 'stock';
    const cagr = projParams(inst, r, isStock)?.cagr;
    const mdd = Number.isFinite(r.sim?.histMdd) ? r.sim.histMdd : null;
    const q = state.quotes[inst.symbol];
    const perf = q?.perf || {};
    const share = h.amount / total;
    const cls = isBond(inst) ? 'bond' : inst.type;
    const nm = esc(inst.name).slice(0, 44);
    newSnap[inst.symbol] = { cagr: Number.isFinite(cagr) ? cagr : null, price: q?.priceEur ?? null };
    const prev = snap[inst.symbol];
    if (perf.m != null && perf.m <= -0.08 && Number.isFinite(cagr) && cagr >= 0.06)
      out.push({ level: 'buy', icon: '📉', title: `${nm}: occasione d'acquisto`, text: `Sceso ${pct(perf.m, true)} nell'ultimo mese, ma il rendimento atteso resta ${pct(cagr, false)}. Mediazione al ribasso: aumentare la quota a prezzo scontato.` });
    if (perf.m3 != null && perf.m3 >= 0.2)
      out.push({ level: 'trim', icon: '📈', title: `${nm}: quota cresciuta`, text: `Salito ${pct(perf.m3, true)} in 3 mesi: ora pesa ${pct(share, false, 0)} del portafoglio. Valuta di prendere profitto e ribilanciare verso gli strumenti scesi.` });
    if (prev && Number.isFinite(prev.cagr) && Number.isFinite(cagr)) {
      const d = cagr - prev.cagr;
      if (d <= -0.02) out.push({ level: 'warn', icon: '⚠️', title: `${nm}: prospettive peggiorate`, text: `Il rendimento atteso è sceso da ${pct(prev.cagr, false)} a ${pct(cagr, false)} con gli ultimi aggiornamenti. Valuta di ridurre o sostituire.` });
      else if (d >= 0.02) out.push({ level: 'good', icon: '✅', title: `${nm}: prospettive migliorate`, text: `Il rendimento atteso è salito da ${pct(prev.cagr, false)} a ${pct(cagr, false)}. Si potrebbe aumentare la quota.` });
    }
    if (cls !== 'bond' && Number.isFinite(cagr) && cagr < 0.03)
      out.push({ level: 'warn', icon: '🔻', title: `${nm}: rendimento atteso basso`, text: `Rendimento atteso ${pct(cagr, false)}, sotto quello di un'obbligazione. Valuta di sostituirlo con uno strumento a prospettive migliori.` });
    if (share > 0.4)
      out.push({ level: 'warn', icon: '🎯', title: `${nm}: concentrazione elevata`, text: `Pesa ${pct(share, false, 0)} del portafoglio: una quota così alta su un singolo strumento aumenta il rischio. Valuta di diversificare.` });
    if (cls !== 'crypto') {
      // Revisione delle stime degli analisti: crescita attesa degli utili cambiata dall'ultimo controllo
      const gNow = Number.isFinite(r.forward?.growth) ? r.forward.growth : null;
      newSnap[inst.symbol].growth = gNow;
      if (gNow != null && prev && Number.isFinite(prev.growth)) {
        const dg = gNow - prev.growth;
        if (dg <= -0.02) out.push({ level: 'warn', icon: '📉', title: `${nm}: stime degli analisti tagliate`, text: `La crescita attesa degli utili è scesa da ${pct(prev.growth, true)} a ${pct(gNow, true)}/anno con le ultime stime.` });
        else if (dg >= 0.02) out.push({ level: 'good', icon: '📈', title: `${nm}: stime degli analisti alzate`, text: `La crescita attesa degli utili è salita da ${pct(prev.growth, true)} a ${pct(gNow, true)}/anno con le ultime stime.` });
      }
      // Netto più probabile: variazione rispetto all'ultimo controllo (stesso orizzonte)
      const days = adviceDays();
      const np = npCached(inst, days);
      if (np) {
        newSnap[inst.symbol].np = { d: days, v: np.median };
        const dv = prev?.np?.d === days && Number.isFinite(prev.np.v) ? np.median - prev.np.v : null;
        const lim = 0.01 * Math.sqrt(days / 30) + 0.005;
        if (dv != null && dv <= -lim) out.push({ level: 'warn', icon: '⚠️', title: `${nm}: netto più probabile in calo`, text: `A ${npLabel(days)} è sceso da ${pct(prev.np.v, true)} a ${pct(np.median, true)} con i dati più recenti. Valuta di ridurre la quota.` });
        else if (dv != null && dv >= lim) out.push({ level: 'good', icon: '✅', title: `${nm}: netto più probabile in aumento`, text: `A ${npLabel(days)} è salito da ${pct(prev.np.v, true)} a ${pct(np.median, true)}. Si potrebbe aumentare la quota.` });
      }
      const adv = adviseHolding(inst, h.amount, share, prev);
      if (adv && adv.action !== 'hold') out.push({ level: adv.action === 'sell' ? 'warn' : adv.action === 'buy' ? 'good' : 'swap', icon: ADVICE_LABEL[adv.action].split(' ')[0], title: `${nm}: ${ADVICE_LABEL[adv.action].slice(2).trim()}`, text: adviceText(adv) });
    }
  }
  if (save) { try { localStorage.setItem('trmc.pfSnap', JSON.stringify(newSnap)); } catch { /* niente */ } }
  const order = { sell: -1, warn: 0, buy: 1, swap: 2, trim: 3, good: 4 };
  out.sort((a, b2) => (order[a.level] ?? 9) - (order[b2.level] ?? 9));
  return out;
}

// ---------- avvisi di vendita (portafoglio)
// Per ogni posizione volatile, a leva o con alto guadagno atteso a breve: soglia di protezione dal massimo, calo forte in giornata,
// previsione a 7/30 giorni diventata negativa, metà guadagno restituito. Indicazioni del modello: l'app non vende mai da sola.
const LS_WATCH = 'trmc.pfWatch';
const LS_SENT = 'trmc.alertSent';
const LS_DEV = 'trmc.alertsDev';
const lsGet = (k, d) => {
  try { return JSON.parse(localStorage.getItem(k) || 'null') ?? d; } catch { return d; }
};
const lsSet = (k, v) => {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* niente */ }
};
function sellHoldings() {
  const p = state.portfolio || loadPortfolio();
  const by = new Map();
  for (const r of [...(p.rows || []), ...(p.stocks || []), ...(p.bonds || [])]) {
    if (!r.isin || !(r.amount > 0)) continue;
    const inst = findByCode(r.isin);
    const res = inst ? state.results[inst.symbol] : null;
    const q = inst ? state.quotes[inst.symbol] : null;
    if (!inst || !res || res.error || !(q?.priceEur > 0)) continue;
    const cur = by.get(inst.symbol);
    if (cur) {
      cur.amount += r.amount;
      continue;
    }
    const fc = {};
    for (const d of [7, 14, 30]) {
      const x = npCached(inst, d);
      if (x) fc[d] = { median: x.median, p: x.p };
    }
    by.set(inst.symbol, { symbol: inst.symbol, name: inst.name, amount: r.amount, vol: volOfCode(inst.isin), leveraged: !!inst.leveraged, price: q.priceEur, changePct: q.changePct, fc });
  }
  return [...by.values()];
}
const BASE_TITLE = document.title;
// ---------- notifiche sulla sezione «Solidi e in crescita» (regole in solid-alerts.js)
// A ogni aggiornamento dei dati live: calo previsto a breve, oscillazioni forti, uscita dalla sezione, rafforzamento.
// Lo stato (massimi, membri della sezione) è salvato su questo dispositivo; le notifiche del dispositivo arrivano se l'app è aperta.
const LS_SOLID_WATCH = 'trmc.solidWatch';
const LS_SOLID_SET = 'trmc.solidSet';
const LS_SOLID_EV = 'trmc.solidEvents';
const LS_SOLID_SEEN = 'trmc.solidSeen'; // prima comparsa di ogni notifica: serve per la data e per l'ordine
function solidItems(prevSet) {
  const was = new Set(prevSet || []);
  const items = [];
  for (const i of state.instruments) {
    const q = state.quotes[i.symbol];
    const r = state.results[i.symbol];
    if (!q || !r || r.error || !(q.priceEur > 0)) continue;
    const h = histValues(i, q);
    if (!solidRecent(h) && !was.has(i.symbol)) continue; // la crescita recente è il filtro economico: le previsioni solo per i candidati
    const m = (d) => npCached(i, d)?.median;
    const np = { y1: m(365), y3: m(1095), y5: m(1825) };
    const member = solidPass(np, h);
    if (!member && !was.has(i.symbol)) continue;
    np.d7 = m(7);
    np.d30 = m(30);
    const cv = consensusValues(i, r);
    items.push({ symbol: i.symbol, isin: i.isin || '', name: i.name, price: q.priceEur, changePct: q.changePct, vol: Number.isFinite(r.forward?.vol) ? r.forward.vol : null, h, np, solid: member, trend: trendScore(q.perf), p30: npCached(i, 30)?.p ?? null, an: { up: cv.anUp, n: cv.anN, warn: cv.anWarn } });
  }
  return items;
}
function checkSolidAlerts({ notify = true } = {}) {
  try {
    if (STATIC && !state.liveReady) return; // dati statici di ore fa: niente confronti finché non arrivano quelli live
    if (!state.instruments.length || !Object.keys(state.quotes).length) return;
    const now = Date.now();
    const prevSet = lsGet(LS_SOLID_SET, null);
    const { alerts, watch, set } = evaluateSolid(solidItems(prevSet), lsGet(LS_SOLID_WATCH, {}), prevSet, now, state.settings.mc.amount || 10000);
    lsSet(LS_SOLID_WATCH, watch);
    lsSet(LS_SOLID_SET, set);
    // Uscite e nuovi ingressi sono eventi di un solo controllo: restano visibili per 24 ore (altrimenti sparirebbero al ricalcolo successivo)
    const isEvent = (a) => a.key.startsWith('sx:') || a.key.startsWith('snew:');
    const keep = lsGet(LS_SOLID_EV, []).filter((e) => now - e.at < 864e5 && !alerts.some((a) => a.key === e.key) && (e.key.startsWith('sx:') ? !set.includes(e.symbol) : set.includes(e.symbol)));
    const events = [...alerts.filter(isEvent).map((a) => ({ ...a, at: now })), ...keep].slice(0, 80);
    lsSet(LS_SOLID_EV, events);
    // ordine per data: la più recente in alto (a parità di data, la più urgente)
    const stamped = stampAlerts([...alerts.filter((a) => !isEvent(a)), ...events], lsGet(LS_SOLID_SEEN, {}), now);
    lsSet(LS_SOLID_SEEN, stamped.seen);
    state.solidAlerts = stamped.list;
    state.solidSet = set;
    state.solidAt = now;
    updateNotifsBadge();
    renderSolidAlerts();
    if (!notify) return;
    const sent = lsGet(LS_SENT, {});
    const due = dueAlerts(alerts.filter((a) => a.level === 'sell' || a.level === 'warn' || a.level === 'buy'), sent, now);
    lsSet(LS_SENT, sent);
    if (due.length) {
      showSellBar(due);
      notifyDevice(due);
    }
  } catch (e) {
    console.warn('notifiche sezione solidi', e);
  }
}
const hm = (t) => new Date(t).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
// data della notifica: «oggi 14:05», altrimenti giorno e mese
const whenLabel = (t) => (new Date(t).toDateString() === new Date().toDateString() ? `oggi ${hm(t)}` : `${new Date(t).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' })} ${hm(t)}`);
function solidNoteHtml(a) {
  return `<div class="notif notif-${a.level}"><div class="notif-t"><span class="notif-ic">${esc(a.icon)}</span> <b>${esc(a.title)}</b>${a.isin ? ` <span class="muted">· ${esc(a.isin)}</span>` : ''}${a.at ? ` <span class="muted notif-when">· ${whenLabel(a.at)}</span>` : ''}</div><div class="muted">${esc(a.text)}</div></div>`;
}
// Riquadro nella sezione: i segnali più urgenti, poi il rimando alla finestra 🔔 con tutti
function renderSolidAlerts() {
  const box = $('#solid-alerts');
  if (!box) return;
  box.hidden = !solidMode();
  if (!solidMode()) return;
  if (state.solidAlerts === undefined) {
    box.innerHTML = '<span class="muted">Notifiche sulla sezione: in preparazione con i dati aggiornati…</span>';
    return;
  }
  const main = state.solidAlerts.filter((a) => a.level !== 'new');
  const news = state.solidAlerts.length - main.length;
  box.innerHTML = `<b>🔔 Notifiche sulla sezione</b> <span class="muted">· aggiornate alle ${hm(state.solidAt)} a ogni aggiornamento dei dati · in ordine di data, la più recente in alto · calo previsto, oscillazioni forti, uscita o rafforzamento secondo il modello (non ordini né consigli)</span>${
    main.length
      ? main.slice(0, 6).map(solidNoteHtml).join('') + (main.length > 6 ? `<button type="button" class="ghost small" data-act="solid-open">Mostra tutte le ${main.length} notifiche</button>` : '')
      : '<div class="pos">Nessun calo previsto, nessuna oscillazione forte: gli strumenti della sezione sono in linea con le previsioni.</div>'
  }${news ? `<div class="muted small-note">${news} ${news === 1 ? 'nuovo ingresso' : 'nuovi ingressi'} nella sezione dall'ultimo controllo <button type="button" class="ghost small" data-act="solid-open">Vedi</button></div>` : ''}`;
}
function solidSheetHtml() {
  if (!state.solidAlerts) return '';
  const main = state.solidAlerts.filter((a) => a.level !== 'new');
  const news = state.solidAlerts.filter((a) => a.level === 'new');
  return `<h3>Sezione «Solidi e in crescita»</h3><p class="muted small-note">Aggiornate alle ${hm(state.solidAt)} a ogni aggiornamento dei dati, in ordine di data (la più recente in alto). Segnali del modello (calo previsto, oscillazioni forti, uscita dalla sezione, rafforzamento), non ordini né consigli di investimento. Le notifiche sul dispositivo arrivano con l'app aperta, anche in secondo piano.</p>${
    main.length ? main.slice(0, 40).map(solidNoteHtml).join('') : '<p class="pos">Nessun calo previsto, nessuna oscillazione forte nella sezione.</p>'
  }${news.length ? `<div class="muted small-note"><b>Nuovi ingressi (${news.length})</b></div>${news.slice(0, 10).map(solidNoteHtml).join('')}` : ''}`;
}
function checkSellAlerts({ notify = true } = {}) {
  setTimeout(() => checkSolidAlerts({ notify }), 50); // dopo il ridisegno: non allunga l'aggiornamento della tabella
  try {
    const now = Date.now();
    const { alerts, watch } = evaluateAlerts(sellHoldings(), lsGet(LS_WATCH, {}), now);
    lsSet(LS_WATCH, watch);
    state.sellAlerts = alerts;
    const n = alerts.filter((a) => a.level !== 'trim').length;
    document.title = (n ? `(🚨${n}) ` : '') + BASE_TITLE;
    updateNotifsBadge();
    if (!notify) return;
    const sent = lsGet(LS_SENT, {});
    const due = dueAlerts(alerts, sent, now);
    lsSet(LS_SENT, sent);
    if (due.length) {
      showSellBar(due);
      notifyDevice(due);
    }
  } catch (e) {
    console.warn('avvisi di vendita', e);
  }
}
function showSellBar(list) {
  let bar = $('#sell-bar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'sell-bar';
    bar.className = 'sell-bar';
    bar.setAttribute('role', 'alert');
    document.body.appendChild(bar);
    bar.addEventListener('click', (e) => {
      if (e.target.closest('[data-act="close"]')) bar.hidden = true;
      else openNotifications();
    });
  }
  const top = list[0];
  bar.innerHTML = `<span><b>${esc(top.icon)} ${esc(top.title)}</b>${list.length > 1 ? ` · +${list.length - 1} altri avvisi` : ''}<br><span class="muted">Tocca per vedere i dettagli</span></span><button class="ghost small" data-act="close" aria-label="Chiudi">✕</button>`;
  bar.hidden = false;
}
async function notifyDevice(list) {
  if (lsGet(LS_DEV, false) !== true || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  const reg = await navigator.serviceWorker?.getRegistration?.().catch(() => null);
  const show = async (title, body, tag) => {
    const o = { body, tag, vibrate: [200, 100, 200], requireInteraction: true };
    try {
      if (reg?.showNotification) await reg.showNotification(title, o);
      else new Notification(title, o);
    } catch { /* niente */ }
  };
  for (const a of list.slice(0, 3)) await show(`${a.icon} ${a.title}`, a.text.slice(0, 200), a.key);
  if (list.length > 3) await show(`🚨 ${list.length - 3} altri avvisi di vendita`, "Apri l'app per i dettagli.", 'more');
}
async function showTestNotification(title, body) {
  const reg = await navigator.serviceWorker?.getRegistration?.().catch(() => null);
  try {
    if (reg?.showNotification) await reg.showNotification(title, { body, tag: 'test' });
    else new Notification(title, { body, tag: 'test' });
  } catch { /* niente */ }
}
async function enableDeviceAlerts() {
  if (typeof Notification === 'undefined') {
    alert("Questo browser non supporta le notifiche: gli avvisi restano visibili nell'app (🔔) e nella barra rossa in basso.");
    return;
  }
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') {
    alert('Notifiche non consentite: abilitale dalle impostazioni del sito nel browser.');
    return;
  }
  try {
    await navigator.serviceWorker.register('sw.js');
    await navigator.serviceWorker.ready;
  } catch { /* niente: si usano le notifiche della pagina */ }
  lsSet(LS_DEV, true);
  await showTestNotification('✅ Avvisi di vendita attivi', 'Riceverai un avviso quando una posizione volatile supera la soglia di protezione o la previsione a breve diventa negativa.');
}
function adviceHorizonHtml() {
  const cur = adviceDays();
  const btn = ADVICE_DAYS.filter((d) => d !== 1 && d !== 14 && d !== 60).map((d) => `<button class="tab small${d === cur ? ' active' : ''}" data-act="adv-days" data-d="${d}">${npLabel(d)}</button>`).join('');
  return `<div class="notif notif-swap"><div class="notif-t"><span class="notif-ic">🎯</span> <b>Orizzonte dei suggerimenti: ${npLabel(cur)}</b></div>
    <div class="muted small-note">I suggerimenti di vendita e riallocazione si basano sul <b>netto più probabile</b> a questo orizzonte. Solo a parità di netto più probabile e di crescita attesa si propone lo strumento con il Max Growth più alto.</div>
    <span class="tabs" role="tablist">${btn}</span></div>`;
}
function deviceAlertsHtml() {
  const sup = typeof Notification !== 'undefined';
  const on = sup && lsGet(LS_DEV, false) === true && Notification.permission === 'granted';
  return `<div class="notif notif-swap"><div class="notif-t"><span class="notif-ic">📲</span> <b>Avvisi di vendita sul dispositivo: ${on ? 'attivi' : 'non attivi'}</b></div>
    <div class="muted small-note">Per gli strumenti volatili o con alto guadagno atteso a breve ricevi una notifica se superano la soglia di protezione dal massimo (in base alla loro volatilità), calano molto in giornata, la previsione a 7/30 giorni diventa negativa o restituiscono metà del guadagno. Funziona mentre l'app è aperta sul dispositivo, anche in secondo piano; ad app chiusa non arrivano. Il prezzo di riferimento è quello della prima rilevazione di ogni strumento nel portafoglio. Sono indicazioni del modello: l'app non vende mai da sola.</div>
    ${on ? '<button class="ghost small" data-act="alerts-test">Prova notifica</button> <button class="ghost small" data-act="alerts-off">Disattiva</button>' : sup ? '<button class="ghost small" data-act="alerts-on">Attiva avvisi sul dispositivo</button>' : '<span class="muted small-note">Notifiche non supportate da questo browser: restano gli avvisi nell\'app.</span>'}</div>`;
}
// App aperta in secondo piano: il controllo periodico normale è sospeso, qui solo i prezzi per gli avvisi
async function backgroundAlerts() {
  if (!document.hidden || !STATIC || state.running || lsGet(LS_DEV, false) !== true) return;
  const p = state.portfolio || loadPortfolio();
  if (![...(p.rows || []), ...(p.stocks || []), ...(p.bonds || [])].some((r) => r.isin && r.amount > 0) && !state.solidSet?.length) return;
  await checkLiveData().catch(() => {});
  await liveCrypto().catch(() => {});
  checkSellAlerts();
}

function updateNotifsBadge() {
  const el = $('#notifs-count');
  if (!el) return;
  const n = buildNotifications(false).length + (state.solidAlerts || []).filter((a) => a.level !== 'new').length;
  el.hidden = !n;
  el.textContent = n;
}

function openNotifications() {
  const notes = buildNotifications(true); // segna come viste (aggiorna la base per i confronti futuri)
  const body = $('#nf-body');
  const sub = $('#nf-sub');
  const when = state.liveVersion || state.dataVersion;
  if (sub) sub.textContent = `Suggerimenti in base agli ultimi dati di mercato${when ? ' (' + new Date(when).toLocaleString('it-IT') + ')' : ''}`;
  const p = state.portfolio || loadPortfolio();
  const hasHold = [...(p.rows || []), ...(p.stocks || []), ...(p.bonds || [])].some((r) => r.isin && r.amount > 0);
  body.innerHTML = !hasHold
    ? '<p class="muted">Aggiungi strumenti al portafoglio (sezione «Portafoglio») per ricevere suggerimenti di riallocazione basati sugli aggiornamenti di mercato.</p>'
    : notes.length
      ? `<p class="muted small-note">I suggerimenti si aggiornano a ogni ricalcolo dei dati (ogni ~5 minuti in orario di borsa). Sono indicazioni dal modello, non consigli di investimento.</p>${notes
          .map((nt) => `<div class="notif notif-${nt.level}"><div class="notif-t"><span class="notif-ic">${nt.icon}</span> <b>${nt.title}</b></div><div class="muted">${nt.text}</div></div>`)
          .join('')}`
      : '<p class="pos">Nessun suggerimento: il portafoglio è in linea con i dati di mercato aggiornati.</p>';
  if (hasHold) body.insertAdjacentHTML('afterbegin', adviceHorizonHtml() + deviceAlertsHtml());
  const sheetSolid = solidSheetHtml();
  if (sheetSolid) body.insertAdjacentHTML('afterbegin', sheetSolid + (hasHold ? '' : deviceAlertsHtml()));
  $('#notifs').showModal();
  updateNotifsBadge();
  // Notizie recenti sugli strumenti del portafoglio: solo informative, non cambiano punteggi e classifiche
  if (hasHold) {
    (state.newsData ? Promise.resolve(state.newsData) : api('/api/news').then((d) => (state.newsData = d)).catch(() => null)).then((d) => {
      const items = [];
      for (const h of [...(p.rows || []), ...(p.stocks || [])].filter((r) => r.isin && r.amount > 0)) {
        const inst = findByCode(h.isin);
        const list = inst ? d?.news?.[inst.symbol] : null;
        if (list?.length) items.push(`<div class="notif"><div class="notif-t"><span class="notif-ic">📰</span> <b>${esc(inst.name).slice(0, 44)}</b></div>${list.map((n) => `<div class="muted small-note"><a href="${esc(n.link)}" target="_blank" rel="noopener noreferrer">${esc(n.title)}</a>${n.publisher ? ' · ' + esc(n.publisher) : ''}${n.time ? ' · ' + new Date(n.time).toLocaleDateString('it-IT') : ''}</div>`).join('')}</div>`);
      }
      if (items.length && $('#notifs')?.open) body.insertAdjacentHTML('beforeend', `<h3>Ultime notizie sui tuoi strumenti</h3><p class="muted small-note">Solo informative: punteggi e classifiche si basano esclusivamente su dati di mercato validati (prezzi, stime degli analisti, bilanci, composizione dei fondi).</p>${items.join('')}`);
    });
  }
}

// ---------- avvio
async function loadInstruments() {
  state.instruments = await api('/api/instruments');
  render();
}

function bind() {
  // Telefono: scelta tra colonne di previsione e colonne di andamento
  const setMview = (v) => {
    document.body.classList.toggle('mview-perf', v === 'perf');
    document.body.classList.toggle('mview-risk', v === 'risk');
    document.body.classList.toggle('mview-prob', v === 'prob');
    document.body.classList.toggle('mview-short', v === 'short');
    $$('[data-mview]').forEach((b) => b.classList.toggle('active', b.dataset.mview === v));
    try {
      localStorage.setItem('trmc.mview', v);
    } catch {
      /* solo comodità */
    }
  };
  $$('[data-mview]').forEach((b) => b.addEventListener('click', () => setMview(b.dataset.mview)));

  // Barra di scorrimento orizzontale sempre visibile (i browser con barre "a scomparsa" la nascondono)
  const wrap = $('.table-wrap');
  const hs = $('#hscroll');
  const maxLeft = () => Math.max(1, wrap.scrollWidth - wrap.clientWidth);
  hs?.addEventListener('input', () => (wrap.scrollLeft = (hs.value / 1000) * maxLeft()));
  wrap?.addEventListener('scroll', () => hs && (hs.value = Math.round((wrap.scrollLeft / maxLeft()) * 1000)), { passive: true });
  $$('[data-scroll]').forEach((b) =>
    b.addEventListener('click', () => {
      const w = $('.table-wrap');
      w.scrollBy({ left: Number(b.dataset.scroll) * w.clientWidth * 0.7, behavior: 'smooth' });
    }),
  );
  try {
    setMview(localStorage.getItem('trmc.mview') || 'forecast');
  } catch {
    setMview('forecast');
  }
  $$('.tab[data-type]').forEach((t) =>
    t.addEventListener('click', () => {
      $$('.tab[data-type]').forEach((x) => x.classList.toggle('active', x === t));
      state.view.type = t.dataset.type;
      state.view.limit = PAGE;
      // Nella scheda Crescita si ordina per crescita attesa; altrove torna la classifica per rapporto.
      if (shortMode()) { if (!npViewSort(state.view.sort.key)) state.view.sort = { key: 'np' + state.view.np, dir: -1 }; }
      else if (state.view.funnel === 'maxgrowth' && !['bond', 'crypto', 'growth', 'lev'].includes(t.dataset.type)) state.view.sort = { key: 'maxGrowth', dir: -1 };
      else if (state.view.sort.key === 'maxGrowth') state.view.sort = { key: 'projOpt', dir: -1 };
      if (t.dataset.type === 'growth') state.view.sort = { key: 'growth', dir: -1 };
      else if (state.view.sort.key === 'growth') state.view.sort = { key: 'ratio', dir: 1 };
      render();
      refreshQuotes(visibleSymbols().filter((s) => !state.quotes[s]));
    }),
  );
  let ft;
  $('#filter').addEventListener('input', (e) => {
    state.view.q = e.target.value;
    state.view.limit = PAGE;
    render();
    clearTimeout(ft);
    ft = setTimeout(() => refreshQuotes(visibleSymbols().filter((s) => !state.quotes[s])), 400);
  });
  $('#only-computed').addEventListener('change', (e) => {
    state.view.onlyComputed = e.target.checked;
    render();
  });
  const ae = $('#all-etf');
  if (ae) {
    ae.checked = state.view.allEtf;
    ae.addEventListener('change', (e) => {
      state.view.allEtf = e.target.checked;
      try {
        localStorage.setItem('trmc.allEtf', e.target.checked ? '1' : '0');
      } catch {
        /* niente */
      }
      render();
    });
  }
  const scn = $('#scenario-mode');
  if (scn) {
    scn.value = state.view.scenario || '';
    scn.addEventListener('change', (e) => {
      state.view.scenario = e.target.value;
      state.view.limit = PAGE;
      try {
        localStorage.setItem('trmc.scenario', e.target.value);
      } catch {
        /* niente */
      }
      render();
    });
  }
  $$('#np-bar [data-np]').forEach((b) => b.addEventListener('click', () => {
    state.view.np = Number(b.dataset.np);
    state.view.sort = { key: 'np' + state.view.np, dir: -1 };
    state.view.limit = PAGE;
    try { localStorage.setItem('trmc.np', String(state.view.np)); } catch { /* niente */ }
    render();
  }));
  // salto orizzontale agli indicatori dopo le 9 colonne dei periodi (sul telefono sono fuori schermo)
  $('#np-jump')?.addEventListener('click', () => {
    const t = $('#table');
    const w = t?.closest('.table-wrap') || t?.parentElement;
    const th = $('#table thead th.sim-col');
    if (!w || !th) return;
    const nameTh = $('#table thead th[data-sort="name"]');
    const sticky = nameTh && getComputedStyle(nameTh).position === 'sticky' ? nameTh.offsetWidth : 0;
    const x = Math.max(0, th.offsetLeft - sticky - 6);
    const back = w.scrollLeft >= x - 30;
    w.scrollTo({ left: back ? 0 : x, behavior: 'smooth' });
    $('#np-jump').textContent = back ? 'Vai agli indicatori →' : '← Torna ai periodi';
  });
  bindShare();
  const fm = $('#funnel-mode');
  if (fm) {
    fm.value = state.view.funnel || 'short';
    // all'avvio con la sezione «Netto più probabile» già scelta: ordinamento per il periodo salvato
    if (analystMode()) state.view.sort = { key: 'anUp', dir: -1 };
    else if (solidMode()) state.view.sort = { key: 'tScore', dir: -1 };
    else if (shortMode() && !npViewSort(state.view.sort.key)) state.view.sort = { key: 'np' + state.view.np, dir: -1 };
    fm.addEventListener('change', (e) => {
      state.view.funnel = e.target.value;
      state.view.limit = PAGE;
      if (shortMode()) {
        state.view.sort = analystMode() ? { key: 'anUp', dir: -1 } : solidMode() ? { key: 'tScore', dir: -1 } : { key: 'np' + state.view.np, dir: -1 };
        if (window.matchMedia?.('(max-width: 700px)').matches) setMview('short');
      } else if (mgMode()) state.view.sort = { key: 'maxGrowth', dir: -1 };
      else if (npViewSort(state.view.sort.key) || state.view.sort.key === 'maxGrowth') state.view.sort = { key: 'projOpt', dir: -1 };
      try {
        localStorage.setItem('trmc.funnel2', e.target.value);
      } catch {
        /* niente */
      }
      render();
    });
  }
  const df = $('#dist-filter');
  if (df) {
    df.value = state.view.distFilter || 'all';
    df.addEventListener('change', (e) => {
      state.view.distFilter = e.target.value;
      state.view.limit = PAGE;
      try {
        localStorage.setItem('trmc.distFilter', e.target.value);
      } catch {
        /* niente */
      }
      render();
    });
  }
  const nm = $('#nr5-mode');
  if (nm) {
    nm.innerHTML = Object.entries(NR5_MODES).map(([k, m]) => `<option value="${k}">${m.label}</option>`).join('');
    nm.value = NR5_MODES[state.view.nr5Mode] ? state.view.nr5Mode : 'std';
    nm.addEventListener('change', (e) => {
      state.view.nr5Mode = e.target.value;
      try {
        localStorage.setItem('trmc.nr5Mode', e.target.value);
      } catch {
        /* niente */
      }
      render();
    });
  }
  $('#table thead').addEventListener('click', (e) => {
    const th = e.target.closest('th[data-sort]');
    if (!th) return;
    {
      const key = th.dataset.sort;
      if (/^np\d+$/.test(key)) { state.view.np = Number(key.slice(2)); try { localStorage.setItem('trmc.np', String(state.view.np)); } catch { /* niente */ } }
      const s = state.view.sort;
      if (s.key === key) s.dir = -s.dir;
      else {
        s.key = key;
        s.dir = [...NP_KEYS, ...HIST_KEYS, 'tScore', SIM_KEY, SIM_P_KEY, ...P_GAIN_PERIODS.map(([d]) => pGainKey(d)), ...P90_KEYS, ...AN_KEYS, 'pxMed', 'pxDiff', ...RANGE_KEYS, ...RISK_KEYS.filter((k) => k !== 'stress' && !k.startsWith('asym')), 'mgScore', 'maxGrowth', 'proj', 'proj019', 'projOpt', 'cagr', 'netGain', 'netMean', 'netP25', 'riskAdj', 'balanced', 'plausible', 'overall', 'sharpe', 'sortino', 'balancedOverLoss', 'meanOverLoss', 'net019OverLoss', 'prob50', 'prob25', 'expected', 'growthExp', 'change', 'varM', 'varM3', 'varY', 'price', 'growth'].includes(key) ? -1 : 1;
      }
      render();
    }
  });
  $('#table tbody').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-symbol]');
    if (tr) openDetail(tr.dataset.symbol);
  });
  $('#btn-more').addEventListener('click', () => {
    state.view.limit += PAGE;
    render();
    refreshQuotes(visibleSymbols().filter((s) => !state.quotes[s]));
  });
  $('#btn-run').addEventListener('click', () => runAll(filtered()));
  $('#btn-stop').addEventListener('click', () => (state.stop = true));
  $('#btn-quotes').addEventListener('click', () => refreshQuotes(visibleSymbols()));
  $('#btn-export').addEventListener('click', exportCsv);
  $('#btn-backtest').addEventListener('click', openBacktest);
  $('#btn-portfolio').addEventListener('click', openPortfolio);
  $('#btn-notifs').addEventListener('click', openNotifications);
  $('#solid-alerts')?.addEventListener('click', (e) => { if (e.target.closest('[data-act="solid-open"]')) openNotifications(); });
  $('#nf-body').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    if (b.dataset.act === 'alerts-on') await enableDeviceAlerts();
    else if (b.dataset.act === 'alerts-off') lsSet(LS_DEV, false);
    else if (b.dataset.act === 'adv-days') lsSet('trmc.advDays', Number(b.dataset.d));
    else if (b.dataset.act === 'alerts-test') {
      await showTestNotification('🚨 Prova: avviso di vendita', 'Così arriveranno gli avvisi.');
      return;
    }
    const keep = $('#nf-body').scrollTop;
    openNotifications();
    $('#nf-body').scrollTop = keep;
  });
  $('#btn-settings').addEventListener('click', () => {
    fillSettings();
    $('#settings').showModal();
  });
  $('#btn-reset').addEventListener('click', () => {
    state.settings = structuredClone(DEFAULT_SETTINGS);
    fillSettings();
  });
  $('#settings-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const prevMode = state.settings.outlook.mode;
    state.settings = readSettings();
    store('trmc.settings', state.settings);
    if (prevMode !== state.settings.outlook.mode) state.data.clear();
    $('#settings').close();
    recomputeComputed();
  });
  $('#btn-add').addEventListener('click', () => {
    $('#add-static').hidden = !STATIC;
    $('#add-local').hidden = STATIC;
    $('#add').showModal();
    if (STATIC) $('#isin-q').focus();
  });
  $('#isin-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const isin = $('#isin-q').value.trim().toUpperCase().replace(/\s+/g, '');
    const msg = $('#isin-msg');
    if (!isValidIsin(isin)) {
      msg.innerHTML = '<span class="neg">ISIN non valido: deve avere 12 caratteri (es. IE00B4L5Y983) e la cifra di controllo corretta.</span>';
      return;
    }
    const have = state.instruments.find((i) => i.isin === isin);
    if (have) {
      msg.innerHTML = `<span class="pos">Già presente: ${esc(have.name)} (${esc(have.symbol)}).</span>`;
      return;
    }
    const url = issueUrl('Aggiungi', isin);
    if (!url) {
      msg.innerHTML = '<span class="neg">Funzione non configurata per questo sito.</span>';
      return;
    }
    window.open(url, '_blank', 'noopener');
    state.pendingIsins = [...(state.pendingIsins || []), isin];
    msg.innerHTML = `Richiesta per <strong>${esc(isin)}</strong> aperta su GitHub: confermala lì. Lo strumento comparirà qui da solo in circa 3 minuti.`;
  });
  $('#search-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = $('#search-q').value.trim();
    if (q) doSearch(q);
  });
  $('#import-file').addEventListener('change', (e) => e.target.files[0] && doImport(e.target.files[0]));
  setInterval(liveTick, 60e3);
  setInterval(backgroundAlerts, 120e3);
}

async function main() {
  bind();
  buildFiltersPanel();
  // Portafoglio condiviso via link (#pf=...): lo importa e pulisce l'indirizzo. Anche quando il sito è già
  // aperto e cambia solo l'indirizzo dopo «#» (nessun ricaricamento): evento hashchange.
  const importFromHash = () => {
    if (!location.hash.includes('pf=')) return false;
    const imp = decodePortfolio(location.hash);
    if (!imp) return false;
    state.portfolio = imp;
    savePortfolio(imp);
    try {
      history.replaceState(null, '', location.pathname + location.search);
    } catch {
      /* niente */
    }
    return true;
  };
  const importedAtStart = importFromHash();
  window.addEventListener('hashchange', () => {
    if (!importFromHash()) return;
    if ($('#portfolio')?.open) renderPortfolio();
    else $('#btn-portfolio')?.click();
    try { checkSellAlerts(); } catch { /* niente */ }
  });
  try {
    const meta = STATIC ? await fetch(`data/meta.json?t=${Date.now()}`).then((r) => r.json()) : await api('/api/meta');
    if (STATIC && reloadIfNewBuild(meta)) return;
    state.meta = meta;
    state.market = meta.market || null;
    if (STATIC) {
      state.dataVersion = meta.generatedAt;
      $('#btn-quotes').hidden = true;
      $('#btn-add').hidden = !meta.repo;
      $('#auto-label').lastChild.textContent = ' Aggiornamento automatico (60 s)';
      updateStaticBanner(meta);
    }
    await loadResults();
    $('#demo-banner').hidden = !meta.mock;
    $('#meta-line').textContent = meta.universeGeneratedAt
      ? `${meta.description} Selezione aggiornata il ${new Date(meta.universeGeneratedAt).toLocaleDateString('it-IT')}.`
      : `Universo iniziale verificato il ${new Date(meta.verifiedAt).toLocaleDateString('it-IT')}: ${meta.verification}`;
    await loadInstruments();
    await refreshQuotes(visibleSymbols());
    if (STATIC) {
      state.priced = Object.fromEntries(Object.entries(state.quotes).map(([k, q]) => [k, q?.priceEur]));
      liveTick(); // prezzi crypto subito, senza aspettare il primo minuto
      setTimeout(() => { state.liveReady = true; render(); }, 25500); // se i dati live non arrivano, si mostrano quelli statici
    }
    // Portafoglio appena importato da un link: lo si mostra subito
    if (importedAtStart) $('#btn-portfolio')?.click();
  } catch (e) {
    $('#table tbody').innerHTML = `<tr><td colspan="28" class="neg">Server non raggiungibile: ${esc(e.message)}</td></tr>`;
  }
}

// Autoverifica dell'app, eseguita da scripts/verify-site.js PRIMA di ogni pubblicazione (regola fissa): ogni strumento deve avere
// un «netto più probabile» valido per ogni periodo, la tabella deve essere popolata, senza valori non numerici, e il ridisegno rapido.
window.trmcSelfCheck = () => {
  const days = NP_PERIODS.map(([d]) => d);
  let values = 0;
  let missing = 0;
  let invalidCount = 0;
  const invalid = [];
  for (const i of state.instruments) {
    const r = state.results[i.symbol];
    if (!r) continue;
    for (const d of days) {
      const x = npStats(i, d);
      if (!x) { missing++; continue; }
      values++;
      const ok = Number.isFinite(x.median) && Number.isFinite(x.mean) && Number.isFinite(x.p) && x.p >= 0 && x.p <= 1 && x.median >= -1 && x.mean >= -1 && x.median < 50;
      if (!ok) invalidCount++;
      if (!ok && invalid.length < 20) invalid.push(`${i.symbol}@${d}: ${x.median}/${x.p}`);
    }
  }
  const t0 = performance.now();
  render();
  const renderMs = Math.round(performance.now() - t0);
  const body = $('#table tbody');
  const rows = body.querySelectorAll('tr[data-symbol]').length;
  return {
    mode: state.view.funnel,
    instruments: state.instruments.length,
    results: Object.keys(state.results).length,
    values,
    missing,
    invalidCount,
    invalid,
    rows,
    notNumbers: (body.innerText.match(/NaN|undefined|Infinity/g) || []).length,
    renderMs,
    verify: (state.verify || state.meta?.verify)?.status ?? null,
  };
};

main();
