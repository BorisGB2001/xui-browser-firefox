# AMO listing — XUI Browser Client

Copy these texts into the Developer Hub form (addons.mozilla.org → Developer Hub → the add-on → Edit Product Page; descriptions are Markdown). The default locale is English (en-US); the Russian texts go in as a translation (“Manage Translations” → Русский).

Before submitting to the public listing: Versions 0.1.0 and 0.1.1 are taken (signed unlisted). The first listed version is **0.1.2**: `scripts/sign.sh listed`, or upload `dist/xui-browser-0.1.2.xpi` on the site (Upload New Version → “On this site”).

## Basic info

| Field | Value |
|---|---|
| Name (en-US) | XUI Browser Client |
| Name (ru) | XUI — клиент для браузера |
| Add-on URL slug | `xui-browser-client` |
| Categories | **Privacy & Security** |
| License | MIT |
| Homepage | https://github.com/BorisGB2001/xui-browser-firefox |
| Support site | https://github.com/BorisGB2001/xui-browser-firefox/issues |
| Support email | (optional — leave empty or use a public address) |
| Privacy policy | paste `PRIVACY.md` |
| Experimental | no |
| Requires payment | no |

## Summary (en-US, ≤ 250 characters)

Browser-only VPN client for your own 3x-ui / Xray server: VLESS, VMess, Trojan, Shadowsocks via a small helper, or a plain HTTPS proxy with no helper. Route by sites, tabs, containers, private windows or countries. Unofficial, open source.

## Summary (ru)

VPN-клиент только для браузера для вашего сервера 3x-ui / Xray: VLESS, VMess, Trojan, Shadowsocks через небольшой помощник или обычный HTTPS-прокси без него. Маршруты по сайтам, вкладкам, контейнерам, приватным окнам и странам. Открытый код.

## Description (en-US)

XUI Browser Client connects Firefox to your own server managed by a 3x-ui panel (Xray). Only browser traffic goes through the tunnel; the rest of your system is untouched.

**You need your own server.** This add-on does not provide a VPN service.

**Two ways to connect**

- **Light — nothing but the add-on.** An inbound of the HTTP kind with TLS is a plain HTTPS proxy that Firefox can use by itself. Enter the domain, port, username and password, and it works.
- **Full — with a helper.** VLESS (including Reality and XHTTP / WebSocket behind a CDN), VMess, Trojan and Shadowsocks are protocols a browser cannot speak. A small open-source helper on your computer runs xray-core and gives Firefox a local, password-protected SOCKS5 proxy. The helper installs without administrator rights (Windows, macOS, Linux); the add-on tells you when a server needs it.

**Features**

- Import vless://, vmess://, trojan://, ss:// links — one or many — and subscription addresses; refresh a subscription with one click
- Several servers, switchable from the toolbar
- Split tunneling: everything except a list, or only listed sites; domains, IPs and subnets; one click to send the current site directly or via VPN
- VPN only in marked tabs (popup switch, hotkey, "Open link in a VPN tab"), only in private windows, or containers that always use the VPN
- Routing by country: selected countries without VPN, or only selected countries via VPN
- Check IP: your address with the VPN and without it, optionally with country, provider and address type
- Kill switch: if the tunnel is down, traffic does not bypass the VPN
- WebRTC IP leak protection while the VPN is on
- Connection check with latency and traffic counters; the Xray log is one click away
- English and Russian interface

