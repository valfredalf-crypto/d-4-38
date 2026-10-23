// Taratura del modello prospettico con il backtest.
// Per molti strumenti e più date di partenza (5, 6, 7, 8 anni fa) si prevede usando solo i dati
// disponibili allora e si misura l'errore rispetto ai 5 anni successivi (pinball loss sui quantili di
// rendimento netto e perdita massima). I parametri si scelgono sul 70% degli strumenti (taratura) e si
// adottano solo se migliorano anche sul restante 30% (verifica, strumenti mai visti nella taratura).
// Uso: node scripts/calibrate.js   (eseguito ogni settimana da .github/workflows/calibrate.yml)
import fs from 'node:fs';
import { listInstruments } from '../lib/store.js';
import { historyEur } from '../lib/market.js';
import { backtestOne, rowLoss, summarize } from '../public/js/backtest.js';
import { BENCHMARK_SYMBOL } from '../public/js/analyze.js';
import { BASE_OUTLOOK } from '../public/js/outlook.js';
import { DEFAULT_OPTIONS, hashString } from '../public/js/montecarlo.js';

const SAMPLE = Number(process.env.CALIB_SAMPLE || 1500); // strumenti campionati (per tipo, in proporzione)
const SIMS = Number(process.env.CALIB_SIMS || 400);
const ORIGINS = [260, 312, 364, 416]; // settimane fa: 5, 6, 7, 8 anni
const log = (...a) => console.log(...a);

// Spazio dei parametri: valori candidati per ciascuno (ricerca per coordinate, due passate).
// Intervalli limitati a valori economicamente sensati: gli ultimi 10 anni sono stati un periodo
// eccezionalmente favorevole per le azioni e una taratura libera finirebbe per proiettarlo nel futuro.
const GRID = {
  weightHistory: [0.1, 0.2, 0.3, 0.45], // peso dello storico rispetto all'equilibrio (analisti esclusi)
  equityPremium: [3, 4, 5, 6],
  priorUncertainty: [2, 3.5, 5, 7.5, 10],
  minStockBeta: [0.3, 0.5, 0.7],
  ewmaWeight: [0, 0.2, 0.4, 0.6],
  volScale: [0.9, 1.0, 1.1, 1.2, 1.3],
};

const { targetDrift, targetVol, seed, ...mcDefaults } = DEFAULT_OPTIONS;
const baseSettings = (outlook) => ({ mc: { ...mcDefaults, cryptoSpreadPct: 0 }, outlook: { ...BASE_OUTLOOK, ...outlook } });

// --- dati
const all = listInstruments();
const benchmark = await historyEur(BENCHMARK_SYMBOL);
const pool = [];
let i = 0;
await Promise.all(
  Array.from({ length: 4 }, async () => {
    while (i < all.length) {
      const inst = all[i++];
      const history = await historyEur(inst.symbol).catch(() => null);
      if (history && history.closesEur.length >= 52 * 7 + 1) pool.push({ instrument: inst, history, benchmark });
    }
  }),
);
// Campione stabile (stesso a ogni esecuzione a parità di universo) e suddivisione taratura/verifica per strumento.
pool.sort((a, b) => hashString(a.instrument.symbol) - hashString(b.instrument.symbol));
const sample = pool.slice(0, SAMPLE);
const isValidation = (it) => hashString(it.instrument.symbol + ':val') % 10 < 3;
const train = sample.filter((it) => !isValidation(it));
const valid = sample.filter(isValidation);
log(`Strumenti con almeno 7 anni di storico: ${pool.length}; campione ${sample.length} (taratura ${train.length}, verifica ${valid.length})`);

function evaluate(items, outlook) {
  const settings = baseSettings(outlook);
  const rows = [];
  for (const it of items) {
    for (const w of ORIGINS) {
      const r = backtestOne(it, settings, 'forward', { originWeeksAgo: w, sims: SIMS });
      if (r) rows.push(r);
    }
  }
  const loss = rows.reduce((a, r) => a + rowLoss(r), 0) / (rows.length || 1);
  return { loss, rows };
}

// --- ricerca
const t0 = Date.now();
let best = Object.fromEntries(Object.keys(GRID).map((k) => [k, BASE_OUTLOOK[k]]));
let bestLoss = evaluate(train, best).loss;
const startLoss = bestLoss;
log(`Errore iniziale (taratura): ${startLoss.toFixed(4)}`);
for (let pass = 1; pass <= 2; pass++) {
  for (const [key, values] of Object.entries(GRID)) {
    for (const v of values) {
      if (v === best[key]) continue;
      const cand = { ...best, [key]: v };
      const { loss } = evaluate(train, cand);
      if (loss < bestLoss - 1e-6) {
        bestLoss = loss;
        best = cand;
        log(`  passata ${pass}: ${key} = ${v} → ${loss.toFixed(4)}`);
      }
    }
  }
}
log(`Ricerca completata in ${((Date.now() - t0) / 60000).toFixed(1)} min`);

// --- verifica su strumenti mai usati nella taratura
const before = evaluate(valid, Object.fromEntries(Object.keys(GRID).map((k) => [k, BASE_OUTLOOK[k]])));
const after = evaluate(valid, best);
const improvement = 1 - after.loss / before.loss;
const adopt = after.loss < before.loss;
log(`Verifica: errore ${before.loss.toFixed(4)} → ${after.loss.toFixed(4)} (${(improvement * 100).toFixed(1)}%) → ${adopt ? 'ADOTTATO' : 'scartato'}`);

const pick = (s) => ({ risk: s.risk, returns: s.returns });
const report = {
  generatedAt: new Date().toISOString(),
  adopted: adopt,
  params: { before: Object.fromEntries(Object.keys(GRID).map((k) => [k, BASE_OUTLOOK[k]])), after: best },
  grid: GRID,
  origins: ORIGINS.map((w) => w / 52),
  sample: { pool: pool.length, train: train.length, validation: valid.length, sims: SIMS },
  loss: { trainBefore: startLoss, trainAfter: bestLoss, validationBefore: before.loss, validationAfter: after.loss, improvement },
  validation: { before: pick(summarize(before.rows)), after: pick(summarize(after.rows)) },
};
fs.writeFileSync('data/calibration-report.json', JSON.stringify(report, null, 1) + '\n');
const calib = adopt ? { outlook: best, meta: { generatedAt: report.generatedAt, improvement: +improvement.toFixed(4) } } : { outlook: {}, meta: { generatedAt: report.generatedAt, improvement: +improvement.toFixed(4), adopted: false } };
fs.writeFileSync(
  'public/js/calibration.js',
  `// Parametri del modello prospettico tarati dal backtest (scripts/calibrate.js, aggiornato ogni settimana).\n// Vuoto = valori predefiniti di outlook.js.\nexport const CALIBRATION = ${JSON.stringify(calib, null, 2)};\n`,
);
log('Scritti public/js/calibration.js e data/calibration-report.json');
