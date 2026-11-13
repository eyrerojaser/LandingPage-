// PageBloom como plataforma: registro de clientas, entrada con correo, plan con Stripe y tu sección «Plataforma».
import { getStore } from "@netlify/blobs";
import { platform, getTenant, saveTenant, platSettings, planState, newSession, sessionTenant, endSession, listTenants, hashPw, sha, RESERVED, DAY } from "./tenant.mjs";

const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const clip = (v, n = 120) => String(v == null ? "" : v).trim().slice(0, n);
const emailOk = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const slugify = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
const rnd = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((x) => x.toString(16).padStart(2, "0")).join("");
const PRICE = (ps) => Math.max(1, Number(ps.price) || 29);
const TRIAL = (ps) => Math.max(0, Math.min(60, ps.trialDays == null ? 14 : Number(ps.trialDays)));
const ownerStore = (name) => getStore({ name, consistency: "strong" });

/* ---------- Stripe ---------- */
function form(obj, pre = "", out = []) {
  for (const [k, v] of Object.entries(obj)) {
    if (v == null) continue;
    const key = pre ? pre + "[" + k + "]" : k;
    if (typeof v === "object") form(v, key, out); else out.push(encodeURIComponent(key) + "=" + encodeURIComponent(String(v)));
  }
  return out.join("&");
}
async function stripe(key, method, path, params) {
  const r = await fetch("https://api.stripe.com/v1/" + path + (method === "GET" && params ? "?" + form(params) : ""), {
    method, headers: { authorization: "Bearer " + key, "content-type": "application/x-www-form-urlencoded", "stripe-version": "2024-06-20" },
    body: method === "GET" ? undefined : form(params || {}),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error((d.error && d.error.message) || "stripe " + r.status); e.code = "stripe"; e.http = r.status; throw e; }
  return d;
}
async function verifyStripe(raw, header, secret) {
  const parts = Object.fromEntries(String(header || "").split(",").map((x) => x.split("=")).filter((x) => x.length === 2).map(([k, v]) => [k.trim(), v.trim()]));
  const sigs = String(header || "").split(",").filter((x) => x.trim().startsWith("v1=")).map((x) => x.trim().slice(3));
  if (!parts.t || !sigs.length) return false;
  if (Math.abs(Date.now() / 1000 - Number(parts.t)) > 600) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(parts.t + "." + raw)))].map((x) => x.toString(16).padStart(2, "0")).join("");
  return sigs.includes(mac);
}
const subEnd = (sub) => 1000 * (sub.current_period_end || (sub.items && sub.items.data && sub.items.data[0] && sub.items.data[0].current_period_end) || sub.trial_end || 0);
async function applySub(sub) {
  const slug = (sub.metadata && sub.metadata.slug) || "";
  const t = await getTenant(slug); if (!t) return;
  t.sub = sub.id; t.customer = sub.customer; t.subStatus = sub.status; t.periodEnd = subEnd(sub) || t.periodEnd;
  if (sub.status === "active" || sub.status === "trialing") t.failedAt = 0;
  if ((sub.status === "past_due" || sub.status === "unpaid") && !t.failedAt) t.failedAt = Date.now();
  await saveTenant(t);
}

/* ---------- correos de la plataforma (con tu Brevo) ---------- */
async function platformMail(to, subject, html) {
  const s = (await ownerStore("panel").get("settings", { type: "json" }).catch(() => null)) || {};
  if (!s.brevoKey || !s.senderEmail) return false;
  const r = await fetch("https://api.brevo.com/v3/smtp/email", { method: "POST", headers: { "api-key": s.brevoKey, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ sender: { name: s.senderName || "PageBloom", email: s.senderEmail }, to: [{ email: to }], subject, htmlContent: html }) });
  return r.ok;
}
const mailBox = (title, body, btn, href) => '<!doctype html><html><body style="margin:0;background:#F6F0F2;padding:24px 12px;font-family:Helvetica,Arial,sans-serif;color:#2A1E23;font-size:16px;line-height:1.55"><div style="max-width:520px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden"><div style="background:#0D0B0C;color:#F4D3DE;padding:18px 26px;font-family:Georgia,serif;font-size:20px">PageBloom</div><div style="padding:26px"><h1 style="font-family:Georgia,serif;font-weight:400;font-size:24px;margin:0 0 12px">' + title + '</h1><p style="margin:0 0 20px">' + body + '</p><p style="text-align:center;margin:0"><a href="' + href + '" style="background:#D8A2B4;color:#1A1215;text-decoration:none;padding:14px 26px;border-radius:10px;font-weight:bold;display:inline-block">' + btn + "</a></p></div></div></body></html>";

