# Privacy Policy — XUI Browser Client

Last updated: 2026-11-24

XUI Browser Client ("the add-on") is an open-source Firefox extension that connects the browser to a VPN/proxy server chosen by the user (a server of a 3x-ui panel: Xray protocols or an HTTPS proxy). An optional helper program on the user's computer runs xray-core for the protocols a browser cannot speak itself.

## Data the add-on collects

None. The add-on and the helper have no analytics, telemetry, crash reporting or advertising, and their developer receives no data from them.

## Data stored on your device

- **HTTPS-proxy servers** you add: name, domain, port, username and password — in the add-on's local storage inside your Firefox profile (`storage.local`), not encrypted.
- **Servers added from links or subscriptions** (VLESS, VMess, Trojan, Shadowsocks): the share link with its key and the subscription address — in the helper's folder on your computer (`XUI-Browser/profiles`, readable by your user only), not in the Firefox profile. The add-on itself keeps only the name, protocol and address of each such server.
- Settings: routing mode, site lists, where the VPN works (all tabs / marked tabs / private windows), the containers and countries you chose, the address of your statistics page, local ports, kill switch and WebRTC options.
- The country database (IP ranges with country codes), if you downloaded it: kept in the add-on's IndexedDB.
- The "VPN in this tab" mark: stored with the tab itself in Firefox's session data, only after you allow it in Settings (Firefox's optional "Access recently closed tabs" permission). The add-on never reads your closed tabs or history.
- The helper's log of xray-core (`XUI-Browser/logs/xray.log`, warnings and errors only).

Nothing is synced. The data is deleted when you remove the server, uninstall the add-on, or run the helper's uninstaller with the purge option.

## Data sent over the network

- **To your server** (the one you configured): the credentials from your link or form and the browser traffic you choose to route through the VPN. This server is operated by you or by whoever gave you the link, not by the add-on developer.
- **Subscription address**: when you add or refresh a subscription, the helper requests that address directly (not through the VPN) to read the list of servers.
- **Connectivity check**: every 30 seconds while the VPN is on, a request to `https://www.gstatic.com/generate_204` sent through your server, to measure whether the tunnel works.
- **"Check IP" button**: only when you click it, two requests to `https://api.ipify.org` — one through your server and one directly — to show your address with the VPN and without it.
- **IP details (off by default)**: if you click "Show country, provider and address type" in the popup, each "Check IP" also sends those two IP addresses to `https://proxycheck.io`, a third-party service with its own privacy policy.
- **Countries (off by default)**: when you press "Update database", the add-on downloads a public list of IP ranges by country from `https://cdn.jsdelivr.net` (ip-location-db). While routing by country is on, the add-on looks up the address of each site you open with a DNS-over-HTTPS request to the service you chose in Settings — Cloudflare (default), Google, AdGuard DNS or your own server. The request is sent through your VPN server.
- **"Statistics" button**: opens, in a new tab, the address you typed in Settings. The add-on itself sends nothing there.
- **Helper installer (Windows)**: downloads the official xray-core release from `github.com/XTLS/Xray-core` and checks its SHA-256.

No other requests are made by the add-on or the helper.

## Contact

Questions and issues: https://github.com/BorisGB2001/xui-browser-firefox/issues
