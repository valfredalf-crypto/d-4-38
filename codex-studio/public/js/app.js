// Codex Studio — logica dell'interfaccia.
import { renderMarkdown } from './markdown.js';

const $ = (sel, root = document) => root.querySelector(sel);
const el = (tag, attrs = {}, html) => { const e = document.createElement(tag); Object.assign(e, attrs); if (html != null) e.innerHTML = html; return e; };

// --- Stato persistente ------------------------------------------------------
const LS = {
  get(k, def) { try { const v = localStorage.getItem(k); return v == null ? def : JSON.parse(v); } catch { return def; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignora */ } },
};
const state = {
  mode: 'doc',
  provider: LS.get('codex.provider', 'claude'),
  thinking: LS.get('codex.thinking', true),
  providers: {},
  keys: LS.get('codex.keys', {}),
  chat: [], // storia della chat {role, content}
  running: null, // AbortController
};

// --- Metadati delle modalità ------------------------------------------------
const MODE_META = {
  doc: { title: 'Documenti tecnici', sub: 'Genera documentazione tecnica avanzata e pronta da pubblicare' },
  code: { title: 'Analisi codice', sub: 'Review, bug, refactoring, test, sicurezza e traduzione di codice' },
  sql: { title: 'Analisi SQL', sub: 'Spiega, ottimizza, genera e modella query e schemi SQL' },
  app: { title: 'Generatore app', sub: 'Progetta e genera lo scaffold di un\'applicazione' },
  chat: { title: 'Chat', sub: 'Conversazione libera con il modello selezionato' },
};

const DOC_TEMPLATES = [
  ['architettura', 'Documento di architettura'], ['specifica-api', 'Specifica API'],
  ['adr', 'ADR — Decision Record'], ['design-tecnico', 'Design tecnico'],
  ['readme', 'README di progetto'], ['runbook', 'Runbook operativo'],
  ['rfc', 'RFC tecnica'], ['sicurezza', 'Threat model (sicurezza)'],
];
const CODE_TASKS = [
  ['review', 'Code review completa'], ['bug', 'Trova bug'], ['refactor', 'Refactoring'],
  ['spiega', 'Spiega il codice'], ['test', 'Genera test'], ['docstring', 'Documenta'],
  ['ottimizza', 'Ottimizza prestazioni'], ['sicurezza', 'Revisione sicurezza'], ['traduci', 'Traduci linguaggio'],
];
const SQL_TASKS = [
  ['spiega', 'Spiega la query'], ['ottimizza', 'Ottimizza'], ['problemi', 'Trova problemi'],
  ['indici', 'Suggerisci indici'], ['converti', 'Converti dialetto'], ['genera', 'Genera da descrizione'],
  ['modella', 'Modella/analizza schema'],
];
const LANGS = ['auto', 'JavaScript', 'TypeScript', 'Python', 'Java', 'C#', 'C++', 'Go', 'Rust', 'PHP', 'Ruby', 'Swift', 'Kotlin', 'Bash', 'HTML/CSS'];
const DIALECTS = ['PostgreSQL', 'MySQL', 'SQLite', 'SQL Server', 'Oracle', 'BigQuery', 'Snowflake', 'standard ANSI'];

