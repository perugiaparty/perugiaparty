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

async function getEvent(env) {
  return env.DB.prepare("SELECT * FROM event WHERE id = 1").first();
}

async function apiEvent(env) {
  const ev = await getEvent(env);
  if (!ev || !ev.published) return json({ published: false });
  return json({
    published: true,
    name: ev.name,
    starts_at: ev.starts_at,
    date_label: ev.date_label,
    doors: ev.doors,
    price: priceRange(ev),
    requests_open: !!ev.requests_open,
  });
}

async function apiRequest(req, env) {
  let body;
  try { body = await req.json(); } catch { return json({ error: "Send the form again." }, 400); }
  if (body.website) return json({ ok: true, token: newToken() }); // honeypot: pretend success
  const ev = await getEvent(env);
  if (!ev || !ev.published || !ev.requests_open || !ev.tag) {
    return json({ error: "Requests aren't open right now. Follow @perugiaparty on Instagram for the next date." }, 409);
  }
  const name = clean(body.name, 80);
  let ig = clean(body.ig, 40).replace(/^@+/, "");
  const phone = clean(body.phone, 30);
  const note = clean(body.intro, 500);
  if (name.length < 2) return json({ error: "Add your full name." }, 400);
  if (!/^[A-Za-z0-9._]{1,30}$/.test(ig)) return json({ error: "Add your Instagram handle, like @yourname." }, 400);
  if (body.age !== true || body.rules !== true) return json({ error: "Confirm you're 18+ and accept the house rules." }, 400);
  ig = "@" + ig.toLowerCase();
  const dup = await env.DB.prepare("SELECT 1 FROM guests WHERE event = ? AND lower(ig) = ? AND status IN ('requested','approved','paid','in')")
    .bind(ev.tag, ig).first();
  if (dup) return json({ error: "This Instagram already has a request for this party. Use the personal link you got, or DM us." }, 409);
  const token = newToken();
  await env.DB.prepare("INSERT INTO guests (token, event, name, ig, phone, note, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'requested', ?)")
    .bind(token, ev.tag, name, ig, phone, note, Date.now()).run();
  return json({ ok: true, token });
}

async function apiTicket(url, env) {
  const t = url.searchParams.get("t") || "";
  if (!TOKEN_RE.test(t)) return json({ error: "This link isn't valid." }, 404);
  const g = await env.DB.prepare("SELECT * FROM guests WHERE token = ?").bind(t).first();
  if (!g) return json({ error: "We couldn't find this request." }, 404);
  const ev = (await getEvent(env)) || {};
  const sameEvent = ev.tag === g.event;
  const out = { status: g.status, name: g.name, event: sameEvent ? ev.name : g.event };
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
    });
  }
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

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === "/admin" || url.pathname === "/admin/") {
      return Response.redirect(PANEL_URL, 302); // private panel; only Matt's Claude account can open it
    }
    if (url.pathname.startsWith("/api/")) {
      try {
        if (url.pathname === "/api/event" && req.method === "GET") return await apiEvent(env);
        if (url.pathname === "/api/request" && req.method === "POST") return await apiRequest(req, env);
        if (url.pathname === "/api/ticket" && req.method === "GET") return await apiTicket(url, env);
        if (url.pathname === "/api/door/login" && req.method === "POST") return await apiDoor(req, env, "login");
        if (url.pathname === "/api/door/check" && req.method === "POST") return await apiDoor(req, env, "check");
        if (url.pathname === "/api/door/checkin" && req.method === "POST") return await apiDoor(req, env, "checkin");
        return json({ error: "Not found" }, 404);
      } catch (e) {
        return json({ error: "Something went wrong on our side. Try again in a minute." }, 500);
      }
    }
    return env.ASSETS.fetch(req);
  },
};
