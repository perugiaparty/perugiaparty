import { pushTick, apiPush } from "./push.js";
// PerugiaParty site worker: serves the static site and a small JSON API.
// Guests only ever see their own record, looked up by a long random token.
// All organizer actions happen in the private admin panel, never through this API.

const PANEL_URL = "https://claude.ai/artifact/9c9SN73G39oNZDCugxh9fx";
const TOKEN_RE = /^[a-z0-9]{24}$/;

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

function newToken() {
  const alph = "abcdefghijkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (b) => alph[b % alph.length]).join("");
}

const clean = (v, max) => String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);

function priceRange(ev) {
  const p = [ev.price_early, ev.price_normal, ev.price_late].map(Number).filter((n) => Number.isFinite(n) && n > 0);
  if (!p.length) return null;
  return { min: Math.min(...p), max: Math.max(...p) };
}

// ---- rate limits: stop bots and code-guessing (counts per IP, stored as a hash, never the IP itself) ----
const LIMITS = { short: [30, 600], request: [6, 600], rerequest: [6, 600], login: [8, 600], invite: [40, 600], door: [20, 600] };
async function tooMany(req, env, name) {
  const [max, win] = LIMITS[name] || [30, 600];
  const ip = req.headers.get("CF-Connecting-IP") || "local";
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("pp-rl|" + ip));
  const k = name + ":" + Array.from(new Uint8Array(buf).slice(0, 10), (b) => b.toString(16).padStart(2, "0")).join("");
  const now = Date.now();
  try {
    const r = await env.DB.prepare(
      "INSERT INTO hits (k, n, reset) VALUES (?, 1, ?) ON CONFLICT(k) DO UPDATE SET n = CASE WHEN hits.reset < ? THEN 1 ELSE hits.n + 1 END, reset = CASE WHEN hits.reset < ? THEN ? ELSE hits.reset END RETURNING n"
    ).bind(k, now + win * 1000, now, now, now + win * 1000).first();
    return r && r.n > max;
  } catch (e) { return false; } // never lock real guests out because of the counter
}
const slowDown = () => json({ error: "Too many tries. Wait a few minutes and try again." }, 429);

async function getEvent(env) {
  return env.DB.prepare("SELECT * FROM event WHERE id = 1").first();
}

async function heldPlaces(env, tag) {
  const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM guests WHERE event = ? AND status IN ('approved','paid','in')").bind(tag).first();
  return r?.n || 0;
}
async function soldOut(env, ev) {
  const cap = Number(ev.capacity);
  if (!cap || cap <= 0) return false;
  return (await heldPlaces(env, ev.tag)) >= cap;
}

