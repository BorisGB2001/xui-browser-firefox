/*
 * VPN scope: which requests the VPN applies to at all (before the site lists).
 *   "all"     — every request;
 *   "tabs"    — only marked tabs and tabs of selected containers;
 *               requests without a tab (tabId -1) follow settings.tablessRoute;
 *   "private" — only private-window requests.
 * Pure functions, shared by background, popup and the Node tests.
 */
"use strict";

const TTScope = (() => {
  const SCOPES = ["all", "tabs", "private"];

  /**
   * @param {{tabId?:number, incognito?:boolean, cookieStoreId?:string}} req
   * @param {{scope?:string, vpnTabs?:Set<number>, vpnContainers?:string[], tablessRoute?:string}} ctx
   */
  function inScope(req, ctx) {
    const scope = SCOPES.includes(ctx.scope) ? ctx.scope : "all";
    if (scope === "all") return true;
    if (scope === "private") return !!req.incognito;
    // scope === "tabs"
    // A VPN container covers its tab-less requests too (service workers, favicons).
    if (isVpnContainer(req.cookieStoreId, ctx)) return true;
    const tabId = typeof req.tabId === "number" ? req.tabId : -1;
    if (tabId < 0) return ctx.tablessRoute === "vpn";
    return !!(ctx.vpnTabs && ctx.vpnTabs.has(tabId));
  }

  function isVpnContainer(cookieStoreId, ctx) {
    return !!cookieStoreId && Array.isArray(ctx.vpnContainers) && ctx.vpnContainers.includes(cookieStoreId);
  }

  return { SCOPES, inScope, isVpnContainer };
})();

if (typeof module !== "undefined") module.exports = TTScope;
