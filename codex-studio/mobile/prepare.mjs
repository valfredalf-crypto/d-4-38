// Copia l'interfaccia di Codex Studio (../public) dentro ./www,
// la cartella che Capacitor impacchetta nell'app nativa.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(here, '..', 'public');
const dst = path.join(here, 'www');

fs.rmSync(dst, { recursive: true, force: true });
fs.cpSync(src, dst, { recursive: true });

// Opzionale: se CODEX_REMOTE_URL è impostata, l'app punta a quel server (il tuo
// PC via tunnel/LAN) così usa il motore "abbonamento"; altrimenti usa i file
// locali (motore WebLLM nel dispositivo).
const remote = process.env.CODEX_REMOTE_URL;
if (remote) {
  const cfgPath = path.join(here, 'capacitor.config.json');
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  cfg.server = { ...(cfg.server || {}), url: remote, cleartext: remote.startsWith('http://') };
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
  console.log(`Config: l'app punterà a ${remote}`);
}

console.log(`Copiato ${src} -> ${dst}`);
