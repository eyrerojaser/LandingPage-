// Muestra tus páginas publicadas desde el panel (y sus fotos).
import { getStore } from "@netlify/blobs";

const NOT_FOUND = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Página no encontrada</title><link rel="icon" href="/favicon.png">
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0D0B0C;color:#fff;font:16px/1.5 Georgia,serif;text-align:center;padding:24px}
h1{font-weight:400;font-size:2rem;margin:0 0 8px}p{color:#D8CCD1;margin:0}i{display:block;width:56px;height:56px;margin:0 auto 18px;border-radius:50%;background:#F4D3DE}</style></head>
<body><div><i></i><h1>Esta página todavía no existe</h1><p>Vuelve pronto.</p></div></body></html>`;

export default async (req) => {
  const path = decodeURIComponent(new URL(req.url).pathname);

  if (path.startsWith("/img/")) {
    const id = path.slice(5);
    if (!/^[a-z0-9]{4,40}$/.test(id)) return new Response("No encontrado", { status: 404 });
    const r = await getStore({ name: "img", consistency: "strong" }).getWithMetadata(id, { type: "arrayBuffer" });
    if (!r) return new Response("No encontrado", { status: 404 });
    return new Response(r.data, { headers: { "content-type": (r.metadata && r.metadata.type) || "image/jpeg", "cache-control": "public, max-age=31536000, immutable" } });
  }

  let key = path === "/" ? "index.html" : path.slice(1);
  if (!/\.html$/.test(key)) key += ".html";
  const html = /^[a-z0-9][a-z0-9-]{0,60}\.html$/.test(key) ? await getStore({ name: "site", consistency: "strong" }).get(key) : null;
  if (html == null) return new Response(NOT_FOUND, { status: 404, headers: { "content-type": "text/html; charset=utf-8" } });
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=0, must-revalidate" } });
};

export const config = { path: ["/", "/:page", "/img/:id"], preferStatic: true };
