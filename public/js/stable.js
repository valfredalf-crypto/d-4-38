// Stabilità delle classifiche: media mobile esponenziale dei valori e «banda morta» sulle posizioni.
// Funzioni pure (testabili): l'app le usa per la sezione «Netto più probabile».

/** Media mobile esponenziale: chi ha già un valore lo aggiorna di una frazione alpha verso il nuovo. */
export const ema = (prev, raw, alpha = 0.3) => (Number.isFinite(prev) ? alpha * raw + (1 - alpha) * prev : raw);

/** Ampiezza della banda morta (in posizioni) per una posizione precedente p: 20% della posizione, almeno 1. */
export const bandOf = (p, frac = 0.2) => Math.max(1, Math.round(frac * p));

/**
 * Posizioni stabili. ordered: simboli già ordinati per valore decrescente (classifica «vera»); prevPos: Map simbolo → posizione
 * mostrata l'ultima volta. Chi si è spostato di meno della banda morta resta dov'era; gli altri vanno alla posizione vera.
 * Restituisce Map simbolo → posizione densa 1..N.
 */
export function stabilizeRanks(ordered, prevPos, frac = 0.2) {
  const trueRank = new Map(ordered.map((s, i) => [s, i + 1]));
  if (!prevPos?.size) return trueRank;
  const key = new Map();
  for (const s of ordered) {
    const t = trueRank.get(s);
    const p = prevPos.get(s);
    key.set(s, p != null && Math.abs(t - p) <= bandOf(p, frac) ? p : t);
  }
  const sorted = ordered.slice().sort((a, b) => key.get(a) - key.get(b) || trueRank.get(a) - trueRank.get(b));
  return new Map(sorted.map((s, i) => [s, i + 1]));
}
