/*
 * XUI Browser Client — background (event page).
 *
 * Servers of a 3x-ui panel speak Xray protocols (VLESS, VMess, Trojan, Shadowsocks)
 * that a browser cannot speak itself. A native messaging helper (native-host/) runs
 * xray-core on this computer; Firefox reaches it as a local SOCKS5 proxy protected
 * by a random password (proxy.onRequest -> type "socks").
 *
 * Routing of a request = scope (all tabs / marked tabs + containers / private
 * windows, lib/scope.js) AND site lists (lib/rules.js).
 */
"use strict";

const NATIVE = "xui_browser";
const HEALTH_ALARM = "xui-health";
const HEALTH_URL = "https://www.gstatic.com/generate_204";
const IP_URL = "https://api.ipify.org/?format=json";
const IP_INFO_URL = "https://proxycheck.io/v3/"; // country, provider and kind of an IP (opt-in)
// Site names are resolved for GEO routing with DNS over HTTPS (lib/doh.js), sent through
// the tunnel: the local resolver (and the provider behind it) never sees them.
const DNS_TTL = 10 * 60 * 1000;
const DNS_CACHE_MAX = 2000;

const DEFAULTS = {
  enabled: false,
  profileId: null,
  profiles: [], // cache of the helper's server list: [{id, name, protocol, endpoint, transport, sub, error}]
  port: 40810, // local SOCKS5 of xray
  infoPort: 40811, // xray stats API
  mode: "exclude", // site lists: "exclude" | "include"
  excludeList: [],
  includeList: [],
  bypassLocal: true,
  killSwitch: true,
  webrtcProtect: true,
  scope: "all", // where the VPN works: "all" | "tabs" | "private"
  inheritOpener: true, // tabs opened from a VPN tab get VPN too
  tablessRoute: "direct", // requests without a tab in "tabs" scope: "direct" | "vpn"
  vpnContainers: [], // cookieStoreIds whose tabs always use the VPN in "tabs" scope
  geoMode: "off", // countries: "off" | "direct" (listed go direct) | "vpn" (only listed via VPN)
  geoCountries: [], // ISO codes
  geoMeta: null, // {count, updatedAt} of the downloaded country database
  geoDns: "cloudflare", // DNS-over-HTTPS service for GEO: "cloudflare" | "google" | "adguard" | "custom"
  geoDnsUrl: "", // the user's own DoH server when geoDns is "custom"
  statsUrl: "", // "Statistics" button in the popup (e.g. the subscription page of the panel)
  ipInfo: false, // "Check IP" also asks proxycheck.io about the addresses (opt-in)
};

let settings = { ...DEFAULTS };
// Runtime state. The SOCKS credentials of the running xray (username, password) and
// "key" (identifies one start of the tunnel) live only here and in storage.session.
const OFF = {
  status: "off", error: null, latency: null, checkedAt: null, since: null,
  key: null, port: null, username: null, password: null, metrics: null,
};
let rt = { ...OFF };
let healthNonce = null; // marks our own health-check request

// Tabs marked "VPN in this tab". Kept in storage.session: survives a restart of the
// background page, not of the browser (tab ids change then anyway).
const vpnTabs = new Set();
// tabId -> Promise of a running "inherit VPN from the opener tab" check.
const openerChecks = new Map();
// Tabs whose inheritance is already decided (checked once, or set by hand). Kept in
// storage.session too: a restart of the background page must not decide again.
const openerDone = new Set();
// url -> "vpn" | "direct": our own "Check IP" requests with a forced route.
const forcedRoutes = new Map();

const ready = (async () => {
  const stored = await browser.storage.local.get(Object.keys(DEFAULTS));
  settings = { ...DEFAULTS, ...stored };
  try {
    const s = await browser.storage.session.get(["rt", "vpnTabs", "openerDone"]);
    if (s.rt) rt = { ...rt, ...s.rt };
    const open = new Set((await browser.tabs.query({})).map((tab) => tab.id));
    for (const id of s.vpnTabs || []) if (open.has(id)) vpnTabs.add(id);
    for (const id of s.openerDone || []) if (open.has(id)) openerDone.add(id);
    // After a browser restart storage.session is empty and tab ids are new: the mark
    // travels with the tab itself (session store), so restored tabs keep their VPN.
    await Promise.all([...open].filter((id) => !openerDone.has(id)).map(restoreTabMark));
  } catch (_) {}
  if (settings.enabled) {
    // The alarm is gone after the add-on was disabled and enabled again.
    try {
      if (!(await browser.alarms.get(HEALTH_ALARM))) browser.alarms.create(HEALTH_ALARM, { periodInMinutes: 0.5 });
    } catch (_) {}
  }
  if (settings.geoMode !== "off") await loadGeo();
  updateBadge();
})();

// ------------------------------------------------------------------ state helpers

