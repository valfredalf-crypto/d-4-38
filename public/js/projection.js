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
    { isin: 'IE00BMVB5R75', name: 'Vanguard LifeStrategy 80', weight: 0.6, ter: 0.0025, cagr: 0.066, tax: 0.235, mdd: 0.25 },
    { isin: 'IE00BMFKG444', name: 'Nasdaq 100', weight: 0.2, ter: 0.002, cagr: 0.1, tax: 0.26, mdd: 0.5 },
    { isin: 'IE00BWBXM617', name: 'US Health Care', weight: 0.2, ter: 0.0015, cagr: 0.09, tax: 0.26, mdd: 0.2 },
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
 * MODULO 4 del documento PRJ-FIN-2026-019: quantificazione del rischio.
 *   MDD_p = Σ w_i × MDD storico_i (drawdown massimo teorico del portafoglio in una recessione severa)
 *   σ_p = √(Σ_i Σ_j w_i w_j σ_i σ_j ρ_ij), con ρ_ii = 1 e ρ_ij = `rho` tra asset diversi (0,65 nel documento)
 * Pesi normalizzati alla loro somma. Un asset senza MDD o σ non contribuisce al relativo calcolo
 * (la copertura è indicata in `mddCoverage` / `volCoverage`).
 */
export function portfolioRisk(rows, rho = 0.65) {
  const valid = rows.filter((r) => r && r.weight > 0);
  const wSum = valid.reduce((a, r) => a + r.weight, 0);
  if (!(wSum > 0)) return null;
  let mdd = 0;
  let mddCoverage = 0;
  for (const r of valid) {
    if (Number.isFinite(r.mdd)) {
      mdd += (r.weight / wSum) * Math.abs(r.mdd);
      mddCoverage += r.weight / wSum;
    }
  }
  const withVol = valid.filter((r) => Number.isFinite(r.vol));
  let variance = 0;
  let volCoverage = 0;
  for (const a of withVol) {
    volCoverage += a.weight / wSum;
    for (const b of withVol) variance += (a.weight / wSum) * (b.weight / wSum) * a.vol * b.vol * (a === b ? 1 : rho);
  }
  return { mdd, mddCoverage, vol: withVol.length ? Math.sqrt(variance) : null, volCoverage, rho };
}

/**
 * Valutazione del rischio come nel documento 018 (sezione 5): impatto di una correzione del mercato
 * (−10%) e di un bear market (−30%) in proporzione al beta, capitale temporaneo dopo il calo e tempo di
 * recupero in mesi al CAGR netto: mesi = 12 × ln(1 / (1 − impatto)) / ln(1 + CAGR netto).
 * Con CAGR netto ≤ 0 il recupero non avviene (null).
 */
export const STRESS_SHOCKS = [
  { label: 'Correzione fisiologica', market: 0.1, sop: 'Nessuna azione. Mantenere le posizioni.' },
  { label: 'Recessione / bear market', market: 0.3, sop: 'Non vendere: sfruttare la flessibilità temporale fino al recupero.' },
];
export function stressTest({ beta, netCagr, capital, shocks = STRESS_SHOCKS }) {
  const b = Number.isFinite(beta) ? Math.max(0, beta) : 1;
  return shocks.map((sh) => {
    const impact = Math.min(0.99, b * sh.market);
    const after = capital * (1 - impact);
    const months = netCagr > 0 && impact > 0 ? (12 * Math.log(1 / (1 - impact))) / Math.log(1 + netCagr) : impact > 0 ? null : 0;
    return { ...sh, beta: b, impact, capitalAfter: after, recoveryMonths: months };
  });
}

/**
 * Classifica il tipo di portafoglio dal rischio, per adattare la quantificazione del rischio e lo stress
 * test. Usa la volatilità annua attesa σ_p (misura primaria); in mancanza ripiega sull'MDD storico
 * ponderato (convertito in volatilità equivalente ≈ MDD × 0,45). Restituisce null senza né σ né MDD.
 */