// ---- people: one record per Instagram handle, shared across editions ----
const normIg = (ig) => { const h = String(ig || "").trim().replace(/^@+/, "").toLowerCase(); return h ? "@" + h : ""; };
function returnersOnly(ev) {
  const t = ev && ev.returners_until ? Date.parse(ev.returners_until) : NaN;
  return Number.isFinite(t) && Date.now() < t;
}
// Came before = ticked by Matt in the admin panel, or checked in at an earlier edition.
async function isReturner(env, ig, currentTag) {
  if (!ig) return false;
  const p = await env.DB.prepare("SELECT came_before FROM people WHERE ig = ?").bind(ig).first();
  if (p && p.came_before) return true;
  const r = await env.DB.prepare("SELECT 1 FROM guests WHERE lower(ig) = ? AND status = 'in' AND event <> ? LIMIT 1").bind(ig, currentTag || "").first();
  return !!r;
}
async function upsertPerson(env, ig, name, phone) {
  if (!ig) return;
  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO people (ig, name, phone, created_at, updated_at) VALUES (?, ?, ?, ?, ?) " +
    "ON CONFLICT(ig) DO UPDATE SET name = excluded.name, phone = COALESCE(NULLIF(excluded.phone, ''), people.phone), updated_at = excluded.updated_at"
  ).bind(ig, name, phone || "", now, now).run();
}
// Personal verify + login code, like "H26-K7M4QX". Guests DM it to @perugiaparty to prove the Instagram is theirs.
const VC_ALPH = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
function newVcode(tag) {
  const b = crypto.getRandomValues(new Uint8Array(6));
  return `${tag || "PP"}-${Array.from(b, (x) => VC_ALPH[x % VC_ALPH.length]).join("")}`;
}
async function isBlocked(env, ig) {
  if (!ig) return false;
  const p = await env.DB.prepare("SELECT blocked FROM people WHERE ig = ?").bind(ig).first();
  return !!(p && Number(p.blocked));
}
const BLOCKED_MSG = "We can't accept a request from this Instagram. DM @perugiaparty if you think this is a mistake.";
async function personVerified(env, ig) {
  if (!ig) return false;
  const p = await env.DB.prepare("SELECT verified FROM people WHERE ig = ?").bind(ig).first();
  return !!(p && Number(p.verified));
}
// Someone proved the account: other unconfirmed requests with that Instagram for this party were made by someone else.
async function dropUnconfirmed(env, tag, ig, keepToken) {
  await env.DB.prepare("UPDATE guests SET removed_from = status, status = 'removed', removed_reason = 'Used this Instagram without confirming it. The real owner confirmed by DM.', removed_at = ? WHERE event = ? AND lower(ig) = ? AND verified = 0 AND token <> ? AND status IN ('requested','waitlist','approved')")
    .bind(Date.now(), tag, ig, keepToken || "").run();
}
async function markVerified(env, g, igsid) {
  const ig = normIg(g.ig), now = Date.now();
  if (ig) await dropUnconfirmed(env, g.event, ig, g.token);
  await env.DB.prepare("UPDATE guests SET verified = 1, verified_at = ?, ig_mismatch = NULL WHERE token = ?").bind(now, g.token).run();
  if (ig) await env.DB.prepare("UPDATE people SET verified = 1, igsid = COALESCE(?, igsid), updated_at = ? WHERE ig = ?").bind(igsid || null, now, ig).run();
}
// Short personal links: perugiaparty.com/t/k7m4qxp2ab (10 characters, rate-limited against guessing)
const SHORT_RE = /^[a-z2-9]{10}$/;
async function shortFor(env, g) {
  if (g.short) return g.short;
  for (let i = 0; i < 5; i++) {
    const c = newToken().slice(0, 10);
    try { const r = await env.DB.prepare("UPDATE guests SET short = ? WHERE token = ? AND short IS NULL").bind(c, g.token).run(); if (r.meta && r.meta.changes) { g.short = c; return c; } } catch (e) { continue; }
    const again = await env.DB.prepare("SELECT short FROM guests WHERE token = ?").bind(g.token).first();
    if (again && again.short) { g.short = again.short; return again.short; }
  }
  return null;
}
const shortUrl = (code, token) => code ? `https://perugiaparty.com/t/${code}` : `https://perugiaparty.com/ticket.html?t=${token}`;
async function shortRedirect(url, env) {
  const c = url.pathname.slice(3).toLowerCase().replace(/\/$/, "");
  if (!SHORT_RE.test(c)) return null;
  const g = await env.DB.prepare("SELECT token FROM guests WHERE short = ?").bind(c).first();
  if (!g) return null;
  return new Response(null, { status: 302, headers: { location: `/ticket.html?t=${g.token}`, "cache-control": "no-store" } });
}
function inviteLimit(ev) { const n = Number(ev.invites_per_guest ?? 1); return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 1; }
async function invitesUsed(env, ev, ig) {
  const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM guests WHERE event = ? AND invited_by = ? AND status NOT IN ('declined','removed')").bind(ev.tag, ig).first();
  return r?.n || 0;
}
async function inviteFor(env, ev, ig) {
  const limit = inviteLimit(ev);
  if (!limit) return null;
  let p = await env.DB.prepare("SELECT invite_code FROM people WHERE ig = ?").bind(ig).first();
  if (!p) return null;
  let code = p.invite_code;
  for (let i = 0; !code && i < 5; i++) {
    const c = newToken().slice(0, 8);
    try { await env.DB.prepare("UPDATE people SET invite_code = ? WHERE ig = ? AND invite_code IS NULL").bind(c, ig).run(); } catch (e) { continue; }
    code = (await env.DB.prepare("SELECT invite_code FROM people WHERE ig = ?").bind(ig).first())?.invite_code;
  }
  if (!code) return null;
  const used = await invitesUsed(env, ev, ig);
  return { url: `https://perugiaparty.com/?invite=${code}`, limit, left: Math.max(0, limit - used) };
}
async function resolveInvite(env, ev, code) {
  if (!code || !/^[a-z0-9]{8}$/.test(code)) return null;
  const p = await env.DB.prepare("SELECT ig, name FROM people WHERE invite_code = ?").bind(code).first();
  if (!p || (await isBlocked(env, p.ig)) || !(await isReturner(env, p.ig, ev.tag)) || !(await personVerified(env, p.ig))) return null;
  const left = inviteLimit(ev) - (await invitesUsed(env, ev, p.ig));
  return { ig: p.ig, first: String(p.name || "").split(" ")[0], left };
}
function parseProgram(text) {
  return String(text || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
    const m = l.match(/^(\d{1,2})[:.](\d{2})\s*[-–·:]?\s*(.+)$/);
    return m ? { time: `${m[1].padStart(2, "0")}:${m[2]}`, title: m[3].slice(0, 80) } : { time: "", title: l.slice(0, 80) };
  }).slice(0, 20);
}

// Log in on any phone with Instagram + personal code.
async function apiLogin(req, env) {
  let body; try { body = await req.json(); } catch { return json({ error: "Bad request" }, 400); }
  const ig = normIg(clean(body.ig, 40));
  const code = String(body.code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!ig || code.length < 7) { await sleep(500); return json({ error: "Add your Instagram and your code." }, 400); }
  const g = await env.DB.prepare("SELECT token FROM guests WHERE lower(ig) = ? AND replace(vcode, '-', '') = ? ORDER BY created_at DESC LIMIT 1").bind(ig, code).first();
  if (!g) { await sleep(800); return json({ error: "That Instagram and code don't match. Check the code in your DMs from @perugiaparty." }, 404); }
  return json({ ok: true, token: g.token });
}

