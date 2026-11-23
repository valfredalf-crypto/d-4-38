// Riassunto (Markdown) del motivo per cui la pubblicazione è stata bloccata: usato da pages.yml per aprire la segnalazione.
import fs from 'node:fs';
const read = (f) => {
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; }
};
const v = read('_site/data/verify.json');
const a = read('_site/data/verify-app.json');
const run = `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`;
const out = [`La pubblicazione dell'app è stata **bloccata** dalla verifica automatica: resta online la versione precedente finché il problema non è risolto.`, '', `Esecuzione: ${run} (commit ${(process.env.GITHUB_SHA || '').slice(0, 7)})`, ''];
if (v) {
  out.push(`**Verifica dei dati e dei modelli: ${v.status}**`);
  for (const c of v.checks) out.push(`- ${c.level === 'ok' ? '✅' : c.level === 'warn' ? '⚠️' : '❌'} ${c.label}: ${c.text}`);
  out.push('');
} else out.push('Verifica dei dati non eseguita (errore prima della costruzione dei dati: test o build).', '');
if (a) {
  out.push(`**Verifica dell'app nel browser: ${a.esito}**`);
  for (const p of a.problemi || []) out.push(`- ❌ ${p}`);
} else out.push("Verifica dell'app nel browser non eseguita.");
console.log(out.join('\n'));
