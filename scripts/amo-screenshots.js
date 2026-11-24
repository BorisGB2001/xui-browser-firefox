#!/usr/bin/env node
/*
 * AMO listing images: amo/images/icon-128.png and 1280x800 PNG screenshots.
 * The real popup and settings pages are rendered in a headless Chromium with a stubbed
 * `browser` API and demo data only (example.com hosts, no real servers or credentials);
 * nothing goes over the network.
 *
 *   node scripts/amo-screenshots.js [chromium-binary]      (needs rsvg-convert for the icon)
 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync, spawn } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const EXT = path.join(ROOT, "extension");
const OUT = path.join(ROOT, "amo", "images");
const BROWSER = process.argv[2] || "/Applications/Chromium-Gost.app/Contents/MacOS/Chromium-Gost";
const LANG = "en";
const W = 1280, H = 800;

const now = Math.floor(Date.now() / 1000);
const SUB = "https://panel.example.com:2096/sub/demo";
const STATE = {
  settings: {
    enabled: true, profileId: "cdn", mode: "exclude",
    excludeList: ["mybank.example", "intranet.example.com", "192.168.0.0/16"],
    includeList: ["youtube.com", "googlevideo.com", "instagram.com"],
    bypassLocal: true, killSwitch: true, webrtcProtect: true,
    scope: "tabs", inheritOpener: true, tablessRoute: "direct", vpnContainers: ["firefox-container-2"],
    geoMode: "off", geoCountries: [], geoMeta: null, geoDns: "cloudflare", geoDnsUrl: "",
    statsUrl: "", ipInfo: false, port: 40810, infoPort: 40811,
  },
  profiles: [
    { id: "h-demo", kind: "https", local: true, name: "Light (no helper)", protocol: "https", endpoint: "px.example.com:443", hostname: "px.example.com", port: 443, username: "alice" },
    { id: "ams", name: "Amsterdam", protocol: "vless", endpoint: "ams.example.com:443", transport: "tcp + reality", sub: SUB },
    { id: "cdn", name: "Frankfurt via CDN", protocol: "vless", endpoint: "cdn.example.com:443", transport: "xhttp + tls", sub: SUB },
    { id: "hel", name: "Helsinki", protocol: "trojan", endpoint: "hel.example.com:443", transport: "ws + tls" },
  ],
  runtime: { status: "on", error: null, latency: 48, checkedAt: now - 12, since: now - 1840, metrics: { rx: 734003200, tx: 52428800 } },
  vpnTabs: [7],
  version: JSON.parse(fs.readFileSync(path.join(EXT, "manifest.json"), "utf8")).version,
};

/** Runs in the page before the extension's own scripts. */
function stub(MESSAGES, STATE, LANG) {
  const ok = (data) => Promise.resolve({ ok: true, data });
  const nop = () => Promise.resolve();
  window.browser = {
    i18n: {
      getMessage: (key, subs = []) => (MESSAGES[key] ? MESSAGES[key].message.replace(/\$(\d)/g, (_, n) => subs[n - 1] ?? "") : ""),
      getUILanguage: () => LANG,
    },
    runtime: {
      sendMessage: (msg) => {
        if (msg.type === "ping") return ok({ version: "0.1.0", xray: "Xray 26.11.9 (Xray, Penetrates Everything.)", dataDir: "…/XUI-Browser", os: "windows" });
        if (msg.type === "routeInfo") return ok({ tunneled: true, country: null, geo: false, geoReady: false });
        return ok(STATE);
      },
      onMessage: { addListener() {} },
      openOptionsPage: nop,
    },
    tabs: { query: () => Promise.resolve([{ id: 7, url: "https://www.youtube.com/", incognito: false, cookieStoreId: "firefox-default" }]), create: nop },
    extension: { isAllowedIncognitoAccess: () => Promise.resolve(true) },
    permissions: { contains: () => Promise.resolve(true), request: () => Promise.resolve(true) },
    contextualIdentities: {
      query: () => Promise.resolve([
        { name: "Personal", colorCode: "#37adff", cookieStoreId: "firefox-container-1" },
        { name: "Work", colorCode: "#ff9f00", cookieStoreId: "firefox-container-2" },
        { name: "Shopping", colorCode: "#ff4bda", cookieStoreId: "firefox-container-4" },
      ]),
      get: () => Promise.resolve({ name: "Work" }),
    },
    commands: {
      getAll: () => Promise.resolve([
        { shortcut: "Alt+Shift+V", description: MESSAGES.cmdToggleVpn.message },
        { shortcut: "Alt+Shift+T", description: MESSAGES.cmdToggleTabVpn.message },
      ]),
    },
  };
  // #open=a,b opens <details>; #hide=a,b hides elements; #top=id starts the page at that card
  // (headless screenshots ignore scrolling, so the cards above are removed); #hero adds the caption block.
  window.addEventListener("load", () =>
    setTimeout(() => {
      const args = Object.fromEntries(location.hash.slice(1).split("&").filter(Boolean).map((kv) => kv.split("=")));
      for (const id of (args.open || "").split(",").filter(Boolean)) document.getElementById(id).open = true;
      for (const id of (args.hide || "").split(",").filter(Boolean)) document.getElementById(id).hidden = true;
      if (args.top) {
        const card = document.getElementById(args.top).closest("section");
        while (card.previousElementSibling) card.previousElementSibling.remove();
      }
      if ("hero" in args) {
        const hero = document.createElement("div");
        hero.className = "hero";
        hero.innerHTML = "<h1>Browser-only VPN<br>for your 3x-ui server</h1><p>VLESS, VMess, Trojan, Shadowsocks — or a plain HTTPS proxy with nothing but the add-on. Only the browser goes through the tunnel.</p>";
        document.documentElement.appendChild(hero);
      }
    }, 300)
  );
}

