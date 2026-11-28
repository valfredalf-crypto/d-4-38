// Filtri sugli indicatori (min/max). I valori percentuali si inseriscono in punti percentuali
// (es. 40 = 40%); la perdita massima si indica come numero positivo (40 = perdita fino al 40%).
// Filtri sul «netto più probabile» in euro (sul capitale impostato): periodi e soglie dei pulsanti rapidi.
// «Maggiore di» è stretto: con soglia 0 uno strumento a 0 € esatti non passa.
export const NP_FILTER_PERIODS = [[7, '7 giorni'], [30, '1 mese'], [90, '3 mesi'], [365, '1 anno'], [1095, '3 anni'], [1825, '5 anni']];
export const NP_FILTER_LEVELS = [0, 1000, 2000, 3000];
export const npFilterKey = (days) => 'npEur' + days;
export const SIM_KEY = 'simMed';
// Stessi scenari letti a 1 e 3 anni: [giorni, anni, nome]
export const SIM_MID = [[365, 1, '1 anno'], [1095, 3, '3 anni']];
export const simMidKey = (days) => SIM_KEY + days;
// Mediano degli scenari tolte le perdite attese (media delle perdite su tutti gli scenari), a 1, 3 e 5 anni
export const SIM_ADJ = [[365, '1 anno'], [1095, '3 anni'], [1825, '5 anni']];
export const simAdjKey = (days) => 'simAdj' + days;
export const SIM_ADJ_KEYS = SIM_ADJ.map(([d]) => simAdjKey(d));
// Probabilità di guadagno a 5 anni: quota dei 2.000 scenari che finisce in positivo; soglie dei pulsanti rapidi in punti percentuali
export const SIM_P_KEY = 'simP';
export const SIM_P_LEVELS = [70, 80, 90];
// Probabilità di guadagno a 1 e 3 anni: dal modello delle previsioni (la «P» mostrata sotto il netto più probabile)
export const P_GAIN_PERIODS = [[365, '1 anno'], [1095, '3 anni']];
export const pGainKey = (days) => 'pG' + days;
// Guadagno netto raggiunto o superato nel 90% degli scenari (in euro sul capitale impostato): 1 e 3 anni dal modello
// delle previsioni, 5 anni dai 2.000 scenari simulati. In 1 caso su 10 va peggio di così.
export const p90Key = (days) => 'p90e' + days;
export const SIM_P90_KEY = 'simP90';
export const P90_KEYS = [...P_GAIN_PERIODS.map(([d]) => p90Key(d)), SIM_P90_KEY];
export const P90_LEVELS = [-2000, -1000, 0, 1000];
// Sezione «Analisti e dividendi»: soglie dei pulsanti rapidi (punti percentuali; numero di analisti)
export const AN_KEYS = ['anUp', 'divY'];
// Prezzo attuale, prezzo più probabile al periodo scelto e differenza tra i due
export const PX_KEYS = ['price', 'pxMed', 'pxDiff'];
export const PX_DIFF_LEVELS = [0, 2, 5, 10]; // pulsanti rapidi: differenza di almeno x%
// Prezzo medio e minimo a 52 settimane e a 90 giorni: [chiave del prezzo, chiave della distanza del prezzo attuale, nome]
export const RANGE_COLS = [['avg52', 'dA52', 'Prezzo medio 52 settimane'], ['min52', 'dL52', 'Prezzo minimo 52 settimane'], ['avg90', 'dA90', 'Prezzo medio 90 giorni'], ['min90', 'dL90', 'Prezzo minimo 90 giorni']];
// Differenze in percentuale sul minimo, mostrate come colonne: [chiave, nome, nome breve]
export const SPREAD_COLS = [['pm6Now', 'Prezzo più probabile 6 mesi − prezzo attuale', 'Più prob. 6m−attuale'], ['sA52', 'Prezzo medio − minimo 52 settimane', 'Medio−min 52s'], ['sA90', 'Prezzo medio − minimo 90 giorni', 'Medio−min 90g'], ['pm6L52', 'Prezzo più probabile 6 mesi − minimo 52 settimane', 'Più prob. 6m−min 52s']];
export const PM6_DAYS = 180; // «6 mesi» del prezzo più probabile
export const PM6_LEVELS = [10, 20, 30, 50]; // pulsanti rapidi: almeno x% sopra il minimo a 52 settimane
export const PM6_NOW_LEVELS = [0, 2, 5, 10]; // pulsanti rapidi: prezzo più probabile a 6 mesi almeno x% sopra il prezzo attuale
export const RANGE_KEYS = [...RANGE_COLS.flatMap(([k, d]) => [k, d]), ...SPREAD_COLS.map(([k]) => k)];
// Rischio: guadagno bilanciato crescita/rischio e guadagno corretto per il rischio a 1 e 3 anni (modello delle previsioni)
// e a 5 anni (scenari simulati), perdita nello stress test (mercato −30% × beta) e guadagno netto efficiente
export const RG_PERIODS = [[365, '1 anno'], [1095, '3 anni'], [1825, '5 anni']];
export const balKey = (days) => 'bal' + days;
export const radjKey = (days) => 'radj' + days;
// Asimmetria del rischio: perdita finale nel 5% peggiore ÷ guadagno tipico (mediano); sotto 1 il guadagno tipico supera la perdita sfavorevole
export const asymKey = (days) => 'asym' + days;
export const RISK_KEYS = ['stress', 'effNet', ...RG_PERIODS.map(([d]) => balKey(d)), ...RG_PERIODS.map(([d]) => radjKey(d)), ...RG_PERIODS.map(([d]) => asymKey(d))];
// Sezione «Qualità»: punteggio (0–100), crescita degli utili attesa e rendimento atteso del periodo a 1, 3 e 5 anni
export const erKey = (days) => 'er' + days;
export const QUALITY_KEYS = ['qScore', 'qGrowth', ...RG_PERIODS.map(([d]) => erKey(d))];
// Differenziale delle probabilità (come nella scheda): a 1 e 3 anni «almeno +25%» − «in perdita», a 5 anni «almeno +50%» − «in perdita»
export const pdKey = (days) => 'pd' + days;
export const PD_KEYS = RG_PERIODS.map(([d]) => pdKey(d));
// Filtri con minimo e massimo in cima al pannello: probabilità di perdita e di guadagno netto oltre il 50% (5 anni, scenari simulati)
export const PROB_FILTERS = [['probLoss', 'Perdita'], ['prob50', 'Guadagno > 50%']];
export const AN_UP_LEVELS = [10, 25, 50];
export const AN_N_LEVELS = [3, 5, 10];
export const DIV_LEVELS = [2, 4, 6];

