#!/usr/bin/env node
// Self-test for extension/lib/geo.js (countries by IP) and the list/GEO part of lib/rules.js.
// Run: node scripts/test-geo.js
"use strict";
const path = require("path");
const assert = require("assert");
const TTGeo = require(path.join(__dirname, "../extension/lib/geo.js"));
const TTRules = require(path.join(__dirname, "../extension/lib/rules.js"));

const ip = TTRules.ipv4ToInt;

// --- database: parse, merge, lookup
const csv = [
  "16777216,16777471,AU",
  "16777472,16778239,CN",
  "16778240,16779263,CN", // neighbour of the same country: merged
  "16779264,16781311,au", // lower case is accepted
  "bad line",
  "16781312,16781000,JP", // end < start: skipped
  "16781312,16785407,JP",
  "16781400,16781500,DE", // overlaps the previous range: skipped
  "3232235520,3232301055,ZZ",
  "4294967040,4294967295,FI",
].join("\n");
const db = TTGeo.parseCsv(csv);
assert.strictEqual(db.count, 6, "ranges after merging and skipping");
assert.strictEqual(TTGeo.lookup(db, ip("1.0.0.1")), "AU");
assert.strictEqual(TTGeo.lookup(db, ip("1.0.1.0")), "CN");
assert.strictEqual(TTGeo.lookup(db, ip("1.0.7.255")), "CN", "end of the merged range");
assert.strictEqual(TTGeo.lookup(db, ip("1.0.8.0")), "AU");
assert.strictEqual(TTGeo.lookup(db, ip("1.0.16.50")), "JP", "the overlapping DE line did not win");
assert.strictEqual(TTGeo.lookup(db, ip("255.255.255.255")), "FI", "top of the address space");
assert.strictEqual(TTGeo.lookup(db, ip("0.0.0.1")), null, "below the first range");
assert.strictEqual(TTGeo.lookup(db, ip("8.8.8.8")), null, "gap between ranges");
assert.strictEqual(TTGeo.lookup(null, 1), null);
assert.strictEqual(TTGeo.lookup(TTGeo.parseCsv(""), 1), null, "empty database");

assert.deepStrictEqual(TTGeo.cleanCodes(["de", "DE", " fi ", "x", "123", null, "USA"]), ["DE", "FI"]);
assert.strictEqual(new Set(TTGeo.CODES).size, TTGeo.CODES.length, "no duplicate country codes");
assert.ok(TTGeo.CODES.length >= 249 && TTGeo.CODES.every((c) => /^[A-Z]{2}$/.test(c)));
assert.strictEqual(TTGeo.nameOf("DE", "en"), "Germany");

// --- routing: local > site lists > countries > default of the mode
const base = { mode: "exclude", excludeList: ["bank.example"], includeList: ["video.example"], bypassLocal: true };
const direct = { ...base, geoMode: "direct", geoCountries: ["DE", "RU"] }; // listed countries go direct
const only = { ...base, geoMode: "vpn", geoCountries: ["FI"] }; // only listed countries via VPN

assert.strictEqual(TTRules.route("site.example", base, "DE"), true, "GEO off: country ignored");
assert.strictEqual(TTRules.route("site.example", direct, "DE"), false, "listed country goes direct");
assert.strictEqual(TTRules.route("site.example", direct, "FI"), true, "other countries via VPN");
assert.strictEqual(TTRules.route("site.example", direct, null), true, "unknown country: default of the mode");
assert.strictEqual(TTRules.route("online.bank.example", direct, "FI"), false, "exclusion list beats the country");
assert.strictEqual(TTRules.route("192.168.1.10", direct, "FI"), false, "LAN stays direct");

assert.strictEqual(TTRules.route("site.example", only, "FI"), true, "only listed countries via VPN");
assert.strictEqual(TTRules.route("site.example", only, "DE"), false);
assert.strictEqual(TTRules.route("bank.example", only, "FI"), false, "exclusion list still wins");

const inc = { ...direct, mode: "include" };
assert.strictEqual(TTRules.route("video.example", inc, "DE"), true, "include list beats the country");
assert.strictEqual(TTRules.route("site.example", inc, "FI"), true, "not listed: the country decides");
assert.strictEqual(TTRules.route("site.example", inc, "DE"), false);
assert.strictEqual(TTRules.route("site.example", inc, null), false, "unknown country in include mode: direct");

// route() without GEO equals shouldTunnel()
for (const h of ["site.example", "bank.example", "video.example", "localhost", "10.0.0.1"])
  for (const m of ["exclude", "include"])
    assert.strictEqual(TTRules.route(h, { ...base, mode: m }, "DE"), TTRules.shouldTunnel(h, { ...base, mode: m }), h + " " + m);

assert.strictEqual(TTRules.needsCountry("site.example", base), false, "GEO off");
assert.strictEqual(TTRules.needsCountry("site.example", direct), true);
assert.strictEqual(TTRules.needsCountry("bank.example", direct), false, "explicit entry: no lookup");
assert.strictEqual(TTRules.needsCountry("localhost", direct), false, "local host: no lookup");

