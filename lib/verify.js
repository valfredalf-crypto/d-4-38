// Verifica automatica a OGNI aggiornamento dei dati (pubblicazione del sito e ciclo live):
//  1. riproducibilità: gli stessi dati in ingresso devono dare esattamente lo stesso risultato (ricalcolo su un campione);
//  2. validità dei numeri: nessun valore mancante o fuori scala nelle previsioni;
//  3. dati: quotazioni recenti, prezzo coerente con lo storico, confronto con LS Exchange (la borsa di Trade Republic);
//  4. modello: gli intervalli previsti dalla volatilità contengono davvero i rendimenti reali delle ultime settimane.
// Esito: 'ok' | 'warn' (si pubblica, con avviso nell'app) | 'fail' (NON si pubblica: restano i dati precedenti).
import crypto from 'node:crypto';

const fin = Number.isFinite;
const sha = (x) => crypto.createHash('sha1').update(typeof x === 'string' ? x : JSON.stringify(x)).digest('hex').slice(0, 12);

/** Impronta dei dati in ingresso di uno strumento (storico in EUR + prezzo attuale): stessa impronta → stesso risultato. */
export const fingerprint = (history, priceEur) => sha([history?.timestamps?.length ?? 0, history?.closesEur ?? [], priceEur ?? null]);
export const outputHash = (result) => sha(result ?? null);

/** true se la previsione contiene numeri mancanti o fuori scala. */
export function resultInvalid(r) {
  if (!r || r.error) return false;
  const f = r.forward || {};
  const s = r.sim || {};
  if (!fin(f.expected) || f.expected < -0.995 || f.expected > 10) return true;
  if (!fin(f.vol) || f.vol <= 0 || f.vol > 10) return true;
  if (s.probLoss != null && !(s.probLoss >= 0 && s.probLoss <= 1)) return true;
  if (s.netGain != null && !fin(s.netGain)) return true;
  for (const v of Object.values(r.mom || {})) if (v != null && !(fin(v) && v > -1)) return true;
  return false;
}

/**
 * Copertura degli intervalli al 90%: per ogni storico settimanale, il rendimento reale delle ultime H settimane rientra
 * nell'intervallo ±1,645 σ√T previsto con la volatilità delle 52 settimane precedenti? Atteso ≈ 90%.
 */
export function intervalCoverage(histories, weeks = 4) {
  let n = 0;
  let inside = 0;
  for (const h of histories) {
    const p = h?.closesEur;
    if (!p || p.length < 54 + weeks) continue;
    const end = p.length - 1;
    const t = end - weeks;
    let m = 0;
    const lr = [];
    for (let k = t - 51; k <= t; k++) {
      const x = Math.log(p[k] / p[k - 1]);
      if (!fin(x)) { lr.length = 0; break; }
      lr.push(x);
      m += x;
    }
    if (lr.length < 52) continue;
    m /= lr.length;
    const sw = Math.sqrt(lr.reduce((a, x) => a + (x - m) ** 2, 0) / (lr.length - 1));
    if (!(sw > 0)) continue;
    const sigma = sw * Math.sqrt(52);
    const T = weeks / 52;
    const z = (Math.log(p[end] / p[t]) - (0.07 - (sigma * sigma) / 2) * T) / (sigma * Math.sqrt(T));
    if (!fin(z)) continue;
    n++;
    if (Math.abs(z) <= 1.645) inside++;
  }
  return { n, inside, share: n ? inside / n : null };
}

/** Campione deterministico di k elementi che ruota a ogni ora (tutti gli strumenti vengono controllati nel tempo). */
export function rotatingSample(list, k, now = Date.now()) {
  if (list.length <= k) return list.slice();
  const step = Math.floor(list.length / k);
  const off = Math.floor(now / 3600e3) % step;
  const out = [];
  for (let i = off; i < list.length && out.length < k; i += step) out.push(list[i]);
  return out;
}

const pc = (x, d = 1) => `${(x * 100).toFixed(d).replace('.', ',')}%`;

/**
 * Riassume i controlli. m: { reproChecked, reproMismatch[], total, invalid[], stale, excluded, priceMismatch,
 *   lsCompared, lsDeviating[], coverage: {n, share}, samples[] }
 */