export const INDICATORS = [
  // prezzo attuale, prezzo più probabile al periodo scelto nella barra (1 gg … 5 anni) e differenza tra i due
  { key: 'price', label: 'Prezzo attuale (€)', pct: false },
  { key: 'pxMed', label: 'Prezzo più probabile al periodo scelto (€)', pct: false },
  { key: 'pxDiff', label: 'Differenza: prezzo più probabile rispetto al prezzo attuale (%)', pct: true },
  { key: 'pm6', label: 'Prezzo più probabile a 6 mesi (€)', pct: false },
  { key: 'pm6Now', label: '(Prezzo più probabile a 6 mesi − prezzo attuale) ÷ prezzo attuale (%)', pct: true },
  { key: 'maxGrowth', label: 'Max Growth Score (rendimento annuo del punteggio, %)', pct: true },
  // rischio: gli stessi indicatori della scheda dello strumento
  { key: 'stress', label: 'Perdita in stress test: mercato −30% × beta (numero positivo: 25 = perdita fino al 25%)', pct: true },
  { key: 'plausible', label: 'Guadagno netto efficiente 5a (prudenza scelta)', pct: true },
  { key: balKey(365), label: 'Guadagno bilanciato crescita/rischio a 1 anno', pct: true },
  { key: balKey(1095), label: 'Guadagno bilanciato crescita/rischio a 3 anni', pct: true },
  { key: 'balanced', label: 'Guadagno bilanciato crescita/rischio 5a', pct: true },
  { key: radjKey(365), label: 'Guadagno corretto per il rischio a 1 anno', pct: true },
  { key: radjKey(1095), label: 'Guadagno corretto per il rischio a 3 anni', pct: true },
  { key: 'riskAdj', label: 'Guadagno corretto per il rischio 5a', pct: true },
  { key: asymKey(365), label: 'Asimmetria del rischio a 1 anno: perdita nel 5% peggiore ÷ guadagno tipico (più basso = meglio)', pct: false },
  { key: asymKey(1095), label: 'Asimmetria del rischio a 3 anni: perdita nel 5% peggiore ÷ guadagno tipico (più basso = meglio)', pct: false },
  { key: 'ratioFinal', label: 'Asimmetria del rischio a 5 anni (rapporto perdita finale/guadagno)', pct: false },
  { key: 'qScore', label: 'Punteggio qualità (0–100): crescita, asimmetria del rischio e rendimento atteso a 1, 3 e 5 anni', pct: false },
  { key: erKey(365), label: 'Rendimento atteso a 1 anno (lordo, totale del periodo)', pct: true },
  { key: erKey(1095), label: 'Rendimento atteso a 3 anni (lordo, totale del periodo)', pct: true },
  { key: erKey(1825), label: 'Rendimento atteso a 5 anni dal modello delle previsioni (lordo, totale del periodo)', pct: true },
  { key: pdKey(365), label: 'Differenziale probabilità a 1 anno: almeno +25% − in perdita (punti percentuali)', pct: true },
  { key: pdKey(1095), label: 'Differenziale probabilità a 3 anni: almeno +25% − in perdita (punti percentuali)', pct: true },
  { key: pdKey(1825), label: 'Differenziale probabilità a 5 anni: almeno +50% − in perdita (punti percentuali)', pct: true },
  { key: 'probLoss', label: 'Probabilità di perdita (5 anni)', pct: true },
  { key: 'prob50', label: 'Probabilità di guadagno netto maggiore del 50% (5 anni)', pct: true },
  // prezzo medio e minimo a 52 settimane e a 90 giorni (in euro) e distanza del prezzo attuale da ciascuno (in %)
  { key: 'pm6L52', label: '(Prezzo più probabile a 6 mesi − minimo 52 settimane) ÷ minimo 52 settimane (%)', pct: true },
  { key: 'sA52', label: '(Prezzo medio − minimo) ÷ minimo, 52 settimane (%)', pct: true },
  { key: 'sA90', label: '(Prezzo medio − minimo) ÷ minimo, 90 giorni (%)', pct: true },
  ...RANGE_COLS.flatMap(([k, d, l]) => [{ key: k, label: `${l} (€)`, pct: false }, { key: d, label: `Prezzo attuale rispetto al ${l.replace('Prezzo ', '')} (%)`, pct: true }]),
  ...NP_FILTER_PERIODS.map(([d, l]) => ({ key: npFilterKey(d), label: `Netto più probabile a ${l} (€)`, pct: false, eur: true, strict: true })),
  // Esito mediano dei 2.000 scenari simulati (non la media: pochi scenari estremi la gonfiano), in euro sul capitale impostato
  ...SIM_MID.map(([d, , l]) => ({ key: simMidKey(d), label: `Guadagno netto mediano su 2.000 scenari, ${l} (€)`, pct: false, eur: true, strict: true })),
  { key: SIM_KEY, label: 'Guadagno netto mediano su 2.000 scenari, 5 anni (€)', pct: false, eur: true, strict: true },
  ...SIM_ADJ.map(([d, l]) => ({ key: simAdjKey(d), label: `Netto mediano 2.000 scenari tolte le perdite, ${l} (€)`, pct: false, eur: true, strict: true })),
  ...P_GAIN_PERIODS.map(([d, l]) => ({ key: p90Key(d), label: `Guadagno netto nel 90% degli scenari a ${l} (€)`, pct: false, eur: true, strict: true })),
  { key: SIM_P90_KEY, label: 'Guadagno netto nel 90% degli scenari a 5 anni (€, 2.000 scenari)', pct: false, eur: true, strict: true },
  ...P_GAIN_PERIODS.map(([d, l]) => ({ key: pGainKey(d), label: `Probabilità di guadagno a ${l}`, pct: true })),
  { key: SIM_P_KEY, label: 'Probabilità di guadagno a 5 anni (2.000 scenari)', pct: true },
  { key: 'anUp', label: 'Potenziale secondo gli analisti (prezzo obiettivo a 12 mesi)', pct: true },
  { key: 'anN', label: 'Numero di analisti (solo azioni)', pct: false },
  { key: 'divY', label: 'Rendimento da dividendi (annuo, lordo)', pct: true },
  { key: 'proj', label: 'CAGR netto atteso 5a: netto 019 × (1 − MDD storico)', pct: true },
  { key: 'proj019', label: 'Guadagno finale 5a (CAGR − TER, montante composto, imposta)', pct: true },
  { key: 'projOpt', label: 'Rendimento netto corretto per il rischio (classifica principale)', pct: true },
  { key: 'cagr', label: 'CAGR atteso annuo (modulo 1)', pct: true },
  { key: 'histMdd', label: 'MDD storico (modulo 4)', pct: true },
  { key: 'overall', label: 'Netto Reale 5A (NR5)', pct: true },
  { key: 'es5', label: 'Perdita media nel 5% peggiore degli scenari', pct: true },
  { key: 'sharpe', label: 'Indice di Sharpe', pct: false },
  { key: 'sortino', label: 'Indice di Sortino', pct: false },
  { key: 'growthEvidence', label: 'Crescita confermata dalle evidenze (0–100%)', pct: true },
  { key: 'ratio', label: 'Rapporto perdita/guadagno', pct: false },
  { key: 'balancedOverLoss', label: 'Rapporto guadagno bilanciato / perdita max', pct: false },
  { key: 'meanOverLoss', label: 'Rapporto guadagno medio / perdita max', pct: false },
  { key: 'net019OverLoss', label: 'Rapporto Netto 019 / perdita max 5a', pct: false },
  { key: 'finalLoss', label: 'Perdita finale 5a (caso sfavorevole)', pct: true },
  { key: 'ratioMedian', label: 'Rapporto drawdown mediano/guadagno', pct: false },
  { key: 'netGain', label: 'Guadagno mediano 5a', pct: true },
  { key: 'netMean', label: 'Guadagno medio 5a', pct: true },
  { key: 'maxLoss', label: 'Perdita massima 5a', pct: true },
  { key: 'mddMedian', label: 'Drawdown mediano 5a', pct: true },
  { key: 'netP25', label: 'Guadagno probabile 5a (75% degli scenari)', pct: true },
  { key: 'prob10', label: 'Probabilità netto ≥ +10%', pct: true },
  { key: 'prob25', label: 'Probabilità netto ≥ +25%', pct: true },
  { key: 'expected', label: 'Rendimento atteso (annuo, lordo)', pct: true },
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
  { key: 'aum', label: 'Patrimonio del fondo (milioni di €, solo ETF)', pct: false },
  { key: 'ter', label: 'TER annuo (solo ETF)', pct: true },
];

