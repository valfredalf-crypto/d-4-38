// Aggiornamenti "live" per la versione online: ricalcola quotazioni e previsioni di tutti gli strumenti
// e le pubblica come live.json sul ramo `live-data` (letto dall'app via raw.githubusercontent.com).
// In orario di borsa ripete ogni INTERVAL minuti fino a LIVE_MINUTES; fuori orario fa un solo giro.
// Uso: node scripts/live-loop.js   (eseguito da .github/workflows/live.yml)
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { computeSnapshot } from '../lib/snapshot.js';

const INTERVAL = Number(process.env.INTERVAL_MINUTES || 5) * 60e3;
const DEADLINE = Date.now() + Number(process.env.LIVE_MINUTES || 330) * 60e3;
const BRANCH = process.env.LIVE_BRANCH || 'live-data';
const DRY = process.env.DRY_RUN === '1'; // scrive solo il file locale, senza push

// Lun–ven, 06:00–22:00 UTC: copre Xetra/LS Exchange (8–23 ora italiana) e Wall Street.
export function isMarketHours(d = new Date()) {
  const day = d.getUTCDay();
  const minutes = d.getUTCHours() * 60 + d.getUTCMinutes();
  return day >= 1 && day <= 5 && minutes >= 6 * 60 && minutes < 22 * 60;
}

const git = (args, input) => execFileSync('git', args, { input, encoding: 'utf8' }).trim();

// Un solo commit (senza storia) sul ramo dati: il repository non cresce a ogni aggiornamento.
function publish(json) {
  const blob = git(['hash-object', '-w', '--stdin'], json);
  const tree = git(['mktree'], `100644 blob ${blob}\tlive.json\n`);
  const commit = git(['commit-tree', tree, '-m', 'Dati live'], '');
  git(['push', '--force', '--quiet', 'origin', `${commit}:refs/heads/${BRANCH}`]);
}

// Liste strumenti aggiornate (import, ISIN aggiunti, selezione settimanale) senza riavviare il job.
function refreshLists() {
  const ref = process.env.GITHUB_REF_NAME;
  if (DRY || !ref) return;
  try {
    git(['fetch', '--quiet', '--depth=1', 'origin', ref]);
    git(['checkout', 'FETCH_HEAD', '--', 'data/universe.json', 'data/extra-instruments.json', 'data/imported-instruments.json']);
  } catch (e) {
    console.error(`Liste non aggiornate: ${e.message.split('\n')[0]}`);
  }
}

async function once() {
  const t0 = Date.now();
  refreshLists();
  const snap = await computeSnapshot();
  const json = JSON.stringify({ generatedAt: snap.generatedAt, key: snap.key, market: snap.market, quotes: snap.quotes, results: snap.results });
  fs.writeFileSync(process.env.LIVE_FILE || 'live.json', json);
  if (!DRY) publish(json);
  console.log(`${snap.generatedAt}: ${snap.ok}/${snap.instruments.length} previsioni, ${Object.keys(snap.quotes).length} quotazioni, ${Math.round(json.length / 1024)} KB, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.env.GIT_AUTHOR_NAME ||= 'github-actions[bot]';
  process.env.GIT_AUTHOR_EMAIL ||= '41898282+github-actions[bot]@users.noreply.github.com';
  process.env.GIT_COMMITTER_NAME ||= process.env.GIT_AUTHOR_NAME;
  process.env.GIT_COMMITTER_EMAIL ||= process.env.GIT_AUTHOR_EMAIL;
  let restart = false;
  for (;;) {
    const start = Date.now();
    await once().catch((e) => console.error(`Aggiornamento fallito: ${e.message}`));
    if (!isMarketHours()) break; // fuori orario basta un giro (i prezzi non cambiano)
    if (Date.now() + INTERVAL > DEADLINE) {
      restart = true; // tempo massimo del job quasi esaurito: il workflow si rilancia
      break;
    }
    await new Promise((r) => setTimeout(r, Math.max(0, INTERVAL - (Date.now() - start))));
  }
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `restart=${restart}\n`);
}
