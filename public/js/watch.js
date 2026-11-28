// Watch list (strumenti preferiti) e file della scheda esportata con il pulsante «Condividi» della scheda dello strumento.
// La lista vive nel browser (localStorage): ogni voce ricorda quando è stata aggiunta e a che prezzo.
export const WATCH_KEY = 'trmc.watch';
export const FAV_FOLDER = 'Strumenti preferiti';
export const WATCH_MAX = 300;

/** Lista letta dalla memoria del browser: scarta voci rovinate e doppioni, mai più di WATCH_MAX. */
export function parseWatch(raw) {
  let a = raw;
  if (typeof raw === 'string') {
    try {
      a = JSON.parse(raw);
    } catch {
      a = null;
    }
  }
  if (!Array.isArray(a)) return [];
  const seen = new Set();
  const out = [];
  for (const x of a) {
    if (!x || typeof x.symbol !== 'string' || !x.symbol || seen.has(x.symbol)) continue;
    seen.add(x.symbol);
    out.push({
      symbol: x.symbol,
      isin: typeof x.isin === 'string' ? x.isin : '',
      name: typeof x.name === 'string' && x.name ? x.name : x.symbol,
      type: typeof x.type === 'string' ? x.type : '',
      at: Number.isFinite(x.at) ? x.at : 0,
      px: Number.isFinite(x.px) && x.px > 0 ? x.px : null,
    });
  }
  return out.slice(0, WATCH_MAX);
}

/** Aggiunge in cima; se c'è già resta la data (e il prezzo) della prima volta. */
export function addWatch(list, inst, { now = Date.now(), price = null } = {}) {
  if (!inst || !inst.symbol) return list;
  const old = list.find((x) => x.symbol === inst.symbol);
  const item = old || { symbol: inst.symbol, isin: inst.isin || '', name: inst.name || inst.symbol, type: inst.type || '', at: now, px: Number.isFinite(price) && price > 0 ? price : null };
  return [item, ...list.filter((x) => x.symbol !== inst.symbol)].slice(0, WATCH_MAX);
}

export const removeWatch = (list, symbol) => list.filter((x) => x.symbol !== symbol);

/** Nome di file valido su Windows: niente \ / : * ? " < > | né caratteri di controllo, niente punto o spazio finale. */
export function safeFileName(text, max = 110) {
  let s = String(text ?? '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
    .replace(/[. ]+$/, '');
  if (!s) s = 'scheda';
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(s)) s = '_' + s;
  return s;
}

const two = (n) => String(n).padStart(2, '0');
/** «ISIN - Nome - 2026-11-28 0935.html»: la data è quella del dispositivo, così i file si ordinano da soli. */
export function cardFileName(inst, now = Date.now()) {
  const d = new Date(now);
  const stamp = `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}${two(d.getMinutes())}`;
  return `${safeFileName(`${inst.isin || inst.symbol} - ${inst.name || ''}`)} - ${stamp}.html`;
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/**
 * Pagina HTML autonoma con la scheda dello strumento: si apre con un doppio clic, senza collegamento a internet.
 * `bodyHtml` è il contenuto della scheda già pronto (grafici convertiti in immagini, pulsanti tolti).
 */
export function cardDocument({ title, sub = '', bodyHtml = '', css = '', exportedAt = '', dataAt = '', source = '' }) {
  const safeCss = String(css).replace(/<\/style/gi, '<\\/style');
  return `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · scheda TR Monte Carlo</title>
<style>${safeCss}</style>
<style>
body { margin: 0 auto; padding: 16px; max-width: 980px; }
.card-export-head { padding-bottom: 12px; margin-bottom: 14px; border-bottom: 1px solid var(--line, #d9dde3); }
.card-export-head h1 { margin: 0 0 4px; font-size: 22px; }
.card-export-foot { margin-top: 18px; padding-top: 10px; border-top: 1px solid var(--line, #d9dde3); font-size: 13px; }
#d-body { padding: 0; }
img.chart { max-width: 100%; height: auto; display: block; }
</style>
</head>
<body>
<header class="card-export-head">
<h1>${esc(title)}</h1>
<div class="muted">${esc(sub)}</div>
<div class="muted">Scheda esportata il ${esc(exportedAt)}${dataAt ? ` · dati del modello aggiornati al ${esc(dataAt)}` : ''}${source ? ` · <a href="${esc(source)}">apri l’app</a>` : ''}</div>
</header>
<main id="d-body">
${bodyHtml}
</main>
<footer class="card-export-foot muted">Stime del modello TR Monte Carlo, non una raccomandazione di investimento. È una fotografia del ${esc(exportedAt)}: i valori di questo file non si aggiornano.</footer>
</body>
</html>
`;
}
