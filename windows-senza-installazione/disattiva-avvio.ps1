# Rimuove l'avvio automatico e ferma l'app in esecuzione. Nessun amministratore.
$ErrorActionPreference = "SilentlyContinue"
$lnk = Join-Path ([Environment]::GetFolderPath('Startup')) 'ControlloRemoto.lnk'
if (Test-Path $lnk) { Remove-Item $lnk -Force }

# ferma i processi powershell che eseguono l'agente
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*controllo-remoto.ps1*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
# ferma il tunnel
Get-Process cloudflared | Stop-Process -Force

Write-Host ""
Write-Host "  Avvio automatico DISATTIVATO e app fermata." -ForegroundColor Green
Write-Host ""
