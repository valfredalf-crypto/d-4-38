# Codex Studio

**App unica** per **generare documentazione tecnica**, **generare app**, **analizzare codice** e **lavorare con SQL**: scegli l'**ambiente** (workspace) dalla barra laterale e il **motore AI** dalla barra in alto.

Il motore **predefinito** è **Claude · abbonamento** (instradato dalla **CLI di Claude Code** con cui sei già loggato): usa il tuo **abbonamento Pro/Max**, **non consuma crediti API** e non richiede nessuna chiave. In alternativa puoi usare un modello **locale gratuito** (Ollama) oppure, se vuoi, i motori a consumo (Claude API, Gemini, OpenAI).

Zero dipendenze: solo Node.js (≥ 18). Le chiamate passano da un **proxy locale** in streaming, così chiavi e dati restano sul tuo computer e non ci sono problemi di CORS.

## Motori (provider)

| Motore | Costo | Chiave | Note |
|--------|-------|--------|------|
| **Claude · abbonamento** (default) | **0 crediti API** | nessuna | Via CLI `claude` (Claude Code) già connessa al tuo abbonamento. Richiede Claude Code installato e l'accesso eseguito. |
| **Locale · Ollama** | **gratis** | nessuna | Gira in locale; richiede [Ollama](https://ollama.com/download) in esecuzione (`ollama serve`). |
| Claude (Anthropic) API | consuma crediti | `ANTHROPIC_API_KEY` | Opzionale. |
| Google AI Studio (Gemini) | consuma crediti | `GOOGLE_API_KEY` | Opzionale. |
| OpenAI (ChatGPT / Codex) | consuma crediti | `OPENAI_API_KEY` | Opzionale. |

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
# oppure, senza nulla, con risposte simulate (DEMO):
npm run codex:demo
```

Poi apri **http://localhost:4100**. Con il motore predefinito (**Claude · abbonamento**) sei già pronto: non serve alcuna chiave, basta avere **Claude Code** installato e aver fatto l'accesso (`claude` nel terminale). Scegli l'ambiente a sinistra e premi **Genera**.

### Motore abbonamento (default, nessun credito API)

Le richieste vengono instradate alla CLI locale:

```
claude -p --output-format stream-json --include-partial-messages --verbose \
  --model claude-opus-4-8 --max-turns 1 --permission-prompts none \
  --strict-mcp-config --allowedTools --system-prompt "<system>"
```

- Usa l'**abbonamento** con cui sei loggato in Claude Code → **nessun consumo di crediti API**.
- Generazione pura: nessun tool, nessun prompt di permessi, un solo turno.
- Attivando **Pensiero** nella UI viene impostato `MAX_THINKING_TOKENS` per abilitare il ragionamento esteso.
- Se il binario non è nel `PATH`, impostalo con `CLAUDE_CLI_BIN=/percorso/claude`.

**Prerequisiti (una volta sola):**

1. [Node.js](https://nodejs.org) ≥ 18.
2. [Claude Code](https://www.anthropic.com/claude-code) installato e **accesso eseguito** (apri un terminale, lancia `claude` e fai il login con il tuo abbonamento).

Poi, dalla radice del repository, `npm run codex`. Nessuna chiave, nessun credito API.

### Dal telefono (stessa rete Wi-Fi)

Il server è raggiungibile anche dal telefono, **senza chiave**, perché è il computer a eseguire Claude Code:

1. Tieni il PC acceso con `npm run codex` in esecuzione.
2. All'avvio il server stampa gli indirizzi da usare, es. `http://192.168.1.50:4100`.
3. Sul telefono (connesso alla **stessa Wi-Fi**) apri quell'indirizzo nel browser.

> È un uso in **rete locale**: quando spegni il PC o esci dalla Wi-Fi, l'app non è raggiungibile. Non è un sito pubblico sempre acceso (quello richiederebbe una chiave API e consumerebbe crediti). Su `http://<ip>` l'installazione come app (PWA) può essere limitata dal browser perché non è HTTPS: usala comunque dal browser del telefono.

### Modello locale gratuito (Ollama)

Scegli **Locale · Ollama** come motore. Richiede Ollama attivo:

```bash
ollama serve
ollama pull llama3.1        # oppure qwen2.5-coder per codice/SQL
# host non standard: OLLAMA_HOST=http://host:porta npm run codex
```

### Motori a consumo (opzionali, consumano crediti API)

Solo se scegli Claude API / Gemini / OpenAI servono le chiavi, in due modi (quella inserita nell'app ha la precedenza):

1. **Nel pannello ⚙️ Impostazioni dell'app** — salvate solo nel tuo browser (`localStorage`).
2. **Come variabili d'ambiente** — copia `.env.example` e valorizza `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`, `OPENAI_API_KEY`.

## Parametri per Claude

Il motore **abbonamento** usa `claude-opus-4-8` (effort **alto** e **pensiero** attivi di default). Il motore **Claude API** (a consumo) usa `claude-opus-4-8` con:

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
