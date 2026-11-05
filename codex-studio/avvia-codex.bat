@echo off
REM Avvia Codex Studio con un doppio clic (Windows).
REM Motore predefinito: Claude - abbonamento (nessuna chiave, nessun credito API).
setlocal
cd /d "%~dp0\.."

if "%CODEX_PORT%"=="" set CODEX_PORT=4100

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js non trovato. Installalo da https://nodejs.org e riprova.
  pause
  exit /b 1
)

where claude >nul 2>nul
if errorlevel 1 (
  echo ATTENZIONE: Claude Code non trovato. Installalo da https://www.anthropic.com/claude-code
  echo Senza di esso puoi usare comunque un motore locale ^(Ollama^) o una chiave API.
) else (
  claude auth status >nul 2>nul
  if errorlevel 1 echo ATTENZIONE: non risulti connesso. Esegui:  claude auth login
)

start "" http://localhost:%CODEX_PORT%
echo Avvio Codex Studio su http://localhost:%CODEX_PORT%  (chiudi questa finestra per fermare)
call npm run codex
pause
