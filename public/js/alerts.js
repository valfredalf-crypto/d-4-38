// Avvisi di vendita per le posizioni del portafoglio volatili o con alto rendimento atteso a breve termine.
// Funzioni pure (nessun accesso a pagina o rete): l'app le chiama a ogni aggiornamento dei prezzi.
// Gli avvisi sono indicazioni del modello, non ordini: l'app non vende mai da sola.

export const COOLDOWN_MS = 6 * 3600e3; // stesso avviso al massimo ogni 6 ore (salvo peggioramento: chiave diversa)
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const fin = Number.isFinite;

/** Distanza di protezione dal massimo (trailing stop): 2 deviazioni standard settimanali, tra 6% e 30%. */
export function stopDistance(vol) {
  const v = fin(vol) && vol > 0 ? vol : 0.5;
  return clamp((2 * v) / Math.sqrt(52), 0.06, 0.3);
}

/** Calo giornaliero che fa scattare l'avviso: 2,5 deviazioni standard giornaliere, almeno 5%. */
export function dayDropLimit(vol) {
  const v = fin(vol) && vol > 0 ? vol : 0.5;
  return Math.max(0.05, (2.5 * v) / Math.sqrt(252));
}

/** Strumento da sorvegliare: a leva/short, volatile (≥ 30% annuo) o con guadagno atteso a 30 giorni ≥ 5%. */
export function isMonitored({ vol, leveraged, fc }) {
  return !!leveraged || (fin(vol) && vol >= 0.3) || (fin(fc?.[30]?.median) && fc[30].median >= 0.05);
}

/** Aggiorna prezzo di riferimento (prima rilevazione) e massimo osservato. */
export function updateWatch(prev, price, now) {
  if (!(price > 0)) return prev || null;
  if (!prev || !(prev.ref > 0)) return { ref: price, refAt: now, peak: price, peakAt: now };
  return price > prev.peak ? { ...prev, peak: price, peakAt: now } : prev;
}

const pc = (x, d = 1) => `${x > 0 ? '+' : ''}${(x * 100).toFixed(d).replace('.', ',')}%`;
const eur = (x) => `${Math.round(x).toLocaleString('it-IT')} €`;
const day = (t) => new Date(t).toLocaleDateString('it-IT');

/**
 * Avvisi per una posizione.
 * h: { symbol, name, amount, vol, leveraged, price, changePct, fc: {7,14,30: {median, p}} } (fc: guadagno netto più probabile
 * in frazione del capitale, già al netto di costi e imposta); w: { ref, refAt, peak, peakAt } da updateWatch.
 */
