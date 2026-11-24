"use strict";

const $ = (id) => document.getElementById(id);
let state = null;
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

// ------------------------------------------------------------------ helper status

async function ping() {
  const box = $("hostInfo");
  let r = null;
  try {
    r = await api("ping");
  } catch (_) {}
  box.textContent = "";
  if (r) {
    box.append(
      el("div", "ok-text", t("helperOk")),
      el("div", "muted small", t("helperMeta", r.version, r.xray || t("helperNoCore"), r.dataDir))
    );
    if (!r.xray) box.append(el("div", "err-text small", t("helperHint")));
  } else {
    box.append(el("div", "err-text", t("helperMissing")), el("div", "muted small", t("helperHint")));
  }
  return !!r;
}

$("pingBtn").addEventListener("click", async () => {
  if (await ping()) {
    Toast.ok(t("toastHelperOk"));
    await loadProfiles();
  } else Toast.error(t("toastHelperFail"));
});

// ------------------------------------------------------------------ server list

/** Re-read the server list from the helper (falls back to the cached one). */
async function loadProfiles() {
  try {
    state = await api("listProfiles");
  } catch (_) {
    state = await api("getState");
  }
  renderProfiles();
}

function subLabel(url) {
  try {
    return new URL(url).host; // the path of a subscription address is a secret token
  } catch (_) {
    return url;
  }
}

function renderProfiles() {
  const root = $("profiles");
  root.textContent = "";
  renderSubs();
  if (!state.profiles.length) {
    root.append(el("div", "empty", t("optNoServers")));
    $("editBox").open = true;
    return;
  }
  for (const p of state.profiles) {
    const row = el("div", "profile" + (p.id === state.settings.profileId ? " active" : ""));

    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "profile";
    radio.checked = p.id === state.settings.profileId;
    radio.disabled = !!p.error;
    radio.title = t("optUseServer");
    radio.addEventListener("change", () => selectProfile(p.id));

    const info = el("div");
    const name = el("div", "name", p.name);
    if (p.protocol) name.append(el("span", "badge", p.protocol.toUpperCase()));
    const meta = p.error ? [t("metaError", p.error)] : [p.endpoint, p.transport, p.sub ? t("metaSub", subLabel(p.sub)) : ""];
    info.append(name, el("div", "meta", meta.filter(Boolean).join(" · ")));

    const btns = el("div", "btns");
    const ren = el("button", "", t("btnRename"));
    ren.type = "button";
    ren.addEventListener("click", () => renameProfile(p));
    const del = el("button", "danger", t("btnDelete"));
    del.type = "button";
    del.addEventListener("click", () => deleteProfile(p));
    btns.append(ren, del);

    row.append(radio, info, btns);
    root.append(row);
  }
}

function renderSubs() {
  const counts = new Map();
  for (const p of state.profiles) if (p.sub) counts.set(p.sub, (counts.get(p.sub) || 0) + 1);
  $("subsBox").hidden = !counts.size;
  const root = $("subs");
  root.textContent = "";
  for (const [url, count] of counts) {
    const row = el("div", "profile");
    const info = el("div");
    info.append(el("div", "name", subLabel(url)), el("div", "meta", t("subMeta", count)));
    const btns = el("div", "btns");
    const btn = el("button", "", t("btnRefresh"));
    btn.type = "button";
    btn.addEventListener("click", () => importText(url, "", btn));
    btns.append(btn);
    row.append(el("span"), info, btns);
    root.append(row);
  }
}

async function selectProfile(id) {
  try {
    state = await api("setSettings", { patch: { profileId: id } });
    renderProfiles();
    if (state.settings.enabled && state.runtime.status === "error") Toast.error(state.runtime.error);
    else Toast.ok(t(state.settings.enabled ? "toastServerSelectedChecked" : "toastServerSelected"));
  } catch (e) {
    Toast.error(e.message);
  }
}

