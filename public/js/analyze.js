// Analisi completa di uno strumento: parametri prospettici + simulazione Monte Carlo.
import { simulate, DEFAULT_OPTIONS, historicalMaxDrawdown, WEEKS_PER_YEAR } from './montecarlo.js';
import { cleanDividend, forwardParams, DEFAULT_OUTLOOK } from './outlook.js';
import { backfillWithProxy } from './backfill.js';

export const BENCHMARK_SYMBOL = 'EUNL.DE'; // iShares Core MSCI World (EUR) per il calcolo del beta
export const CRYPTO_BENCHMARK_SYMBOL = 'BTC-EUR'; // riferimento per ricostruire lo storico delle crypto giovani

const { targetDrift, targetVol, seed, ...MC_DEFAULTS } = DEFAULT_OPTIONS;
export const DEFAULT_SETTINGS = { mc: { ...MC_DEFAULTS, cryptoSpreadPct: 0 }, outlook: { ...DEFAULT_OUTLOOK } };

// Nome file sicuro per i dati statici di uno strumento (versione GitHub Pages).
export function fileKey(symbol) {
  return String(symbol).replace(/[^A-Za-z0-9._-]/g, '_');
}

/**
 * Inserisce la quotazione corrente come ultima chiusura settimanale (la settimana in corso),
 * così le previsioni seguono il prezzo aggiornato. Variazioni assurde (>50%) vengono ignorate.
 */
export function applyLivePrice(history, priceEur) {
  const n = history?.closesEur?.length;
  if (!n || !(priceEur > 0)) return history;
  const last = history.closesEur[n - 1];
  if (Math.abs(priceEur / last - 1) > 0.5) return history;
  const closesEur = history.closesEur.slice();
  closesEur[n - 1] = priceEur;
  return { ...history, closesEur };
}

// Risultato senza i dati dei grafici, per salvarlo/pubblicarlo in forma compatta.
export function compactResult(r) {
  if (r.error) return { error: r.error, ...(r.estimate ? { estimate: r.estimate } : {}), ...(r.mom ? { mom: r.mom } : {}) };
  return { ...(r.mom ? { mom: r.mom } : {}), forward: r.forward, sim: { ...r.sim, fan: undefined, histogram: undefined }, ...(r.fund ? { fund: r.fund } : {}) };
}

// Solo i numeri della tabella (per pubblicare migliaia di strumenti ogni pochi minuti):
// il dettaglio di uno strumento viene comunque ricalcolato nel browser quando lo si apre.
const r4 = (x) => (Number.isFinite(x) ? Math.round(x * 1e4) / 1e4 : x === Infinity ? null : x ?? null);
export function tableResult(r) {
  if (r.error) return { error: r.error, ...(r.estimate ? { estimate: r.estimate } : {}), ...(r.mom ? { mom: r.mom } : {}) };
  const s = r.sim;
  return {
    ...(r.mom ? { mom: r.mom } : {}),
    forward: {
      expected: r4(r.forward?.expected),
      growth: r4(r.forward?.expectedGrowth),
      growthSource: r.forward?.growthSource ?? null,
      vol: r4(r.forward?.vol), // volatilità annua usata nella simulazione (per il drag della volatilità nel CAGR)
      beta: r4(r.forward?.beta), // beta verso il mercato azionario (stress test: impatto di una correzione)
      ...(r.forward?.fundamentalsDetail?.source === 'holdings' ? { coverage: r4(r.forward.fundamentalsDetail.coverage) } : {}),
      ...(r.forward?.fundamentalsDetail?.evidence != null ? { evidence: r4(r.forward.fundamentalsDetail.evidence) } : {}),
      ...(r.forward?.fundamentalsDetail?.expected != null ? { fundExpected: r4(r.forward.fundamentalsDetail.expected) } : {}), // CAGR forward dai fondamentali (crescita utili + dividendo + valutazione): prospettive di crescita aggiornate
      ...(Number.isFinite(r.forward?.mcap) ? { mcap: Math.round(r.forward.mcap / 1e6) * 1e6 } : {}),
      ...(r.forward?.top10 != null ? { top10: r4(r.forward.top10), ...(r.forward.fundOfFunds ? { fundOfFunds: true } : {}) } : {}),
    },
    sim: {
      maxLoss: r4(s.maxLoss),
      histMdd: r4(s.histMdd),
      mddMedian: r4(s.mddMedian),
      netGain: r4(s.netGain),
      netP25: r4(s.netP25),
      netMedian: r4(s.netMedian),
      netMean: r4(s.netMean),
      ratio: r4(s.ratio),
      finalLoss: r4(s.finalLoss),
      expGain: r4(s.expGain),
      expLoss: r4(s.expLoss),
      balanced: r4(s.balanced),
      ratioFinal: r4(s.ratioFinal),
      probLoss: r4(s.probLoss),
      ce1: r4(s.ce1),
      ce3: r4(s.ce3),
      ce: s.ce ? Object.fromEntries(Object.entries(s.ce).map(([k, v]) => [k, r4(v)])) : null,
      es5: r4(s.es5),
      nr5: r4(s.nr5),
      nr5LossWeight: r4(s.nr5LossWeight),
      sharpe: r4(s.sharpe),
      sortino: r4(s.sortino),
      ...(s.distYield > 0 ? { distYield: r4(s.distYield), distDrag: r4(s.distDrag) } : {}),
      ...(s.divYield > 0 ? { divYield: r4(s.divYield) } : {}),
      ...(s.taxRate != null && s.taxRate !== 26 ? { taxRate: r4(s.taxRate) } : {}),
      ...(Number.isFinite(s.cagrHist) ? { cagrHist: r4(s.cagrHist), cagrYears: s.cagrYears, ...(Number.isFinite(s.cagr10) ? { cagr10: r4(s.cagr10) } : {}) } : {}),
      probAtLeast: s.probAtLeast ? s.probAtLeast.map(r4) : null,
    },
  };
}

