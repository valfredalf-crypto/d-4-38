// Notifiche sulla sezione «Solidi e in crescita»: cali previsti, oscillazioni forti, segnali di uscita e di rafforzamento.
// Funzioni pure (nessun accesso a pagina o rete): l'app le chiama a ogni aggiornamento dei dati live.
// Sono segnali del modello, non ordini né consigli personalizzati: l'app non compra e non vende mai da sola.
import { stopDistance, updateWatch } from './alerts.js';
import { SOLID_MIN } from './solid.js';

const fin = Number.isFinite;
const signed = (x, d = 1) => `${x > 0 ? '+' : ''}${(x * 100).toFixed(d).replace('.', ',')}%`;
const eur0 = (x) => `${x > 0 ? '+' : ''}${Math.round(x).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')} €`;
const day = (t) => new Date(t).toLocaleDateString('it-IT');

/** Oscillazione giornaliera forte: 2 deviazioni standard giornaliere, almeno 2% (soglia più sensibile di quella degli avvisi di vendita). */
export function oscLimit(vol) {
  const v = fin(vol) && vol > 0 ? vol : 0.4;
  return Math.max(0.02, (2 * v) / Math.sqrt(252));
}

export const LEVEL_ORDER = { sell: 0, warn: 1, buy: 2, osc: 3, new: 4 };

/** Calo «significativo»: esito più probabile di almeno −1% del capitale a 7 giorni oppure −2% a 30 giorni. */
export const DROP = { d7: 0.01, d30: 0.02 };
/**
 * Rapido rialzo con prezzo ancora conveniente: crescita a 30 giorni di almeno +0,30% per seduta e +2% nell'ultima settimana;
 * prezzo almeno il 20% sotto il prezzo obiettivo medio degli analisti (dato attendibile: almeno 3 analisti, non oltre il +100%);
 * esito più probabile positivo a 7 e 30 giorni, con probabilità di guadagno a 30 giorni di almeno il 60%.
 */
export const RISE = { trend: 0.003, week: 0.02, upside: 0.2, p30: 0.6 };
const pc = (x) => `${Math.round(x * 100)}%`;

/**
 * items: strumenti attuali della sezione e quelli che ne erano membri al controllo precedente:
 *   { symbol, isin, name, price, changePct, vol, h: { hD, hW, hW2, hM }, np: { d7, d30, y1, y3, y5 }, solid,
 *     trend (crescita a 30 giorni per seduta), p30 (probabilità di guadagno a 30 giorni), an: { up, n, warn } (potenziale degli analisti) }
 *   (np: netto più probabile in frazione del capitale, già al netto di costi e imposta; solid: soddisfa ora i criteri).
 * prevWatch: { [symbol]: { ref, refAt, peak, peakAt, base: { at, d30, y5 } } }; prevSet: simboli della sezione al controllo
 * precedente (null alla prima volta: nessun «esce» o «entra» da segnalare); cap: capitale impostato (per gli importi in euro).
 * Restituisce { alerts, watch, set }.
 */