async function native(cmd, args = {}) {
  let res;
  try {
    res = await browser.runtime.sendNativeMessage(NATIVE, { cmd, ...args });
  } catch (e) {
    throw new Error(t("errNoHelper", e && e.message ? e.message : String(e)));
  }
  if (!res || !res.ok) throw new Error((res && res.error) || t("errHelperUnknown"));
  return res;
}

const currentProfile = () => settings.profiles.find((p) => p.id === settings.profileId) || null;

const scopeCtx = () => ({
  scope: settings.scope,
  vpnTabs,
  vpnContainers: settings.vpnContainers,
  tablessRoute: settings.tablessRoute,
});

async function saveSettings(patch) {
  settings = { ...settings, ...patch };
  await browser.storage.local.set(patch);
}

async function setRuntime(patch) {
  rt = { ...rt, ...patch };
  try {
    await browser.storage.session.set({ rt });
  } catch (_) {}
  updateBadge();
  notifyPages();
}

function notifyPages() {
  browser.runtime.sendMessage({ type: "stateChanged" }).catch(() => {});
}

// ------------------------------------------------------------------ toolbar badge

function statusBadge() {
  if (!settings.enabled) return { text: "", color: "#9e9e9e", title: t("titleOff"), icon: "icons/icon-off.svg" };
  if (rt.status === "on") return { text: "ON", color: "#2e7d32", title: t("titleOn"), icon: "icons/icon-on.svg" };
  if (rt.status === "error")
    return { text: "!", color: "#c62828", title: t("titleError", rt.error || ""), icon: "icons/icon-err.svg" };
  return { text: "…", color: "#ef6c00", title: t("titleConnecting"), icon: "icons/icon-off.svg" };
}

const ignoreErr = (p) => p && p.catch && p.catch(() => {});

function updateBadge() {
  let b = statusBadge();
  // Limited scope + connected: the global icon stays grey, VPN tabs get their own badge.
  if (settings.scope !== "all" && settings.enabled && rt.status === "on")
    b = { text: "", color: "#2e7d32", title: t(settings.scope === "private" ? "titleOnPrivate" : "titleOnTabs"), icon: "icons/icon-off.svg" };
  ignoreErr(browser.action.setBadgeText({ text: b.text }));
  ignoreErr(browser.action.setBadgeBackgroundColor({ color: b.color }));
  ignoreErr(browser.action.setTitle({ title: b.title }));
  ignoreErr(browser.action.setIcon({ path: b.icon }));
  refreshTabBadges();
}

function tabInScope(tab) {
  return TTScope.inScope({ tabId: tab.id, incognito: tab.incognito, cookieStoreId: tab.cookieStoreId }, scopeCtx());
}

function applyTabBadge(tab) {
  if (!tab || typeof tab.id !== "number" || tab.id < 0) return;
  const tabId = tab.id;
  if (settings.scope === "all" || !settings.enabled || !tabInScope(tab)) {
    // Back to the global badge.
    ignoreErr(browser.action.setBadgeText({ tabId, text: null }));
    ignoreErr(browser.action.setBadgeBackgroundColor({ tabId, color: null }));
    ignoreErr(browser.action.setTitle({ tabId, title: null }));
    ignoreErr(browser.action.setIcon({ tabId }));
    return;
  }
  const b = statusBadge();
  const on = rt.status === "on";
  ignoreErr(browser.action.setBadgeText({ tabId, text: on ? "VPN" : b.text }));
  ignoreErr(browser.action.setBadgeBackgroundColor({ tabId, color: b.color }));
  ignoreErr(browser.action.setTitle({ tabId, title: on ? t("titleTabVpn") : b.title }));
  ignoreErr(browser.action.setIcon({ tabId, path: b.icon }));
}

async function refreshTabBadges() {
  let tabs = [];
  try {
    tabs = await browser.tabs.query({});
  } catch (_) {}
  for (const tab of tabs) applyTabBadge(tab);
}

// ------------------------------------------------------------------ VPN tabs

const TAB_MARK = "vpn"; // sessions.setTabValue key

/**
 * Remember the mark in the tab's own session data (survives restart and "undo close tab").
 * Needs the optional "sessions" permission; without it marks last until the browser closes.
 */
function saveTabMark(tabId, value) {
  if (!browser.sessions) return undefined;
  try {
    return ignoreErr(value ? browser.sessions.setTabValue(tabId, TAB_MARK, true) : browser.sessions.removeTabValue(tabId, TAB_MARK));
  } catch (_) {
    return undefined;
  }
}

/** Read the mark of a restored tab. Returns true when the tab was marked. */
async function restoreTabMark(tabId) {
  if (!browser.sessions) return false;
  try {
    if ((await browser.sessions.getTabValue(tabId, TAB_MARK)) !== true) return false;
  } catch (_) {
    return false;
  }
  vpnTabs.add(tabId);
  openerDone.add(tabId);
  return true;
}

