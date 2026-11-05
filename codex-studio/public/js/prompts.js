// Costruzione di system prompt e messaggi per ciascuna modalità di Codex Studio.
// Ogni funzione restituisce { system, messages } pronti per l'API Claude (Messages).
// I prompt sono in italiano ma istruiscono il modello a rispondere nella lingua dell'input.

const BASE = `Sei Codex Studio, un ingegnere del software e technical writer senior.
Lavori con rigore: niente premesse inutili, niente disclaimer superflui, nessuna ripetizione della domanda.
Rispondi SEMPRE nella stessa lingua del contenuto fornito dall'utente (se ambiguo, in italiano).
Usa Markdown ben strutturato: titoli, elenchi, tabelle e blocchi di codice con il linguaggio indicato (\`\`\`sql, \`\`\`ts, ...).
Quando mostri codice, dev'essere completo e corretto, non frammenti con "...".
Sii preciso sui dettagli tecnici; se un'assunzione è necessaria, dichiarala in una riga e prosegui.`;

// ---------------------------------------------------------------------------
// Documenti tecnici
// ---------------------------------------------------------------------------
const DOC_TEMPLATES = {
  architettura: {
    label: 'Documento di architettura',
    guida: `Produci un documento di architettura software completo con queste sezioni:
1. Sintesi esecutiva  2. Contesto e obiettivi  3. Requisiti funzionali e non funzionali (con tabella)
4. Vista dei componenti (descrizione + diagramma Mermaid \`graph TD\`)  5. Flussi dei dati principali
6. Scelte tecnologiche con motivazione e alternative scartate  7. Modello dei dati
8. Scalabilità, affidabilità e osservabilità  9. Sicurezza e gestione dei segreti
10. Rischi e mitigazioni (tabella)  11. Roadmap di adozione.`,
  },
  'specifica-api': {
    label: 'Specifica API',
    guida: `Produci una specifica API completa: panoramica, autenticazione, convenzioni (versioni, errori, paginazione),
e per OGNI endpoint: metodo e path, descrizione, parametri, corpo della richiesta, risposte con codici di stato,
esempi di richiesta/risposta in JSON e un esempio \`curl\`. Includi una tabella riepilogativa degli endpoint
e, se utile, uno schema OpenAPI minimale in YAML.`,
  },
  adr: {
    label: 'ADR (Architecture Decision Record)',
    guida: `Produci un Architecture Decision Record nel formato: Titolo, Stato, Data, Contesto,
Decisione, Alternative considerate (con pro/contro in tabella), Conseguenze (positive e negative), Note di follow-up.`,
  },
  'design-tecnico': {
    label: 'Documento di design tecnico',
    guida: `Produci un technical design doc: Problema, Obiettivi e non-obiettivi, Soluzione proposta,
Design dettagliato (API, modello dati, componenti, diagrammi Mermaid), Edge case, Piano di test,
Piano di rollout e rollback, Metriche di successo, Domande aperte.`,
  },
  readme: {
    label: 'README di progetto',
    guida: `Produci un README professionale: titolo e badge segnaposto, descrizione, funzionalità,
requisiti, installazione, configurazione (variabili d'ambiente in tabella), uso con esempi,
struttura delle cartelle, script disponibili, testing, contribuire, licenza.`,
  },
  runbook: {
    label: 'Runbook operativo',
    guida: `Produci un runbook operativo: scopo, servizi coinvolti, prerequisiti e accessi,
procedure passo-passo per avvio/arresto/deploy/rollback, monitoraggio e allarmi,
troubleshooting (sintomo → causa → azione in tabella), escalation e contatti, checklist post-incidente.`,
  },
  rfc: {
    label: 'RFC tecnica',
    guida: `Produci una RFC: riepilogo, motivazione, progettazione dettagliata, impatto su compatibilità,
alternative, svantaggi, strategia di migrazione, questioni irrisolte.`,
  },
  sicurezza: {
    label: 'Analisi di sicurezza (threat model)',
    guida: `Produci un threat model: descrizione del sistema e confini di fiducia, diagramma dei flussi (Mermaid),
asset e superfici di attacco, minacce classificate STRIDE (tabella: minaccia, componente, impatto, probabilità, mitigazione),
requisiti di sicurezza, raccomandazioni prioritizzate.`,
  },
};

