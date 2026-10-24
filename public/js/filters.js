// Filtri sugli indicatori (min/max). I valori percentuali si inseriscono in punti percentuali
// (es. 40 = 40%); la perdita massima si indica come numero positivo (40 = perdita fino al 40%).
export const INDICATORS = [
  { key: 'ratio', label: 'Rapporto perdita/guadagno', pct: false },
  { key: 'balanced', label: 'Guadagno bilanciato crescita/rischio 5a', pct: true },
  { key: 'riskAdj', label: 'Guadagno corretto per il rischio 5a', pct: true },
  { key: 'riskGain', label: 'Perdite medie / (guadagni medi + crescita attesa)', pct: false },
  { key: 'maxLossGain', label: 'Perdita max / (guadagni medi + crescita attesa)', pct: false },
  { key: 'p25GrowthDD', label: '(Guadagno probabile 75% + crescita) / drawdown mediano', pct: false },
  { key: 'p25GrowthLoss', label: '(Guadagno probabile 75% + crescita) / perdita max', pct: false },
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
  { label: 'Rapporto < 1', filters: { ratio: { max: 1 } } },
  { label: 'Rapporto < 2', filters: { ratio: { max: 2 } } },
  { label: 'Guadagno bilanciato > 15%', filters: { balanced: { min: 15 } } },
  { label: 'Guadagno corretto rischio > 10%', filters: { riskAdj: { min: 10 } } },
  { label: 'Perdite medie / (guadagni + crescita) < 1', filters: { riskGain: { max: 1 } } },
  { label: 'Perdita max / (guadagni + crescita) < 1', filters: { maxLossGain: { max: 1 } } },
  { label: '(Guad. probabile + crescita) / perdita max > 0,5', filters: { p25GrowthLoss: { min: 0.5 } } },
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
