# Controllo remoto - agente "senza installazione" per Windows 11
# Usa SOLO componenti gia' presenti in Windows (PowerShell 5.1 + .NET):
#   - cattura schermo con System.Drawing (GDI)
#   - muove mouse/tastiera con user32 (nessun admin)
#   - mini server HTTP su 127.0.0.1 con TcpListener (nessun firewall/admin)
# Per il collegamento da internet usa cloudflared.exe (un singolo file portatile).
#
# Niente da installare. Niente amministratore.

param(
  [int]$Port = 8787,
  [string]$Token = "",
  [int]$Quality = 40,
  [switch]$LanOnly,
  [switch]$Background
)

$ErrorActionPreference = "Stop"

# qualunque errore fatale viene scritto in errore.txt (utile per il debug)
trap {
  try { Set-Content -Path (Join-Path $PSScriptRoot 'errore.txt') -Value ((Get-Date).ToString() + "`r`n" + ($_ | Out-String)) } catch {}
  exit 1
}

if (-not $Background) { chcp 65001 > $null 2>&1 }

function Write-AddressFiles([string]$addr, [string]$tok) {
  $when = (Get-Date).ToString('yyyy-MM-dd HH:mm')
  try {
    Set-Content -Path (Join-Path $PSScriptRoot 'INDIRIZZO-E-TOKEN.txt') -Value "Indirizzo: $addr`r`nToken:     $tok`r`n(aggiornato: $when)" -Encoding UTF8
  } catch {}
  $safeAddr = $addr -replace '"','&quot;'
  $html = @"
<!doctype html><html lang="it"><head><meta charset="utf-8">
<meta http-equiv="refresh" content="20"><title>Indirizzo controllo remoto</title>
<style>body{background:#0e1116;color:#e6edf3;font:16px -apple-system,Segoe UI,sans-serif;display:flex;min-height:100vh;margin:0;align-items:center;justify-content:center}
.c{background:#171c24;border:1px solid #2a333f;border-radius:16px;padding:28px;max-width:460px}
a{color:#4f8cff;font-size:20px;word-break:break-all}code{background:#0e1116;border:1px solid #2a333f;padding:4px 8px;border-radius:6px;font-size:18px}
.m{color:#8b98a9;font-size:13px}</style></head><body><div class="c">
<h2>Controllo remoto — in esecuzione</h2>
<p class="m">Apri questo indirizzo dal dispositivo con cui comandi:</p>
<p><a href="$safeAddr">$safeAddr</a></p>
<p class="m">Token da incollare nella pagina:</p>
<p><code>$tok</code></p>
<p class="m">Aggiornato: $when — l'indirizzo cambia a ogni riavvio del PC.</p>
</div></body></html>
"@
  try { Set-Content -Path (Join-Path $PSScriptRoot 'INDIRIZZO-E-TOKEN.html') -Value $html -Encoding UTF8 } catch {}
}
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

# --- input mouse/tastiera via user32 (nessun admin) -------------------------
$sig = @"
using System;
using System.Runtime.InteropServices;
public class RCInput {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
  public const uint LEFTDOWN=0x0002, LEFTUP=0x0004, RIGHTDOWN=0x0008, RIGHTUP=0x0010, MIDDLEDOWN=0x0020, MIDDLEUP=0x0040, WHEEL=0x0800;
  public static void Btn(string b, bool down){
    uint f = down ? (b=="right"?RIGHTDOWN:b=="middle"?MIDDLEDOWN:LEFTDOWN)
                  : (b=="right"?RIGHTUP  :b=="middle"?MIDDLEUP  :LEFTUP);
    mouse_event(f,0,0,0,UIntPtr.Zero);
  }
  public static void Wheel(int d){ mouse_event(WHEEL,0,0,(uint)d,UIntPtr.Zero); }
}
"@
Add-Type -TypeDefinition $sig

# --- token (generato una volta, salvato accanto allo script) ----------------
if (-not $Token) {
  $tf = Join-Path $PSScriptRoot "token.txt"
  if (Test-Path $tf) { $Token = (Get-Content $tf -Raw).Trim() }
  else {
    $Token = -join ((48..57)+(65..90)+(97..122) | Get-Random -Count 28 | ForEach-Object {[char]$_})
    Set-Content -Path $tf -Value $Token -NoNewline
  }
}

# --- schermo + encoder JPEG (riusati per performance) -----------------------
$screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$jpeg = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
$ep = New-Object System.Drawing.Imaging.EncoderParameters(1)
$ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [int64]$Quality)
$bmp = New-Object System.Drawing.Bitmap($screen.Width, $screen.Height)
$gfx = [System.Drawing.Graphics]::FromImage($bmp)

function Get-Frame {
  $gfx.CopyFromScreen($screen.X, $screen.Y, 0, 0, $bmp.Size)
  $ms = New-Object System.IO.MemoryStream
  $bmp.Save($ms, $jpeg, $ep)
  $b = $ms.ToArray()
  $ms.Dispose()
  return ,$b
}

# --- mappa tasti -> SendKeys ------------------------------------------------
$KEYMAP = @{
  'Enter'='{ENTER}'; 'Backspace'='{BACKSPACE}'; 'Tab'='{TAB}'; 'Escape'='{ESC}';
  'Delete'='{DEL}'; 'Insert'='{INSERT}'; 'Home'='{HOME}'; 'End'='{END}';
  'PageUp'='{PGUP}'; 'PageDown'='{PGDN}'; 'ArrowUp'='{UP}'; 'ArrowDown'='{DOWN}';
  'ArrowLeft'='{LEFT}'; 'ArrowRight'='{RIGHT}'; ' '=' ';
  'F1'='{F1}';'F2'='{F2}';'F3'='{F3}';'F4'='{F4}';'F5'='{F5}';'F6'='{F6}';
  'F7'='{F7}';'F8'='{F8}';'F9'='{F9}';'F10'='{F10}';'F11'='{F11}';'F12'='{F12}'
}
function Escape-SendKeys([string]$t) {
  $out = ""
  foreach ($c in $t.ToCharArray()) {
    if ('+^%~(){}[]'.IndexOf($c) -ge 0) { $out += "{$c}" } else { $out += $c }
  }
  return $out
}
function Send-Key($e) {
  $base = $null
  if ($KEYMAP.ContainsKey([string]$e.key)) { $base = $KEYMAP[[string]$e.key] }
  elseif (([string]$e.key).Length -eq 1) { $base = Escape-SendKeys ([string]$e.key) }
  if (-not $base) { return }
  $pre = ""
  if ($e.mods) { if ($e.mods.ctrl) {$pre+='^'}; if ($e.mods.alt) {$pre+='%'}; if ($e.mods.shift) {$pre+='+'} }
  try { [System.Windows.Forms.SendKeys]::SendWait($pre + $base) } catch {}
}

function Invoke-Input($events) {
  foreach ($e in $events) {
    try {
      switch ([string]$e.t) {
        'move'   { [RCInput]::SetCursorPos([int]($screen.X + $e.x*($screen.Width-1)), [int]($screen.Y + $e.y*($screen.Height-1))) }
        'down'   { [RCInput]::SetCursorPos([int]($screen.X + $e.x*($screen.Width-1)), [int]($screen.Y + $e.y*($screen.Height-1))); [RCInput]::Btn([string]$e.button, $true) }
        'up'     { [RCInput]::Btn([string]$e.button, $false) }
        'scroll' { [RCInput]::Wheel($(if ([string]$e.dir -eq 'up') {120} else {-120})) }
        'type'   { try { [System.Windows.Forms.SendKeys]::SendWait((Escape-SendKeys ([string]$e.text))) } catch {} }
        'key'    { Send-Key $e }
      }
    } catch {}
  }
}

# --- mini server HTTP (TcpListener, solo 127.0.0.1) -------------------------
$pageBytes = [System.Text.Encoding]::UTF8.GetBytes((Get-Content (Join-Path $PSScriptRoot "viewer.html") -Raw))

function Write-Response($ns, [string]$status, [string]$ctype, [byte[]]$body) {
  $head = "HTTP/1.1 $status`r`nContent-Type: $ctype`r`nContent-Length: $($body.Length)`r`nCache-Control: no-store`r`nConnection: close`r`n`r`n"
  $hb = [System.Text.Encoding]::ASCII.GetBytes($head)
  $ns.Write($hb, 0, $hb.Length)
  if ($body.Length) { $ns.Write($body, 0, $body.Length) }
  $ns.Flush()
}

function Handle-Client($client) {
  $ns = $client.GetStream()
  $ns.ReadTimeout = 8000
  # leggi header fino a CRLFCRLF
  $ms = New-Object System.IO.MemoryStream
  $buf = New-Object byte[] 4096
  $endIdx = -1
  while ($endIdx -lt 0) {
    $n = $ns.Read($buf, 0, $buf.Length)
    if ($n -le 0) { return }
    $ms.Write($buf, 0, $n)
    $a = $ms.ToArray()
    for ($i=0; $i -le $a.Length-4; $i++) {
      if ($a[$i]-eq13 -and $a[$i+1]-eq10 -and $a[$i+2]-eq13 -and $a[$i+3]-eq10) { $endIdx=$i; break }
    }
    if ($ms.Length -gt 65536) { return }
  }
  $a = $ms.ToArray()
  $headerText = [System.Text.Encoding]::ASCII.GetString($a, 0, $endIdx)
  $lines = $headerText -split "`r`n"
  $parts = $lines[0] -split ' '
  if ($parts.Count -lt 2) { return }
  $method = $parts[0]; $target = $parts[1]
  $path = $target; $query = ""
  if ($target.Contains('?')) { $path = $target.Substring(0, $target.IndexOf('?')); $query = $target.Substring($target.IndexOf('?')+1) }
  $qtoken = ""
  foreach ($kv in ($query -split '&')) { if ($kv -like 'token=*') { $qtoken = [System.Uri]::UnescapeDataString($kv.Substring(6)) } }

  # home page (nessun token richiesto: la pagina lo chiede poi)
  if ($method -eq 'GET' -and ($path -eq '/' -or $path -eq '/index.html')) {
    Write-Response $ns "200 OK" "text/html; charset=utf-8" $pageBytes; return
  }
  # ping per validare il token
  if ($method -eq 'GET' -and $path -eq '/ping') {
    if ($qtoken -eq $Token) { Write-Response $ns "200 OK" "application/json" ([Text.Encoding]::ASCII.GetBytes('{"ok":true}')) }
    else { Write-Response $ns "401 Unauthorized" "text/plain" ([Text.Encoding]::ASCII.GetBytes('no')) }
    return
  }
  # da qui in poi serve il token
  if ($qtoken -ne $Token) { Write-Response $ns "401 Unauthorized" "text/plain" ([Text.Encoding]::ASCII.GetBytes('no')); return }

  if ($method -eq 'GET' -and $path -eq '/frame') {
    $f = Get-Frame
    Write-Response $ns "200 OK" "image/jpeg" $f; return
  }
  if ($method -eq 'POST' -and $path -eq '/input') {
    $cl = 0
    foreach ($l in $lines) { if ($l -like 'Content-Length:*') { $cl = [int]($l.Substring(15).Trim()) } }
    $bodyStart = $endIdx + 4
    $already = $a.Length - $bodyStart
    $body = New-Object byte[] $cl
    if ($already -gt 0) { [Array]::Copy($a, $bodyStart, $body, 0, [Math]::Min($already, $cl)) }
    $read = [Math]::Min($already, $cl)
    while ($read -lt $cl) { $r = $ns.Read($body, $read, $cl-$read); if ($r -le 0) { break }; $read += $r }
    try {
      $json = [System.Text.Encoding]::UTF8.GetString($body) | ConvertFrom-Json
      if ($json.events) { Invoke-Input $json.events }
    } catch {}
    Write-Response $ns "200 OK" "application/json" ([Text.Encoding]::ASCII.GetBytes('{"ok":true}')); return
  }
  Write-Response $ns "404 Not Found" "text/plain" ([Text.Encoding]::ASCII.GetBytes('404'))
}

# apri il listener PRIMA del tunnel (cosi' cloudflared trova la porta pronta)
$ip = if ($LanOnly) { [System.Net.IPAddress]::Any } else { [System.Net.IPAddress]::Loopback }
# se 8787 e' occupata, prova le porte successive (nessun conflitto con altre app)
$listener = $null
for ($p = $Port; $p -lt $Port + 12; $p++) {
  try { $l = New-Object System.Net.Sockets.TcpListener($ip, $p); $l.Start(); $listener = $l; $Port = $p; break }
  catch { }
}
if (-not $listener) {
  if (-not $Background) { Write-Host "  Nessuna porta libera trovata. Riavvia il PC e riprova." -ForegroundColor Yellow }
  exit 0
}

# --- collegamento internet (cloudflared portatile) --------------------------
$pub = ""
if (-not $LanOnly) {
  $cf = Join-Path $PSScriptRoot "cloudflared.exe"
  if (-not (Test-Path $cf)) {
    Write-Host "  Scarico il collegamento internet (un file, una volta sola)..." -ForegroundColor Cyan
    try {
      Invoke-WebRequest -Uri "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe" -OutFile $cf -UseBasicParsing
    } catch {
      Write-Host "  Non sono riuscito a scaricare cloudflared ($($_.Exception.Message))." -ForegroundColor Yellow
      Write-Host "  Puoi comunque usarlo sulla stessa rete: riavvia con l'opzione rete locale." -ForegroundColor Yellow
    }
  }
  if (Test-Path $cf) {
    $log = Join-Path $env:TEMP "cf-rc-out.log"
    $errlog = Join-Path $env:TEMP "cf-rc-err.log"
    Remove-Item $log,$errlog -ErrorAction SilentlyContinue
    Start-Process -FilePath $cf -ArgumentList @("tunnel","--no-autoupdate","--url","http://localhost:$Port") -RedirectStandardOutput $log -RedirectStandardError $errlog -WindowStyle Hidden | Out-Null
    Write-Host "  Creo il collegamento internet, attendi..." -ForegroundColor Cyan
    for ($i=0; $i -lt 40 -and -not $pub; $i++) {
      Start-Sleep -Seconds 1
      foreach ($f in @($errlog,$log)) {
        if (Test-Path $f) {
          $c = Get-Content $f -Raw -ErrorAction SilentlyContinue
          if ($c) {
            $m = [regex]::Match([string]$c, 'https://[a-z0-9-]+\.trycloudflare\.com')
            if ($m.Success) { $pub = $m.Value; break }
          }
        }
      }
    }
  }
}

# --- indirizzo + banner -----------------------------------------------------
$addr = ""
if ($LanOnly) {
  $lan = ([System.Net.Dns]::GetHostAddresses([System.Net.Dns]::GetHostName()) | Where-Object { $_.AddressFamily -eq 'InterNetwork' } | Select-Object -First 1)
  if ($lan) { $addr = "http://$($lan.IPAddressToString):$Port" }
} elseif ($pub) { $addr = $pub }

Write-AddressFiles $addr $Token

if (-not $Background) {
  Clear-Host
  Write-Host ""
  Write-Host "  ================================================================" -ForegroundColor Green
  Write-Host "    QUESTO PC E' ORA CONTROLLABILE DA REMOTO" -ForegroundColor Green
  Write-Host "    (nessuna installazione, nessun amministratore)" -ForegroundColor DarkGray
  Write-Host "  ================================================================" -ForegroundColor Green
  Write-Host ""
  if ($addr) {
    if ($LanOnly) { Write-Host "    Apri il BROWSER (stessa rete WiFi) a:" -ForegroundColor White }
    else { Write-Host "    Da QUALUNQUE dispositivo, ovunque, apri nel BROWSER:" -ForegroundColor White }
    Write-Host ""
    Write-Host "         $addr" -ForegroundColor Cyan
  } else {
    Write-Host "    Indirizzo non pronto. Riprova, o usa SOLO-RETE-LOCALE.bat." -ForegroundColor Yellow
  }
  Write-Host ""
  Write-Host "    TOKEN da incollare nella pagina:" -ForegroundColor White
  Write-Host ""
  Write-Host "         $Token" -ForegroundColor Yellow
  Write-Host ""
  Write-Host "  ----------------------------------------------------------------" -ForegroundColor DarkGray
  Write-Host "    Indirizzo e token sono anche nel file INDIRIZZO-E-TOKEN.html" -ForegroundColor DarkGray
  Write-Host "    Chi ha indirizzo + token puo' comandare il PC: non condividerli." -ForegroundColor DarkGray
  Write-Host "    Per FERMARE tutto: chiudi questa finestra." -ForegroundColor DarkGray
  Write-Host "  ================================================================" -ForegroundColor Green
  Write-Host ""
}

# --- loop del server (bloccante) --------------------------------------------
while ($true) {
  $client = $listener.AcceptTcpClient()
  try { Handle-Client $client } catch {} finally { $client.Close() }
}
