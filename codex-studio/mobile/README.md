# Codex Studio — app mobile

Due modi per avere Codex come **app sul telefono**, entrambi **collegati al tuo account Claude** (le risposte sono generate da Claude sul tuo PC, nessun credito API).

---

## 🍏 iPhone (consigliato: PWA, senza Mac)

Su iPhone un'app nativa richiederebbe **Mac + Xcode + account sviluppatore Apple**. La via pratica, che si installa come app e usa il tuo account Claude, è la **PWA da Safari** puntata al tuo PC via tunnel:

1. Sul **PC**: avvia `codex-studio/avvia-codex-remoto.command` → ottieni un link `https://….trycloudflare.com` e una **password**.
2. Sull'**iPhone (Safari)**: apri il link con il token, cioè `https://….trycloudflare.com/?token=LA_TUA_PASSWORD` (così l'accesso resta salvato anche dentro l'app).
3. Tocca **Condividi → Aggiungi a Home**: compare l'icona **Codex Studio**, a tutto schermo.
4. Aprendo l'app, il motore **«Claude · abbonamento»** è già selezionato: le risposte arrivano da Claude col tuo account.

> Richiede il PC acceso con lo script in esecuzione. È l'equivalente di un'app, senza App Store né Mac.

---

## 🤖 Android / iOS nativo (Capacitor)

Questo progetto impacchetta Codex Studio in un'app nativa con [Capacitor](https://capacitorjs.com).

**Prerequisiti:** Node.js; per Android [Android Studio](https://developer.android.com/studio); per iOS un **Mac con Xcode**.

```bash
cd codex-studio/mobile
npm install

# Per collegare l'app al tuo account Claude, falla puntare al tuo PC (tunnel o LAN):
#   export CODEX_REMOTE_URL="https://....trycloudflare.com"   (macOS/Linux)
#   set     CODEX_REMOTE_URL=https://....trycloudflare.com    (Windows)
# Senza questa variabile l'app funziona offline con il modello nel browser (WebLLM).

npm run add:android      # crea il progetto Android
npm run open:android     # apre Android Studio: Build > Build APK(s) e installa sul telefono

# iOS (solo su Mac):
npm run add:ios
npm run open:ios         # apre Xcode: firma con il tuo Apple ID e installa sul tuo iPhone
```

Per aggiornare l'app dopo modifiche all'interfaccia: `npm run sync`.

> Nota: il motore «abbonamento» ha bisogno del tuo PC (via `CODEX_REMOTE_URL`). Senza, l'app usa il modello locale WebLLM, che nelle WebView mobile può avere supporto WebGPU limitato: per questo su telefono conviene puntare al PC.
