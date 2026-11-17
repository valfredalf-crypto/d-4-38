[CmdletBinding()]
param(
    [ValidateSet('Copilot', 'Claude', 'PowerShell')]
    [string]$Client = 'Copilot',
    [string]$Executable,
    [switch]$CheckOnly,
    [string[]]$ClientArguments = @()
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
    throw 'This launcher requires Windows. Linux root is not NT AUTHORITY\SYSTEM.'
}

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
if ($identity.User.Value -ne 'S-1-5-18') {
    throw "SYSTEM required; current identity: $($identity.Name). See WINDOWS-SYSTEM.md for the administrator launch command."
}

$repository = Split-Path -Parent $PSScriptRoot
$context = [ordered]@{
    identity = $identity.Name
    sid = $identity.User.Value
    is_local_system = $true
    host_name = $env:COMPUTERNAME
    repository = $repository
    execution_policy = [string](Get-ExecutionPolicy)
    client = $Client
}
if ($CheckOnly) {
    # No CLI, service, login, or network operation is started by this probe.
    $context | ConvertTo-Json
    return
}

switch ($Client) {
    'Copilot' {
        $defaultExecutable = 'copilot'
        $launchArguments = @('--allow-all')
    }
    'Claude' {
        $defaultExecutable = 'claude'
        $launchArguments = @('--permission-mode', 'bypassPermissions', '--settings',
            (Join-Path $repository '.claude\system-session.json'))
    }
    'PowerShell' {
        $defaultExecutable = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
        $launchArguments = @('-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass')
    }
}
if ([string]::IsNullOrWhiteSpace($Executable)) {
    $Executable = $defaultExecutable
}
$command = Get-Command -Name $Executable -CommandType Application, ExternalScript -ErrorAction SilentlyContinue |
    Select-Object -First 1
if (-not $command) {
    throw "Executable '$Executable' is unavailable in the SYSTEM profile. Install the CLI or pass -Executable with its full path."
}

Write-Host "Identity: $($identity.Name) [$($identity.User.Value)]"
Write-Host "Repository: $repository"
Write-Host "Client: $Client; requested mode: $(if ($Client -eq 'PowerShell') { 'ExecutionPolicy Bypass' } else { 'permission bypass' })"
$exitCode = 0
Push-Location -LiteralPath $repository
try {
    # Argument arrays preserve spaces in repository and executable paths.
    $global:LASTEXITCODE = 0
    & $command.Source @launchArguments @ClientArguments
    $exitCode = $LASTEXITCODE
} finally {
    Pop-Location
}
exit $exitCode
