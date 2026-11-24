/*
 * Toast notifications: top-right corner, page never shifts.
 * Success — green, ~4 s; error — red, ~9 s; hovering pauses the timer;
 * fade-out; ✕ on each; "Close all notifications" when more than one is shown.
 */
"use strict";

const Toast = (() => {
  let stack;
  let closeAll;

  function ensure() {
    if (stack) return;
    stack = document.createElement("div");
    stack.className = "toast-stack";
    stack.setAttribute("aria-live", "polite");
    closeAll = document.createElement("button");
    closeAll.className = "toast-close-all";
    closeAll.type = "button";
    closeAll.textContent = t("toastCloseAll");
    closeAll.addEventListener("click", () => [...stack.querySelectorAll(".toast")].forEach(dismiss));
    document.body.appendChild(stack);
    stack.appendChild(closeAll);
    refreshCloseAll();
  }

  function refreshCloseAll() {
    const n = stack.querySelectorAll(".toast:not(.leaving)").length;
    closeAll.hidden = n < 2;
  }

  function dismiss(el) {
    if (el.classList.contains("leaving")) return;
    clearTimeout(el._timer);
    el.classList.add("leaving");
    refreshCloseAll();
    setTimeout(() => {
      el.remove();
      refreshCloseAll();
    }, 300);
  }

  function arm(el) {
    clearTimeout(el._timer);
    el._timer = setTimeout(() => dismiss(el), el._ttl);
  }

  function show(message, kind = "ok") {
    ensure();
    const el = document.createElement("div");
    el.className = "toast toast-" + kind;
    el.setAttribute("role", kind === "error" ? "alert" : "status");
    const text = document.createElement("div");
    text.className = "toast-text";
    text.textContent = message;
    const x = document.createElement("button");
    x.type = "button";
    x.className = "toast-x";
    x.setAttribute("aria-label", t("toastClose"));
    x.textContent = "✕";
    x.addEventListener("click", () => dismiss(el));
    el.append(text, x);
    el._ttl = kind === "error" ? 9000 : 4000;
    el.addEventListener("mouseenter", () => clearTimeout(el._timer));
    el.addEventListener("mouseleave", () => arm(el));
    stack.insertBefore(el, closeAll);
    requestAnimationFrame(() => el.classList.add("shown"));
    arm(el);
    refreshCloseAll();
    return el;
  }

  return {
    ok: (m) => show(m, "ok"),
    error: (m) => show(m, "error"),
  };
})();