function docMessages({ template, title, context, audience, extra }) {
  const t = DOC_TEMPLATES[template] || DOC_TEMPLATES.architettura;
  const system = `${BASE}

COMPITO: generare un ${t.label} di livello professionale, pronto per la pubblicazione.
${t.guida}

Regole: usa intestazioni Markdown coerenti a partire da \`#\`. Includi contenuti concreti e realistici
(non segnaposto vaghi). Dove un diagramma aiuta, usa Mermaid. Non chiedere chiarimenti: se mancano dettagli,
fai assunzioni ragionevoli e indicale brevemente.`;

  const parti = [
    title ? `Titolo / argomento del documento: ${title}` : null,
    audience ? `Destinatari del documento: ${audience}` : null,
    context ? `Contesto e dettagli forniti:\n${context}` : 'Nessun contesto aggiuntivo fornito: proponi un esempio verosimile e completo.',
    extra ? `Richieste aggiuntive:\n${extra}` : null,
  ].filter(Boolean);

  return { system, messages: [{ role: 'user', content: parti.join('\n\n') }] };
}

// ---------------------------------------------------------------------------
// Analisi del codice
// ---------------------------------------------------------------------------
const CODE_TASKS = {
  review: 'Esegui una code review approfondita: bug e correttezza, sicurezza, prestazioni, leggibilità e manutenibilità. Elenca i problemi ordinati per gravità (Critico/Alto/Medio/Basso) con posizione, spiegazione e correzione proposta. Alla fine fornisci la versione corretta completa del codice.',
  spiega: "Spiega il codice in modo chiaro: cosa fa nel complesso, poi un'analisi sezione per sezione, la complessità algoritmica e i casi limite rilevanti.",
  refactor: 'Esegui il refactoring del codice migliorando leggibilità, struttura e idiomaticità del linguaggio senza cambiarne il comportamento. Fornisci il codice rifattorizzato completo e un elenco puntato delle modifiche con la motivazione.',
  bug: 'Trova i bug e i difetti logici. Per ciascuno: descrizione, come si manifesta (input → output errato), causa, e correzione. Poi fornisci il codice corretto completo.',
  test: 'Genera una suite di test unitari completa e idiomatica per il linguaggio/framework appropriato. Copri casi normali, casi limite e condizioni di errore. Fornisci istruzioni per eseguire i test.',
  docstring: 'Aggiungi documentazione e commenti idiomatici (docstring/JSDoc/ecc.) a funzioni, classi e parti non ovvie. Restituisci il codice completo documentato.',
  ottimizza: 'Ottimizza le prestazioni e/o il consumo di memoria. Spiega i colli di bottiglia, mostra il codice ottimizzato completo e indica il miglioramento atteso in termini di complessità.',
  sicurezza: 'Esegui una revisione di sicurezza: injection, validazione input, autenticazione/autorizzazione, gestione segreti, dipendenze, crittografia. Elenca le vulnerabilità con gravità e correzione, poi il codice corretto.',
};

function codeMessages({ language, task, code, extra, targetLanguage }) {
  const descr = task === 'traduci'
    ? 'Traduci il codice verso il linguaggio di destinazione mantenendone esattamente il comportamento, in modo idiomatico. Fornisci il codice tradotto completo e nota le differenze rilevanti tra i due linguaggi.'
    : (CODE_TASKS[task] || CODE_TASKS.review);
  const system = `${BASE}

COMPITO: analisi del codice. ${descr}
Lavora con precisione tecnica e cita le righe o i simboli pertinenti.`;

  const lang = language && language !== 'auto' ? language : 'rilevalo automaticamente';
  const parti = [
    `Linguaggio: ${lang}.`,
    task === 'traduci' && targetLanguage ? `Traduci verso: ${targetLanguage}.` : null,
    extra ? `Note aggiuntive: ${extra}` : null,
    'Codice da analizzare:',
    '```\n' + (code || '') + '\n```',
  ].filter(Boolean);

  return { system, messages: [{ role: 'user', content: parti.join('\n\n') }] };
}

