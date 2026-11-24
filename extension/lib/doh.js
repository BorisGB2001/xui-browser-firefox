/*
 * DNS over HTTPS (RFC 8484, wire format): build an A query, read the addresses
 * from the answer. The wire format is what every DoH server speaks, so one code
 * path serves the built-in services and a user's own server.
 * Pure functions, shared by background, options and the Node tests.
 */
"use strict";

const TTDoh = (() => {
  const SERVICES = {
    cloudflare: "https://cloudflare-dns.com/dns-query",
    google: "https://dns.google/dns-query",
    adguard: "https://unfiltered.adguard-dns.com/dns-query", // unfiltered: blocked names would have no country
  };
  const DEFAULT = "cloudflare";

  /** URL of the chosen service; "custom" uses settings.geoDnsUrl. Null when unusable. */
  function endpoint(settings) {
    const id = settings && settings.geoDns;
    if (id === "custom") return cleanUrl(settings.geoDnsUrl);
    return SERVICES[id] || SERVICES[DEFAULT];
  }

  /** Accept only https URLs without credentials; returns the URL without query and hash, or null. */
  function cleanUrl(raw) {
    try {
      const u = new URL(String(raw || "").trim());
      if (u.protocol !== "https:" || u.username || u.password) return null;
      u.search = "";
      u.hash = "";
      return u.href;
    } catch (_) {
      return null;
    }
  }

  /** DNS query for the A records of an ASCII host name. Returns null for a name that cannot be encoded. */
  function buildQuery(host) {
    const labels = String(host || "").replace(/\.$/, "").split(".");
    if (!labels.length || labels.some((l) => !l || l.length > 63 || !/^[\x21-\x7e]+$/.test(l))) return null;
    const len = labels.reduce((n, l) => n + l.length + 1, 0) + 1;
    if (len > 255) return null;
    const out = new Uint8Array(12 + len + 4);
    // id 0 (cache friendly, RFC 8484), flags: recursion desired, one question
    out[2] = 0x01;
    out[5] = 0x01;
    let i = 12;
    for (const l of labels) {
      out[i++] = l.length;
      for (let k = 0; k < l.length; k++) out[i++] = l.charCodeAt(k);
    }
    i++; // root label
    out[i + 1] = 1; // type A
    out[i + 3] = 1; // class IN
    return out;
  }

  function base64url(bytes) {
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  /** Full GET URL of a query, or null. */
  function queryUrl(base, host) {
    const q = buildQuery(host);
    return base && q ? base + "?dns=" + base64url(q) : null;
  }

  /** IPv4 addresses from a DNS answer (ArrayBuffer or Uint8Array). Throws on a malformed packet. */
  function parseAnswer(data) {
    const b = data instanceof Uint8Array ? data : new Uint8Array(data);
    const bad = () => new Error("malformed DNS answer");
    if (b.length < 12) throw bad();
    const u16 = (o) => {
      if (o + 2 > b.length) throw bad();
      return (b[o] << 8) | b[o + 1];
    };
    if (!(b[2] & 0x80)) throw bad(); // not a response
    if (b[3] & 0x0f) return []; // NXDOMAIN, SERVFAIL…: no addresses
    const skipName = (o) => {
      for (let hops = 0; hops < 128; hops++) {
        if (o >= b.length) throw bad();
        const n = b[o];
        if (n === 0) return o + 1;
        if ((n & 0xc0) === 0xc0) return o + 2; // compression pointer ends the name
        if (n & 0xc0) throw bad();
        o += n + 1;
      }
      throw bad();
    };
    let o = 12;
    for (let q = u16(4); q > 0; q--) o = skipName(o) + 4;
    const out = [];
    for (let a = u16(6); a > 0; a--) {
      o = skipName(o);
      const type = u16(o);
      const cls = u16(o + 2);
      const len = u16(o + 8);
      o += 10;
      if (o + len > b.length) throw bad();
      if (type === 1 && cls === 1 && len === 4) out.push(b[o] + "." + b[o + 1] + "." + b[o + 2] + "." + b[o + 3]);
      o += len;
    }
    return out;
  }

  return { SERVICES, DEFAULT, endpoint, cleanUrl, buildQuery, queryUrl, parseAnswer };
})();

if (typeof module !== "undefined") module.exports = TTDoh;