async function persistVpnTabs() {
  try {
    await browser.storage.session.set({ vpnTabs: [...vpnTabs], openerDone: [...openerDone] });
  } catch (_) {}
}

async function setTabVpn(tabId, value) {
  if (typeof tabId !== "number" || tabId < 0) throw new Error(t("errNoTab"));
  if (value) vpnTabs.add(tabId);
  else vpnTabs.delete(tabId);
  openerDone.add(tabId); // a manual choice: never inherit over it
  await Promise.all([persistVpnTabs(), saveTabMark(tabId, value)]);
  try {
    applyTabBadge(await browser.tabs.get(tabId));
  } catch (_) {}
  // Marking a tab means "I want the VPN here": turn it on if it is off.
  if (value && !settings.enabled) await setEnabled(true);
  else notifyPages();
}

/**
 * First request of a tab we have not seen: a restored tab gets its saved mark back,
 * a new one may inherit the VPN from its opener tab.
 */
function inheritFromOpener(tabId) {
  if (typeof tabId !== "number" || tabId < 0 || vpnTabs.has(tabId) || openerDone.has(tabId)) return null;
  let check = openerChecks.get(tabId);
  if (!check) {
    check = (async () => {
      try {
        const tab = await browser.tabs.get(tabId);
        let marked = await restoreTabMark(tabId);
        if (!marked && settings.inheritOpener && tab.openerTabId != null && vpnTabs.has(tab.openerTabId)) {
          marked = true;
          vpnTabs.add(tabId);
          saveTabMark(tabId, true);
        }
        openerDone.add(tabId);
        await persistVpnTabs();
        if (marked) applyTabBadge(tab);
      } catch (_) {}
      openerChecks.delete(tabId);
    })();
    openerChecks.set(tabId, check);
  }
  return check;
}

// The user allowed "sessions" in Settings: store the marks that already exist.
browser.permissions.onAdded.addListener(async (perms) => {
  if (!(perms.permissions || []).includes("sessions")) return;
  await ready;
  for (const id of vpnTabs) saveTabMark(id, true);
  notifyPages();
});

browser.tabs.onCreated.addListener(async (tab) => {
  await ready;
  if (settings.scope === "tabs") await inheritFromOpener(tab.id);
  applyTabBadge(tab);
});

browser.tabs.onRemoved.addListener(async (tabId) => {
  await ready;
  openerChecks.delete(tabId);
  const had = openerDone.delete(tabId);
  if (vpnTabs.delete(tabId) || had) await persistVpnTabs();
});

browser.tabs.onUpdated.addListener(async (tabId, change, tab) => {
  if (!("status" in change) && !("url" in change)) return;
  await ready;
  applyTabBadge(tab);
});

/** Open a link in a new tab that uses the VPN from its very first request. */
async function openVpnTab(url, opener) {
  const tab = await browser.tabs.create({
    url: "about:blank",
    active: true,
    windowId: opener ? opener.windowId : undefined,
    index: opener ? opener.index + 1 : undefined,
    openerTabId: opener ? opener.id : undefined,
    cookieStoreId: opener ? opener.cookieStoreId : undefined, // stay in the opener's container
  });
  await setTabVpn(tab.id, true);
  await browser.tabs.update(tab.id, { url });
}

// ------------------------------------------------------------------ WebRTC

async function applyWebRtc(on) {
  try {
    const setting = browser.privacy.network.webRTCIPHandlingPolicy;
    if (on && settings.webrtcProtect) await setting.set({ value: "disable_non_proxied_udp" });
    else await setting.clear({});
  } catch (e) {
    console.warn("WebRTC policy:", e);
  }
  // DNS prefetch and speculative connections would name the sites to the local
  // resolver and open tab-less connections past the tunnel.
  try {
    const predict = browser.privacy.network.networkPredictionEnabled;
    if (on) await predict.set({ value: false });
    else await predict.clear({});
  } catch (e) {
    console.warn("network prediction:", e);
  }
}

// ------------------------------------------------------------------ proxy routing

const DIRECT = { type: "direct" };
const BLACKHOLE = { type: "http", host: "127.0.0.1", port: 9 }; // kill switch without a server

/**
 * The local xray SOCKS5 listener, or null while no tunnel is running.
 * Firefox reuses open proxy connections; the key changes with every start of the
 * tunnel, so a changed server takes effect at once.
 */
function tunnelProxy() {
  if (!rt.password || !rt.key || !rt.port) return null;
  return {
    type: "socks",
    host: "127.0.0.1",
    port: rt.port,
    username: rt.username,
    password: rt.password,
    proxyDNS: true, // site names go into the tunnel, the local resolver never sees them
    failoverTimeout: 5,
    connectionIsolationKey: rt.key,
  };
}

// ------------------------------------------------------------------ countries (GEO)

