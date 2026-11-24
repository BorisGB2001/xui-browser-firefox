/* Message helper for popup/options pages. */
"use strict";

async function api(type, args = {}) {
  const res = await browser.runtime.sendMessage({ type, ...args });
  if (!res) throw new Error(t("errNoBackground"));
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

/** Human-readable duration in seconds. */
function fmtDuration(d) {
  if (d < 60) return t("durSec", d);
  if (d < 3600) return t("durMin", Math.floor(d / 60));
  return t("durHour", Math.floor(d / 3600));
}

/** "5 min ago" for a unix timestamp, "never" for empty. */
function fmtAgo(sec) {
  if (!sec) return t("never");
  return t("ago", fmtDuration(Math.max(0, Math.floor(Date.now() / 1000) - sec)));
}

/** "5 min" since a unix timestamp. */
function fmtSince(sec) {
  if (!sec) return "—";
  return fmtDuration(Math.max(0, Math.floor(Date.now() / 1000) - sec));
}

/** "12.3 MB" for a byte count. */
function fmtBytes(n) {
  const units = t("byteUnits").split(",");
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return n.toFixed(i ? 1 : 0) + " " + units[i];
}