// --- Costruzione dei form ---------------------------------------------------
function buildForm(mode) {
  const p = el('div');
  const add = (node) => p.appendChild(node);
  const field = (labelText, control) => { const f = el('div', { className: 'field' }); f.appendChild(el('label', {}, labelText)); f.appendChild(control); return f; };
  const select = (id, pairs) => { const s = el('select', { id }); for (const [v, t] of pairs) s.appendChild(el('option', { value: v }, t)); return s; };
  const area = (id, ph, code) => el('textarea', { id, placeholder: ph, className: code ? 'code' : '' });
  const text = (id, ph) => el('input', { id, type: 'text', placeholder: ph });

  if (mode === 'doc') {
    add(field('Tipo di documento', select('f_template', DOC_TEMPLATES)));
    add(field('Titolo / argomento', text('f_title', 'Es. Piattaforma di pagamenti multi-tenant')));
    add(field('Destinatari', text('f_audience', 'Es. team di ingegneria e stakeholder tecnici')));
    add(field('Contesto e dettagli', area('f_context', 'Descrivi il sistema, i vincoli, le tecnologie già in uso…')));
    add(field('Richieste aggiuntive', area('f_extra', 'Opzionale: sezioni specifiche, formato, lunghezza…')));
  } else if (mode === 'code') {
    const row = el('div', { className: 'row2' });
    row.appendChild(field('Linguaggio', select('f_language', LANGS.map((l) => [l, l === 'auto' ? 'Rileva automaticamente' : l]))));
    row.appendChild(field('Operazione', select('f_task', CODE_TASKS)));
    add(row);
    add(field('Linguaggio di destinazione', text('f_targetLanguage', 'Solo per "Traduci" — es. Go')));
    add(field('Codice', area('f_code', 'Incolla qui il codice…', true)));
    add(field('Note', text('f_extra', 'Opzionale: contesto, framework, obiettivi…')));
  } else if (mode === 'sql') {
    const row = el('div', { className: 'row2' });
    row.appendChild(field('Dialetto', select('f_dialect', DIALECTS.map((d) => [d, d]))));
    row.appendChild(field('Operazione', select('f_task', SQL_TASKS)));
    add(row);
    add(field('Dialetto di destinazione', text('f_targetDialect', 'Solo per "Converti" — es. MySQL')));
    add(field('Richiesta (linguaggio naturale)', area('f_request', 'Solo per "Genera" — es. incasso mensile per cliente nel 2024')));
    add(field('Schema (DDL o descrizione)', area('f_schema', 'Opzionale: CREATE TABLE … oppure descrizione delle tabelle')));
    add(field('Query / SQL', area('f_sql', 'Incolla qui la query…', true)));
  } else if (mode === 'app') {
    add(field('Stack tecnologico', text('f_stack', 'Es. React + Node.js + PostgreSQL (lascia vuoto per farlo scegliere)')));
    add(field('Descrizione dell\'app', area('f_description', 'Cosa deve fare l\'applicazione, per chi, con quali flussi…')));
    add(field('Funzionalità richieste', area('f_features', 'Una per riga: autenticazione, dashboard, export PDF…')));
    add(field('Vincoli / note', text('f_extra', 'Opzionale')));
  } else if (mode === 'chat') {
    add(field('Messaggio', area('f_message', 'Scrivi un messaggio e premi Genera (Ctrl+Invio)…')));
    const clr = el('button', { className: 'ghost', type: 'button' }, '🗑 Nuova conversazione');
    clr.onclick = () => { state.chat = []; renderChat(); };
    add(clr);
  }

  const run = el('button', { className: 'run', id: 'runBtn' }, '▶ Genera');
  run.onclick = onRun;
  add(run);
  add(el('p', { className: 'hint' }, mode === 'chat' ? 'La conversazione mantiene il contesto dei messaggi precedenti.' : 'Suggerimento: usa Ctrl+Invio per generare.'));
  return p;
}

// Mostra/nasconde i campi condizionali di code/sql in base all'operazione.
function wireConditional(mode) {
  const taskSel = $('#f_task');
  if (!taskSel) return;
  const update = () => {
    const t = taskSel.value;
    if (mode === 'code') toggleField('f_targetLanguage', t === 'traduci');
    if (mode === 'sql') { toggleField('f_targetDialect', t === 'converti'); toggleField('f_request', t === 'genera'); }
  };
  taskSel.addEventListener('change', update); update();
}
function toggleField(id, show) { const c = $('#' + id); if (c && c.parentElement) c.parentElement.hidden = !show; }