let geoDb = null; // {starts, ends, cc, count} or null
let geoLoading = null;
const dnsCache = new Map(); // host -> {at, country: Promise<string|null>}

function idb(mode, run) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open("xui-geo", 1);
    open.onupgradeneeded = () => open.result.createObjectStore("kv");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction("kv", mode);
      const req = run(tx.objectStore("kv"));
      tx.oncomplete = () => {
        open.result.close();
        resolve(req && req.result);
      };
      tx.onerror = tx.onabort = () => {
        open.result.close();
        reject(tx.error);
      };
    };
  });
}

function loadGeo() {
  if (!geoLoading)
    geoLoading = idb("readonly", (st) => st.get("db"))
      .then((db) => {
        geoDb = db && db.count ? db : null;
      })
      .catch((e) => console.warn("geo database:", e));
  return geoLoading;
}

/** IPv4 addresses of a host, asked over HTTPS through the tunnel. */
async function resolveViaVpn(host) {
  const url = TTDoh.queryUrl(TTDoh.endpoint(settings), host);
  if (!url) throw new Error("no DNS service");
  return TTDoh.parseAnswer(await fetchVia(url, "vpn", 5000, { accept: "application/dns-message" }, "bytes"));
}

/**
 * Country of a host's server (ISO code) or null. The name is resolved through the
 * VPN, so without a working tunnel the country is unknown.
 */
async function countryOf(host) {
  if (!geoDb) await loadGeo();
  if (!geoDb) return null;
  host = String(host || "").toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  const literal = TTRules.ipv4ToInt(host);
  if (literal !== null) return TTGeo.lookup(geoDb, literal);
  if (!host || host.includes(":")) return null; // IPv6 literal: not in the database
  if (!settings.enabled || !currentProfile()) return null;
  const now = Date.now();
  let hit = dnsCache.get(host);
  if (!hit || now - hit.at > DNS_TTL) {
    if (dnsCache.size >= DNS_CACHE_MAX) dnsCache.clear();
    hit = {
      at: now,
      country: resolveViaVpn(host).then(
        (addresses) => {
          for (const addr of addresses) {
            const n = TTRules.ipv4ToInt(addr);
            const c = n === null ? null : TTGeo.lookup(geoDb, n);
            if (c) return c;
          }
          return null;
        },
        () => {
          dnsCache.delete(host); // tunnel down or resolver error: ask again next time
          return null;
        }
      ),
    };
    dnsCache.set(host, hit);
  }
  return hit.country;
}

async function geoUpdate() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 90000);
  let db;
  try {
    const r = await fetch(TTGeo.DB_URL, { cache: "no-store", credentials: "omit", signal: ctrl.signal });
    if (!r.ok) throw new Error(t("errGeoHttp", r.status));
    db = TTGeo.parseCsv(await r.text());
  } catch (e) {
    throw new Error(e && e.name === "AbortError" ? t("errTimeout") : t("errGeoDownload", e && e.message ? e.message : String(e)));
  } finally {
    clearTimeout(timer);
  }
  if (db.count < 1000) throw new Error(t("errGeoFormat"));
  await idb("readwrite", (st) => st.put(db, "db"));
  geoDb = db;
  geoLoading = Promise.resolve();
  dnsCache.clear();
  await saveSettings({ geoMeta: { count: db.count, updatedAt: Math.floor(Date.now() / 1000) } });
  return getState();
}

/** Would a request of this tab context to this host use the VPN (when it is on)? */
async function wantsVpn(req, host) {
  if (!TTScope.inScope(req, scopeCtx())) return false;
  const country = TTRules.needsCountry(host, settings) ? await countryOf(host) : null;
  return TTRules.route(host, settings, country);
}

async function routeRequest(details) {
  if (!settings.enabled) return DIRECT;
  const proxy = currentProfile() ? tunnelProxy() : null;
  // Our own health probe always goes through the tunnel and never fails over.
  if (healthNonce && details.url.includes("xui-health=" + healthNonce)) return proxy || BLACKHOLE;
  // "Check IP": one request forced through the tunnel, one forced direct.
  const forced = forcedRoutes.get(details.url);
  if (forced === "direct") return DIRECT;
  // Forced through the tunnel and never around it (a name lookup must not leak).
  if (forced === "vpn") return proxy || BLACKHOLE;

  if (settings.scope === "tabs") await inheritFromOpener(details.tabId);
  if (!TTScope.inScope(details, scopeCtx())) return DIRECT;

  let host;
  try {
    host = new URL(details.url).hostname;
  } catch (_) {
    return DIRECT;
  }
  const country = TTRules.needsCountry(host, settings) ? await countryOf(host) : null;
  if (!TTRules.route(host, settings, country)) return DIRECT;
  if (!proxy) return settings.killSwitch ? BLACKHOLE : DIRECT;
  // Kill switch on: only the tunnel, the request fails if it is down.
  // Kill switch off: Firefox falls back to a direct connection.
  return settings.killSwitch ? proxy : [proxy, DIRECT];
}

