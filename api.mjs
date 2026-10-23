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
      return json({ ok: true });
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
      const { id, parts } = await req.json().catch(() => ({}));
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
    return json({ error: "server", message: String((e && e.message) || e) }, 500);
  }
};

export const config = { path: "/api/*" };
