@echo off
chcp 65001 >nul
title Controllo Remoto - solo rete locale (WiFi di casa)
cd /d "%~dp0"
echo  Modalita' solo rete locale: niente internet, niente download.
echo  (Windows potrebbe chiedere una volta di consentire l'accesso di rete.)
echo.
powershell -NoProfile -ExecutionPolicy Bypass -STA -File "%~dp0controllo-remoto.ps1" -LanOnly
echo.
pause