export function evaluateSolid(items, prevWatch = {}, prevSet = null, now = Date.now(), cap = 10000) {
  const was = new Set(prevSet || []);
  const alerts = [];
  const watch = {};
  const set = [];
  const date = new Date(now).toISOString().slice(0, 10);
  const E = (x) => eur0(x * cap);
  for (const it of items) {
    const { symbol, np = {}, h = {} } = it;
    const nm = String(it.name || symbol).slice(0, 44);
    const add = (level, icon, key, title, text) => alerts.push({ key, symbol, isin: it.isin || '', level, icon, title: `${nm}: ${title}`, text });
    const member = !!it.solid;
    const wasMember = prevSet != null && was.has(symbol);
    if (member) set.push(symbol);

    // 1) esce dalla sezione: previsioni peggiorate (uscita) oppure crescita recente ferma (attenzione)
    if (!member && wasMember) {
      const f = [];
      if (!(np.y1 > SOLID_MIN.y1)) f.push(fin(np.y1) ? `a 1 anno ${E(np.y1)} (serve oltre 0 €)` : 'senza previsione a 1 anno');
      if (!(np.y3 > SOLID_MIN.y3)) f.push(fin(np.y3) ? `a 3 anni ${E(np.y3)} (serve oltre ${E(SOLID_MIN.y3)})` : 'senza previsione a 3 anni');
      if (!(np.y5 > SOLID_MIN.y5)) f.push(fin(np.y5) ? `a 5 anni ${E(np.y5)} (serve oltre ${E(SOLID_MIN.y5)})` : 'senza previsione a 5 anni');
      const t = [];
      if (!(h.hW > 0)) t.push(`1 settimana ${fin(h.hW) ? signed(h.hW) : 'n.d.'}`);
      if (!(h.hW2 > 0)) t.push(`14 giorni ${fin(h.hW2) ? signed(h.hW2) : 'n.d.'}`);
      if (!(h.hM > 0)) t.push(`1 mese ${fin(h.hM) ? signed(h.hM) : 'n.d.'}`);
      if (fin(h.hD) && !(h.hD > 0)) t.push(`oggi ${signed(h.hD, 2)}`);
      if (f.length) add('sell', '🚨', `sx:${symbol}:${date}`, 'previsione peggiorata, esce dalla sezione', `Netto più probabile non più sufficiente: ${f.join(' · ')}. Segnale di uscita del modello: la crescita non è più sostenuta dalle previsioni.`);
      else add('warn', '⚠️', `sx:${symbol}:${date}`, 'la crescita recente si è fermata', `Esce dalla sezione: ${t.join(' · ') || 'prezzo senza rialzo'}. Le previsioni a 1, 3 e 5 anni restano oltre soglia (${E(np.y1)}, ${E(np.y3)}, ${E(np.y5)}).`);
    }
    if (!member && !wasMember) continue;

    // 2) calo previsto a breve: l'esito più probabile a 7 giorni (e a 30) è diventato negativo
    const exitedSell = alerts.some((a) => a.symbol === symbol && a.level === 'sell');
    const bigDrop = (fin(np.d7) && np.d7 <= -DROP.d7) || (fin(np.d30) && np.d30 <= -DROP.d30);
    if (!exitedSell && bigDrop) {
      // calo significativo: avviso unico al giorno, al posto dei due avvisi di calo più lievi
      add('sell', '🚨', `sdrop:${symbol}:${date}`, 'calo significativo previsto', `Esito più probabile ${fin(np.d7) ? `${E(np.d7)} a 7 giorni` : ''}${fin(np.d7) && fin(np.d30) ? ' e ' : ''}${fin(np.d30) ? `${E(np.d30)} a 30 giorni` : ''}${fin(it.p30) ? ` (probabilità di guadagno a 30 giorni ${pc(it.p30)})` : ''}. Azione rapida che hai associato a questo segnale: valutare la vendita, parziale o totale. Segnale del modello, non una garanzia.`);
    } else if (!exitedSell && fin(np.d7) && np.d7 < 0) {
      if (fin(np.d30) && np.d30 <= 0) add('sell', '🚨', `sf:${symbol}`, 'segnale di uscita: calo previsto', `Il modello prevede ora un esito più probabile di ${E(np.d7)} a 7 giorni e ${E(np.d30)} a 30 giorni: calo atteso nel breve periodo.`);
      else add('warn', '⚠️', `sf7:${symbol}`, 'calo probabile a 7 giorni', `Esito più probabile a 7 giorni ${E(np.d7)}${fin(np.d30) ? ` (a 30 giorni ${E(np.d30)})` : ''}.`);
    }

    // riferimenti per massimo e confronto: ricostruiti ogni giorno dalla prima rilevazione nella sezione
    const w0 = updateWatch(prevWatch?.[symbol], it.price, now);
    if (!w0) continue;
    const prevBase = prevWatch?.[symbol]?.base;
    const base = !prevBase || now - prevBase.at >= 864e5 ? { at: now, d30: fin(np.d30) ? np.d30 : null, y5: fin(np.y5) ? np.y5 : null } : prevBase;
    if (member) watch[symbol] = { ...w0, base };
    if (!member) continue;
    const stop = stopDistance(it.vol);
    const dd = w0.peak > 0 ? 1 - it.price / w0.peak : 0;

    // 3) oscillazioni: calo dal massimo oltre la soglia di protezione; movimento forte in giornata (in calo o in rialzo)
    let hit = false;
    if (dd >= stop) {
      hit = true;
      add('sell', '🛑', `sstop:${symbol}:${Math.round(w0.peak * 100)}`, 'soglia di protezione superata', `Sceso ${signed(-dd)} dal massimo (${w0.peak.toFixed(2).replace('.', ',')} €) visto dal ${day(w0.peakAt)} nella sezione, oltre la soglia del ${(stop * 100).toFixed(0)}% prevista per la sua volatilità: oscillazione sopra la norma.`);
    }
    const lim = oscLimit(it.vol);
    if (fin(it.changePct) && it.changePct <= -lim) {
      hit = true;
      add('warn', '📉', `sday:${symbol}:${date}`, 'forte oscillazione al ribasso oggi', `${signed(it.changePct, 2)} nella seduta, oltre la soglia del ${(lim * 100).toFixed(1).replace('.', ',')}% per la sua volatilità.`);
    } else if (fin(it.changePct) && it.changePct >= lim) {
      add('osc', '〰️', `sup:${symbol}:${date}`, 'forte oscillazione al rialzo oggi', `${signed(it.changePct, 2)} nella seduta, oltre la soglia del ${(lim * 100).toFixed(1).replace('.', ',')}%: dopo un rialzo rapido il prezzo può ritracciare.`);
    }

    // 4) rafforzamento: previsione migliorata dall'ultimo controllo giornaliero, oppure ritracciamento con previsioni intatte
    const sold = hit || alerts.some((a) => a.symbol === symbol && (a.level === 'sell' || a.level === 'warn'));
    if (!sold && fin(np.d7) && np.d7 > 0 && fin(np.d30) && np.d30 > 0) {
      const b = prevBase;
      if (b && fin(b.y5) && fin(np.y5) && np.y5 - b.y5 >= 0.03) add('buy', '✅', `sbu5:${symbol}:${date}`, 'previsione rafforzata', `Netto più probabile a 5 anni salito da ${E(b.y5)} a ${E(np.y5)} dall'ultimo controllo giornaliero. Segnale di rafforzamento del modello.`);
      else if (b && fin(b.d30) && np.d30 - b.d30 >= 0.01) add('buy', '✅', `sbu30:${symbol}:${date}`, 'previsione a 30 giorni rafforzata', `Netto più probabile a 30 giorni salito da ${E(b.d30)} a ${E(np.d30)} dall'ultimo controllo giornaliero. Segnale di rafforzamento del modello.`);
      else if (dd >= Math.max(0.03, stop / 2) && dd < stop) add('buy', '📈', `sbud:${symbol}:${Math.round(w0.peak * 100)}`, 'ritracciamento con previsioni intatte', `Sceso ${signed(-dd)} dal massimo, ma le previsioni restano positive (7 giorni ${E(np.d7)}, 30 giorni ${E(np.d30)}, 5 anni ${E(np.y5)}). Possibile occasione di rafforzamento secondo il modello.`);
    }

    // 4b) rapido rialzo con prezzo ancora conveniente rispetto al prezzo obiettivo degli analisti
    const an = it.an || {};
    if (!sold && fin(it.trend) && it.trend >= RISE.trend && fin(h.hW) && h.hW >= RISE.week && fin(an.up) && !an.warn && an.up >= RISE.upside && fin(np.d7) && np.d7 > 0 && fin(np.d30) && np.d30 > 0 && (!fin(it.p30) || it.p30 >= RISE.p30)) {
      add('buy', '🟢', `sbuy:${symbol}:${date}`, 'rapido rialzo e prezzo conveniente', `In rapido rialzo (crescita a 30 giorni ${signed(it.trend, 2)} per seduta, 1 settimana ${signed(h.hW)}) e prezzo ancora del ${pc(an.up / (1 + an.up))} sotto il prezzo obiettivo medio${fin(an.n) ? ` di ${an.n} analisti` : ' dei titoli del fondo'} (potenziale ${signed(an.up, 0)}). Esito più probabile ${E(np.d7)} a 7 giorni e ${E(np.d30)} a 30 giorni${fin(it.p30) ? ` (probabilità di guadagno ${pc(it.p30)})` : ''}. Azione rapida che hai associato a questo segnale: valutare l'acquisto. Segnale del modello, non una garanzia.`);
    }

    // 5) nuovo ingresso nella sezione
    if (prevSet != null && !was.has(symbol)) add('new', '🆕', `snew:${symbol}:${date}`, 'entra nella sezione', `Netto più probabile: 1 anno ${E(np.y1)}, 3 anni ${E(np.y3)}, 5 anni ${E(np.y5)}; prezzo in rialzo su 1 settimana ${signed(h.hW)}, 14 giorni ${signed(h.hW2)}, 1 mese ${signed(h.hM)}.`);
  }
  alerts.sort((a, b) => (LEVEL_ORDER[a.level] ?? 9) - (LEVEL_ORDER[b.level] ?? 9));
  return { alerts, watch, set };
}

/**
 * Data di ogni notifica e ordine per data: `seen` ricorda quando ogni notifica (per chiave) è comparsa la prima volta.
 * Restituisce l'elenco con `at` (prima comparsa; le notifiche che hanno già una data la conservano), ordinato dalla più
 * recente; a parità di data vale l'urgenza. `seen` viene ripulito dalle notifiche non più presenti.
 */
export function stampAlerts(alerts, seen = {}, now = Date.now()) {
  const next = {};
  const list = alerts.map((a) => {
    const at = fin(a.at) ? a.at : fin(seen?.[a.key]) ? seen[a.key] : now;
    next[a.key] = at;
    return { ...a, at };
  });
  list.sort((a, b) => b.at - a.at || (LEVEL_ORDER[a.level] ?? 9) - (LEVEL_ORDER[b.level] ?? 9));
  return { list, seen: next };
}
