// Diagnostica di singoli strumenti (eseguita da .github/workflows/diag.yml): dati grezzi e stima.
import { historyEur, outlook } from '../lib/market.js';
import { analyze, BENCHMARK_SYMBOL, DEFAULT_SETTINGS } from '../public/js/analyze.js';

const symbols = (process.env.SYMBOLS || 'QFG.BR').split(',');
const benchmark = await historyEur(BENCHMARK_SYMBOL);
for (const symbol of symbols) {
  const history = await historyEur(symbol);
  const f = await outlook(symbol).catch((e) => ({ error: e.message }));
  const p = history.closesEur;
  const y = (n) => p.at(-1) / p[Math.max(0, p.length - 1 - 52 * n)] - 1;
  const flat = p.slice(-104).filter((x, i, a) => i && x === a[i - 1]).length;
  console.log(`\n=== ${symbol}: ${p.length} settimane, prezzo ${p.at(-1).toFixed(2)}, 1a ${(y(1) * 100).toFixed(0)}%, 3a ${(y(3) * 100).toFixed(0)}%, 5a ${(y(5) * 100).toFixed(0)}%, 10a ${(y(10) * 100).toFixed(0)}%, settimane ferme (2a) ${flat}/104`);
  console.log('prezzi annuali:', Array.from({ length: 11 }, (_, k) => p[Math.max(0, p.length - 1 - 52 * (10 - k))]?.toFixed(2)).join(' '));
  console.log('fondamentali:', JSON.stringify(f));
  const r = analyze({ instrument: { symbol, type: 'stock' }, history, benchmark, fundamentals: f, market: 0.0764, marketGrowth: 0.0667 }, DEFAULT_SETTINGS);
  const fw = r.forward;
  console.log('stima:', JSON.stringify({ expected: fw?.expected, vol: r.sim?.annualVol, histVol: r.sim?.histVol, beta: fw?.beta, betaRaw: fw?.betaRaw, components: fw?.components, weights: fw?.weights, fundamentals: fw?.fundamentalsDetail, credibility: fw?.credibility, historyRaw: fw?.historyRaw }));
  console.log('sim:', JSON.stringify({ netMedian: r.sim?.netMedian, netMean: r.sim?.netMean, maxLoss: r.sim?.maxLoss, mddMedian: r.sim?.mddMedian, probLoss: r.sim?.probLoss }));
}
