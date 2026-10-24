import test from 'node:test';
import assert from 'node:assert/strict';
import { forwardParams, estimateBeta, ewmaVol, BASE_OUTLOOK, holdingsFundamentals } from '../public/js/outlook.js';
// I test usano i parametri predefiniti, indipendenti dalla taratura settimanale.
const B = { ...BASE_OUTLOOK };
import { mulberry32 } from '../public/js/montecarlo.js';

const WEEK = 7 * 86400;
function series(n, seed, scale = 1, base = null) {
  const r = mulberry32(seed);
  const ts = [];
  const p = [100];
  const rets = [];
  for (let i = 0; i < n; i++) {
    ts.push(1_500_000_000 + i * WEEK);
    if (i) {
      const z = (r() - 0.5) * 0.06;
      const x = base ? base[i - 1] * scale + z * 0.3 : z;
      rets.push(x);
      p.push(p[i - 1] * Math.exp(x));
    }
  }
  return { ts, p, rets };
}

test('beta: serie = 1.5 × benchmark + rumore', () => {
  const b = series(400, 1);
  const a = series(400, 2, 1.5, b.rets);
  const beta = estimateBeta(a.ts, a.p, b.ts, b.p, 5);
  assert.ok(Math.abs(beta.raw - 1.5) < 0.1, String(beta.raw));
  assert.ok(Math.abs(beta.adjusted - (0.67 * beta.raw + 0.33)) < 1e-12);
});

test('EWMA reagisce al regime recente', () => {
  const calm = Array.from({ length: 300 }, (_, i) => (i % 2 ? 0.01 : -0.01));
  const stormy = [...calm, ...Array.from({ length: 30 }, (_, i) => (i % 2 ? 0.06 : -0.06))];
  assert.ok(ewmaVol(stormy, 0.97) > ewmaVol(calm, 0.97) * 2);
});

test('modello prospettico: pesi, analisti e coerenza log/aritmetico', () => {
  const b = series(520, 1);
  const a = series(520, 2, 1.0, b.rets);
  const base = { type: 'stock', timestamps: a.ts, prices: a.p, benchmark: { timestamps: b.ts, closesEur: b.p }, years: 5, lookbackYears: 10 };
  const noAnalysts = forwardParams(base, B);
  assert.equal(noAnalysts.components.analysts, null);
  assert.ok(Math.abs(noAnalysts.weights.history + noAnalysts.weights.equilibrium - 1) < 1e-12);
  assert.ok(Math.abs(Math.log(1 + noAnalysts.expected) - noAnalysts.vol ** 2 / 2 - noAnalysts.drift) < 1e-12);

  const bullish = forwardParams({ ...base, fundamentals: { price: 100, targetMean: 130, analysts: 20, dividendYield: 0.02 } }, B);
  const bearish = forwardParams({ ...base, fundamentals: { price: 100, targetMean: 80, analysts: 20 } }, B);
  assert.ok(bullish.expected > bearish.expected);
  // year1 = 30%×0.5 + 2% = 17%, poi equilibrio per 4 anni
  const eq = bullish.components.equilibrium;
  assert.ok(Math.abs(bullish.components.analysts - (0.17 + 4 * eq) / 5) < 1e-12);
  // pochi analisti → ignorati
  const few = forwardParams({ ...base, fundamentals: { price: 100, targetMean: 200, analysts: 1 } }, B);
  assert.equal(few.components.analysts, null);
});

test('crypto: equilibrio = risk-free + premio crypto', () => {
  const a = series(300, 5);
  const f = forwardParams({ type: 'crypto', timestamps: a.ts, prices: a.p, years: 5, lookbackYears: 10 }, { ...B, riskFree: 2, cryptoPremium: 3 });
  assert.ok(Math.abs(f.components.equilibrium - 0.05) < 1e-12);
});

test('modalità solo storico', () => {
  const a = series(300, 5);
  const f = forwardParams({ type: 'etf', timestamps: a.ts, prices: a.p, years: 5, lookbackYears: 10 }, { ...B, mode: 'historical' });
  assert.equal(f.mode, 'historical');
  assert.deepEqual(Object.keys(f.components), ['history']);
});