// ---- Instagram: guests DM their code, we confirm the account is theirs and reply automatically ----
const igApi = (env) => env.IG_API || "https://graph.instagram.com/v23.0"; // overridable for local tests
async function hmacHex(secret, text) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}
function sameText(a, b) { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; }
// Small diagnostics log for the Instagram connection (kept to the last 200 lines).
async function igLog(env, kind, detail) {
  try {
    await env.DB.prepare("INSERT INTO ig_log (at, kind, detail) VALUES (?, ?, ?)").bind(Date.now(), kind, String(detail || "").slice(0, 500)).run();
    await env.DB.prepare("DELETE FROM ig_log WHERE id < (SELECT MAX(id) - 200 FROM ig_log)").run();
  } catch (e) {}
}
async function igWebhookVerify(url, env) {
  const ev = await getEvent(env);
  const ok = ev && ev.ig_verify_token && url.searchParams.get("hub.mode") === "subscribe" && url.searchParams.get("hub.verify_token") === ev.ig_verify_token;
  await igLog(env, ok ? "verify-ok" : "verify-fail", `mode=${url.searchParams.get("hub.mode")} token_match=${!!ok}`);
  return ok ? new Response(url.searchParams.get("hub.challenge") || "", { status: 200 }) : new Response("Forbidden", { status: 403 });
}
async function igSend(env, ev, recipient, text) {
  try {
    const r = await fetch(`${igApi(env)}/me/messages`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${ev.ig_token}` }, body: JSON.stringify({ recipient: { id: recipient }, message: { text } }) });
    await igLog(env, r.ok ? "reply-ok" : "reply-fail", r.ok ? "" : (await r.text()).slice(0, 300));
  } catch (e) { await igLog(env, "reply-error", String(e)); }
}
async function igUsername(env, ev, igsid) {
  try {
    const r = await fetch(`${igApi(env)}/${encodeURIComponent(igsid)}?fields=username&access_token=${encodeURIComponent(ev.ig_token)}`);
    const d = await r.json();
    if (!d || !d.username) await igLog(env, "username-fail", JSON.stringify(d).slice(0, 300));
    return d && d.username ? String(d.username) : null;
  } catch (e) { return null; }
}
async function igHandleDm(env, ev, igsid, text) {
  const found = [...String(text).toUpperCase().matchAll(/(?<![A-Z0-9])([A-Z0-9]{1,5})[-\s]?([A-HJ-NP-Z2-9]{6})(?![A-Z0-9])/g)];
  let g = null;
  for (const m of found) {
    g = await env.DB.prepare("SELECT * FROM guests WHERE vcode = ?").bind(`${m[1]}-${m[2]}`).first();
    if (g) break;
  }
  if (!g) { // not a code: Matt answers this DM himself
    await env.DB.prepare("UPDATE people SET last_dm_at = ? WHERE igsid = ?").bind(Date.now(), igsid).run();
    await igLog(env, "no-code", String(text).slice(0, 80)); return;
  }
  const username = await igUsername(env, ev, igsid);
  await igLog(env, "dm", `code=${g.vcode} sender=${igsid} username=${username}`);
  if (username) await env.DB.prepare("UPDATE people SET igsid = ?, last_dm_at = ? WHERE ig = ?").bind(igsid, Date.now(), normIg(username)).run();
  if (!username) return;
  const first = String(g.name || "").split(" ")[0];
  if (normIg(username) === normIg(g.ig)) {
    const already = Number(g.verified) === 1;
    await markVerified(env, g, igsid);
    await igSend(env, ev, igsid, [
      `✓ Confirmed, ${first}! Your request is verified.`,
      ``,
      `Link: ${shortUrl(await shortFor(env, g), g.token)}`,
    ].join("\n"));
  } else {
    await env.DB.prepare("UPDATE guests SET ig_mismatch = ? WHERE token = ?").bind(normIg(username), g.token).run();
    await igSend(env, ev, igsid, "This code belongs to another Instagram account. Request with your own at perugiaparty.com and send us that code.");
  }
}
async function igWebhook(req, env) {
  const raw = await req.text();
  const ev = await getEvent(env);
  await igLog(env, "post", raw.slice(0, 400));
  if (!ev || !ev.ig_app_secret || !ev.ig_token) { await igLog(env, "not-set-up", ""); return new Response("Not set up", { status: 503 }); }
  const sig = req.headers.get("x-hub-signature-256") || "";
  if (!sameText(sig, "sha256=" + (await hmacHex(ev.ig_app_secret, raw)))) { await igLog(env, "bad-signature", sig.slice(0, 20)); return new Response("Bad signature", { status: 401 }); }
  let body; try { body = JSON.parse(raw); } catch { return new Response("ok"); }
  for (const entry of body.entry || []) {
    // Meta sends messages either as entry.messaging[] or as entry.changes[{ field: "messages", value }]
    const items = [...(entry.messaging || []), ...(entry.changes || []).filter((c) => c.field === "messages" && c.value).map((c) => c.value)];
    for (const m of items) {
      if (!m.message || m.message.is_echo || !m.message.text || !m.sender) continue;
      try { await igHandleDm(env, ev, String(m.sender.id), m.message.text); } catch (e) { await igLog(env, "handle-error", String(e)); }
    }
  }
  return new Response("ok");
}
// Turn on message webhooks for the @perugiaparty account itself (needed once, retried every 10 minutes until it works).
async function igEnsureSubscribed(env, force) {
  const ev = await getEvent(env);
  if (!ev || !ev.ig_token || ev.ig_subscribed_at) return;
  if (!force && new Date().getMinutes() % 2 !== 0) return; // every 2 minutes until it works
  try {
    const r = await fetch(`${igApi(env)}/me/subscribed_apps?subscribed_fields=messages&access_token=${encodeURIComponent(ev.ig_token)}`, { method: "POST" });
    const t = await r.text();
    await igLog(env, r.ok ? "subscribe-ok" : "subscribe-fail", t.slice(0, 300));
    if (r.ok && /"success"\s*:\s*true/.test(t)) await env.DB.prepare("UPDATE event SET ig_subscribed_at = ? WHERE id = 1").bind(Date.now()).run();
  } catch (e) { await igLog(env, "subscribe-error", String(e)); }
}

// Instagram tokens last 60 days: refresh every few weeks.
async function refreshIgToken(env) {
  const ev = await getEvent(env);
  if (!ev || !ev.ig_token) return;
  if (ev.ig_token_at && Date.now() - Number(ev.ig_token_at) < 20 * 864e5) return;
  try {
    const r = await fetch(`https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(ev.ig_token)}`);
    const d = await r.json();
    if (d && d.access_token) await env.DB.prepare("UPDATE event SET ig_token = ?, ig_token_at = ? WHERE id = 1").bind(d.access_token, Date.now()).run();
  } catch (e) {}
}

async function apiInvite(url, env) {
  const ev = await getEvent(env);
  if (!ev || !ev.published || !ev.tag) return json({ ok: false });
  const inv = await resolveInvite(env, ev, url.searchParams.get("c") || "");
  if (!inv) return json({ ok: false, error: "This invite link isn't valid anymore." });
  if (inv.left <= 0) return json({ ok: false, error: `${inv.first}'s invite has already been used.` });
  return json({ ok: true, from: inv.first, ig: inv.ig });
}

async function apiEvent(env) {
  const ev = await getEvent(env);
  if (!ev || !ev.published) return json({ published: false });
  return json({
    returners_only: returnersOnly(ev),
    returners_until: ev.returners_until || null,
    published: true,
    name: ev.name,
    starts_at: ev.starts_at,
    date_label: ev.date_label,
    doors: ev.doors,
    price: priceRange(ev),
    requests_open: !!ev.requests_open,
    sold_out: await soldOut(env, ev),
    poster: ev.poster ? (String(ev.poster).startsWith("data:") ? `/api/poster?v=${ev.updated_at || 0}` : ev.poster) : null,
    turnstile: ev.turnstile_site_key || null,
  });
}

async function verifyTurnstile(ev, token, req) {
  if (!ev.turnstile_site_key || !ev.turnstile_secret) return true; // spam check not set up yet
  if (!token) return false;
  const form = new FormData();
  form.append("secret", ev.turnstile_secret);
  form.append("response", token);
  const ip = req.headers.get("CF-Connecting-IP"); if (ip) form.append("remoteip", ip);
  try {
    const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
    const d = await r.json();
    return !!d.success;
  } catch { return true; } // never lock real guests out if the check service is down
}

async function apiRequest(req, env) {
  let body;
  try { body = await req.json(); } catch { return json({ error: "Send the form again." }, 400); }
  if (body.website) return json({ ok: true, token: newToken() }); // honeypot: pretend success
  const ev = await getEvent(env);
  if (!ev || !ev.published || !ev.requests_open || !ev.tag) {
    return json({ error: "Requests aren't open right now. Follow @perugiaparty on Instagram for the next date." }, 409);
  }
  if (!(await verifyTurnstile(ev, body.turnstile, req))) return json({ error: "Please complete the human check above the button and try again." }, 400);
  const name = clean(body.name, 80);
  let ig = clean(body.ig, 40).replace(/^@+/, "");
  const phone = clean(body.phone, 30);
  const note = clean(body.intro, 500);
  if (name.length < 2) return json({ error: "Add your full name." }, 400);
  if (!/^[A-Za-z0-9._]{1,30}$/.test(ig)) return json({ error: "Add your Instagram handle, like @yourname." }, 400);
  if (body.age !== true || body.rules !== true) return json({ error: "Confirm you're 18+ and accept the house rules." }, 400);
  ig = "@" + ig.toLowerCase();
  if (await isBlocked(env, ig)) { await sleep(400); return json({ error: BLOCKED_MSG }, 403); }
  // an unconfirmed request doesn't lock the handle: whoever proves the account by DM keeps it
  const dup = await env.DB.prepare("SELECT 1 FROM guests WHERE event = ? AND lower(ig) = ? AND verified = 1 AND status IN ('requested','waitlist','approved','paid','in')")
    .bind(ev.tag, ig).first();
  if (dup) return json({ error: "This Instagram already has a confirmed request for this party. Log in with your code at perugiaparty.com/ticket, or DM us." }, 409);
  const returning = await isReturner(env, ig, ev.tag);
  let inviter = null;
  if (body.invite) {
    const inv = await resolveInvite(env, ev, String(body.invite));
    if (inv && inv.left > 0 && inv.ig !== ig) inviter = inv.ig;
    else if (returnersOnly(ev) && !returning) return json({ error: "This invite link has already been used or isn't valid anymore." }, 409);
  }
  if (returnersOnly(ev) && !returning && !inviter) {
    return json({ error: "Right now only guests who came before, and the friends they invite, can request a place. Requests open for everyone soon." }, 409);
  }
  const status = (await soldOut(env, ev)) ? "waitlist" : "requested";
  const token = newToken(), vcode = newVcode(ev.tag);
  await env.DB.prepare("INSERT INTO guests (token, event, name, ig, phone, note, status, created_at, invited_by, is_returning, vcode, verified) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)")
    .bind(token, ev.tag, name, ig, phone, note, status, Date.now(), inviter, returning ? 1 : 0, vcode).run();
  await upsertPerson(env, ig, name, phone);
  return json({ ok: true, token, vcode, ig, waitlist: status === "waitlist" });
}

// One tap from an old ticket page: request a place for the current edition with the same details.
async function apiRerequest(req, env) {
  let body; try { body = await req.json(); } catch { return json({ error: "Bad request" }, 400); }
  const t = String(body.t || "");
  if (!TOKEN_RE.test(t)) return json({ error: "This link isn't valid." }, 404);
  const g = await env.DB.prepare("SELECT * FROM guests WHERE token = ?").bind(t).first();
  if (!g) return json({ error: "We couldn't find your details." }, 404);
  const ev = await getEvent(env);
  if (!ev || !ev.published || !ev.requests_open || !ev.tag) return json({ error: "Requests aren't open right now." }, 409);
  if (g.event === ev.tag) return json({ ok: true, token: g.token });
  const ig = normIg(g.ig);
  if (!ig) return json({ error: "Request with the form on the homepage." }, 409);
  if (await isBlocked(env, ig)) return json({ error: BLOCKED_MSG }, 403);
  const proven = g.status === "in" || Number(g.verified) === 1;
  const existing = await env.DB.prepare("SELECT token, verified FROM guests WHERE event = ? AND lower(ig) = ? AND status IN ('requested','waitlist','approved','paid','in') ORDER BY verified DESC LIMIT 1").bind(ev.tag, ig).first();
  if (existing && Number(existing.verified) === 1) return json({ ok: true, token: existing.token });
  if (existing && !proven) return json({ ok: true, token: existing.token });
  const returning = await isReturner(env, ig, ev.tag);
  if (returnersOnly(ev) && !returning) return json({ error: "Early access is for guests who came before. Requests open for everyone soon." }, 409);
  const status = (await soldOut(env, ev)) ? "waitlist" : "requested";
  const token = newToken();
  // the old personal link proves it's them when that ticket was used at the door or confirmed by DM
  if (proven) await dropUnconfirmed(env, ev.tag, ig, null);
  await env.DB.prepare("INSERT INTO guests (token, event, name, ig, phone, note, status, created_at, is_returning, vcode, verified, verified_at) VALUES (?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?)")
    .bind(token, ev.tag, g.name, ig, g.phone || "", status, Date.now(), returning ? 1 : 0, newVcode(ev.tag), proven ? 1 : 0, proven ? Date.now() : null).run();
  if (proven) await env.DB.prepare("UPDATE people SET verified = 1 WHERE ig = ?").bind(ig).run();
  await upsertPerson(env, ig, g.name, g.phone);
  return json({ ok: true, token, waitlist: status === "waitlist" });
}

async function apiTicket(url, env) {
  const t = url.searchParams.get("t") || "";
  if (!TOKEN_RE.test(t)) return json({ error: "This link isn't valid." }, 404);
  const g = await env.DB.prepare("SELECT * FROM guests WHERE token = ?").bind(t).first();
  if (!g) return json({ error: "We couldn't find this request." }, 404);
  const ev = (await getEvent(env)) || {};
  const sameEvent = ev.tag === g.event;
  if (!g.vcode) { g.vcode = newVcode(g.event); await env.DB.prepare("UPDATE guests SET vcode = ? WHERE token = ? AND vcode IS NULL").bind(g.vcode, g.token).run(); }
  const out = { status: g.status, name: g.name, event: sameEvent ? ev.name : g.event, ig: g.ig, vcode: g.vcode, link: shortUrl(await shortFor(env, g), g.token), verified: Number(g.verified) === 1, mismatch: !!g.ig_mismatch, ig_auto: !!(ev.ig_token && ev.ig_app_secret) };
  if (g.status === "approved") {
    Object.assign(out, {
      code: g.code, price: g.price, ticket: g.ticket, deadline: g.deadline,
      iban: sameEvent ? ev.iban : null, beneficiary: sameEvent ? ev.beneficiary : null,
      reference: `${g.name} ${g.code}`,
      approved_at: g.approved_at,
      date_label: sameEvent ? ev.date_label : null,
      tiers: sameEvent ? { early: ev.price_early, normal: ev.price_normal, late: ev.price_late, early_until: ev.early_until, normal_until: ev.normal_until } : null,
    });
  }
  if (g.status === "paid" || g.status === "in") {
    Object.assign(out, {
      code: g.code, price: g.price,
      location: sameEvent ? ev.location : null,
      date_label: sameEvent ? ev.date_label : null,
      doors: sameEvent ? ev.doors : null,
      starts_at: sameEvent ? ev.starts_at : null,
      qr: `${PANEL_URL}#${g.code}`,
      in_at: g.in_at,
      program: sameEvent ? parseProgram(ev.program) : [],
    });
  }
  // returning guests: early access, one-tap request for the next edition, and an invite for a friend
  const ig = normIg(g.ig);
  const returner = await isReturner(env, ig, ev.tag);
  const trusted = out.verified; // only this request's own proof counts, never someone else's earlier confirmation
  out.returner = returner;
  out.priority = returner && trusted;
  if (ev.published && ev.tag && !sameEvent) {
    const mine = ig ? await env.DB.prepare("SELECT token FROM guests WHERE event = ? AND lower(ig) = ? AND verified = 1 AND status IN ('requested','waitlist','approved','paid','in')").bind(ev.tag, ig).first() : null;
    out.next = {
      event: ev.name, date_label: ev.date_label,
      open: !!ev.requests_open && (!returnersOnly(ev) || returner),
      early: returnersOnly(ev) && returner,
      token: mine ? mine.token : null,
    };
  }
  // invite link only for confirmed returning guests whose place for this party is approved
  if (returner && trusted && sameEvent && ["approved", "paid", "in"].includes(g.status) && ev.published && ig) out.invite = await inviteFor(env, ev, ig);
  return json(out);
}

// ---- door scanner (perugiaparty.com/door), protected by the door password set in the admin panel ----
async function sha256hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function doorAuth(body, env) {
  const ev = await getEvent(env);
  if (!ev || !ev.door_hash) return { error: json({ error: "No door password is set. Set one in the admin panel under Event & website." }, 403) };
  const pw = String(body.password || "");
  if (!pw || (await sha256hex(pw)) !== ev.door_hash) { await sleep(800); return { error: json({ error: "Wrong door password." }, 401) }; }
  return { ev };
}
function codeFrom(text) {
  const m = String(text || "").toUpperCase().match(/PP-?[A-Z0-9]{1,5}-?[A-Z0-9]{4}/);
  if (!m) return null;
  const raw = m[0].replace(/-/g, "");
  return raw;
}
async function doorStats(env, tag) {
  const r = await env.DB.prepare("SELECT SUM(status='in') AS inside, SUM(status='paid') AS waiting FROM guests WHERE event = ?").bind(tag).first();
  return { inside: r?.inside || 0, waiting: r?.waiting || 0 };
}
async function findByCode(env, tag, text) {
  const norm = codeFrom(text) || String(text || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!norm || norm.length < 4) return null;
  const rows = await env.DB.prepare("SELECT * FROM guests WHERE code IS NOT NULL AND (replace(code,'-','') = ? OR (event = ? AND substr(replace(code,'-',''), -4) = ?)) ORDER BY event = ? DESC LIMIT 2")
    .bind(norm, tag, norm.slice(-4), tag).all();
  const list = rows.results || [];
  if (list.length === 2 && norm.length <= 4) return { ambiguous: true };
  return list[0] || null;
}
function doorView(g, ev) {
  return { name: g.name, code: g.code, status: g.status, price: g.price, in_at: g.in_at, event: g.event, current: g.event === ev.tag, sign: ev.sign || "" };
}
async function apiDoor(req, env, action) {
  let body; try { body = await req.json(); } catch { return json({ error: "Bad request" }, 400); }
  const { ev, error } = await doorAuth(body, env);
  if (error) return error;
  if (action === "login") return json({ ok: true, event: ev.name, sign: ev.sign || "", stats: await doorStats(env, ev.tag) });
  const g = await findByCode(env, ev.tag, body.code);
  if (!g) return json({ found: false, stats: await doorStats(env, ev.tag) });
  if (g.ambiguous) return json({ found: false, ambiguous: true, stats: await doorStats(env, ev.tag) });
  if (action === "checkin") {
    if (g.event === ev.tag && g.status === "paid") {
      const now = Date.now();
      await env.DB.prepare("UPDATE guests SET status='in', in_at=? WHERE token=? AND status='paid'").bind(now, g.token).run();
      g.status = "in"; g.in_at = now;
      return json({ found: true, fresh: true, guest: doorView(g, ev), stats: await doorStats(env, ev.tag) });
    }
  }
  return json({ found: true, guest: doorView(g, ev), stats: await doorStats(env, ev.tag) });
}

// Search engines: describe the next party as a schema.org Event inside the homepage HTML.
function eventJsonLd(ev) {
  if (!ev || !ev.published || !ev.name || !ev.starts_at) return null;
  const start = new Date(ev.starts_at);
  if (!(start > new Date())) return null;
  const price = priceRange(ev);
  const data = {
    "@context": "https://schema.org",
    "@type": "Event",
    name: `${ev.name} · PerugiaParty`,
    startDate: start.toISOString(),
    eventStatus: "https://schema.org/EventScheduled",
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    description: "Private student party in Perugia. Request your place on the guest list. 18+.",
    image: ["https://perugiaparty.com/og-image.png"],
    location: { "@type": "Place", name: "Perugia", address: { "@type": "PostalAddress", addressLocality: "Perugia", addressRegion: "Umbria", addressCountry: "IT" } },
    organizer: { "@type": "Organization", name: "PerugiaParty", url: "https://perugiaparty.com/" },
    typicalAgeRange: "18-",
  };
  if (price) data.offers = { "@type": "Offer", price: String(price.min), priceCurrency: "EUR", url: "https://perugiaparty.com/#request", availability: ev.requests_open ? "https://schema.org/InStock" : "https://schema.org/PreOrder" };
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
async function homepage(req, env) {
  const res = await env.ASSETS.fetch(req);
  if (!res.ok || !(res.headers.get("content-type") || "").includes("text/html")) return res;
  let ld = null;
  try { ld = eventJsonLd(await getEvent(env)); } catch (e) {}
  if (!ld) return res;
  return new HTMLRewriter().on("head", { element(el) { el.append(`<script type="application/ld+json">${ld}</script>`, { html: true }); } }).transform(res);
}

// Poster uploaded from the admin panel, stored in the database as a data URL.
async function apiPoster(env) {
  const ev = await getEvent(env);
  const m = ev && typeof ev.poster === "string" && ev.poster.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
  if (!m) return new Response("Not found", { status: 404 });
  const bin = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
  return new Response(bin, { headers: { "content-type": m[1], "cache-control": "public, max-age=31536000, immutable" } });
}

// Installable app: the start page is the guest's own ticket when the manifest is requested from it.
function manifest(url) {
  const t = url.searchParams.get("t");
  const start = t && TOKEN_RE.test(t) ? `/ticket.html?t=${t}&app=1` : "/ticket?app=1";
  return new Response(JSON.stringify({
    name: "PerugiaParty", short_name: "PerugiaParty", id: "/ticket",
    description: "Your PerugiaParty ticket, status and the programme on the night.",
    start_url: start, scope: "/", display: "standalone", orientation: "portrait",
    background_color: "#141210", theme_color: "#141210",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  }), { headers: { "content-type": "application/manifest+json", "cache-control": "no-store" } });
}

// When Matt approves or marks someone paid in the admin panel, tell them on Instagram.
async function igStatusDms(env) {
  const ev = await getEvent(env);
  if (!ev || !ev.ig_token) return;
  const rows = (await env.DB.prepare(
    "SELECT g.*, p.igsid, p.last_dm_at FROM guests g JOIN people p ON p.ig = lower(g.ig) WHERE p.igsid IS NOT NULL AND g.verified = 1 AND (g.ig_sent IS NULL OR g.ig_sent <> g.status) LIMIT 20"
  ).all()).results || [];
  for (const g of rows) {
    const first = String(g.name || "").split(" ")[0];
    const link = shortUrl(await shortFor(env, g), g.token);
    const text = g.ig_sent == null ? null : {
      approved: `You've been accepted`,
      paid: `Payment confirmed`,
    }[g.status];
    // claim it first so two runs at once never send twice
    const c = await env.DB.prepare("UPDATE guests SET ig_sent = ? WHERE token = ? AND (ig_sent IS NULL OR ig_sent <> ?)").bind(g.status, g.token, g.status).run();
    if (text && c.meta && c.meta.changes) await igSend(env, ev, g.igsid, text);
  }
}

async function tickIfDue(env) {
  const now = Date.now();
  const r = await env.DB.prepare("UPDATE event SET tick_at = ? WHERE id = 1 AND (tick_at IS NULL OR tick_at < ?)").bind(now, now - 55000).run();
  if (r.meta && r.meta.changes) { await pushTick(env, getEvent, parseProgram); await igStatusDms(env); }
}

// Security headers on every response the site sends.
const SECURITY = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "DENY",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Permissions-Policy": "camera=(self), microphone=(), geolocation=(), payment=(), usb=()",
  "Content-Security-Policy": "default-src 'self'; worker-src 'self'; manifest-src 'self'; script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; frame-src https://challenges.cloudflare.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'; upgrade-insecure-requests",
};
function secure(res) {
  if (!res || res.status === 101) return res;
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(SECURITY)) if (!out.headers.has(k)) out.headers.set(k, v);
  return out;
}

