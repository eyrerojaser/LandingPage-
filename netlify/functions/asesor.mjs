// Business Growth AI: tu asesora personal de crecimiento y ventas.
// Es independiente del resto del panel: guarda su propia memoria (negocios, metas, tareas, resultados,
// conversaciones) y usa la misma clave de Anthropic que ya tienes en «Cuenta → Conexiones».
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
async function checkPass(req) {
  const p = req.headers.get("x-panel-pass") || "";
  if (!p) return false;
  if (envPass()) return p === envPass();
  const rec = await store("panel").get("auth", { type: "json" });
  if (!rec) return false;
  return (await sha(rec.salt + p)) === rec.hash;
}
const settings = async () => (await store("panel").get("settings", { type: "json" })) || {};

/* ---------------- la asesora ---------------- */
export const SYSTEM = `Eres «Business Growth AI»: la asesora personal de crecimiento empresarial y ventas de una emprendedora. Trabajas con ella todos los días, como una socia senior de marketing y ventas que la conoce bien.

TU MISIÓN
Que venda más con los productos y servicios que YA tiene. No propongas crear productos nuevos salvo que ella lo pida o que los datos lo justifiquen claramente (y entonces dilo como opción, no como plan principal).

CÓMO TRABAJAS
1. Usa SIEMPRE sus datos reales de la sección «MEMORIA»: negocios, productos, precios, clienta ideal, canales, metas, tareas pendientes, resultados registrados, aprendizajes y números de sus páginas. Nómbralos por su nombre. Si falta un dato importante, haz una suposición conservadora, dila y pregunta una sola cosa al final.
2. Nada genérico. Prohibido: «crea contenido de valor», «conoce a tu audiencia», «sé constante», «aporta valor», «usa hashtags relevantes» y frases parecidas. Cada acción dice QUÉ hacer, DÓNDE, CÓMO (pasos exactos, textos de ejemplo cuando ayude), CUÁNTO tiempo y QUÉ resultado medir.
3. Cuando pide un plan («¿qué hacemos hoy?», «quiero cinco ventas», «tengo dos horas»): prioriza por impacto en ventas y por rapidez. Primero lo que puede traer dinero esta semana (clientas tibias, suscriptoras, seguidoras, ofertas a quien ya la conoce), después visibilidad. Ajusta las tareas al tiempo que tiene: la suma de minutos no pasa de su tiempo disponible. Haz las cuentas (visitas × conversión = ventas) cuando haya números.
4. Separa siempre opciones GRATIS y PAGADAS. En las pagadas da un presupuesto concreto de prueba, cuánto tiempo correrla y cuándo apagarla.
5. Seguimiento: si hay tareas o resultados anteriores, empieza revisando qué se hizo y qué pasó. Si algo no funcionó, dilo con honestidad, explica la causa más probable y cambia la estrategia. No repitas lo que ya falló. Sigue siempre el tema de su último mensaje: si pide ideas de otra cosa (otro producto, otro negocio, otro tema), céntrate en eso y no vuelvas a sus productos actuales salvo que ella lo pida. No repitas el mismo producto ni las mismas ideas de conversaciones anteriores: propone cosas nuevas.
6. Enséñale mientras trabajan: explica en una frase por qué cada acción funciona, para que aprenda a decidir sola.

INVESTIGACIÓN (cuando tengas búsqueda en internet)
- Busca cuando la respuesta dependa de cómo están las cosas HOY: tendencias, demanda, competencia, precios de anuncios, cambios de algoritmo o de reglas de YouTube, Instagram, Facebook, Pinterest, TikTok, Google (SEO, Google Business Profile, Google Ads), Etsy y otras plataformas.
- Prefiere fuentes oficiales (centros de ayuda y blogs oficiales de Google, Meta, YouTube, Pinterest, Etsy) y estudios con datos, publicados en los últimos 12 meses.
- En el texto, al dar un dato de internet, di la fuente y la fecha entre paréntesis, por ejemplo: (Google Ads Help, marzo 2026). Si la fuente no tiene fecha o es vieja, dilo.
- NUNCA inventes cifras, estudios, fuentes ni fechas. Si no encontraste algo, dilo. Distingue claramente «dato verificado» de «mi recomendación» o «mi estimación».
- Si no tienes búsqueda en internet en esta respuesta, no cites fuentes: di que es tu criterio y ofrece investigarlo.

FORMATO
- Español claro, cálido y directo, frases cortas. Tutéala. Sin relleno ni introducciones largas.
- Markdown sencillo: títulos con ##, listas con -, listas numeradas, **negritas**. Sin tablas.
- Empieza con la respuesta o el plan, no con saludos.

AL FINAL, SIEMPRE, añade este bloque (JSON válido, sin comentarios), separado del texto:
\`\`\`asesor
{"plan": null o {"titulo":"(corto)","objetivo":"(qué logramos hoy o esta semana)","metrica":"(cómo sabremos si funcionó)","revisar":"(cuándo lo revisamos, AAAA-MM-DD o 'mañana')","tareas":[{"titulo":"(acción concreta)","prioridad":1,"minutos":30,"canal":"(Instagram, Google, Correo, WhatsApp…)","tipo":"gratis o pago","costo":"($0 o presupuesto)","pasos":["(paso exacto)"],"resultado":"(qué medir)"}]},
 "meta": null o {"titulo":"(meta medible)","metrica":"(ventas, seguidores, visitas…)","objetivo":5,"fecha":"AAAA-MM-DD"},
 "aprendizajes": ["(solo datos NUEVOS y duraderos sobre su negocio o sus resultados que conviene recordar; vacío si no hay)"],
 "sugerencias": ["(2 a 4 siguientes mensajes cortos que ella podría pulsar)"]}
\`\`\`
- «plan»: inclúyelo cuando ella quiera actuar (plan del día, conseguir ventas, crecer un canal, tiempo disponible). Ordena las tareas por prioridad.
- «meta»: solo si ella dice una meta nueva que no está ya en su memoria.`;