// --- Raccolta payload -------------------------------------------------------
function collectPayload(mode) {
  const v = (id) => { const e = $('#' + id); return e ? e.value.trim() : ''; };
  if (mode === 'doc') return { template: v('f_template'), title: v('f_title'), audience: v('f_audience'), context: v('f_context'), extra: v('f_extra') };
  if (mode === 'code') return { language: v('f_language'), task: v('f_task'), targetLanguage: v('f_targetLanguage'), code: v('f_code'), extra: v('f_extra') };
  if (mode === 'sql') return { dialect: v('f_dialect'), task: v('f_task'), targetDialect: v('f_targetDialect'), request: v('f_request'), schema: v('f_schema'), sql: v('f_sql') };
  if (mode === 'app') return { stack: v('f_stack'), description: v('f_description'), features: v('f_features'), extra: v('f_extra') };
  if (mode === 'chat') return { messages: state.chat };
  return {};
}

function validate(mode, payload) {
  if (mode === 'code' && !payload.code) return 'Inserisci del codice da analizzare.';
  if (mode === 'sql' && !payload.sql && payload.task !== 'genera' && payload.task !== 'modella') return 'Inserisci una query SQL.';
  if (mode === 'sql' && payload.task === 'genera' && !payload.request) return 'Descrivi cosa deve fare la query.';
  if (mode === 'app' && !payload.description) return 'Descrivi l\'app da generare.';
  if (mode === 'doc' && !payload.title && !payload.context) return 'Inserisci almeno un titolo o del contesto.';
  return null;
}

// --- Esecuzione (streaming SSE) --------------------------------------------
async function onRun() {
  if (state.running) return;
  const mode = state.mode;

  if (mode === 'chat') {
    const msg = $('#f_message').value.trim();
    if (!msg) return;
    state.chat.push({ role: 'user', content: msg });
    $('#f_message').value = '';
    renderChat();
  }

  const payload = collectPayload(mode);
  const err = validate(mode, payload);
  if (err) return setAnswerNotice(err, true);

  const options = { thinking: state.thinking, effort: $('#effort').value, maxTokens: mode === 'chat' ? 8000 : 32000 };
  const bodyData = { provider: state.provider, model: $('#model').value, mode, payload, options, key: state.keys[state.provider] || '' };

  // Prepara l'output
  const answerEl = $('#answer');
  const thinkingBox = $('#thinkingBox');
  const thinkingBody = $('#thinkingBody');
  thinkingBody.textContent = '';
  thinkingBox.hidden = true;
  $('#runMeta').hidden = true;
  let answerText = '';
  let chatBase = '';
  if (mode === 'chat') { chatBase = renderChatHtml(); }
  answerEl.classList.remove('empty');
  answerEl.innerHTML = mode === 'chat' ? chatBase + '<div class="cursor"></div>' : '<div class="cursor"></div>';

  const ctrl = new AbortController();
  state.running = ctrl;
  setRunning(true);

  const paint = () => {
    const html = renderMarkdown(answerText);
    answerEl.innerHTML = (mode === 'chat' ? chatBase : '') + html + '<span class="cursor"></span>';
  };

  try {
    const res = await fetch('/api/generate', {
      method: 'POST', signal: ctrl.signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(bodyData),
    });
    if (!res.ok || !res.body) {
      const e = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      throw new Error(e.error || `HTTP ${res.status}`);
    }
    await readSSE(res.body, (type, data) => {
      if (type === 'thinking') { thinkingBox.hidden = false; thinkingBody.textContent += data.text; thinkingBox.open = true; }
      else if (type === 'text') { answerText += data.text; paint(); }
      else if (type === 'meta') { showMeta(data); }
      else if (type === 'error') { throw new Error(data.message); }
    });
    // Finalizza
    answerEl.innerHTML = (mode === 'chat' ? chatBase : '') + renderMarkdown(answerText);
    if (mode === 'chat') { state.chat.push({ role: 'assistant', content: answerText }); renderChat(); }
    $('#copyAll').hidden = !answerText;
    window._lastAnswer = answerText;
  } catch (e) {
    if (e.name === 'AbortError') { answerEl.innerHTML = (mode === 'chat' ? chatBase : '') + renderMarkdown(answerText) + '<p class="hint">⏹ Interrotto.</p>'; }
    else setAnswerNotice('⚠️ ' + e.message, true);
  } finally {
    state.running = null;
    setRunning(false);
  }
}

