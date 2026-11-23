// Verifica dell'app costruita (_site) in un browser vero, PRIMA di pubblicarla (regola fissa: se non è tutto regolare non si pubblica).
// Controlla: nessun errore JavaScript, tabella popolata in entrambe le classifiche, «netto più probabile» valido per ogni strumento
// e periodo, nessun valore non numerico, ridisegno rapido, esito della verifica dei dati (lib/verify.js) diverso da «fail».
// Uso: node scripts/verify-site.js   (dopo scripts/build-static.js; richiede il pacchetto «playwright»)
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const OUT = path.resolve(process.env.OUT_DIR || '_site');
const MAX_RENDER_MS = Number(process.env.MAX_RENDER_MS) || 20000;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = path.join(OUT, rel === '/' ? 'index.html' : rel);
  if (!file.startsWith(OUT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404).end('{}');
    return;
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {});
const problems = [];
const report = {};
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message || e)));
  // solo i file dell'app appena costruita: niente dati esterni (live, crypto), così la verifica riguarda ciò che si pubblica
  await page.route('**/*', (route) => (route.request().url().startsWith(base) ? route.continue() : route.abort()));
  await page.goto(`${base}/index.html`, { waitUntil: 'load' });
  const ready = () => page.waitForFunction(() => typeof window.trmcSelfCheck === 'function' && document.querySelectorAll('#table tbody tr[data-symbol]').length > 0, null, { timeout: 180000 });
  await ready();
  report.principale = await page.evaluate(() => window.trmcSelfCheck());
  // sezione «Netto più probabile»
  await page.evaluate(() => {
    const s = document.querySelector('#funnel-mode');
    s.value = 'short';
    s.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await ready();
  report.nettoPiuProbabile = await page.evaluate(() => window.trmcSelfCheck());
  report.erroriJavaScript = errors;

  if (errors.length) problems.push(`errori JavaScript: ${errors.slice(0, 3).join(' | ')}`);
  for (const [name, r] of [['classifica principale', report.principale], ['netto più probabile', report.nettoPiuProbabile]]) {
    if (!(r.instruments > 0)) problems.push(`${name}: nessuno strumento caricato`);
    if (!(r.results >= r.instruments * 0.5)) problems.push(`${name}: previsioni per ${r.results} strumenti su ${r.instruments}`);
    if (!(r.rows > 0)) problems.push(`${name}: tabella vuota`);
    if (r.notNumbers) problems.push(`${name}: ${r.notNumbers} valori non numerici in tabella`);
    if (r.invalidCount) problems.push(`${name}: ${r.invalidCount} valori di netto più probabile non validi (${r.invalid.slice(0, 5).join(', ')})`);
    if (!(r.values > 0)) problems.push(`${name}: nessun valore di netto più probabile calcolato`);
    if (r.renderMs > MAX_RENDER_MS) problems.push(`${name}: ridisegno troppo lento (${r.renderMs} ms)`);
    if (r.verify === 'fail') problems.push(`${name}: verifica dei dati non superata`);
  }
  if (report.nettoPiuProbabile.mode !== 'short') problems.push('la sezione «Netto più probabile» non si apre');
} catch (e) {
  problems.push(`verifica interrotta: ${e.message}`);
} finally {
  await browser.close();
  server.close();
}
report.esito = problems.length ? 'NON SUPERATA' : 'superata';
report.problemi = problems;
fs.writeFileSync(path.join(OUT, 'data/verify-app.json'), JSON.stringify({ at: new Date().toISOString(), ...report }));
console.log(`Verifica dell'app: ${report.esito}`);
for (const k of ['principale', 'nettoPiuProbabile']) if (report[k]) console.log(`  ${k}: ${report[k].instruments} strumenti, ${report[k].values} valori, ${report[k].invalidCount} non validi, ${report[k].rows} righe, ridisegno ${report[k].renderMs} ms, verifica dati ${report[k].verify}`);
for (const p of problems) console.error(`  PROBLEMA: ${p}`);
if (problems.length) {
  console.error("L'app NON viene pubblicata: resta online la versione precedente.");
  process.exit(1);
}
