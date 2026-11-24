"use strict";

const $ = (id) => document.getElementById(id);
let state = null;
let currentHost = null;
let activeTab = null; // {id, incognito, cookieStoreId}
let containerName = ""; // name of the active tab's container, if any
let privateAllowed = true;
let marksKept = true; // "sessions" allowed: marks survive a restart

const STATUS = {
  off: ["statusOff", ""],
  connecting: ["statusConnecting", "connecting"],
  on: ["statusOn", "on"],
  error: ["statusError", "error"],
};

function current() {
  return state.profiles.find((p) => p.id === state.settings.profileId) || null;
}

function render() {
  const { settings, runtime } = state;
  $("toggle").checked = settings.enabled;
  const key = settings.enabled ? runtime.status : "off";
  const [label, cls] = STATUS[key] || STATUS.off;
  $("statusText").textContent = t(label);
  $("dot").className = "dot " + cls;
  const p = current();
  let sub = "";
  if (key === "error") sub = runtime.error || "";
  else if (key === "on" && p) sub = t("popupOnlyFirefox", [p.protocol, p.endpoint].filter(Boolean).join(" · "));
  else if (!state.profiles.length) sub = t("popupAddServer");
  $("statusSub").textContent = sub;

  const sel = $("profile");
  sel.textContent = "";
  if (!state.profiles.length) {
    sel.append(new Option(t("popupNoServers"), ""));
    sel.disabled = true;
  } else {
    sel.disabled = false;
    if (!settings.profileId) sel.append(new Option(t("popupChoose"), ""));
    for (const pr of state.profiles)
      sel.append(new Option(pr.name + (pr.protocol ? " · " + pr.protocol : ""), pr.id));
    sel.value = settings.profileId || "";
  }
  $("mode").value = settings.mode;
  $("scope").value = settings.scope || "all";
  renderTab();

  $("stats").hidden = key !== "on";
  $("lat").textContent = runtime.latency != null ? t("ms", runtime.latency) : "—";
  $("chk").textContent = fmtAgo(runtime.checkedAt);
  $("since").textContent = fmtSince(runtime.since);
  const m = runtime.metrics || {};
  $("rx").textContent = m.rx != null ? fmtBytes(m.rx) : "—";
  $("tx").textContent = m.tx != null ? fmtBytes(m.tx) : "—";
  $("version").textContent = state.version ? "v" + state.version : "";
  $("statsBtn").hidden = !settings.statsUrl;
  renderSite();
}

function tabCtx() {
  return activeTab ? { tabId: activeTab.id, incognito: activeTab.incognito, cookieStoreId: activeTab.cookieStoreId } : { tabId: -1 };
}

function scopeCtx() {
  const s = state.settings;
  return { scope: s.scope, vpnTabs: new Set(state.vpnTabs || []), vpnContainers: s.vpnContainers, tablessRoute: s.tablessRoute };
}

/** "VPN in this tab" switch and scope hints. */
function renderTab() {
  const { settings } = state;
  const scope = settings.scope || "all";
  const box = $("tabBox");
  const note = $("tabNote");
  box.hidden = scope !== "tabs" || !activeTab;
  if (!box.hidden) {
    const marked = (state.vpnTabs || []).includes(activeTab.id);
    const byContainer = TTScope.isVpnContainer(activeTab.cookieStoreId, settings);
    $("tabToggle").checked = marked || byContainer;
    $("tabToggle").disabled = byContainer && !marked;
    box.classList.toggle("on", settings.enabled && (marked || byContainer));
    const notKept = marked && !marksKept;
    note.hidden = !byContainer && !notKept;
    note.textContent = byContainer ? t("popupTabByContainer", containerName || activeTab.cookieStoreId) : notKept ? t("popupTabNotKept") : "";
  }
  const sn = $("scopeNote");
  let msg = "";
  if (scope === "private") msg = !privateAllowed ? t("privNotAllowed") : activeTab && !activeTab.incognito ? t("privThisTabDirect") : "";
  else if (!privateAllowed && settings.enabled) msg = t("privNotCovered");
  sn.textContent = msg;
  sn.hidden = !msg;
}

