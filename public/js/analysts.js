// Quanto credere al prezzo obiettivo degli analisti (a 12 mesi) nelle previsioni. Funzioni pure (testabili).
// Il rialzo implicito (obiettivo ÷ prezzo − 1) non si prende per intero:
//  1. obiettivo non aggiornato: se il prezzo si è mosso molto negli ultimi 6 mesi nella direzione opposta al rialzo implicito
//     (es. −26% con obiettivo a +50%), gran parte del «rialzo» nasce dal calo del prezzo e non da una nuova valutazione: si fa la
//     media con il rialzo che l'obiettivo dava al prezzo di 6 mesi fa;
//  2. ottimismo sistematico: dei rialzi positivi si crede solo una quota (`haircut`, 50% come nel modello a 5 anni);
//  3. copertura: con pochi analisti il peso è basso (n ÷ (n + 5): 3 analisti 38%, 10 analisti 67%, 30 analisti 86%); il resto
//     del peso va al rendimento atteso del modello, che tiene conto anche dello storico.

export const STALE_MOVE = 0.15; // movimento del prezzo in 6 mesi oltre il quale l'obiettivo si considera in ritardo

/**
 * @param upside   rialzo implicito nel prezzo obiettivo (frazione, es. 0,5 = +50%)
 * @param analysts numero di analisti (null per gli ETF: media dei titoli del fondo → peso 50%)
 * @param mom26    rendimento del prezzo nelle ultime 26 settimane (frazione) o null
 * @returns { value, weight, stale, raw } oppure null se manca il prezzo obiettivo
 */
export function analystView({ upside, analysts = null, mom26 = null, haircut = 0.5 }) {
  if (!Number.isFinite(upside)) return null;
  let u = upside;
  let stale = false;
  if (Number.isFinite(mom26) && mom26 > -0.99) {
    const old = (1 + upside) * (1 + mom26) - 1; // rialzo che lo stesso obiettivo dava al prezzo di 6 mesi fa
    if (upside > 0 && mom26 <= -STALE_MOVE) {
      u = (upside + Math.max(0, old)) / 2;
      stale = true;
    } else if (upside < 0 && mom26 >= STALE_MOVE) {
      u = (upside + Math.min(0, old)) / 2;
      stale = true;
    }
  }
  if (u > 0) u *= haircut;
  const weight = analysts > 0 ? analysts / (analysts + 5) : 0.5;
  return { value: u, weight, stale, raw: upside };
}

/** Previsione annua a breve: media pesata tra la vista degli analisti e il rendimento atteso del modello. */
export function blendWithModel(view, model) {
  if (!view) return model;
  if (!Number.isFinite(model)) return view.value;
  return view.weight * view.value + (1 - view.weight) * model;
}

/**
 * Mediana PONDERATA (interpolata) di più previsioni: items = [{ value, weight }]. Ogni previsione pesa secondo la sua affidabilità;
 * una previsione estrema sposta il risultato al massimo fino alla previsione vicina (a differenza della media). L'interpolazione
 * tra i punti centrali rende il risultato continuo: piccole variazioni dei dati non fanno saltare la stima.
 */
export function weightedMedian(items) {
  const xs = (items || []).filter((x) => x && Number.isFinite(x.value) && x.weight > 0).sort((a, b) => a.value - b.value);
  if (!xs.length) return null;
  if (xs.length === 1) return xs[0].value;
  const W = xs.reduce((a, x) => a + x.weight, 0);
  let acc = 0;
  const mid = xs.map((x) => {
    const c = (acc + x.weight / 2) / W;
    acc += x.weight;
    return c;
  });
  if (0.5 <= mid[0]) return xs[0].value;
  for (let k = 1; k < xs.length; k++) {
    if (0.5 <= mid[k]) return xs[k - 1].value + ((0.5 - mid[k - 1]) / (mid[k] - mid[k - 1])) * (xs[k].value - xs[k - 1].value);
  }
  return xs[xs.length - 1].value;
}

/**
 * Previsione annua più affidabile: mediana ponderata delle previsioni disponibili, ognuna con il suo peso di affidabilità.
 *  - analisti: vista corretta (analystView); peso n ÷ (n + 5), dimezzato se l'obiettivo è in ritardo sul prezzo;
 *  - fondamentali (crescita utili + dividendo + valutazione): peso = quota confermata dalle evidenze (0–1);
 *  - modello (storico, equilibrio di mercato, analisti e fondamentali già pesati per credibilità): peso 1, 0,5 se stima provvisoria.
 * @returns { value, parts: [{ id, value, weight }] }
 */
export function combineForecasts({ analyst = null, fundamentals = null, evidence = null, model = null, estimated = false }) {
  const parts = [];
  if (analyst && Number.isFinite(analyst.value)) parts.push({ id: 'analisti', value: analyst.value, weight: analyst.weight * (analyst.stale ? 0.5 : 1) });
  if (Number.isFinite(fundamentals)) parts.push({ id: 'fondamentali', value: fundamentals, weight: Math.min(1, Math.max(0.1, Number.isFinite(evidence) ? evidence : 0.4)) });
  if (Number.isFinite(model)) parts.push({ id: 'modello', value: model, weight: estimated ? 0.5 : 1 });
  return { value: weightedMedian(parts), parts };
}
