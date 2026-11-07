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
