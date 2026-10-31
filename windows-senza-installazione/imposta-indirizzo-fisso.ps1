# Configura un INDIRIZZO FISSO gratuito con ngrok (nessuna installazione, nessun admin).
# Scarica ngrok.exe (portatile) e salva authtoken + dominio in indirizzo-fisso.txt.
$ErrorActionPreference = "Stop"
$dir = $PSScriptRoot

Write-Host ""
Write-Host "  ================================================================" -ForegroundColor Cyan
Write-Host "    INDIRIZZO FISSO GRATUITO (ngrok)" -ForegroundColor Cyan
Write-Host "  ================================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Serve un account gratuito ngrok. Apro le pagine nel browser." -ForegroundColor White
Write-Host ""
Write-Host "  1) REGISTRATI (gratis, con email o Google):" -ForegroundColor White
Write-Host "       https://dashboard.ngrok.com/signup" -ForegroundColor DarkGray
Write-Host "  2) Copia il tuo AUTHTOKEN da:" -ForegroundColor White
Write-Host "       https://dashboard.ngrok.com/get-started/your-authtoken" -ForegroundColor DarkGray
Write-Host "  3) Crea un DOMINIO FISSO gratuito (pulsante 'New Domain' o 'Create Domain'):" -ForegroundColor White
Write-Host "       https://dashboard.ngrok.com/domains" -ForegroundColor DarkGray
Write-Host "     Avra' un nome tipo:  qualcosa-1234.ngrok-free.app" -ForegroundColor DarkGray
Write-Host ""

# prova ad aprire le pagine nel browser (se non c'e' un browser, non e' un problema)
try { Start-Process "https://dashboard.ngrok.com/signup" } catch {}
Start-Sleep -Milliseconds 600
try { Start-Process "https://dashboard.ngrok.com/get-started/your-authtoken" } catch {}
Start-Sleep -Milliseconds 600
try { Start-Process "https://dashboard.ngrok.com/domains" } catch {}

Write-Host ""
Write-Host "  NON serve un browser su QUESTO PC: puoi registrarti e copiare i due" -ForegroundColor White
Write-Host "  valori anche dal TELEFONO o da un altro computer. Qui basta incollarli." -ForegroundColor White
Write-Host ""
Write-Host "  Quando li hai sotto mano, incollali qui:" -ForegroundColor White
Write-Host ""
$authtoken = (Read-Host "  AUTHTOKEN").Trim()
$domain = (Read-Host "  DOMINIO (es. qualcosa-1234.ngrok-free.app)").Trim()
$domain = $domain -replace '^https?://',''
$domain = $domain.TrimEnd('/')

if (-not $authtoken -or -not $domain) {
  Write-Host ""
  Write-Host "  Mancano authtoken o dominio. Riprova eseguendo di nuovo questo file." -ForegroundColor Yellow
  return
}

Set-Content -Path (Join-Path $dir 'indirizzo-fisso.txt') -Value "$authtoken`r`n$domain" -Encoding ASCII
Write-Host ""
Write-Host "  Salvato. Scarico ngrok (un file portatile, una volta sola)..." -ForegroundColor Cyan

$ngrok = Join-Path $dir "ngrok.exe"
if (-not (Test-Path $ngrok)) {
  $zip = Join-Path $dir "ngrok.zip"
  Invoke-WebRequest -Uri "https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-windows-amd64.zip" -OutFile $zip -UseBasicParsing
  Expand-Archive -Path $zip -DestinationPath $dir -Force
  Remove-Item $zip -ErrorAction SilentlyContinue
}

Write-Host ""
if (Test-Path $ngrok) {
  Write-Host "  ================================================================" -ForegroundColor Green
  Write-Host "    FATTO! D'ora in poi l'indirizzo sara' SEMPRE:" -ForegroundColor Green
  Write-Host "         https://$domain" -ForegroundColor Cyan
  Write-Host "  ================================================================" -ForegroundColor Green
  Write-Host ""
  Write-Host "  Ora avvia normalmente con AVVIA (doppio clic qui).bat" -ForegroundColor White
  Write-Host "  (o riavvia l'avvio automatico se l'avevi impostato)." -ForegroundColor White
} else {
  Write-Host "  Non sono riuscito a scaricare ngrok. Controlla la connessione e riprova." -ForegroundColor Yellow
}
Write-Host ""
