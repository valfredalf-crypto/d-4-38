#!/usr/bin/env bash
# Avvia Codex Studio con un doppio clic (macOS/Linux).
# Motore predefinito: Claude · abbonamento (nessuna chiave, nessun credito API).
set -e
cd "$(dirname "$0")/.." || exit 1

PORT="${CODEX_PORT:-4100}"

if ! command -v node >/dev/null 2>&1; then
  echo "❌ Node.js non trovato. Installalo da https://nodejs.org e riprova."
  read -n 1 -s -r -p "Premi un tasto per chiudere…"; exit 1
fi

if command -v claude >/dev/null 2>&1; then
  if ! claude auth status >/dev/null 2>&1; then
    echo "⚠️  Non risulti connesso a Claude Code. Esegui:  claude auth login"
    echo "    (così usi l'abbonamento senza chiave e senza crediti API)"
  fi
else
  echo "⚠️  Claude Code non trovato: installalo da https://www.anthropic.com/claude-code"
  echo "    Senza di esso puoi usare comunque un motore locale (Ollama) o una chiave API."
fi

# Apre il browser dopo un attimo (su macOS 'open', su Linux 'xdg-open').
( sleep 2
  if command -v open >/dev/null 2>&1; then open "http://localhost:$PORT"
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "http://localhost:$PORT"
  fi
) >/dev/null 2>&1 &

echo "▶ Avvio Codex Studio su http://localhost:$PORT  (Ctrl+C per fermare)"
CODEX_PORT="$PORT" npm run codex
