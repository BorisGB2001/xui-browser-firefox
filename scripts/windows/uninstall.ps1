# Удаление помощника «XUI Browser Client» (Windows). Серверы (ссылки с ключами)
# удаляются только с флагом -Purge.
param([switch]$Purge)
$ErrorActionPreference = "Stop"
$Base = Join-Path $env:LOCALAPPDATA "XUI-Browser"
$HostExe = Join-Path $Base "host\xui_host.exe"

if (Test-Path $HostExe) { & $HostExe --stop | Out-Null; Write-Host "Туннель остановлен." }
Remove-Item -Force -ErrorAction SilentlyContinue -Path "HKCU:\Software\Mozilla\NativeMessagingHosts\xui_browser"
foreach ($p in @("bin", "host", "run", "host.json", "xui_browser.json")) {
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue -Path (Join-Path $Base $p)
}
if ($Purge) {
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue -Path $Base
    Write-Host "Удалено всё, включая серверы."
} else {
    Write-Host "Помощник удалён. Серверы остались в: $Base\profiles (удалить: uninstall.ps1 -Purge)"
}