const HERO_CSS = `
  html { max-height: none !important; width: ${W}px; height: ${H}px; overflow: hidden !important;
         background: linear-gradient(135deg, #2a1a6e, #6a4ff0); }
  body { margin: 56px 120px 0 auto !important; background: #fff; border-radius: 14px; box-shadow: 0 24px 60px rgba(0,0,0,.45); }
  .hero { position: absolute; left: 96px; top: 250px; width: 560px; color: #fff; font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif; }
  .hero h1 { font-size: 46px; line-height: 1.15; margin: 0 0 20px; font-weight: 700; }
  .hero p { font-size: 22px; line-height: 1.45; margin: 0; color: #dcd6ff; }
`;

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  execFileSync("rsvg-convert", ["-w", "128", "-h", "128", path.join(EXT, "icons", "icon-on.svg"), "-o", path.join(OUT, "icon-128.png")]);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "xui-shots-"));
  try {
    const ext = path.join(tmp, "ext");
    fs.cpSync(EXT, ext, { recursive: true });
    const messages = JSON.parse(fs.readFileSync(path.join(EXT, "_locales", LANG, "messages.json"), "utf8"));
    fs.writeFileSync(path.join(ext, "stub.js"), `(${stub})(${JSON.stringify(messages)}, ${JSON.stringify(STATE)}, ${JSON.stringify(LANG)});`);
    for (const page of ["popup/popup.html", "options/options.html"]) {
      const file = path.join(ext, page);
      let html = fs.readFileSync(file, "utf8").replace("</head>", '<script src="../stub.js"></script>\n</head>');
      if (page.startsWith("popup")) html = html.replace("</head>", `<style>${HERO_CSS}</style>\n</head>`);
      fs.writeFileSync(file, html);
    }
    // Always the light theme, whatever the system uses.
    const css = path.join(ext, "lib", "common.css");
    fs.writeFileSync(css, fs.readFileSync(css, "utf8").replace("(prefers-color-scheme: dark)", "(max-width: 0px)") + "\n:root { color-scheme: light; }\n");
    const shots = [
      ["en-1-popup.png", "popup/popup.html#hero"],
      ["en-2-servers.png", "options/options.html"],
      ["en-3-scope.png", "options/options.html#top=tabsOpts"],
      ["en-4-add-server.png", "options/options.html#open=editBox,httpsBox&hide=profiles,subsBox&top=editBox"],
    ];
    for (const [name, page] of shots) {
      const out = path.join(OUT, name);
      // This Chromium writes the screenshot but does not exit in headless mode: wait for the file, then stop it.
      fs.rmSync(out, { force: true });
      const proc = spawn(BROWSER, [
        "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run", "--force-device-scale-factor=1",
        `--user-data-dir=${path.join(tmp, "profile")}`, `--window-size=${W},${H}`, "--virtual-time-budget=4000",
        `--screenshot=${out}`, "file://" + path.join(ext, page),
      ], { stdio: "ignore" });
      const deadline = Date.now() + 60000;
      let size = -1;
      for (;;) {
        await new Promise((r) => setTimeout(r, 500));
        const now = fs.existsSync(out) ? fs.statSync(out).size : 0;
        if (now > 0 && now === size) break; // written and no longer growing
        size = now;
        if (Date.now() > deadline) {
          proc.kill("SIGKILL");
          throw new Error("no screenshot for " + page);
        }
      }
      proc.kill("SIGKILL");
      await new Promise((r) => proc.once("exit", r));
      console.log(out);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
