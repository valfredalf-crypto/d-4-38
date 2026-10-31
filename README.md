# Controllo remoto (desktop remoto via browser)

Vedi e controlli lo schermo dei **tuoi** computer da una pagina web — stile TeamViewer/AnyDesk,
ma **senza installare nulla sul computer che usi per controllare**: apri un URL nel browser e basta.

**Zero dipendenze npm.** Serve solo **Node.js ≥ 18** e **ffmpeg** (uno strumento di sistema, non un
pacchetto npm). Per iniettare mouse/tastiera serve uno strumento per piattaforma (vedi sotto).

```
┌────────────┐   schermo (MJPEG)   ┌─────────┐   schermo (MJPEG)   ┌────────────────┐
│   AGENTE   │ ──────────────────▶ │  RELAY  │ ──────────────────▶ │  VIEWER        │
│ (sul PC da │                     │ (Node)  │                     │  (il browser,  │
│ controllare)│ ◀───────────────── │         │ ◀───────────────── │  nessuna       │
└────────────┘   input (mouse/tasti)└─────────┘   input (mouse/tasti)│  installazione)│
                                                                     └────────────────┘
```

- **Relay** (`server.js`): un piccolo server Node che gira su qualcosa di **sempre acceso e
  raggiungibile** (un VPS, un Raspberry, un home server, un Codespace…). Inoltra lo schermo e gli input.
- **Agente** (`agent.js`): giralo sul **PC che vuoi controllare**. Cattura lo schermo con ffmpeg e
  riceve mouse/tastiera. È l'unico pezzo che deve girare sul dispositivo remoto — senza di esso,
  nessuno può vederne lo schermo.
- **Viewer** (`public/`): la pagina web servita dal relay. La apri da qualsiasi browser, **niente installazioni**.

> ℹ️ **Perché l'agente è inevitabile.** Non esiste modo di vedere o muovere lo schermo di un computer
> senza che lì giri qualcosa. L'agente è un singolo file Node, senza dipendenze npm: puoi avviarlo
> anche "al volo" (persino da una chiavetta) senza installazione permanente.

---

## Avvio rapido (in locale, per provarlo)

```bash
# 1) avvia il relay con un token a tua scelta
RC_TOKEN=unSegretoLungoACaso npm run relay          # http://localhost:8787

# 2) in un altro terminale, avvia un agente FINTO (schermo di test, niente display richiesto)
RC_TOKEN=unSegretoLungoACaso npm run demo-agent

# 3) apri http://localhost:8787 nel browser, inserisci il token, clicca il dispositivo
```

Per controllare lo **schermo vero** di questo computer (non il pattern di test):

```bash
RC_TOKEN=unSegretoLungoACaso node agent.js --server http://localhost:8787 --name "Il mio PC"
```

---

## Uso reale (controllare i tuoi PC da fuori casa)

