// Dati sintetici deterministici (MOCK=1) per provare l'app senza accesso a internet.
// NON sono dati di mercato reali.
import { mulberry32, hashString } from '../public/js/montecarlo.js';

const PROFILE = {
  crypto: { mu: 0.25, vol: 0.75, currency: 'EUR' },
  etf: { mu: 0.07, vol: 0.16, currency: 'EUR' },
  stock: { mu: 0.09, vol: 0.3, currency: 'USD' },
};

function typeOf(symbol) {
  if (symbol.endsWith('-EUR') || symbol.endsWith('-USD')) return 'crypto';
  if (/^(EUNL|VWCE|SXR8|IS3N|XDWD|VUAA|EXS1|EUNA|EUNH|XEON|4GLD|CSMIB)/.test(symbol)) return 'etf';
  return 'stock';
}

export function mockChart(symbol, { range = '10y', interval = '1wk' } = {}) {
  if (symbol.endsWith('=X')) {
    // Cambi: quasi costanti attorno a 1.10 (EURUSD), 0.85 (EURGBP), ecc.
    const base = { EURUSD: 1.1, EURGBP: 0.86, EURCHF: 0.95, EURDKK: 7.46 }[symbol.slice(0, 6)] ?? 1;
    return series(symbol, base, 0.0, 0.06, range, interval, 'EUR');
  }
  const t = typeOf(symbol);
  const p = PROFILE[t];
  const h = hashString(symbol);
  const mu = p.mu + ((h % 100) / 100 - 0.5) * p.mu * 1.5;
  const vol = p.vol * (0.6 + ((h >>> 8) % 100) / 100);
  const currency = symbol.includes('.') ? (symbol.endsWith('.L') ? 'GBp' : symbol.endsWith('.SW') ? 'CHF' : 'EUR') : p.currency;
  const listed = 2 + (h % 9); // anni di storico 2..10
  return series(symbol, 20 + (h % 300), mu, vol, range, interval, t === 'crypto' ? 'EUR' : currency, listed);
}

function series(symbol, start, mu, vol, range, interval, currency, yearsListed = 10) {
  const rand = mulberry32(hashString(symbol)); // stessa serie per ogni range: prezzi coerenti tra storico e quotazioni
  const step = 7; // sempre settimanale: storico e quotazione demo restano coerenti
  const years = yearsListed;
  const n = Math.max(2, Math.round((years * 365) / step));
  const dt = step / 365;
  const now = Math.floor(Date.now() / 1000 / 86400) * 86400;
  const timestamps = [];
  const closes = [];
  let p = start;
  for (let i = 0; i < n; i++) {
    const z = Math.sqrt(-2 * Math.log(rand() || 1e-9)) * Math.cos(2 * Math.PI * rand());
    // occasionali salti negativi per rendere realistici i drawdown
    const jump = rand() < 0.004 ? -0.15 * rand() : 0;
    p *= Math.exp((mu - vol * vol / 2) * dt + vol * Math.sqrt(dt) * z + jump);
    timestamps.push(now - (n - 1 - i) * step * 86400);
    closes.push(+p.toFixed(4));
  }
  const minute = Math.floor(Date.now() / 60000);
  const live = closes[closes.length - 1] * (1 + Math.sin(minute + hashString(symbol)) * 0.004);
  return {
    symbol,
    currency,
    exchange: 'MOCK',
    name: null,
    price: +live.toFixed(4),
    previousClose: +(live / (1 + Math.sin(hashString(symbol) + minute / 7) * 0.02)).toFixed(4),
    marketTime: Math.floor(Date.now() / 1000),
    timestamps,
    closes,
  };
}

export function mockSearch(q) {
  const s = q.toUpperCase().replace(/[^A-Z0-9.-]/g, '');
  if (!s) return [];
  return [
    { symbol: `${s.slice(0, 5)}.DE`, name: `${q} (demo Xetra)`, type: 'stock', exchange: 'XETRA' },
    { symbol: s.slice(0, 5), name: `${q} (demo US)`, type: 'stock', exchange: 'NASDAQ' },
  ];
}

export function mockFundamentals(symbol) {
  const h = hashString(symbol + 'f');
  const t = typeOf(symbol);
  const c = mockChart(symbol);
  const hasAnalysts = t === 'stock' && h % 4 !== 0;
  return {
    symbol,
    currency: c.currency,
    price: c.price,
    targetMean: hasAnalysts ? +(c.price * (0.95 + (h % 30) / 100)).toFixed(2) : null,
    targetLow: null,
    targetHigh: null,
    analysts: hasAnalysts ? 5 + (h % 30) : null,
    recommendation: hasAnalysts ? ['buy', 'hold', 'strong_buy'][h % 3] : null,
    recommendationMean: hasAnalysts ? 1.5 + (h % 20) / 10 : null,
    beta: t === 'crypto' ? null : 0.6 + (h % 90) / 100,
    dividendYield: t === 'crypto' ? null : (h % 40) / 1000,
    forwardPE: null,
    impliedVol: t === 'stock' && !symbol.includes('.') ? 0.2 + (h % 40) / 100 : null,
    impliedVolDays: 90,
  };
}

export function mockQuoteBatch(symbols) {
  return Object.fromEntries(
    symbols.map((s) => {
      const c = mockChart(s);
      return [s, { price: c.price, previousClose: c.previousClose, currency: c.currency, marketTime: c.marketTime }];
    }),
  );
}
