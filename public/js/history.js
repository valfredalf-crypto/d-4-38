// Storico mostrato nella sezione «Netto più probabile»: variazioni lorde del prezzo in EUR (oggi, 1 settimana, 14 giorni, 1 mese,
// 1 anno). Le fonti a volte riportano variazioni impossibili (chiusura precedente sbagliata, raggruppamento di azioni non
// corretto): ordinando per rendimento finirebbero in cima alla classifica. Meglio nessun dato che uno falso: si scartano.
const fin = (x) => typeof x === 'number' && Number.isFinite(x);

/**
 * inst: { type, leveraged }, q: { changePct, perf: { w, w2, m, y } } → { hD, hW, hW2, hM, hY } (null = non disponibile o non credibile)
 * - oggi: un ETF non a leva non varia oltre il 30% in un giorno; una variazione oltre il 50% deve essere compatibile con quella
 *   della settimana, che la contiene (altrimenti la chiusura precedente della fonte è sbagliata);
 * - 1 settimana, 14 giorni, 1 mese: oltre +3000% è un errore dei dati (raggruppamento non corretto);
 * - 1 anno: oltre +10000%, oppure oltre +2000% per i prodotti a leva (i loro raggruppamenti sono frequenti e spesso non corretti).
 */
export function histValues(inst, q) {
  const p = q?.perf || {};
  const w = fin(p.w) && p.w <= 30 ? p.w : null;
  const w2 = fin(p.w2) && p.w2 <= 30 ? p.w2 : null;
  const m = fin(p.m) && p.m <= 30 ? p.m : null;
  const y = fin(p.y) && p.y <= (inst?.leveraged ? 20 : 100) ? p.y : null;
  let d = fin(q?.changePct) ? q.changePct : null;
  if (d != null) {
    if (inst?.type === 'etf' && !inst.leveraged && Math.abs(d) > 0.3) d = null;
    else if (Math.abs(d) > 0.5 && fin(p.w) && d > -1) {
      const before = (1 + p.w) / (1 + d); // andamento dei giorni precedenti implicito nelle due variazioni
      if (before < 0.4 || before > 2.5) d = null;
    }
  }
  return { hD: d, hW: w, hW2: w2, hM: m, hY: y };
}
