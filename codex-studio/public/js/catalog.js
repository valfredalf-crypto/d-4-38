// Catalogo dei provider e dei modelli, condiviso tra server e browser (nessun segreto).
export const CATALOG = {
  claude: {
    label: 'Claude (Anthropic)',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    supportsThinking: true,
    models: [
      { id: 'claude-opus-4-8', label: 'Opus 4.8 (consigliato)' },
      { id: 'claude-opus-4-7', label: 'Opus 4.7' },
      { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6 (più veloce)' },
    ],
    defaultModel: 'claude-opus-4-8',
  },
  google: {
    label: 'Google AI Studio (Gemini)',
    keyUrl: 'https://aistudio.google.com/apikey',
    supportsThinking: true,
    models: [
      { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash (veloce)' },
      { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
    ],
    defaultModel: 'gemini-2.5-pro',
  },
  openai: {
    label: 'OpenAI (ChatGPT / Codex)',
    keyUrl: 'https://platform.openai.com/api-keys',
    supportsThinking: false,
    models: [
      { id: 'gpt-4o', label: 'GPT-4o' },
      { id: 'gpt-4o-mini', label: 'GPT-4o mini (veloce)' },
      { id: 'gpt-4.1', label: 'GPT-4.1' },
      { id: 'o4-mini', label: 'o4-mini (reasoning)' },
    ],
    defaultModel: 'gpt-4o',
  },
};

// Nome della variabile d'ambiente lato server per ciascun provider.
export const ENV_KEYS = { claude: 'ANTHROPIC_API_KEY', google: 'GOOGLE_API_KEY', openai: 'OPENAI_API_KEY' };
