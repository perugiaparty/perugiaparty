// Crew dashboard (perugiaparty.com/crew): spendings, shopping list and attendance for the people
// Matt assigns as crew for the current party in the admin panel.
// Every crew member has their own username and password (set in the admin panel, stored as a PBKDF2 hash).
// The page keeps the session only in memory, so the password is asked every time the page opens.
// Access is checked on every call: whoever is no longer crew for the current party is locked out at once.
// Money is Matt's only (admin panel): crew see just their own receipts and what they're owed back.
// No totals, budget, ticket money, other people's spendings or price estimates ever leave the server here.

import { sendPush } from "./push.js";

const ITER = 100000;
const SESSION_MS = 12 * 3600 * 1000;
const PHASES = ["prep", "promo", "day", "during", "after"];
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
const normIg = (ig) => { const h = String(ig || "").trim().replace(/^@+/, "").replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/[/?#].*$/, "").toLowerCase(); return h ? "@" + h : ""; };
// same code shape the Instagram webhook already reads: PREFIX-XXXXXX
function newCrewCode() {
  const alph = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  return "CREW-" + Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => alph[b % alph.length]).join("");
}

// Instagram DM with a CREW-XXXXXX code: proves the Instagram account is theirs. Matt still approves them after.
export async function crewDm(env, ev, igsid, code, { igSend, igUsername, igLog }) {
  const c = await env.DB.prepare("SELECT * FROM crew WHERE vcode = ?").bind(code).first();
  if (!c) { await igSend(env, ev, igsid, "Crew code not found. Copy it again from perugiaparty.com/crew and send it here."); return; }
  const username = await igUsername(env, ev, igsid);
  await igLog(env, "crew-dm", `code=${code} username=${username}`);
  if (!username) return;
  const first = String(c.name || "").split(" ")[0];
  if (normIg(username) !== normIg(c.ig)) { await igSend(env, ev, igsid, `This crew code belongs to another Instagram account. Send it from ${c.ig}.`); return; }
  await env.DB.prepare("UPDATE crew SET ig_ok = 1, igsid = ?, notified = CASE WHEN approved = 1 THEN 1 ELSE notified END WHERE id = ?").bind(igsid, c.id).run();
  await igSend(env, ev, igsid, Number(c.approved) === 1
    ? `Confirmed, ${first}! You can log in at perugiaparty.com/crew`
    : `Confirmed, ${first}! Your Instagram is verified. Matt still has to approve you as crew. You'll get a message here when you're in.`);
}
// once Matt approves someone in the admin panel: tell them on Instagram (runs with the minute tick)
export async function crewApprovedDms(env, ev, igSend) {
  if (!ev || !ev.ig_token || Number(ev.ig_dms_off) === 1) return;
  const rows = (await env.DB.prepare("SELECT id, name, user, igsid FROM crew WHERE approved = 1 AND ig_ok = 1 AND igsid IS NOT NULL AND COALESCE(notified, 1) = 0 LIMIT 10").all()).results || [];
  for (const c of rows) {
    const r = await env.DB.prepare("UPDATE crew SET notified = 1 WHERE id = ? AND notified = 0").bind(c.id).run();
    if (!r.meta || !r.meta.changes) continue;
    await igSend(env, ev, c.igsid, `You're in, ${String(c.name || "").split(" ")[0]}! Matt approved you as crew${ev.name ? " for " + ev.name : ""}.\nLog in at perugiaparty.com/crew with username ${c.user} and your password.`);
  }
}

// ---- phone notifications for the crew (same Web Push as guests; subscriptions stored as token "crew:<id>") ----
async function pushToCrew(env, ev, ids, message) {
  if (!ev || !ev.vapid_public || !ev.vapid_private || !ids.length) return 0;
  let sent = 0;
  for (const id of ids) {
    const subs = (await env.DB.prepare("SELECT * FROM push_subs WHERE token = ?").bind("crew:" + id).all()).results || [];
    for (const sub of subs) {
      const r = await sendPush(env, ev, sub, { url: "/crew", tag: "crew", ...message });
      if (r === "gone") await env.DB.prepare("DELETE FROM push_subs WHERE endpoint = ?").bind(sub.endpoint).run();
      if (r === "ok") sent++;
    }
  }
  return sent;
}
// announcements (from /crew or the admin panel) go out with the minute tick
export async function crewNewsPush(env, ev) {
  if (!ev || !ev.tag) return;
  const rows = (await env.DB.prepare("SELECT * FROM crew_news WHERE event = ? AND COALESCE(pushed, 1) = 0 LIMIT 5").bind(ev.tag).all()).results || [];
  for (const n of rows) {
    const r = await env.DB.prepare("UPDATE crew_news SET pushed = 1 WHERE id = ? AND pushed = 0").bind(n.id).run();
    if (!r.meta || !r.meta.changes) continue;
    const ids = ((await env.DB.prepare("SELECT crew_id FROM crew_party WHERE event = ?").bind(ev.tag).all()).results || []).map((x) => x.crew_id).filter((id) => id !== n.crew_id);
    await pushToCrew(env, ev, ids, { title: `📣 ${n.author || "Matt"}`, body: String(n.body).slice(0, 180), tag: "crew-news-" + n.id });
  }
}
const dueOk = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || "")) ? String(d) : null;
const timeOk = (t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(t || "")) ? String(t) : null;

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

