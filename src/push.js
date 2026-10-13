// Web Push for PerugiaParty: guests who install the site as an app get a notification when their status changes,
// when their payment deadline gets close, and for each item of the programme on the night.
// Messages are encrypted per RFC 8291 (aes128gcm) and signed with VAPID (RFC 8292), using only WebCrypto.

const enc = new TextEncoder();
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s) => { s = String(s).replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; return Uint8Array.from(atob(s), (c) => c.charCodeAt(0)); };
const concat = (...parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };

async function hkdf(salt, ikm, info, length) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, length * 8));
}

async function vapidHeader(ev, endpoint) {
  const jwk = JSON.parse(ev.vapid_private);
  const key = await crypto.subtle.importKey("jwk", { ...jwk, ext: true }, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const head = b64u(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const body = b64u(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: "https://perugiaparty.com" })));
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(`${head}.${body}`));
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${ev.vapid_public}`;
}

export async function encryptPayload(sub, text) {
  const uaPublic = unb64u(sub.p256dh), authSecret = unb64u(sub.auth);
  const local = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", local.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, local.privateKey, 256));
  const ikm = await hkdf(authSecret, shared, concat(enc.encode("WebPush: info\0"), uaPublic, asPublic), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  const aes = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aes, concat(enc.encode(text), new Uint8Array([2]))));
  const rs = new Uint8Array([0, 0, 16, 0]); // record size 4096
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, cipher);
}

// Returns "ok", "gone" (subscription expired: delete it) or "fail".
export async function sendPush(env, ev, sub, message) {
  try {
    const body = await encryptPayload(sub, JSON.stringify(message));
    const r = await fetch(sub.endpoint, {
      method: "POST",
      headers: { authorization: await vapidHeader(ev, sub.endpoint), "content-encoding": "aes128gcm", "content-type": "application/octet-stream", ttl: "86400", urgency: "high" },
      body,
    });
    if (r.status === 404 || r.status === 410) return "gone";
    return r.ok ? "ok" : "fail";
  } catch (e) { return "fail"; }
}

async function pushToGuest(env, ev, token, message) {
  const subs = (await env.DB.prepare("SELECT * FROM push_subs WHERE token = ?").bind(token).all()).results || [];
  let sent = 0;
  for (const s of subs) {
    const r = await sendPush(env, ev, s, message);
    if (r === "gone") await env.DB.prepare("DELETE FROM push_subs WHERE endpoint = ?").bind(s.endpoint).run();
    if (r === "ok") { sent++; await env.DB.prepare("UPDATE push_subs SET last_ok = ? WHERE endpoint = ?").bind(Date.now(), s.endpoint).run(); }
  }
  return sent;
}

const page = (token) => `/ticket.html?t=${token}`;
function statusMessage(g, ev) {
  const first = String(g.name || "").split(" ")[0];
  const party = g.event === ev.tag ? ev.name : g.event;
  switch (g.status) {
    case "approved": return { title: `You're in, ${first}! 🎉`, body: `Pay to confirm your place for ${party}. Your price and code are ready.` };
    case "paid": return { title: "Payment confirmed ✓", body: `Your ticket and the location for ${party} are unlocked.` };
    case "waitlist": return { title: "You're on the waitlist", body: `${party} is full right now. We'll tell you when a place opens.` };
    case "declined": return { title: "About your request", body: `We couldn't give you a place for ${party} this time.` };
    case "released": return { title: "Your place was released", body: "The payment deadline passed. DM us if you already paid." };
    case "removed": return { title: "About your place", body: `Your place for ${party} was cancelled. DM us with questions.` };
    default: return null;
  }
}

