// Verifica dal vivo dell'universo strumenti contro Yahoo Finance:
// per ogni strumento con ISIN controlla che la ricerca per ISIN restituisca il simbolo configurato
// e che esista uno storico recente. npm run verify
import { listInstruments } from '../lib/store.js';
import { search, chart } from '../lib/yahoo.js';
import { isValidIsin } from '../lib/isin.js';

const list = listInstruments();
const problems = [];
let ok = 0;
let i = 0;
await Promise.all(
  Array.from({ length: 4 }, async () => {
    while (i < list.length) {
      const inst = list[i++];
      const issues = [];
      if (inst.isin && !isValidIsin(inst.isin)) issues.push('ISIN con cifra di controllo errata');
      try {
        const c = await chart(inst.symbol, { range: '1mo', interval: '1d' });
        const last = c.timestamps.at(-1);
        if (!last || Date.now() / 1000 - last > 10 * 86400) issues.push('nessuna quotazione negli ultimi 10 giorni (delistato?)');
      } catch (e) {
        issues.push(`storico non disponibile: ${e.message}`);
      }
      if (inst.isin) {
        try {
          const hits = await search(inst.isin);
          if (hits.length && !hits.some((h) => h.symbol === inst.symbol)) {
            issues.push(`la ricerca per ISIN restituisce ${hits.map((h) => h.symbol).slice(0, 4).join(', ')}`);
          }
        } catch (e) {
          issues.push(`ricerca ISIN fallita: ${e.message}`);
        }
      }
      if (issues.length) problems.push({ inst, issues });
      else ok++;
    }
  }),
);
for (const { inst, issues } of problems) console.log(`✗ ${inst.symbol} (${inst.isin || 'senza ISIN'}) ${inst.name}\n    ${issues.join('\n    ')}`);
console.log(`\n${ok}/${list.length} strumenti verificati senza problemi.`);
process.exitCode = problems.length ? 1 : 0;
