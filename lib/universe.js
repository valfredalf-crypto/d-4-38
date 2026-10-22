// Selezione dell'universo pubblicato: i migliori N strumenti per gruppo secondo il guadagno netto previsto.

// Prodotti a leva/short: rendimenti attesi gonfiati dalla leva e non adatti a un orizzonte di 5 anni.
// "Short" da solo indica un ETF short, ma "Short Duration/Term/Maturity" sono normali ETF obbligazionari.
const LEVERAGED = /\b(LEV(ERAGED)?|[2-5] ?X|X ?[2-5]|SHORT(?!\s*(DURATION|DUR|TERM|MATURITY|DATED|-TERM))|INVERSE|BEAR|BULL|ULTRA)\b|-[2-5]X\b/i;

export function isLeveraged(name) {
  return LEVERAGED.test(String(name || ''));
}

/** Unisce liste di strumenti eliminando i doppioni per simbolo e per ISIN (vince il primo). */
export function mergeUnique(...lists) {
  const symbols = new Set();
  const isins = new Set();
  const out = [];
  for (const list of lists) {
    for (const i of list) {
      if (!i?.symbol || symbols.has(i.symbol) || (i.isin && isins.has(i.isin))) continue;
      symbols.add(i.symbol);
      if (i.isin) isins.add(i.isin);
      out.push(i);
    }
  }
  return out;
}

/**
 * rows: [{ inst, netGain }] — tiene i migliori `perGroup` per tipo (netGain decrescente),
 * scartando chi non ha una previsione valida.
 */
export function selectTop(rows, perGroup) {
  const groups = {};
  for (const r of rows) {
    if (r.netGain == null || !Number.isFinite(r.netGain)) continue;
    (groups[r.inst.type] ||= []).push(r);
  }
  const out = [];
  for (const list of Object.values(groups)) {
    list.sort((a, b) => b.netGain - a.netGain);
    out.push(...list.slice(0, perGroup));
  }
  return out;
}
