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
    if (p.includes("{pdf}") && !o.pdf) { p = p.replace(/\{pdf\}/g, "").trim(); if (!p) return ""; }
    if (p.includes("{pdf}") && o.pdf) return '<p style="margin:22px 0;text-align:center"><a href="' + escH(o.pdf) + '" style="background:#D8A2B4;color:#1A1215;text-decoration:none;padding:14px 26px;border-radius:10px;font-weight:600;display:inline-block">' + escH(o.pdfLabel || "Descargar el PDF") + '</a></p>';
    return '<p style="margin:0 0 14px">' + escH(p).replace(/\n/g, "<br>") + "</p>";
  }).join("");
  return '<!doctype html><html><body style="margin:0;background:#F6F0F2;padding:24px 12px;font-family:Helvetica,Arial,sans-serif;color:#2A1E23;font-size:16px;line-height:1.55">' +
    '<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden">' +
    '<div style="background:#0D0B0C;color:#F4D3DE;padding:18px 26px;font-family:Georgia,serif;font-size:20px">' + escH(o.brand || "") + "</div>" +
    '<div style="padding:26px">' + paras + "</div></div>" +
    '<p style="max-width:560px;margin:14px auto 0;text-align:center;font-size:12px;color:#8A7894">' + (o.address ? escH(o.brand ? o.brand + " · " : "") + escH(o.address) + "<br>" : "") + escH(o.footer || "Recibes este correo porque te registraste en mi página.") +
    ' <a href="' + o.unsub + '" style="color:#8A7894">' + (o.footer && /receiving/.test(o.footer) ? "Unsubscribe" : "Darme de baja") + '</a></p></body></html>';
}
async function backup(kind, pages) {
  try {
    const ps = store("panel"), at = Date.now(), key = "bak-" + kind + "-" + at;
    const names = pages.map((p) => (p && p.data && (p.data.name || p.data.fileName)) || "").filter(Boolean).slice(0, 30);
    await ps.set(key, JSON.stringify({ pages }), { metadata: { at, kind, count: pages.length, names } });
    const { blobs } = await ps.list({ prefix: "bak-" });
    const keys = blobs.map((b) => b.key).sort((x, y) => Number(y.split("-").pop()) - Number(x.split("-").pop()));
    for (const old of keys.slice(25)) await ps.delete(old);
  } catch (_) {}
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
async function askClaude(s, system, prompt, maxTokens, best) {
  // Para guiones y contenido («best») usamos primero el modelo que mejor escribe.
  const models = best ? ["claude-sonnet-5-5", "claude-haiku-5-5"] : ["claude-haiku-5-5", "claude-sonnet-5-5"];
  let last;
  for (const model of models) {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": s.anthropicKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model, max_tokens: maxTokens || 1500, system, messages: [{ role: "user", content: prompt }] }),
    });
    if (r.ok) { const d = await r.json(); return (d.content || []).map((c) => c.text || "").join(""); }
    const txt = (await r.text()).slice(0, 400);
    last = { status: r.status, txt };
    if (r.status !== 404 && !(r.status === 400 && /model/i.test(txt))) break;
  }
  const e = new Error("ai " + last.status + " " + last.txt); e.code = aiReason(last.status, last.txt); throw e;
}
function aiReason(status, txt) {
  if (status === 401 || status === 403) return "aikey";
  if (/credit balance|billing|purchase credits/i.test(txt)) return "aicredit";
  if (status === 429 || status === 529 || status >= 500) return "aibusy";
  return "aifail";
}
function parseJSON(text) {
  // La IA a veces escribe los párrafos (por ejemplo de un correo) con saltos de línea de verdad dentro del texto,
  // o envuelve la respuesta en ```json … ```. Eso no es JSON válido: aquí lo arreglamos antes de leerlo.
  let t = String(text).trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const a = t.search(/[{[]/), z = Math.max(t.lastIndexOf("}"), t.lastIndexOf("]"));
  if (a >= 0 && z > a) t = t.slice(a, z + 1);
  try { return JSON.parse(t); } catch (_) {}
  let out = "", inStr = false, esc = false;
  for (const ch of t) {
    if (!inStr) { if (ch === '"') inStr = true; out += ch; continue; }
    if (esc) { esc = false; out += ch; continue; }
    if (ch === "\\") { esc = true; out += ch; continue; }
    if (ch === '"') { inStr = false; out += ch; continue; }
    if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (ch < " ") out += "\\u" + ch.charCodeAt(0).toString(16).padStart(4, "0");
    else out += ch;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
}
const AI_STRATEGY = "Eres una estratega senior de marketing y ventas para emprendedoras que venden productos digitales. Trabajas SOLO con los datos reales que te dan (perfil, productos, precios, páginas, números). Reglas: 1) Nada genérico: cada idea nombra el producto, la clienta y el canal concretos. 2) Cada recomendación dice exactamente qué hacer, dónde y cuándo. 3) Usa los números reales y haz las cuentas; si falta un dato, haz una suposición conservadora y dila. 4) Prohibido: 'crea contenido de valor', 'conoce a tu audiencia', 'sé constante', 'aporta valor' y frases parecidas. 5) Escribe claro, cálido y directo, sin relleno. Respondes SOLO con JSON válido, sin markdown.";
const AI_SYSTEM = "Eres la redactora de marketing de una emprendedora que vende productos digitales (planners, guías, plantillas) a mujeres. Escribes con calidez, claridad y frases cortas, sin exagerar ni usar clichés. Respondes SOLO con JSON válido, sin explicaciones ni markdown.";
const AI_COACH = "Eres la directora creativa y coach de contenido de una emprendedora que vende productos digitales a mujeres. Ella muchas veces no sabe qué decir: tú le das el contenido listo para grabar o publicar. Reglas: 1) Escribe como habla ella: cercana, cálida, frases cortas, en primera persona, nada de clichés de marketing. 2) Todo concreto y usable tal cual: palabras exactas que decir, qué mostrar en pantalla, cuánto dura cada parte. 3) Conecta el tema con sus productos y páginas reales cuando tenga sentido, sin sonar a anuncio. 4) Recomendaciones prácticas y específicas (formato, hora, cómo grabarlo con el teléfono), nunca genéricas. 5) Si te da un idioma, escribe en ese idioma. Respondes SOLO con JSON válido, sin markdown.";
const aiMode = (b) => (b.mode === "strategy" || b.mode === "coach" ? b.mode : "copy");
const aiSys = (mode) => (mode === "strategy" ? AI_STRATEGY : mode === "coach" ? AI_COACH : AI_SYSTEM);
const aiMax = (b) => Math.min(Number(b.max) || 1500, aiMode(b) === "copy" ? 4000 : 6000);
const aiPrompt = (b) => String(b.prompt || "").slice(0, aiMode(b) === "copy" ? 12000 : 24000);
const dayKey = (t) => new Date(t).toISOString().slice(0, 10);

const clip = (v, n = 120) => String(v == null ? "" : v).replace(/[\u0000-\u001f]/g, " ").trim().slice(0, n);
const validFile = (n) => /^[a-z0-9][a-z0-9-]{0,60}\.html$/.test(n) && n !== "panel.html" && n !== "forms.html";

export default async (req) => {
  const url = new URL(req.url);
  const route = url.pathname.replace(/^\/api\/?/, "").replace(/\/+$/, "");
  const m = req.method;
  // Las páginas descargadas y puestas en otra web también pueden enviar registros y visitas a tu panel.
  const cors = { "access-control-allow-origin": "*", "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "content-type" };
  if (m === "OPTIONS" && (route === "lead" || route === "track")) return new Response(null, { status: 204, headers: cors });
  if ((route === "lead" || route === "track") && m === "POST") {
    const res = await handle(req, url, route, m);
    const h = new Headers(res.headers); Object.entries(cors).forEach(([k, v]) => h.set(k, v));
    return new Response(res.body, { status: res.status, headers: h });
  }
  return handle(req, url, route, m);
};
/* Envía un correo a todas las suscriptoras (cada una en el idioma de la página donde se registró). */
async function sendToAll(s, origin, msg) {
  const { subject, body, subjectEn, bodyEn } = msg, hasEn = !!(subjectEn && bodyEn);
  const mk = async (email) => origin + "/api/unsub?e=" + encodeURIComponent(email) + "&t=" + (await unsubToken(s.secret, email));
      const pagesPub = ((await store("panel").get("pages", { type: "json" })) || {}).pages || [];
      const langOf = {}; for (const pg of pagesPub) if (pg.data && pg.data.fileName) langOf[pg.data.fileName] = pg.data.lang === "en" ? "en" : "es";
      const ls = store("leads"), { blobs } = await ls.list();
      const all = (await Promise.all(blobs.map((x) => ls.get(x.key, { type: "json" })))).filter(Boolean);
      const us = store("unsub"), unsubbed = new Set((await us.list()).blobs.map((x) => x.key));
      const seen = new Map();
      for (const l of all) { const e = (l.email || "").toLowerCase(); if (e && !seen.has(e) && !unsubbed.has(e.replace(/[^a-z0-9@._+-]/g, "_"))) seen.set(e, l); }
      const list = [...seen.values()];
      if (!list.length) return { error: "nobody" };
      if (list.length > 290) return { error: "toomany", count: list.length };
      const groups = { es: [], en: [] };
      for (const l of list) groups[hasEn && langOf[l.pagina] === "en" ? "en" : "es"].push(l);
      for (const lg of ["es", "en"]) {
        const ls2 = groups[lg]; if (!ls2.length) continue;
        const sub = lg === "en" ? subjectEn : subject, bd = lg === "en" ? bodyEn : body;
        const html = mailHtml(bd.replace(/\{nombre\}/g, "{{params.nombre}}"), { brand: s.senderName, address: s.address, unsub: "{{params.unsub}}", footer: lg === "en" ? "You're receiving this because you signed up on my page." : "" });
        for (let i = 0; i < ls2.length; i += 90) {
          const chunk = ls2.slice(i, i + 90);
          const versions = await Promise.all(chunk.map(async (l) => ({ to: [{ email: l.email, name: ((l.nombre || "") + " " + (l.apellido || "")).trim() || l.email }], params: { nombre: l.nombre || "", unsub: await mk(l.email) } })));
          await brevoSend(s, { subject: sub, htmlContent: html, messageVersions: versions });
        }
      }
      const hist = (await store("panel").get("mails", { type: "json" })) || { list: [] };
      hist.list.unshift({ at: Date.now(), subject, count: list.length });
      hist.list = hist.list.slice(0, 100);
      await store("panel").setJSON("mails", hist);
  return { sent: list.length };
}
/* Lo que está programado (correos) sale cuando llega su hora. Lo llama la función programada cada hora y también el panel al abrirse. */
async function runCron(origin) {
  const ob = (await store("panel").get("outbox", { type: "json" })) || { items: [] };
  const due = (ob.items || []).filter((x) => x.status === "queued" && x.sendAt <= Date.now());
  if (!due.length) return { ok: true, sent: 0 };
  // Un candado para que el mismo correo no salga dos veces si dos avisos llegan a la vez.
  const lock = await store("panel").get("cron-lock", { type: "json" }).catch(() => null);
  if (lock && Date.now() - lock.at < 120000) return { ok: true, busy: true };
  await store("panel").setJSON("cron-lock", { at: Date.now() });
  const s = await getSettings();
  for (const it of due) {
    it.status = "sending"; await store("panel").setJSON("outbox", ob);
    try {
      if (!s.brevoKey || !s.senderEmail) throw Object.assign(new Error("nomail"), { code: "nomail" });
      const r = await sendToAll(s, origin, it);
      if (r.error) { it.status = "error"; it.error = r.error; } else { it.status = "sent"; it.sent = r.sent; it.sentAt = Date.now(); }
    } catch (e) { it.status = "error"; it.error = e.code || "fail"; it.message = String(e.message).slice(0, 200); }
    await store("panel").setJSON("outbox", ob);
  }
  await store("panel").delete("cron-lock");
  return { ok: true, sent: due.length };
}
async function handle(req, url, route, m) {
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
          const en = d.lang === "en" && (s.welcome.subjectEn || s.welcome.bodyEn);
          const wSub = en ? s.welcome.subjectEn : s.welcome.subject, wBody = en ? s.welcome.bodyEn : s.welcome.body;
          await brevoSend(s, {
            to: [{ email, name: (lead.nombre + " " + lead.apellido).trim() || email }],
            subject: fill(wSub) || (d.lang === "en" ? "Here's your free gift!" : "¡Aquí tienes tu regalo!"),
            htmlContent: mailHtml(fill(wBody), { pdf, pdfLabel: d.lang === "en" ? "Download the PDF" : "Descargar el PDF", brand: s.senderName, address: s.address, unsub, footer: d.lang === "en" ? "You're receiving this because you signed up on my page." : "" }),
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

    if (route === "cron-tick" && m === "POST") {
      const s = await getSettings();
      if (!s.secret || req.headers.get("x-cron") !== s.secret) return json({ error: "auth" }, 401);
      return json(await runCron(url.origin));
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
      return json({ ai: !!s.anthropicKey, mail: !!(s.brevoKey && s.senderEmail), senderEmail: s.senderEmail || "", senderName: s.senderName || "", address: s.address || "", welcome: s.welcome || { on: false, subject: "", body: "" }, profile: s.profile || {} });
    }

    if (route === "settings" && m === "PUT") {
      const b = await req.json().catch(() => ({}));
      const s = await getSettings();
      if (typeof b.anthropicKey === "string") s.anthropicKey = b.anthropicKey.trim();
      if (typeof b.brevoKey === "string") s.brevoKey = b.brevoKey.trim();
      if (typeof b.senderEmail === "string") s.senderEmail = clip(b.senderEmail, 200);
      if (typeof b.senderName === "string") s.senderName = clip(b.senderName, 80);
      if (typeof b.address === "string") s.address = clip(b.address, 200);
      if (b.profile && typeof b.profile === "object") { const pr = {}; for (const k of Object.keys(b.profile).slice(0, 20)) pr[clip(k, 40)] = String(b.profile[k] || "").slice(0, 1500); s.profile = pr; }
      if (b.welcome && typeof b.welcome === "object") s.welcome = { on: !!b.welcome.on, subject: clip(b.welcome.subject, 200), body: String(b.welcome.body || "").slice(0, 5000), subjectEn: clip(b.welcome.subjectEn, 200), bodyEn: String(b.welcome.bodyEn || "").slice(0, 5000) };
      await store("panel").setJSON("settings", s);
      return json({ ok: true });
    }

    if (route === "ai" && m === "POST") {
      const s = await getSettings();
      if (!s.anthropicKey) return json({ error: "noai" }, 409);
      const b = await req.json().catch(() => ({}));
      const prompt = aiPrompt(b);
      if (!prompt) return json({ error: "bad" }, 400);
      try {
        const text = await askClaude(s, aiSys(aiMode(b)), prompt, aiMax(b), false);
        return json({ result: parseJSON(text) });
      } catch (e) {
        return json({ error: /^ai/.test(e.code || "") ? e.code : "aiparse", message: String(e.message).slice(0, 300) }, 502);
      }
    }
    /* La IA también puede trabajar «en segundo plano» para respuestas largas: el panel crea un trabajo y pregunta hasta que esté listo. */
    if (route === "ai-start" && m === "POST") {
      const s = await getSettings();
      if (!s.anthropicKey) return json({ error: "noai" }, 409);
      const b = await req.json().catch(() => ({}));
      const prompt = aiPrompt(b);
      if (!prompt) return json({ error: "bad" }, 400);
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
      await store("aijobs").setJSON(id, { status: "pending", prompt, max: aiMax(b), mode: aiMode(b), at: Date.now() });
      return json({ job: id });
    }
    if (route.startsWith("ai-job/") && m === "GET") {
      const id = route.slice(7); if (!/^[a-z0-9]{8,30}$/.test(id)) return json({ error: "bad" }, 400);
      const j = await store("aijobs").get(id, { type: "json" });
      if (!j) return json({ error: "notfound" }, 404);
      if (j.status === "done" || j.status === "error") await store("aijobs").delete(id);
      return json({ status: j.status, result: j.result, error: j.error, message: j.message });
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

    if (route === "notes" && m === "GET") return json((await store("panel").get("notes", { type: "json" })) || { items: [] });
    if (route === "notes" && m === "PUT") {
      const b = await req.json().catch(() => ({}));
      if (!Array.isArray(b.items)) return json({ error: "bad" }, 400);
      const s = JSON.stringify({ items: b.items.slice(0, 200) });
      if (s.length > 3_000_000) return json({ error: "size" }, 413);
      await store("panel").set("notes", s);
      return json({ ok: true });
    }

    /* ---- diseños del editor ---- */
    if (route === "designs" && m === "GET") return json((await store("panel").get("dsg-index", { type: "json" })) || { items: [] });
    if (route.startsWith("designs/")) {
      const id = route.slice(8), ps = store("panel");
      if (id !== "new" && !/^[a-z0-9]{4,40}$/.test(id)) return json({ error: "bad" }, 400);
      if (m === "GET") { const d = await ps.get("dsg-" + id, { type: "json" }); return d ? json({ doc: d }) : json({ error: "notfound" }, 404); }
      if (m === "PUT") {
        const b = await req.json().catch(() => ({}));
        if (!b.doc || !Array.isArray(b.doc.pages)) return json({ error: "bad" }, 400);
        const nid = id === "new" ? Date.now().toString(36) + Math.random().toString(36).slice(2, 6) : id;
        b.doc.id = nid;
        const s = JSON.stringify(b.doc);
        if (s.length > 2_500_000) return json({ error: "size" }, 413);
        await ps.set("dsg-" + nid, s);
        const idx = (await ps.get("dsg-index", { type: "json" })) || { items: [] };
        const thumb = typeof b.thumb === "string" && b.thumb.length < 150_000 && /^data:image\/jpeg;base64,/.test(b.thumb) ? b.thumb : "";
        idx.items = [{ id: nid, name: clip(b.name || "Diseño", 80), fmt: clip(b.fmt || "", 20), pages: Number(b.pages) || 1, updatedAt: Date.now(), thumb }].concat(idx.items.filter((x) => x.id !== nid)).slice(0, 300);
        await ps.set("dsg-index", JSON.stringify(idx));
        return json({ ok: true, id: nid });
      }
      if (m === "DELETE") {
        await ps.delete("dsg-" + id);
        const idx = (await ps.get("dsg-index", { type: "json" })) || { items: [] };
        idx.items = idx.items.filter((x) => x.id !== id);
        await ps.set("dsg-index", JSON.stringify(idx));
        return json({ ok: true });
      }
    }
    /* ---- mi biblioteca (stickers, colecciones y letras) ---- */
    if (route === "library" && m === "GET") return json((await store("panel").get("library", { type: "json" })) || { collections: [], items: [], fonts: [] });
    if (route === "library" && m === "PUT") {
      const b = await req.json().catch(() => ({}));
      const lib = { collections: Array.isArray(b.collections) ? b.collections.slice(0, 100) : [], items: Array.isArray(b.items) ? b.items.slice(0, 2000) : [], fonts: Array.isArray(b.fonts) ? b.fonts.slice(0, 60) : [] };
      const s = JSON.stringify(lib);
      if (s.length > 1_500_000) return json({ error: "size" }, 413);
      await store("panel").set("library", s);
      return json({ ok: true });
    }

    /* ---- páginas que están en tu web (con sus datos) ---- */
    if (route === "orphans" && m === "GET") {
      const site = store("site"), { blobs } = await site.list(), items = [];
      for (const b of blobs) {
        if (!/\.html$/.test(b.key) || /^(privacidad|privacy|index)\.html$/.test(b.key)) continue;
        const h = String((await site.get(b.key)) || ""), mm = h.match(/<script type="application\/json" id="lp-src">([\s\S]*?)<\/script>/);
        let data = null; if (mm) { try { data = JSON.parse(mm[1]); } catch (_) {} }
        const title = (h.match(/<title>([^<]*)<\/title>/) || [])[1] || "";
        items.push({ file: b.key, title, data });
      }
      return json({ items });
    }

    /* ---- copias de seguridad de tus páginas ---- */
    if (route === "backups" && m === "GET") {
      const ps = store("panel"), { blobs } = await ps.list({ prefix: "bak-" });
      const items = [];
      for (const bl of blobs) { const md = await ps.getMetadata(bl.key).catch(() => null); if (md && md.metadata) items.push({ key: bl.key, ...md.metadata }); }
      items.sort((x, y) => (y.at || 0) - (x.at || 0));
      return json({ items });
    }
    if (route.startsWith("backups/") && m === "GET") {
      const k = route.slice(8); if (!/^bak-[a-z]+-\d+$/.test(k)) return json({ error: "bad" }, 400);
      const d = await store("panel").get(k, { type: "json" }); return d ? json(d) : json({ error: "notfound" }, 404);
    }

    if (route === "mails" && m === "GET") return json((await store("panel").get("mails", { type: "json" })) || { list: [] });

    if (route === "mail-send" && m === "POST") {
      const s = await getSettings();
      if (!s.brevoKey || !s.senderEmail) return json({ error: "nomail" }, 409);
      const b = await req.json().catch(() => ({}));
      const subject = clip(b.subject, 200), body = String(b.body || "").slice(0, 20000);
      const subjectEn = clip(b.subjectEn, 200), bodyEn = String(b.bodyEn || "").slice(0, 20000);
      const hasEn = !!(subjectEn && bodyEn);
      if (!subject || !body) return json({ error: "bad" }, 400);
      const origin = url.origin;
      const mk = async (email) => origin + "/api/unsub?e=" + encodeURIComponent(email) + "&t=" + (await unsubToken(s.secret, email));
      if (b.test) {
        const to = s.senderEmail;
        await brevoSend(s, { to: [{ email: to }], subject: "[Prueba] " + subject, htmlContent: mailHtml(body.replace(/\{nombre\}/g, "María"), { brand: s.senderName, address: s.address, unsub: await mk(to) }) });
        if (hasEn) await brevoSend(s, { to: [{ email: to }], subject: "[Test] " + subjectEn, htmlContent: mailHtml(bodyEn.replace(/\{nombre\}/g, "Mary"), { brand: s.senderName, address: s.address, unsub: await mk(to), footer: "You're receiving this because you signed up on my page." }) });
        return json({ ok: true, sent: hasEn ? 2 : 1 });
      }
      const r = await sendToAll(s, origin, { subject, body, subjectEn, bodyEn });
      if (r.error) return json(r, 400);
      return json({ ok: true, sent: r.sent });
    }

    /* ---- correos programados ---- */
    if (route === "outbox" && m === "GET") return json((await store("panel").get("outbox", { type: "json" })) || { items: [] });
    if (route === "outbox" && m === "POST") {
      const s = await getSettings();
      if (!s.brevoKey || !s.senderEmail) return json({ error: "nomail" }, 409);
      const b = await req.json().catch(() => ({}));
      const it = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7), sendAt: Number(b.sendAt) || 0, subject: clip(b.subject, 200), body: String(b.body || "").slice(0, 20000), subjectEn: clip(b.subjectEn, 200), bodyEn: String(b.bodyEn || "").slice(0, 20000), status: "queued", at: Date.now() };
      if (!it.subject || !it.body || !it.sendAt) return json({ error: "bad" }, 400);
      const ob = (await store("panel").get("outbox", { type: "json" })) || { items: [] };
      ob.items = [it].concat(ob.items || []).slice(0, 200);
      await store("panel").setJSON("outbox", ob);
      return json({ ok: true, id: it.id });
    }
    if (route.startsWith("outbox/") && m === "DELETE") {
      const id = route.slice(7), ob = (await store("panel").get("outbox", { type: "json" })) || { items: [] };
      ob.items = (ob.items || []).filter((x) => !(x.id === id && x.status === "queued"));
      await store("panel").setJSON("outbox", ob);
      return json({ ok: true });
    }
    if (route === "cron" && m === "POST") return json(await runCron(url.origin));


    if (route === "draft" && m === "GET") {
      const d = await store("panel").get("draft", { type: "json" });
      if (d) return json(d);
      const pub = (await store("panel").get("pages", { type: "json" })) || { pages: [] };
      return json({ pages: pub.pages || [], deleted: [], dirty: false, savedAt: 0 });
    }

    if (route === "draft" && m === "PUT") {
      const b = await req.json().catch(() => null);
      if (!b || !Array.isArray(b.pages)) return json({ error: "bad" }, 400);
      const ps = store("panel");
      const prevDraft = await ps.get("draft", { type: "json" }).catch(() => null);
      // Páginas borradas a propósito (por id). Todo lo demás se conserva aunque un aparato no lo tenga.
      const tombs = new Set(((await ps.get("tombs", { type: "json" }).catch(() => null)) || []).slice(-2000));
      (Array.isArray(b.deletedIds) ? b.deletedIds : []).forEach((id) => tombs.add(String(id)));
      const byId = new Map(), order = [];
      b.pages.forEach((p) => { if (p && p.id && !byId.has(p.id)) { byId.set(p.id, p); order.push(p.id); } });
      ((prevDraft && prevDraft.pages) || []).forEach((p) => {
        if (!p || !p.id) return;
        const mine = byId.get(p.id);
        if (!mine) { byId.set(p.id, p); order.push(p.id); }
        else if ((p.updatedAt || 0) > (mine.updatedAt || 0)) byId.set(p.id, p);
      });
      const merged = order.filter((id) => !tombs.has(id)).map((id) => byId.get(id));
      if (prevDraft && Array.isArray(prevDraft.pages) && prevDraft.pages.length > merged.length) await backup("draft", prevDraft.pages);
      const savedAt = Number(b.savedAt) || Date.now();
      const s = JSON.stringify({ pages: merged, deleted: Array.isArray(b.deleted) ? b.deleted : [], dirty: !!b.dirty, savedAt });
      if (s.length > 4_000_000) return json({ error: "size" }, 413);
      await ps.set("draft", s);
      await ps.set("tombs", JSON.stringify([...tombs].slice(-2000)));
      return json({ ok: true, pages: merged, savedAt });
    }

    if (route === "pages" && m === "GET") {
      return json((await store("panel").get("pages", { type: "json" })) || { pages: [] });
    }

    if (route === "pages" && m === "PUT") {
      const body = await req.json();
      const html = body && typeof body.html === "object" ? body.html : {};
      const site = store("site");
      const names = Object.keys(html).filter(validFile);
      const prevPub = await store("panel").get("pages", { type: "json" }).catch(() => null);
      if (prevPub && Array.isArray(prevPub.pages) && prevPub.pages.length) await backup("publicado", prevPub.pages);
      for (const n of names) await site.set(n, String(html[n]));
      // Solo se quitan de tu web las páginas que borraste o a las que cambiaste el enlace.
      const removed = (Array.isArray(body.removed) ? body.removed : []).filter((f) => validFile(f) && !names.includes(f));
      // La antigua página principal (index.html) no se borra: pasa a ser una página más, con su propio enlace.
      if (!names.includes("index.html")) {
        const old = await site.get("index.html");
        if (old != null) {
          const t = (String(old).match(/<title>([^<]*)<\/title>/) || [])[1] || "pagina-principal";
          let base = t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/&[a-z]+;/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "pagina-principal", f = base + ".html", n = 2;
          while (names.includes(f) || (await site.get(f)) != null) f = base + "-" + (n++) + ".html";
          await site.set(f, old); await site.delete("index.html");
        }
      }
      for (const f of removed) await site.delete(f);
      const incoming = Array.isArray(body.pages) ? body.pages : [];
      const ids = new Set(incoming.map((p) => p && p.id));
      const keep = ((prevPub && prevPub.pages) || []).filter((p) => p && !ids.has(p.id) && p.publishedFile && !removed.includes(p.publishedFile) && !names.includes(p.publishedFile));
      await store("panel").setJSON("pages", { updated: new Date().toISOString(), pages: incoming.concat(keep) });
      return json({ ok: true, published: names });
    }

    if (route === "upload" && m === "POST") {
      const type = (req.headers.get("content-type") || "").split(";")[0].trim();
      if (!/^(image\/(jpeg|png|webp|gif)|font\/(ttf|otf|woff|woff2))$/.test(type)) return json({ error: "type" }, 400);
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
