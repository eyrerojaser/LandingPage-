// Muestra tus páginas publicadas desde el panel (y sus fotos).
import { getStore } from "@netlify/blobs";

const NOT_FOUND = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Página no encontrada</title><link rel="icon" href="/favicon.png">
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0D0B0C;color:#fff;font:16px/1.5 Georgia,serif;text-align:center;padding:24px}
h1{font-weight:400;font-size:2rem;margin:0 0 8px}p{color:#D8CCD1;margin:0}i{display:block;width:56px;height:56px;margin:0 auto 18px;border-radius:50%;background:#F4D3DE}</style></head>
<body><div><i></i><h1>Esta página todavía no existe</h1><p>Vuelve pronto.</p></div></body></html>`;

const escH = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
async function menuPage(live) {
  const saved = (await getStore({ name: "panel", consistency: "strong" }).get("pages", { type: "json" }).catch(() => null)) || { pages: [] };
  const info = {};
  (saved.pages || []).forEach((p) => { if (p && p.data && p.data.fileName) info[p.data.fileName] = p.data; });
  const first = info[live[0]] || {};
  const brand = (Object.values(info).map((d) => d.brand).filter((b) => b && b !== "Tu marca")[0]) || "";
  const paper = first.paper || "#0D0B0C", accent = first.accent || "#D8A2B4", blush = first.blush || "#F4D3DE";
  const order = live.slice().sort((x, y) => String((info[x] || {}).name || x).localeCompare(String((info[y] || {}).name || y)));
  const cards = order.map((k) => {
    const d = info[k] || {}, href = "/" + k.replace(/\.html$/, "");
    const photo = d.photo === "sample" ? "/img/ejemplo.jpg" : (/^(\/img\/|https?:)/.test(d.photo || "") ? d.photo : "");
    const title = String(d.title || d.name || k).replace(/\*/g, "");
    return '<a class="card" href="' + escH(href) + '">' + (photo ? '<span class="ph"><img src="' + escH(photo) + '" alt="" loading="lazy"></span>' : '<span class="ph"></span>') +
      '<span class="tx">' + (d.eyebrow ? '<small>' + escH(d.eyebrow) + '</small>' : '') + '<b>' + escH(title) + '</b>' + (d.sub ? '<i>' + escH(d.sub) + '</i>' : '') + '<em>' + (d.lang === "en" ? "See more" : "Ver más") + ' →</em></span></a>';
  }).join("");
  return '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + escH(brand || "Mis páginas") + '</title><link rel="icon" href="/favicon.png">' +
    '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=Jost:wght@300;400;500&display=swap">' +
    '<style>*{box-sizing:border-box}body{margin:0;background:' + paper + ';color:#fff;font:16px/1.5 Jost,Helvetica,Arial,sans-serif}' +
    '.wrap{max-width:1100px;margin:0 auto;padding:56px 22px 70px}h1{font:400 clamp(2.2rem,6vw,3.6rem)/1.05 "DM Serif Display",Georgia,serif;margin:0 0 8px;text-align:center}' +
    '.sub{text-align:center;color:' + accent + ';letter-spacing:.28em;text-transform:uppercase;font-size:12px;margin:0 0 36px}' +
    '.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:22px}' +
    '.card{display:grid;grid-template-rows:auto 1fr;background:' + blush + ';color:#1F161A;border-radius:18px;overflow:hidden;text-decoration:none;transition:transform .2s,box-shadow .2s}' +
    '.card:hover{transform:translateY(-4px);box-shadow:0 24px 40px -24px rgba(0,0,0,.6)}.ph{display:block;aspect-ratio:4/3;background:' + accent + ';overflow:hidden}.ph img{width:100%;height:100%;object-fit:cover;object-position:top;display:block}' +
    '.tx{display:grid;gap:6px;padding:16px 18px 20px;align-content:start}.tx small{font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:#8A5568}.tx b{font:400 1.35rem/1.15 "DM Serif Display",Georgia,serif}.tx i{font-style:normal;font-size:.92rem;color:#5E4A52}.tx em{font-style:normal;font-weight:500;color:#9C4462;margin-top:4px}' +
    'footer{text-align:center;margin-top:40px;font-size:13px}footer a{color:' + accent + '}</style></head><body><div class="wrap">' +
    '<h1>' + escH(brand || "Bienvenida") + '</h1><p class="sub">Elige lo que buscas</p><div class="grid">' + cards + '</div>' +
    '<footer><a href="/privacidad">Política de privacidad</a></footer></div></body></html>';
}

export default async (req) => {
  const path = decodeURIComponent(new URL(req.url).pathname);

  if (path.startsWith("/img/")) {
    const id = path.slice(5);
    if (!/^[a-z0-9]{4,40}$/.test(id)) return new Response("No encontrado", { status: 404 });
    const r = await getStore({ name: "img", consistency: "strong" }).getWithMetadata(id, { type: "arrayBuffer" });
    if (!r) return new Response("No encontrado", { status: 404 });
    return new Response(r.data, { headers: { "content-type": (r.metadata && r.metadata.type) || "image/jpeg", "cache-control": "public, max-age=31536000, immutable" } });
  }

  if (path.startsWith("/pdf/")) {
    const id = path.slice(5).replace(/\.pdf$/, "");
    if (!/^[a-z0-9-]{1,90}$/.test(id)) return new Response("No encontrado", { status: 404 });
    const r = await getStore({ name: "pdf", consistency: "strong" }).getWithMetadata(id, { type: "stream" });
    if (!r) return new Response("No encontrado", { status: 404 });
    const name = id.replace(/-[a-z0-9]{6,9}$/, "") + ".pdf";
    const dl = new URL(req.url).searchParams.get("dl") === "1";
    const h = { "content-type": "application/pdf", "content-disposition": (dl ? "attachment" : "inline") + '; filename="' + name + '"', "cache-control": "public, max-age=86400" };
    if (r.metadata && r.metadata.size) h["content-length"] = String(r.metadata.size);
    return new Response(r.data, { headers: h });
  }

  if (path.startsWith("/video/")) {
    const id = path.slice(7).replace(/\.(mp4|mov)$/, "");
    if (!/^[a-z0-9-]{1,90}$/.test(id)) return new Response("No encontrado", { status: 404 });
    const v = await getStore({ name: "video", consistency: "strong" }).getWithMetadata(id, { type: "arrayBuffer" });
    if (!v) return new Response("No encontrado", { status: 404 });
    const buf = new Uint8Array(v.data), size = buf.length, type = (v.metadata && v.metadata.type) || "video/mp4";
    const base = { "content-type": type, "accept-ranges": "bytes", "cache-control": "public, max-age=86400" };
    const range = req.headers.get("range");
    const m = range && range.match(/bytes=(\d*)-(\d*)/);
    if (m) {
      let start = m[1] === "" ? Math.max(0, size - Number(m[2])) : Number(m[1]);
      let end = m[1] !== "" && m[2] !== "" ? Number(m[2]) : size - 1;
      if (start >= size) return new Response(null, { status: 416, headers: { ...base, "content-range": "bytes */" + size } });
      end = Math.min(end, size - 1, start + 4_000_000 - 1);
      return new Response(buf.slice(start, end + 1), { status: 206, headers: { ...base, "content-range": "bytes " + start + "-" + end + "/" + size, "content-length": String(end - start + 1) } });
    }
    if (size > 5_500_000) {
      const end = Math.min(size, 4_000_000) - 1;
      return new Response(buf.slice(0, end + 1), { status: 206, headers: { ...base, "content-range": "bytes 0-" + end + "/" + size, "content-length": String(end + 1) } });
    }
    return new Response(buf, { headers: { ...base, "content-length": String(size) } });
  }

  let key = path === "/" ? "index.html" : path.slice(1);
  if (!/\.html$/.test(key)) key += ".html";
  const siteStore = getStore({ name: "site", consistency: "strong" });
  let html = /^[a-z0-9][a-z0-9-]{0,60}\.html$/.test(key) ? await siteStore.get(key) : null;
  if (html == null && key === "index.html") {
    // Si ninguna página es la principal (index.html), la dirección principal muestra un menú con todas tus páginas.
    const { blobs } = await siteStore.list();
    const live = blobs.map((b) => b.key).filter((k) => /\.html$/.test(k) && !/^(privacidad|privacy)\.html$/.test(k));
    if (live.length) html = await menuPage(live);
  }
  if (html == null) return new Response(NOT_FOUND, { status: 404, headers: { "content-type": "text/html; charset=utf-8" } });
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=0, must-revalidate" } });
};

export const config = { path: ["/", "/:page", "/img/:id", "/pdf/:file", "/video/:file"], preferStatic: true };
