@echo off
chcp 65001 >nul
title Imposta avvio automatico in background
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -STA -File "%~dp0imposta-avvio.ps1"
echo.
pause
