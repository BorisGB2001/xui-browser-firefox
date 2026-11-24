#!/usr/bin/env node
/*
 * Tests for the background script without a browser: a mocked `browser` API and
 * a fake native helper.   Run: node scripts/test-extension.js
 */
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const EXT = path.join(__dirname, "..", "extension");
let passed = 0;
const ok = (name) => (passed++, console.log("ok  ", name));

function makeWorld(stored = {}, servers = [{ id: "nl", name: "NL", protocol: "vless", endpoint: "203.0.113.7:443" }]) {
  const calls = []; // helper commands, in order
  const host = { running: null, failStart: null, gate: null, serverDown: false, servers: [...servers], pid: 100, importAdds: [] };
  const local = { profiles: [...servers], ...stored };
  const session = {};
  const privacy = {};
  const alarms = new Set();
  const listeners = {};
  const ev = (name) => ({ addListener: (fn) => (listeners[name] = fn) });
  const setting = (name) => ({
    set: async ({ value }) => void (privacy[name] = value),
    clear: async () => void delete privacy[name],
  });
  const nop = async () => {};
  const browser = {
    i18n: { getMessage: (key, subs) => key + (subs && subs.length ? ":" + subs.join(",") : ""), getUILanguage: () => "en" },
    storage: {
      local: { get: async () => ({ ...local }), set: async (p) => void Object.assign(local, p) },
      session: { get: async () => ({ ...session }), set: async (p) => void Object.assign(session, p) },
    },
    runtime: {
      id: "x",
      sendNativeMessage: async (_name, msg) => {
        calls.push(msg.cmd);
        if (host.gate && msg.cmd === host.gate.cmd) await host.gate.promise;
        const state = () => ({ running: true, ...host.running, username: "xui", password: "pw", startedAt: 100, metrics: { rx: 10, tx: 5 } });
        switch (msg.cmd) {
          case "start":
            if (host.failStart) return { ok: false, error: host.failStart };
            if (!host.running || host.running.profile !== msg.id || host.running.port !== msg.port || host.running.infoPort !== msg.infoPort)
              host.running = { profile: msg.id, port: msg.port, infoPort: msg.infoPort, pid: ++host.pid };
            return { ok: true, state: state() };
          case "stop":
            host.running = null;
            return { ok: true };
          case "list":
            return { ok: true, profiles: [...host.servers] };
          case "import":
            host.servers.push(...host.importAdds);
            return { ok: true, added: host.importAdds, errors: [], removed: [] };
          case "delete":
            host.servers = host.servers.filter((s) => s.id !== msg.id);
            if (host.running && host.running.profile === msg.id) host.running = null;
            return { ok: true };
          default:
            return { ok: true };
        }
      },
      sendMessage: nop,
      getManifest: () => ({ version: "test" }),
      openOptionsPage() {},
      onStartup: ev("startup"),
      onInstalled: ev("installed"),
      onMessage: ev("message"),
    },
    action: { setBadgeText: nop, setBadgeBackgroundColor: nop, setTitle: nop, setIcon: nop },
    privacy: { network: { webRTCIPHandlingPolicy: setting("webrtc"), networkPredictionEnabled: setting("predict") } },
    alarms: {
      create: (n) => void alarms.add(n),
      clear: (n) => void alarms.delete(n),
      get: async (n) => (alarms.has(n) ? { name: n } : undefined),
      onAlarm: ev("alarm"),
    },
    proxy: { onRequest: ev("proxy"), onError: ev("proxyError") },
    webRequest: { onErrorOccurred: ev("reqError") },
    tabs: {
      query: async () => [],
      get: async (id) => ({ id }),
      create: async () => ({ id: 1 }),
      update: nop,
      onCreated: ev("tabCreated"),
      onRemoved: ev("tabRemoved"),
      onUpdated: ev("tabUpdated"),
    },
    menus: { removeAll: nop, create() {}, update: nop, refresh() {}, onShown: ev("menuShown"), onClicked: ev("menuClicked") },
    commands: { onCommand: ev("command") },
    permissions: { onAdded: ev("permAdded") },
  };
  const urls = []; // what the background fetched
  const fetch = async (url) => {
    urls.push(url);
    // The health probe must be routed into the tunnel; it fails when the server is down.
    const route = await listeners.proxy({ url, tabId: -1 });
    if (url.includes("generate_204")) {
      if (route.type !== "socks" || host.serverDown || !host.running) throw new TypeError("NetworkError");
      return { status: 204, ok: true };
    }
    return { ok: true, status: 200, json: async () => ({ ip: route.type === "socks" ? "198.51.100.1" : "192.0.2.1" }) };
  };
  const ctx = vm.createContext({
    browser, URL, setTimeout, clearTimeout, AbortController, fetch, performance, TextEncoder,
    console: { warn() {}, error() {}, log() {} },
  });
  for (const f of ["lib/i18n.js", "lib/rules.js", "lib/scope.js", "lib/geo.js", "lib/doh.js", "background.js"])
    vm.runInContext(fs.readFileSync(path.join(EXT, f), "utf8"), ctx, { filename: f });
  const send = async (msg) => {
    const res = await listeners.message(msg, { id: "x" });
    if (!res.ok) throw new Error(res.error);
    return res.data;
  };
  const proxy = (url, extra = {}) => listeners.proxy({ url, tabId: 1, ...extra });
  return { calls, host, local, session, privacy, alarms, listeners, send, proxy, urls };
}

