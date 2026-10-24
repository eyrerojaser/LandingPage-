// API de tu panel: contraseña, páginas, fotos y suscriptores.
import { getStore } from "@netlify/blobs";

const store = (name) => getStore({ name, consistency: "strong" });
const json = (o, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const enc = new TextEncoder();
async function sha(s) {
  const b = await crypto.subtle.digest("SHA-256", enc.encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
const envPass = () => (globalThis.Netlify && Netlify.env.get("PANEL_PASSWORD")) || "";
async function hasPassword() {
  if (envPass()) return true;
  return !!(await store("panel").get("auth", { type: "json" }));
}
async function checkPass(req) {
  const p = req.headers.get("x-panel-pass") || "";
  if (!p) return false;
  if (envPass()) return p === envPass();
  const rec = await store("panel").get("auth", { type: "json" });
  if (!rec) return false;
  return (await sha(rec.salt + p)) === rec.hash;
}
async function savePassword(password) {
  const salt = crypto.randomUUID();
  await store("panel").setJSON("auth", { salt, hash: await sha(salt + password) });
}

/* ---------- ajustes, IA y correos ---------- */
async function getSettings() {
  const s = (await store("panel").get("settings", { type: "json" })) || {};
  if (!s.secret) { s.secret = crypto.randomUUID(); await store("panel").setJSON("settings", s); }
  return s;
}
const escH = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
async function unsubToken(secret, email) { return (await sha(secret + "|" + email)).slice(0, 24); }
function mailHtml(body, o) {
  const paras = String(body || "").split(/\n{2,}/).map((p) => {
    if (p.includes("{pdf}") && o.pdf) return '<p style="margin:22px 0;text-align:center"><a href="' + escH(o.pdf) + '" style="background:#D8A2B4;color:#1A1215;text-decoration:none;padding:14px 26px;border-radius:10px;font-weight:600;display:inline-block">' + escH(o.pdfLabel || "Descargar el PDF") + '</a></p>';
    return '<p style="margin:0 0 14px">' + escH(p).replace(/\n/g, "<br>") + "</p>";
  }).join("");
  return '<!doctype html><html><body style="margin:0;background:#F6F0F2;padding:24px 12px;font-family:Helvetica,Arial,sans-serif;color:#2A1E23;font-size:16px;line-height:1.55">' +
    '<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden">' +
    '<div style="background:#0D0B0C;color:#F4D3DE;padding:18px 26px;font-family:Georgia,serif;font-size:20px">' + escH(o.brand || "") + "</div>" +
    '<div style="padding:26px">' + paras + "</div></div>" +
    '<p style="max-width:560px;margin:14px auto 0;text-align:center;font-size:12px;color:#8A7894">' + escH(o.footer || "Recibes este correo porque te registraste en mi página.") +
    ' <a href="' + o.unsub + '" style="color:#8A7894">Darme de baja</a></p></body></html>';
}
async function brevoSend(s, payload) {
  const r = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": s.brevoKey, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(Object.assign({ sender: { name: s.senderName || s.senderEmail, email: s.senderEmail } }, payload)),
  });
  if (!r.ok) { const e = new Error("brevo " + r.status + " " + (await r.text()).slice(0, 300)); e.code = "brevo"; e.http = r.status; throw e; }
  return r.json().catch(() => ({}));
}
async function askClaude(s, system, prompt, maxTokens) {
  const models = ["claude-haiku-5-5", "claude-sonnet-5-5"];
  let last;
  for (const model of models) {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": s.anthropicKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model, max_tokens: maxTokens || 1500, system, messages: [{ role: "user", content: prompt }] }),
    });
    if (r.ok) { const d = await r.json(); return (d.content || []).map((c) => c.text || "").join(""); }
    last = r.status + " " + (await r.text()).slice(0, 300);
    if (r.status !== 404 && r.status !== 400) break;
  }
  const e = new Error("ai " + last); e.code = "ai"; throw e;
}
function parseJSON(text) {
  const m = String(text).match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  return JSON.parse(m ? m[0] : text);
}
const AI_SYSTEM = "Eres la redactora de marketing de una emprendedora que vende productos digitales (planners, guías, plantillas) a mujeres. Escribes con calidez, claridad y frases cortas, sin exagerar ni usar clichés. Respondes SOLO con JSON válido, sin explicaciones ni markdown.";
const dayKey = (t) => new Date(t).toISOString().slice(0, 10);