// Runs every minute from the cron trigger.
export async function pushTick(env, getEvent, parseProgram) {
  const ev = await getEvent(env);
  if (!ev || !ev.vapid_private || !ev.vapid_public) return;
  const now = Date.now();

  // 1. status changes made in the admin panel
  const changed = (await env.DB.prepare(
    "SELECT g.* FROM guests g WHERE EXISTS (SELECT 1 FROM push_subs s WHERE s.token = g.token) AND (g.notified IS NULL OR g.notified <> g.status) LIMIT 50"
  ).all()).results || [];
  for (const g of changed) {
    const msg = g.notified ? statusMessage(g, ev) : null; // first sight: just remember the status
    if (msg) await pushToGuest(env, ev, g.token, { ...msg, url: page(g.token), tag: "status" });
    await env.DB.prepare("UPDATE guests SET notified = ? WHERE token = ?").bind(g.status, g.token).run();
  }

  // 2. payment deadline in less than 6 hours
  const due = (await env.DB.prepare(
    "SELECT g.* FROM guests g WHERE g.status = 'approved' AND COALESCE(g.reminded, 0) = 0 AND g.deadline BETWEEN ? AND ? AND EXISTS (SELECT 1 FROM push_subs s WHERE s.token = g.token) LIMIT 50"
  ).bind(now, now + 6 * 36e5).all()).results || [];
  for (const g of due) {
    const h = Math.max(1, Math.round((g.deadline - now) / 36e5));
    await pushToGuest(env, ev, g.token, { title: "Reminder: pay for your place", body: `About ${h} hour${h > 1 ? "s" : ""} left. After that your place goes back to the list.`, url: page(g.token), tag: "deadline" });
    await env.DB.prepare("UPDATE guests SET reminded = 1 WHERE token = ?").bind(g.token).run();
  }

  // 3. the programme, live on the night (guests with a paid ticket or inside)
  const start = Date.parse(ev.starts_at || "");
  const items = parseProgram(ev.program);
  if (!Number.isFinite(start) || !items.length || now < start - 2 * 36e5 || now > start + 14 * 36e5) return;
  const romeMin = (t) => { const p = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Rome", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(t)); return Number(p.find((x) => x.type === "hour").value) * 60 + Number(p.find((x) => x.type === "minute").value); };
  const sm = romeMin(start);
  const done = new Set(String(ev.prog_pushed || "").split("|").filter(Boolean));
  for (const it of items) {
    const m = /^(\d\d):(\d\d)$/.exec(it.time || ""); if (!m) continue;
    let delta = Number(m[1]) * 60 + Number(m[2]) - sm; if (delta < -360) delta += 1440;
    const at = start + delta * 6e4, key = `${ev.tag}@${it.time}`;
    if (done.has(key) || now < at || now > at + 10 * 6e4) continue; // send within 10 minutes of the time, once
    done.add(key);
    await env.DB.prepare("UPDATE event SET prog_pushed = ? WHERE id = 1").bind([...done].slice(-40).join("|")).run();
    const guests = (await env.DB.prepare("SELECT DISTINCT g.token FROM guests g JOIN push_subs s ON s.token = g.token WHERE g.event = ? AND g.status IN ('paid','in')").bind(ev.tag).all()).results || [];
    for (const g of guests) await pushToGuest(env, ev, g.token, { title: `Now: ${it.title}`, body: `${ev.name} · ${it.time}`, url: page(g.token), tag: "programme" });
  }
}

// API: the page asks for the public key, then saves its subscription for this guest's ticket.
export async function apiPush(req, env, url, getEvent, TOKEN_RE, json) {
  const ev = await getEvent(env);
  if (url.pathname === "/api/push/key") return json({ key: ev && ev.vapid_public ? ev.vapid_public : null });
  let body; try { body = await req.json(); } catch { return json({ error: "Bad request" }, 400); }
  const t = String(body.t || "");
  if (!TOKEN_RE.test(t)) return json({ error: "This link isn't valid." }, 404);
  const g = await env.DB.prepare("SELECT token, status FROM guests WHERE token = ?").bind(t).first();
  if (!g) return json({ error: "We couldn't find your ticket." }, 404);
  const s = body.sub || {}, keys = s.keys || {};
  const endpoint = String(s.endpoint || "");
  if (url.pathname === "/api/push/unsubscribe") { await env.DB.prepare("DELETE FROM push_subs WHERE endpoint = ? AND token = ?").bind(endpoint, t).run(); return json({ ok: true }); }
  if (!/^https:\/\/[^\s]{10,500}$/.test(endpoint) || !keys.p256dh || !keys.auth || String(keys.p256dh).length > 200 || String(keys.auth).length > 60) return json({ error: "Notifications couldn't be turned on." }, 400);
  await env.DB.prepare("INSERT INTO push_subs (endpoint, token, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET token = excluded.token, p256dh = excluded.p256dh, auth = excluded.auth")
    .bind(endpoint, t, String(keys.p256dh), String(keys.auth), Date.now()).run();
  await env.DB.prepare("UPDATE guests SET notified = status WHERE token = ? AND notified IS NULL").bind(t).run();
  if (body.test) await sendPush(env, ev, { endpoint, p256dh: String(keys.p256dh), auth: String(keys.auth) }, { title: "Notifications are on 🔔", body: "We'll tell you here when anything changes.", url: `/ticket.html?t=${t}`, tag: "hello" });
  return json({ ok: true });
}