const flush = () => new Promise((r) => setTimeout(r, 5));

(async () => {
  {
    const w = makeWorld({ profileId: "nl" });
    assert.strictEqual((await w.proxy("https://example.com/")).type, "direct");
    assert.deepStrictEqual(w.calls, [], "the helper is not touched while the VPN is off");
    ok("vpn off -> direct");
  }

  {
    const w = makeWorld({ profileId: "nl", excludeList: ["bank.ru"] });
    const st = await w.send({ type: "setEnabled", value: true });
    assert.strictEqual(st.runtime.status, "on");
    assert.deepStrictEqual([st.runtime.password, st.runtime.username, st.runtime.key], [undefined, undefined, undefined], "credentials must not reach the pages");
    assert.deepStrictEqual(st.runtime.metrics, { rx: 10, tx: 5 });
    const r = await w.proxy("https://example.com/");
    assert(!Array.isArray(r), "kill switch on: no direct fallback");
    assert.deepStrictEqual([r.type, r.host, r.port, r.username, r.password, r.proxyDNS], ["socks", "127.0.0.1", 40810, "xui", "pw", true]);
    assert(r.connectionIsolationKey);
    assert.strictEqual((await w.proxy("https://lk.bank.ru/")).type, "direct");
    assert.strictEqual((await w.proxy("http://192.168.1.1/")).type, "direct");
    assert.deepStrictEqual(w.privacy, { webrtc: "disable_non_proxied_udp", predict: false });
    assert(w.alarms.has("xui-health"));
    await w.send({ type: "setEnabled", value: false });
    assert.deepStrictEqual(w.privacy, {});
    assert(!w.alarms.has("xui-health") && w.host.running === null);
    assert.strictEqual(w.session.rt.password, null, "credentials are dropped when the VPN is off");
    assert.strictEqual((await w.proxy("https://example.com/")).type, "direct");
    ok("vpn on -> socks with password, lists honoured, privacy applied and cleared");
  }

  {
    const w = makeWorld({ profileId: "nl" });
    w.host.failStart = "xray не найден";
    const st = await w.send({ type: "setEnabled", value: true });
    assert.deepStrictEqual([st.runtime.status, st.runtime.error], ["error", "xray не найден"]);
    const r = await w.proxy("https://example.com/");
    assert.deepStrictEqual([r.type, r.port], ["http", 9], "tunnel down + kill switch -> blocked");
    assert.strictEqual(w.privacy.webrtc, "disable_non_proxied_udp");
    await w.send({ type: "setSettings", patch: { killSwitch: false } });
    assert.strictEqual((await w.proxy("https://example.com/")).type, "direct");
    w.host.failStart = null;
    await w.listeners.alarm({ name: "xui-health" });
    const up = await w.proxy("https://example.com/");
    assert(Array.isArray(up) && up[0].type === "socks" && up[1].type === "direct");
    ok("helper cannot start xray -> blocked by the kill switch; recovers at the next check");
  }

  {
    const w = makeWorld({ profileId: "nl" });
    w.host.serverDown = true;
    const st = await w.send({ type: "setEnabled", value: true });
    assert.strictEqual(st.runtime.status, "error");
    assert(/^errTunnelDown/.test(st.runtime.error), st.runtime.error);
    assert.strictEqual((await w.proxy("https://example.com/")).type, "socks", "requests still go into the tunnel, never around it");
    w.host.serverDown = false;
    await w.listeners.alarm({ name: "xui-health" });
    assert.strictEqual((await w.send({ type: "getState" })).runtime.status, "on");
    ok("xray runs but the server is silent -> error, then recovery");
  }

  {
    const w = makeWorld({}, []);
    const st = await w.send({ type: "setEnabled", value: true });
    assert.strictEqual(st.runtime.status, "error");
    assert.strictEqual((await w.proxy("https://example.com/")).port, 9);
    ok("no server selected -> error, traffic blocked");
  }

  {
    const w = makeWorld({ profileId: "nl" });
    let release;
    w.host.gate = { cmd: "start", promise: new Promise((r) => (release = r)) };
    const on = w.send({ type: "setEnabled", value: true });
    await flush();
    const off = w.send({ type: "setEnabled", value: false });
    await flush();
    release();
    await Promise.all([on, off]);
    assert.strictEqual(w.host.running, null, "tunnel must be stopped after the late start");
    assert.strictEqual(w.calls[w.calls.length - 1], "stop");
    assert.strictEqual((await w.send({ type: "getState" })).runtime.status, "off");
    assert.strictEqual((await w.proxy("https://example.com/")).type, "direct");
    ok("switch off during start -> tunnel stopped");
  }

  {
    const de = { id: "de", name: "DE", protocol: "trojan", endpoint: "t.example.com:443" };
    const w = makeWorld({ profileId: "nl" }, [{ id: "nl", name: "NL", protocol: "vless" }, de]);
    await w.send({ type: "setEnabled", value: true });
    const k1 = (await w.proxy("https://example.com/")).connectionIsolationKey;
    await w.send({ type: "setSettings", patch: { profileId: "de" } });
    assert.strictEqual(w.host.running.profile, "de");
    const r = await w.proxy("https://example.com/");
    assert.notStrictEqual(r.connectionIsolationKey, k1, "a new tunnel must not reuse old connections");
    await w.send({ type: "setSettings", patch: { port: 41000 } });
    assert.strictEqual((await w.proxy("https://example.com/")).port, 41000);
    await assert.rejects(w.send({ type: "setSettings", patch: { infoPort: 41000 } }), /errPortsSame/);
    await assert.rejects(w.send({ type: "setSettings", patch: { port: 80 } }), /errPort/);
    await assert.rejects(w.send({ type: "setSettings", patch: { profileId: "nope" } }), /errNoSuchServer/);
    ok("server and port changes restart the tunnel");
  }

  {
    const w = makeWorld({}, []);
    w.host.importAdds = [{ id: "a", name: "A", protocol: "vless" }, { id: "b", name: "B", protocol: "ss" }];
    const res = await w.send({ type: "importServers", text: "vless://…", name: "" });
    assert.strictEqual(res.added.length, 2);
    let st = await w.send({ type: "getState" });
    assert.deepStrictEqual([st.profiles.length, st.settings.profileId], [2, "a"], "first imported server is selected");
    await w.send({ type: "setEnabled", value: true });
    await w.send({ type: "deleteProfile", id: "a" });
    st = await w.send({ type: "getState" });
    assert.deepStrictEqual([st.settings.profileId, st.runtime.status, w.host.running.profile], ["b", "on", "b"], "next server takes over");
    await w.send({ type: "deleteProfile", id: "b" });
    st = await w.send({ type: "getState" });
    assert.deepStrictEqual([st.settings.profileId, st.settings.enabled, w.host.running], [null, false, null]);
    ok("import selects a server; deleting the active one switches or turns the VPN off");
  }

  {
    const w = makeWorld({ profileId: "nl", scope: "tabs" });
    await w.send({ type: "setTabVpn", tabId: 7, value: true }); // marking a tab turns the VPN on
    assert.strictEqual((await w.send({ type: "getState" })).settings.enabled, true);
    assert.strictEqual((await w.proxy("https://example.com/", { tabId: 7 })).type, "socks");
    assert.strictEqual((await w.proxy("https://example.com/", { tabId: 8 })).type, "direct");
    const ip = await w.send({ type: "checkIp", tab: { tabId: 8 }, host: "example.com" });
    assert.deepStrictEqual([ip.vpn.ip, ip.direct.ip, ip.tabVia], ["198.51.100.1", "192.0.2.1", "direct"]);
    ok("tabs scope: only the marked tab uses the tunnel; Check IP shows both addresses");
  }

  console.log(`\n${passed} tests passed`);
})().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