export const PRESETS = [
  { label: 'CAGR netto atteso > 20%', filters: { proj: { min: 20 } } },
  { label: 'CAGR atteso > 8%', filters: { cagr: { min: 8 } } },
  { label: 'NR5 > 20%', filters: { overall: { min: 20 } } },
  { label: 'Sortino > 1', filters: { sortino: { min: 1 } } },
  { label: 'Rapporto < 1', filters: { ratio: { max: 1 } } },
  { label: 'Rapporto < 2', filters: { ratio: { max: 2 } } },
  { label: 'Guadagno bilanciato > 15%', filters: { balanced: { min: 15 } } },
  { label: 'Guad. bilanciato / perdita max > 0,5', filters: { balancedOverLoss: { min: 0.5 } } },
  { label: 'Guad. medio / perdita max > 0,7', filters: { meanOverLoss: { min: 0.7 } } },
  { label: 'Netto 019 / perdita max > 0,5', filters: { net019OverLoss: { min: 0.5 } } },
  { label: 'Guadagno corretto rischio > 10%', filters: { riskAdj: { min: 10 } } },
  { label: 'Rapporto perdita finale < 1', filters: { ratioFinal: { max: 1 } } },
  { label: 'Rapporto DD mediano < 1', filters: { ratioMedian: { max: 1 } } },
  { label: 'Guadagno mediano > 0', filters: { netGain: { min: 0 } } },
  { label: 'Perdita max < 50%', filters: { maxLoss: { max: 50 } } },
  { label: 'P(perdita) < 25%', filters: { probLoss: { max: 25 } } },
  { label: 'Guadagno probabile > 0', filters: { netP25: { min: 0 } } },
  { label: 'TER ≤ 0,30%', filters: { ter: { max: 0.3 } } },
  { label: 'Patrimonio ≥ 500 mln €', filters: { aum: { min: 500 } } },
  { label: 'Patrimonio ≥ 1 mld € e TER ≤ 0,25%', filters: { aum: { min: 1000 }, ter: { max: 0.25 } } },
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

/** Elenco dei filtri effettivamente impostati: [{ key, min, max }] (min/max già nell'unità dei dati; strict = minimo escluso). */
export function activeFilters(filters = {}) {
  const out = [];
  for (const ind of INDICATORS) {
    const f = filters[ind.key];
    if (!f) continue;
    const scale = ind.pct ? 100 : 1;
    const min = parseNum(f.min);
    const max = parseNum(f.max);
    if (min == null && max == null) continue;
    out.push({ key: ind.key, min: min == null ? null : min / scale, max: max == null ? null : max / scale, ...(ind.strict ? { strict: true } : {}) });
  }
  return out;
}

/** true se la riga rispetta tutti i filtri; un indicatore mancante non passa il filtro. */
export function passes(row, active) {
  for (const { key, min, max, strict } of active) {
    const v = row[key];
    if (v == null || Number.isNaN(v)) return false;
    if (min != null && !(strict ? v > min : v >= min)) return false;
    if (max != null && !(v <= max)) return false;
  }
  return true;
}