async function readSSE(body, onEvent) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const raw = buf.slice(0, idx); buf = buf.slice(idx + 2);
      const type = (raw.match(/^event:\s*(.*)$/m) || [])[1] || 'message';
      const dataLine = (raw.match(/^data:\s*([\s\S]*)$/m) || [])[1];
      if (dataLine == null) continue;
      let data; try { data = JSON.parse(dataLine); } catch { data = { text: dataLine }; }
      onEvent(type.trim(), data);
    }
  }
}

function showMeta(data) {
  const m = $('#runMeta');
  const u = data.usage || {};
  const inTok = u.input_tokens ?? u.promptTokenCount ?? u.prompt_tokens;
  const outTok = u.output_tokens ?? u.candidatesTokenCount ?? u.completion_tokens;
  const parts = [data.model];
  if (inTok != null || outTok != null) parts.push(`${inTok ?? '–'}→${outTok ?? '–'} tok`);
  m.textContent = parts.filter(Boolean).join(' · ');
  m.hidden = false;
}

function setRunning(on) {
  const btn = $('#runBtn');
  if (btn) { btn.disabled = on; btn.textContent = on ? '… Generazione' : '▶ Genera'; }
  $('#stopBtn').hidden = !on;
}
function setAnswerNotice(text, isErr) {
  const a = $('#answer');
  a.classList.add('empty');
  a.innerHTML = `<div><p>${isErr ? '⚠️' : ''} ${text.replace(/</g, '&lt;')}</p></div>`;
}

// --- Chat -------------------------------------------------------------------
function renderChatHtml() {
  return state.chat.map((m) => {
    const who = m.role === 'user' ? '🧑 Tu' : '🤖 Assistente';
    const body = m.role === 'user' ? `<p>${m.content.replace(/</g, '&lt;').replace(/\n/g, '<br>')}</p>` : renderMarkdown(m.content);
    return `<div class="turn ${m.role}"><h3>${who}</h3>${body}</div><hr>`;
  }).join('');
}
function renderChat() {
  const a = $('#answer');
  if (!state.chat.length) { setAnswerNotice('Inizia la conversazione scrivendo un messaggio a sinistra.', false); return; }
  a.classList.remove('empty');
  a.innerHTML = renderChatHtml();
}

// --- Provider / modelli / chiavi -------------------------------------------
function fillProviders() {
  const ps = state.providers;
  const sel = $('#provider'); sel.innerHTML = '';
  for (const [id, p] of Object.entries(ps)) sel.appendChild(el('option', { value: id }, p.label));
  if (!ps[state.provider]) state.provider = Object.keys(ps)[0] || 'claude';
  sel.value = state.provider;
  fillModels();
}
function fillModels() {
  const p = state.providers[state.provider];
  const sel = $('#model'); sel.innerHTML = '';
  if (!p) return;
  for (const m of p.models) sel.appendChild(el('option', { value: m.id }, m.label));
  const saved = LS.get('codex.model.' + state.provider, p.defaultModel);
  sel.value = p.models.some((m) => m.id === saved) ? saved : p.defaultModel;
  // Abilita/disabilita il toggle pensiero in base al supporto
  const sw = $('#thinkSwitch');
  const supports = p.supportsThinking;
  sw.style.opacity = supports ? '1' : '.4';
  sw.title = supports ? '' : 'Questo provider non espone il ragionamento';
}
function renderKeyRows() {
  const box = $('#keyRows'); box.innerHTML = '';
  for (const [id, p] of Object.entries(state.providers)) {
    const row = el('div', { className: 'key-row' });
    const hasEnv = p.envKey;
    const hasLocal = Boolean(state.keys[id]);
    row.appendChild(el('div', { className: 'top' }, `<b>${p.label}</b>${hasEnv ? '<span class="ok">● chiave da variabile d\'ambiente</span>' : (hasLocal ? '<span class="ok">● salvata</span>' : '')}`));
    const input = el('input', { type: 'password', id: 'key_' + id, placeholder: hasEnv ? 'Già configurata lato server (override opzionale)' : 'Incolla la chiave API…', value: state.keys[id] || '' });
    row.appendChild(input);
    row.appendChild(el('div', { className: 'hint', innerHTML: `Ottieni la chiave: <a href="${p.keyUrl}" target="_blank" rel="noopener">${p.keyUrl}</a>` }));
    box.appendChild(row);
  }
}
function saveKeys() {
  const keys = {};
  for (const id of Object.keys(state.providers)) { const i = $('#key_' + id); if (i && i.value.trim()) keys[id] = i.value.trim(); }
  state.keys = keys; LS.set('codex.keys', keys);
  const st = $('#keyStatus'); st.textContent = 'Salvato nel browser ✓'; st.className = 'status';
  setTimeout(() => { $('#settings').close(); }, 500);
  renderKeyRows();
}

