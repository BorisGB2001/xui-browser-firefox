/* Routing rules: which hosts go through the tunnel. Shared by background and pages. */
"use strict";

const TTRules = (() => {
  /** Normalise one list entry: "https://Sub.Example.com/path" -> "sub.example.com". */
  function normalizeEntry(raw) {
    let s = String(raw || "").trim().toLowerCase();
    if (!s || s.startsWith("#")) return "";
    const cidr = /^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/.exec(s);
    if (cidr) return ipv4ToInt(cidr[1]) !== null && Number(cidr[2]) <= 32 ? s : ""; // IPv4 CIDR
    if (/^\[?[0-9a-f:.]+\]?\/\d+$/.test(s)) return ""; // any other "address/prefix" (IPv6 CIDR) is not supported
    s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, "").replace(/[/?#].*$/, "");
    s = s.replace(/^[^@]*@/, ""); // user:pass@host
    s = s.replace(/^\*\./, "").replace(/^\./, "");
    if (!s) return "";
    // The URL parser gives the form request hosts arrive in: punycode for IDN,
    // no port, canonical IPv6. Anything it rejects cannot match a host anyway.
    try {
      s = new URL("http://" + s).hostname;
    } catch (_) {
      try {
        s = new URL("http://[" + s + "]").hostname; // bare IPv6
      } catch (_e) {
        return "";
      }
    }
    return s.replace(/^\[|\]$/g, "").replace(/\.$/, "");
  }

  function parseList(text) {
    const seen = new Set();
    const out = [];
    for (const line of String(text || "").split(/\r?\n/)) {
      const body = line.replace(/(^|\s)#.*$/, ""); // comments: whole line or after a space
      for (const word of body.split(/[\s,]+/)) {
        const e = normalizeEntry(word);
        if (e && !seen.has(e)) {
          seen.add(e);
          out.push(e);
        }
      }
    }
    return out;
  }

  function ipv4ToInt(ip) {
    const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
    if (!m) return null;
    const parts = m.slice(1).map(Number);
    if (parts.some((p) => p > 255)) return null;
    return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
  }

  function inCidr(ip, cidr) {
    const [net, bitsStr] = cidr.split("/");
    const bits = Number(bitsStr);
    const a = ipv4ToInt(ip);
    const b = ipv4ToInt(net);
    if (a === null || b === null || !(bits >= 0 && bits <= 32)) return false;
    if (bits === 0) return true;
    const mask = (~0 << (32 - bits)) >>> 0;
    return (a & mask) >>> 0 === (b & mask) >>> 0;
  }

  const PRIVATE_V4 = ["127.0.0.0/8", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "169.254.0.0/16", "100.64.0.0/10"];

  /** Hosts that must never go through the tunnel (loopback, LAN). */
  function isLocal(host) {
    if (!host) return true;
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".lan") || host.endsWith(".internal")) return true;
    if (ipv4ToInt(host) !== null) return PRIVATE_V4.some((c) => inCidr(host, c));
    if (host.includes(":")) {
      const h = host.toLowerCase();
      return h === "::1" || h.startsWith("fe80:") || h.startsWith("fc") || h.startsWith("fd");
    }
    return !host.includes("."); // single-label intranet names
  }

  /** Does host match an entry: exact domain, any subdomain, exact IP, or IPv4 CIDR. */
  function matches(host, entry) {
    if (!entry) return false;
    if (entry.includes("/")) return inCidr(host, entry);
    return host === entry || host.endsWith("." + entry);
  }

  function matchesList(host, list) {
    return Array.isArray(list) && list.some((e) => matches(host, e));
  }

  /**
   * Decide whether a host goes through the VPN.
   * settings.mode: "exclude" — everything except the exclude list;
   *                "include" — only hosts in the include list.
   */
  function shouldTunnel(host, settings) {
    host = String(host || "").toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
    if (settings.bypassLocal !== false && isLocal(host)) return false;
    if (settings.mode === "include") return matchesList(host, settings.includeList);
    return !matchesList(host, settings.excludeList);
  }

  /** Is the host named in the site list of the current mode (an explicit choice)? */
  function isExplicit(host, settings) {
    return settings.mode === "include" ? matchesList(host, settings.includeList) : matchesList(host, settings.excludeList);
  }

  const cleanHost = (host) => String(host || "").toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  const geoOn = (settings) => settings.geoMode === "direct" || settings.geoMode === "vpn";

  /** Does routing this host need its country (GEO on and no rule decides earlier)? */
  function needsCountry(host, settings) {
    host = cleanHost(host);
    if (!geoOn(settings)) return false;
    if (settings.bypassLocal !== false && isLocal(host)) return false;
    return !isExplicit(host, settings);
  }

  /**
   * Full decision: local hosts, then the site lists (explicit entries win), then
   * countries, then the default of the mode.
   * settings.geoMode: "direct" — listed countries go direct, the rest via VPN;
   *                   "vpn"    — only listed countries via VPN, the rest direct.
   * country: ISO code of the host's server, or null when unknown.
   */
  function route(host, settings, country) {
    host = cleanHost(host);
    if (settings.bypassLocal !== false && isLocal(host)) return false;
    if (isExplicit(host, settings)) return settings.mode === "include";
    if (geoOn(settings) && country) {
      const listed = Array.isArray(settings.geoCountries) && settings.geoCountries.includes(country);
      return settings.geoMode === "vpn" ? listed : !listed;
    }
    return settings.mode !== "include";
  }

  /** Registrable-ish domain for "add this site": drops a leading "www.". */
  function siteOf(host) {
    return String(host || "").toLowerCase().replace(/^www\./, "");
  }

  return { normalizeEntry, parseList, ipv4ToInt, isLocal, matches, matchesList, shouldTunnel, isExplicit, needsCountry, route, siteOf };
})();

if (typeof module !== "undefined") module.exports = TTRules;