test('shrinkage: lo storico di uno strumento molto volatile pesa poco', () => {
  const mk = (vol, drift) => {
    const ts = [];
    const p = [100];
    for (let i = 0; i < 521; i++) {
      ts.push(1_500_000_000 + i * WEEK);
      if (i) p.push(p[i - 1] * Math.exp(drift / 52 + (i % 2 ? 1 : -1) * vol / Math.sqrt(52)));
    }
    return { ts, p };
  };
  const calm = mk(0.15, 0.08);
  const wild = mk(0.8, 0.8);
  const fc = forwardParams({ type: 'etf', timestamps: calm.ts, prices: calm.p, years: 5, lookbackYears: 10 }, B);
  const fw = forwardParams({ type: 'crypto', timestamps: wild.ts, prices: wild.p, years: 5, lookbackYears: 10 }, B);
  // 10 anni, volatilità 15%: σ²/T + regime² = 0,00225 + 0,0016 → credibilità ≈ 0,39 (incertezza equilibrio 5%)
  assert.ok(fc.credibility > 0.3 && fc.credibility < 0.5, String(fc.credibility));
  assert.ok(fw.credibility < 0.06, String(fw.credibility));
  assert.ok(fw.components.history < fw.historyRaw);
  const eq = fw.components.equilibrium;
  // storico creduto in proporzione alla credibilità (con il limite di Sharpe sul valore grezzo)
  assert.ok(fw.components.history <= eq + fw.credibility * (fw.historyRaw - eq) + 1e-12);
  assert.ok(fw.components.history >= Math.min(eq, fw.historyRaw) - 1e-12);
});

test('beta: media con quello di Yahoo e minimo 0,5 per le azioni', () => {
  const b = series(400, 1);
  const flat = series(400, 9); // indipendente dal benchmark → beta ≈ 0
  const base = { timestamps: flat.ts, prices: flat.p, benchmark: { timestamps: b.ts, closesEur: b.p }, years: 5, lookbackYears: 10 };
  const stock = forwardParams({ ...base, type: 'stock' }, B);
  assert.ok(Math.abs(stock.beta - 0.5) < 1e-12, String(stock.beta));
  const etf = forwardParams({ ...base, type: 'etf' }, B);
  assert.ok(etf.beta < 0.2); // ETF: niente Blume né minimo (obbligazionari, monetari, oro hanno davvero beta basso)
  const withYahoo = forwardParams({ ...base, type: 'stock', fundamentals: { beta: 1.2 } }, B);
  assert.ok(Math.abs(withYahoo.betaRaw - (estimateBeta(flat.ts, flat.p, b.ts, b.p, 5).raw + 1.2) / 2) < 1e-12);
});

test('storico breve: credibilità ridotta (un solo regime di mercato non si proietta)', () => {
  const mk = (weeks, drift) => {
    const ts = [];
    const p = [100];
    for (let i = 0; i < weeks; i++) {
      ts.push(1_500_000_000 + i * WEEK);
      if (i) p.push(p[i - 1] * Math.exp(drift / 52 + (i % 2 ? 1 : -1) * 0.1 / Math.sqrt(52)));
    }
    return { ts, p };
  };
  const long = mk(521, 0.15);
  const short = mk(157, 0.15); // 3 anni con +15% annuo
  const fl = forwardParams({ type: 'etf', timestamps: long.ts, prices: long.p, years: 5, lookbackYears: 10 }, B);
  const fs = forwardParams({ type: 'etf', timestamps: short.ts, prices: short.p, years: 5, lookbackYears: 10 }, B);
  assert.ok(fs.credibility < fl.credibility * 0.7, `${fs.credibility} vs ${fl.credibility}`);
  assert.ok(fs.credibility < 0.3, String(fs.credibility));
  assert.ok(Math.abs(fs.historyYears - 3) < 0.05);
});