const MODELS = ["claude-sonnet-5-5", "claude-haiku-5-5"];

function aiReason(status, txt) {
  if (status === 401 || status === 403) return "aikey";
  if (/credit balance|billing|purchase credits/i.test(txt)) return "aicredit";
  if (status === 429 || status === 529 || status >= 500) return "aibusy";
  return "aifail";
}
async function call(key, body) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (r.ok) return { ok: true, data: await r.json() };
  return { ok: false, status: r.status, txt: (await r.text()).slice(0, 500) };
}
function parseJSON(text) {
  let t = String(text).trim().replace(/^```(?:json|asesor)?\s*/i, "").replace(/\s*```$/, "");
  const a = t.search(/[{[]/), z = Math.max(t.lastIndexOf("}"), t.lastIndexOf("]"));
  if (a >= 0 && z > a) t = t.slice(a, z + 1);
  try { return JSON.parse(t); } catch (_) {}
  let out = "", inStr = false, esc = false;
  for (const ch of t) {
    if (!inStr) { if (ch === '"') inStr = true; out += ch; continue; }
    if (esc) { esc = false; out += ch; continue; }
    if (ch === "\\") { esc = true; out += ch; continue; }
    if (ch === '"') { inStr = false; out += ch; continue; }
    if (ch === "\n") out += "\\n"; else if (ch === "\r") out += "\\r"; else if (ch === "\t") out += "\\t";
    else if (ch < " ") out += "\\u" + ch.charCodeAt(0).toString(16).padStart(4, "0");
    else out += ch;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
}
const clean = (s, n) => String(s == null ? "" : s).slice(0, n);

/* Convierte la respuesta de Anthropic en: texto con [n] donde cita, lista de fuentes con fecha y el bloque del plan. */
export function shapeAnswer(blocks) {
  const sources = [], byUrl = {}, seen = {};
  const add = (url, title, age) => {
    if (!/^https?:\/\//.test(url || "")) return null;
    if (!byUrl[url]) { byUrl[url] = { url, title: clean(title || url, 200), age: age || "", cited: false }; sources.push(byUrl[url]); }
    else { if (age && !byUrl[url].age) byUrl[url].age = age; if (title && byUrl[url].title === url) byUrl[url].title = clean(title, 200); }
    return byUrl[url];
  };
  let searches = 0;
  for (const b of blocks) {
    if (b.type === "server_tool_use" && b.name === "web_search") searches++;
    if (b.type === "web_search_tool_result" && Array.isArray(b.content)) for (const r of b.content) if (r && r.type === "web_search_result") add(r.url, r.title, r.page_age);
  }
  let text = "";
  for (const b of blocks) {
    if (b.type !== "text") continue;
    text += b.text || "";
    const cites = (b.citations || []).filter((c) => c && c.url);
    if (cites.length) {
      const nums = [];
      for (const c of cites) {
        const s = add(c.url, c.title, ""); if (!s) continue;
        s.cited = true;
        if (!s.n) { s.n = Object.keys(seen).length + 1; seen[c.url] = s.n; }
        if (!nums.includes(s.n)) nums.push(s.n);
      }
      if (nums.length) text = text.replace(/\s*$/, "") + " " + nums.map((n) => "[" + n + "]").join("") + (/\n\s*$/.test(b.text || "") ? "\n" : "");
    }
  }
  // El bloque ```asesor … ``` con el plan y la memoria
  let extra = null;
  const m = text.match(/```asesor\s*([\s\S]*?)(```|$)/i) || text.match(/```json\s*(\{[\s\S]*?"sugerencias"[\s\S]*?)(```|$)/i);
  if (m) { try { extra = parseJSON(m[1]); } catch (_) { extra = null; } text = text.slice(0, m.index).trim(); }
  const cited = sources.filter((s) => s.cited).sort((a, b) => a.n - b.n);
  const other = sources.filter((s) => !s.cited).slice(0, Math.max(0, 8 - cited.length));
  return {
    text: text.trim(),
    sources: cited.map((s) => ({ n: s.n, url: s.url, title: s.title, age: s.age })).concat(other.map((s) => ({ url: s.url, title: s.title, age: s.age }))),
    extra, searches,
  };
}

/* Hace la consulta completa: con búsqueda en internet si se pidió, y siguiendo cuando Anthropic pausa un turno largo. */
export async function runAdvisor(s, job) {
  if (!s.anthropicKey) { const e = new Error("noai"); e.code = "noai"; throw e; }
  const system = SYSTEM + "\n\n" + clean(job.context, 60000);
  const msgs = (job.messages || []).map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: clean(m.text, 12000) || "…" }));
  while (msgs.length && msgs[0].role !== "user") msgs.shift();
  if (!msgs.length) { const e = new Error("bad"); e.code = "aifail"; throw e; }
  let web = !!job.web, noweb = false, last = null;
  for (const model of MODELS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const tools = web ? [Object.assign({ type: "web_search_20250305", name: "web_search", max_uses: job.deep ? 10 : 6 }, job.tz ? { user_location: { type: "approximate", timezone: clean(job.tz, 60) } } : {})] : undefined;
      const convo = msgs.slice(), all = [];
      let res, stop = "";
      for (let turn = 0; turn < 5; turn++) {
        res = await call(s.anthropicKey, Object.assign({ model, max_tokens: job.max || 8000, system, messages: convo }, tools ? { tools } : {}));
        if (!res.ok) break;
        const content = res.data.content || [];
        all.push(...content); stop = res.data.stop_reason;
        if (stop !== "pause_turn") break;
        convo.push({ role: "assistant", content });   // seguir donde se quedó
      }
      if (res.ok) {
        const out = shapeAnswer(all);
        if (!out.text && !out.extra) { last = { status: 200, txt: "respuesta vacía" }; break; }
        return Object.assign(out, { noweb, model, cut: stop === "max_tokens" });
      }
      last = res;
      // Si tu cuenta de Anthropic tiene la búsqueda web apagada, seguimos sin internet y te avisamos.
      if (web && res.status === 400 && /web.?search|server.?tool|tool/i.test(res.txt) && !/model/i.test(res.txt)) { web = false; noweb = true; continue; }
      break;
    }
    if (last && !(last.status === 404 || (last.status === 400 && /model/i.test(last.txt)))) break;
  }
  const e = new Error("ai " + (last ? last.status + " " + last.txt : "")); e.code = last ? aiReason(last.status, last.txt) : "aifail"; throw e;
}

