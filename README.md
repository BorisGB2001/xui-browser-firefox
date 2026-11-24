# XUI Browser Client

Browser-only VPN client for servers of a [3x-ui](https://github.com/MHSanaei/3x-ui) panel
(Xray: VLESS incl. Reality, VMess, Trojan, Shadowsocks). Firefox only for now.
Unofficial; not affiliated with 3x-ui or Project X.

Русская версия: [README.ru.md](README.ru.md)

## How it works

A browser cannot speak Xray protocols itself, so there are two parts:

- **Helper** (`native-host/`, Go, no dependencies) — a native messaging host. It keeps
  the server links on this computer, builds an Xray config and runs `xray-core`, which
  opens a SOCKS5 listener on `127.0.0.1` protected by a random password per start.
- **Extension** (`extension/`, MV3) — sends Firefox traffic to that listener through
  `proxy.onRequest`. Site names are resolved on the server side (remote DNS).

Only browser traffic goes through the VPN; the rest of the system is untouched.

## Features

- Import `vless://`, `vmess://`, `trojan://`, `ss://` links (one or many) and
  subscription addresses (`https://…/sub/…`, base64 list); refresh a subscription with one click.
- Transports: TCP/RAW, WebSocket, gRPC, HTTPUpgrade, XHTTP, mKCP; security: none, TLS, Reality.
- Where the VPN works: all tabs, only marked tabs and containers, or only private windows.
- Split tunneling by site lists and by country of the site.
- Kill switch, WebRTC leak protection, "Check IP" with and without the VPN, traffic counters.
- English and Russian interface.

## Install (macOS, Linux)

Requires Go 1.22+. `xray` is taken from `XRAY_BIN`, else from `PATH` (e.g. `brew install xray`),
else built from the Xray-core sources (needs `git`).

```bash
./scripts/install.sh
```

Then restart Firefox and load the extension: `about:debugging` → This Firefox →
Load Temporary Add-on → `extension/manifest.json` (or install a signed `.xpi`).
Open the add-on settings, paste a server link or a subscription address, pick a server
and turn the VPN on in the toolbar popup.

Remove the helper: `./scripts/uninstall.sh` (`--purge` also deletes the stored servers).

Windows: the helper builds for Windows (`GOOS=windows go build`), but there is no installer yet.

## Data

| What | Where |
| --- | --- |
| Server links (with keys), mode 600 | macOS `~/Library/Application Support/XUI-Browser/profiles`, Linux `~/.config/xui-browser/profiles` |
| Xray log | `…/logs/xray.log` |
| Settings, site lists | Firefox profile (`storage.local`); no keys there |

A subscription address is requested by the helper directly (not through the VPN).

## Development

```bash
(cd native-host && go test ./...)      # helper: link parsing, subscriptions, tunnel with a fake xray
node scripts/test-extension.js         # background script with a mocked browser and helper
node scripts/test-scope.js && node scripts/test-geo.js
npx web-ext@8 lint --source-dir extension
./scripts/build-xpi.sh                 # dist/xui-browser-<version>.xpi (unsigned)
```

License: MIT.