export function tableQuote(q) {
  if (!q) return null;
  return { priceEur: r4(q.priceEur), changePct: r4(q.changePct), price: q.price, currency: q.currency, ...(q.perf ? { perf: q.perf } : {}) };
}

/** Fattore di leva dedotto dal nome ("2x", "3X", "Leveraged" → 2 se non indicato); 1 per i prodotti normali. */
export function leverageOf(name = '') {
  // leve anche decimali (es. «2.25x»): prima si leggeva solo l'ultima cifra («5x»)
  const m = /(\d+(?:[.,]\d+)?)\s*[xX]\b|\b[xX]\s*(\d+(?:[.,]\d+)?)\b/.exec(name);
  const L = m ? Number(String(m[1] || m[2]).replace(',', '.')) : NaN;
  if (L > 0 && L <= 7) return L; // oltre 7 non è una leva (es. «10X Genomics» è un'azione)
  return /leverag|lev\.|a leva/i.test(name) ? 2 : 1;
}

// ---------- stima provvisoria per strumenti con storico breve (< minYears) ----------
// La previsione completa richiede almeno 1 anno di storico. Con 8+ settimane si calcolano comunque i fattori
// base (volatilità e drawdown dai dati disponibili, CAGR atteso dal modello di mercato) così il portafoglio
// si compila da solo e gli orizzonti brevi hanno la σ. NON entra in classifica: è una stima prudente.
/**
 * Tendenza recente di uno strumento: rendimenti semplici sulle ultime 1, 4, 13 e 26 settimane (null se lo storico non basta).
 * Serve ai calcoli a breve termine (momentumTilt in projection.js): per leva e alta volatilità la tendenza degli ultimi
 * giorni/settimane pesa più del CAGR di lungo periodo.
 */
export function momentumStats(prices) {
  const n = prices?.length || 0;
  const ret = (k) => (n > k && prices[n - 1 - k] > 0 && prices[n - 1] > 0 ? r4(prices[n - 1] / prices[n - 1 - k] - 1) : null);
  const out = { w1: ret(1), w4: ret(4), w13: ret(13), w26: ret(26) };
  return Object.values(out).some((v) => v != null) ? out : null;
}

/**
 * Rendimento atteso ARITMETICO annuo di un prodotto a leva/short con ribilanciamento giornaliero, dato il rendimento atteso
 * aritmetico del sottostante `mu`: long L·mu − (L−1)·rf, short/inverse −L·mu + (L+1)·rf. Il decadimento da ribilanciamento
 * riguarda la crescita composta (mediana), non la media: nelle proiezioni a breve lo applica già la distribuzione lognormale
 * (−σ²/2), quindi qui NON va sottratto di nuovo. null se il prodotto non è a leva/short.
 */
export function leveragedArith({ name = '', mu, rf = 0.02 }) {
  const L = Math.max(1, leverageOf(name));
  const inverse = isInverseProduct(name);
  if (L === 1 && !inverse) return null;
  if (!Number.isFinite(mu)) return null;
  const a = inverse ? -L * mu + (L + 1) * rf : L * mu - (L - 1) * rf;
  return Math.max(-0.95, Math.min(3, a));
}

