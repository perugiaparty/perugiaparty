// Crew dashboard (perugiaparty.com/crew): spendings, shopping list and attendance for the people
// Matt assigns as crew for the current party in the admin panel.
// Every crew member has their own username and password (set in the admin panel, stored as a PBKDF2 hash).
// The page keeps the session only in memory, so the password is asked every time the page opens.
// Access is checked on every call: whoever is no longer crew for the current party is locked out at once.

const ITER = 100000;
const SESSION_MS = 12 * 3600 * 1000;
const CATS = ["Drinks", "Food", "Deco", "Venue", "Music", "Promo", "Other"];

const hex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
const unhex = (h) => new Uint8Array((String(h).match(/../g) || []).map((x) => parseInt(x, 16)));
const clean = (v, max) => String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
const money = (v) => { const n = Math.round(Number(String(v ?? "").replace(",", ".")) * 100) / 100; return Number.isFinite(n) && n >= 0 && n < 100000 ? n : null; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function same(a, b) { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; }

export async function crewHash(password, saltHex) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  return hex(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: unhex(saltHex), iterations: ITER }, key, 256));
}
function newToken() {
  const alph = "abcdefghijkmnpqrstuvwxyz23456789";
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => alph[b % 32]).join("");
}

async function onCrew(env, crewId, tag) {
  if (!tag) return null;
  return env.DB.prepare("SELECT c.id, c.name, c.user, c.lead, p.role, p.going, p.arrive FROM crew c JOIN crew_party p ON p.crew_id = c.id WHERE c.id = ? AND p.event = ?").bind(crewId, tag).first();
}

async function session(env, ev, token) {
  if (!/^[a-z0-9]{32}$/.test(String(token || ""))) return null;
  const s = await env.DB.prepare("SELECT * FROM crew_sess WHERE token = ?").bind(token).first();
  if (!s || s.expires < Date.now() || s.event !== ev.tag) return null;
  return onCrew(env, s.crew_id, ev.tag);
}

async function state(env, ev, me) {
  const tag = ev.tag;
  const [crew, spends, needs, st] = await Promise.all([
    env.DB.prepare("SELECT c.id, c.name, c.lead, p.role, p.going, p.arrive FROM crew c JOIN crew_party p ON p.crew_id = c.id WHERE p.event = ? ORDER BY c.lead DESC, c.name").bind(tag).all(),
    env.DB.prepare("SELECT * FROM crew_spend WHERE event = ? ORDER BY created_at DESC").bind(tag).all(),
    env.DB.prepare("SELECT * FROM crew_need WHERE event = ? ORDER BY done, created_at").bind(tag).all(),
    env.DB.prepare(
      "SELECT SUM(status IN ('requested','waitlist')) AS requested, SUM(status = 'approved') AS approved, SUM(status IN ('paid','in')) AS paid, SUM(status = 'in') AS inside, SUM(ticket = 'crew' AND status IN ('approved','paid','in')) AS crew_tickets, SUM(CASE WHEN status IN ('paid','in') THEN COALESCE(price,0) ELSE 0 END) AS money FROM guests WHERE event = ?"
    ).bind(tag).first(),
  ]);
  const a = st || {};
  const out = {
    event: { name: ev.name || "", tag, date: ev.date_label || "", starts_at: ev.starts_at || "", doors: ev.doors || "", capacity: Number(ev.capacity) || null, budget: ev.crew_budget == null ? null : Number(ev.crew_budget) },
    me: { id: me.id, name: me.name, lead: Number(me.lead) === 1, role: me.role || "", going: me.going || "", arrive: me.arrive || "" },
    crew: crew.results || [],
    spends: spends.results || [],
    needs: needs.results || [],
    cats: CATS,
    attendance: { requested: a.requested || 0, approved: a.approved || 0, paid: a.paid || 0, inside: a.inside || 0, crew_tickets: a.crew_tickets || 0 },
  };
  // ticket money only for leads
  if (Number(me.lead) === 1) out.attendance.money = Math.round((a.money || 0) * 100) / 100;
  return out;
}