1. **Fai girare il relay su una macchina sempre accesa e raggiungibile.**

   ```bash
   RC_TOKEN=<token lungo e casuale> RC_PORT=8787 node server.js
   ```

   Il relay **deve** essere raggiungibile sia dall'agente sia dal browser. Opzioni:
   - un piccolo VPS / server casalingo con una porta esposta;
   - un **tunnel** (Cloudflare Tunnel, `ssh -R`, ngrok…) se il relay è dietro NAT;
   - un **GitHub Codespace** (comodo perché non installi nulla in locale): avvia il relay e rendi
     pubblica la porta 8787 dal pannello *Ports*.

   > 🔒 **Metti sempre HTTPS davanti al relay** (reverse proxy o tunnel). Il viewer invia il token e
   > lo schermo: senza HTTPS viaggiano in chiaro. In `https://…` l'agente e il viewer funzionano
   > identici (basta usare l'URL `https`).

2. **Su ogni PC da controllare, avvia l'agente** (serve Node ≥ 18 + ffmpeg su quel PC):

   ```bash
   node agent.js --server https://relay.esempio.it --token <lo stesso token> --name "Portatile"
   ```

3. **Dal browser** (telefono, altro PC, ovunque) apri l'URL del relay, inserisci il token e scegli il
   dispositivo. Muovi mouse e tastiera direttamente sull'immagine.

---

## Opzioni dell'agente

| Opzione | Default | Descrizione |
|---|---|---|
| `--server <url>` | `http://localhost:8787` | URL del relay (http o https). |
| `--token <t>` | — | **Obbligatorio.** Deve coincidere con `RC_TOKEN` del relay. |
| `--name <n>` | hostname | Nome mostrato nella lista dispositivi. |
| `--fps <n>` | `8` | Fotogrammi al secondo (1–30). Più alto = più fluido ma più banda. |
| `--quality <n>` | `7` | Qualità JPEG ffmpeg `-q:v` (2 = migliore/pesante, 31 = peggiore/leggera). |
| `--scale <WxH>` | — | Ridimensiona per risparmiare banda, es. `--scale 1280:-1`. |
| `--display <:0>` | `$DISPLAY` | (Linux/X11) display da catturare. |
| `--av-input <idx>` | `1:none` | (macOS) input avfoundation; elenco: `ffmpeg -f avfoundation -list_devices true -i ""`. |
| `--no-input` | off | Sola visualizzazione: nessun controllo mouse/tastiera. |
| `--demo` | off | Schermo di test sintetico (per provare senza un display reale). |

Variabili d'ambiente equivalenti: `RC_SERVER`, `RC_TOKEN`, `RC_NAME`.

---

## Requisiti per piattaforma

**Cattura schermo:** sempre **ffmpeg** nel PATH.
- Linux: X11 (`x11grab`). Su Wayland la cattura X11 potrebbe non funzionare — usa una sessione X11.
- macOS: dai a Terminale/Node il permesso *Registrazione schermo* in *Impostazioni → Privacy*.
- Windows: `gdigrab` (incluso in ffmpeg).

**Iniezione mouse/tastiera** (se non usi `--no-input`):
| OS | Strumento | Note |
|---|---|---|
| Linux (X11) | `xdotool` | `sudo apt install xdotool` — **percorso più testato**. |
| macOS | `cliclick` | `brew install cliclick` per il mouse; la tastiera funziona anche via `osascript`. |
| Windows | PowerShell | già incluso; usa `user32 SendInput` + `SendKeys`. |

Se lo strumento manca, l'agente parte comunque in **sola visualizzazione** e lo segnala.

---

## Sicurezza — leggere

Questo è controllo remoto completo: trattalo con serietà.

- **Usalo solo su dispositivi tuoi o per cui hai autorizzazione esplicita.**
- **Token:** usa una stringa lunga e casuale (es. `openssl rand -base64 24`). È l'unica cosa che
  separa i tuoi dispositivi dal resto di internet. Se non lo imposti, il relay ne genera uno e lo stampa.
- **HTTPS obbligatorio** per l'uso fuori da `localhost` (vedi sopra). Il token viaggia anche come
  parametro URL dello stream (necessario perché un tag `<img>` non può mandare header): con HTTPS è
  cifrato, ma può finire nei log del proxy — un motivo in più per ruotarlo se sospetti una fuga.
- **Visibilità:** l'agente stampa a schermo "QUESTO COMPUTER È ORA CONTROLLABILE DA REMOTO" e si ferma
  con `Ctrl+C`, revocando l'accesso all'istante.
- **Nessuna persistenza:** l'agente non si installa come servizio e non si riavvia da solo. Chiudendolo,
  il dispositivo sparisce dalla lista entro ~12 secondi.
- Il relay non salva nulla su disco: tiene in memoria solo l'ultimo fotogramma per inoltrarlo.

Per un uso serio valuta anche: binding del relay solo su `127.0.0.1` + tunnel autenticato, firewall
sulla porta, e un token diverso per ambiti diversi.

---

## Limiti noti (onestà tecnica)

- **Video via MJPEG**, non WebRTC: semplice, robusto e senza dipendenze, ma a parità di fluidità usa
  più banda e ha più latenza di una soluzione WebRTC/H.264. Per LAN o schermi poco animati va benissimo;
  per video a pieno schermo abbassa `--fps`/alza `--quality`/usa `--scale`.
- **Un solo monitor** catturato (lo schermo primario).
- **Wayland** (Linux recenti): la cattura X11 e `xdotool` richiedono una sessione X11.
- Niente audio, niente trasferimento file (si possono aggiungere in seguito).

---

## File

```
server.js          relay: HTTP + stream MJPEG + coda input + token
agent.js           agente da avviare sul PC da controllare
lib/capture.js     cattura schermo via ffmpeg (Linux/macOS/Windows + demo)
lib/inject.js      iniezione input (xdotool / cliclick+osascript / PowerShell)
public/            il viewer nel browser (index.html, app.js, style.css)
```

> Questo branch (`claude/controllo-remoto-desktop`) contiene **solo** il desktop remoto.
> L'app Monte Carlo vive, separata, sul branch `claude/trade-republic-monte-carlo-app-ysf7po`.