async function renameProfile(p) {
  const name = prompt(t("promptRename"), p.name);
  if (!name || name.trim() === p.name) return;
  try {
    await api("renameProfile", { id: p.id, name: name.trim() });
    state = await api("getState");
    renderProfiles();
    Toast.ok(t("toastRenamed"));
  } catch (e) {
    Toast.error(e.message);
  }
}

async function deleteProfile(p) {
  if (!confirm(t("confirmDelete", p.name))) return;
  try {
    await api("deleteProfile", { id: p.id });
    state = await api("getState");
    renderProfiles();
    Toast.ok(t("toastServerDeleted"));
  } catch (e) {
    Toast.error(e.message);
  }
}

// ------------------------------------------------------------------ import

/** Add servers from links or a subscription address; also refreshes a subscription. */
async function importText(text, name, btn) {
  btn.disabled = true;
  try {
    const res = await api("importServers", { text, name });
    state = await api("getState");
    renderProfiles();
    if (res.added.length === 1 && !res.removed.length) Toast.ok(t("toastImportedOne", res.added[0].name));
    else Toast.ok(t("toastImported", res.added.length));
    if (res.removed.length) Toast.ok(t("toastSubRemoved", res.removed.length));
    if (res.errors.length) Toast.error(t("toastImportErrors", res.errors.join("; ")));
    if (state.settings.enabled && state.runtime.status === "error") Toast.error(state.runtime.error);
    return true;
  } catch (e) {
    Toast.error(e.message);
    return false;
  } finally {
    btn.disabled = false;
  }
}

$("impFile").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  if (file.size > 1024 * 1024) {
    Toast.error(t("errFileTooBig"));
    return;
  }
  $("impText").value = await file.text();
  Toast.ok(t("toastFileRead"));
});

$("importBtn").addEventListener("click", async () => {
  const text = $("impText").value.trim();
  if (!text) {
    Toast.error(t("errPasteKey"));
    return;
  }
  if (await importText(text, $("fName").value.trim(), $("importBtn"))) {
    $("impText").value = "";
    $("fName").value = "";
    $("editBox").open = false;
  }
});

$("logBtn").addEventListener("click", async () => {
  try {
    const { log } = await api("logs");
    const pre = $("log");
    pre.hidden = false;
    pre.textContent = log || t("logEmpty");
    pre.scrollTop = pre.scrollHeight;
  } catch (e) {
    Toast.error(e.message);
  }
});

// ------------------------------------------------------------------ settings form

// ------------------------------------------------------------------ VPN scope

function selectedScope() {
  return document.querySelector('input[name="scope"]:checked')?.value || "all";
}

function syncScope() {
  const scope = selectedScope();
  $("tabsOpts").hidden = scope !== "tabs";
}
for (const r of document.querySelectorAll('input[name="scope"]')) r.addEventListener("change", syncScope);

async function renderContainers() {
  const root = $("containers");
  root.textContent = "";
  let list = null;
  try {
    list = await browser.contextualIdentities.query({});
  } catch (_) {}
  if (!Array.isArray(list)) {
    root.append(el("div", "muted small", t("containersOff")));
    return;
  }
  if (!list.length) {
    root.append(el("div", "muted small", t("containersNone")));
    return;
  }
  const chosen = new Set(state.settings.vpnContainers || []);
  for (const c of list) {
    const label = el("label");
    const box = document.createElement("input");
    box.type = "checkbox";
    box.className = "container-box";
    box.value = c.cookieStoreId;
    box.checked = chosen.has(c.cookieStoreId);
    const dot = el("span", "cdot");
    dot.style.background = c.colorCode || "#888";
    label.append(box, dot, el("span", "", c.name));
    root.append(label);
  }
}

