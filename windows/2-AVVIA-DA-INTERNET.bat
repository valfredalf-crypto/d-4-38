@echo off
chcp 65001 >nul
title Controllo Remoto - da INTERNET (ovunque)
color 0A
cd /d "%~dp0.."

rem --- controlli requisiti ---------------------------------------------------
where node >nul 2>nul || (echo. & echo  Node.js non trovato. Fai prima doppio clic su 1-INSTALLA-REQUISITI.bat & echo. & pause & exit /b)
where ffmpeg >nul 2>nul || (echo. & echo  ffmpeg non trovato. Fai prima doppio clic su 1-INSTALLA-REQUISITI.bat & echo. & pause & exit /b)
where cloudflared >nul 2>nul || (echo. & echo  cloudflared non trovato. Fai prima doppio clic su 1-INSTALLA-REQUISITI.bat & echo. & pause & exit /b)

rem --- token: generato una volta e riusato -----------------------------------
if not exist "windows\token.txt" (
  powershell -NoProfile -Command "-join ((48..57)+(65..90)+(97..122) | Get-Random -Count 28 | %%{[char]$_})" > "windows\token.txt"
)
set /p RC_TOKEN=<windows\token.txt

rem --- avvia il relay --------------------------------------------------------
start "Relay (NON chiudere)" cmd /c "node server.js --token=%RC_TOKEN%"
timeout /t 2 >nul

rem --- avvia il tunnel internet (Cloudflare) ---------------------------------
set "LOG=%TEMP%\cf-remote.log"
if exist "%LOG%" del "%LOG%" >nul 2>nul
start "Tunnel Internet (NON chiudere)" cmd /c "cloudflared tunnel --no-autoupdate --url http://localhost:8787 > "%LOG%" 2>&1"

echo.
echo   Creo il collegamento internet sicuro, attendi qualche secondo...
set "PUBURL="
for /l %%s in (1,1,40) do (
  if not defined PUBURL (
    for /f "usebackq tokens=*" %%u in (`powershell -NoProfile -Command "if(Test-Path '%LOG%'){[regex]::Match((Get-Content '%LOG%' -Raw),'https://[a-z0-9-]+\.trycloudflare\.com').Value}"`) do set "PUBURL=%%u"
    if not defined PUBURL timeout /t 1 >nul
  )
)

cls
echo  ================================================================
if defined PUBURL (
  echo    QUESTO PC E' CONTROLLABILE DA QUALSIASI PARTE DEL MONDO
  echo  ================================================================
  echo.
  echo    Da qualunque dispositivo, ovunque, apri nel BROWSER:
  echo.
  echo         %PUBURL%
) else (
  echo    Collegamento creato, ma non ho letto l'indirizzo in automatico.
  echo  ================================================================
  echo.
  echo    Guarda la finestra "Tunnel Internet": c'e' una riga tipo
  echo         https://qualcosa.trycloudflare.com
  echo    Quello e' l'indirizzo da aprire nel browser.
)
echo.
echo    TOKEN da incollare nella pagina:
echo.
echo         %RC_TOKEN%
echo.
echo  ----------------------------------------------------------------
echo    IMPORTANTE: chiunque abbia QUESTO indirizzo + QUESTO token puo'
echo    comandare il PC. Non condividerli. L'indirizzo cambia a ogni avvio.
echo.
echo    Se Windows chiede l'accesso di rete a Node: CONSENTI.
echo    LASCIA APERTE tutte le finestre. Per fermare: chiudile.
echo  ================================================================
echo.

rem --- avvia l'agente (cattura schermo + mouse/tastiera) ---------------------
node agent.js --server http://localhost:8787 --token %RC_TOKEN% --name "%COMPUTERNAME%"
echo.
echo  (agente terminato)
pause