/** Sottostante di un prodotto a leva/short dal nome (per usare le prospettive del sottostante reale, non del mercato azionario). */
export const UNDERLYINGS = [
  { key: 'vix', label: 'VIX (future a breve)', re: /\bvix\b|volatility/i, proxy: null, noEquity: true },
  { key: 'silver', label: 'argento', re: /\bsilver\b|argento/i, proxy: /physical silver|\bsilver usd\b|core physical silver|silver hedged/i },
  { key: 'gold', label: 'oro', re: /\bgold\b|\boro\b/i, proxy: /physical gold|\bgold usd\b|core physical gold|gold hedged|swiss gold/i },
  { key: 'platinum', label: 'platino', re: /platinum/i, proxy: /physical platinum/i },
  { key: 'palladium', label: 'palladio', re: /palladium/i, proxy: /physical palladium/i },
  { key: 'oil', label: 'petrolio', re: /\b(brent|wti|crude|oil)\b/i, proxy: /^(?!.*(\d\s?x|short|lev)).*(brent|wti|crude oil)/i },
  { key: 'natgas', label: 'gas naturale', re: /natural gas/i, proxy: /^(?!.*(\d\s?x|short|lev)).*natural gas/i },
  { key: 'copper', label: 'rame', re: /copper/i, proxy: /^(?!.*(\d\s?x|short|lev)).*copper/i },
  { key: 'nasdaq', label: 'Nasdaq 100', re: /nasdaq|qs100|\bndx\b/i, proxy: /nasdaq[- ]?100/i },
  { key: 'sp500', label: 'S&P 500', re: /s&p ?500|\bspx\b/i, proxy: /s&p ?500/i },
  { key: 'semis', label: 'semiconduttori', re: /semiconductor|phlx/i, proxy: /semiconductor/i },
  { key: 'dax', label: 'DAX', re: /dax\b/i, proxy: /\bdax\b/i },
  { key: 'estx50', label: 'Euro Stoxx 50', re: /euro ?stoxx ?50/i, proxy: /euro ?stoxx ?50/i },
  { key: 'ftsemib', label: 'FTSE MIB', re: /ftse ?mib/i, proxy: /ftse ?mib/i },
  { key: 'cac40', label: 'CAC 40', re: /cac ?40/i, proxy: /cac ?40/i },
  { key: 'nikkei', label: 'Nikkei', re: /nikkei/i, proxy: /nikkei/i },
  { key: 'btp', label: 'BTP', re: /\bbtp\b/i, proxy: /\bbtp\b|italy govt|italia/i },
  { key: 'bund', label: 'Bund', re: /\bbund\b/i, proxy: /\bbund\b|germany govt|german govt/i },
  { key: 'bitcoin', label: 'bitcoin', re: /bitcoin|\bbtc\b/i, proxy: null },
];
export function underlyingOf(name = '') {
  return UNDERLYINGS.find((u) => u.re.test(String(name))) || null;
}

