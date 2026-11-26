// Sezione «Analisti e dividendi»: potenziale secondo gli analisti (prezzo obiettivo medio a 12 mesi ÷ prezzo − 1) e
// rendimento da dividendi, così come li dichiara la fonte dei dati (non limitati come nel modello delle previsioni,
// che taglia il rialzo a ±50% e il dividendo all'8%). Funzioni pure (testabili).

/** Sotto questo numero di analisti il prezzo obiettivo è poco attendibile (lo stesso minimo usato dal modello). */
export const AN_MIN_RELIABLE = 3;
/**
 * Oltre questo rialzo (+100%) il prezzo obiettivo è spesso superato dai fatti: per esempio fissato prima di un dividendo
 * straordinario che ha fatto crollare il prezzo (2020 Bulkers, aprile 2026: 134,9 NOK distribuiti, obiettivo rimasto a 142).
 */
export const AN_EXTREME = 1;
/** true se il potenziale va preso con cautela: pochi analisti oppure rialzo estremo. */
export const doubtfulTarget = (upside, analysts) => (analysts != null && analysts < AN_MIN_RELIABLE) || (upside != null && upside > AN_EXTREME);

/** Rialzo implicito nel prezzo obiettivo medio degli analisti; null senza prezzo obiettivo, prezzo o analisti. */
export function targetUpside(f) {
  if (!f || !(f.targetMean > 0) || !(f.price > 0) || !(f.analysts >= 1)) return null;
  const u = f.targetMean / f.price - 1;
  return Number.isFinite(u) && u < 100 ? u : null;
}

/** Rendimento da dividendi dichiarato dalla fonte (frazione annua); null se assente o non valido. */
export function rawDividend(f) {
  const y = f?.dividendYield;
  return Number.isFinite(y) && y > 0 && y < 5 ? y : null;
}

const RECO = { strong_buy: 'Acquista (forte)', buy: 'Acquista', hold: 'Tieni', underperform: 'Vendi', sell: 'Vendi (forte)' };
/** Giudizio prevalente degli analisti in italiano; stringa vuota se sconosciuto. */
export const recoLabel = (key) => RECO[key] || '';

/**
 * Ordine della classifica: prima il potenziale degli analisti (dir −1 = dal più alto), chi non ha analisti sempre in
 * fondo; a parità di potenziale, e tra chi non ha analisti, prima il dividendo più alto. 0 se pari su entrambi.
 */
export function compareConsensus(a, b, dir = -1) {
  const ua = a.anUp;
  const ub = b.anUp;
  const na = ua == null || Number.isNaN(ua);
  const nb = ub == null || Number.isNaN(ub);
  if (na !== nb) return na ? 1 : -1;
  if (!na && ua !== ub) return (ua < ub ? -1 : 1) * dir;
  const da = a.divY ?? -Infinity;
  const db = b.divY ?? -Infinity;
  return da === db ? 0 : da < db ? 1 : -1;
}
