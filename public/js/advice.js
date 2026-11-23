// Regole di scelta dei suggerimenti: criterio principale il netto più probabile; il Max Growth solo a parità.
// Funzioni pure (testabili): l'app fornisce i candidati già ordinati per netto più probabile decrescente.

/** Tolleranza di parità sul netto più probabile (frazione del capitale): 10% del migliore, almeno 0,3 punti a 30 giorni (scala √tempo). */
export const parityTol = (bestMedian, days) => Math.max(0.1 * Math.abs(bestMedian), 0.003 * Math.sqrt(days / 30));

/** Scarto minimo, rispetto alla destinazione, perché valga la pena spostarsi. */
export const gapThreshold = (targetMedian, days) => Math.max(0.005 * Math.sqrt(days / 30), 0.25 * Math.abs(targetMedian));

/**
 * Insieme «a parità»: candidati con netto più probabile entro la tolleranza dal migliore e crescita attesa non inferiore di più
 * di 2 punti a quella del migliore. cands: [{ median, growth }] ordinati per median decrescente.
 */
export function parityGroup(cands, days) {
  if (!cands?.length) return null;
  const best = cands[0];
  const tol = parityTol(best.median, days);
  const group = cands.filter((c) => c.median >= best.median - tol && (best.growth == null || c.growth == null || c.growth >= best.growth - 0.02));
  return { best, tol, group };
}

/** Tra i candidati a parità vince il Max Growth più alto (campo `mg`); senza Max Growth, il netto più probabile. */
export function chooseByMaxGrowth(group) {
  const g = group.slice().sort((a, b) => (b.mg ?? -Infinity) - (a.mg ?? -Infinity) || b.median - a.median);
  return { target: g[0], tie: group.length > 1 && g[0].mg != null, ranked: g };
}
