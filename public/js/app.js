import { BENCHMARK_SYMBOL, CRYPTO_BENCHMARK_SYMBOL, DEFAULT_SETTINGS, fileKey, compactResult, applyLivePrice } from './analyze.js';
import { isValidIsin } from './isin.js';
import { INDICATORS, PRESETS, activeFilters, passes } from './filters.js';
import { netReturn, DEFAULT_OPTIONS } from './montecarlo.js';

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

const state = {
  instruments: [],
  quotes: {},
  data: new Map(), // symbol → { history, fundamentals }
  results: {}, // symbol → { forward, sim } | { error }
  priced: {}, // symbol → prezzo EUR usato nell'ultima previsione (per ricalcolare solo se cambia)
  benchmark: null,
  settings: loadSettings(),
  view: { type: 'all', q: '', onlyComputed: false, sort: { key: 'ratio', dir: 1 }, limit: PAGE, filters: loadFilters() },
  running: false,
  stop: false,
};

// ---------- persistenza locale (solo comodità: tutto funziona anche senza)
function loadFilters() {
  try {
    return JSON.parse(localStorage.getItem('trmc.filters')) || {};
  } catch {
    return {};
  }
}
function store(key, value) {
  try {
    if (value === undefined) return JSON.parse(localStorage.getItem(key));
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    return null;
  }
}
function loadSettings() {
  const s = store('trmc.settings');
  return {
    mc: { ...DEFAULT_SETTINGS.mc, ...(s?.mc || {}) },
    outlook: { ...DEFAULT_SETTINGS.outlook, ...(s?.outlook || {}) },
  };
}
const settingsKey = () => JSON.stringify(state.settings);
function saveResults() {
  const compact = {};
  for (const [k, r] of Object.entries(state.results)) compact[k] = compactResult(r);
  store('trmc.results', { key: settingsKey(), day: state.dataVersion || new Date().toDateString(), results: compact });
}
async function loadResults() {
  const saved = store('trmc.results');
  if (saved && saved.key === settingsKey() && saved.day === (state.dataVersion || new Date().toDateString())) {
    state.results = saved.results || {};
  } else if (STATIC) {
    // Classifica precalcolata con i parametri predefiniti
    const pre = await api('/api/results').catch(() => null);
    if (pre && pre.key === settingsKey()) state.results = pre.results;
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
  const r = await runAnalysis({ instrument: inst, history, benchmark, cryptoBenchmark, fundamentals: d.fundamentals, settings: state.settings });
  state.results[inst.symbol] = r.sim.ok ? r : { error: r.sim.reason };
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
async function checkNewData() {
  const meta = await fetch(`data/meta.json?t=${Date.now()}`).then((r) => r.json());
  if (meta.generatedAt === state.dataVersion) return;
  state.dataVersion = meta.generatedAt;
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
  if (pre && pre.key === settingsKey()) {
    state.results = pre.results;
    state.priced = Object.fromEntries(Object.entries(quotes).map(([k, q]) => [k, q?.priceEur]));
  } else {
    state.priced = {}; // parametri personalizzati: ricalcolo nel browser
  }
  updateStaticBanner(meta);
  render();
}

// Versione online: quotazioni e previsioni aggiornate ogni ~5 minuti in orario di borsa
// (workflow live.yml → ramo live-data, letto da raw.githubusercontent.com).
async function checkLiveData() {
  const m = state.meta;
  if (!m?.repo) return;
  const res = await fetch(`https://raw.githubusercontent.com/${m.repo}/${m.liveBranch || 'live-data'}/live.json`, { cache: 'no-cache' });
  if (!res.ok) return;
  const live = await res.json();
  if (!live.generatedAt || live.generatedAt <= (state.liveVersion || state.dataVersion || '')) return;
  state.liveVersion = live.generatedAt;
  const known = new Set(state.instruments.map((i) => i.symbol));
  for (const [k, q] of Object.entries(live.quotes || {})) if (known.has(k) && q) state.quotes[k] = q;
  if (live.key === settingsKey()) {
    for (const [k, r] of Object.entries(live.results || {})) {
      if (!known.has(k)) continue;
      state.results[k] = r;
      state.priced[k] = live.quotes?.[k]?.priceEur;
    }
    saveResults();
  }
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
  b.textContent =
    `Azioni ed ETF aggiornati al ${fmt(latest)} (ogni ~5 minuti in orario di borsa, quotazioni ritardate)` +
    (state.liveAt ? ` · crypto in tempo reale alle ${state.liveAt.toLocaleTimeString('it-IT')}` : '') +
    '. Previsioni ricalcolate a ogni aggiornamento.';
  b.dataset.generatedAt = meta.generatedAt;
}

async function liveTick() {
  if (!$('#auto-quotes').checked || document.hidden || state.running) return;
  try {
    if (STATIC) {
      await checkNewData().catch(() => {});
      await checkLiveData().catch(() => {});
      await liveCrypto().catch(() => {});
      updateStaticBanner({ generatedAt: state.dataVersion });
      render();
    } else {
      await refreshQuotes(visibleSymbols());
    }
    await recomputeChanged();
  } catch (e) {
    console.warn('aggiornamento', e);
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
  const { type, q, onlyComputed } = state.view;
  const needle = q.trim().toLowerCase();
  const active = activeFilters(state.view.filters);
  return state.instruments.filter((i) => {
    if (type === 'growth' ? i.growth == null : type !== 'all' && i.type !== type) return false;
    if (onlyComputed && !(state.results[i.symbol] && !state.results[i.symbol].error)) return false;
    if (needle && !`${i.name} ${i.symbol} ${i.isin || ''}`.toLowerCase().includes(needle)) return false;
    return !active.length || passes(rowValues(i), active);
  });
}

// ---------- pannello filtri sugli indicatori
function saveFilters() {
  try {
    localStorage.setItem('trmc.filters', JSON.stringify(state.view.filters));
  } catch {
    /* solo comodità */
  }
}

function updateFiltersUi() {
  const n = activeFilters(state.view.filters).length;
  const badge = $('#filters-count');
  badge.hidden = !n;
  badge.textContent = n;
  for (const el of $$('#filters-panel input[data-key]')) {
    const v = state.view.filters[el.dataset.key]?.[el.dataset.bound] ?? '';
    if (document.activeElement !== el) el.value = v;
    el.classList.toggle('on', String(v).trim() !== '');
  }
  const total = filtered().length;
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
    for (const [key, val] of Object.entries(PRESETS[Number(b.dataset.preset)].filters)) state.view.filters[key] = { ...val };
    applyFilters();
  });
  let t;
  $('#filters-panel .filters-grid').addEventListener('input', (e) => {
    const el = e.target.closest('input[data-key]');
    if (!el) return;
    const f = (state.view.filters[el.dataset.key] ||= {});
    f[el.dataset.bound] = el.value;
    clearTimeout(t);
    t = setTimeout(applyFilters, 250);
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

function rowValues(i) {
  const r = state.results[i.symbol];
  const q = state.quotes[i.symbol];
  const sim = r && !r.error ? r.sim : null;
  return {
    inst: i,
    name: i.name.toLowerCase(),
    type: i.type,
    price: q?.priceEur ?? null,
    change: q?.changePct ?? null,
    expected: r?.forward?.expected ?? null,
    maxLoss: sim?.maxLoss ?? null,
    netGain: sim?.netGain ?? null,
    netMean: sim?.netMean ?? null,
    // Infinity non sopravvive al JSON (diventa null): con guadagno ≤ 0 il rapporto è ∞
    ratio: sim ? (sim.ratio ?? (sim.netGain > 0 ? null : Infinity)) : null,
    probLoss: sim?.probLoss ?? null,
    growth: i.growth ?? null,
    varM: q?.perf?.m ?? null,
    varM3: q?.perf?.m3 ?? null,
    varY: q?.perf?.y ?? null,
    perfW: netPerf(q?.perf?.w, i),
    perfM: netPerf(q?.perf?.m, i),
    perfYtd: netPerf(q?.perf?.ytd, i),
    error: r?.error || null,
  };
}

function sortRows(rows) {
  const { key, dir } = state.view.sort;
  const k = key === 'rank' ? 'ratio' : key;
  return rows.sort((a, b) => {
    const va = a[k];
    const vb = b[k];
    const na = va == null || (typeof va === 'number' && Number.isNaN(va));
    const nb = vb == null || (typeof vb === 'number' && Number.isNaN(vb));
    if (na !== nb) return na ? 1 : -1; // valori mancanti sempre in fondo
    if (na) return a.name.localeCompare(b.name);
    if (typeof va === 'string') return va.localeCompare(vb) * dir;
    if (va === vb) return 0;
    return (va < vb ? -1 : 1) * dir;
  });
}

function rankMap(rows) {
  // La posizione in classifica è sempre per rapporto crescente, indipendentemente dall'ordinamento scelto.
  const ranked = rows.filter((r) => r.ratio != null && Number.isFinite(r.ratio)).sort((a, b) => a.ratio - b.ratio);
  return new Map(ranked.map((r, k) => [r.inst.symbol, k + 1]));
}

function render() {
  const all = filtered();
  const rows = sortRows(all.map(rowValues));
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
        <td><span class="name" title="${esc(i.name)}">${i.source === 'extra' || i.source === 'user' ? '<span class="added-tag">＋</span> ' : ''}${esc(i.name)}</span><span class="ids">${i.growth != null ? `<span class="growth-tag" title="Crescita attesa anno prossimo (consenso analisti)">🚀 ${pct(i.growth, true, 0)}</span> · ` : ''}${esc(i.symbol)}${i.isin ? ' · ' + esc(i.isin) : ''}</span></td>
        <td><span class="pill">${TYPE_LABEL[i.type]}</span></td>
        <td class="num">${eur(r.price)}</td>
        <td class="num ${cls(r.change)}">${pct(r.change, true, 2)}</td>
        <td class="num ${cls(r.varM)}">${pct(r.varM, true)}</td>
        <td class="num ${cls(r.varM3)}">${pct(r.varM3, true)}</td>
        <td class="num ${cls(r.varY)}">${pct(r.varY, true)}</td>
        <td class="num ${cls(r.expected)}">${pct(r.expected, true)}</td>
        <td class="num neg">${r.maxLoss != null ? '−' + pct(r.maxLoss) : '–'}</td>
        <td class="num ${cls(r.netGain)}">${pct(r.netGain, true)}</td>
        <td class="num ${cls(r.netMean)}">${pct(r.netMean, true)}</td>
        <td class="num">${ratioCell}</td>
        <td class="num">${pct(r.probLoss, false, 0)}</td>
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

  for (const t of ['all', 'stock', 'etf', 'crypto', 'growth']) {
    $(`[data-count="${t}"]`).textContent = state.instruments.filter((i) => (t === 'growth' ? i.growth != null : t === 'all' || i.type === t)).length;
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
  dlg.showModal();
  try {
    let r = state.results[inst.symbol];
    if (!r || r.error || !r.sim.fan) r = await analyzeOne(inst);
    saveResults();
    render();
    if (r.error) {
      $('#d-body').innerHTML = `<p class="neg">${esc(r.error)}</p>${removeButton(inst)}`;
      bindRemove(inst);
      return;
    }
    renderDetail(inst, r, state.data.get(inst.symbol));
  } catch (e) {
    $('#d-body').innerHTML = `<p class="neg">Impossibile recuperare i dati: ${esc(e.message)}</p>${removeButton(inst)}`;
    bindRemove(inst);
  }
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

function renderDetail(inst, r, d) {
  const { sim, forward: f } = r;
  const s = state.settings;
  const q = state.quotes[inst.symbol];
  const fu = d?.fundamentals || {};
  const lossLabel = { mdd_p95: 'max drawdown, 95° percentile', mdd_median: 'max drawdown mediano', final_p5: 'perdita finale, 5% peggiore' }[s.mc.lossMetric];
  const amt = s.mc.amount;
  const comp = f?.components || {};
  const w = f?.weights || {};
  const compRow = (label, key, note) =>
    `<tr><td>${label}</td><td class="num">${comp[key] != null ? pct(comp[key], true) : '<span class="muted">n.d.</span>'}</td><td class="num">${w[key] != null ? pct(w[key], false, 0) : '–'}</td><td class="muted">${note}</td></tr>`;

  $('#d-body').innerHTML = `
    <div class="kpis">
      <div class="kpi"><div class="k">Prezzo</div><div class="v">${eur(q?.priceEur ?? d.history.closesEur.at(-1))}</div><div class="h ${cls(q?.changePct)}">${q ? pct(q.changePct, true, 2) + ' oggi' : 'ultima chiusura settimanale'}</div></div>
      <div class="kpi"><div class="k">Perdita massima ${s.mc.years}a</div><div class="v neg">−${pct(sim.maxLoss)}</div><div class="h">${lossLabel}</div></div>
      <div class="kpi"><div class="k">${s.mc.gainMetric === 'mean' ? 'Guadagno medio' : 'Guadagno mediano'} ${s.mc.years}a (classifica)</div><div class="v ${cls(sim.netGain)}">${pct(sim.netGain, true)}</div><div class="h">${s.mc.gainMetric === 'mean' ? 'media' : 'mediana'} · ${eur(amt * (1 + sim.netGain))} da ${eur(amt)}</div></div>
      <div class="kpi"><div class="k">Guadagno medio ${s.mc.years}a</div><div class="v ${cls(sim.netMean)}">${pct(sim.netMean, true)}</div><div class="h">media di tutti gli scenari · ${eur(amt * (1 + sim.netMean))}</div></div>
      <div class="kpi"><div class="k">Rapporto perdita/guadagno</div><div class="v">${Number.isFinite(sim.ratio) ? nf2.format(sim.ratio) : '∞'}</div><div class="h">più basso = migliore</div></div>
      <div class="kpi"><div class="k">Probabilità di perdita</div><div class="v">${pct(sim.probLoss, false, 0)}</div><div class="h">a fine orizzonte, netto costi</div></div>
      ${(() => {
        const rv = rowValues(inst);
        if (rv.perfW == null && rv.perfM == null && rv.perfYtd == null) return '';
        return `<div class="kpi"><div class="k">Rendimento netto passato</div><div class="perf-list"><span>1 settimana <b class="${cls(rv.perfW)}">${pct(rv.perfW, true)}</b></span><span>1 mese <b class="${cls(rv.perfM)}">${pct(rv.perfM, true)}</b></span><span>YTD (da inizio anno) <b class="${cls(rv.perfYtd)}">${pct(rv.perfYtd, true)}</b></span></div><div class="h">fino al prezzo attuale, netto costi e tasse</div></div>`;
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
      <div class="card">
        <h3>Stima prospettica del rendimento annuo</h3>
        <table class="mini">
          <thead><tr><th>Componente</th><th class="num">Atteso</th><th class="num">Peso</th><th>Fonte</th></tr></thead>
          <tbody>
            ${compRow('Storico', 'history', f?.mode === 'forward' ? `${sim.historyYears.toFixed(1)} anni, grezzo ${pct(f.historyRaw, true)}, credibilità ${pct(f.credibility, false, 0)}` : `${sim.historyYears.toFixed(1)} anni di dati`)}
            ${f?.mode === 'forward' ? compRow('Equilibrio', 'equilibrium', inst.type === 'crypto' ? `risk-free ${s.outlook.riskFree}% + premio crypto ${s.outlook.cryptoPremium}%` : `risk-free ${s.outlook.riskFree}% + β ${nf2.format(f.beta)} × ${s.outlook.equityPremium}%`) : ''}
            ${f?.mode === 'forward' ? compRow('Analisti', 'analysts', fu.analysts ? `${fu.analysts} analisti, target ${nf2.format(fu.targetMean)} ${esc(fu.currency || '')} (${pct(f.analystUpside, true)}), ${esc(fu.recommendation || '')}` : 'nessuna copertura') : ''}
            ${f?.mode === 'forward' ? compRow('Crescita e valutazione', 'fundamentals', f.fundamentalsDetail ? `utili +${pct(f.fundamentalsDetail.growth, false)}/anno (stima analisti ${pct(f.fundamentalsDetail.growthInput, true)}, in rallentamento), P/E ${nf2.format(f.fundamentalsDetail.pe)} → ${nf2.format(f.fundamentalsDetail.peTarget)} (${pct(f.fundamentalsDetail.valuation, true)}/anno), dividendo ${pct(f.fundamentalsDetail.dividend)}` : 'dati insufficienti (P/E o stime di crescita)') : ''}
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
  const q = f.byRatio;
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
        <tr><td>Guadagno netto mediano: previsto → reale</td><td></td><td class="num"><b>${pct(f.returns.predNetMedian, true)} → ${pct(f.returns.realNetMedian, true)}</b></td><td class="num">${pct(h?.returns?.predNetMedian, true)} → ${pct(h?.returns?.realNetMedian, true)}</td></tr>
      </tbody></table></div>

    <h3>La classifica funziona? (5 gruppi secondo il rapporto previsto)</h3>
    <div class="scroll"><table>
      <thead><tr><th>Gruppo</th><th class="num">Rapporto previsto</th><th class="num">Guadagno reale medio</th><th class="num">Guadagno reale mediano</th><th class="num">Perdita max reale</th><th class="num">In perdita</th></tr></thead>
      <tbody>${q
        .map(
          (g, k) => `<tr><td>${k === 0 ? '1 (migliori)' : k === 4 ? '5 (peggiori)' : k + 1}</td><td class="num">${g.predicted >= 1e8 ? '∞' : num2(g.predicted)}</td><td class="num ${cls(g.realNetMean)}">${pct(g.realNetMean, true)}</td><td class="num ${cls(g.realNetMedian)}">${pct(g.realNetMedian, true)}</td><td class="num neg">−${pct(g.realMddMedian)}</td><td class="num">${p0(g.realLossShare)}</td></tr>`,
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
  const lines = [['Posizione', 'Nome', 'Simbolo', 'ISIN', 'Tipo', 'Prezzo EUR', 'Var. 1 mese', 'Var. 3 mesi', 'Var. 1 anno', 'Rendimento atteso annuo', 'Perdita max 5a', 'Guadagno mediano 5a', 'Guadagno medio 5a', 'Rapporto', 'Prob. perdita', 'Rend. netto 1 settimana', 'Rend. netto 1 mese', 'Rend. netto YTD'].join(';')];
  for (const r of rows) {
    lines.push([ranks.get(r.inst.symbol) ?? '', `"${r.inst.name.replace(/"/g, '""')}"`, r.inst.symbol, r.inst.isin || '', r.inst.type, num(r.price), num(r.varM), num(r.varM3), num(r.varY), num(r.expected), num(r.maxLoss), num(r.netGain), num(r.netMean), r.ratio === Infinity ? 'inf' : num(r.ratio), num(r.probLoss), num(r.perfW), num(r.perfM), num(r.perfYtd)].join(';'));
  }
  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `classifica-tr-montecarlo-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
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
    $$('[data-mview]').forEach((b) => b.classList.toggle('active', b.dataset.mview === v));
    try {
      localStorage.setItem('trmc.mview', v);
    } catch {
      /* solo comodità */
    }
  };
  $$('[data-mview]').forEach((b) => b.addEventListener('click', () => setMview(b.dataset.mview)));
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
  $$('#table th').forEach((th) =>
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      const s = state.view.sort;
      if (s.key === key) s.dir = -s.dir;
      else {
        s.key = key;
        s.dir = ['netGain', 'netMean', 'expected', 'change', 'varM', 'varM3', 'varY', 'price', 'growth'].includes(key) ? -1 : 1;
      }
      render();
    }),
  );
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
}

async function main() {
  bind();
  buildFiltersPanel();
  try {
    const meta = await api('/api/meta');
    state.meta = meta;
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
    }
  } catch (e) {
    $('#table tbody').innerHTML = `<tr><td colspan="14" class="neg">Server non raggiungibile: ${esc(e.message)}</td></tr>`;
  }
}

main();