// --- Modalità ---------------------------------------------------------------
function switchMode(mode) {
  state.mode = mode;
  for (const b of $('#nav').children) b.classList.toggle('active', b.dataset.mode === mode);
  $('#title').textContent = MODE_META[mode].title;
  $('#subtitle').textContent = MODE_META[mode].sub;
  $('#inputPanel').replaceChildren(buildForm(mode));
  wireConditional(mode);
  $('#copyAll').hidden = true;
  $('#runMeta').hidden = true;
  $('#thinkingBox').hidden = true;
  if (mode === 'chat') renderChat();
  else setAnswerNotice('Compila i campi a sinistra e premi Genera.', false);
  // Ctrl+Invio
  $('#inputPanel').addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); onRun(); }
  });
}

// --- Copia (delega) ---------------------------------------------------------
async function copyText(text, btn) {
  try { await navigator.clipboard.writeText(text); if (btn) { const o = btn.textContent; btn.textContent = 'Copiato ✓'; setTimeout(() => (btn.textContent = o), 1200); } }
  catch { /* clipboard negata */ }
}
document.addEventListener('click', (e) => {
  const copyBtn = e.target.closest('.code-copy');
  if (copyBtn) { const code = copyBtn.closest('.code-wrap')?.querySelector('pre code'); if (code) copyText(code.innerText, copyBtn); }
});

// --- Avvio ------------------------------------------------------------------
async function init() {
  // Tema
  const theme = LS.get('codex.theme', 'dark');
  document.documentElement.dataset.theme = theme;

  try {
    const res = await fetch('/api/providers');
    const data = await res.json();
    state.providers = data.providers || {};
    $('#demoPill').hidden = !data.mock;
  } catch {
    setAnswerNotice('Impossibile contattare il server locale. Avvia con "npm run codex".', true);
  }

  fillProviders();
  renderKeyRows();

  // Toggle pensiero
  const sw = $('#thinkSwitch');
  sw.classList.toggle('on', state.thinking);
  sw.onclick = () => { state.thinking = !state.thinking; sw.classList.toggle('on', state.thinking); LS.set('codex.thinking', state.thinking); };

  // Selettori
  $('#provider').onchange = (e) => { state.provider = e.target.value; LS.set('codex.provider', state.provider); fillModels(); };
  $('#model').onchange = (e) => LS.set('codex.model.' + state.provider, e.target.value);

  // Navigazione
  $('#nav').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) switchMode(b.dataset.mode); });

  // Impostazioni
  $('#openSettings').onclick = () => { renderKeyRows(); $('#keyStatus').textContent = ''; $('#settings').showModal(); };
  $('#closeSettings').onclick = () => $('#settings').close();
  $('#saveKeys').onclick = saveKeys;

  // Tema
  $('#toggleTheme').onclick = () => { const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = t; LS.set('codex.theme', t); };

  // Stop & copia
  $('#stopBtn').onclick = () => { if (state.running) state.running.abort(); };
  $('#copyAll').onclick = (e) => copyText(window._lastAnswer || '', e.target);

  switchMode('doc');
}

init();
