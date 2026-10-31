@echo off
chcp 65001 >nul
title Controllo Remoto - Installa requisiti (solo la prima volta)
color 0B
echo.
echo  ============================================================
echo    PASSO 1 di 2  -  Installo cio' che serve (una volta sola)
echo  ============================================================
echo.
echo  Installo Node.js e ffmpeg tramite Windows.
echo  Se Windows apre finestre che chiedono conferma: clicca SI'.
echo.

where node >nul 2>nul
if %errorlevel%==0 (
  echo    [OK] Node.js e' gia' presente.
) else (
  echo    Installo Node.js ...
  winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
)

echo.
where ffmpeg >nul 2>nul
if %errorlevel%==0 (
  echo    [OK] ffmpeg e' gia' presente.
) else (
  echo    Installo ffmpeg ...
  winget install -e --id Gyan.FFmpeg --accept-source-agreements --accept-package-agreements
)

echo.
where cloudflared >nul 2>nul
if %errorlevel%==0 (
  echo    [OK] cloudflared e' gia' presente.
) else (
  echo    Installo cloudflared ^(collegamento internet^) ...
  winget install -e --id Cloudflare.cloudflared --accept-source-agreements --accept-package-agreements
)

echo.
echo  ============================================================
echo    FATTO.
echo    Ora CHIUDI questa finestra e fai doppio clic su UNO di:
echo.
echo        2-AVVIA-DA-INTERNET.bat   (per comandare da FUORI casa)
echo        2-AVVIA-SU-QUESTO-PC.bat  (solo stessa rete WiFi)
echo.
echo  ============================================================
echo.
pause
