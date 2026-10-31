@echo off
chcp 65001 >nul
title Controllo Remoto - senza installazione
cd /d "%~dp0"
if exist "%~dp0errore.txt" del "%~dp0errore.txt" >nul 2>&1
powershell -NoProfile -ExecutionPolicy Bypass -STA -File "%~dp0controllo-remoto.ps1"
echo.
if exist "%~dp0errore.txt" (
  echo  ====================== ERRORE ======================
  type "%~dp0errore.txt"
  echo  ====================================================
  echo  Fai uno screenshot di QUESTO testo e mandamelo.
  echo.
)
echo  Controllo remoto terminato. Puoi chiudere questa finestra.
pause
