// Crescita recente di uno strumento sugli ultimi 30 giorni, dalle chiusure giornaliere in EUR (regola chiesta dall'utente il 25/11/2026):
// - pendenza della curva del rendimento complessivo (retta ai minimi quadrati sul rendimento cumulato, per seduta);
// - media ponderata degli incrementi tra una seduta e l'altra, con più peso alle sedute recenti (il peso si dimezza ogni 5 sedute).
// Funzioni pure: usate dalla catena dei dati (lib/market.js) e dall'app (classifica della sezione «Solidi e in crescita»).
export const TREND_DAYS = 30;
export const TREND_MIN_SESSIONS = 10; // con meno sedute la pendenza non è significativa
export const TREND_HALF_LIFE = 5;
const fin = (x) => typeof x === 'number' && Number.isFinite(x);
const r5 = (x) => Math.round(x * 1e5) / 1e5;

/**
 * timestamps (secondi) e chiusure giornaliere; price = prezzo attuale (vale come ultima seduta se diverso dall'ultima chiusura).
 * Restituisce { sl, wm, sn }: pendenza e media ponderata in rendimento per seduta, numero di sedute; null se i dati non bastano
 * o contengono salti impossibili (raggruppamenti di azioni non corretti dalla fonte).
 */
export function trend30(timestamps, closes, price, now = Date.now()) {
  const ts = timestamps || [];
  const cl = closes || [];
  const from = now / 1000 - TREND_DAYS * 86400;
  let base = null;
  const v = [];
  for (let i = 0; i < ts.length; i++) {
    const c = cl[i];
    if (!(c > 0) || !(ts[i] <= now / 1000 + 86400)) continue;
    if (ts[i] <= from) base = c;
    else v.push(c);
  }
  if (price > 0 && v.length) {
    const lastDay = Math.floor(ts[ts.length - 1] / 86400);
    if (lastDay === Math.floor(now / 86400e3)) v[v.length - 1] = price; // la barra di oggi è ancora aperta: vale il prezzo attuale
    else if (Math.abs(price / v[v.length - 1] - 1) > 1e-6) v.push(price); // prezzo di oggi non ancora nello storico
  }
  if (base != null) v.unshift(base);
  const n = v.length - 1; // sedute (incrementi)
  if (n < TREND_MIN_SESSIONS) return null;
  // incrementi tra una seduta e l'altra, media con peso che si dimezza ogni TREND_HALF_LIFE sedute andando indietro
  let sw = 0;
  let swd = 0;
  for (let k = 1; k <= n; k++) {
    const d = v[k] / v[k - 1] - 1;
    if (!fin(d) || Math.abs(d) > 3) return null;
    const w = 0.5 ** ((n - k) / TREND_HALF_LIFE);
    sw += w;
    swd += w * d;
  }
  // pendenza della retta ai minimi quadrati sul rendimento cumulato r_k = v_k / v_0 − 1 (k = 0 … n)
  const mk = n / 2;
  let mr = 0;
  for (let k = 0; k <= n; k++) mr += v[k] / v[0] - 1;
  mr /= n + 1;
  let num = 0;
  let den = 0;
  for (let k = 0; k <= n; k++) {
    num += (k - mk) * (v[k] / v[0] - 1 - mr);
    den += (k - mk) ** 2;
  }
  const sl = num / den;
  const wm = swd / sw;
  if (!fin(sl) || !fin(wm)) return null;
  return { sl: r5(sl), wm: r5(wm), sn: n };
}

/** Punteggio di crescita per la classifica: media tra pendenza e media ponderata (rendimento per seduta); null senza dati. */
export function trendScore(perf) {
  return fin(perf?.sl) && fin(perf?.wm) ? (perf.sl + perf.wm) / 2 : null;
}
