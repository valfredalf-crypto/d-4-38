// «Imbuto» degli ETF globali: 4 regole in sequenza; chi non ne supera una è bocciato.
// 1) Purezza: solo indici globali di mercato (World, All-World, ACWI), senza filtri artificiali
//    (Value, Quality, Momentum, Min Volatility, High Dividend, Screened, SRI/ESG, Equal Weight…).
// 2) Tasse: solo ad accumulazione (i dividendi distribuiti sono tassati al 26% ogni anno).
// 3) Dimensioni: patrimonio ≥ 1 miliardo di euro (sotto i 500 milioni rischio chiusura e spread alti).
// 4) Costo: TER ≤ 0,25% annuo.
export const FUNNEL_RULES = [
  { key: 'purity', label: 'Purezza (indice globale puro)' },
  { key: 'acc', label: 'Tasse (accumulazione)' },
  { key: 'size', label: 'Dimensioni (patrimonio ≥ 1 mld €)' },
  { key: 'cost', label: 'Costo (TER ≤ 0,25%)' },
];
const GLOBAL_RE = /\b(world|all[- ]world|acwi|all[- ]country[- ]world|global all[- ]cap)\b/i;
const IMPURE_RE = /\b(value|quality|momentum|min(imum)?[- ]?vol(atility)?|low[- ]vol(atility)?|high[- ]div(idend)?|dividend|div\b|income|screened|sri|esg|socially|responsible|sustainab\w*|climate|paris|net[- ]zero|transition|equal[- ]weight\w*|factor|multi[- ]?factor|defensive|enhanced|select|leaders|islamic|shariah|catholic|small[- ]cap|mid[- ]cap|ex[- ]\w+|financials?|information technology|tech\w*|health\s?care|energy|utilities|materials|industrials|consumer|real estate|telecom\w*|communication|infrastructure|water|clean|robotics|ai\b|hedged?|leveraged|short|covered call|buffer|active|gender|governance)\b/i;
export function purityOk(name) {
  const n = name || '';
  return GLOBAL_RE.test(n) && !IMPURE_RE.test(n);
}
// Conversione approssimativa in euro del patrimonio (basta per una soglia di 1 miliardo)
const TO_EUR = { EUR: 1, USD: 0.9, GBP: 1.15, CHF: 1.05 };
export function aumEur(fund) {
  const a = fund?.aum;
  if (!a || !Number.isFinite(a.value)) return null;
  const k = TO_EUR[a.currency] ?? null;
  return k == null ? null : a.value * k;
}
/** Esito dell'imbuto: { pass, failed: chiave della prima regola non superata, reason }. */
export function funnelCheck(inst, fund, distKind) {
  if (inst?.type !== 'etf') return { pass: false, failed: 'purity', reason: 'non è un ETF' };
  if (!purityOk(inst.name)) return { pass: false, failed: 'purity', reason: 'non è un indice globale puro (filtri/stili/settori/ESG)' };
  if (distKind !== 'acc') return { pass: false, failed: 'acc', reason: 'a distribuzione: dividendi tassati ogni anno' };
  const aum = aumEur(fund);
  if (aum == null) return { pass: false, failed: 'size', reason: 'patrimonio non disponibile' };
  if (aum < 1e9) return { pass: false, failed: 'size', reason: `patrimonio ${(aum / 1e6).toFixed(0)} mln € (< 1 mld)` };
  const ter = fund?.ter;
  if (!Number.isFinite(ter)) return { pass: false, failed: 'cost', reason: 'TER non disponibile' };
  if (ter > 0.0025) return { pass: false, failed: 'cost', reason: `TER ${(ter * 100).toFixed(2)}% (> 0,25%)` };
  return { pass: true, failed: null, reason: `patrimonio ${(aum / 1e9).toFixed(1)} mld €, TER ${(ter * 100).toFixed(2)}%` };
}

