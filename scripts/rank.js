// Classifica da riga di comando: npm run rank -- [--type etf|stock|crypto] [--top 30] [--historical]
import { listInstruments } from '../lib/store.js';
import { historyEur, outlook } from '../lib/market.js';
import { analyze, BENCHMARK_SYMBOL } from '../public/js/analyze.js';
import { DEFAULT_OPTIONS } from '../public/js/montecarlo.js';
import { DEFAULT_OUTLOOK } from '../public/js/outlook.js';

const args = process.argv.slice(2);
const arg = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? def : args[i + 1];
};
const type = arg('type', null);
const top = Number(arg('top', 30));
const settings = {
  mc: { ...DEFAULT_OPTIONS, cryptoSpreadPct: 0 },
  outlook: { ...DEFAULT_OUTLOOK, mode: args.includes('--historical') ? 'historical' : 'forward' },
};

const list = listInstruments().filter((i) => !type || i.type === type);
const benchmark = await historyEur(BENCHMARK_SYMBOL).catch(() => null);
const rows = [];
let i = 0;
await Promise.all(
  Array.from({ length: 4 }, async () => {
    while (i < list.length) {
      const inst = list[i++];
      try {
        const history = await historyEur(inst.symbol);
        const fundamentals = settings.outlook.mode === 'forward' && inst.type !== 'crypto' ? await outlook(inst.outlookSymbol || inst.symbol) : null;
        const { sim, forward } = analyze({ instrument: inst, history, benchmark, fundamentals }, settings);
        if (sim.ok) rows.push({ inst, sim, forward });
      } catch (e) {
        process.stderr.write(`! ${inst.symbol}: ${e.message}\n`);
      }
    }
  }),
);
rows.sort((a, b) => a.sim.ratio - b.sim.ratio);
const p = (x) => (Number.isFinite(x) ? (x * 100).toFixed(1).padStart(7) + '%' : '      ∞');
console.log(`\nClassifica rapporto perdita massima / guadagno netto a ${settings.mc.years} anni (${settings.outlook.mode})\n`);
console.log('  #  Simbolo        Tipo    Atteso/a  PerditaMax  GuadNetto  Rapporto  Nome');
rows.slice(0, top).forEach((r, k) => {
  console.log(
    `${String(k + 1).padStart(3)}  ${r.inst.symbol.padEnd(13)}  ${r.inst.type.padEnd(6)} ${p(r.forward?.expected)}  ${p(-r.sim.maxLoss)}   ${p(r.sim.netGain)}  ${Number.isFinite(r.sim.ratio) ? r.sim.ratio.toFixed(2).padStart(8) : '       ∞'}  ${r.inst.name}`,
  );
});
