// Costruisce data/universe.json: le migliori PER_GROUP azioni e PER_GROUP ETF/ETC per guadagno netto
// previsto a 5 anni (Monte Carlo, parametri predefiniti), più tutte le crypto.
// Candidati: lista iniziale verificata + lista ufficiale Xetra di Deutsche Börse (escluse leva/short).
// Uso: node scripts/build-universe.js   (eseguito ogni settimana da .github/workflows/universe.yml)
import fs from 'node:fs';
import { downloadXetraCsv } from '../lib/xetra.js';
import { parseInstrumentCsv } from '../lib/importer.js';
import { seed } from '../lib/store.js';
import { historyEur, outlook } from '../lib/market.js';
import { search, pickListing } from '../lib/yahoo.js';
import { analyze, BENCHMARK_SYMBOL, DEFAULT_SETTINGS } from '../public/js/analyze.js';
import { isLeveraged, mergeUnique, selectTop, isEuroListing, hasImplausibleJumps, growthScore } from '../lib/universe.js';

const PER_GROUP = Number(process.env.PER_GROUP || 300);
const SHORTLIST = PER_GROUP * 2; // azioni per cui si scarica anche il consenso analisti
const GROWTH_N = Number(process.env.GROWTH_N || 100); // azioni aggiunte per crescita attesa
const GROWTH_MIN = Number(process.env.GROWTH_MIN || 0.15); // crescita attesa minima (15%)
const MAX_CANDIDATES = Number(process.env.MAX_CANDIDATES || Infinity); // per prove rapide
const OUT = process.env.UNIVERSE || 'data/universe.json';
const log = (...a) => console.log(...a);

async function pool(items, n, fn) {
  let i = 0;
  let done = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (i < items.length) {
        const item = items[i++];
        await fn(item).catch((e) => log(`  ! ${item.symbol}: ${e.message}`));
        if (++done % 250 === 0) log(`  ${done}/${items.length}`);
      }
    }),
  );
}

// Se il simbolo non ha dati, si cerca lo stesso strumento per ISIN (o per nome, per le crypto).
async function historyWithFallback(inst) {
  try {
    return { inst, history: await historyEur(inst.symbol) };
  } catch (e) {
    const hits = await search(inst.isin || `${inst.name}`).catch(() => []);
    // Solo quotazioni su borse in euro: altrove (es. Tokyo, Londra) unità e valute di Yahoo sono meno affidabili.
    const ok = inst.isin
      ? hits.filter((h) => h.type === inst.type && isEuroListing(h.symbol))
      : hits.filter((h) => h.type === 'crypto' && h.symbol.endsWith('-EUR'));
    const alt = inst.isin ? pickListing(ok) : ok[0];
    if (!alt || alt.symbol === inst.symbol) throw e;
    log(`  ~ ${inst.symbol} → ${alt.symbol}`);
    const fixed = { ...inst, symbol: alt.symbol };
    return { inst: fixed, history: await historyEur(alt.symbol) };
  }
}

// --- 1. Candidati
const base = seed();
const seedList = base.instruments;
let xetra = [];
let xetraUrl = null;
try {
  log('Download lista Xetra…');
  const { url, text } = await downloadXetraCsv(log);
  xetraUrl = url;
  const parsed = parseInstrumentCsv(text);
  const kept = parsed.rows.filter((r) => r.symbol && (r.type === 'stock' || r.type === 'etf'));
  xetra = kept.filter((r) => !isLeveraged(r.name)).map((r) => ({ symbol: r.symbol, isin: r.isin, name: r.name, type: r.type, source: 'xetra' }));
  log(`Xetra: ${parsed.rows.length} righe attive, ${kept.length} azioni/ETF, ${kept.length - xetra.length} esclusi (leva/short)`);
} catch (e) {
  log(`ATTENZIONE: ${e.message}`);
  if (fs.existsSync(OUT)) {
    log('Universo precedente mantenuto.');
    process.exit(1);
  }
}

// Titoli noti ad alta crescita: si verifica che l'ISIN corrisponda davvero al simbolo (ricerca Yahoo).
const growthList = JSON.parse(fs.readFileSync('data/growth-candidates.json', 'utf8')).instruments.map((i) => ({ ...i, growthCandidate: true }));
await pool(growthList, 4, async (g) => {
  const hits = await search(g.isin).catch(() => null);
  if (hits && !hits.some((h) => h.symbol === g.symbol)) {
    log(`  ? ${g.symbol}: l'ISIN ${g.isin} non risulta associato al simbolo (${hits.map((h) => h.symbol).slice(0, 4).join(', ') || 'nessun risultato'}): ISIN rimosso`);
    g.isin = null;
  }
});

const crypto = seedList.filter((i) => i.type === 'crypto');
const candidates = mergeUnique(seedList.filter((i) => i.type !== 'crypto'), growthList, xetra)
  .filter((i) => i.type === 'stock' || i.type === 'etf')
  .slice(0, MAX_CANDIDATES);
log(`Candidati: ${candidates.filter((i) => i.type === 'stock').length} azioni, ${candidates.filter((i) => i.type === 'etf').length} ETF, ${crypto.length} crypto`);