browser.proxy.onRequest.addListener(
  async (details) => {
    try {
      await ready;
    } catch (e) {
      console.error("state not loaded, routing direct:", e); // enabled or not is unknown
      return DIRECT;
    }
    try {
      return await routeRequest(details);
    } catch (e) {
      // Never fail open: an error here must not send a VPN request around the tunnel.
      console.error("routing failed:", e);
      return settings.enabled && settings.killSwitch ? BLACKHOLE : DIRECT;
    }
  },
  { urls: ["<all_urls>"] }
);

browser.proxy.onError.addListener((err) => console.warn("proxy error:", err && err.message));

// ------------------------------------------------------------------ health check

// Firefox's own error code for the last health request (fetch only says "NetworkError").
let healthErrorCode = null;
browser.webRequest.onErrorOccurred.addListener(
  (d) => {
    if (healthNonce && d.url.includes("xui-health=" + healthNonce)) healthErrorCode = d.error;
  },
  { urls: [HEALTH_URL + "*"] }
);

function explain(e, code) {
  if (e && e.name === "AbortError") return t("errTimeout");
  // Nothing listens on the local port: xray has stopped.
  if (code && /PROXY_CONNECTION_REFUSED/.test(code)) return t("errSocks") + " [" + code + "]";
  // xray is running but could not carry the request to the server.
  return t("errTunnelDown") + (code ? " [" + code + "]" : "");
}

// Checks run one at a time: they share the nonce and the error code.
let healthQueue = Promise.resolve();
function healthCheck(opts) {
  healthQueue = healthQueue.then(() => runHealthCheck(opts)).catch((e) => console.warn("health check:", e));
  return healthQueue;
}

async function runHealthCheck({ quiet = false } = {}) {
  if (!settings.enabled) return;
  const p = currentProfile();
  if (!p) {
    await setRuntime({ status: "error", error: t("errNoServer") });
    return;
  }
  if (!quiet && rt.status !== "on") await setRuntime({ status: "connecting", error: null });
  // "start" is idempotent: a tunnel already running with the same settings is reused,
  // a stopped one or one with another server is (re)started.
  let tunnel;
  try {
    ({ state: tunnel } = await native("start", { id: p.id, port: settings.port, infoPort: settings.infoPort }));
  } catch (e) {
    if (settings.enabled) await setRuntime({ ...OFF, status: "error", error: e.message });
    return;
  }
  if (!settings.enabled) return; // switched off meanwhile: the queued stop follows
  const key = "xui:" + tunnel.profile + ":" + tunnel.pid + ":" + tunnel.startedAt;
  const restarted = key !== rt.key;
  rt = { ...rt, key, port: tunnel.port, username: tunnel.username, password: tunnel.password, metrics: tunnel.metrics || null };
  if (restarted) dnsCache.clear();
  healthNonce = Math.random().toString(36).slice(2);
  healthErrorCode = null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  const t0 = performance.now();
  try {
    const r = await fetch(HEALTH_URL + "?xui-health=" + healthNonce, {
      cache: "no-store",
      credentials: "omit",
      signal: ctrl.signal,
    });
    if (r.status >= 500) throw new Error(t("errHealthHttp", r.status));
    if (!settings.enabled) return;
    await setRuntime({
      status: "on",
      error: null,
      latency: Math.round(performance.now() - t0),
      checkedAt: Math.floor(Date.now() / 1000),
      since: rt.status === "on" && rt.since && !restarted ? rt.since : Math.floor(Date.now() / 1000),
    });
  } catch (e) {
    if (!settings.enabled) return;
    // onErrorOccurred may fire just after fetch rejects.
    if (!healthErrorCode) await new Promise((r) => setTimeout(r, 300));
    console.warn("health check failed:", healthErrorCode, e);
    await setRuntime({ status: "error", error: explain(e, healthErrorCode), latency: null, since: null });
  } finally {
    clearTimeout(timer);
    healthNonce = null;
  }
}

/** Stop xray. Goes through the same queue as the checks, so it cannot overtake a start in flight. */
function stopTunnel() {
  healthQueue = healthQueue
    .then(async () => {
      if (settings.enabled) return; // turned on again meanwhile
      try {
        await native("stop");
      } catch (e) {
        console.warn("stop:", e);
      }
      await setRuntime({ ...OFF });
    })
    .catch((e) => console.warn("stop:", e));
  return healthQueue;
}

async function setEnabled(value) {
  await saveSettings({ enabled: !!value });
  if (value) {
    browser.alarms.create(HEALTH_ALARM, { periodInMinutes: 0.5 });
    await applyWebRtc(true);
    await healthCheck();
  } else {
    browser.alarms.clear(HEALTH_ALARM);
    await applyWebRtc(false);
    await stopTunnel();
  }
  rebuildMenus();
}