// colour palette set in the admin panel: {note, colors:[{name, hex}]}
function palette(raw) {
  try {
    const p = JSON.parse(raw || "null");
    if (!p || !Array.isArray(p.colors)) return null;
    const colors = p.colors.filter((c) => c && /^#[0-9a-f]{6}$/i.test(c.hex)).slice(0, 8).map((c) => ({ name: clean(c.name, 30), hex: c.hex }));
    return colors.length ? { note: clean(p.note, 300), colors } : null;
  } catch { return null; }
}

async function state(env, ev, me) {
  const tag = ev.tag;
  const [crew, spends, needs, st, news, note, shifts, risks, decisions, retro] = await Promise.all([
    env.DB.prepare("SELECT c.id, c.name, c.lead, p.role, p.going, p.arrive, p.here_at FROM crew c JOIN crew_party p ON p.crew_id = c.id WHERE p.event = ? ORDER BY c.lead DESC, c.name").bind(tag).all(),
    env.DB.prepare("SELECT id, item, amount, cat, shop, repaid, repaid_at, created_at FROM crew_spend WHERE event = ? AND crew_id = ? ORDER BY created_at DESC").bind(tag, me.id).all(),
    env.DB.prepare("SELECT id, COALESCE(kind,'buy') AS kind, phase, due, doff, COALESCE(blocker,0) AS blocker, item, qty, cat, shop, owner, done, done_by, done_at, created_at, created_by FROM crew_need WHERE event = ? ORDER BY done, created_at").bind(tag).all(),
    env.DB.prepare(
      "SELECT SUM(status IN ('requested','waitlist')) AS requested, SUM(status = 'approved') AS approved, SUM(status IN ('paid','in')) AS paid, SUM(status = 'in') AS inside, SUM(ticket = 'crew' AND status IN ('approved','paid','in')) AS crew_tickets FROM guests WHERE event = ?"
    ).bind(tag).first(),
    env.DB.prepare("SELECT id, body, author, crew_id, created_at FROM crew_news WHERE event = ? ORDER BY created_at DESC LIMIT 30").bind(tag).all(),
    env.DB.prepare("SELECT body, updated_at FROM crew_note WHERE crew_id = ?").bind(me.id).first(),
    env.DB.prepare("SELECT id, crew_id, role, start, end FROM crew_shift WHERE event = ? ORDER BY CASE WHEN start < '12:00' THEN 1 ELSE 0 END, start, end").bind(tag).all(),
    env.DB.prepare("SELECT id, risk, plan FROM crew_risk WHERE event = ? ORDER BY id").bind(tag).all(),
    env.DB.prepare("SELECT id, body, author, created_at FROM crew_decision WHERE event = ? ORDER BY created_at DESC").bind(tag).all(),
    env.DB.prepare("SELECT good, bad, change, updated_at FROM crew_retro WHERE crew_id = ? AND event = ?").bind(me.id, tag).first(),
  ]);
  const a = st || {};
  const out = {
    event: { name: ev.name || "", tag, date: ev.date_label || "", starts_at: ev.starts_at || "", doors: ev.doors || "", capacity: Number(ev.capacity) || null, palette: palette(ev.crew_palette), starts_at: ev.starts_at || "", info: String(ev.crew_info || "").slice(0, 2000) },
    me: { id: me.id, name: me.name, lead: Number(me.lead) === 1, role: me.role || "", going: me.going || "", arrive: me.arrive || "" },
    crew: crew.results || [],
    spends: spends.results || [],
    needs: needs.results || [],
    cats: CATS,
    news: news.results || [],
    shifts: shifts.results || [],
    risks: risks.results || [],
    decisions: decisions.results || [],
    retro: retro || { good: "", bad: "", change: "", updated_at: null },
    note: note ? { body: note.body || "", at: note.updated_at } : { body: "", at: null },
    attendance: { requested: a.requested || 0, approved: a.approved || 0, paid: a.paid || 0, inside: a.inside || 0, crew_tickets: a.crew_tickets || 0 },
  };
  return out;
}

export async function apiCrew(req, env, action, { getEvent, json }) {
  let body; try { body = await req.json(); } catch { return json({ error: "Bad request" }, 400); }
  const ev = await getEvent(env);
  if (!ev || !ev.tag) return json({ error: "There is no party set up right now." }, 403);

  if (action === "signup") {
    const name = clean(body.name, 60), ig = normIg(clean(body.ig, 60)), user = clean(body.user, 40).toLowerCase().replace(/^@+/, "");
    const pw = String(body.password || "");
    if (name.length < 2) return json({ error: "Write your full name." }, 400);
    if (!/^@[a-z0-9._]{1,30}$/.test(ig)) return json({ error: "Write your Instagram username." }, 400);
    if (!/^[a-z0-9._]{3,30}$/.test(user)) return json({ error: "Username: 3 to 30 letters, numbers, dots or underscores." }, 400);
    if (pw.length < 8 || pw.length > 200) return json({ error: "Password: at least 8 characters." }, 400);
    if (await env.DB.prepare("SELECT 1 FROM crew WHERE user = ?").bind(user).first()) return json({ error: "That username is taken. Pick another one." }, 409);
    const same = await env.DB.prepare("SELECT ig_ok, approved FROM crew WHERE lower(ig) = ?").bind(ig).first();
    if (same) return json({ error: Number(same.approved) === 1 ? "This Instagram already has a crew account. Log in instead." : "This Instagram already signed up. Wait for Matt to approve you." }, 409);
    const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
    const vcode = newCrewCode();
    await env.DB.prepare("INSERT INTO crew (name, user, salt, pw_hash, lead, created_at, ig, ig_ok, vcode, approved, notified) VALUES (?, ?, ?, ?, 0, ?, ?, 0, ?, 0, 0)")
      .bind(name, user, salt, await crewHash(pw, salt), Date.now(), ig, vcode).run();
    return json({ ok: true, vcode, ig });
  }

  if (action === "login") {
    const user = clean(body.user, 40).toLowerCase().replace(/^@+/, "");
    const pw = String(body.password || "").slice(0, 200);
    const c = user ? await env.DB.prepare("SELECT * FROM crew WHERE user = ?").bind(user).first() : null;
    // always do the slow hash, so a wrong username takes as long as a wrong password
    const h = await crewHash(pw, c && c.salt ? c.salt : "00".repeat(16));
    if (!c || !c.pw_hash || !pw || !same(h, c.pw_hash)) { await sleep(600); return json({ error: "Wrong username or password." }, 401); }
    // signed up themselves: first prove the Instagram, then wait for Matt
    if (c.vcode && Number(c.ig_ok) !== 1) return json({ error: "Confirm your Instagram first: send your code to @perugiaparty.", pending: "ig", vcode: c.vcode, ig: c.ig }, 403);
    if (Number(c.approved) !== 1) return json({ error: "Your Instagram is confirmed. Matt still has to approve you as crew. You'll get a DM when you're in.", pending: "approve" }, 403);
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

  switch (action) {
    case "state":
      return ok();
    case "logout":
      await env.DB.prepare("DELETE FROM crew_sess WHERE token = ?").bind(body.token).run();
      return json({ ok: true });

    case "spend_add": {
      const item = clean(body.item, 120), amount = money(body.amount);
      if (!item || amount == null || amount <= 0) return json({ error: "Add what you bought and how much it cost." }, 400);
      const payer = me.id; // you can only add what you paid yourself
      const cat = CATS.includes(body.cat) ? body.cat : "Other";
      await env.DB.prepare("INSERT INTO crew_spend (event, crew_id, item, amount, cat, shop, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(tag, payer, item, amount, cat, clean(body.shop, 60), now, me.id).run();
      return ok();
    }
    case "spend_del": {
      const s = await env.DB.prepare("SELECT * FROM crew_spend WHERE id = ? AND event = ?").bind(id, tag).first();
      if (!s) return ok();
      if (s.crew_id !== me.id || Number(s.repaid) === 1) return json({ error: "You can only remove your own receipts, before they're paid back." }, 403);
      await env.DB.prepare("DELETE FROM crew_spend WHERE id = ?").bind(id).run();
      return ok();
    }

    case "need_add": {
      const item = clean(body.item, 120);
      if (!item) return json({ error: "Write what it is first." }, 400);
      const kind = body.kind === "todo" ? "todo" : "buy";
      const phase = kind === "todo" && PHASES.includes(body.phase) ? body.phase : kind === "todo" ? "prep" : null;
      const cat = CATS.includes(body.cat) ? body.cat : "Other";
      await env.DB.prepare("INSERT INTO crew_need (event, kind, phase, due, item, qty, cat, shop, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(tag, kind, phase, dueOk(body.due), item, clean(body.qty, 30), kind === "todo" ? "Other" : cat, kind === "todo" ? null : clean(body.shop, 40) || null, now, me.id).run();
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
        const price = n.kind === "todo" ? null : money(body.price);
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

    case "note": {
      // private notepad: only this person ever reads it back
      const text = String(body.body ?? "").replace(/\u0000/g, "").slice(0, 20000);
      await env.DB.prepare("INSERT INTO crew_note (crew_id, body, updated_at) VALUES (?, ?, ?) ON CONFLICT(crew_id) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at").bind(me.id, text, now).run();
      return json({ ok: true, at: now });
    }
    case "news_add": {
      if (!lead) return json({ error: "Only a lead can post announcements." }, 403);
      const text = String(body.body ?? "").replace(/\u0000/g, "").trim().slice(0, 1000);
      if (!text) return json({ error: "Write the announcement first." }, 400);
      await env.DB.prepare("INSERT INTO crew_news (event, body, author, crew_id, created_at, pushed) VALUES (?, ?, ?, ?, ?, 0)").bind(tag, text, me.name, me.id, now).run();
      return ok();
    }
    case "news_del": {
      if (!lead) return json({ error: "Only a lead can remove announcements." }, 403);
      await env.DB.prepare("DELETE FROM crew_news WHERE id = ? AND event = ?").bind(id, tag).run();
      return ok();
    }
    case "need_blocker": {
      if (!lead) return json({ error: "Only a lead can mark blockers." }, 403);
      await env.DB.prepare("UPDATE crew_need SET blocker = ? WHERE id = ? AND event = ?").bind(body.v ? 1 : 0, id, tag).run();
      return ok();
    }
    case "here": {
      // crew check-in on the night
      await env.DB.prepare("UPDATE crew_party SET here_at = ? WHERE crew_id = ? AND event = ?").bind(body.v === false ? null : now, me.id, tag).run();
      return ok();
    }
    case "risk_add": {
      if (!lead) return json({ error: "Only a lead can add risks." }, 403);
      const risk = clean(body.risk, 120), plan = clean(body.plan, 300);
      if (!risk) return json({ error: "What could go wrong?" }, 400);
      await env.DB.prepare("INSERT INTO crew_risk (event, risk, plan, created_at) VALUES (?, ?, ?, ?)").bind(tag, risk, plan, now).run();
      return ok();
    }
    case "risk_del": {
      if (!lead) return json({ error: "Only a lead can remove risks." }, 403);
      await env.DB.prepare("DELETE FROM crew_risk WHERE id = ? AND event = ?").bind(id, tag).run();
      return ok();
    }
    case "decision_add": {
      if (!lead) return json({ error: "Only a lead can log decisions." }, 403);
      const text = clean(body.body, 300);
      if (!text) return json({ error: "Write the decision first." }, 400);
      await env.DB.prepare("INSERT INTO crew_decision (event, body, author, created_at) VALUES (?, ?, ?, ?)").bind(tag, text, me.name, now).run();
      return ok();
    }
    case "decision_del": {
      if (!lead) return json({ error: "Only a lead can remove decisions." }, 403);
      await env.DB.prepare("DELETE FROM crew_decision WHERE id = ? AND event = ?").bind(id, tag).run();
      return ok();
    }
    case "retro": {
      const g = clean(body.good, 1000), b = clean(body.bad, 1000), c = clean(body.change, 1000);
      await env.DB.prepare("INSERT INTO crew_retro (crew_id, event, good, bad, change, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(crew_id, event) DO UPDATE SET good = excluded.good, bad = excluded.bad, change = excluded.change, updated_at = excluded.updated_at")
        .bind(me.id, tag, g, b, c, now).run();
      return ok();
    }
    case "need_due": {
      await env.DB.prepare("UPDATE crew_need SET due = ? WHERE id = ? AND event = ?").bind(dueOk(body.due), id, tag).run();
      return ok();
    }
    case "need_assign": {
      if (!lead) return json({ error: "Only a lead can give tasks to others." }, 403);
      const to = Number(body.to) || null;
      const n = await env.DB.prepare("SELECT * FROM crew_need WHERE id = ? AND event = ?").bind(id, tag).first();
      if (!n) return ok();
      if (to && !(await onCrew(env, to, tag))) return json({ error: "That person isn't on the crew for this party." }, 400);
      await env.DB.prepare("UPDATE crew_need SET owner = ? WHERE id = ?").bind(to, id).run();
      if (to && to !== me.id) await pushToCrew(env, ev, [to], { title: n.kind === "todo" ? "New task for you" : "Can you get this?", body: `${n.item}${n.qty ? " × " + n.qty : ""} · from ${String(me.name).split(" ")[0]}`, tag: "crew-task-" + id });
      return ok();
    }
    case "shift_add": {
      if (!lead) return json({ error: "Only a lead can plan shifts." }, 403);
      const who = Number(body.crew_id), start = timeOk(body.start), end = timeOk(body.end), role = clean(body.role, 30);
      if (!who || !(await onCrew(env, who, tag))) return json({ error: "Pick someone from the crew." }, 400);
      if (!role || !start) return json({ error: "Add the job and the start time." }, 400);
      await env.DB.prepare("INSERT INTO crew_shift (event, crew_id, role, start, end, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(tag, who, role, start, end, now).run();
      if (who !== me.id) await pushToCrew(env, ev, [who], { title: "New shift for you", body: `${role} · ${start}${end ? "–" + end : ""}${ev.date_label ? " · " + ev.date_label : ""}`, tag: "crew-shift" });
      return ok();
    }
    case "shift_del": {
      if (!lead) return json({ error: "Only a lead can change shifts." }, 403);
      await env.DB.prepare("DELETE FROM crew_shift WHERE id = ? AND event = ?").bind(id, tag).run();
      return ok();
    }
    case "push": {
      // turn phone notifications on/off for this crew member on this device
      const sub = body.sub || {}, keys = sub.keys || {}, endpoint = String(sub.endpoint || "");
      if (body.off) { await env.DB.prepare("DELETE FROM push_subs WHERE endpoint = ? AND token = ?").bind(endpoint, "crew:" + me.id).run(); return json({ ok: true }); }
      if (!/^https:\/\/[^\s]{10,500}$/.test(endpoint) || !keys.p256dh || !keys.auth || String(keys.p256dh).length > 200 || String(keys.auth).length > 60) return json({ error: "Notifications couldn't be turned on." }, 400);
      await env.DB.prepare("INSERT INTO push_subs (endpoint, token, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET token = excluded.token, p256dh = excluded.p256dh, auth = excluded.auth")
        .bind(endpoint, "crew:" + me.id, String(keys.p256dh), String(keys.auth), now).run();
      await sendPush(env, ev, { endpoint, p256dh: String(keys.p256dh), auth: String(keys.auth) }, { title: "Crew notifications are on 🔔", body: "You'll get announcements, tasks and shifts here.", url: "/crew", tag: "crew-hello" });
      return json({ ok: true });
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
  }
  return json({ error: "Not found" }, 404);
}
