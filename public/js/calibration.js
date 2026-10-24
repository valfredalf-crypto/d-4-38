// Parametri del modello prospettico tarati dal backtest (scripts/calibrate.js, aggiornato ogni settimana).
// Vuoto = valori predefiniti di outlook.js.
export const CALIBRATION = {
  "outlook": {
    "weightHistory": 0.45,
    "equityPremium": 6,
    "priorUncertainty": 10,
    "minStockBeta": 0.7,
    "ewmaWeight": 0,
    "volScale": 1.1
  },
  "meta": {
    "generatedAt": "2026-10-24T00:07:54.108Z",
    "improvement": -0.0056
  }
};
