// Filtri sugli indicatori (min/max). I valori percentuali si inseriscono in punti percentuali
// (es. 40 = 40%); la perdita massima si indica come numero positivo (40 = perdita fino al 40%).
export const INDICATORS = [
  { key: 'ratio', label: 'Rapporto perdita/guadagno', pct: false },
  { key: 'netGain', label: 'Guadagno mediano 5a', pct: true },
  { key: 'netMean', label: 'Guadagno medio 5a', pct: true },
  { key: 'maxLoss', label: 'Perdita massima 5a', pct: true },
  { key: 'probLoss', label: 'Probabilità di perdita', pct: true },
  { key: 'expected', label: 'Rendimento atteso annuo', pct: true },
  { key: 'growth', label: 'Crescita attesa (analisti)', pct: true },
  { key: 'change', label: 'Variazione oggi', pct: true },
  { key: 'price', label: 'Prezzo (€)', pct: false },
];

export const PRESETS = [
  { label: 'Rapporto < 1', filters: { ratio: { max: 1 } } },
  { label: 'Rapporto < 2', filters: { ratio: { max: 2 } } },
  { label: 'Guadagno mediano > 0', filters: { netGain: { min: 0 } } },
  { label: 'Perdita max < 50%', filters: { maxLoss: { max: 50 } } },
  { label: 'P(perdita) < 25%', filters: { probLoss: { max: 25 } } },
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
