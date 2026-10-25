// Diagnostica (eseguita da .github/workflows/diag.yml): controlla i primi strumenti di ogni classifica
// pubblicata (live.json) mostrando i dati grezzi da cui nascono le stime, per scovare dati anomali.
import { historyEur, outlook } from '../lib/market.js';
import { listInstruments } from '../lib/store.js';

if (process.env.SYMBOLS) {
  // Dump delle stime grezze di singoli titoli (SYMBOLS=GOOGL,AMZN)
  const { holdings } = await import('../lib/market.js');
  const { analyze, BENCHMARK_SYMBOL, DEFAULT_SETTINGS } = await import('../public/js/analyze.js');
  const { marketFundamentals } = await import('../public/js/outlook.js');
  const bench = await historyEur(BENCHMARK_SYMBOL);
  for (const sym of process.env.SYMBOLS.split(',')) {
    const inst = listInstruments().find((x) => x.symbol === sym) || { symbol: sym, type: 'stock', name: sym };
    const f = await outlook(sym).catch((e) => ({ error: e.message }));
    console.log('\n###', sym, inst.type, inst.name, '\nfondamentali:', JSON.stringify(f));
    let lt = null;
    if (inst.type === 'etf') {
      let comp = await holdings(sym).catch(() => null);
      const { expandFundOfFunds } = await import('../lib/snapshot.js');
      const ex = comp ? await expandFundOfFunds(comp, (x) => holdings(x)) : null;
      if (ex) {
        console.log('  fondo di fondi: scomposti', ex.fundsExpanded, 'di', ex.fundsTotal, 'fondi partecipati →', ex.holdings.length, 'titoli');
        comp = { ...ex, holdings: ex.holdings.slice(0, 25) };
      }
      if (comp?.holdings?.length) {
        lt = { ...comp, holdings: [] };
        for (const h of comp.holdings) {
          const hf = await outlook(h.symbol).catch(() => null);
          lt.holdings.push({ ...h, fundamentals: hf });
          console.log('  holding', h.symbol, (h.name || '').slice(0, 28), 'peso', (h.weight * 100).toFixed(1) + '%', 'eps+1', hf?.epsGrowthNext, 'ric+1', hf?.revenueGrowthNext, 'ricTTM', hf?.revenueGrowthTtm, 'LT', hf?.growthLongTerm, 'PE', hf?.forwardPE?.toFixed(1), 'analisti', hf?.analysts);
        }
        console.log('  composizione: azioni', comp.stockPosition, 'obblig.', comp.bondPosition, 'P/E fondo', comp.pe, 'div', comp.dividendYield);
      }
    }
    const hist = await historyEur(sym);
    const r = analyze({ instrument: inst, history: hist, benchmark: bench, fundamentals: f, holdings: lt, market: 0.1, marketGrowth: 0.091 }, DEFAULT_SETTINGS);
    const fw = r.forward, s = r.sim;
    console.log('  stima:', JSON.stringify({ expected: fw?.expected, components: fw?.components, weights: fw?.weights, beta: fw?.beta, betaRaw: fw?.betaRaw, credibility: fw?.credibility, historyRaw: fw?.historyRaw, growth: fw?.expectedGrowth, fund: fw?.fundamentalsDetail, vol: s?.annualVol, histVol: s?.histVol, sigmaEwma: fw?.sigmaEwma }));
    console.log('  sim:', JSON.stringify({ mean: s?.netMean, med: s?.netMedian, es5: s?.es5, nr5: s?.nr5, pl: s?.probLoss, maxL: s?.maxLoss, mddMed: s?.mddMedian, years: s?.historyYears, backfilled: s?.backfilledYears }));
  }
  process.exit(0);
}
const live = await (await fetch(`https://raw.githubusercontent.com/${process.env.GITHUB_REPOSITORY}/live-data/live.json?t=${Date.now()}`)).json();
const R = live.results;
const I = Object.fromEntries(listInstruments().map((i) => [i.symbol, i]));
const sims = Object.entries(R).filter(([, r]) => r.sim);
const g = (r) => r.forward?.growth ?? 0;
const RANKS = {
  balanced: [(r) => r.sim.balanced, -1],
  riskGain: [(r) => { const d = (r.sim.netMedian + r.sim.netMean) / 2 + g(r); return d > 0 ? (r.sim.mddMedian + r.sim.maxLoss) / 2 / d : 1e9; }, 1],
  maxLossGain: [(r) => { const d = (r.sim.netMedian + r.sim.netMean) / 2 + g(r); return d > 0 ? r.sim.maxLoss / d : 1e9; }, 1],
  ratioFinal: [(r) => r.sim.ratioFinal ?? 1e9, 1],
  netMedian: [(r) => r.sim.netMedian, -1],
};
const pick = new Set();
for (const [name, [f, dir]] of Object.entries(RANKS)) {
  const top = sims.filter(([, r]) => r.sim.netMedian > 0.15).sort((a, b) => dir * (f(a[1]) - f(b[1]))).slice(0, 40);
  console.log(`\n### ${name}: ${top.map(([k]) => k).join(' ')}`);
  top.forEach(([k]) => pick.add(k));
}
console.log('\nsimbolo | tipo | nome | prezzo 1a/3a/5a | atteso | crescita | mediana | P(perdita) | dividendo | analisti | capitalizz. | eps+1 | ricavi+1 | LT | P/E | SEGNALI');
for (const k of pick) {
  const r = R[k];
  const inst = I[k] || {};
  const h = await historyEur(k).catch(() => null);
  const f = inst.type !== 'crypto' ? await outlook(inst.outlookSymbol || k).catch(() => null) : null;
  const p = h?.closesEur || [];
  const ch = (n) => (p.length > 52 * n ? p.at(-1) / p[p.length - 1 - 52 * n] - 1 : null);
  const pc = (x) => (x == null ? '–' : `${(x * 100).toFixed(0)}%`);
  const flags = [];
  if (ch(5) != null && ch(5) < 0 && r.forward?.expected > 0.08) flags.push('ATTESO ALTO MA -5A');
  if (f?.dividendYield > 0.08) flags.push('DIVIDENDO ALTO');
  if (f?.marketCap > 0 && f.marketCap < 1e9) flags.push('SMALL CAP');
  if (f?.epsGrowthNext > 0.5) flags.push('EPS +50%');
  if (r.forward?.expected > 0.12) flags.push('ATTESO >12%');
  if (/2x|3x|leverag|lev\b|short|daily/i.test(inst.name || '')) flags.push('LEVA/SHORT');
  console.log([k, inst.type, (inst.name || '').slice(0, 34), `${pc(ch(1))}/${pc(ch(3))}/${pc(ch(5))}`, pc(r.forward?.expected), pc(r.forward?.growth), pc(r.sim.netMedian), pc(r.sim.probLoss), pc(f?.dividendYield), f?.analysts ?? '–', f?.marketCap ? (f.marketCap / 1e9).toFixed(1) + 'B' : '–', pc(f?.epsGrowthNext), pc(f?.revenueGrowthNext), pc(f?.growthLongTerm), f?.forwardPE?.toFixed(1) ?? '–', flags.join(', ')].join(' | '));
}
