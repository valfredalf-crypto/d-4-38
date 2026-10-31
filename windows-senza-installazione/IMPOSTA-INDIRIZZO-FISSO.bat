@echo off
chcp 65001 >nul
title Imposta indirizzo fisso (ngrok)
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -STA -File "%~dp0imposta-indirizzo-fisso.ps1"
echo.
pause
