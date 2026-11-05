@echo off
REM Avvia Codex Studio + tunnel pubblico sicuro (Cloudflare) su Windows.
REM Usalo dal telefono ovunque: risposte generate da Claude col TUO abbonamento sul PC.
setlocal
cd /d "%~dp0\.."

if "%CODEX_PORT%"=="" set CODEX_PORT=4100
if "%CODEX_USER%"=="" set CODEX_USER=codex
if "%CODEX_PASSWORD%"=="" set CODEX_PASSWORD=codex%RANDOM%%RANDOM%

where node >nul 2>nul || (echo Node.js non trovato: https://nodejs.org & pause & exit /b 1)
where cloudflared >nul 2>nul || (echo cloudflared non trovato: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/ & pause & exit /b 1)
where claude >nul 2>nul && (claude auth status >nul 2>nul || echo ATTENZIONE: esegui prima  claude auth login)

start "Codex" cmd /c "set CODEX_PORT=%CODEX_PORT%&& set CODEX_USER=%CODEX_USER%&& set CODEX_PASSWORD=%CODEX_PASSWORD%&& npm run codex"
timeout /t 3 >nul

echo ============================================================
echo   Qui sotto comparira' un link https://....trycloudflare.com
echo   iPhone/iPad: apri   ^<link^>/?token=%CODEX_PASSWORD%
echo   Oppure inserisci   utente: %CODEX_USER%   password: %CODEX_PASSWORD%
echo   (Tieni il PC acceso con queste finestre aperte.)
echo ============================================================
cloudflared tunnel --url http://localhost:%CODEX_PORT%
pause