export const PORTFOLIO_TYPES = [
  { max: 0.07, type: 'prudente', label: 'Prudente', desc: 'Prevalenza di obbligazioni e strumenti a bassa oscillazione: cali contenuti e recupero rapido.', bear: 'Mantenere: il calo è contenuto e il recupero atteso è breve.' },
  { max: 0.12, type: 'moderato', label: 'Moderato', desc: 'Mix equilibrato con una componente difensiva importante: oscillazioni medie.', bear: 'Mantenere: la componente difensiva limita il calo; recupero in genere entro pochi anni.' },
  { max: 0.17, type: 'bilanciato', label: 'Bilanciato', desc: 'Esposizione azionaria prevalente ma diversificata: oscillazioni marcate, orizzonte pluriennale.', bear: 'Non vendere: sfruttare la flessibilità temporale; il recupero richiede alcuni anni.' },
  { max: 0.25, type: 'dinamico', label: 'Dinamico / aggressivo', desc: 'Forte esposizione azionaria, spesso concentrata su settori o aree a crescita: cali ampi e recupero lungo.', bear: 'Non vendere, ma attendersi un recupero lungo: servono anni e nervi saldi.' },
  { max: Infinity, type: 'speculativo', label: 'Molto aggressivo / speculativo', desc: 'Volatilità molto elevata (tecnologia concentrata, singole azioni, crypto): sono possibili perdite profonde e durature.', bear: 'Rischio di perdita anche permanente: valutare con attenzione la dimensione della posizione.' },
];
export function classifyPortfolio({ vol, mdd } = {}) {
  const v = Number.isFinite(vol) ? vol : null;
  const m = Number.isFinite(mdd) ? mdd : null;
  const score = v != null ? v : m != null ? m * 0.45 : null;
  if (score == null) return null;
  return { ...PORTFOLIO_TYPES.find((t) => score < t.max), vol: v, mdd: m, score };
}

/**
 * Stress test basato sul rischio effettivo del portafoglio (non su shock di mercato generici): gli scenari
 * derivano dalla volatilità attesa σ_p e dal drawdown massimo storico MDD_p, entrambi calcolati dalla
 * composizione (strumenti e pesi). Così gli scenari si ricalcolano quando cambia il portafoglio.
 *   - Correzione: calo pari a 1 × σ_p
 *   - Ribasso marcato: calo pari a 2 × σ_p (limitato all'MDD_p se disponibile e inferiore)
 *   - Recessione severa: calo pari all'MDD_p (drawdown massimo storico ponderato)
 * Per ogni scenario: capitale residuo e tempo di recupero in mesi al CAGR netto pre-tasse
 * (12 × ln(1 / (1 − calo)) / ln(1 + CAGR)). Con CAGR ≤ 0 il recupero non avviene (null).
 */
export function portfolioStress({ vol, mdd, netCagr, capital }) {
  const scen = [];
  if (Number.isFinite(vol) && vol > 0) {
    scen.push({ label: 'Correzione (−1σ)', drop: Math.min(0.99, vol), note: 'oscillazione ordinaria di un anno' });
    scen.push({ label: 'Ribasso marcato (−2σ)', drop: Math.min(0.99, Number.isFinite(mdd) ? Math.min(2 * vol, Math.max(mdd, vol)) : 2 * vol), note: 'ribasso raro ma possibile' });
  }
  if (Number.isFinite(mdd) && mdd > 0) {
    scen.push({ label: 'Recessione severa (MDD storico)', drop: Math.min(0.99, mdd), note: 'peggior crollo nello storico del portafoglio' });
  }
  return scen.map((sh) => {
    const after = capital * (1 - sh.drop);
    const months = netCagr > 0 && sh.drop > 0 ? (12 * Math.log(1 / (1 - sh.drop))) / Math.log(1 + netCagr) : sh.drop > 0 ? null : 0;
    return { ...sh, capitalAfter: after, recoveryMonths: months };
  });
}
