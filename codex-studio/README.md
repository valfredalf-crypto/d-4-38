# Codex Studio

App avanzata per **generare documentazione tecnica**, **analizzare codice** e **lavorare con SQL**, con un motore AI collegabile a scelta tra **Claude (Anthropic)**, **Google AI Studio (Gemini)** e **OpenAI (ChatGPT / Codex)**.

Zero dipendenze: solo Node.js (≥ 18). Le chiamate ai provider passano da un **proxy locale** in streaming, così le chiavi restano sul tuo computer e non ci sono problemi di CORS.

## Funzionalità

| Workspace | Cosa fa |
|-----------|---------|
| 📄 **Documenti tecnici** | Architettura, specifica API, ADR, design tecnico, README, runbook, RFC, threat model |
| 🧭 **Analisi codice** | Code review, ricerca bug, refactoring, spiegazione, generazione test, documentazione, ottimizzazione, revisione sicurezza, traduzione tra linguaggi |
| 🗄️ **Analisi SQL** | Spiega, ottimizza, trova problemi, suggerisce indici, converte dialetto, genera da linguaggio naturale, modella lo schema |
| 🚀 **Generatore app** | Progetta l'architettura e genera lo scaffold con codice reale |
| 💬 **Chat** | Conversazione multi-turno con il modello selezionato |

- **Modalità pensiero**: con Claude (Opus 4.8) e i modelli Gemini che lo supportano, mostra il ragionamento del modello in tempo reale.
- **Effort selezionabile**: da `basso` a `massimo` (su Claude controlla la profondità del ragionamento).
- **Streaming**: testo e ragionamento compaiono mentre vengono generati.
- **Markdown + codice**: rendering con tabelle, diagrammi e blocchi di codice con pulsante *Copia*.

## Avvio rapido

```bash
# dalla radice del repository
npm run codex          # avvia su http://localhost:4100
# oppure, senza alcuna chiave, con risposte simulate:
npm run codex:demo
```

Poi apri **http://localhost:4100**, clicca **⚙️ Impostazioni & chiavi** e incolla almeno una chiave API.

## Chiavi API

Puoi fornire le chiavi in due modi (la chiave inserita nell'app ha la precedenza):

1. **Nel pannello Impostazioni dell'app** — salvate solo nel tuo browser (`localStorage`).
2. **Come variabili d'ambiente** — copia `.env.example` e valorizza:

| Provider | Variabile | Dove ottenerla |
|----------|-----------|----------------|
| Claude | `ANTHROPIC_API_KEY` | https://console.anthropic.com/settings/keys |
| Google AI Studio | `GOOGLE_API_KEY` | https://aistudio.google.com/apikey — le chiavi iniziano con `AIza…` |
| OpenAI | `OPENAI_API_KEY` | https://platform.openai.com/api-keys |

```bash
ANTHROPIC_API_KEY=sk-ant-... npm run codex
```

> Le pagine web di **ChatGPT Codex** e **Google AI Studio** sono interfacce interattive: per usarle da un'app serve la rispettiva **API key** dai link qui sopra. Codex Studio non usa e non richiede credenziali di login del browser.

## Modello e parametri per Claude

Codex Studio usa `claude-opus-4-8` con:

- `thinking: { type: "adaptive", display: "summarized" }` quando la modalità pensiero è attiva (il parametro `budget_tokens` non è più supportato su Opus 4.8);
- `output_config: { effort: "high" }` configurabile dalla UI;
- risposta in **streaming** (`stream: true`).

## Struttura

```
codex-studio/
├── server.js            # server HTTP + proxy SSE verso i provider
├── lib/
│   ├── prompts.js       # system prompt e messaggi per ogni workspace
│   └── providers.js     # adattatori streaming: Claude, Gemini, OpenAI, mock
├── public/
│   ├── index.html
│   ├── styles.css
│   └── js/{app.js, markdown.js}
└── test/prompts.test.js
```

## Note sulla sicurezza

- Non committare mai chiavi reali. `.env` è ignorato da git; usa `.env.example` come modello.
- Le chiavi inserite nell'app non lasciano il tuo computer se non per raggiungere il provider scelto.

## Sviluppo

```bash
npm run codex:test     # esegue i test unitari di Codex Studio
```