test('crescita e valutazione (Grinold-Kroner)', async () => {
  const { fundamentalsReturn } = await import('../public/js/outlook.js');
  // Titolo caro con forte crescita (tipo Eli Lilly): P/E 35, crescita attesa 25%, dividendo 0,6%
  const lly = fundamentalsReturn({ forwardPE: 35, growthLongTerm: 0.25, dividendYield: 0.006, analysts: 20 }, B, 5);
  assert.ok(Math.abs(lly.growth - (0.04 + 0.6 * 0.21 + 0.04) / 2) < 1e-12, 'senza conferme: haircut pieno e rallentamento lineare');
  // Stessa stima ma confermata da ricavi realizzati e attesi e utili attesi: si crede di più
  const confirmed = fundamentalsReturn({ forwardPE: 35, growthLongTerm: 0.25, dividendYield: 0.006, analysts: 20, revenueGrowthTtm: 0.3, revenueGrowthNext: 0.2, epsGrowthNext: 0.3 }, B, 5);
  assert.ok(confirmed.evidence === 1 && confirmed.growth > lly.growth * 1.3, `${confirmed.growth} vs ${lly.growth}`);
  // Stima smentita dai ricavi (in calo): nessuna conferma
  const denied = fundamentalsReturn({ forwardPE: 35, growthLongTerm: 0.25, dividendYield: 0.006, analysts: 20, revenueGrowthTtm: -0.05 }, B, 5);
  assert.ok(denied.growth < confirmed.growth);
  assert.ok(lly.valuation < 0); // il P/E tende a scendere verso 18
  assert.ok(lly.expected > 0.03 && lly.expected < 0.08, String(lly.expected));
  // Titolo a sconto con crescita modesta: la valutazione aiuta
  const cheap = fundamentalsReturn({ forwardPE: 9, epsGrowthNext: 0.05, dividendYield: 0.04, analysts: 10 }, B, 5);
  assert.ok(cheap.valuation > 0 && cheap.expected > 0.09, String(cheap.expected));
  // Dati insufficienti
  assert.equal(fundamentalsReturn({ forwardPE: 20, analysts: 10 }, B), null);
  assert.equal(fundamentalsReturn({ forwardPE: 20, growthLongTerm: 0.1, analysts: 1 }, B), null);
});

test('prospettive di crescita per tutti: ETF e azioni senza stime usano il mercato × beta', async () => {
  const { marketFundamentals } = await import('../public/js/outlook.js');
  const list = Array.from({ length: 30 }, (_, k) => ({ forwardPE: 18, growthLongTerm: 0.08, dividendYield: 0.02, analysts: 10, marketCap: 1e9 * (k + 1) }));
  const m = marketFundamentals(list, B);
  assert.ok(m && m.n === 30 && m.expected > 0.05 && m.expected < 0.1, JSON.stringify(m));
  const b = series(400, 1);
  const etf = series(400, 2, 1.0, b.rets);
  const f = forwardParams({ type: 'etf', timestamps: etf.ts, prices: etf.p, benchmark: { timestamps: b.ts, closesEur: b.p }, market: m.expected, years: 5, lookbackYears: 10 }, B);
  assert.equal(f.fundamentalsDetail.source, 'market');
  assert.ok(Math.abs(f.components.fundamentals - (0.02 + f.beta * (m.expected - 0.02))) < 1e-12);
  const crypto = forwardParams({ type: 'crypto', timestamps: etf.ts, prices: etf.p, market: m.expected, years: 5, lookbackYears: 10 }, B);
  assert.equal(crypto.components.fundamentals, null);
});

test('limite di Sharpe: un monetario non può "rendere" il 10% annuo', () => {
  const ts = [];
  const p = [100];
  for (let i = 0; i < 521; i++) {
    ts.push(1_500_000_000 + i * WEEK);
    if (i) p.push(p[i - 1] * Math.exp(0.1 / 52 + (i % 2 ? 1 : -1) * 0.002)); // +10%/anno con volatilità ~1,4%
  }
  const bench = series(521, 1); // indice indipendente → beta ≈ 0, equilibrio ≈ tasso privo di rischio
  const f = forwardParams({ type: 'etf', timestamps: ts, prices: p, benchmark: { timestamps: bench.ts, closesEur: bench.p }, years: 5, lookbackYears: 10 }, B);
  assert.ok(f.historyRaw > 0.09);
  assert.ok(f.beta < 0.1, String(f.beta));
  assert.ok(f.components.history < 0.04, String(f.components.history));
  assert.ok(f.expected < 0.04, String(f.expected));
});

test('beta limitato da volatilità: uno strumento quasi fermo senza beta stimabile non ha beta 1', () => {
  const ts = [];
  const p = [100];
  for (let i = 0; i < 80; i++) {
    ts.push(1_500_000_000 + i * WEEK);
    if (i) p.push(p[i - 1] * Math.exp(0.03 / 52 + (i % 2 ? 1 : -1) * 0.0007));
  }
  // nessun benchmark → beta non stimabile; prima si assumeva 1
  const f = forwardParams({ type: 'etf', timestamps: ts, prices: p, years: 5, lookbackYears: 10 }, B);
  assert.ok(f.beta < 0.05, String(f.beta));
  assert.ok(f.expected < 0.03, String(f.expected));
});

