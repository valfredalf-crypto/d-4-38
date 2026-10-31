# Crea un collegamento nella cartella "Esecuzione automatica" dell'utente
# (nessun amministratore) che avvia l'agente nascosto a ogni login, poi lo avvia ora.
$ErrorActionPreference = "Stop"
$dir = $PSScriptRoot
$vbs = Join-Path $dir 'avvio-nascosto.vbs'
$startup = [Environment]::GetFolderPath('Startup')
$lnk = Join-Path $startup 'ControlloRemoto.lnk'

$ws = New-Object -ComObject WScript.Shell
$s = $ws.CreateShortcut($lnk)
$s.TargetPath = 'wscript.exe'
$s.Arguments = '"' + $vbs + '"'
$s.WorkingDirectory = $dir
$s.Description = 'Controllo remoto (avvio automatico in background)'
$s.Save()

Write-Host ""
Write-Host "  Avvio automatico IMPOSTATO." -ForegroundColor Green
Write-Host "  L'app partira' da sola, in background, a ogni accesso a Windows." -ForegroundColor Green
Write-Host ""

# avvia subito anche adesso (nascosto)
Start-Process wscript.exe -ArgumentList ('"' + $vbs + '"')
Write-Host "  Avviata ora in background. Attendo l'indirizzo..." -ForegroundColor Cyan

# aspetta che compaia il file con l'indirizzo e aprilo
$html = Join-Path $dir 'INDIRIZZO-E-TOKEN.html'
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Seconds 1
  if (Test-Path $html) { break }
}
if (Test-Path $html) { Start-Process $html }
else { Write-Host "  (Se non si apre, usa MOSTRA-INDIRIZZO.bat tra qualche secondo.)" -ForegroundColor Yellow }
