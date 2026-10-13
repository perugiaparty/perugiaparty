// PerugiaParty notifications: one look for every error, warning and success message on the site.
// ppNotify("Message", "error" | "warn" | "ok" | "info", { title, timeout, action: { label, onClick } })
(function () {
  const ICON = { error: "!", warn: "!", ok: "✓", info: "i" };
  const TITLE = { error: "Something went wrong", warn: "Heads up", ok: "Done", info: "Good to know" };
  let box = null;
  function root() {
    if (box && document.body.contains(box)) return box;
    box = document.createElement("div");
    box.className = "pp-notes";
    box.setAttribute("aria-live", "polite");
    document.body.appendChild(box);
    return box;
  }
  function close(n) {
    if (!n || n.dataset.closing) return;
    n.dataset.closing = "1";
    n.classList.remove("in");
    setTimeout(() => n.remove(), 260);
  }
  window.ppNotify = function (message, type = "error", opts = {}) {
    const r = root();
    const key = type + "|" + message;
    const same = [...r.children].find((n) => n.dataset.key === key && !n.dataset.closing);
    if (same) { clearTimeout(same._t); same._t = setTimeout(() => close(same), opts.timeout ?? 6000); return same; }
    while (r.children.length >= 3) close(r.firstElementChild); // keep it calm: at most 3 at once
    const n = document.createElement("div");
    n.className = "pp-note " + type;
    n.dataset.key = key;
    n.setAttribute("role", type === "error" ? "alert" : "status");
    const t = document.createElement("div"); t.className = "pp-note-text";
    const b = document.createElement("b"); b.textContent = opts.title || TITLE[type] || "";
    const s = document.createElement("span"); s.textContent = message;
    t.append(b, s);
    const i = document.createElement("span"); i.className = "pp-note-icon"; i.setAttribute("aria-hidden", "true"); i.textContent = ICON[type] || "i";
    const x = document.createElement("button"); x.type = "button"; x.className = "pp-note-x"; x.setAttribute("aria-label", "Close"); x.textContent = "×";
    x.addEventListener("click", () => close(n));
    n.append(i, t);
    if (opts.action) {
      const a = document.createElement("button"); a.type = "button"; a.className = "pp-note-act"; a.textContent = opts.action.label;
      a.addEventListener("click", () => { close(n); opts.action.onClick && opts.action.onClick(); });
      n.append(a);
    }
    n.append(x);
    r.appendChild(n);
    requestAnimationFrame(() => n.classList.add("in"));
    if (opts.timeout !== 0) n._t = setTimeout(() => close(n), opts.timeout ?? (type === "error" ? 8000 : 5000));
    return n;
  };
  window.ppCloseNotes = () => box && [...box.children].forEach(close);

  // Friendly text for anything the API or the network throws at us.
  window.ppErrorText = function (status, data) {
    if (data && data.error) return data.error;
    if (status === 0) return "No connection. Check your internet and try again.";
    if (status === 404) return "We couldn't find that. Check the link and try again.";
    if (status === 409) return "That's already been done, or it isn't possible right now.";
    if (status === 429) return "Too many tries. Wait a minute and try again.";
    if (status >= 500) return "Something went wrong on our side. Try again in a minute.";
    return "That didn't work. Try again.";
  };

  // Mark a form field as wrong, and clear it as soon as the guest fixes it.
  window.ppFieldError = function (el, on = true) {
    if (!el) return;
    const wrap = el.closest(".field, label, .check") || el;
    wrap.classList.toggle("has-error", on);
    el.setAttribute("aria-invalid", on ? "true" : "false");
    if (on && !el._ppFix) {
      el._ppFix = true;
      const fix = () => { wrap.classList.remove("has-error"); el.setAttribute("aria-invalid", "false"); };
      el.addEventListener("input", fix); el.addEventListener("change", fix);
    }
  };

  let offlineNote = null;
  addEventListener("offline", () => { offlineNote = ppNotify("You're offline. We'll keep trying when you're back.", "warn", { title: "No connection", timeout: 0 }); });
  addEventListener("online", () => { if (offlineNote) close(offlineNote); offlineNote = null; ppNotify("You're back online.", "ok", { title: "Connected", timeout: 3000 }); });
})();