export function summarize(m, now = new Date()) {
  const checks = [];
  const add = (id, label, level, text) => checks.push({ id, label, level, text });
  // 1) riproducibilità
  add('repro', 'Riproducibilità dei calcoli', m.reproChecked === 0 ? 'warn' : m.reproMismatch.length ? 'fail' : 'ok',
    m.reproChecked === 0 ? 'nessuno strumento ricalcolato' : m.reproMismatch.length ? `${m.reproMismatch.length} su ${m.reproChecked} strumenti danno un risultato diverso a parità di dati: ${m.reproMismatch.slice(0, 5).join(', ')}` : `${m.reproChecked} strumenti ricalcolati con gli stessi dati: risultato identico`);
  // 2) numeri validi
  const invShare = m.total ? m.invalid.length / m.total : 0;
  add('numbers', 'Validità delle previsioni', invShare > 0.005 ? 'fail' : m.invalid.length ? 'warn' : 'ok',
    m.invalid.length ? `${m.invalid.length} previsioni su ${m.total} con valori mancanti o fuori scala: ${m.invalid.slice(0, 5).join(', ')}` : `${m.total} previsioni, nessun valore mancante o fuori scala`);
  // 3) dati
  const staleShare = m.total ? m.stale / m.total : 0;
  add('fresh', 'Quotazioni recenti', staleShare > 0.1 ? 'warn' : 'ok', `${m.total - m.stale} strumenti su ${m.total} con prezzo degli ultimi 10 giorni${m.excluded ? `; ${m.excluded} esclusi perché fermi da oltre 14 giorni` : ''}`);
  const pmShare = m.total ? m.priceMismatch / m.total : 0;
  add('price', 'Prezzo coerente con lo storico', pmShare > 0.01 ? 'warn' : 'ok', m.priceMismatch ? `${m.priceMismatch} strumenti con prezzo attuale lontano dall'ultima chiusura dello storico` : 'prezzo attuale e storico coerenti per tutti gli strumenti');
  if (m.lsCompared != null) {
    const dev = m.lsDeviating.length;
    add('ls', 'Confronto con LS Exchange (Trade Republic)', m.lsCompared && dev / m.lsCompared > 0.25 ? 'warn' : 'ok',
      m.lsCompared ? `${m.lsCompared - dev} su ${m.lsCompared} strumenti del campione entro il 3% dal prezzo di LS Exchange${dev ? ` (diversi: ${m.lsDeviating.slice(0, 5).join(', ')})` : ''}` : 'tutti i prezzi vengono già da LS Exchange o nessun confronto disponibile');
  }
  // fonte dei prezzi: LS Exchange non raggiungibile → quotazioni di riserva (si pubblica, con avviso visibile nell'app)
  if (m.lsDown) add('source', 'Fonte dei prezzi', 'warn', `LS Exchange (la borsa di Trade Republic) non risponde alle richieste automatiche: ${m.fallbackQuotes || 0} quotazioni arrivano dalla fonte di riserva (Yahoo, in parte ritardate di 15 minuti) e possono differire leggermente dai prezzi di Trade Republic`);
  // 4) modello
  const c = m.coverage;
  if (c?.n >= 200) add('model', 'Modello: intervalli di rendimento', c.share < 0.75 || c.share > 0.985 ? 'warn' : 'ok', `nelle ultime 4 settimane il ${pc(c.share)} dei rendimenti reali è dentro l'intervallo previsto al 90% (${c.n} strumenti)${c.share < 0.75 ? ': mercato in fase anomala o volatilità sottostimata' : ''}`);
  // riparazione automatica: strumenti esclusi perché non validi; oltre il 2% il problema è generale e non si pubblica
  const q = m.quarantined || [];
  if (q.length) add('repair', 'Riparazione automatica', m.total && q.length / m.total > 0.02 ? 'fail' : 'warn', `${q.length} strumenti esclusi dalle previsioni perché con dati o calcolo non validi: ${q.slice(0, 8).join(', ')}${q.length > 8 ? '…' : ''}`);
  const status = checks.some((x) => x.level === 'fail') ? 'fail' : checks.some((x) => x.level === 'warn') ? 'warn' : 'ok';
  return { status, at: now.toISOString(), checks, samples: (m.samples || []).slice(0, 5) };
}
