// Proiezione deterministica di portafoglio: stesso algoritmo del documento tecnico PRJ-FIN-2026-018.
//   1) CAGR lordo, TER e aliquota fiscale del portafoglio = medie ponderate per il peso di ogni strumento
//   2) CAGR netto pre-tasse = CAGR lordo − TER
//   3) montante lordo = capitale × (1 + CAGR netto)^anni; plusvalenza = montante − capitale
//   4) imposta = plusvalenza × aliquota ponderata; guadagno netto = plusvalenza − imposta
// Tutti i tassi sono frazioni (0,066 = 6,6 %). I pesi vengono normalizzati alla loro somma.

/** Portafoglio del documento: Core-Satellite 60/20/20 (LS80 + Nasdaq 100 + US Health Care). */
export const GEMINI_PORTFOLIO = {
  capital: 12000,
  years: [5, 7],
  rows: [
    { isin: 'IE00BMVB5R75', name: 'Vanguard LifeStrategy 80', weight: 0.6, ter: 0.0025, cagr: 0.066, tax: 0.235 },
    { isin: 'IE00BMFKG444', name: 'Nasdaq 100', weight: 0.2, ter: 0.002, cagr: 0.1, tax: 0.26 },
    { isin: 'IE00BWBXM617', name: 'US Health Care', weight: 0.2, ter: 0.0015, cagr: 0.09, tax: 0.26 },
  ],
};

/** Medie ponderate dei parametri (pesi normalizzati). */
export function weightedParams(rows) {
  const valid = rows.filter((r) => r && r.weight > 0 && Number.isFinite(r.cagr));
  const wSum = valid.reduce((a, r) => a + r.weight, 0);
  if (!(wSum > 0)) return null;
  const avg = (k) => valid.reduce((a, r) => a + (r.weight / wSum) * (Number.isFinite(r[k]) ? r[k] : 0), 0);
  const cagr = avg('cagr');
  const ter = avg('ter');
  const tax = avg('tax');
  return { cagr, ter, tax, net: cagr - ter, weightSum: wSum };
}

/** Proiezione a `years` anni di `capital` con i parametri ponderati. */
export function project(params, capital, years) {
  const gross = capital * (1 + params.net) ** years;
  const gain = gross - capital;
  const taxDue = gain > 0 ? gain * params.tax : 0; // nessun credito d'imposta su una minusvalenza
  const netGain = gain - taxDue;
  return { years, gross, gain, tax: taxDue, netGain, finalCapital: capital + netGain, netPct: netGain / capital };
}

/** Proiezione completa del portafoglio sugli orizzonti indicati. */
export function projectPortfolio({ rows, capital, years }) {
  const params = weightedParams(rows);
  if (!params) return null;
  return { params, horizons: years.map((y) => project(params, capital, y)) };
}

/**
 * CAGR corretto per il rischio di perdita, da usare nella proiezione composta:
 *   CAGR atteso − σ²/2 (drag della volatilità: il tasso composto che si realizza davvero lungo il
 *   percorso mediano, inferiore alla media aritmetica) − k × ES5 / anni (perdita media nel 5% peggiore
 *   degli scenari, spalmata sugli anni dell'orizzonte, con il coefficiente k del profilo NR5).
 * Restituisce null senza rendimento atteso. Mancando σ o ES5 la relativa correzione è 0.
 */
export function riskAdjustedCagr({ expected, vol, es5, k = 0.5, years = 5 }) {
  if (!Number.isFinite(expected)) return null;
  const drag = Number.isFinite(vol) ? (vol * vol) / 2 : 0;
  const lossPenalty = Number.isFinite(es5) && years > 0 ? (k * Math.max(0, es5)) / years : 0;
  return { cagr: expected - drag - lossPenalty, expected, drag, lossPenalty };
}
