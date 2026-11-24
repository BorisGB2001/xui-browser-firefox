# Установка помощника для расширения «XUI Browser Client» на Windows.
#  1. копирует xui_host.exe (native host) в %LOCALAPPDATA%\XUI-Browser\host;
#  2. ставит xray-core: xray.exe рядом со скриптом, параметр -XrayExe или загрузка
#     официального релиза XTLS/Xray-core с GitHub со сверкой SHA-256;
#  3. регистрирует native messaging host в Firefox (HKCU, права администратора не нужны).
# Запуск: двойной щелчок по install.cmd или
#   powershell -NoProfile -ExecutionPolicy Bypass -File install.ps1
param(
    [string]$XrayExe = ""
)
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$XrayVersion = "v26.11.9"
# SHA2-256 из Xray-windows-64.zip.dgst релиза XTLS/Xray-core v26.11.9
$XraySha256 = "1262522266337b824f07beb8e1375786b437683b3890105469088f8e17e0a69d"
$XrayUrl = "https://github.com/XTLS/Xray-core/releases/download/$XrayVersion/Xray-windows-64.zip"
$ExtId = "xui-browser@borisgb2001.github.io"
$HostName = "xui_browser"

$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$Base = Join-Path $env:LOCALAPPDATA "XUI-Browser"
$HostDir = Join-Path $Base "host"
$BinDir = Join-Path $Base "bin"

function Say($m) { Write-Host "==> $m" -ForegroundColor Green }
function Die($m) { Write-Host "Ошибка: $m" -ForegroundColor Red; exit 1 }

foreach ($d in @($Base, $HostDir, $BinDir, (Join-Path $Base "profiles"), (Join-Path $Base "run"), (Join-Path $Base "logs"))) {
    New-Item -ItemType Directory -Force -Path $d | Out-Null
}

# Остановить работающий туннель, иначе exe-файлы заняты.
$HostExe = Join-Path $HostDir "xui_host.exe"
if (Test-Path $HostExe) { & $HostExe --stop | Out-Null }

# --- native host ----------------------------------------------------------
$SrcHost = Join-Path $Here "xui_host.exe"
if (-not (Test-Path $SrcHost)) { Die "Рядом со скриптом нет xui_host.exe. Распакуйте весь архив." }
Copy-Item -Force $SrcHost $HostExe
Unblock-File $HostExe
Say "Помощник: $((& $HostExe --version | Out-String).Trim())"

# --- xray-core ------------------------------------------------------------
$Xray = Join-Path $BinDir "xray.exe"
if (-not $XrayExe -and (Test-Path (Join-Path $Here "xray.exe"))) { $XrayExe = Join-Path $Here "xray.exe" }
if ($XrayExe) {
    Copy-Item -Force $XrayExe $Xray
} else {
    Say "Загрузка xray-core $XrayVersion с GitHub…"
    $Tmp = Join-Path ([IO.Path]::GetTempPath()) ("xui-" + [guid]::NewGuid())
    New-Item -ItemType Directory -Path $Tmp | Out-Null
    try {
        $Archive = Join-Path $Tmp "xray.zip"
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest -UseBasicParsing -Uri $XrayUrl -OutFile $Archive
        $Hash = (Get-FileHash -Algorithm SHA256 $Archive).Hash.ToLower()
        if ($Hash -ne $XraySha256) { Die "Контрольная сумма xray не совпала ($Hash). Загрузка прервана." }
        Expand-Archive -Path $Archive -DestinationPath (Join-Path $Tmp "x") -Force
        $Found = Get-ChildItem -Path $Tmp -Recurse -Filter "xray.exe" | Select-Object -First 1
        if (-not $Found) { Die "В архиве нет xray.exe." }
        Copy-Item -Force $Found.FullName $Xray
    } finally {
        Remove-Item -Recurse -Force $Tmp -ErrorAction SilentlyContinue
    }
}
Unblock-File $Xray
Say "xray: $((& $Xray version | Select-Object -First 1 | Out-String).Trim())"

# --- registration ---------------------------------------------------------
$Utf8 = New-Object System.Text.UTF8Encoding($false)
[IO.File]::WriteAllText((Join-Path $Base "host.json"), (@{ xray = $Xray } | ConvertTo-Json), $Utf8)

$ManifestPath = Join-Path $Base "$HostName.json"
$Manifest = [ordered]@{
    name               = $HostName
    description        = "XUI Browser Client: xray-core helper"
    path               = $HostExe
    type               = "stdio"
    allowed_extensions = @($ExtId)
}
[IO.File]::WriteAllText($ManifestPath, ($Manifest | ConvertTo-Json), $Utf8)

$Key = "HKCU:\Software\Mozilla\NativeMessagingHosts\$HostName"
New-Item -Force -Path $Key | Out-Null
Set-Item -Path $Key -Value $ManifestPath
Say "Native host зарегистрирован: $Key -> $ManifestPath"

$Test = (& $HostExe --self-test | Out-String).Trim()
if ($LASTEXITCODE -ne 0) { Die "помощник не прошёл самопроверку: $Test" }
Write-Host "    self-test: OK"
Say "Готово. Перезапустите Firefox и установите расширение (файл .xpi из архива)."
