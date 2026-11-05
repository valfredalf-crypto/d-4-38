// Catalogo dei provider e dei modelli, condiviso tra server e browser (nessun segreto).
//
// `free: true`  -> non consuma crediti API (modello locale o demo).
// `local: true` -> gira sul computer dell'utente, nessuna chiave richiesta.
export const CATALOG = {
  subscription: {
    label: 'Claude · abbonamento (Claude Code, nessun credito API)',
    keyUrl: 'https://www.anthropic.com/claude-code',
    supportsThinking: true,
    free: true,   // usa l'abbonamento Pro/Max: non consuma crediti API
    local: true,  // instradato dalla CLI locale `claude`, nessuna chiave
    cli: true,
    models: [
      { id: 'claude-opus-4-8', label: 'Opus 4.8 (consigliato)' },
      { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6 (più veloce)' },
      { id: 'claude-haiku-4-5', label: 'Haiku 4.5 (leggero)' },
    ],
    defaultModel: 'claude-opus-4-8',
  },
  ollama: {
    label: 'Locale · Ollama (gratis, nessun credito)',
    keyUrl: 'https://ollama.com/download',
    supportsThinking: false,
    free: true,
    local: true,
    models: [
      { id: 'llama3.1', label: 'Llama 3.1 8B (generale)' },
      { id: 'qwen2.5-coder', label: 'Qwen2.5 Coder (codice / SQL)' },
      { id: 'mistral', label: 'Mistral 7B' },
      { id: 'phi3', label: 'Phi-3 (leggero)' },
      { id: 'gemma2', label: 'Gemma 2' },
    ],
    defaultModel: 'llama3.1',
  },
  claude: {
    label: 'Claude (Anthropic) · consuma crediti',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    supportsThinking: true,
    free: false,
    models: [
      { id: 'claude-opus-4-8', label: 'Opus 4.8 (consigliato)' },
      { id: 'claude-opus-4-7', label: 'Opus 4.7' },
      { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6 (più veloce)' },
    ],
    defaultModel: 'claude-opus-4-8',
  },
  google: {
    label: 'Google AI Studio (Gemini) · consuma crediti',
    keyUrl: 'https://aistudio.google.com/apikey',
    supportsThinking: true,
    free: false,
    models: [
      { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash (veloce)' },
      { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
    ],
    defaultModel: 'gemini-2.5-pro',
  },
  openai: {
    label: 'OpenAI (ChatGPT / Codex) · consuma crediti',
    keyUrl: 'https://platform.openai.com/api-keys',
    supportsThinking: false,
    free: false,
    models: [
      { id: 'gpt-4o', label: 'GPT-4o' },
      { id: 'gpt-4o-mini', label: 'GPT-4o mini (veloce)' },
      { id: 'gpt-4.1', label: 'GPT-4.1' },
      { id: 'o4-mini', label: 'o4-mini (reasoning)' },
    ],
    defaultModel: 'gpt-4o',
  },
  webllm: {
    label: 'Nel browser · gratis (WebGPU, nessun credito)',
    keyUrl: 'https://webgpureport.org/',
    supportsThinking: false,
    free: true,        // nessun credito: il modello gira nel browser
    browserOnly: true, // funziona solo lato browser (sito statico), non sul server
    models: [
      { id: 'Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC', label: 'Qwen2.5 Coder 1.5B (codice/SQL)' },
      { id: 'Llama-3.2-3B-Instruct-q4f16_1-MLC', label: 'Llama 3.2 3B' },
      { id: 'Llama-3.2-1B-Instruct-q4f16_1-MLC', label: 'Llama 3.2 1B (leggero/mobile)' },
      { id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC', label: 'Qwen2.5 1.5B' },
      { id: 'Phi-3.5-mini-instruct-q4f16_1-MLC', label: 'Phi-3.5 mini' },
    ],
    defaultModel: 'Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC',
  },
};

// Nome della variabile d'ambiente lato server per ciascun provider.
// `ollama`, `subscription` e `webllm` non usano chiavi (null).
export const ENV_KEYS = { subscription: null, ollama: null, claude: 'ANTHROPIC_API_KEY', google: 'GOOGLE_API_KEY', openai: 'OPENAI_API_KEY', webllm: null };

// Provider gratuiti (nessun credito API). Utile ai frontend che vogliono restare "free".
export const FREE_PROVIDERS = Object.keys(CATALOG).filter((id) => CATALOG[id].free);
