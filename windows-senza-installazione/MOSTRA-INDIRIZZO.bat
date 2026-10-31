@echo off
chcp 65001 >nul
title Indirizzo e token correnti
cd /d "%~dp0"
if exist "%~dp0INDIRIZZO-E-TOKEN.html" (
  start "" "%~dp0INDIRIZZO-E-TOKEN.html"
) else (
  echo  Non ho ancora un indirizzo: avvia prima l'app ^(AVVIA o avvio automatico^)
  echo  e riprova tra qualche secondo.
  echo.
  pause
)
