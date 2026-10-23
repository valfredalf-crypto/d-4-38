// Genera la versione statica per GitHub Pages in _site/:
// interfaccia + dati JSON (strumenti, quotazioni, storici, evidenze) + classifica precalcolata.
// Uso: node scripts/build-static.js   (eseguito da .github/workflows/pages.yml)
import fs from 'node:fs';
import path from 'node:path';
import { universe } from '../lib/store.js';
import { computeSnapshot } from '../lib/snapshot.js';
import { fileKey } from '../public/js/analyze.js';

const OUT = path.resolve(process.env.OUT_DIR || '_site');
const MIN_SUCCESS = 0.5; // sotto questa quota di storici scaricati non si pubblica (meglio i dati vecchi)

fs.rmSync(OUT, { recursive: true, force: true });
fs.cpSync('public', OUT, { recursive: true });
fs.mkdirSync(path.join(OUT, 'data/history'), { recursive: true });
fs.mkdirSync(path.join(OUT, 'data/outlook'), { recursive: true });
const write = (rel, obj) => fs.writeFileSync(path.join(OUT, rel), JSON.stringify(obj));

const indexFile = path.join(OUT, 'index.html');
fs.writeFileSync(indexFile, fs.readFileSync(indexFile, 'utf8').replace('<html lang="it">', '<html lang="it" data-static>'));

const { instruments, quotes, results, ok, key, generatedAt } = await computeSnapshot({
  onData(inst, history, fundamentals) {
    write(`data/history/${fileKey(inst.symbol)}.json`, history);
    if (fundamentals) write(`data/outlook/${fileKey(inst.symbol)}.json`, fundamentals);
  },
});

write('data/meta.json', { ...universe().meta, repo: process.env.GITHUB_REPOSITORY || process.env.SITE_REPO || null, liveBranch: process.env.LIVE_BRANCH || 'live-data', static: true, mock: process.env.MOCK === '1', generatedAt });
write('data/instruments.json', instruments);
write('data/quotes.json', quotes);
write('data/results.json', { key, results });
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');

console.log(`Sito generato in ${OUT}: ${ok}/${instruments.length} strumenti con dati, ${Object.keys(quotes).length} quotazioni.`);
if (ok < instruments.length * MIN_SUCCESS) {
  console.error('Troppi strumenti senza dati: pubblicazione annullata.');
  process.exit(1);
}
