#!/usr/bin/env node
// Self-test for extension/lib/scope.js (where the VPN applies) together with lib/rules.js.
// Run: node scripts/test-scope.js
"use strict";
const path = require("path");
const assert = require("assert");
const TTScope = require(path.join(__dirname, "../extension/lib/scope.js"));
const TTRules = require(path.join(__dirname, "../extension/lib/rules.js"));

const tabs = new Set([7, 9]);
const ctx = (over = {}) => ({ scope: "tabs", vpnTabs: tabs, vpnContainers: ["firefox-container-2"], tablessRoute: "direct", ...over });

// "all": everything, including tab-less requests.
assert.strictEqual(TTScope.inScope({ tabId: 1 }, { scope: "all" }), true);
assert.strictEqual(TTScope.inScope({ tabId: -1 }, { scope: "all" }), true);
assert.strictEqual(TTScope.inScope({}, {}), true, "unknown scope falls back to all");

// "tabs": marked tabs only.
assert.strictEqual(TTScope.inScope({ tabId: 7 }, ctx()), true, "marked tab");
assert.strictEqual(TTScope.inScope({ tabId: 8 }, ctx()), false, "neighbour tab");
// Containers.
assert.strictEqual(TTScope.inScope({ tabId: 8, cookieStoreId: "firefox-container-2" }, ctx()), true, "VPN container");
assert.strictEqual(TTScope.inScope({ tabId: 8, cookieStoreId: "firefox-container-1" }, ctx()), false, "other container");
assert.strictEqual(TTScope.inScope({ tabId: 8, cookieStoreId: "firefox-default" }, ctx()), false, "default store");
// Tab-less requests follow tablessRoute.
assert.strictEqual(TTScope.inScope({ tabId: -1 }, ctx()), false, "tabless direct");
assert.strictEqual(TTScope.inScope({ tabId: -1 }, ctx({ tablessRoute: "vpn" })), true, "tabless via vpn");
assert.strictEqual(TTScope.inScope({}, ctx()), false, "missing tabId = tabless");
// ...but a VPN container covers its own tab-less requests (service workers, favicons).
assert.strictEqual(TTScope.inScope({ tabId: -1, cookieStoreId: "firefox-container-2" }, ctx()), true, "tabless of a VPN container");
assert.strictEqual(TTScope.inScope({ tabId: -1, cookieStoreId: "firefox-container-1" }, ctx()), false, "tabless of another container");
// Private windows do not matter in "tabs" scope.
assert.strictEqual(TTScope.inScope({ tabId: 8, incognito: true }, ctx()), false);

// "private": incognito only.
assert.strictEqual(TTScope.inScope({ tabId: 3, incognito: true }, { scope: "private" }), true);
assert.strictEqual(TTScope.inScope({ tabId: 3, incognito: false }, { scope: "private" }), false);
assert.strictEqual(TTScope.inScope({ tabId: 7 }, { scope: "private", vpnTabs: tabs }), false, "marks ignored in private scope");

// Scope AND site lists: inside a VPN tab the exclusion list still goes direct.
const settings = { mode: "exclude", excludeList: ["bank.example"], includeList: [], bypassLocal: true };
const route = (req, host) => TTScope.inScope(req, ctx()) && TTRules.shouldTunnel(host, settings);
assert.strictEqual(route({ tabId: 7 }, "news.example"), true);
assert.strictEqual(route({ tabId: 7 }, "online.bank.example"), false, "excluded site in VPN tab");
assert.strictEqual(route({ tabId: 8 }, "news.example"), false, "unmarked tab");
assert.strictEqual(route({ tabId: 7 }, "192.168.1.1"), false, "LAN stays direct");

console.log("OK: all scope checks passed");