export default {
  async fetch(req, env, ctx) {
    const path = new URL(req.url).pathname;
    if (path === "/api/event") ctx.waitUntil(igEnsureSubscribed(env, true).catch(() => {}));
    // backup for the minute timer: guests' pages poll every 20 s, so notifications still go out
    if (path === "/api/event" || path === "/api/ticket" || path === "/api/ig/webhook") ctx.waitUntil(tickIfDue(env).catch(() => {}));
    // the admin panel pings this right after Approve / Paid, so the Instagram message goes out straight away
    if (path === "/api/nudge") { ctx.waitUntil(igStatusDms(env).catch(() => {})); return secure(new Response(null, { status: 204, headers: { "cache-control": "no-store", "access-control-allow-origin": "*" } })); }
    return secure(await route(req, env));
  },
  async scheduled(event, env, ctx) {
    if (new Date().getMinutes() === 0) ctx.waitUntil(igLog(env, "cron", event.cron));
    if (event.cron === "* * * * *") { ctx.waitUntil(tickIfDue(env)); ctx.waitUntil(igEnsureSubscribed(env)); return; }
    ctx.waitUntil(refreshIgToken(env));
    ctx.waitUntil(env.DB.prepare("DELETE FROM hits WHERE reset < ?").bind(Date.now()).run().catch(() => {}));
  },
};

