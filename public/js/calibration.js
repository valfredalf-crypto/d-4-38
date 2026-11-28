// Parametri del modello prospettico tarati dal backtest (scripts/calibrate.js, aggiornato ogni settimana).
// Vuoto = valori predefiniti di outlook.js.
export const CALIBRATION = {
  "outlook": {
    "weightHistory": 0.1,
    "equityPremium": 6,
    "priorUncertainty": 2,
    "regimeUncertainty": 2,
    "minStockBeta": 0.5,
    "ewmaWeight": 0.2,
    "volScale": 1.1,
    "volDrag": 0.5
  },
  "meta": {
    "generatedAt": "2026-11-28T12:27:00.265Z",
    "improvement": 0.0627
  }
};
