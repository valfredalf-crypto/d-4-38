@echo off
chcp 65001 >nul
title Apri il controllo remoto
color 0E
echo.
echo  ================================================================
echo    APRIRE IL CONTROLLO DELL'ALTRO PC
echo  ================================================================
echo.
echo    Sull'altro PC (quello da controllare) hai avviato
echo    2-AVVIA-SU-QUESTO-PC.bat: li' e' comparso un indirizzo
echo    tipo  http://192.168.1.50:8787
echo.
set /p ADDR=  Incolla qui SOLO i numeri (es. 192.168.1.50):
echo.
echo    Apro il browser...
start "" "http://%ADDR%:8787"
echo.
echo    Nella pagina incolla il TOKEN mostrato sull'altro PC,
echo    poi clicca il dispositivo nella lista.
echo.
timeout /t 4 >nul
