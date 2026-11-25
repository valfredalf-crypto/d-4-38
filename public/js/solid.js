// Sezione «Solidi e in crescita»: solo strumenti con netto più probabile positivo e alto a 1, 3 e 5 anni e con il prezzo in
// crescita di recente. Regole fisse, chieste dall'utente il 25/11/2026.
// Soglie del netto più probabile in frazione del capitale impostato: su 10.000 € sono 0 €, 1.000 € e 2.000 €.
export const SOLID_MIN = { y1: 0, y3: 0.1, y5: 0.2 };
const fin = (x) => typeof x === 'number' && Number.isFinite(x);

/** Prezzo in crescita di recente: in rialzo su 1 settimana, 14 giorni e 1 mese; oggi non in calo (senza prezzo di oggi non si esclude). */
export function solidRecent(h) {
  if (!h || !(h.hW > 0) || !(h.hW2 > 0) || !(h.hM > 0)) return false;
  return h.hD == null || h.hD > 0;
}

/** np = { y1, y3, y5 }: netto più probabile a 1, 3 e 5 anni in frazione del capitale; h = storico { hD, hW, hW2, hM }. */
export function solidPass(np, h) {
  if (!solidRecent(h) || !np) return false;
  return fin(np.y1) && np.y1 > SOLID_MIN.y1 && fin(np.y3) && np.y3 > SOLID_MIN.y3 && fin(np.y5) && np.y5 > SOLID_MIN.y5;
}
