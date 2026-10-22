// Genera la versione statica per GitHub Pages in _site/:
// interfaccia + dati JSON (strumenti, quotazioni, storici, evidenze) + classifica precalcolata.
// Uso: node scripts/build-static.js   (eseguito da .github/workflows/pages.yml)
import fs from 'node:fs';
import path from 'node:path';
import { listInstruments, seed } from '../lib/store.js';
import { historyEur, quote, outlook } from '../lib/market.js';
import { analyze, BENCHMARK_SYMBOL, DEFAULT_SETTINGS, fileKey, compactResult } from '../public/js/analyze.js';

const OUT = path.resolve(process.env.OUT_DIR || '_site');
const MIN_SUCCESS = 0.5; // sotto questa quota di storici scaricati non si pubblica (meglio i dati vecchi)

fs.rmSync(OUT, { recursive: true, force: true });
fs.cpSync('public', OUT, { recursive: true });
fs.mkdirSync(path.join(OUT, 'data/history'), { recursive: true });
fs.mkdirSync(path.join(OUT, 'data/outlook'), { recursive: true });
const write = (rel, obj) => fs.writeFileSync(path.join(OUT, rel), JSON.stringify(obj));

const indexFile = path.join(OUT, 'index.html');
fs.writeFileSync(indexFile, fs.readFileSync(indexFile, 'utf8').replace('<html lang="it">', '<html lang="it" data-static>'));

const instruments = listInstruments();
const quotes = {};
const results = {};
let ok = 0;

const benchmark = await historyEur(BENCHMARK_SYMBOL).catch(() => null);
let i = 0;
await Promise.all(
  Array.from({ length: 4 }, async () => {
    while (i < instruments.length) {
      const inst = instruments[i++];
      try {
        const [history, q, fundamentals] = await Promise.all([
          historyEur(inst.symbol),
          quote(inst.symbol).catch(() => null),
          inst.type !== 'crypto' ? outlook(inst.symbol).catch(() => null) : null,
        ]);
        write(`data/history/${fileKey(inst.symbol)}.json`, history);
        if (fundamentals) write(`data/outlook/${fileKey(inst.symbol)}.json`, fundamentals);
        if (q) quotes[inst.symbol] = q;
        const r = analyze({ instrument: inst, history, benchmark, fundamentals }, DEFAULT_SETTINGS);
        results[inst.symbol] = compactResult(r.sim.ok ? r : { error: r.sim.reason });
        ok++;
      } catch (e) {
        results[inst.symbol] = { error: e.message };
        console.warn(`! ${inst.symbol}: ${e.message}`);
      }
    }
  }),
);

const generatedAt = new Date().toISOString();
write('data/meta.json', { ...seed().meta, static: true, mock: process.env.MOCK === '1', generatedAt });
write('data/instruments.json', instruments);
write('data/quotes.json', quotes);
write('data/results.json', { key: JSON.stringify(DEFAULT_SETTINGS), results });
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');

console.log(`Sito generato in ${OUT}: ${ok}/${instruments.length} strumenti con dati, ${Object.keys(quotes).length} quotazioni.`);
if (ok < instruments.length * MIN_SUCCESS) {
  console.error('Troppi strumenti senza dati: pubblicazione annullata.');
  process.exit(1);
}
