[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$launcher = Join-Path $PSScriptRoot 'start-system-session.ps1'
$repository = Split-Path -Parent $PSScriptRoot
$powershellExe = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'

function Assert-True([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
}

if ([Security.Principal.WindowsIdentity]::GetCurrent().User.Value -ne 'S-1-5-18') {
    $ErrorActionPreference = 'Continue'
    $probe = & $powershellExe -NoProfile -ExecutionPolicy Bypass -File $launcher -CheckOnly 2>&1
    $probeExitCode = $LASTEXITCODE
    $ErrorActionPreference = 'Stop'
    Assert-True ($probeExitCode -ne 0) 'A non-SYSTEM session must fail.'
    Assert-True (($probe | Out-String) -match 'SYSTEM required') 'Expected identity error.'
    Write-Output 'PASS: non-SYSTEM launch rejected. Run as SYSTEM to test successful launches.'
    exit 0
}

$context = (& $powershellExe -NoProfile -ExecutionPolicy Bypass -File $launcher -CheckOnly) | ConvertFrom-Json
Assert-True ($LASTEXITCODE -eq 0) 'SYSTEM probe failed.'
Assert-True ($context.sid -eq 'S-1-5-18') 'Wrong SID.'
Assert-True ($context.is_local_system -eq $true) 'Missing SYSTEM status.'
Assert-True ($context.repository -eq $repository) 'Wrong repository.'

$testDirectory = Join-Path ([IO.Path]::GetTempPath()) ('system-session-test ' + [Guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($testDirectory) | Out-Null
$fakeCli = Join-Path $testDirectory 'fake cli.ps1'
$oldOutput = $env:SYSTEM_SESSION_TEST_OUTPUT
$env:SYSTEM_SESSION_TEST_OUTPUT = Join-Path $testDirectory 'capture.json'
try {
    @'
[ordered]@{ arguments = @($args); directory = (Get-Location).Path } |
    ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $env:SYSTEM_SESSION_TEST_OUTPUT -Encoding UTF8
exit 17
'@ | Set-Content -LiteralPath $fakeCli -Encoding UTF8

    foreach ($client in @('Copilot', 'Claude', 'PowerShell')) {
        & $powershellExe -NoProfile -ExecutionPolicy Bypass -File $launcher -Client $client -Executable $fakeCli
        Assert-True ($LASTEXITCODE -eq 17) "$client exit code was not preserved."
        $capture = Get-Content -LiteralPath $env:SYSTEM_SESSION_TEST_OUTPUT -Raw | ConvertFrom-Json
        Assert-True ($capture.directory -eq $repository) "$client started outside the repository."
        switch ($client) {
            'Copilot' {
                Assert-True (($capture.arguments -join '|') -eq '--allow-all') 'Copilot flags incorrect.'
            }
            'Claude' {
                Assert-True (($capture.arguments[0..2] -join '|') -eq '--permission-mode|bypassPermissions|--settings') 'Claude flags incorrect.'
                Assert-True ($capture.arguments.Count -eq 4) 'Claude settings path was split.'
                $settings = Get-Content -LiteralPath $capture.arguments[3] -Raw | ConvertFrom-Json
                Assert-True ($settings.skipDangerousModePermissionPrompt -eq $true) 'Claude startup setting missing.'
            }
            'PowerShell' {
                Assert-True (($capture.arguments -join '|') -eq '-NoLogo|-NoProfile|-ExecutionPolicy|Bypass') 'PowerShell flags incorrect.'
            }
        }
    }

    # Exercise the real child PowerShell, without starting an AI client.
    & $launcher -Client PowerShell -ClientArguments @('-NonInteractive', '-Command', 'if ((Get-ExecutionPolicy) -ne ''Bypass'') { exit 9 }; exit 0')
    Assert-True ($LASTEXITCODE -eq 0) 'Child PowerShell did not have process-scoped Bypass.'
    $ErrorActionPreference = 'Continue'
    $missingOutput = & $powershellExe -NoProfile -ExecutionPolicy Bypass -File $launcher -Executable (Join-Path $testDirectory 'missing.exe') 2>&1
    $missingExitCode = $LASTEXITCODE
    $ErrorActionPreference = 'Stop'
    Assert-True ($missingExitCode -ne 0) 'Missing executable must fail.'
    Assert-True (($missingOutput | Out-String) -match 'unavailable in the SYSTEM profile') 'Expected missing executable error.'
    Write-Output 'PASS: SYSTEM probe; three clients; spaced paths; working directory; exit codes; process policy; missing executable.'
    Write-Output 'Non-SYSTEM rejection requires running this test from a non-SYSTEM account.'
} finally {
    $env:SYSTEM_SESSION_TEST_OUTPUT = $oldOutput
    # Only known files in the unique test directory are removed; no recursive deletion.
    foreach ($fileName in @('fake cli.ps1', 'capture.json')) {
        $testFile = Join-Path $testDirectory $fileName
        if (Test-Path -LiteralPath $testFile) { Remove-Item -LiteralPath $testFile -Force }
    }
    Remove-Item -LiteralPath $testDirectory
}