const clip = (v, n = 120) => String(v == null ? "" : v).replace(/[\u0000-\u001f]/g, " ").trim().slice(0, n);
const validFile = (n) => /^[a-z0-9][a-z0-9-]{0,60}\.html$/.test(n) && n !== "panel.html" && n !== "forms.html";

export default async (req) => {
  const url = new URL(req.url);
  const route = url.pathname.replace(/^\/api\/?/, "").replace(/\/+$/, "");
  const m = req.method;
  try {
    /* ---- público ---- */
    if (route === "status" && m === "GET") return json({ setup: await hasPassword() });

    if (route === "setup" && m === "POST") {
      if (await hasPassword()) return json({ error: "exists" }, 409);
      const { password } = await req.json().catch(() => ({}));
      if (!password || String(password).length < 6) return json({ error: "short" }, 400);
      await savePassword(String(password));
      return json({ ok: true });
    }

    if (route === "lead" && m === "POST") {
      const b = await req.json().catch(() => ({}));
      if (b.bot) return json({ ok: true });
      const email = clip(b.email, 200).toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "email" }, 400);
      const lead = { nombre: clip(b.nombre), apellido: clip(b.apellido), email, pagina: clip(b.pagina, 80), at: Date.now() };
      await store("leads").setJSON("l-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8), lead);
      try {
        const s = await getSettings();
        if (s.brevoKey && s.senderEmail && s.welcome && s.welcome.on) {
          const pages = ((await store("panel").get("pages", { type: "json" })) || {}).pages || [];
          const pg = pages.find((x) => x.data && x.data.fileName === lead.pagina);
          const d = (pg && pg.data) || {};
          const origin = url.origin;
          const pdf = d.pdfUrl ? (/^https?:/.test(d.pdfUrl) ? d.pdfUrl : origin + d.pdfUrl) : "";
          const unsub = origin + "/api/unsub?e=" + encodeURIComponent(email) + "&t=" + (await unsubToken(s.secret, email));
          const fill = (x) => String(x || "").replace(/\{nombre\}/g, lead.nombre || "");
          await brevoSend(s, {
            to: [{ email, name: (lead.nombre + " " + lead.apellido).trim() || email }],
            subject: fill(s.welcome.subject) || "¡Aquí tienes tu regalo!",
            htmlContent: mailHtml(fill(s.welcome.body), { pdf, pdfLabel: d.lang === "en" ? "Download the PDF" : "Descargar el PDF", brand: s.senderName, unsub, footer: d.lang === "en" ? "You're receiving this because you signed up on my page." : "" }),
          });
        }
      } catch (e) { /* el registro se guarda aunque falle el correo */ }
      return json({ ok: true });
    }

    if (route === "track" && m === "POST") {
      const b = await req.json().catch(() => ({}));
      const ua = req.headers.get("user-agent") || "";
      if (/bot|crawl|spider|preview|facebookexternalhit|pinterest\/0|slurp|headless/i.test(ua)) return json({ ok: true });
      const p = clip(b.p, 80), e = ["view", "click", "dl"].includes(b.e) ? b.e : "";
      if (!p || !e) return json({ ok: true });
      const st = store("stats"), k = "d-" + dayKey(Date.now());
      const d = (await st.get(k, { type: "json" })) || {};
      d[p] = d[p] || { view: 0, click: 0, dl: 0 };
      d[p][e] = (d[p][e] || 0) + 1;
      await st.setJSON(k, d);
      return json({ ok: true });
    }

    if (route === "unsub" && m === "GET") {
      const email = clip(url.searchParams.get("e"), 200).toLowerCase(), tk = url.searchParams.get("t") || "";
      const s = await getSettings();
      const okTk = email && tk === (await unsubToken(s.secret, email));
      if (okTk) await store("unsub").setJSON(email.replace(/[^a-z0-9@._+-]/g, "_"), { email, at: Date.now() });
      return new Response('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#0D0B0C;color:#fff;font-family:Georgia,serif;text-align:center;padding:24px"><div><h1 style="font-weight:400">' + (okTk ? "Listo, ya no recibirás más correos." : "Este enlace no es válido.") + '</h1><p style="color:#D8CCD1">' + (okTk ? "Gracias por haber estado aquí. 🤍" : "") + "</p></div></body>", { headers: { "content-type": "text/html; charset=utf-8" } });
    }

    /* ---- solo con tu contraseña ---- */
    if (!(await checkPass(req))) return json({ error: "auth" }, 401);

    if (route === "login") return json({ ok: true });

    if (route === "password" && m === "POST") {
      if (envPass()) return json({ error: "env" }, 409);
      const { password } = await req.json().catch(() => ({}));
      if (!password || String(password).length < 6) return json({ error: "short" }, 400);
      await savePassword(String(password));
      return json({ ok: true });
    }

    if (route === "settings" && m === "GET") {
      const s = await getSettings();
      return json({ ai: !!s.anthropicKey, mail: !!(s.brevoKey && s.senderEmail), senderEmail: s.senderEmail || "", senderName: s.senderName || "", welcome: s.welcome || { on: false, subject: "", body: "" } });
    }

    if (route === "settings" && m === "PUT") {
      const b = await req.json().catch(() => ({}));
      const s = await getSettings();
      if (typeof b.anthropicKey === "string") s.anthropicKey = b.anthropicKey.trim();
      if (typeof b.brevoKey === "string") s.brevoKey = b.brevoKey.trim();
      if (typeof b.senderEmail === "string") s.senderEmail = clip(b.senderEmail, 200);
      if (typeof b.senderName === "string") s.senderName = clip(b.senderName, 80);
      if (b.welcome && typeof b.welcome === "object") s.welcome = { on: !!b.welcome.on, subject: clip(b.welcome.subject, 200), body: String(b.welcome.body || "").slice(0, 5000) };
      await store("panel").setJSON("settings", s);
      return json({ ok: true });
    }

    if (route === "ai" && m === "POST") {
      const s = await getSettings();
      if (!s.anthropicKey) return json({ error: "noai" }, 409);
      const b = await req.json().catch(() => ({}));
      const prompt = String(b.prompt || "").slice(0, 12000);
      if (!prompt) return json({ error: "bad" }, 400);
      try {
        const text = await askClaude(s, AI_SYSTEM, prompt, Math.min(Number(b.max) || 1500, 3000));
        return json({ result: parseJSON(text) });
      } catch (e) {
        return json({ error: e.code === "ai" ? "aifail" : "aiparse", message: String(e.message).slice(0, 300) }, 502);
      }
    }

    if (route === "stats" && m === "GET") {
      const days = Math.min(Math.max(Number(url.searchParams.get("days")) || 30, 1), 90);
      const st = store("stats"), out = [];
      for (let i = days - 1; i >= 0; i--) {
        const k = dayKey(Date.now() - i * 864e5);
        out.push({ day: k, pages: (await st.get("d-" + k, { type: "json" })) || {} });
      }
      const ls = store("leads"), { blobs } = await ls.list(), since = Date.now() - days * 864e5;
      const leads = await Promise.all(blobs.map((b) => ls.get(b.key, { type: "json" })));
      for (const l of leads) {
        if (!l || l.at < since) continue;
        const d = out.find((x) => x.day === dayKey(l.at)); if (!d) continue;
        const p = l.pagina || "?";
        d.pages[p] = d.pages[p] || { view: 0, click: 0, dl: 0 };
        d.pages[p].lead = (d.pages[p].lead || 0) + 1;
      }
      return json({ days: out });
    }

    if (route === "plan" && m === "GET") return json((await store("panel").get("plan", { type: "json" })) || { items: [] });
    if (route === "plan" && m === "PUT") {
      const b = await req.json().catch(() => ({}));
      if (!Array.isArray(b.items)) return json({ error: "bad" }, 400);
      await store("panel").setJSON("plan", { items: b.items.slice(0, 2000) });
      return json({ ok: true });
    }

    if (route === "mails" && m === "GET") return json((await store("panel").get("mails", { type: "json" })) || { list: [] });

    if (route === "mail-send" && m === "POST") {
      const s = await getSettings();
      if (!s.brevoKey || !s.senderEmail) return json({ error: "nomail" }, 409);
      const b = await req.json().catch(() => ({}));
      const subject = clip(b.subject, 200), body = String(b.body || "").slice(0, 20000);
      if (!subject || !body) return json({ error: "bad" }, 400);
      const origin = url.origin;
      const mk = async (email) => origin + "/api/unsub?e=" + encodeURIComponent(email) + "&t=" + (await unsubToken(s.secret, email));
      if (b.test) {
        const to = s.senderEmail;
        await brevoSend(s, { to: [{ email: to }], subject: "[Prueba] " + subject, htmlContent: mailHtml(body.replace(/\{nombre\}/g, "María"), { brand: s.senderName, unsub: await mk(to) }) });
        return json({ ok: true, sent: 1 });
      }
      const ls = store("leads"), { blobs } = await ls.list();
      const all = (await Promise.all(blobs.map((x) => ls.get(x.key, { type: "json" })))).filter(Boolean);
      const us = store("unsub"), unsubbed = new Set((await us.list()).blobs.map((x) => x.key));
      const seen = new Map();
      for (const l of all) { const e = (l.email || "").toLowerCase(); if (e && !seen.has(e) && !unsubbed.has(e.replace(/[^a-z0-9@._+-]/g, "_"))) seen.set(e, l); }
      const list = [...seen.values()];
      if (!list.length) return json({ error: "nobody" }, 400);
      if (list.length > 290) return json({ error: "toomany", count: list.length }, 400);
      const html = mailHtml(body.replace(/\{nombre\}/g, "{{params.nombre}}"), { brand: s.senderName, unsub: "{{params.unsub}}" });
      for (let i = 0; i < list.length; i += 90) {
        const chunk = list.slice(i, i + 90);
        const versions = await Promise.all(chunk.map(async (l) => ({ to: [{ email: l.email, name: ((l.nombre || "") + " " + (l.apellido || "")).trim() || l.email }], params: { nombre: l.nombre || "", unsub: await mk(l.email) } })));
        await brevoSend(s, { subject, htmlContent: html, messageVersions: versions });
      }
      const hist = (await store("panel").get("mails", { type: "json" })) || { list: [] };
      hist.list.unshift({ at: Date.now(), subject, count: list.length });
      hist.list = hist.list.slice(0, 100);
      await store("panel").setJSON("mails", hist);
      return json({ ok: true, sent: list.length });
    }

    if (route === "draft" && m === "GET") {
      const d = await store("panel").get("draft", { type: "json" });
      if (d) return json(d);
      const pub = (await store("panel").get("pages", { type: "json" })) || { pages: [] };
      return json({ pages: pub.pages || [], deleted: [], dirty: false, savedAt: 0 });
    }

    if (route === "draft" && m === "PUT") {
      const b = await req.json().catch(() => null);
      if (!b || !Array.isArray(b.pages)) return json({ error: "bad" }, 400);
      const s = JSON.stringify({ pages: b.pages, deleted: Array.isArray(b.deleted) ? b.deleted : [], dirty: !!b.dirty, savedAt: Number(b.savedAt) || Date.now() });
      if (s.length > 4_000_000) return json({ error: "size" }, 413);
      await store("panel").set("draft", s);
      return json({ ok: true });
    }

    if (route === "pages" && m === "GET") {
      return json((await store("panel").get("pages", { type: "json" })) || { pages: [] });
    }

    if (route === "pages" && m === "PUT") {
      const body = await req.json();
      const html = body && typeof body.html === "object" ? body.html : {};
      const site = store("site");
      const names = Object.keys(html).filter(validFile);
      for (const n of names) await site.set(n, String(html[n]));
      const { blobs } = await site.list();
      for (const b of blobs) if (!names.includes(b.key)) await site.delete(b.key);
      await store("panel").setJSON("pages", { updated: new Date().toISOString(), pages: Array.isArray(body.pages) ? body.pages : [] });
      return json({ ok: true, published: names });
    }

    if (route === "upload" && m === "POST") {
      const type = (req.headers.get("content-type") || "").split(";")[0].trim();
      if (!/^image\/(jpeg|png|webp|gif)$/.test(type)) return json({ error: "type" }, 400);
      const buf = await req.arrayBuffer();
      if (!buf.byteLength || buf.byteLength > 5_000_000) return json({ error: "size" }, 413);
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      await store("img").set(id, buf, { metadata: { type } });
      return json({ path: "/img/" + id });
    }

    if (route === "pdf-part" && m === "POST") {
      const id = url.searchParams.get("id") || "", part = Number(url.searchParams.get("part"));
      if (!/^[a-z0-9-]{1,90}$/.test(id) || !Number.isInteger(part) || part < 0 || part > 9) return json({ error: "bad" }, 400);
      const buf = await req.arrayBuffer();
      if (!buf.byteLength || buf.byteLength > 5_000_000) return json({ error: "size" }, 413);
      await store("pdfparts").set(id + "-" + part, buf);
      return json({ ok: true });
    }

    if (route === "pdf-done" && m === "POST") {
      const { id, parts, kind } = await req.json().catch(() => ({}));
      if (!/^[a-z0-9-]{1,90}$/.test(id || "") || !Number.isInteger(parts) || parts < 1 || parts > 10) return json({ error: "bad" }, 400);
      const ps = store("pdfparts"), chunks = [];
      for (let i = 0; i < parts; i++) {
        const b = await ps.get(id + "-" + i, { type: "arrayBuffer" });
        if (!b) return json({ error: "missing" }, 400);
        chunks.push(new Uint8Array(b));
      }
      const size = chunks.reduce((s, c) => s + c.length, 0);
      const all = new Uint8Array(size); let o = 0;
      for (const c of chunks) { all.set(c, o); o += c.length; }
      if (kind === "video") {
        const brand = new TextDecoder().decode(all.slice(4, 12));
        if (!/^ftyp/.test(brand)) return json({ error: "notvideo" }, 400);
        const type = /qt/.test(brand) ? "video/quicktime" : "video/mp4";
        await store("video").set(id, all.buffer, { metadata: { type, size } });
        for (let i = 0; i < parts; i++) await ps.delete(id + "-" + i);
        return json({ path: "/video/" + id + (type === "video/quicktime" ? ".mov" : ".mp4"), size });
      }
      const head = new TextDecoder().decode(all.slice(0, 5));
      if (head !== "%PDF-") return json({ error: "notpdf" }, 400);
      await store("pdf").set(id, all.buffer, { metadata: { type: "application/pdf", size } });
      for (let i = 0; i < parts; i++) await ps.delete(id + "-" + i);
      return json({ path: "/pdf/" + id + ".pdf", size });
    }

    if (route === "leads" && m === "GET") {
      const s = store("leads");
      const { blobs } = await s.list();
      const leads = await Promise.all(blobs.map(async (b) => ({ key: b.key, ...((await s.get(b.key, { type: "json" })) || {}) })));
      leads.sort((a, b) => (b.at || 0) - (a.at || 0));
      return json({ leads });
    }

    if (route.startsWith("leads/") && m === "DELETE") {
      await store("leads").delete(decodeURIComponent(route.slice(6)));
      return json({ ok: true });
    }

    return json({ error: "not_found" }, 404);
  } catch (e) {
    if (e && e.code === "brevo") return json({ error: "brevo", status: e.http, message: String(e.message).slice(0, 300) }, 502);
    return json({ error: "server", message: String((e && e.message) || e) }, 500);
  }
};

export const config = { path: "/api/*" };