export const publicUrl = (origin, slug, ps) => (ps && ps.domain ? "https://" + slug + "." + ps.domain + "/" : origin + "/s/" + slug + "/");
const meOut = (t, ps, origin) => ({ slug: t.slug, name: t.name, email: t.email, plan: planState(t), subscribed: !!t.sub && ["active", "trialing", "past_due", "unpaid"].includes(t.subStatus), price: PRICE(ps), trialDays: TRIAL(ps), trialEnds: t.trialEnds, url: publicUrl(origin, t.slug, ps), seeded: !!t.seeded, platform: ps.name || "PageBloom", billing: !!ps.stripeKey });

/* ---------- rutas ----------
   Devuelve una respuesta si la ruta es de la plataforma; si no, null. ctx.owner() dice si quien llama eres tú (con tu contraseña). */
export async function saasRoute(req, url, route, m, ctx) {
  const ps = await platSettings();

  if (route === "plans" && m === "GET") return json({ name: ps.name || "PageBloom", price: PRICE(ps), trialDays: TRIAL(ps), open: ps.closed ? false : true });

  if (route === "signup" && m === "POST") {
    if (ps.closed) return json({ error: "closed" }, 403);
    const b = await req.json().catch(() => ({}));
    if (b.bot) return json({ error: "bad" }, 400);
    const name = clip(b.name, 60), email = clip(b.email, 200).toLowerCase(), pw = String(b.password || "");
    let slug = slugify(b.slug || name);
    if (name.length < 2) return json({ error: "name" }, 400);
    if (!emailOk(email)) return json({ error: "email" }, 400);
    if (pw.length < 8) return json({ error: "short" }, 400);
    if (slug.length < 2 || RESERVED.has(slug)) return json({ error: "slug" }, 409);
    // Hasta 5 registros por día desde la misma conexión
    const ip = req.headers.get("x-nf-client-connection-ip") || req.headers.get("x-forwarded-for") || "x", rk = "rl:" + (await sha(ip)).slice(0, 20) + ":" + new Date().toISOString().slice(0, 10);
    const rc = Number((await platform().get(rk).catch(() => null)) || 0); if (rc >= 5) return json({ error: "limit" }, 429);
    if (await platform().get("e:" + email).catch(() => null)) return json({ error: "taken" }, 409);
    if ((await getTenant(slug)) || (await ownerStore("site").get(slug + ".html").catch(() => null))) return json({ error: "slugtaken", suggest: slug + "-" + rnd(2) }, 409);
    const salt = rnd(16), now = Date.now();
    const t = { slug, name, email, salt, ph: await hashPw(pw, salt), at: now, trialEnds: now + TRIAL(ps) * DAY, seeded: false };
    await saveTenant(t);
    await platform().set("e:" + email, slug);
    await platform().set(rk, String(rc + 1));
    return json({ token: await newSession(slug), me: meOut(t, ps, url.origin) });
  }

  if (route === "login" && m === "POST") {
    // Sin correo es tu entrada con contraseña de siempre: la atiende el panel
    if (req.headers.get("x-panel-pass") != null) return null;
    const b = await req.clone().json().catch(() => ({}));
    const email = clip(b.email, 200).toLowerCase(), slug = email ? await platform().get("e:" + email).catch(() => null) : null;
    const t = slug ? await getTenant(slug) : null;
    if (!t || (await hashPw(String(b.password || ""), t.salt)) !== t.ph) return json({ error: "login" }, 401);
    return json({ token: await newSession(t.slug), me: meOut(t, ps, url.origin) });
  }
  if (route === "logout" && m === "POST") { await endSession(req); return json({ ok: true }); }

  if (route === "forgot" && m === "POST") {
    const b = await req.json().catch(() => ({}));
    const email = clip(b.email, 200).toLowerCase(), slug = emailOk(email) ? await platform().get("e:" + email).catch(() => null) : null;
    let sent = true;
    if (slug) {
      const tok = rnd(24); await platform().setJSON("r:" + (await sha(tok)), { slug, exp: Date.now() + 2 * 3600000 });
      sent = await platformMail(email, "Crea una contraseña nueva", mailBox("¿Olvidaste tu contraseña?", "Pulsa el botón para crear una nueva. El enlace sirve durante 2 horas. Si no lo pediste tú, ignora este correo.", "Crear contraseña nueva", url.origin + "/panel.html#reset=" + tok)).catch(() => false);
    }
    return json({ ok: true, mail: sent });
  }
  if (route === "reset" && m === "POST") {
    const b = await req.json().catch(() => ({}));
    const tok = String(b.token || ""), pw = String(b.password || "");
    if (pw.length < 8) return json({ error: "short" }, 400);
    const rk = "r:" + (await sha(tok)), r = /^[a-f0-9]{48}$/.test(tok) ? await platform().get(rk, { type: "json" }).catch(() => null) : null;
    const t = r && r.exp > Date.now() ? await getTenant(r.slug) : null;
    if (!t) return json({ error: "expired" }, 400);
    t.salt = rnd(16); t.ph = await hashPw(pw, t.salt); await saveTenant(t); await platform().delete(rk);
    return json({ token: await newSession(t.slug), me: meOut(t, ps, url.origin) });
  }

  /* ---- Stripe te avisa de pagos y cambios ---- */
  if (route === "stripe-webhook" && m === "POST") {
    const raw = await req.text();
    if (!ps.webhookSecret || !(await verifyStripe(raw, req.headers.get("stripe-signature"), ps.webhookSecret))) return json({ error: "sig" }, 400);
    const ev = JSON.parse(raw), o = (ev.data && ev.data.object) || {};
    try {
      if (ev.type === "checkout.session.completed" && o.mode === "subscription" && o.subscription) {
        const sub = await stripe(ps.stripeKey, "GET", "subscriptions/" + o.subscription);
        if (!sub.metadata || !sub.metadata.slug) sub.metadata = { slug: o.client_reference_id };
        await applySub(sub);
      } else if (/^customer\.subscription\./.test(ev.type)) {
        await applySub(o);
      } else if ((ev.type === "invoice.payment_failed" || ev.type === "invoice.paid") && (o.subscription || (o.parent && o.parent.subscription_details && o.parent.subscription_details.subscription))) {
        await applySub(await stripe(ps.stripeKey, "GET", "subscriptions/" + (o.subscription || o.parent.subscription_details.subscription)));
      }
    } catch (e) { return json({ error: "stripe", detail: String(e.message).slice(0, 200) }, 500); }
    return json({ received: true });
  }

  /* ---- la clienta, con su sesión ---- */
  if (route === "me" || route === "billing/checkout" || route === "billing/portal") {
    const t = await sessionTenant(req); if (!t) return json({ error: "auth" }, 401);
    if (route === "me" && m === "GET") return json(meOut(t, ps, url.origin));
    if (route === "me" && m === "PUT") {
      const b = await req.json().catch(() => ({}));
      if (b.seeded === true) t.seeded = true;
      if (b.name) t.name = clip(b.name, 60);
      if (b.password){ if (String(b.password).length < 8) return json({ error: "short" }, 400); if ((await hashPw(String(b.current || ""), t.salt)) !== t.ph) return json({ error: "login" }, 401); t.salt = rnd(16); t.ph = await hashPw(String(b.password), t.salt); }
      await saveTenant(t); return json(meOut(t, ps, url.origin));
    }
    if (!ps.stripeKey) return json({ error: "nobilling" }, 409);
    const back = url.origin + "/panel.html#plan";
    if (route === "billing/checkout" && m === "POST") {
      const p = { mode: "subscription", client_reference_id: t.slug, success_url: back + "-ok", cancel_url: back, allow_promotion_codes: "true",
        line_items: { 0: { quantity: 1, price_data: { currency: "usd", unit_amount: Math.round(PRICE(ps) * 100), recurring: { interval: "month" }, product_data: { name: (ps.name || "PageBloom") + " · plan mensual" } } } },
        subscription_data: { metadata: { slug: t.slug } } };
      if (t.customer) p.customer = t.customer; else p.customer_email = t.email;
      if (t.trialEnds && t.trialEnds - Date.now() > 2 * DAY) p.subscription_data.trial_end = Math.floor(t.trialEnds / 1000);
      try { const s = await stripe(ps.stripeKey, "POST", "checkout/sessions", p); return json({ url: s.url }); }
      catch (e) { return json({ error: "stripe", detail: String(e.message).slice(0, 200) }, 502); }
    }
    if (route === "billing/portal" && m === "POST") {
      if (!t.customer) return json({ error: "nocustomer" }, 409);
      try { const s = await stripe(ps.stripeKey, "POST", "billing_portal/sessions", { customer: t.customer, return_url: back }); return json({ url: s.url }); }
      catch (e) { return json({ error: "stripe", detail: String(e.message).slice(0, 200) }, 502); }
    }
  }

  /* ---- tu sección «Plataforma» (solo tú) ---- */
  if (/^platform\//.test(route)) {
    if (!(await ctx.owner())) return json({ error: "auth" }, 401);
    if (route === "platform/settings" && m === "GET") return json({ name: ps.name || "PageBloom", price: PRICE(ps), trialDays: TRIAL(ps), closed: !!ps.closed, domain: ps.domain || "", stripe: ps.stripeKey ? ps.stripeKey.slice(0, 8) + "…" + ps.stripeKey.slice(-4) : "", webhook: !!ps.webhookSecret, webhookUrl: url.origin + "/api/stripe-webhook", signupUrl: url.origin + "/registro" });
    if (route === "platform/settings" && m === "PUT") {
      const b = await req.json().catch(() => ({})), n = { ...ps };
      if (b.name != null) n.name = clip(b.name, 40) || "PageBloom";
      if (b.price != null) { const p = Number(b.price); if (!(p >= 1 && p <= 999)) return json({ error: "price" }, 400); n.price = Math.round(p * 100) / 100; }
      if (b.trialDays != null) n.trialDays = Math.max(0, Math.min(60, Math.round(Number(b.trialDays) || 0)));
      if (b.closed != null) n.closed = !!b.closed;
      if (b.domain != null) { const dm = String(b.domain).trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, ""); if (dm && !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(dm)) return json({ error: "domain" }, 400); n.domain = dm; }
      if (b.stripeKey) {
        const k = String(b.stripeKey).trim();
        if (!/^(sk|rk)_(live|test)_[A-Za-z0-9]{10,}$/.test(k)) return json({ error: "stripekey" }, 400);
        try { await stripe(k, "GET", "balance"); } catch (e) { return json({ error: "stripekey", detail: String(e.message).slice(0, 200) }, 400); }
        n.stripeKey = k;
      }
      if (b.webhookSecret) { const w = String(b.webhookSecret).trim(); if (!/^whsec_[A-Za-z0-9]{10,}$/.test(w)) return json({ error: "whsec" }, 400); n.webhookSecret = w; }
      await platform().setJSON("settings", n);
      return json({ ok: true });
    }
    if (route === "platform/tenants" && m === "GET") {
      const all = await listTenants(), now = Date.now();
      const rows = all.map((t) => ({ slug: t.slug, name: t.name, email: t.email, at: t.at, plan: planState(t, now), subStatus: t.subStatus || "", comp: !!t.comp, paused: !!t.paused, trialEnds: t.trialEnds, url: publicUrl(url.origin, t.slug, ps) })).sort((a, b) => b.at - a.at);
      const paying = rows.filter((r) => r.plan.state === "active" || r.plan.state === "grace").length;
      return json({ rows, stats: { total: rows.length, trial: rows.filter((r) => r.plan.state === "trial").length, paying, card: rows.filter((r) => r.plan.state === "trial" && r.plan.paid).length, comp: rows.filter((r) => r.comp).length, off: rows.filter((r) => !r.plan.ok).length, mrr: Math.round(paying * PRICE(ps) * 100) / 100 } });
    }
    const mt = route.match(/^platform\/tenant\/([a-z0-9-]+)$/);
    if (mt && m === "POST") {
      const t = await getTenant(mt[1]); if (!t) return json({ error: "notfound" }, 404);
      const b = await req.json().catch(() => ({}));
      if (b.action === "extend") t.trialEnds = Math.max(Date.now(), t.trialEnds || 0) + Math.max(1, Math.min(90, Number(b.days) || 14)) * DAY;
      else if (b.action === "comp") t.comp = true;
      else if (b.action === "uncomp") t.comp = false;
      else if (b.action === "pause") t.paused = true;
      else if (b.action === "resume") t.paused = false;
      else if (b.action === "delete") {
        if (b.confirm !== t.slug) return json({ error: "confirm" }, 400);
        for (const n of ["panel", "leads", "site", "stats", "chats", "polls", "unsub", "aijobs", "asesor-jobs", "asesor-reports"]) {
          try { const st = getStore({ name: "t-" + t.slug + "-" + n, consistency: "strong" }), { blobs } = await st.list(); for (const x of blobs) await st.delete(x.key); } catch (_) {}
        }
        await platform().delete("e:" + t.email); await platform().delete("t:" + t.slug);
        return json({ ok: true, deleted: true });
      } else return json({ error: "bad" }, 400);
      await saveTenant(t);
      return json({ ok: true, plan: planState(t) });
    }
    return json({ error: "notfound" }, 404);
  }
  return null;
}