// ------------------------------------------------------------------ menus

let menusBuilding = Promise.resolve();

/** Link context menu + toolbar icon menu (VPN on/off, VPN in this tab, server). */
function rebuildMenus() {
  menusBuilding = menusBuilding.then(async () => {
    try {
      await browser.menus.removeAll();
      const tabsScope = settings.scope === "tabs";
      browser.menus.create({ id: "open-vpn-tab", title: t("menuOpenLinkVpn"), contexts: ["link"], visible: tabsScope });
      browser.menus.create({ id: "toggle-vpn", type: "checkbox", title: t("menuVpnOn"), contexts: ["action"], checked: settings.enabled });
      browser.menus.create({ id: "tab-vpn", type: "checkbox", title: t("menuTabVpn"), contexts: ["action"], visible: tabsScope });
      if (settings.profiles.length) {
        browser.menus.create({ id: "servers", title: t("menuServer"), contexts: ["action"] });
        for (const p of settings.profiles)
          browser.menus.create({
            id: "srv:" + p.id,
            parentId: "servers",
            type: "radio",
            title: p.name,
            contexts: ["action"],
            checked: p.id === settings.profileId,
          });
      }
    } catch (e) {
      console.warn("menus:", e);
    }
  });
  return menusBuilding;
}

browser.menus.onShown.addListener(async (info, tab) => {
  if (!info.contexts.includes("action") || !tab) return;
  await ready;
  await Promise.all([
    browser.menus.update("tab-vpn", { checked: vpnTabs.has(tab.id) }).catch(() => {}),
    browser.menus.update("toggle-vpn", { checked: settings.enabled }).catch(() => {}),
  ]);
  browser.menus.refresh();
});

browser.menus.onClicked.addListener(async (info, tab) => {
  await ready;
  try {
    if (info.menuItemId === "open-vpn-tab" && info.linkUrl) await openVpnTab(info.linkUrl, tab);
    else if (info.menuItemId === "toggle-vpn") await setEnabled(!settings.enabled);
    else if (info.menuItemId === "tab-vpn" && tab) await setTabVpn(tab.id, !vpnTabs.has(tab.id));
    else if (typeof info.menuItemId === "string" && info.menuItemId.startsWith("srv:"))
      await handlers.setSettings({ patch: { profileId: info.menuItemId.slice(4) } });
  } catch (e) {
    console.warn("menu action:", e);
  }
});

// ------------------------------------------------------------------ hotkeys

browser.commands.onCommand.addListener(async (command) => {
  await ready;
  try {
    if (command === "toggle-vpn") await setEnabled(!settings.enabled);
    else if (command === "toggle-tab-vpn" && settings.scope === "tabs") {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (tab) await setTabVpn(tab.id, !vpnTabs.has(tab.id));
    }
  } catch (e) {
    console.warn("command:", e);
  }
});

// ------------------------------------------------------------------ lifecycle

async function resume() {
  await ready;
  rebuildMenus();
  if (!settings.enabled) return;
  browser.alarms.create(HEALTH_ALARM, { periodInMinutes: 0.5 });
  await applyWebRtc(true);
  await healthCheck();
}

browser.runtime.onStartup.addListener(resume);
browser.runtime.onInstalled.addListener(async (details) => {
  await resume();
  if (details.reason === "install") browser.runtime.openOptionsPage();
});
browser.alarms.onAlarm.addListener(async (a) => {
  await ready;
  if (a.name === HEALTH_ALARM) await healthCheck({ quiet: true });
});

// ------------------------------------------------------------------ messages from popup/options

async function getState() {
  const { profiles, ...s } = settings;
  return {
    settings: s,
    profiles,
    runtime: { ...rt, username: undefined, password: undefined, key: undefined },
    vpnTabs: [...vpnTabs],
    version: browser.runtime.getManifest().version,
  };
}

/** Refresh the cached server list from the helper (the servers live on disk, not in the Firefox profile). */
async function syncProfiles() {
  const { profiles } = await native("list");
  const patch = { profiles };
  if (settings.profileId && !profiles.some((p) => p.id === settings.profileId)) patch.profileId = null;
  await saveSettings(patch);
  rebuildMenus();
  return profiles;
}

/** Share links, a base64 list of them, or a subscription address (also used to refresh a subscription). */
async function importServers({ name, text }) {
  const before = currentProfile();
  const res = await native("import", { name, text });
  const profiles = await syncProfiles();
  if (!settings.profileId) {
    // Nothing was selected: take the first new server. The selected one was replaced
    // by a subscription refresh: follow it by name.
    const pick = before ? profiles.find((p) => p.name === before.name && p.sub === before.sub) : res.added[0];
    if (pick) await saveSettings({ profileId: pick.id });
    rebuildMenus();
  }
  if (settings.enabled) await healthCheck();
  else notifyPages();
  return { added: res.added, errors: res.errors, removed: res.removed };
}

