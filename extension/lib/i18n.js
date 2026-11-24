/* i18n helpers: t("key", ...subs) and applyI18n() for data-i18n* attributes. */
"use strict";

function t(key, ...subs) {
  return browser.i18n.getMessage(key, subs.map(String)) || key;
}

function applyI18n(root = document) {
  for (const el of root.querySelectorAll("[data-i18n]")) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll("[data-i18n-placeholder]")) el.placeholder = t(el.dataset.i18nPlaceholder);
  for (const el of root.querySelectorAll("[data-i18n-title]")) el.title = t(el.dataset.i18nTitle);
  document.documentElement.lang = browser.i18n.getUILanguage().split("-")[0];
}