// ---------- Algoritmo «Max Growth Score» (ETF)
// Fase 1: scarta distribuzione, patrimonio < 500 mln €, TER > 0,30% (dati mancanti: non si scarta).
export function phase1Check(inst, fund, distKind) {
  if (inst?.type !== 'etf') return { pass: true };
  if (distKind === 'dist') return { pass: false, reason: 'a distribuzione: le tasse frenano l’interesse composto' };
  const aum = aumEur(fund);
  if (aum != null && aum < 500e6) return { pass: false, reason: `patrimonio ${(aum / 1e6).toFixed(0)} mln € (< 500 mln): rischio chiusura` };
  if (Number.isFinite(fund?.ter) && fund.ter > 0.003) return { pass: false, reason: `TER ${(fund.ter * 100).toFixed(2)}% (> 0,30%)` };
  return { pass: true };
}
const SECTOR_RE = /\b(financials?|banks?|insurance|information technology|technology|tech|semiconductors?|health\s?care|healthcare|biotech\w*|pharma\w*|energy|oil|gas|utilities|materials|mining|miners|industrials|consumer (discretionary|staples)|real estate|reit|telecom\w*|communication services?|media|infrastructure|clean|water|robotics|cyber\w*|artificial intelligence|ai\b|blockchain|defen[cs]e|aerospace|gold|silver)\b/i;
const STAGNATION_RE = /\b(value|high[- ]div(idend)?|min(imum)?[- ]?vol(atility)?)\b/i;
/**
 * Max Growth Score (rendimento annuo corretto):
 * - base = ½ CAGR storico 5 anni (prezzo dell'ETF, già al netto di TER e tracking difference)
 *        + ½ rendimento atteso dal modello meno il TER (prospettive di crescita degli utili, valutazioni
 *          e dati di mercato attuali delle partecipazioni);
 * - −15% della base per Value / High Dividend / Minimum Volatility;
 * - +0,5% per gli indici globali ponderati per capitalizzazione (World, All-World, ACWI);
 * - − volatilità² (rischio: a parità di rendimento vince chi oscilla meno; un ETF tech al 25% di
 *   volatilità perde ~6 punti, l'MSCI World al 13% meno di 2);
 * - − concentrazione: 0,1 × (peso dei primi 10 titoli − 30%) all'anno, almeno 3% per gli ETF di un solo settore.
 */
export function maxGrowthScore(inst, sim, fwd = null, ter = null) {
  if (inst?.type !== 'etf' || !Number.isFinite(sim?.cagrHist)) return null;
  const hist = sim.cagrHist;
  const exp = Number.isFinite(fwd?.expected) ? fwd.expected - (Number.isFinite(ter) ? ter : 0.002) : null;
  // Storico anomalo o eccezionale (oltre 8 punti l'anno sopra le prospettive del fondo: prezzi errati, cambi di
  // valuta nella serie o un rally irripetibile): non è credibile per il futuro, si usano solo le prospettive
  const anomalous = exp != null && hist - exp > 0.08;
  const base = exp != null ? (anomalous ? exp : 0.5 * hist + 0.5 * exp) : hist;
  const stagnation = STAGNATION_RE.test(inst.name || '') ? Math.abs(base) * 0.15 : 0;
  const boost = purityOk(inst.name) ? 0.005 : 0;
  const vol = Number.isFinite(fwd?.vol) ? fwd.vol : null;
  const risk = vol != null ? vol * vol : 0;
  let conc = Number.isFinite(fwd?.top10) && !fwd.fundOfFunds ? 0.1 * Math.max(0, fwd.top10 - 0.3) : 0;
  // ETF di un solo settore: rischio specifico non diversificabile → almeno 3% l'anno di penalità
  if (SECTOR_RE.test(inst.name || '')) conc = Math.max(conc, 0.03);
  return { score: base - stagnation + boost - risk - conc, hist, anomalous, exp, base, stagnation, boost, risk, vol, conc, years: sim.cagrYears ?? null, cagr10: Number.isFinite(sim.cagr10) ? sim.cagr10 : null };
}
