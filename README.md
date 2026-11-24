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

### Light mode (no helper, nothing to install but the add-on)

A 3x-ui inbound of the **HTTP** kind with **TLS** is a plain HTTPS proxy (HTTP CONNECT over TLS with a
username and password), which Firefox can use by itself. Add it in the settings under “Add an HTTPS proxy
server” (or paste `https://user:password@host:port`). The server needs a domain with a trusted certificate
and ALPN `http/1.1`. Such a server does **not** work through the Cloudflare proxy (Cloudflare does not pass
CONNECT); for a CDN use VLESS over XHTTP / WebSocket + TLS, which needs the helper. If a server needs the
helper and it is missing, the add-on says so and tells how to install it.

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

## Install (Windows)

Build the archive with `./scripts/build-windows.sh` (on macOS/Linux, needs Go) → `dist/xui-browser-client-<version>-windows.zip`.
On Windows unpack it and run `install.cmd` (no administrator rights): it copies the helper, downloads the official
`xray-core` release from GitHub with a SHA-256 check and registers the helper in Firefox. Then install the `.xpi`.
Release Firefox only installs a signed `.xpi` (`scripts/sign.sh`); an unsigned one loads temporarily via `about:debugging`.

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