export const PROVISIONAL_MIN_WEEKS = 8;
const INVERSE = /\b(short(?!\s*(duration|dur|term|maturity|dated|-term))|inverse|bear)\b|\(-\d|-\d\s?x\b/i;
export const isInverseProduct = (name = '') => INVERSE.test(String(name));
const weekKey = (ts) => Math.round(ts / 604800);

export function provisionalEstimate({ instrument, history, benchmark, market, settings, fundamentals = null } = {}) {
  const prices = history?.closesEur;
  if (!Array.isArray(prices) || prices.length < PROVISIONAL_MIN_WEEKS) return null;
  const rets = [];
  const idx = [];
  for (let i = 1; i < prices.length; i++) {
    if (prices[i - 1] > 0 && prices[i] > 0) {
      rets.push(Math.log(prices[i] / prices[i - 1]));
      idx.push(i);
    }
  }
  if (rets.length < PROVISIONAL_MIN_WEEKS - 1) return null;
  const mean = rets.reduce((a, x) => a + x, 0) / rets.length;
  const vol = Math.sqrt(rets.reduce((a, x) => a + (x - mean) ** 2, 0) / (rets.length - 1)) * Math.sqrt(WEEKS_PER_YEAR);
  if (!(vol > 0)) return null;
  const mdd = historicalMaxDrawdown(prices);
  const rf = (settings?.outlook?.riskFree ?? DEFAULT_OUTLOOK.riskFree) / 100;
  const m = Number.isFinite(market) ? market : rf + 0.045;
  const name = instrument?.name || '';
  // beta verso il benchmark azionario sulle settimane in comune
  let beta = null;
  let betaR2 = null;
  let betaN = 0;
  if (benchmark?.closesEur?.length && benchmark?.timestamps && history.timestamps) {
    const bIdx = new Map();
    benchmark.timestamps.forEach((t, i) => bIdx.set(weekKey(t), i));
    const xs = [];
    const ys = [];
    for (const i of idx) {
      const b1 = bIdx.get(weekKey(history.timestamps[i]));
      const b0 = bIdx.get(weekKey(history.timestamps[i - 1]));
      if (b1 != null && b0 != null && b1 === b0 + 1 && benchmark.closesEur[b0] > 0 && benchmark.closesEur[b1] > 0) {
        xs.push(Math.log(benchmark.closesEur[b1] / benchmark.closesEur[b0]));
        ys.push(Math.log(prices[i] / prices[i - 1]));
      }
    }
    if (xs.length >= PROVISIONAL_MIN_WEEKS - 1) {
      const mx = xs.reduce((a, x) => a + x, 0) / xs.length;
      const my = ys.reduce((a, x) => a + x, 0) / ys.length;
      const vx = xs.reduce((a, x) => a + (x - mx) ** 2, 0);
      const vy = ys.reduce((a, y) => a + (y - my) ** 2, 0);
      if (vx > 0) {
        beta = xs.reduce((a, x, k) => a + (x - mx) * (ys[k] - my), 0) / vx;
        betaR2 = vy > 0 ? Math.min(1, (beta * beta * vx) / vy) : 0;
        betaN = xs.length;
      }
    }
  }
  return { ...buildEstimate({ name, vol, mdd, beta, betaR2, betaN, m, rf, weeks: prices.length, source: 'history', fundamentals, type: instrument?.type }), mom: momentumStats(prices) };
}

/**
 * Stima dalla sola volatilità annua (strumenti senza storico di prezzo, es. dal dataset radar): beta ≈ 0,6 × σ ÷ σ mercato
 * (correlazione 0,6 con il mercato, σ mercato 15%) e drawdown ≈ 1,5 × σ. Meno precisa di quella dallo storico.
 */
export function radarEstimate({ instrument, vol, market, settings, label = 'dataset radar', source = 'radar', mom = null } = {}) {
  if (!(vol > 0 && vol < 5)) return null;
  const rf = (settings?.outlook?.riskFree ?? DEFAULT_OUTLOOK.riskFree) / 100;
  const m = Number.isFinite(market) ? market : rf + 0.045;
  return { ...buildEstimate({ name: instrument?.name || '', vol, mdd: Math.min(0.95, 1.5 * vol), beta: Math.min(1.5, (0.6 * vol) / 0.15), m, rf, weeks: null, source, label }), ...(mom ? { mom } : {}) };
}

/**
 * Ultima rete di sicurezza: NESSUN dato (né storico né dataset). Volatilità tipica della categoria dedotta dal nome e dal
 * tipo, così ogni strumento è comunque utilizzabile nel portafoglio, anche per gli orizzonti brevi (7-90 giorni).
 */
export function priorVol(instrument = {}) {
  const name = String(instrument.name || '');
  const L = Math.max(1, leverageOf(name));
  if (L > 1 || isInverseProduct(name)) return Math.min(2.5, L * 0.18); // leva: σ del sottostante ≈ 18%
  if (instrument.type === 'crypto') return 0.7;
  if (instrument.type === 'stock') return 0.3;
  if (/overnight|money market|monetari|ultrashort|ultra short|cash|liquidity/i.test(name)) return 0.01;
  if (/\b(gold|silver|oil|crude|brent|commodit|copper|platinum|palladium|gas|wheat|agri)/i.test(name)) return 0.2;
  if (/bond|govt|gov\b|treasury|gilt|btp|bund|oat\b|obbligaz|aggregate|credit|corporate|high yield|\bnotes?\b/i.test(name)) return 0.06;
  return 0.16; // ETF azionario generico
}
export function priorEstimate({ instrument, market, settings } = {}) {
  return radarEstimate({ instrument, vol: priorVol(instrument), market, settings, source: 'prior', label: 'valore tipico della categoria (nessun dato di mercato disponibile)' });
}

/** Storico dopo l'ultimo salto settimanale oltre `maxLog` (dati anomali / raggruppamenti): serve a stimare σ e MDD puliti. */
function cutAfterJump(history, maxLog) {
  const c = history?.closesEur || [];
  let cut = 0;
  for (let i = 1; i < c.length; i++) if (c[i - 1] > 0 && c[i] > 0 && Math.abs(Math.log(c[i] / c[i - 1])) > maxLog) cut = i;
  return cut ? { ...history, closesEur: c.slice(cut), timestamps: history.timestamps?.slice(cut) } : history;
}

function buildEstimate({ name, vol, mdd, beta, betaR2 = null, betaN = 0, m, rf, weeks, source, label, fundamentals = null, type = null }) {
  const L = Math.max(1, leverageOf(name));
  const inverse = isInverseProduct(name);
  let cagr;
  let ter = null;
  let basis;
  const tail = source !== 'history' ? `Volatilità dal ${label}; drawdown stimato 1,5 × σ.` : 'Lo storico è troppo breve per usare quello dello strumento.';
  if (L > 1 || inverse) {
    // Prodotti a leva giornaliera: L × mercato − finanziamento − decadimento da ribilanciamento, come il limite
    // del modello (outlook.js); per gli short/inverse il segno è opposto e la liquidità frutta il tasso privo di rischio.
    const sigU = vol / L;
    cagr = inverse ? -L * m + (L + 1) * rf - ((L * L + L) / 2) * sigU ** 2 : L * m - (L - 1) * rf - ((L * L - L) / 2) * sigU ** 2;
    const raw = cagr;
    cagr = Math.min(0.5, Math.max(-0.6, cagr));
    ter = 0.006;
    var cagrShort = leveragedArith({ name, mu: m, rf });
    basis = `Prodotto a leva ${inverse ? 'inversa ' : ''}${L}x: rendimento atteso = ${inverse ? '−' : ''}${L} × rendimento del mercato (${(m * 100).toFixed(1)}%) con costo di finanziamento e decadimento da ribilanciamento giornaliero (σ del sottostante ≈ ${((vol / L) * 100).toFixed(0)}%), ${raw < -0.6 ? 'Limite prudenziale −60%/anno (la formula darebbe ' + (raw * 100).toFixed(0) + '%). ' : ''}TER stimato ${(ter * 100).toFixed(2)}%. ${tail}`;
  } else {
    // Beta robusto: con poche settimane e titoli molto volatili la regressione è rumore (es. −4 su 19 settimane).
    // Non significativo (meno di 8 settimane o R² < 10%) → 1; altrimenti ridotto verso 1 in proporzione allo storico.
    let b;
    let bNote;
    if (source !== 'history') {
      b = Math.min(2, Math.max(0, beta ?? 1));
      bNote = ' (stimato dalla volatilità)';
    } else if (beta == null || betaN < 8 || !(betaR2 >= 0.1)) {
      b = 1;
      bNote = beta == null ? ' (non misurabile, assunto 1)' : ` (misurato ${beta.toFixed(2)} su ${betaN} settimane ma non significativo, R² ${(100 * (betaR2 ?? 0)).toFixed(0)}%: assunto 1)`;
    } else {
      const w = betaN / (betaN + 52);
      b = Math.min(2, Math.max(0.3, w * beta + (1 - w)));
      bNote = ` (misurato ${beta.toFixed(2)} su ${betaN} settimane, ridotto verso 1 per lo storico breve)`;
    }
    cagr = rf + b * (m - rf);
    basis = `Rendimento atteso del mercato (${(m * 100).toFixed(1)}%) con beta ${b.toFixed(2)}${bNote}.`;
    // Evidenze di mercato e prospettive di crescita (analisti), quando disponibili: media con il rendimento di mercato
    const f = fundamentals;
    if (f && type === 'stock') {
      const ev = [];
      const div = Number.isFinite(f.dividendYield) ? Math.max(0, f.dividendYield) : 0;
      if (f.targetMean > 0 && f.price > 0 && (f.analysts || 0) >= 1) ev.push(['prezzo obiettivo degli analisti', Math.max(-0.5, Math.min(0.5, f.targetMean / f.price - 1)) + div]);
      const g = Number.isFinite(f.epsGrowthNext) ? Math.min(1, f.epsGrowthNext) : Number.isFinite(f.revenueGrowthNext) ? f.revenueGrowthNext : null;
      if (g != null) ev.push(['crescita attesa di utili/ricavi', Math.max(-0.5, Math.min(0.5, g)) + div]);
      if (ev.length) {
        const e = ev.reduce((a, [, v]) => a + v, 0) / ev.length;
        cagr = 0.5 * cagr + 0.5 * e;
        basis += ` Media con le evidenze degli analisti (${ev.map(([k, v]) => `${k} ${(v * 100).toFixed(1)}%`).join(', ')}).`;
      }
    }
    basis += ` ${tail}`;
  }
  return {
    cagr: r4(cagr),
    vol: r4(vol),
    mdd: r4(mdd),
    beta: beta == null ? null : r4(beta),
    ter,
    weeks,
    ...(typeof cagrShort === 'number' ? { cagrShort: r4(cagrShort) } : {}),
    ...(L > 1 ? { leverage: L } : {}),
    ...(inverse ? { inverse: true } : {}),
    basis,
    source,
    provisional: true,
  };
}

/**
 * Strumento che paga i dividendi all'investitore: azioni, ed ETF a distribuzione. Per gli ETF il dato
 * decisivo è il rendimento da dividendo riportato da Yahoo (gli ETF ad accumulazione non ne hanno);
 * in mancanza si guarda il nome.
 */
/** Partecipazione che è essa stessa un fondo/ETF (fondi di fondi come i Vanguard LifeStrategy). */
export function isFundHolding(h) {
  const name = h?.name || '';
  if (/\b(etf|etc|ucits|fund|fonds|index|trust|sicav|oeic|portfolio)\b/i.test(name)) return true;
  // Case di gestione che non sono società quotate: un titolo che inizia col loro nome è un loro fondo
  // (es. «Vanguard FTSE North America», «iShares Core MSCI World»). Yahoo accorcia i nomi e spesso perde «ETF».
  if (/^(vanguard|ishares|xtrackers|lyxor|spdr|vaneck|db x-trackers)\b/i.test(name)) return true;
  // Case quotate in borsa (Invesco, Amundi, Franklin, WisdomTree, HSBC, UBS…): fondo solo se il nome
  // contiene anche un indice o una classe di attivo, altrimenti potrebbe essere l'azione della società
  if (/^(invesco|amundi|franklin|wisdomtree|hsbc|ubs|fidelity|jpm\w*|jpmorgan|bnp paribas|legal & general|l&g|pimco|goldman sachs|schwab|dimensional)\b/i.test(name) && /\b(ftse|msci|s&p|stoxx|nasdaq|bloomberg|russell|dax|euro ?stoxx|treasury|govt?|gov ?bd|corp(orate)? ?bd|bond|bd|aggregate|aggt|equity|eq|equities|high yield|money market|liquidity)\b/i.test(name)) return true;
  return /^(VWRP|VAGP|VEVE|VFEM|VGOV|VUKE|VUSA|VERX|VJPN|VAPX|VNRA|VHVE|VWRA|VAGF|VUAA|VFEA|VWCG|VJPA|VAPU|VDTE|VGEA|VDCE|VECA)\b/i.test(h?.symbol || '');
}

/**
 * Aliquota italiana effettiva: 26% su azioni, ETF azionari e obbligazioni societarie; 12,5% sui titoli di
 * Stato (white list). Per gli ETF obbligazionari governativi e per i bilanciati la quota di titoli di Stato
 * viene stimata dalla composizione (quota obbligazionaria × 60% di governativi negli indici aggregati).
 */
const GOV_RE = /govern|treasur|\bgovt\b|sovereign|\bbtp\b|\bbund\b|\bgilt|\boat\b|bonos|inflation[- ]linked|\btips\b|euro(zone)? gov|ibonds.*(italy|govt|gov|treasury)/i;
const CORP_RE = /corporate|\bcorp\b|high yield|fallen angel|credit/i;
export function effectiveTaxRate(inst, holdings, baseRate = 26) {
  if (inst.type !== 'etf') return baseRate;
  const bond = Number.isFinite(holdings?.bondPosition) ? Math.max(0, Math.min(1, holdings.bondPosition)) : null;
  let govShare = 0;
  const name = inst.name || '';
  if (GOV_RE.test(name) && !CORP_RE.test(name)) govShare = bond ?? 1;
  else if (CORP_RE.test(name)) govShare = 0; // obbligazioni societarie: 26%
  else if (bond != null && bond > 0.05) govShare = bond * 0.6;
  return baseRate - govShare * (baseRate - 12.5);
}

export function distributesDividends(inst, fundamentals = null) {
  if (inst.type === 'stock') return true;
  if (inst.type !== 'etf') return false;
  if (fundamentals && Number.isFinite(fundamentals.dividendYield)) return fundamentals.dividendYield > 0.002;
  return /\b(dist|dis|distr|distributing|inc|income|1d|2d|3d|4d)\b|\(d\)|\bd\b\s*$|-d\b|\bdis\)|\bdist\)/i.test(inst.name || '');
}

