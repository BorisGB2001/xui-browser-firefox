#!/bin/bash
# Упаковывает расширение в dist/xui-browser-<версия>.xpi (неподписанный).
set -euo pipefail
PROJECT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="$(/usr/bin/python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$PROJECT/extension/manifest.json")"
mkdir -p "$PROJECT/dist"
OUT="$PROJECT/dist/xui-browser-$VERSION.xpi"
rm -f "$OUT"
(cd "$PROJECT/extension" && zip -qr -X "$OUT" . -x '.*' -x '__MACOSX*')
echo "$OUT"
