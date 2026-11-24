/*
 * Countries by IP address (GEO routing).
 * The database is a list of IPv4 ranges with a country code, downloaded on request
 * (CSV "start,end,CC" with numeric addresses) and kept as typed arrays.
 * Pure functions, shared by background, options and the Node tests.
 */
"use strict";

const TTGeo = (() => {
  // ip-location-db (geo-whois-asn-country, CC0/PDDL data), served by jsDelivr.
  const DB_URL = "https://cdn.jsdelivr.net/npm/@ip-location-db/geo-whois-asn-country/geo-whois-asn-country-ipv4-num.csv";

  // ISO 3166-1 alpha-2.
  const CODES = (
    "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ " +
    "CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR " +
    "GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP " +
    "KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT " +
    "MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW " +
    "SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ " +
    "UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW"
  ).split(" ");

  const isCode = (c) => typeof c === "string" && /^[A-Z]{2}$/.test(c);
  const pack = (c) => (c.charCodeAt(0) << 8) | c.charCodeAt(1);
  const unpack = (n) => String.fromCharCode(n >> 8, n & 255);

  /** Keep valid, unique, upper-case country codes. */
  function cleanCodes(list) {
    const out = [];
    for (const raw of Array.isArray(list) ? list : []) {
      const c = String(raw || "").trim().toUpperCase();
      if (isCode(c) && !out.includes(c)) out.push(c);
    }
    return out;
  }

  /**
   * CSV "start,end,CC" (numeric IPv4, sorted) -> {starts, ends, cc, count}.
   * Neighbouring ranges of one country are merged.
   */
  function parseCsv(text) {
    const lines = String(text || "").split("\n");
    let starts = new Uint32Array(lines.length);
    let ends = new Uint32Array(lines.length);
    let cc = new Uint16Array(lines.length);
    let n = 0;
    let prevEnd = -1;
    for (const line of lines) {
      const a = line.indexOf(",");
      const b = line.indexOf(",", a + 1);
      if (a < 0 || b < 0) continue;
      const s = Number(line.slice(0, a));
      const e = Number(line.slice(a + 1, b));
      const code = line.slice(b + 1, b + 3).toUpperCase();
      if (!Number.isInteger(s) || !Number.isInteger(e) || s < 0 || e > 0xffffffff || e < s || !isCode(code)) continue;
      if (s <= prevEnd) continue; // unsorted or overlapping input: keep the lookup invariant
      const packed = pack(code);
      if (n && cc[n - 1] === packed && s === prevEnd + 1) ends[n - 1] = e;
      else {
        starts[n] = s;
        ends[n] = e;
        cc[n] = packed;
        n++;
      }
      prevEnd = e;
    }
    return { starts: starts.slice(0, n), ends: ends.slice(0, n), cc: cc.slice(0, n), count: n };
  }

  /** Country code of a numeric IPv4 address, or null. */
  function lookup(db, ip) {
    if (!db || !db.count || typeof ip !== "number") return null;
    let lo = 0;
    let hi = db.count - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (ip < db.starts[mid]) hi = mid - 1;
      else if (ip > db.ends[mid]) lo = mid + 1;
      else return unpack(db.cc[mid]);
    }
    return null;
  }

  /** Country name in the UI language ("Germany"), the code itself as a fallback. */
  function nameOf(code, locale) {
    try {
      return new Intl.DisplayNames([locale || "en"], { type: "region" }).of(code) || code;
    } catch (_) {
      return code;
    }
  }

  return { DB_URL, CODES, cleanCodes, parseCsv, lookup, nameOf };
})();

if (typeof module !== "undefined") module.exports = TTGeo;
