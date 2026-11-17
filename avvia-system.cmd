@echo off
setlocal
rem Let Windows PowerShell rebuild its module path when called from PowerShell 7.
set "PSModulePath="
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-system-session.ps1" %*
exit /b %errorlevel%