async function renderPrivateStatus() {
  const box = $("privStatus");
  let allowed = false;
  try {
    allowed = await browser.extension.isAllowedIncognitoAccess();
  } catch (_) {}
  box.textContent = "";
  box.append(el("span", allowed ? "ok-text" : "err-text", t(allowed ? "privAllowed" : "privNotAllowed")));
}

// "sessions" is asked for here, with the reason next to the button, not at install time.
const SESSIONS = { permissions: ["sessions"] };

async function renderRemember() {
  let has = false;
  try {
    has = await browser.permissions.contains(SESSIONS);
  } catch (_) {}
  const box = $("rememberStatus");
  box.textContent = "";
  box.append(el("span", has ? "ok-text" : "err-text", t(has ? "rememberOn" : "rememberOff")));
  $("rememberBtn").hidden = has;
}

$("rememberBtn").addEventListener("click", async () => {
  try {
    // Must be the first await of the click handler: Firefox wants a user action.
    const ok = await browser.permissions.request(SESSIONS);
    await renderRemember();
    if (ok) Toast.ok(t("toastRememberOn"));
    else Toast.error(t("toastRememberDenied"));
  } catch (e) {
    Toast.error(e.message);
  }
});

// ------------------------------------------------------------------ countries (GEO)

const geoSel = new Set();
const uiLang = browser.i18n.getUILanguage();
const COUNTRIES = TTGeo.CODES.map((code) => ({ code, name: TTGeo.nameOf(code, uiLang) })).sort((a, b) =>
  a.name.localeCompare(b.name, uiLang)
);

function selectedGeoMode() {
  return document.querySelector('input[name="geoMode"]:checked')?.value || "off";
}

function syncGeo() {
  $("geoOpts").hidden = selectedGeoMode() === "off";
  $("geoDnsUrlBox").hidden = $("geoDns").value !== "custom";
}
$("geoDns").addEventListener("change", syncGeo);
for (const r of document.querySelectorAll('input[name="geoMode"]')) r.addEventListener("change", syncGeo);

function renderGeoList() {
  const q = $("geoSearch").value.trim().toLowerCase();
  const onlySel = $("geoOnlySel").checked;
  const root = $("geoList");
  root.textContent = "";
  for (const c of COUNTRIES) {
    if (onlySel && !geoSel.has(c.code)) continue;
    if (q && !c.name.toLowerCase().includes(q) && c.code.toLowerCase() !== q) continue;
    const label = el("label");
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = geoSel.has(c.code);
    box.addEventListener("change", () => {
      if (box.checked) geoSel.add(c.code);
      else geoSel.delete(c.code);
      renderGeoCount();
    });
    label.append(box, el("span", "", c.name), el("span", "code", c.code));
    root.append(label);
  }
  if (!root.childElementCount) root.append(el("div", "muted small", t("geoNothing")));
  renderGeoCount();
}

function renderGeoCount() {
  const names = COUNTRIES.filter((c) => geoSel.has(c.code)).map((c) => c.name);
  $("geoCount").textContent = names.length ? t("geoSelected", names.length, names.join(", ")) : t("geoNoneSelected");
}

function renderGeoDb() {
  const meta = state.settings.geoMeta;
  const box = $("geoDbStatus");
  box.textContent = "";
  box.append(
    meta
      ? el("span", "ok-text", t("geoDbOk", meta.count.toLocaleString(uiLang), new Date(meta.updatedAt * 1000).toLocaleDateString(uiLang)))
      : el("span", "err-text", t("geoDbMissing"))
  );
}

$("geoSearch").addEventListener("input", renderGeoList);
$("geoOnlySel").addEventListener("change", renderGeoList);
$("geoClear").addEventListener("click", () => {
  geoSel.clear();
  renderGeoList();
});