test('crescita utili attesa: propria, del mercato × beta, n.d. per non azionari', async () => {
  const b = series(400, 1);
  const etf = series(400, 2, 1.0, b.rets);
  const eq = forwardParams({ type: 'etf', timestamps: etf.ts, prices: etf.p, benchmark: { timestamps: b.ts, closesEur: b.p }, market: 0.076, marketGrowth: 0.08, years: 5, lookbackYears: 10 }, B);
  assert.equal(eq.growthSource, 'market');
  assert.ok(Math.abs(eq.expectedGrowth - 0.08 * eq.beta) < 1e-12);
  const bond = series(400, 7); // indipendente dal mercato → beta ≈ 0
  const bf = forwardParams({ type: 'etf', timestamps: bond.ts, prices: bond.p, benchmark: { timestamps: b.ts, closesEur: b.p }, market: 0.076, marketGrowth: 0.08, years: 5, lookbackYears: 10 }, B);
  assert.equal(bf.expectedGrowth, null);
  const own = forwardParams({ type: 'stock', timestamps: etf.ts, prices: etf.p, fundamentals: { forwardPE: 25, growthLongTerm: 0.2, analysts: 10 }, years: 5, lookbackYears: 10 }, B);
  assert.equal(own.growthSource, 'own');
  assert.ok(own.expectedGrowth > 0.04 && own.expectedGrowth < 0.2);
});

test('holdingsFundamentals: crescita dalle partecipazioni, resto dal mercato, null con copertura scarsa', () => {
  const fast = { forwardPE: 30, analysts: 20, growthLongTerm: 0.25, dividendYield: 0 };
  const slow = { forwardPE: 12, analysts: 20, growthLongTerm: 0.03, dividendYield: 0.03 };
  const mk = (f, w) => ({ holdings: [{ symbol: 'A', weight: w, fundamentals: f }], stockPosition: 1, pe: 20, dividendYield: 0.015 });
  const hi = holdingsFundamentals(mk(fast, 0.6), {}, 0.07, 0.06);
  const lo = holdingsFundamentals(mk(slow, 0.6), {}, 0.07, 0.06);
  assert.equal(hi.source, 'holdings');
  assert.ok(hi.growth > lo.growth, 'partecipazioni in forte crescita → crescita attesa maggiore');
  assert.ok(Math.abs(hi.coverage - 0.6) < 1e-9);
  assert.equal(holdingsFundamentals(mk(fast, 0.05), {}, 0.07, 0.06), null);
  assert.equal(holdingsFundamentals({ ...mk(fast, 0.6), stockPosition: 0.2 }, {}, 0.07, 0.06), null, 'fondo obbligazionario');
});

test('stime inaffidabili scartate: micro-cap, dividendo straordinario, balzo utili senza ricavi', async () => {
  const { fundamentalsReturn, cleanDividend } = await import('../public/js/outlook.js');
  assert.equal(cleanDividend(0.38), 0);
  assert.equal(cleanDividend(0.05), 0.05);
  const base = { forwardPE: 14, analysts: 5, epsGrowthNext: 1.18, dividendYield: 0.03 };
  assert.equal(fundamentalsReturn({ ...base, marketCap: 49e6 }), null, 'micro-cap: niente stime');
  const g = fundamentalsReturn({ ...base, marketCap: 5e9 });
  assert.ok(g.growthInput <= 0.1 + 1e-12, 'senza ricavi la crescita a 1 anno è limitata al 10%');
});

test('prodotti a leva: rendimento atteso limitato a L × mercato − finanziamento − decadimento', async () => {
  const { leverageOf } = await import('../public/js/analyze.js');
  assert.equal(leverageOf('MSCI USA Daily (2x) Leveraged EUR (Acc)'), 2);
  assert.equal(leverageOf('S&P 500 3X Daily Leveraged'), 3);
  assert.equal(leverageOf('Lyxor Leveraged DAX'), 2);
  assert.equal(leverageOf('iShares Core MSCI World'), 1);
  assert.equal(leverageOf('Xtrackers II EUR Overnight'), 1);
  const b = series(520, 1);
  const a = series(520, 2, 2.0, b.rets);
  const lev = forwardParams({ type: 'etf', timestamps: a.ts, prices: a.p, benchmark: { timestamps: b.ts, closesEur: b.p }, market: 0.08, marketGrowth: 0.07, leverage: 2, years: 5, lookbackYears: 10 }, B);
  assert.ok(lev.leverageCap != null && lev.expected <= lev.leverageCap + 1e-12);
  assert.ok(lev.leverageCap < 0.16 - 0.02 && lev.leverageCap > 0.08, String(lev.leverageCap));
});

