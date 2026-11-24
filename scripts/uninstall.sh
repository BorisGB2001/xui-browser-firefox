#!/bin/bash
# Удаление помощника «XUI Browser Client» (macOS, Linux). Серверы (ссылки с ключами)
# удаляются только с флагом --purge.
set -euo pipefail
case "$(uname -s)" in
  Darwin)
    BASE="$HOME/Library/Application Support/XUI-Browser"
    MANIFEST="$HOME/Library/Application Support/Mozilla/NativeMessagingHosts/xui_browser.json" ;;
  *)
    BASE="${XDG_CONFIG_HOME:-$HOME/.config}/xui-browser"
    MANIFEST="$HOME/.mozilla/native-messaging-hosts/xui_browser.json" ;;
esac

[ -x "$BASE/host/xui_host" ] && "$BASE/host/xui_host" --stop && echo "Туннель остановлен."

rm -f "$MANIFEST"
rm -rf "$BASE/bin" "$BASE/host" "$BASE/run" "$BASE/host.json"
if [ "${1:-}" = "--purge" ]; then
  rm -rf "$BASE"
  echo "Удалено всё, включая серверы."
else
  echo "Помощник удалён. Серверы остались в: $BASE/profiles (удалить: $0 --purge)"
fi
