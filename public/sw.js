// PerugiaParty app: works offline at the door and shows notifications.
const CACHE = "pp-v3";
const SHELL = ["/ticket.html", "/site.css", "/notify.js", "/vendor/qrcode.js", "/logo.png", "/icon-192.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// Network first, so guests always see their latest status; fall back to the last copy when there's no signal.
self.addEventListener("fetch", (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;
  const isTicketApi = url.pathname === "/api/ticket";
  if (url.pathname.startsWith("/api/") && !isTicketApi) return;
  e.respondWith((async () => {
    try {
      const res = await fetch(req, { cache: "no-cache" });
      if (res.ok && (isTicketApi || req.mode === "navigate" || SHELL.includes(url.pathname))) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(isTicketApi ? req : (req.mode === "navigate" && url.pathname.startsWith("/ticket") ? "/ticket.html" : req), copy));
      }
      return res;
    } catch (err) {
      const hit = await caches.match(req, { ignoreSearch: !isTicketApi }) || (req.mode === "navigate" && url.pathname.startsWith("/ticket") ? await caches.match("/ticket.html") : null);
      if (hit) return hit;
      throw err;
    }
  })());
});

self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) { d = { title: "PerugiaParty", body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(d.title || "PerugiaParty", {
    body: d.body || "", icon: "/icon-192.png", badge: "/icon-192.png", tag: d.tag || "pp", renotify: true,
    data: { url: d.url || "/ticket" },
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const target = new URL(e.notification.data && e.notification.data.url || "/ticket", location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    for (const c of list) if (c.url.startsWith(location.origin) && "focus" in c) { c.navigate(target); return c.focus(); }
    return self.clients.openWindow(target);
  }));
});
