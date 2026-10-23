// Parametri del modello prospettico tarati dal backtest (scripts/calibrate.js, aggiornato ogni settimana).
// Vuoto = valori predefiniti di outlook.js.
export const CALIBRATION = {
  "outlook": {
    "weightHistory": 0.45,
    "equityPremium": 6,
    "priorUncertainty": 2,
    "minStockBeta": 0.7,
    "ewmaWeight": 0,
    "volScale": 0.9
  },
  "meta": {
    "generatedAt": "2026-10-23T23:13:11.213Z",
    "improvement": 0.4164
  }
};
