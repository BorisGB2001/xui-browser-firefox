#!/bin/bash
# Собирает архив для Windows: dist/xui-browser-client-<версия>-windows.zip
#   xui_host.exe (Go, windows/amd64; на Windows ARM работает через эмуляцию x64),
#   install.cmd / install.ps1, uninstall.*, README.txt и расширение: подписанный
#   dist/xui-browser-<версия>-signed.xpi, если он есть, иначе неподписанный (с предупреждением).
# xray.exe установщик скачивает сам со сверкой SHA-256.
set -euo pipefail
PROJECT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="$(sed -n 's/^  "version": "\(.*\)",$/\1/p' "$PROJECT/extension/manifest.json")"
STAGE="$PROJECT/build/windows-pkg"
OUT="$PROJECT/dist/xui-browser-client-$VERSION-windows.zip"

rm -rf "$STAGE" && mkdir -p "$STAGE" "$PROJECT/dist"
(cd "$PROJECT/native-host" && GOOS=windows GOARCH=amd64 CGO_ENABLED=0 \
  go build -trimpath -ldflags "-s -w -H windowsgui" -o "$STAGE/xui_host.exe" .)
cp "$PROJECT"/scripts/windows/{install.cmd,install.ps1,uninstall.cmd,uninstall.ps1} "$STAGE/"
sed 's/$/\r/' "$PROJECT/scripts/windows/README.txt" > "$STAGE/README.txt"

SIGNED="$PROJECT/dist/xui-browser-$VERSION-signed.xpi"
if [ -f "$SIGNED" ]; then
  cp "$SIGNED" "$STAGE/"
else
  "$PROJECT/scripts/build-xpi.sh" >/dev/null
  cp "$PROJECT/dist/xui-browser-$VERSION.xpi" "$STAGE/xui-browser-$VERSION-unsigned.xpi"
  echo "Внимание: нет $SIGNED — в архиве неподписанное расширение (только временная загрузка через about:debugging)." >&2
fi

rm -f "$OUT"
(cd "$STAGE" && zip -qr -X "$OUT" .)
echo "$OUT"
unzip -l "$OUT"