async function deleteProfile({ id }) {
  const wasCurrent = settings.profileId === id;
  await native("delete", { id }); // the helper stops the tunnel if it runs through this server
  const profiles = await syncProfiles();
  if (wasCurrent && profiles[0]) {
    await saveSettings({ profileId: profiles[0].id });
    rebuildMenus();
  }
  if (settings.enabled) await (settings.profileId ? healthCheck() : setEnabled(false));
  else notifyPages();
  return {};
}

async function renameProfile({ id, name }) {
  await native("rename", { id, name });
  await syncProfiles();
  notifyPages();
  return {};
}

const fetchJson = (url, force, ms, headers) => fetchVia(url, force, ms, headers, "json");

/** fetch with a timeout and a forced route ("vpn" | "direct" | null); as: "json" | "bytes". */
async function fetchVia(url, force, ms = 10000, headers = undefined, as = "json") {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  if (force) forcedRoutes.set(url, force);
  try {
    const r = await fetch(url, { cache: "no-store", credentials: "omit", signal: ctrl.signal, headers });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return as === "bytes" ? await r.arrayBuffer() : await r.json();
  } catch (e) {
    throw new Error(e && e.name === "AbortError" ? t("errTimeout") : e && e.message ? e.message : String(e));
  } finally {
    clearTimeout(timer);
    forcedRoutes.delete(url);
  }
}

const rnd = () => Math.random().toString(36).slice(2);

async function ipVia(force) {
  try {
    const j = await fetchJson(IP_URL + "&n=" + rnd(), force);
    if (!j || typeof j.ip !== "string" || !/^[0-9a-f.:]{3,45}$/i.test(j.ip)) throw new Error(t("errIpAnswer"));
    return { ip: j.ip };
  } catch (e) {
    return { error: e.message };
  }
}

const IP_KINDS = ["residential", "wireless", "business", "hosting", "education", "government"];

/** Country, provider and kind of an address from proxycheck.io (only when the user enabled it). */
async function ipDetails(ip, force) {
  try {
    const j = await fetchJson(IP_INFO_URL + encodeURIComponent(ip), force);
    const d = j && j[ip];
    if (!d) return null;
    const det = d.detections || {};
    const net = d.network || {};
    const loc = d.location || {};
    let kind = String(net.type || "").toLowerCase();
    if (det.tor) kind = "tor";
    else if (det.vpn) kind = "vpn";
    else if (det.proxy) kind = "proxy";
    else if (det.hosting) kind = "hosting";
    else if (!IP_KINDS.includes(kind)) kind = "other";
    const str = (v) => (typeof v === "string" ? v.slice(0, 80) : "");
    const code = str(loc.country_code).toUpperCase();
    return { kind, provider: str(net.provider || net.organisation), country: /^[A-Z]{2}$/.test(code) ? code : "" };
  } catch (_) {
    return null;
  }
}

/**
 * External addresses with the VPN and without it, and which of the two the
 * popup's tab uses for the site it shows.
 * tab: {tabId, incognito, cookieStoreId}; host: the tab's site (both optional).
 */
async function checkIp({ tab, host } = {}) {
  const hasVpn = settings.enabled && !!currentProfile();
  const [vpn, direct] = await Promise.all([hasVpn ? ipVia("vpn") : null, ipVia("direct")]);
  if (settings.ipInfo) {
    // Ask through the tunnel when it works, so the lookup itself does not come from the real address.
    const force = vpn && vpn.ip ? "vpn" : "direct";
    await Promise.all([vpn, direct].filter((x) => x && x.ip).map(async (x) => (x.info = await ipDetails(x.ip, force))));
  }
  let tabVia = null;
  if (settings.enabled) tabVia = (await wantsVpn(tab || { tabId: -1 }, host || "api.ipify.org")) ? "vpn" : "direct";
  return { vpn, direct, tabVia, ipInfo: !!settings.ipInfo };
}

/** Route of a site for the popup: via the VPN or not, and the site's country when GEO is on. */
async function routeInfo({ tab, host }) {
  const country = settings.geoMode !== "off" ? await countryOf(host) : null;
  const tunneled = TTScope.inScope(tab || { tabId: -1 }, scopeCtx()) && TTRules.route(host, settings, TTRules.needsCountry(host, settings) ? country : null);
  return { tunneled, country, geo: settings.geoMode !== "off", geoReady: !!geoDb };
}