export function evaluateHolding(h, w, now = Date.now()) {
  const out = [];
  if (!isMonitored(h) || !(h.price > 0) || !w) return out;
  const nm = String(h.name || h.symbol).slice(0, 44);
  const stop = stopDistance(h.vol);
  const dd = w.peak > 0 ? 1 - h.price / w.peak : 0;
  const gain = w.ref > 0 ? h.price / w.ref - 1 : 0;
  const peakGain = w.ref > 0 ? w.peak / w.ref - 1 : 0;
  const amount = h.amount > 0 ? h.amount : 0;
  const loss = (x) => (amount > 0 ? ` (circa ${eur(amount * x)} sulla tua posizione di ${eur(amount)})` : '');
  const f7 = h.fc?.[7];
  const f14 = h.fc?.[14];
  const f30 = h.fc?.[30];

  // 1) la previsione a breve è diventata negativa: meglio uscire prima del calo
  if (fin(f7?.median) && fin(f30?.median) && f7.median <= 0 && f30.median <= 0) {
    out.push({ key: `fc:${h.symbol}`, symbol: h.symbol, level: 'sell', icon: '🚨', title: `${nm}: vendi o riduci prima che cali`, text: `Il modello prevede ora un esito più probabile di ${pc(f7.median)} a 7 giorni e ${pc(f30.median)} a 30${fin(f30.p) ? ` (probabilità di guadagno ${Math.round(f30.p * 100)}%)` : ''}: il rialzo atteso è esaurito.${fin(f14?.median) ? ` A 14 giorni ${pc(f14.median)}.` : ''} Valuta di vendere o ridurre la posizione.` });
  } else if (fin(f7?.median) && f7.median < 0) {
    out.push({ key: `fc7:${h.symbol}`, symbol: h.symbol, level: 'warn', icon: '⚠️', title: `${nm}: calo probabile a 7 giorni`, text: `Esito più probabile a 7 giorni ${pc(f7.median)} (a 30 giorni ${fin(f30?.median) ? pc(f30.median) : 'n.d.'}). Tieni d'occhio la soglia di protezione.` });
  }

  // 2) protezione: calo dal massimo oltre la soglia in base alla volatilità
  if (dd >= stop) {
    out.push({ key: `stop:${h.symbol}:${Math.round(w.peak * 100)}`, symbol: h.symbol, level: 'sell', icon: '🛑', title: `${nm}: soglia di protezione superata`, text: `Sceso ${pc(-dd)} dal massimo (${w.peak.toFixed(2).replace('.', ',')} € → ${h.price.toFixed(2).replace('.', ',')} €)${loss(dd)}; la soglia per questo strumento è −${(stop * 100).toFixed(0)}% (in base alla sua volatilità). Vendere ora limita la perdita.` });
  }

  // 3) calo forte in giornata
  if (fin(h.changePct) && h.changePct <= -dayDropLimit(h.vol)) {
    out.push({ key: `day:${h.symbol}:${new Date(now).toISOString().slice(0, 10)}`, symbol: h.symbol, level: 'sell', icon: '📉', title: `${nm}: calo forte oggi`, text: `${pc(h.changePct)} nella seduta${loss(-h.changePct)}, oltre il ${(dayDropLimit(h.vol) * 100).toFixed(1).replace('.', ',')}% che per questo strumento è insolito. Controlla le notizie e valuta di uscire.` });
  }

  // 4) ha restituito metà del guadagno
  if (peakGain >= 0.08 && h.price - w.ref <= 0.5 * (w.peak - w.ref) && dd > 0.02) {
    out.push({ key: `gb:${h.symbol}:${Math.round(w.peak * 100)}`, symbol: h.symbol, level: 'sell', icon: '💸', title: `${nm}: ha restituito metà del guadagno`, text: `Dal ${day(w.refAt)} era salito ${pc(peakGain)}; ora è ${pc(gain)}. Per non riperdere il resto valuta di vendere.` });
  }

  // 5) obiettivo a 30 giorni raggiunto: incassa o alza la protezione
  const target = Math.max(0.05, fin(f30?.median) ? f30.median : 0);
  if (gain >= target && dd < stop) {
    out.push({ key: `tp:${h.symbol}:${Math.floor(gain * 20)}`, symbol: h.symbol, level: 'trim', icon: '🎯', title: `${nm}: obiettivo raggiunto`, text: `Dal ${day(w.refAt)} è salito ${pc(gain)}, in linea con il guadagno previsto a 30 giorni. Puoi incassare in parte o alzare la soglia di protezione (ora ${(h.price * (1 - stop)).toFixed(2).replace('.', ',')} €).` });
  }
  return out;
}

/** Tutte le posizioni: aggiorna i riferimenti e restituisce { alerts, watch } (watch senza le posizioni uscite). */
export function evaluateAlerts(holdings, prevWatch = {}, now = Date.now()) {
  const watch = {};
  const alerts = [];
  for (const h of holdings) {
    const w = updateWatch(prevWatch?.[h.symbol], h.price, now);
    if (w) watch[h.symbol] = w;
    alerts.push(...evaluateHolding(h, w, now));
  }
  const order = { sell: 0, warn: 1, trim: 2 };
  alerts.sort((a, b) => (order[a.level] ?? 9) - (order[b.level] ?? 9));
  return { alerts, watch };
}

/** Avvisi da notificare sul dispositivo ora: quelli non inviati nelle ultime COOLDOWN_MS. Aggiorna `sent`. */
export function dueAlerts(alerts, sent, now = Date.now()) {
  const due = [];
  for (const a of alerts) {
    if (a.level === 'trim') continue; // gli inviti a incassare restano nell'elenco, senza notifica sul dispositivo
    if (!(now - (sent[a.key] || 0) < COOLDOWN_MS)) {
      due.push(a);
      sent[a.key] = now;
    }
  }
  for (const k of Object.keys(sent)) if (now - sent[k] > 7 * 864e5) delete sent[k];
  return due;
}
