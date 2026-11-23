// Verifica a posteriori della parte misurabile delle previsioni a breve termine (1, 4 e 13 settimane) su storici reali di
// LS Exchange: la volatilità stimata con le 52 settimane precedenti descrive davvero i rendimenti successivi? (copertura degli
// intervalli, probabilità di guadagno) e il trend recente prosegue? Non verifica le stime degli analisti (non storicizzate).
// Uso: node scripts/calibrate-short.js [numero-strumenti]
import { listInstruments } from '../lib/store.js';
import { lsSearch, lsSymbol, lsHistoryEur } from '../lib/ls.js';
import { normCdf } from '../public/js/projection.js';

const N = Number(process.argv[2]) || 400;
const HORIZONS = [1, 4, 13]; // settimane
const all = listInstruments().filter((i) => i.isin && (i.type === 'stock' || i.type === 'etf') && !i.leveraged && i.source !== 'radar');
const step = Math.max(1, Math.floor(all.length / N));
const sample = all.filter((_, k) => k % step === 0).slice(0, N);

const acc = {}; // tipo|orizzonte → accumulatori
const add = (key, z, r, pPlus, mom) => {
  const a = (acc[key] ||= { n: 0, sz: 0, sz2: 0, in68: 0, in90: 0, pos: 0, pPlus: 0, brier: 0, mom: [], nxt: [] });
  a.n++;
  a.sz += z;
  a.sz2 += z * z;
  if (Math.abs(z) <= 1) a.in68++;
  if (Math.abs(z) <= 1.645) a.in90++;
  const y = r > 0 ? 1 : 0;
  a.pos += y;
  a.pPlus += pPlus;
  a.brier += (pPlus - y) ** 2;
  if (mom != null) {
    a.mom.push(mom);
    a.nxt.push(r);
  }
};
const rank = (v) => {
  const idx = v.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]);
  const r = new Array(v.length);
  idx.forEach(([, i], k) => (r[i] = k));
  return r;
};
const corr = (a, b) => {
  const n = a.length;
  const ma = a.reduce((x, y) => x + y, 0) / n;
  const mb = b.reduce((x, y) => x + y, 0) / n;
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < n; i++) {
    sab += (a[i] - ma) * (b[i] - mb);
    saa += (a[i] - ma) ** 2;
    sbb += (b[i] - mb) ** 2;
  }
  return sab / Math.sqrt(saa * sbb);
};

let c = 0;
let used = 0;
await Promise.all(
  Array.from({ length: 4 }, async () => {
    while (c < sample.length) {
      const it = sample[c++];
      try {
        const ls = await lsSearch(it.isin);
        if (!ls?.id) continue;
        const h = await lsHistoryEur(lsSymbol(ls.id));
        const p = h.closesEur;
        if (p.length < 120) continue;
        used++;
        const lr = p.slice(1).map((x, k) => Math.log(x / p[k]));
        for (let t = 60; t < p.length - 13; t += 2) {
          const w = lr.slice(t - 52, t);
          const m = w.reduce((x, y) => x + y, 0) / w.length;
          const sw = Math.sqrt(w.reduce((x, y) => x + (y - m) ** 2, 0) / (w.length - 1));
          if (!(sw > 0)) continue;
          const sigma = sw * Math.sqrt(52);
          for (const H of HORIZONS) {
            const T = H / 52;
            const r = Math.log(p[t + H] / p[t]);
            const mu = (0.07 - (sigma * sigma) / 2) * T; // deriva prudente: rendimento atteso 7% annuo, mediana logaritmica
            const s = sigma * Math.sqrt(T);
            const z = (r - mu) / s;
            const pPlus = 1 - normCdf((0 - mu) / s);
            const mom = t >= 4 ? Math.log(p[t] / p[t - 4]) : null;
            add(`${it.type}|${H}`, z, r, pPlus, H === 4 ? mom : null);
          }
        }
      } catch {
        /* strumento saltato */
      }
    }
  }),
);

console.log(`Strumenti usati: ${used} su ${sample.length}`);
console.log('tipo|sett   n        media(z) sd(z)  ±1σ(68%)  ±1,645σ(90%)  P(+)prevista  P(+)reale  Brier');
for (const [k, a] of Object.entries(acc).sort()) {
  const m = a.sz / a.n;
  const sd = Math.sqrt(a.sz2 / a.n - m * m);
  console.log(`${k.padEnd(9)} ${String(a.n).padStart(7)}  ${m.toFixed(3).padStart(8)} ${sd.toFixed(3)}  ${(100 * a.in68 / a.n).toFixed(1).padStart(7)}%  ${(100 * a.in90 / a.n).toFixed(1).padStart(10)}%  ${(100 * a.pPlus / a.n).toFixed(1).padStart(9)}%  ${(100 * a.pos / a.n).toFixed(1).padStart(8)}%  ${(a.brier / a.n).toFixed(4)}`);
  if (a.mom.length > 50) console.log(`          trend a 4 settimane → rendimento delle 4 successive (correlazione di rango): ${corr(rank(a.mom), rank(a.nxt)).toFixed(3)}`);
}
