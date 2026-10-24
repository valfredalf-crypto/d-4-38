// Genera la versione statica per GitHub Pages in _site/:
// interfaccia + dati JSON (strumenti, quotazioni, storici, evidenze) + classifica precalcolata.
// Uso: node scripts/build-static.js   (eseguito da .github/workflows/pages.yml)
import fs from 'node:fs';
import path from 'node:path';
import { universe } from '../lib/store.js';
import { computeSnapshot } from '../lib/snapshot.js';
import { fileKey, DEFAULT_SETTINGS, BENCHMARK_SYMBOL, CRYPTO_BENCHMARK_SYMBOL } from '../public/js/analyze.js';
import { runBacktest, backtestPayload } from '../public/js/backtest.js';
import { CALIBRATION } from '../public/js/calibration.js';

const OUT = path.resolve(process.env.OUT_DIR || '_site');
const MIN_SUCCESS = 0.5; // sotto questa quota di storici scaricati non si pubblica (meglio i dati vecchi)

fs.rmSync(OUT, { recursive: true, force: true });
fs.cpSync('public', OUT, { recursive: true });
fs.mkdirSync(path.join(OUT, 'data/history'), { recursive: true });
fs.mkdirSync(path.join(OUT, 'data/outlook'), { recursive: true });
const write = (rel, obj) => fs.writeFileSync(path.join(OUT, rel), JSON.stringify(obj));

// Versione nei nomi dei file: il browser (anche l'app sulla schermata Home) scarica sempre il codice nuovo.
const BUILD = (process.env.GITHUB_SHA || Date.now().toString(36)).slice(0, 10);
const indexFile = path.join(OUT, 'index.html');
fs.writeFileSync(
  indexFile,
  fs
    .readFileSync(indexFile, 'utf8')
    .replace('<html lang="it">', '<html lang="it" data-static>')
    .replace('href="styles.css"', `href="styles.css?v=${BUILD}"`)
    .replace('src="js/app.js"', `src="js/app.js?v=${BUILD}"`),
);
for (const f of fs.readdirSync(path.join(OUT, 'js'))) {
  const file = path.join(OUT, 'js', f);
  const code = fs
    .readFileSync(file, 'utf8')
    .replace(/(from\s+'\.\/[\w-]+\.js)'/g, `$1?v=${BUILD}'`)
    .replace(/new URL\('\.\/worker\.js'/g, `new URL('./worker.js?v=${BUILD}'`);
  fs.writeFileSync(file, code);
}

const histories = [];
const { instruments, quotes, results, ok, key, generatedAt, market } = await computeSnapshot({
  onData(inst, history, fundamentals) {
    histories.push({ instrument: inst, history });
    write(`data/history/${fileKey(inst.symbol)}.json`, history);
    if (fundamentals) write(`data/outlook/${fileKey(inst.symbol)}.json`, fundamentals);
  },
});

write('data/meta.json', { ...universe().meta, repo: process.env.GITHUB_REPOSITORY || process.env.SITE_REPO || null, liveBranch: process.env.LIVE_BRANCH || 'live-data', market, static: true, build: BUILD, mock: process.env.MOCK === '1', generatedAt });
write('data/instruments.json', instruments);
write('data/quotes.json', quotes);
write('data/results.json', { key, results });
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');

// Backtest: previsioni fatte con i dati di 5 anni fa confrontate con l'esito reale.
const benchmark = histories.find((h) => h.instrument.symbol === BENCHMARK_SYMBOL)?.history;
const cryptoBenchmark = histories.find((h) => h.instrument.symbol === CRYPTO_BENCHMARK_SYMBOL)?.history;
const bt = runBacktest(histories.map((h) => ({ ...h, benchmark, cryptoBenchmark })), DEFAULT_SETTINGS);
let calibration = null;
try {
  calibration = JSON.parse(fs.readFileSync('data/calibration-report.json', 'utf8'));
} catch {
  /* taratura non ancora eseguita */
}
write('data/backtest.json', backtestPayload(bt, { generatedAt, calibration, calibrationInUse: CALIBRATION }));
console.log(`Backtest: ${bt.modes.forward.summary?.n ?? 0} strumenti con almeno 7 anni di storico.`);

console.log(`Sito generato in ${OUT}: ${ok}/${instruments.length} strumenti con dati, ${Object.keys(quotes).length} quotazioni.`);
if (ok < instruments.length * MIN_SUCCESS) {
  console.error('Troppi strumenti senza dati: pubblicazione annullata.');
  process.exit(1);
}
