@echo off
chcp 65001 >nul
title Controllo Remoto - Questo PC e' controllabile
color 0A
cd /d "%~dp0.."

rem --- controlli requisiti ---------------------------------------------------
where node >nul 2>nul || (echo. & echo  Node.js non trovato. Fai prima doppio clic su 1-INSTALLA-REQUISITI.bat & echo. & pause & exit /b)
where ffmpeg >nul 2>nul || (echo. & echo  ffmpeg non trovato. Fai prima doppio clic su 1-INSTALLA-REQUISITI.bat & echo. & pause & exit /b)

rem --- token: generato una volta e riusato -----------------------------------
if not exist "windows\token.txt" (
  powershell -NoProfile -Command "-join ((48..57)+(65..90)+(97..122) | Get-Random -Count 28 | %%{[char]$_})" > "windows\token.txt"
)
set /p RC_TOKEN=<windows\token.txt

rem --- avvia il relay in una finestra separata -------------------------------
start "Relay Controllo Remoto (NON chiudere)" cmd /c "node server.js --token=%RC_TOKEN%"
timeout /t 2 >nul

cls
echo.
echo  ================================================================
echo    QUESTO PC E' ORA CONTROLLABILE DA REMOTO
echo  ================================================================
echo.
echo    Dall'altro dispositivo (telefono o PC, STESSA rete WiFi)
echo    apri il BROWSER a uno di questi indirizzi:
echo.
for /f "tokens=*" %%i in ('powershell -NoProfile -Command "(Get-NetIPAddress -AddressFamily IPv4 ^| Where-Object {$_.IPAddress -ne '127.0.0.1' -and $_.IPAddress -notlike '169.*'}).IPAddress"') do echo         http://%%i:8787
echo.
echo    TOKEN da incollare nella pagina:
echo.
echo         %RC_TOKEN%
echo.
echo  ----------------------------------------------------------------
echo    Se Windows chiede di consentire l'accesso di rete a Node:
echo    clicca CONSENTI (reti private).
echo.
echo    LASCIA APERTE le due finestre. Per fermare tutto: chiudile.
echo  ================================================================
echo.

rem --- avvia l'agente (cattura schermo + mouse/tastiera) ---------------------
node agent.js --server http://localhost:8787 --token %RC_TOKEN% --name "%COMPUTERNAME%"
echo.
echo  (agente terminato)
pause
