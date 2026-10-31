@echo off
chcp 65001 >nul
title Disattiva avvio automatico
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0disattiva-avvio.ps1"
echo.
pause