function renderSite() {
  if (!currentHost || !state) return;
  const { settings } = state;
  const local = TTRules.isLocal(currentHost);
  const tunneled = TTScope.inScope(tabCtx(), scopeCtx()) && TTRules.shouldTunnel(currentHost, settings);
  $("siteBox").hidden = false;
  $("siteHost").textContent = currentHost;
  $("siteHost").title = currentHost;
  const route = $("siteRoute");
  const showRoute = (viaVpn, country) => {
    const label = t(!settings.enabled ? "routeVpnOff" : viaVpn ? "routeVpn" : "routeDirect");
    route.textContent = country ? country + " · " + label : label;
    route.title = country ? TTGeo.nameOf(country, browser.i18n.getUILanguage()) : "";
    route.className = "pill" + (settings.enabled && viaVpn ? " vpn" : "");
  };
  showRoute(tunneled, null);
  if (settings.geoMode && settings.geoMode !== "off" && !local) {
    const host = currentHost;
    api("routeInfo", { tab: tabCtx(), host })
      .then((r) => {
        if (host === currentHost) showRoute(r.tunneled, r.country);
      })
      .catch(() => {});
  }

  const btn = $("siteBtn");
  const site = TTRules.siteOf(currentHost);
  btn.disabled = local;
  if (local) {
    btn.textContent = t("siteLocal");
    btn.dataset.action = "";
  } else if (settings.mode === "include") {
    const inList = TTRules.matchesList(currentHost, settings.includeList);
    btn.textContent = t(inList ? "siteIncludeRemove" : "siteIncludeAdd", site);
    btn.dataset.action = inList ? "include:remove" : "include:add";
  } else {
    const inList = TTRules.matchesList(currentHost, settings.excludeList);
    btn.textContent = t(inList ? "siteExcludeRemove" : "siteExcludeAdd", site);
    btn.dataset.action = inList ? "exclude:remove" : "exclude:add";
  }
}

async function refresh() {
  state = await api("getState");
  render();
}

$("toggle").addEventListener("change", async (e) => {
  const value = e.target.checked;
  try {
    state = await api("setEnabled", { value });
    render();
    if (value && state.runtime.status === "on") Toast.ok(t("toastVpnOn"));
    else if (value && state.runtime.status === "error") Toast.error(state.runtime.error);
    else if (!value) Toast.ok(t("toastVpnOff"));
  } catch (err) {
    Toast.error(err.message);
    refresh();
  }
});

$("profile").addEventListener("change", async (e) => {
  try {
    state = await api("setSettings", { patch: { profileId: e.target.value || null } });
    render();
    if (state.settings.enabled && state.runtime.status === "error") Toast.error(state.runtime.error);
    else Toast.ok(t("toastServerSelected"));
  } catch (err) {
    Toast.error(err.message);
  }
});

$("scope").addEventListener("change", async (e) => {
  try {
    state = await api("setSettings", { patch: { scope: e.target.value } });
    render();
    Toast.ok(t("toastScopeSaved"));
  } catch (err) {
    Toast.error(err.message);
  }
});

$("tabToggle").addEventListener("change", async (e) => {
  if (!activeTab) return;
  try {
    state = await api("setTabVpn", { tabId: activeTab.id, value: e.target.checked });
    render();
    Toast.ok(t(e.target.checked ? "toastTabVpnOn" : "toastTabVpnOff"));
  } catch (err) {
    Toast.error(err.message);
    refresh();
  }
});

$("mode").addEventListener("change", async (e) => {
  try {
    state = await api("setSettings", { patch: { mode: e.target.value } });
    render();
    Toast.ok(t("toastModeSaved"));
  } catch (err) {
    Toast.error(err.message);
  }
});

$("siteBtn").addEventListener("click", async (e) => {
  const [list, op] = (e.target.dataset.action || "").split(":");
  if (!list) return;
  try {
    await api("editList", { list, host: TTRules.siteOf(currentHost), add: op === "add" });
    await refresh();
    Toast.ok(t("toastListUpdated"));
  } catch (err) {
    Toast.error(err.message);
  }
});