export async function apiCrew(req, env, action, { getEvent, json }) {
  let body; try { body = await req.json(); } catch { return json({ error: "Bad request" }, 400); }
  const ev = await getEvent(env);
  if (!ev || !ev.tag) return json({ error: "There is no party set up right now." }, 403);

  if (action === "login") {
    const user = clean(body.user, 40).toLowerCase().replace(/^@+/, "");
    const pw = String(body.password || "").slice(0, 200);
    const c = user ? await env.DB.prepare("SELECT * FROM crew WHERE user = ?").bind(user).first() : null;
    // always do the slow hash, so a wrong username takes as long as a wrong password
    const h = await crewHash(pw, c && c.salt ? c.salt : "00".repeat(16));
    if (!c || !c.pw_hash || !pw || !same(h, c.pw_hash)) { await sleep(600); return json({ error: "Wrong username or password." }, 401); }
    const me = await onCrew(env, c.id, ev.tag);
    if (!me) return json({ error: "You're not on the crew for this party. Ask Matt to add you." }, 403);
    const token = newToken(), now = Date.now();
    await env.DB.batch([
      env.DB.prepare("DELETE FROM crew_sess WHERE expires < ?").bind(now),
      env.DB.prepare("INSERT INTO crew_sess (token, crew_id, event, expires) VALUES (?, ?, ?, ?)").bind(token, c.id, ev.tag, now + SESSION_MS),
      env.DB.prepare("UPDATE crew SET last_login = ? WHERE id = ?").bind(now, c.id),
    ]);
    return json({ token, ...(await state(env, ev, me)) });
  }

  const me = await session(env, ev, body.token);
  if (!me) return json({ error: "Session ended. Log in again.", relogin: true }, 401);
  const lead = Number(me.lead) === 1;
  const tag = ev.tag, now = Date.now();
  const id = Number(body.id) || 0;
  const ok = async () => json(await state(env, ev, (await onCrew(env, me.id, tag)) || me));
  const crewIds = async () => new Set(((await env.DB.prepare("SELECT crew_id FROM crew_party WHERE event = ?").bind(tag).all()).results || []).map((r) => r.crew_id));

  switch (action) {
    case "state":
      return ok();
    case "logout":
      await env.DB.prepare("DELETE FROM crew_sess WHERE token = ?").bind(body.token).run();
      return json({ ok: true });

    case "spend_add": {
      const item = clean(body.item, 120), amount = money(body.amount);
      if (!item || amount == null || amount <= 0) return json({ error: "Add what you bought and how much it cost." }, 400);
      let payer = Number(body.paid_by) || me.id;
      if (payer !== me.id && !(await crewIds()).has(payer)) payer = me.id;
      const cat = CATS.includes(body.cat) ? body.cat : "Other";
      await env.DB.prepare("INSERT INTO crew_spend (event, crew_id, item, amount, cat, shop, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(tag, payer, item, amount, cat, clean(body.shop, 60), now, me.id).run();
      return ok();
    }
    case "spend_del": {
      const s = await env.DB.prepare("SELECT * FROM crew_spend WHERE id = ? AND event = ?").bind(id, tag).first();
      if (!s) return ok();
      if (!lead && (s.created_by !== me.id || Number(s.repaid) === 1)) return json({ error: "Only the person who added it can remove it, and only before it's paid back." }, 403);
      await env.DB.prepare("DELETE FROM crew_spend WHERE id = ?").bind(id).run();
      return ok();
    }
    case "spend_repaid": {
      if (!lead) return json({ error: "Only a lead can mark spendings as paid back." }, 403);
      await env.DB.prepare("UPDATE crew_spend SET repaid = ? WHERE id = ? AND event = ?").bind(body.v ? 1 : 0, id, tag).run();
      return ok();
    }

    case "need_add": {
      const item = clean(body.item, 120);
      if (!item) return json({ error: "What do we need?" }, 400);
      const est = money(body.est);
      const cat = CATS.includes(body.cat) ? body.cat : "Other";
      await env.DB.prepare("INSERT INTO crew_need (event, item, qty, est, cat, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .bind(tag, item, clean(body.qty, 30), est && est > 0 ? est : null, cat, now, me.id).run();
      return ok();
    }
    case "need_claim": {
      await env.DB.prepare("UPDATE crew_need SET owner = CASE WHEN owner = ? THEN NULL ELSE ? END WHERE id = ? AND event = ? AND (owner IS NULL OR owner = ? OR ?)")
        .bind(me.id, me.id, id, tag, me.id, lead ? 1 : 0).run();
      return ok();
    }
    case "need_done": {
      const n = await env.DB.prepare("SELECT * FROM crew_need WHERE id = ? AND event = ?").bind(id, tag).first();
      if (!n) return ok();
      if (body.v) {
        const stmts = [env.DB.prepare("UPDATE crew_need SET done = 1, done_by = ?, done_at = ?, owner = COALESCE(owner, ?) WHERE id = ?").bind(me.id, now, me.id, id)];
        const price = money(body.price);
        // bought with own money: goes straight into spendings, so it gets paid back
        if (price && price > 0) stmts.push(env.DB.prepare("INSERT INTO crew_spend (event, crew_id, item, amount, cat, shop, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
          .bind(tag, me.id, n.item + (n.qty ? " (" + n.qty + ")" : ""), price, n.cat || "Other", clean(body.shop, 60), now, me.id));
        await env.DB.batch(stmts);
      } else {
        await env.DB.prepare("UPDATE crew_need SET done = 0, done_by = NULL, done_at = NULL WHERE id = ?").bind(id).run();
      }
      return ok();
    }
    case "need_del": {
      const n = await env.DB.prepare("SELECT * FROM crew_need WHERE id = ? AND event = ?").bind(id, tag).first();
      if (!n) return ok();
      if (!lead && n.created_by !== me.id) return json({ error: "Only the person who added it (or a lead) can remove it." }, 403);
      await env.DB.prepare("DELETE FROM crew_need WHERE id = ?").bind(id).run();
      return ok();
    }

    case "me": {
      const going = ["yes", "maybe", "no"].includes(body.going) ? body.going : "";
      await env.DB.prepare("UPDATE crew_party SET going = ?, arrive = ? WHERE crew_id = ? AND event = ?").bind(going, clean(body.arrive, 40), me.id, tag).run();
      return ok();
    }
    case "role": {
      if (!lead) return json({ error: "Only a lead can change jobs." }, 403);
      await env.DB.prepare("UPDATE crew_party SET role = ? WHERE crew_id = ? AND event = ?").bind(clean(body.role, 40), id, tag).run();
      return ok();
    }
    case "budget": {
      if (!lead) return json({ error: "Only a lead can set the budget." }, 403);
      const b = money(body.budget);
      await env.DB.prepare("UPDATE event SET crew_budget = ? WHERE id = 1").bind(b && b > 0 ? b : null).run();
      ev.crew_budget = b && b > 0 ? b : null;
      return ok();
    }
  }
  return json({ error: "Not found" }, 404);
}
