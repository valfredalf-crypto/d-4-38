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
/** Per gli ETF il potenziale è la media sui titoli del fondo, ognuno limitato a ±50%: un valore al tetto non è una stima. */
export const ETF_UPSIDE_CAP = 0.495;
/** Oltre questo rendimento il dividendo è quasi sempre straordinario o un dato anomalo (lo stesso limite del modello). */
export const DIV_EXTREME = 0.12;

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

/** Ordine per dividendo: prima i rendimenti ordinari (fino al 12%), poi quelli straordinari o anomali, in fondo chi non ne ha. */
export function compareDividend(a, b, dir = -1) {
  const tier = (r) => (r.divY == null || Number.isNaN(r.divY) ? 2 : r.divY > DIV_EXTREME ? 1 : 0);
  const ta = tier(a);
  const tb = tier(b);
  if (ta !== tb) return ta - tb;
  if (ta === 2 || a.divY === b.divY) return 0;
  return (a.divY < b.divY ? -1 : 1) * dir;
}

/**
 * Ordine della classifica per potenziale degli analisti (dir −1 = dal più alto), in tre fasce:
 *  1. valori attendibili (almeno 3 analisti, rialzo entro il +100%);
 *  2. valori dubbi (`anWarn`: pochi analisti, rialzo estremo, ETF al tetto), sempre dopo quelli attendibili;
 *  3. senza analisti, sempre in fondo, ordinati per dividendo.
 * A parità di potenziale vale il dividendo più alto. 0 se pari su tutto.
 */
export function compareConsensus(a, b, dir = -1) {
  const tier = (r) => (r.anUp == null || Number.isNaN(r.anUp) ? 2 : r.anWarn ? 1 : 0);
  const ta = tier(a);
  const tb = tier(b);
  if (ta !== tb) return ta - tb;
  if (ta < 2 && a.anUp !== b.anUp) return (a.anUp < b.anUp ? -1 : 1) * dir;
  return compareDividend(a, b, -1);
}
