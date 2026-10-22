# TR Monte Carlo

Screener per **azioni, ETF/ETC e crypto disponibili su Trade Republic** con quotazioni aggiornate e
classifica per **rapporto perdita massima a 5 anni / guadagno netto a 5 anni**, stimati con
simulazioni **Monte Carlo** su parametri **prospettici** (non solo proiezione del passato).

Nessuna dipendenza esterna: serve solo Node.js ≥ 18.

**Senza installare nulla (GitHub Codespaces):** su GitHub premi *Code → Codespaces → Create codespace*.
L'app parte da sola e si apre in una nuova scheda del browser (porta 3000). Se la scheda non si apre,
vai nel pannello *Ports* e clicca sull'icona del globo accanto alla porta 3000.

```bash
npm start          # http://localhost:3000 — dati di mercato reali (serve accesso a internet)
npm run demo       # stessa app con dati sintetici, per provarla offline
npm run rank -- --type etf --top 20   # classifica da riga di comando
npm run verify     # verifica dal vivo simboli/ISIN dell'universo contro Yahoo Finance
npm test
```

## Dati

| Cosa | Fonte | Note |
|---|---|---|
| Universo strumenti | `data/instruments.json` (233 strumenti: 158 azioni, 40 ETF/ETC, 35 crypto) | Selezione dei titoli più diffusi su Trade Republic. Ogni ISIN è validato con la cifra di controllo ISO 6166 e la coppia simbolo↔ISIN è stata verificata il 22/10/2026 su fonti pubbliche (Deutsche Börse, justETF, emittenti, SEC). |
| Estensione dell'universo | Ricerca per nome/ticker/ISIN e import CSV dall'app | Accetta la lista ufficiale Xetra *All tradable instruments* di Deutsche Börse (copre gran parte di azioni ed ETF di TR), CSV generici o semplici elenchi di ISIN. |
| Quotazioni | Yahoo Finance (ritardate, aggiornamento automatico ogni 60 s) | Convertite in EUR. Trade Republic quota su LS Exchange: i prezzi possono differire leggermente. |
| Storico | Yahoo Finance, settimanale fino a 10 anni, **aggiustato per dividendi** | Convertito in EUR con il cambio storico settimana per settimana (gestisce anche GBp/pence). Gli ETF hanno già il TER incorporato nel prezzo. |
| Evidenze prospettiche | Yahoo Finance: consenso analisti (target a 12 mesi, numero analisti, raccomandazione), beta, dividend yield, volatilità implicita delle opzioni (titoli USA) | Cache di 12 ore. |

Trade Republic non offre un'API pubblica né un elenco scaricabile degli strumenti: per questo
l'universo parte da una lista verificata ed è estendibile con l'import.

## Modello

### 1. Stima prospettica (per ogni strumento)

Rendimento annuo atteso = media pesata di tre componenti (pesi configurabili, rinormalizzati se una
componente manca):

* **Storico "credibile"** (peso 0,3): la media storica viene ridotta verso l'equilibrio con uno
  *shrinkage* bayesiano normale-normale. La sua credibilità è `(T/σ²) / (T/σ² + 1/τ²)`, con T = anni di
  dati, σ = volatilità e τ = incertezza sull'equilibrio (5%). Con 10 anni di dati: indice globale ≈ 50%,
  azione volatile ≈ 20%, crypto ≈ 5%. In questo modo una bolla passata non viene proiettata nel futuro.
* **Equilibrio CAPM** (peso 0,4): tasso privo di rischio EUR (2%) + β × premio per il rischio azionario
  (5%). Il β è stimato su 5 anni contro l'MSCI World in EUR, con aggiustamento di Blume verso 1.
  Per le crypto vale tasso privo di rischio + premio crypto (0% predefinito: non ci sono fondamentali).
* **Consenso analisti** (peso 0,3, solo con almeno 3 analisti): il rialzo implicito nel prezzo
  obiettivo viene ridotto del 50% (gli analisti sono notoriamente ottimisti) e limitato a ±50%, poi
  sommato al dividend yield. Vale solo per il primo anno; gli anni successivi convergono all'equilibrio.

Volatilità attesa = media della volatilità di lungo periodo, del regime recente (EWMA, λ = 0,97
settimanale) e, dove esiste, della volatilità implicita delle opzioni a circa 90 giorni.

### 2. Simulazione Monte Carlo

* 2.000 scenari (configurabili) a passi settimanali sull'orizzonte di 5 anni.
* **Bootstrap a blocchi** (4 settimane) dei rendimenti reali, ricentrati e riscalati su rendimento e
  volatilità prospettici. Si conservano così code grasse e crash reali, ma con le attese aggiornate.
  In alternativa si può scegliere il moto browniano geometrico.
* Per ogni scenario si calcolano il rendimento finale e il **massimo drawdown** (perdita picco→minimo).

### 3. Metriche e classifica

* **Perdita massima 5a**: in modo predefinito, il max drawdown nel 95° percentile degli scenari, cioè
  uno scenario sfavorevole ma plausibile. In alternativa: drawdown mediano oppure la perdita finale
  nel 5% peggiore dei casi.
* **Guadagno netto 5a**: la mediana (o la media) del rendimento finale al netto di 1 € per ordine
  (acquisto e vendita), dello spread stimato e del **26% di tasse sulle plusvalenze**, applicate solo
  se positive. Capitale di riferimento: 1.000 €.
* **Rapporto = perdita massima / guadagno netto**, ordinato in modo crescente (più basso = migliore).
  Con un guadagno netto ≤ 0 il rapporto è ∞ e lo strumento finisce in fondo alla classifica.

Tutti i parametri si modificano dal pannello **Parametri**. È disponibile anche la modalità
"solo storico", per confronto.

## Struttura

```
server.js              server HTTP + API (/api/instruments, quotes, history, outlook, search, import)
lib/yahoo.js           client Yahoo Finance (gestione cookie/crumb, limite di concorrenza)
lib/market.js          conversione in EUR, cache
lib/importer.js        parser CSV (formato Xetra, CSV generico, elenco di ISIN)
lib/store.js           universo = lista iniziale + modifiche utente (data/user-instruments.json)
public/js/montecarlo.js  motore Monte Carlo (condiviso browser/CLI/test)
public/js/outlook.js     modello prospettico
public/js/app.js         interfaccia (calcoli in Web Worker)
```

> Le simulazioni sono modelli statistici basati su ipotesi: **non sono previsioni né consulenza
> finanziaria**. I rendimenti passati e le stime degli analisti non garantiscono risultati futuri.