/* Un trabajo en segundo plano (lo usa asesor-bg.mjs) */
export async function runJob(id) {
  const jobs = store("asesor-jobs"), j = await jobs.get(id, { type: "json" });
  if (!j || j.status !== "pending") return;
  await jobs.setJSON(id, Object.assign({}, j, { status: "working", started: Date.now() }));
  try {
    const result = await runAdvisor(await settings(), j);
    await jobs.setJSON(id, { status: "done", result, at: Date.now() });
  } catch (e) {
    await jobs.setJSON(id, { status: "error", error: /^(ai|noai)/.test(e.code || "") ? e.code : "aifail", message: clean(e.message, 300), at: Date.now() });
  }
}

const jobInput = (b) => ({
  messages: (Array.isArray(b.messages) ? b.messages : []).slice(-14).map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", text: clean(m.text, 12000) })),
  context: clean(b.context, 60000), web: !!b.web, deep: !!b.deep, tz: clean(b.tz, 60), max: Math.min(Math.max(Number(b.max) || 8000, 1500), 12000),
});

export default async (req) => {
  const url = new URL(req.url), m = req.method;
  const route = url.pathname.replace(/^\/asesor-api\/?/, "").replace(/\/+$/, "");
  try {
    if (!(await checkPass(req))) return json({ error: "auth" }, 401);

    /* La memoria de tu asesora: negocios, metas, tareas, resultados, aprendizajes y conversaciones */
    if (route === "data" && m === "GET") return json((await store("panel").get("asesor", { type: "json" })) || {});
    if (route === "data" && m === "PUT") {
      const b = await req.json().catch(() => null);
      if (!b || typeof b !== "object" || Array.isArray(b)) return json({ error: "bad" }, 400);
      const sz = JSON.stringify(b).length;
      if (sz > 4_000_000) return json({ error: "size" }, 413);
      await store("panel").setJSON("asesor", b);
      return json({ ok: true, size: sz });
    }

    /* Preguntar: se crea un trabajo y el panel pregunta hasta que esté listo */
    if (route === "start" && m === "POST") {
      const s = await settings();
      if (!s.anthropicKey) return json({ error: "noai" }, 409);
      const b = await req.json().catch(() => ({}));
      const job = jobInput(b);
      if (!job.messages.length) return json({ error: "bad" }, 400);
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
      await store("asesor-jobs").setJSON(id, Object.assign({ status: "pending", at: Date.now() }, job));
      return json({ job: id });
    }
    if (route.startsWith("job/") && m === "GET") {
      const id = route.slice(4); if (!/^[a-z0-9]{8,30}$/.test(id)) return json({ error: "bad" }, 400);
      const jobs = store("asesor-jobs"), j = await jobs.get(id, { type: "json" });
      if (!j) return json({ error: "notfound" }, 404);
      if (j.status === "done" || j.status === "error") await jobs.delete(id);
      return json({ status: j.status, result: j.result, error: j.error, message: j.message });
    }
    /* Si tu web no tiene trabajos en segundo plano, lo hacemos directo (más corto y sin internet, para que no se corte). */
    if (route.startsWith("run/") && m === "POST") {
      const id = route.slice(4); if (!/^[a-z0-9]{8,30}$/.test(id)) return json({ error: "bad" }, 400);
      const jobs = store("asesor-jobs"), j = await jobs.get(id, { type: "json" });
      if (!j) return json({ error: "notfound" }, 404);
      if (j.status !== "pending") return json({ status: j.status });
      await jobs.setJSON(id, Object.assign({}, j, { status: "working", started: Date.now(), direct: true }));
      try {
        const result = await runAdvisor(await settings(), Object.assign({}, j, { web: false, max: 4000 }));
        result.direct = true;
        await jobs.delete(id);
        return json({ status: "done", result });
      } catch (e) {
        await jobs.delete(id);
        return json({ status: "error", error: /^(ai|noai)/.test(e.code || "") ? e.code : "aifail", message: clean(e.message, 300) });
      }
    }
    return json({ error: "notfound" }, 404);
  } catch (e) {
    return json({ error: "server", message: clean(e && e.message, 200) }, 500);
  }
};

export const config = { path: "/asesor-api/*" };
