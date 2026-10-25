// Filtri sugli indicatori (min/max). I valori percentuali si inseriscono in punti percentuali
// (es. 40 = 40%); la perdita massima si indica come numero positivo (40 = perdita fino al 40%).
export const INDICATORS = [
  { key: 'proj', label: 'Netto 019 − MDD storico 5a (indicatore principale)', pct: true },
  { key: 'proj019', label: 'Guadagno netto 5a (algoritmo 019: CAGR − TER, imposta)', pct: true },
  { key: 'cagr', label: 'CAGR atteso annuo (modulo 1)', pct: true },
  { key: 'histMdd', label: 'MDD storico (modulo 4)', pct: true },
  { key: 'overall', label: 'Netto Reale 5A (NR5)', pct: true },
  { key: 'es5', label: 'Perdita media nel 5% peggiore degli scenari', pct: true },
  { key: 'sharpe', label: 'Indice di Sharpe', pct: false },
  { key: 'sortino', label: 'Indice di Sortino', pct: false },
  { key: 'plausible', label: 'Guadagno netto efficiente 5a (prudenza scelta)', pct: true },
  { key: 'growthEvidence', label: 'Crescita confermata dalle evidenze (0–100%)', pct: true },
  { key: 'ratio', label: 'Rapporto perdita/guadagno', pct: false },
  { key: 'balanced', label: 'Guadagno bilanciato crescita/rischio 5a', pct: true },
  { key: 'balancedOverLoss', label: 'Rapporto guadagno bilanciato / perdita max', pct: false },
  { key: 'meanOverLoss', label: 'Rapporto guadagno medio / perdita max', pct: false },
  { key: 'riskAdj', label: 'Guadagno corretto per il rischio 5a', pct: true },
  { key: 'ratioFinal', label: 'Rapporto perdita finale/guadagno', pct: false },
  { key: 'finalLoss', label: 'Perdita finale 5a (caso sfavorevole)', pct: true },
  { key: 'ratioMedian', label: 'Rapporto drawdown mediano/guadagno', pct: false },
  { key: 'netGain', label: 'Guadagno mediano 5a', pct: true },
  { key: 'netMean', label: 'Guadagno medio 5a', pct: true },
  { key: 'maxLoss', label: 'Perdita massima 5a', pct: true },
  { key: 'mddMedian', label: 'Drawdown mediano 5a', pct: true },
  { key: 'netP25', label: 'Guadagno probabile 5a (75% degli scenari)', pct: true },
  { key: 'probLoss', label: 'Probabilità di perdita', pct: true },
  { key: 'prob10', label: 'Probabilità netto ≥ +10%', pct: true },
  { key: 'prob25', label: 'Probabilità netto ≥ +25%', pct: true },
  { key: 'prob50', label: 'Probabilità netto ≥ +50%', pct: true },
  { key: 'expected', label: 'Rendimento atteso annuo', pct: true },
  { key: 'expected5', label: 'Rendimento atteso a 5 anni (lordo)', pct: true },
  { key: 'growthExp', label: 'Crescita utili attesa (annua)', pct: true },
  { key: 'growth', label: 'Crescita prossimo anno (selezione 🚀)', pct: true },
  { key: 'perfW', label: 'Rend. netto ultima settimana', pct: true },
  { key: 'perfM', label: 'Rend. netto ultimo mese', pct: true },
  { key: 'perfYtd', label: 'Rend. netto da inizio anno (YTD)', pct: true },
  { key: 'change', label: 'Var. oggi', pct: true },
  { key: 'varM', label: 'Var. 1 mese', pct: true },
  { key: 'varM3', label: 'Var. 3 mesi', pct: true },
  { key: 'varY', label: 'Var. 1 anno', pct: true },
  { key: 'price', label: 'Prezzo (€)', pct: false },
];

export const PRESETS = [
  { label: 'Netto 019 − MDD > 10%', filters: { proj: { min: 10 } } },
  { label: 'CAGR atteso > 8%', filters: { cagr: { min: 8 } } },
  { label: 'NR5 > 20%', filters: { overall: { min: 20 } } },
  { label: 'Sortino > 1', filters: { sortino: { min: 1 } } },
  { label: 'Rapporto < 1', filters: { ratio: { max: 1 } } },
  { label: 'Rapporto < 2', filters: { ratio: { max: 2 } } },
  { label: 'Guadagno bilanciato > 15%', filters: { balanced: { min: 15 } } },
  { label: 'Guad. bilanciato / perdita max > 0,5', filters: { balancedOverLoss: { min: 0.5 } } },
  { label: 'Guad. medio / perdita max > 0,7', filters: { meanOverLoss: { min: 0.7 } } },
  { label: 'Guadagno corretto rischio > 10%', filters: { riskAdj: { min: 10 } } },
  { label: 'Rapporto perdita finale < 1', filters: { ratioFinal: { max: 1 } } },
  { label: 'Rapporto DD mediano < 1', filters: { ratioMedian: { max: 1 } } },
  { label: 'Guadagno mediano > 0', filters: { netGain: { min: 0 } } },
  { label: 'Perdita max < 50%', filters: { maxLoss: { max: 50 } } },
  { label: 'P(perdita) < 25%', filters: { probLoss: { max: 25 } } },
  { label: 'Guadagno probabile > 0', filters: { netP25: { min: 0 } } },
  { label: 'P(≥ +25%) > 60%', filters: { prob25: { min: 60 } } },
  { label: 'P(≥ +50%) > 30%', filters: { prob50: { min: 30 } } },
];

export function parseNum(v) {
  if (v == null) return null;
  const s = String(v).trim().replace('%', '').replace(',', '.');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Elenco dei filtri effettivamente impostati: [{ key, min, max }] (min/max già nell'unità dei dati). */
export function activeFilters(filters = {}) {
  const out = [];
  for (const ind of INDICATORS) {
    const f = filters[ind.key];
    if (!f) continue;
    const scale = ind.pct ? 100 : 1;
    const min = parseNum(f.min);
    const max = parseNum(f.max);
    if (min == null && max == null) continue;
    out.push({ key: ind.key, min: min == null ? null : min / scale, max: max == null ? null : max / scale });
  }
  return out;
}

/** true se la riga rispetta tutti i filtri; un indicatore mancante non passa il filtro. */
export function passes(row, active) {
  for (const { key, min, max } of active) {
    const v = row[key];
    if (v == null || Number.isNaN(v)) return false;
    if (min != null && !(v >= min)) return false;
    if (max != null && !(v <= max)) return false;
  }
  return true;
}