test('dividendi distribuiti: riconoscimento e costo del differimento fiscale', async () => {
  const { distributesDividends, analyze, BENCHMARK_SYMBOL, DEFAULT_SETTINGS } = await import('../public/js/analyze.js');
  assert.equal(distributesDividends({ type: 'etf', name: 'iShares STOXX Global Select Dividend 100 UCITS ETF (DE)' }), false, 'senza dati né indicazione nel nome: nessun aggravio');
  assert.equal(distributesDividends({ type: 'etf', name: 'iShares STOXX Global Select Dividend 100 UCITS ETF (DE)' }, { dividendYield: 0.039 }), true, 'Yahoo riporta un dividendo: distribuisce');
  assert.equal(distributesDividends({ type: 'etf', name: 'iShares Core MSCI World (Acc)' }, { dividendYield: 0 }), false);
  assert.equal(distributesDividends({ type: 'etf', name: 'Amundi Core S&P 500 Swap UCITS ETF USD Dist' }), true);
  assert.equal(distributesDividends({ type: 'etf', name: 'Xtrackers FTSE MIB UCITS ETF 1D' }), true);
  assert.equal(distributesDividends({ type: 'etf', name: 'Vanguard LifeStrategy 80% Equity UCITS ETF (EUR) Accumulating' }), false);
  assert.equal(distributesDividends({ type: 'stock', name: 'Enel' }), true);
  const b = series(520, 1);
  const a = series(520, 2, 1.0, b.rets);
  const hist = { timestamps: a.ts, closesEur: a.p };
  const bench = { timestamps: b.ts, closesEur: b.p };
  const acc = analyze({ instrument: { symbol: 'X', type: 'etf', name: 'Test Acc' }, history: hist, benchmark: bench, fundamentals: { dividendYield: 0 }, market: 0.08, marketGrowth: 0.07 }, DEFAULT_SETTINGS);
  const dist = analyze({ instrument: { symbol: 'X', type: 'etf', name: 'Test Dist' }, history: hist, benchmark: bench, fundamentals: { dividendYield: 0.05 }, market: 0.08, marketGrowth: 0.07 }, DEFAULT_SETTINGS);
  assert.ok(Math.abs(dist.sim.distDrag - 0.05) < 1e-9 && dist.sim.distYield === 0.05, String(dist.sim.distDrag));
  assert.ok(dist.sim.netMedian < acc.sim.netMedian);
});

test('fondi di fondi: le partecipazioni-ETF non contano come concentrazione', async () => {
  const { isFundHolding } = await import('../public/js/analyze.js');
  assert.equal(isFundHolding({ symbol: 'VWRP.L', name: 'Vanguard FTSE All-World UCITS ETF' }), true);
  assert.equal(isFundHolding({ symbol: 'NVDA', name: 'NVIDIA Corp' }), false);
});

test('aliquota italiana effettiva: 12,5% sui titoli di Stato, 26% altrove', async () => {
  const { effectiveTaxRate } = await import('../public/js/analyze.js');
  assert.equal(effectiveTaxRate({ type: 'stock', name: 'Enel' }, null), 26);
  assert.equal(effectiveTaxRate({ type: 'etf', name: 'iShares Core MSCI World' }, { bondPosition: 0 }), 26);
  assert.equal(effectiveTaxRate({ type: 'etf', name: 'Xtrackers II Eurozone Government Bond UCITS ETF' }, { bondPosition: 1 }), 12.5);
  assert.equal(effectiveTaxRate({ type: 'etf', name: 'iShares € Corp Bond UCITS ETF' }, { bondPosition: 1 }), 26);
  const mixed = effectiveTaxRate({ type: 'etf', name: 'Vanguard LifeStrategy 80% Equity' }, { bondPosition: 0.2 });
  assert.ok(mixed < 26 && mixed > 24, String(mixed)); // 20% obbligazioni × 60% governativi → 12% al 12,5%
});
