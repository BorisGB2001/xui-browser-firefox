#!/bin/bash
# Signs extension/ (XUI Browser Client) on addons.mozilla.org.
# Channel: unlisted (default, self-distribution) or listed (public AMO listing):
#   scripts/sign.sh            -> unlisted
#   scripts/sign.sh listed     -> submit to the public listing (goes to review)
# Asks for the AMO API credentials (hidden input) unless WEB_EXT_API_KEY /
# WEB_EXT_API_SECRET are already set. Keys: https://addons.mozilla.org/developers/addon/api/key/
# Signed .xpi goes to web-ext-artifacts/.
set -euo pipefail
CHANNEL="${1:-unlisted}"
case "$CHANNEL" in listed|unlisted) shift || true ;; *) echo "Usage: $0 [listed|unlisted]" >&2; exit 1 ;; esac
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ -z "${WEB_EXT_API_KEY:-}" ]; then
  read -r -s -p "JWT issuer (user:...): " WEB_EXT_API_KEY; echo
fi
if [ -z "${WEB_EXT_API_SECRET:-}" ]; then
  read -r -s -p "JWT secret: " WEB_EXT_API_SECRET; echo
fi
if [ -z "$WEB_EXT_API_KEY" ] || [ -z "$WEB_EXT_API_SECRET" ]; then
  echo "Both JWT issuer and JWT secret are required." >&2
  exit 1
fi
export WEB_EXT_API_KEY WEB_EXT_API_SECRET

# A listed version needs a license (and, for the first one, categories and a summary): amo/metadata.json.
META=()
[ "$CHANNEL" = listed ] && [ -f amo/metadata.json ] && META=(--amo-metadata amo/metadata.json)
npx --yes web-ext@8 sign --source-dir extension --artifacts-dir web-ext-artifacts --channel "$CHANNEL" "${META[@]}" "$@"
[ "$CHANNEL" = unlisted ] && ls -1 web-ext-artifacts/*.xpi || echo "Submitted to the public listing: AMO will email you after review."
