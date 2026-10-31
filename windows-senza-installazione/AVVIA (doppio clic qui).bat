@echo off
chcp 65001 >nul
title Controllo Remoto - senza installazione
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -STA -File "%~dp0controllo-remoto.ps1"
echo.
echo  Controllo remoto terminato. Puoi chiudere questa finestra.
pause