**The helper** is needed only for the full mode. Download it from the project page (https://github.com/BorisGB2001/xui-browser-firefox/releases), run the installer and restart Firefox. Server links with keys are kept in the helper's folder on your computer, not in the Firefox profile.

**Privacy**: no data collection. Your credentials are sent only to your own server.

Open source (MIT): https://github.com/BorisGB2001/xui-browser-firefox
This is an unofficial project, not affiliated with 3x-ui or Project X.

## Description (ru)

XUI — клиент для браузера подключает Firefox к вашему собственному серверу под управлением панели 3x-ui (Xray). Через туннель идёт только трафик браузера, остальная система не затрагивается.

**Нужен свой сервер.** Расширение не предоставляет VPN-сервис.

**Два способа подключения**

- **Лёгкий — только расширение.** Inbound типа HTTP с TLS — это обычный HTTPS-прокси, с которым Firefox работает сам. Введите домен, порт, логин и пароль — и всё работает.
- **Полный — с помощником.** VLESS (включая Reality и XHTTP / WebSocket за CDN), VMess, Trojan и Shadowsocks браузер сам не умеет. Небольшой помощник с открытым кодом запускает на вашем компьютере xray-core и даёт Firefox локальный SOCKS5-прокси, закрытый паролем. Помощник ставится без прав администратора (Windows, macOS, Linux); расширение само сообщит, когда серверу он нужен.

**Возможности**

- Импорт ссылок vless://, vmess://, trojan://, ss:// — одной или нескольких — и адреса подписки; обновление подписки одной кнопкой
- Несколько серверов с переключением с панели инструментов
- Раздельное туннелирование: всё, кроме списка, или только сайты из списка; домены, IP и подсети; текущий сайт — напрямую или через VPN одним нажатием
- VPN только в отмеченных вкладках (переключатель, горячая клавиша, «Открыть ссылку во вкладке с VPN»), только в приватных окнах или в выбранных контейнерах
- Маршрутизация по странам: отмеченные страны без VPN или через VPN только отмеченные страны
- Проверка IP: адрес с VPN и без VPN, по желанию — страна, провайдер и тип адреса
- Kill switch: если туннель не работает, трафик не идёт в обход VPN
- Защита от утечки IP через WebRTC, пока VPN включён
- Проверка связи с задержкой и счётчиками трафика; журнал Xray открывается одной кнопкой
- Интерфейс на английском и русском

**Помощник** нужен только для полного режима. Скачайте его со страницы проекта (https://github.com/BorisGB2001/xui-browser-firefox/releases), запустите установщик и перезапустите Firefox. Ссылки серверов с ключами хранятся в папке помощника на вашем компьютере, а не в профиле Firefox.

**Конфиденциальность**: данные не собираются. Учётные данные отправляются только на ваш сервер.

Открытый код (MIT): https://github.com/BorisGB2001/xui-browser-firefox
Неофициальный проект, не связан с 3x-ui и Project X.

## Release notes 0.1.2 (en-US)

First public release. Servers of a 3x-ui panel: VLESS, VMess, Trojan and Shadowsocks links and subscriptions through a local helper with xray-core, or an HTTPS proxy with no helper at all. Split tunneling by sites, tabs, containers, private windows and countries; kill switch; WebRTC protection; Check IP. English and Russian interface. Requires Firefox 140 or newer.

## Release notes 0.1.2 (ru)

Первый публичный выпуск. Серверы панели 3x-ui: ссылки и подписки VLESS, VMess, Trojan и Shadowsocks через локальный помощник с xray-core либо HTTPS-прокси вообще без помощника. Раздельное туннелирование по сайтам, вкладкам, контейнерам, приватным окнам и странам; kill switch; защита WebRTC; проверка IP. Интерфейс на английском и русском. Нужен Firefox 140 или новее.

## Notes to reviewer (en-US) — "Notes for Reviewers" field

This add-on is a client for servers managed by the 3x-ui panel (https://github.com/MHSanaei/3x-ui), i.e. Xray (https://github.com/XTLS/Xray-core). It routes browser requests with `proxy.onRequest` in one of two ways:

1. **HTTPS-proxy server (no native app).** An Xray inbound of the HTTP kind with TLS is HTTP CONNECT over TLS with Basic auth, so the add-on returns `{type: "https", host, port, proxyAuthorizationHeader}` pointing to the user's own server. This mode works with the add-on alone.
2. **Xray protocols (native messaging).** VLESS, VMess, Trojan and Shadowsocks cannot be spoken by a browser. The add-on talks to an optional native messaging host `xui_browser` (source: `native-host/` in the repository, Go, standard library only). The host stores the share links on disk, builds an Xray config and starts the official `xray` binary, which listens on `127.0.0.1` as a SOCKS5 proxy with a random password per start; the add-on then returns `{type: "socks", host: "127.0.0.1", port, username, password, proxyDNS: true}`. Messages to the host: `ping`, `list`, `import`, `delete`, `rename`, `start`, `stop`, `status`, `logs`. The host is installed by the user from the repository (`scripts/install.sh`, or `install.cmd` from the Windows archive); the add-on does not download or run anything by itself.

Permissions:
- `proxy`, `<all_urls>` — route browser requests through the user's server.
- `nativeMessaging` — the optional helper described above.
- `webRequest`, `webRequestBlocking`, `webRequestAuthProvider` — answer a 407 proxy challenge of the user's HTTPS-proxy server with the saved credentials; read the network error code of our own health-check request.
- `privacy` — set `webRTCIPHandlingPolicy` and `networkPredictionEnabled` (false) while the VPN is on; both are cleared when the VPN is off.
- `storage` — settings and HTTPS-proxy servers, local only.
- `alarms` — the health check every 30 s.
- `tabs` — show the current site's route in the popup; track which tabs are marked "VPN in this tab".
- `menus` — "Open link in a VPN tab"; toolbar icon menu (VPN on/off, VPN in this tab, server).
- `sessions` (**optional**, requested from a button in Settings next to an explanation) — only `sessions.setTabValue/getTabValue/removeTabValue` with one boolean key, so the "VPN in this tab" mark survives a restart.
- `contextualIdentities` — list the user's containers in Settings so they can choose containers that always use the VPN.

No remote code, no minified or bundled code, no analytics. Network requests made by the add-on itself:
- `https://www.gstatic.com/generate_204` — connectivity check, sent through the user's tunnel.
- `https://api.ipify.org` — only when the user clicks "Check IP" (through the tunnel and direct).
- `https://proxycheck.io/v3/<ip>` — only after the user opts in from the popup (off by default).
- `https://cdn.jsdelivr.net/npm/@ip-location-db/geo-whois-asn-country/geo-whois-asn-country-ipv4-num.csv` — only when the user presses "Update database": data only (CSV), kept in IndexedDB.
- DNS over HTTPS (RFC 8484) to the service chosen in Settings — only while routing by country is on; forced through the user's tunnel.

Testing without a server: `node scripts/test-extension.js` (background script with a mocked browser and helper), `node scripts/test-scope.js`, `node scripts/test-geo.js`, and `go test ./...` in `native-host/` (link parsing, subscriptions, tunnel lifecycle with a fake xray). To test for real: the light mode needs any HTTPS proxy with Basic auth and a trusted certificate; the full mode needs the helper and a vless:// (etc.) link of an Xray server.

Source: https://github.com/BorisGB2001/xui-browser-firefox

## Images

Files in `amo/images/` (made by `node scripts/amo-screenshots.js`: the real popup and settings pages rendered in a headless browser with demo data only — example.com hosts, no real servers or credentials).

- **Add-on icon**: `icon-128.png` (128×128, from `extension/icons/icon-on.svg`).
- **Screenshots** (1280×800 PNG; images are shared by all locales, captions are translated):

| File | Caption (en-US) | Caption (ru) |
|---|---|---|
| `en-1-popup.png` | Toolbar popup: connected, VPN only in marked tabs, current site via VPN | Окно расширения: подключено, VPN только в отмеченных вкладках, текущий сайт через VPN |
| `en-2-servers.png` | Servers: an HTTPS proxy without the helper, VLESS and Trojan through the helper, a subscription | Серверы: HTTPS-прокси без помощника, VLESS и Trojan через помощник, подписка |
| `en-3-scope.png` | Where the VPN works: all tabs, marked tabs and containers, or private windows | Где работает VPN: все вкладки, отмеченные вкладки и контейнеры или приватные окна |
| `en-4-add-server.png` | Add servers from links or a subscription, or an HTTPS proxy by hand | Добавление серверов по ссылкам или подписке либо HTTPS-прокси вручную |
