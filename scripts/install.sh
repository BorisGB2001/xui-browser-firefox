#!/bin/bash
# Установка помощника для расширения «XUI Browser Client» на macOS и Linux.
#  1. собирает native host (Go) из native-host/;
#  2. ставит xray-core: XRAY_BIN=/путь/xray, иначе xray из PATH (например, brew install xray),
#     иначе сборка из исходников XTLS/Xray-core (нужны git и Go);
#  3. регистрирует native messaging host в Firefox.
# Root не нужен. Повторный запуск обновляет установку.
# Готовый помощник вместо сборки: HOST_BIN=/путь/xui_host ./scripts/install.sh
# Для Windows — scripts/windows/install.ps1.
set -euo pipefail

XRAY_VERSION="${XRAY_VERSION:-v26.11.9}"
EXT_ID="xui-browser@borisgb2001.github.io"
HOST_NAME="xui_browser"
PROJECT="$(cd "$(dirname "$0")/.." && pwd)"

case "$(uname -s)" in
  Darwin)
    BASE="$HOME/Library/Application Support/XUI-Browser"
    MOZ_DIR="$HOME/Library/Application Support/Mozilla/NativeMessagingHosts" ;;
  Linux)
    BASE="${XDG_CONFIG_HOME:-$HOME/.config}/xui-browser"
    MOZ_DIR="$HOME/.mozilla/native-messaging-hosts" ;;
  *) echo "Неподдерживаемая система: $(uname -s). Для Windows используйте scripts/windows/install.ps1." >&2; exit 1 ;;
esac

say() { printf '\033[1;32m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31mОшибка:\033[0m %s\n' "$*" >&2; exit 1; }

mkdir -p "$BASE/bin" "$BASE/host" "$BASE/profiles" "$BASE/run" "$BASE/logs" "$MOZ_DIR"
chmod 700 "$BASE" "$BASE/profiles" "$BASE/run"

GO="$(command -v go || true)"
need_go() { [ -n "$GO" ] || die "Нужен Go 1.22+ (macOS: brew install go; Linux: пакет golang) либо готовые HOST_BIN / XRAY_BIN."; }

# --- native host ----------------------------------------------------------
[ -x "$BASE/host/xui_host" ] && "$BASE/host/xui_host" --stop 2>/dev/null || true  # остановить туннель
# Старый файл удаляем, а не перезаписываем: на macOS запись поверх подписанного бинарника,
# который уже запускался, приводит к SIGKILL (ядро кэширует подпись по inode).
rm -f "$BASE/host/xui_host"
if [ -n "${HOST_BIN:-}" ]; then
  cp "$HOST_BIN" "$BASE/host/xui_host"
else
  need_go
  say "Сборка помощника (native-host, Go)…"
  (cd "$PROJECT/native-host" && CGO_ENABLED=0 "$GO" build -trimpath -ldflags "-s -w" -o "$BASE/host/xui_host" .)
fi
chmod 755 "$BASE/host/xui_host"
say "Помощник: $("$BASE/host/xui_host" --version)"

# --- xray-core ------------------------------------------------------------
XRAY_SRC="${XRAY_BIN:-$(command -v xray || true)}"
rm -f "$BASE/bin/xray"
if [ -n "$XRAY_SRC" ]; then
  say "xray-core: копирую $XRAY_SRC"
  cp "$XRAY_SRC" "$BASE/bin/xray"
else
  need_go
  command -v git >/dev/null || die "Нужен git для сборки xray-core (или укажите XRAY_BIN=/путь/xray)."
  say "Сборка xray-core $XRAY_VERSION из исходников (github.com/XTLS/Xray-core)…"
  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT
  git clone -q --depth 1 --branch "$XRAY_VERSION" https://github.com/XTLS/Xray-core "$TMP/xray-core"
  (cd "$TMP/xray-core" && CGO_ENABLED=0 "$GO" build -o "$BASE/bin/xray" -trimpath -buildvcs=false -ldflags "-s -w -buildid=" ./main)
fi
chmod 755 "$BASE/bin/xray"
say "xray: $("$BASE/bin/xray" version 2>&1 | head -1)"

# --- registration ---------------------------------------------------------
json_escape() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'; }
printf '{\n  "xray": "%s"\n}\n' "$(json_escape "$BASE/bin/xray")" > "$BASE/host.json"
cat > "$MOZ_DIR/$HOST_NAME.json" <<EOF
{
  "name": "$HOST_NAME",
  "description": "XUI Browser Client: xray-core helper",
  "path": "$(json_escape "$BASE/host/xui_host")",
  "type": "stdio",
  "allowed_extensions": ["$EXT_ID"]
}
EOF
say "Native host зарегистрирован: $MOZ_DIR/$HOST_NAME.json"

printf '    self-test: '
"$BASE/host/xui_host" --self-test >/dev/null && echo OK || die "помощник не прошёл самопроверку: $("$BASE/host/xui_host" --self-test)"

say "Готово. Перезапустите Firefox и установите расширение (см. README.md)."