async function route(req, env) {
  {
    const url = new URL(req.url);
    if (url.hostname === "www.perugiaparty.com") {
      url.hostname = "perugiaparty.com";
      return Response.redirect(url.toString(), 301); // one address for search engines
    }
    if (url.pathname.startsWith("/t/")) {
      if (await tooMany(req, env, "short")) return slowDown();
      const r = await shortRedirect(url, env);
      if (r) return r;
      return env.ASSETS.fetch(new Request(new URL("/404-not-found", url), req));
    }
    if (url.pathname === "/admin" || url.pathname === "/admin/") {
      return Response.redirect(PANEL_URL, 302); // private panel; only Matt's Claude account can open it
    }
    if (url.pathname.startsWith("/api/")) {
      try {
        if (url.pathname === "/api/event" && req.method === "GET") return await apiEvent(env);
        if (req.method === "POST" && url.pathname === "/api/request" && (await tooMany(req, env, "request"))) return slowDown();
        if (req.method === "POST" && url.pathname === "/api/rerequest" && (await tooMany(req, env, "rerequest"))) return slowDown();
        if (req.method === "POST" && url.pathname === "/api/login" && (await tooMany(req, env, "login"))) return slowDown();
        if (req.method === "POST" && url.pathname === "/api/door/login" && (await tooMany(req, env, "door"))) return slowDown();
        if (url.pathname === "/api/invite" && (await tooMany(req, env, "invite"))) return slowDown();
        if (url.pathname === "/api/request" && req.method === "POST") return await apiRequest(req, env);
        if (url.pathname === "/api/ticket" && req.method === "GET") return await apiTicket(url, env);
        if (url.pathname === "/api/poster" && req.method === "GET") return await apiPoster(env);
        if (url.pathname === "/api/invite" && req.method === "GET") return await apiInvite(url, env);
        if (url.pathname === "/api/rerequest" && req.method === "POST") return await apiRerequest(req, env);
        if (url.pathname === "/api/login" && req.method === "POST") return await apiLogin(req, env);
        if (url.pathname === "/api/push/key" && req.method === "GET") return await apiPush(req, env, url, getEvent, TOKEN_RE, json);
        if ((url.pathname === "/api/push/subscribe" || url.pathname === "/api/push/unsubscribe") && req.method === "POST") return await apiPush(req, env, url, getEvent, TOKEN_RE, json);
        if (url.pathname === "/manifest.webmanifest") return manifest(url);
        if (url.pathname === "/api/ig/webhook" && req.method === "GET") return await igWebhookVerify(url, env);
        if (url.pathname === "/api/ig/webhook" && req.method === "POST") return await igWebhook(req, env);
        if (url.pathname === "/api/door/login" && req.method === "POST") return await apiDoor(req, env, "login");
        if (url.pathname === "/api/door/check" && req.method === "POST") return await apiDoor(req, env, "check");
        if (url.pathname === "/api/door/checkin" && req.method === "POST") return await apiDoor(req, env, "checkin");
        return json({ error: "Not found" }, 404);
      } catch (e) {
        return json({ error: "Something went wrong on our side. Try again in a minute." }, 500);
      }
    }
    if (url.pathname === "/" || url.pathname === "/index.html") return homepage(req, env);
    return env.ASSETS.fetch(req);
  }
}