const handlers = {
  getState,
  async setEnabled({ value }) {
    await setEnabled(value);
    return getState();
  },
  async setSettings({ patch }) {
    const allowed = [
      "profileId", "mode", "excludeList", "includeList", "bypassLocal", "killSwitch", "webrtcProtect",
      "scope", "inheritOpener", "tablessRoute", "vpnContainers", "geoMode", "geoCountries", "statsUrl", "ipInfo",
      "geoDns", "geoDnsUrl", "port", "infoPort",
    ];
    const clean = {};
    for (const k of allowed) if (k in patch) clean[k] = patch[k];
    if ("excludeList" in clean) clean.excludeList = TTRules.parseList(clean.excludeList.join("\n"));
    if ("includeList" in clean) clean.includeList = TTRules.parseList(clean.includeList.join("\n"));
    if ("mode" in clean && !["exclude", "include"].includes(clean.mode)) clean.mode = "exclude";
    if ("scope" in clean && !TTScope.SCOPES.includes(clean.scope)) clean.scope = "all";
    if ("tablessRoute" in clean) clean.tablessRoute = clean.tablessRoute === "vpn" ? "vpn" : "direct";
    if ("inheritOpener" in clean) clean.inheritOpener = !!clean.inheritOpener;
    if ("vpnContainers" in clean)
      clean.vpnContainers = Array.isArray(clean.vpnContainers) ? clean.vpnContainers.filter((x) => typeof x === "string") : [];
    if ("geoMode" in clean && !["off", "direct", "vpn"].includes(clean.geoMode)) clean.geoMode = "off";
    if ("geoCountries" in clean) clean.geoCountries = TTGeo.cleanCodes(clean.geoCountries);
    if ("ipInfo" in clean) clean.ipInfo = !!clean.ipInfo;
    if ("geoDns" in clean && clean.geoDns !== "custom" && !TTDoh.SERVICES[clean.geoDns]) clean.geoDns = TTDoh.DEFAULT;
    if ("geoDnsUrl" in clean) clean.geoDnsUrl = String(clean.geoDnsUrl || "").trim();
    if (("geoDns" in clean ? clean.geoDns : settings.geoDns) === "custom") {
      const own = TTDoh.cleanUrl("geoDnsUrl" in clean ? clean.geoDnsUrl : settings.geoDnsUrl);
      if (!own) throw new Error(t("errDnsUrl"));
      clean.geoDnsUrl = own;
    }
    if ("statsUrl" in clean) {
      const raw = String(clean.statsUrl || "").trim();
      let ok = !raw;
      try {
        ok = ok || /^https?:$/.test(new URL(raw).protocol);
      } catch (_) {}
      if (!ok) throw new Error(t("errStatsUrl"));
      clean.statsUrl = raw;
    }
    if ("profileId" in clean && clean.profileId && !settings.profiles.some((p) => p.id === clean.profileId))
      throw new Error(t("errNoSuchServer"));
    for (const k of ["port", "infoPort"]) {
      if (!(k in clean)) continue;
      clean[k] = Number(clean[k]);
      if (!Number.isInteger(clean[k]) || clean[k] < 1024 || clean[k] > 65535) throw new Error(t("errPort"));
    }
    if (("port" in clean ? clean.port : settings.port) === ("infoPort" in clean ? clean.infoPort : settings.infoPort))
      throw new Error(t("errPortsSame"));
    const changedServer = ["profileId", "port", "infoPort"].some((k) => k in clean && clean[k] !== settings[k]);
    await saveSettings(clean);
    if (settings.geoMode !== "off") await loadGeo();
    if ("webrtcProtect" in clean && settings.enabled) await applyWebRtc(true);
    if (["scope", "vpnContainers", "profileId"].some((k) => k in clean)) rebuildMenus();
    updateBadge();
    if (changedServer || "geoDns" in clean || "geoDnsUrl" in clean) dnsCache.clear(); // another vantage point or resolver
    if (changedServer && settings.enabled) {
      await setRuntime({ status: "connecting", error: null, since: null });
      await healthCheck();
    } else notifyPages();
    return getState();
  },
  async setTabVpn({ tabId, value }) {
    await setTabVpn(tabId, !!value);
    return getState();
  },
  async listProfiles() {
    await syncProfiles();
    return getState();
  },
  importServers,
  deleteProfile,
  renameProfile,
  async ping() {
    return native("ping");
  },
  async logs() {
    return native("logs", { lines: 150 });
  },
  async editList({ list, host, add }) {
    const key = list === "include" ? "includeList" : "excludeList";
    const entry = TTRules.normalizeEntry(host);
    if (!entry) throw new Error(t("errEmptyDomain"));
    const cur = settings[key].filter((e) => e !== entry);
    if (add) cur.push(entry);
    await saveSettings({ [key]: cur });
    return {};
  },
  async refresh() {
    await healthCheck();
    return getState();
  },
  checkIp,
  routeInfo,
  geoUpdate,
};

browser.runtime.onMessage.addListener((msg, sender) => {
  if (sender.id !== browser.runtime.id || !msg || !handlers[msg.type]) return undefined;
  return ready
    .then(() => handlers[msg.type](msg))
    .then(
      (data) => ({ ok: true, data }),
      (e) => ({ ok: false, error: e && e.message ? e.message : String(e) })
    );
});