// ---------------------------------------------------------------------------
// Analisi SQL
// ---------------------------------------------------------------------------
const SQL_TASKS = {
  spiega: 'Spiega la query in linguaggio naturale: cosa restituisce, come funziona ogni clausola/join, e con quale ordine logico viene valutata.',
  ottimizza: 'Ottimizza la query: individua problemi di prestazioni, riscrivila in forma più efficiente ed equivalente, spiega le modifiche e proponi gli indici utili.',
  problemi: 'Individua errori, anti-pattern e rischi (query non sargabili, N+1, cartesian join accidentali, NULL mal gestiti, SQL injection se dinamica). Per ciascuno: problema, impatto, correzione.',
  indici: 'Analizza quali indici creare per supportare la query o il carico descritto. Fornisci le istruzioni CREATE INDEX, spiega la scelta delle colonne e i compromessi su scritture e spazio.',
  converti: "Converti la query mantenendone la semantica verso il dialetto SQL di destinazione, adattando funzioni e sintassi specifiche. Evidenzia le differenze rilevanti.",
  genera: 'Genera la query SQL che soddisfa la richiesta in linguaggio naturale. Fornisci la query commentata, le assunzioni sullo schema e un esempio di risultato atteso.',
  modella: 'Progetta/analizza lo schema: tabelle, chiavi primarie ed esterne, tipi, vincoli e normalizzazione. Fornisci le istruzioni DDL (CREATE TABLE) e un diagramma ER in Mermaid (erDiagram).',
};

function sqlMessages({ dialect, task, sql, schema, request, targetDialect }) {
  const descr = SQL_TASKS[task] || SQL_TASKS.spiega;
  const system = `${BASE}

COMPITO: lavoro su SQL per il dialetto ${dialect || 'standard'}. ${descr}
Tieni conto delle specificità del dialetto indicato (tipi, funzioni, LIMIT/TOP/FETCH, ecc.).`;

  const parti = [
    `Dialetto SQL: ${dialect || 'standard ANSI'}.`,
    task === 'converti' && targetDialect ? `Converti verso il dialetto: ${targetDialect}.` : null,
    schema ? `Schema del database (DDL o descrizione):\n\`\`\`sql\n${schema}\n\`\`\`` : null,
    task === 'genera' && request ? `Richiesta in linguaggio naturale:\n${request}` : null,
    sql ? `Query/SQL fornito:\n\`\`\`sql\n${sql}\n\`\`\`` : null,
  ].filter(Boolean);

  return { system, messages: [{ role: 'user', content: parti.join('\n\n') }] };
}

// ---------------------------------------------------------------------------
// Generatore di app
// ---------------------------------------------------------------------------
function appMessages({ stack, description, features, extra }) {
  const system = `${BASE}

COMPITO: progettare e generare lo scaffold di un'applicazione.
Fornisci, in questo ordine:
1. Una breve panoramica dell'architettura proposta (con diagramma Mermaid se utile).
2. La struttura delle cartelle e dei file (albero in blocco di codice).
3. Il codice completo dei file principali, ciascuno in un proprio blocco con il percorso come intestazione (es. \`### src/app.ts\`).
4. Istruzioni per installazione ed esecuzione.
5. Prossimi passi suggeriti.
Scrivi codice reale e funzionante, non pseudocodice.`;

  const parti = [
    stack ? `Stack tecnologico desiderato: ${stack}.` : 'Scegli uno stack moderno e motivane la scelta.',
    `Descrizione dell'app da creare:\n${description || ''}`,
    features ? `Funzionalità richieste:\n${features}` : null,
    extra ? `Vincoli/note: ${extra}` : null,
  ].filter(Boolean);

  return { system, messages: [{ role: 'user', content: parti.join('\n\n') }] };
}

// ---------------------------------------------------------------------------
// Chat libera (multi-turno)
// ---------------------------------------------------------------------------
function chatMessages({ messages }) {
  const system = `${BASE}

Sei in modalità assistente conversazionale per sviluppo software, documentazione tecnica e SQL.
Rispondi in modo diretto e utile, con codice completo quando serve.`;
  const safe = (Array.isArray(messages) ? messages : [])
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-40);
  return { system, messages: safe.length ? safe : [{ role: 'user', content: 'Ciao' }] };
}

// ---------------------------------------------------------------------------
export const MODES = ['doc', 'code', 'sql', 'app', 'chat'];

export function buildRequest(mode, payload = {}) {
  switch (mode) {
    case 'doc': return docMessages(payload);
    case 'code': return codeMessages(payload);
    case 'sql': return sqlMessages(payload);
    case 'app': return appMessages(payload);
    case 'chat': return chatMessages(payload);
    default: throw Object.assign(new Error(`Modalità sconosciuta: ${mode}`), { status: 400 });
  }
}

export { DOC_TEMPLATES, CODE_TASKS, SQL_TASKS };
