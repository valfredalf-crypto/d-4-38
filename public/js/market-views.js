// Previsioni di mercato VERIFICATE per sottostante (fonte e data), usate negli orizzonti brevi (7-90 giorni) al posto della
// sola estrapolazione del trend o del modello di lungo periodo. Per le materie prime il modello non ha dati degli analisti:
// qui si registrano le previsioni attuali e attendibili. Scadono dopo `validDays` dalla data `asOf` (poi regola automatica).
// Aggiornare: price = prezzo alla data, target = previsione per targetDate (stessa valuta), fonti e nota.
export const MARKET_VIEWS = {
  silver: {
    asOf: '2026-11-20',
    price: 41.19,
    target: 40.19,
    targetDate: '2026-12-31',
    currency: 'USD',
    validDays: 45,
    source: 'Trading Economics, modelli e aspettative degli analisti (20/11/2026)',
    note: 'Argento −29% in un mese, minimo da oltre un anno; outlook recenti ribassisti (DailyForex, FXStreet, Kitco). Target delle banche di fine anno (UBS 70, Commerzbank 67, BofA 55) precedenti al calo: non considerati.',
  },
  oil: {
    asOf: '2026-11-20',
    price: 92.57,
    target: 94.45,
    targetDate: '2026-12-31',
    currency: 'USD',
    validDays: 45,
    source: 'Trading Economics, Brent (20/11/2026)',
    note: 'Westpac (novembre 2026): Brent intorno a 101 $ in media nel Q4. Oro, platino, palladio, rame e gas: nessuna previsione attuale affidabile trovata il 22/11/2026 (solo dati di settembre o sondaggi): non inserite.',
  },
};

// Previsioni per SINGOLO STRUMENTO (ISIN), quando il sottostante non ha previsioni affidabili ma lo strumento stesso ha un
// comportamento misurato nello scenario attuale. `returns`: rendimento medio del prodotto a 7/14/30/60 giorni.
export const PRODUCT_VIEWS = {
  XS2819843736: {
    asOf: '2026-11-20',
    validDays: 30,
    returns: { 7: -0.116, 14: -0.178, 30: -0.277, 60: -0.475 },
    median: { 7: -0.08, 14: -0.26, 30: -0.24, 60: -0.525 },
    source: 'comportamento reale dello strumento dopo i picchi del VIX tra 30 e 45 (11 episodi 2021-2026); VIX 35,9 il 20/11/2026, future in backwardation',
    note: 'Dopo i picchi il VIX rientra quasi sempre (21 episodi in 10 anni: −21% mediana a 14 gg, −33% a 60 gg). Rischio opposto: se la crisi si aggrava il prodotto può salire molto (+38% a 7 gg nel caso migliore).',
  },
};
/** Previsione di prodotto valida (null se assente o scaduta); `annual` = crescita annua equivalente dal valore a 30 giorni. */
export function productViewFor(isin, now = Date.now()) {
  const v = isin && PRODUCT_VIEWS[isin];
  if (!v) return null;
  const asOf = Date.parse(v.asOf);
  if (!Number.isFinite(asOf) || (now - asOf) / 864e5 > (v.validDays ?? 30)) return null;
  const r30 = v.returns[30];
  return { ...v, annual: (1 + r30) ** (365 / 30) - 1 };
}

/** Previsione valida per il sottostante `key` (null se assente o scaduta): crescita composta annua prevista e variazione attesa. */
export function viewFor(key, now = Date.now()) {
  const v = MARKET_VIEWS[key];
  if (!v) return null;
  const asOf = Date.parse(v.asOf);
  if (!Number.isFinite(asOf) || (now - asOf) / 864e5 > (v.validDays ?? 45)) return null;
  const years = (Date.parse(v.targetDate) - asOf) / (365 * 864e5);
  if (!(years > 0) || !(v.price > 0) || !(v.target > 0)) return null;
  return { ...v, years, geo: Math.log(v.target / v.price) / years, move: v.target / v.price - 1 };
}