// --- list entries are normalised to what request hosts look like
const norm = TTRules.normalizeEntry;
assert.strictEqual(norm("https://Sub.Example.com/path?x=1"), "sub.example.com");
assert.strictEqual(norm("*.example.com"), "example.com");
assert.strictEqual(norm("example.com."), "example.com", "trailing dot");
assert.strictEqual(norm("example.com:8443"), "example.com");
assert.strictEqual(norm("user@foo.com"), "foo.com");
assert.strictEqual(norm("пример.рф"), "xn--e1afmkfd.xn--p1ai", "IDN -> punycode");
assert.strictEqual(norm("[2001:db8::1]:443"), "2001:db8::1");
assert.strictEqual(norm("2001:DB8::1"), "2001:db8::1");
assert.strictEqual(norm("10.0.0.0/8"), "10.0.0.0/8");
assert.strictEqual(norm("10.0.0.0/33"), "", "bad prefix length");
assert.strictEqual(norm("300.1.1.1/8"), "", "bad address");
assert.strictEqual(norm("fd00::/8"), "", "IPv6 CIDR is not supported");
assert.strictEqual(norm("# comment"), "");
assert.strictEqual(norm("not a host!"), "");
assert.strictEqual(TTRules.shouldTunnel("xn--e1afmkfd.xn--p1ai", { mode: "include", includeList: TTRules.parseList("пример.рф") }), true);

// --- DNS over HTTPS, wire format (lib/doh.js)
const TTDoh = require(path.join(__dirname, "../extension/lib/doh.js"));
const q = TTDoh.buildQuery("www.example.com");
assert.deepStrictEqual([...q], [0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0,
  3, 119, 119, 119, 7, 101, 120, 97, 109, 112, 108, 101, 3, 99, 111, 109, 0, 0, 1, 0, 1]);
assert.strictEqual(TTDoh.queryUrl("https://dns.example/dns-query", "www.example.com"),
  "https://dns.example/dns-query?dns=AAABAAABAAAAAAAAA3d3dwdleGFtcGxlA2NvbQAAAQAB");
assert.strictEqual(TTDoh.buildQuery("a..b"), null, "empty label");
assert.strictEqual(TTDoh.buildQuery("x".repeat(64) + ".com"), null, "label too long");
assert.strictEqual(TTDoh.buildQuery("пример.рф"), null, "non-ASCII must be punycode first");
assert.strictEqual(TTDoh.queryUrl(null, "example.com"), null);

// answer: question + CNAME (compressed) + two A records + one AAAA
const answer = Uint8Array.from([
  0, 0, 0x81, 0x80, 0, 1, 0, 4, 0, 0, 0, 0,
  3, 119, 119, 119, 7, 101, 120, 97, 109, 112, 108, 101, 3, 99, 111, 109, 0, 0, 1, 0, 1,
  0xc0, 12, 0, 5, 0, 1, 0, 0, 0, 60, 0, 6, 3, 99, 100, 110, 0xc0, 16, // CNAME cdn.example.com
  0xc0, 45, 0, 1, 0, 1, 0, 0, 0, 60, 0, 4, 93, 184, 216, 34,
  0xc0, 45, 0, 28, 0, 1, 0, 0, 0, 60, 0, 16, 32, 1, 13, 184, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1,
  0xc0, 45, 0, 1, 0, 1, 0, 0, 0, 60, 0, 4, 1, 2, 3, 4,
]);
assert.deepStrictEqual(TTDoh.parseAnswer(answer), ["93.184.216.34", "1.2.3.4"]);
assert.deepStrictEqual(TTDoh.parseAnswer(answer.buffer), ["93.184.216.34", "1.2.3.4"], "ArrayBuffer input");
const nx = Uint8Array.from(answer.slice(0, 33));
nx[3] = 0x83; nx[7] = 0; // NXDOMAIN, no answers
assert.deepStrictEqual(TTDoh.parseAnswer(nx), []);
assert.throws(() => TTDoh.parseAnswer(answer.slice(0, 60)), /malformed/, "truncated packet");
assert.throws(() => TTDoh.parseAnswer(q), /malformed/, "a query is not an answer");
assert.throws(() => TTDoh.parseAnswer(new Uint8Array(5)), /malformed/);

assert.strictEqual(TTDoh.endpoint({}), TTDoh.SERVICES.cloudflare, "default service");
assert.strictEqual(TTDoh.endpoint({ geoDns: "google" }), "https://dns.google/dns-query");
assert.strictEqual(TTDoh.endpoint({ geoDns: "adguard" }), TTDoh.SERVICES.adguard);
assert.strictEqual(TTDoh.endpoint({ geoDns: "custom", geoDnsUrl: " https://dns.home.example/dns-query?x=1#y " }), "https://dns.home.example/dns-query");
assert.strictEqual(TTDoh.endpoint({ geoDns: "custom", geoDnsUrl: "http://dns.home.example/dns-query" }), null, "https only");
assert.strictEqual(TTDoh.endpoint({ geoDns: "custom", geoDnsUrl: "https://user:pw@dns.example/q" }), null, "no credentials in the URL");
assert.strictEqual(TTDoh.endpoint({ geoDns: "custom", geoDnsUrl: "" }), null);

console.log("OK: all geo and list checks passed");