export function analyze({ instrument, history, benchmark, cryptoBenchmark, fundamentals, holdings, market, marketGrowth }, settings) {
  const o = { ...DEFAULT_OPTIONS, ...settings.mc };
  if (instrument.type === 'crypto') o.spreadPct = settings.mc.cryptoSpreadPct ?? o.spreadPct;
  const prices = history.closesEur;
  const realYears = (prices.length - 1) / WEEKS_PER_YEAR;
  if (realYears < o.minYears) {
    const estimate = provisionalEstimate({ instrument, history, benchmark, market, settings, fundamentals });
    return { forward: null, sim: { ok: false, reason: `Storico insufficiente (${realYears.toFixed(1)} anni, minimo ${o.minYears})`, historyYears: realYears }, ...(estimate ? { estimate } : {}) };
  }
  // Controllo qualità: per azioni ed ETF un movimento ×3 o ÷3 in una settimana indica dati errati
  // (tipico di quotazioni secondarie poco scambiate): meglio "n.d." che previsioni inventate.
  if (instrument.type !== 'crypto') {
    const maxJump = Math.log(instrument.leveraged ? 12 : 3); // i prodotti a leva si muovono davvero di molto
    const lb = prices.slice(-(Math.round(o.lookbackYears * WEEKS_PER_YEAR) + 1));
    for (let i = 1; i < lb.length; i++) {
      if (lb[i - 1] > 0 && lb[i] > 0 && Math.abs(Math.log(lb[i] / lb[i - 1])) > maxJump) {
        const estimate = provisionalEstimate({ instrument, history: cutAfterJump(history, maxJump), benchmark, market, settings, fundamentals });
        return { forward: null, sim: { ok: false, reason: 'Dati di prezzo non affidabili (salti anomali nello storico)', historyYears: realYears }, ...(estimate ? { estimate } : {}) };
      }
    }
  }
  // Prezzo fermo (delistato, sospeso o quasi mai scambiato): volatilità e perdite risulterebbero
  // falsamente basse. Oltre il 30% di settimane senza variazioni negli ultimi 2 anni → n.d.
  if (instrument.type !== 'crypto') {
    const recent = prices.slice(-105);
    let flat = 0;
    for (let i = 1; i < recent.length; i++) if (recent[i] === recent[i - 1]) flat++;
    if (recent.length > 20 && flat / (recent.length - 1) > 0.3) {
      return { forward: null, sim: { ok: false, reason: 'Prezzo fermo o poco scambiato: previsioni non affidabili', historyYears: realYears } };
    }
  }
  const bench = instrument.symbol === BENCHMARK_SYMBOL ? null : benchmark;
  // Storico breve: rischio stimato su uno storico ricostruito con un riferimento
  // (MSCI World per azioni ed ETF, Bitcoin per le crypto).
  const proxy = instrument.type === 'crypto' ? (instrument.symbol === CRYPTO_BENCHMARK_SYMBOL ? null : cryptoBenchmark) : bench;
  const filled = proxy ? backfillWithProxy(history, proxy, { lookbackYears: o.lookbackYears, seedKey: instrument.symbol }) : null;
  const fwd = forwardParams(
    {
      type: instrument.type,
      leverage: leverageOf(instrument.name),
      timestamps: history.timestamps,
      prices,
      riskPrices: filled?.closesEur,
      market: Number.isFinite(market) ? market : null,
      marketGrowth: Number.isFinite(marketGrowth) ? marketGrowth : null,
      benchmark: bench,
      fundamentals,
      holdings: holdings || null,
      years: o.years,
      lookbackYears: o.lookbackYears,
    },
    settings.outlook,
  );
  // Dividendi distribuiti (ETF a distribuzione, azioni): in Italia tassati al 26% all'incasso, non a fine
  // periodo. Rispetto a un accumulo l'unica differenza, reinvestendo il netto, è l'anticipo dell'imposta:
  // il capitale che compone è minore. Costo del differimento ≈ tassa × dividendo × rendimento × (anni−1)/2
  // all'anno, sottratto alla deriva della simulazione (la tassa finale resta sul guadagno complessivo).
  // Aliquota italiana effettiva (12,5% sulla quota di titoli di Stato) usata per tasse finali e dividendi
  o.taxRate = effectiveTaxRate(instrument, holdings, o.taxRate);
  // Dividendi distribuiti: tassati al 26% a ogni stacco e NON reinvestiti (Trade Republic non reinveste
  // automaticamente): escono dal percorso del prezzo e si accumulano in contanti al netto dell'imposta.
  const distYield = distributesDividends(instrument, fundamentals) ? cleanDividend(fundamentals?.dividendYield) : 0;
  const distDrag = distYield; // il rendimento da dividendo non compone più nel prezzo
  o.cashYield = distYield;
  o.cashTax = o.taxRate;
  o.riskFree = settings.outlook?.riskFree ?? 2;
  // Concentrazione: peso delle prime 10 partecipazioni (dalla composizione del fondo); per la diversificazione
  // Capitalizzazione (azioni): per il filtro dimensioni dell'algoritmo Max Growth
  if (fwd && Number.isFinite(fundamentals?.marketCap) && fundamentals.marketCap > 0) fwd.mcap = fundamentals.marketCap;
  if (fwd && holdings?.holdings?.length) {
    const funds = holdings.holdings.filter((h) => isFundHolding(h)).length;
    fwd.fundOfFunds = holdings.fundOfFunds === true || funds * 2 >= holdings.holdings.length; // le partecipazioni sono a loro volta fondi: diversificato
    fwd.top10 = fwd.fundOfFunds ? 0.3 : Math.min(1, holdings.holdings.reduce((a, h) => a + (h.weight || 0), 0));
  }
  // NR5: la perdita media nel 5% peggiore pesa ½ per ETF e crypto, ⅓ per le azioni singole
  o.nr5LossWeight = instrument.type === 'stock' ? 1 / 3 : 0.5;
  // Imposta di bollo italiana: 0,20% annuo sul controvalore, prelevata lungo il percorso (deriva)
  const stampDuty = (o.stampDutyPct ?? 0.2) / 100;
  const sim = simulate(filled ? filled.closesEur : prices, { ...o, targetDrift: fwd ? fwd.drift - distDrag - stampDuty : null, targetVol: fwd?.vol ?? null });
  if (sim.ok) {
    sim.distYield = distYield;
    sim.distDrag = distDrag;
    sim.taxRate = o.taxRate;
    sim.stampDuty = stampDuty;
    sim.divYield = cleanDividend(fundamentals?.dividendYield); // per la verifica del dividendo non sostenuto
    // Indicatori "storici" mostrati: solo sui dati reali
    const lookback = Math.round(o.lookbackYears * WEEKS_PER_YEAR) + 1;
    sim.historicalMdd = historicalMaxDrawdown(prices.slice(-lookback));
    // MDD storico per il modulo di rischio del documento 019: sulla serie usata per la simulazione (con
    // ricostruzione tramite indice se lo storico reale è corto, per non sottostimare il rischio dei titoli giovani)
    sim.histMdd = historicalMaxDrawdown((filled ? filled.closesEur : prices).slice(-lookback));
    sim.historyYears = Math.min(realYears, o.lookbackYears);
    sim.backfilledYears = filled ? filled.backfilledWeeks / WEEKS_PER_YEAR : 0;
    sim.backfillProxy = filled ? (instrument.type === 'crypto' ? 'Bitcoin' : 'MSCI World') : null;
    // CAGR storico (algoritmo «Max Growth Score»): prezzo in euro degli ultimi 10 anni (almeno 5). È il
    // rendimento effettivo dell'ETF, quindi già al netto di TER e tracking difference reali. Con meno di 5
    // anni di storico reale il punteggio non è calcolabile.
    const cagrOf = (arr, yrs) => {
      let n = Math.round(yrs * WEEKS_PER_YEAR);
      if (arr.length - 1 < n - 4) return null; // tolleranza di un mese
      n = Math.min(n, arr.length - 1);
      const a = arr[arr.length - 1 - n];
      const b = arr[arr.length - 1];
      return a > 0 && b > 0 ? (b / a) ** (WEEKS_PER_YEAR / n) - 1 : null;
    };
    // Stesso periodo per tutti (ultimi 5 anni, l'orizzonte dell'app): CAGR su finestre diverse non sono
    // confrontabili. Il CAGR a 10 anni, se disponibile, è solo informativo.
    const c5 = cagrOf(prices, 5);
    if (c5 != null) {
      sim.cagrHist = c5;
      sim.cagrYears = 5;
      const c10 = cagrOf(prices, 10);
      if (c10 != null) sim.cagr10 = c10;
    }
  }
  return { forward: fwd, sim };
}