async function updateGeoDb() {
  const btn = $("geoUpdateBtn");
  btn.disabled = true;
  btn.textContent = t("geoUpdating");
  try {
    state = await api("geoUpdate");
    renderGeoDb();
    Toast.ok(t("toastGeoUpdated", state.settings.geoMeta.count.toLocaleString(uiLang)));
  } catch (e) {
    Toast.error(e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = t("geoUpdate");
  }
}
$("geoUpdateBtn").addEventListener("click", updateGeoDb);

async function renderHotkeys() {
  let cmds = [];
  try {
    cmds = await browser.commands.getAll();
  } catch (_) {}
  const parts = cmds.filter((c) => c.shortcut).map((c) => c.shortcut + " — " + c.description);
  $("hotkeys").textContent = (parts.length ? t("hotkeysList", parts.join("; ")) + " " : "") + t("hotkeysHint");
}

function fillSettings() {
  const s = state.settings;
  for (const r of document.querySelectorAll('input[name="mode"]')) r.checked = r.value === s.mode;
  for (const r of document.querySelectorAll('input[name="scope"]')) r.checked = r.value === (s.scope || "all");
  $("inheritOpener").checked = s.inheritOpener !== false;
  $("tablessRoute").value = s.tablessRoute === "vpn" ? "vpn" : "direct";
  syncScope();
  $("excludeList").value = s.excludeList.join("\n");
  $("includeList").value = s.includeList.join("\n");
  for (const k of ["bypassLocal", "killSwitch", "webrtcProtect"]) $(k).checked = !!s[k];
  for (const r of document.querySelectorAll('input[name="geoMode"]')) r.checked = r.value === (s.geoMode || "off");
  geoSel.clear();
  for (const c of s.geoCountries || []) geoSel.add(c);
  $("geoDns").value = s.geoDns === "custom" || TTDoh.SERVICES[s.geoDns] ? s.geoDns : TTDoh.DEFAULT;
  $("geoDnsUrl").value = s.geoDnsUrl || "";
  syncGeo();
  renderGeoList();
  renderGeoDb();
  $("statsUrl").value = s.statsUrl || "";
  $("port").value = s.port;
  $("infoPort").value = s.infoPort;
  $("version").textContent = state.version ? "v" + state.version : "";
}

$("saveBtn").addEventListener("click", async () => {
  const patch = {
    mode: document.querySelector('input[name="mode"]:checked')?.value || "exclude",
    excludeList: TTRules.parseList($("excludeList").value),
    includeList: TTRules.parseList($("includeList").value),
  };
  for (const k of ["bypassLocal", "killSwitch", "webrtcProtect"]) patch[k] = $(k).checked;
  patch.scope = selectedScope();
  patch.inheritOpener = $("inheritOpener").checked;
  patch.tablessRoute = $("tablessRoute").value;
  const boxes = [...document.querySelectorAll(".container-box")];
  if (boxes.length) patch.vpnContainers = boxes.filter((b) => b.checked).map((b) => b.value);
  patch.geoMode = selectedGeoMode();
  patch.geoCountries = [...geoSel];
  patch.geoDns = $("geoDns").value;
  patch.geoDnsUrl = $("geoDnsUrl").value.trim();
  patch.statsUrl = $("statsUrl").value.trim();
  patch.port = Number($("port").value);
  patch.infoPort = Number($("infoPort").value);
  try {
    state = await api("setSettings", { patch });
    fillSettings();
    Toast.ok(t("toastSaved"));
    // Countries need the database: fetch it the first time they are switched on.
    if (state.settings.geoMode !== "off" && !state.settings.geoMeta) await updateGeoDb();
  } catch (e) {
    Toast.error(e.message);
  }
});

browser.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === "stateChanged")
    api("getState").then((s) => {
      state = s;
      renderProfiles();
    });
});

(async () => {
  applyI18n();
  try {
    state = await api("getState");
    fillSettings();
    renderProfiles();
    if (await ping()) await loadProfiles();
    await Promise.all([renderContainers(), renderPrivateStatus(), renderHotkeys(), renderRemember()]);
  } catch (e) {
    Toast.error(e.message);
  }
})();