function showIp(prefix, res) {
  const kind = $(prefix + "Kind");
  const sub = $(prefix + "Sub");
  kind.hidden = sub.hidden = true;
  if (!res) {
    $(prefix).textContent = t("ipVpnOff");
    return;
  }
  if (res.error) {
    $(prefix).textContent = t("ipFailed", res.error);
    return;
  }
  $(prefix).textContent = res.ip;
  const info = res.info;
  if (!info) return;
  kind.textContent = t("ipKind_" + info.kind) || info.kind;
  // An address seen as VPN, proxy, Tor or hosting is what sites may treat as "not a home user".
  kind.className = "pill" + (["vpn", "proxy", "tor", "hosting"].includes(info.kind) ? " warn" : " vpn");
  kind.hidden = false;
  const parts = [];
  if (info.country) parts.push(TTGeo.nameOf(info.country, browser.i18n.getUILanguage()));
  if (info.provider) parts.push(info.provider);
  sub.textContent = parts.join(" · ");
  sub.hidden = !parts.length;
}

async function checkIp() {
  const btn = $("ipBtn");
  btn.disabled = true;
  try {
    const res = await api("checkIp", { tab: activeTab ? tabCtx() : undefined, host: currentHost || undefined });
    $("ipBox").hidden = false;
    showIp("ipVpn", res.vpn);
    showIp("ipDirect", res.direct);
    const tabLine = $("ipTab");
    tabLine.hidden = !res.tabVia;
    // "Uses the VPN address" only when the VPN check itself succeeded.
    const vpnOk = !!(res.vpn && res.vpn.ip);
    if (res.tabVia) tabLine.textContent = t(res.tabVia !== "vpn" ? "ipTabDirect" : vpnOk ? "ipTabVpn" : "ipTabVpnDown");
    tabLine.classList.toggle("bad", res.tabVia === "vpn" && !vpnOk);
    $("ipInfoBtn").hidden = res.ipInfo;
    // The errors are shown in the box itself: no toast over the status. Keep the buttons in view.
    $("ipBtn").scrollIntoView({ block: "nearest" });
  } catch (err) {
    Toast.error(t("toastIpFailed", err.message));
  } finally {
    btn.disabled = false;
  }
}

$("ipBtn").addEventListener("click", checkIp);

// Country, provider and kind come from proxycheck.io: asked only after this click.
$("ipInfoBtn").addEventListener("click", async () => {
  try {
    state = await api("setSettings", { patch: { ipInfo: true } });
    await checkIp();
  } catch (err) {
    Toast.error(err.message);
  }
});

$("statsBtn").addEventListener("click", () => {
  const url = state && state.settings.statsUrl;
  if (!url) return;
  browser.tabs.create({ url });
  window.close();
});

$("optBtn").addEventListener("click", () => {
  browser.runtime.openOptionsPage();
  window.close();
});

browser.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === "stateChanged") refresh();
});

(async () => {
  applyI18n();
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (tab) activeTab = { id: tab.id, incognito: tab.incognito, cookieStoreId: tab.cookieStoreId };
    if (tab && tab.url && /^(https?|wss?):/.test(tab.url)) currentHost = new URL(tab.url).hostname;
    try {
      privateAllowed = await browser.extension.isAllowedIncognitoAccess();
    } catch (_) {}
    try {
      marksKept = await browser.permissions.contains({ permissions: ["sessions"] });
    } catch (_) {}
    if (tab && tab.cookieStoreId && tab.cookieStoreId !== "firefox-default" && !tab.incognito) {
      try {
        containerName = (await browser.contextualIdentities.get(tab.cookieStoreId)).name;
      } catch (_) {}
    }
    await refresh();
    if (state.settings.enabled) {
      state = await api("refresh");
      render();
    }
  } catch (e) {
    Toast.error(e.message);
  }
})();