// --- 2. Previsione con storico + equilibrio (senza analisti) per tutti
const benchmark = await historyEur(BENCHMARK_SYMBOL);
const rows = [];
const histories = new Map();
const excluded = { leveraged: 0, badData: 0 };
await pool([...candidates, ...crypto], 4, async (c) => {
  const { inst, history } = await historyWithFallback(c);
  if (history.name && (inst.source === 'xetra' || !inst.name)) inst.name = history.name;
  if (isLeveraged(inst.name)) return void excluded.leveraged++;
  if (inst.type !== 'crypto' && hasImplausibleJumps(history.closesEur)) return void excluded.badData++;
  const r = analyze({ instrument: inst, history, benchmark, fundamentals: null }, DEFAULT_SETTINGS);
  if (!r.sim.ok) return;
  histories.set(inst.symbol, history);
  rows.push({ inst, netGain: r.sim.netGain });
});
log(`Esclusi dopo verifica: ${excluded.leveraged} a leva/short (nome completo), ${excluded.badData} con dati storici anomali`);
log(`Previsioni valide (storico ≥ ${DEFAULT_SETTINGS.mc.minYears} anni): ${rows.length}`);

// --- 3. Azioni più promettenti (e tutti i titoli della lista iniziale e di quella crescita):
//        si aggiunge il consenso degli analisti e si ricalcola
const stockRows = rows.filter((r) => r.inst.type === 'stock');
const best = stockRows.sort((a, b) => b.netGain - a.netGain).slice(0, SHORTLIST);
const always = stockRows.filter((r) => r.inst.growthCandidate || r.inst.source !== 'xetra');
const stocks = [...new Set([...best, ...always])];
let withAnalysts = 0;
const complete = (f) => f?.targetMean > 0 && growthScore(f, { minCap: 0 }) != null;
await pool(stocks, 4, async (row) => {
  const inst = row.inst;
  let f = await outlook(inst.symbol).catch(() => null);
  // Le quotazioni Xetra di titoli USA spesso non hanno target e stime di crescita:
  // si usa la quotazione principale (stesso ISIN).
  if (!complete(f) && inst.isin && /^(US|CA)/.test(inst.isin)) {
    const primary = (await search(inst.isin).catch(() => [])).find((h) => h.type === 'stock' && !h.symbol.includes('.'));
    if (primary && primary.symbol !== inst.symbol) {
      const f2 = await outlook(primary.symbol).catch(() => null);
      if (complete(f2) || (f2?.targetMean > 0 && !(f?.targetMean > 0))) {
        f = f2;
        inst.outlookSymbol = primary.symbol;
      }
    }
  }
  if (f?.targetMean > 0) withAnalysts++;
  row.growth = growthScore(f);
  const r = analyze({ instrument: inst, history: histories.get(inst.symbol), benchmark, fundamentals: f }, DEFAULT_SETTINGS);
  if (r.sim.ok) row.netGain = r.sim.netGain;
});
log(`Azioni con consenso analisti: ${withAnalysts}/${stocks.length}`);

// --- 4. Selezione: le migliori PER_GROUP per gruppo (le azioni solo tra quelle con analisi completa)
//        + le GROWTH_N azioni con la crescita attesa più alta secondo il consenso degli analisti
const shortlisted = new Set(stocks.map((r) => r.inst.symbol));
const eligible = rows.filter((r) => r.inst.type !== 'stock' || shortlisted.has(r.inst.symbol));
const selected = selectTop(eligible, PER_GROUP);
const growthPicks = stocks
  .filter((r) => r.growth != null && r.growth >= GROWTH_MIN)
  .sort((a, b) => b.growth - a.growth)
  .slice(0, GROWTH_N);
log(`Crescita: ${stocks.filter((r) => r.growth != null).length} azioni con stime di crescita, ${growthPicks.length} selezionate (≥ ${GROWTH_MIN * 100}%)`);
log(`  prime 15: ${growthPicks.slice(0, 15).map((r) => `${r.inst.symbol} ${(r.growth * 100).toFixed(0)}%`).join(', ')}`);
const growthSet = new Set(growthPicks.map((r) => r.inst.symbol));
const final = [...selected, ...growthPicks.filter((r) => !selected.includes(r))];
const instruments = final.map(({ inst, netGain, growth }) => ({
  symbol: inst.symbol,
  isin: inst.isin || null,
  name: inst.name,
  type: inst.type,
  ...(inst.outlookSymbol ? { outlookSymbol: inst.outlookSymbol } : {}),
  netGain5y: +netGain.toFixed(4),
  ...(growthSet.has(inst.symbol) ? { growth: +growth.toFixed(4) } : {}),
}));
const count = (t) => instruments.filter((i) => i.type === t).length;
log(`Selezionati: ${count('stock')} azioni (di cui ${growthPicks.length} per crescita, ${growthPicks.filter((r) => !selected.includes(r)).length} nuove), ${count('etf')} ETF, ${count('crypto')} crypto`);

const meta = {
  ...base.meta,
  description: `Le ${PER_GROUP} azioni e i ${PER_GROUP} ETF/ETC con il miglior guadagno netto previsto a 5 anni (Monte Carlo, parametri predefiniti) tra ${candidates.length} candidati negoziabili su Xetra/Trade Republic, più le ${growthPicks.length} azioni con la crescita attesa più alta secondo il consenso degli analisti (ricavi e utili dell'anno prossimo, almeno 3 analisti, capitalizzazione ≥ 2 mld) e tutte le crypto. Esclusi prodotti a leva e short.`,
  universeGeneratedAt: new Date().toISOString(),
  xetraUrl,
  candidates: candidates.length,
};
fs.writeFileSync(OUT, JSON.stringify({ meta, instruments }, null, 1) + '\n');
log(`Scritto ${OUT}`);
