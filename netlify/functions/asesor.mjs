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
        // Los modelos 5.5 razonan antes de responder y ese razonamiento gasta del mismo máximo: le damos espacio de sobra.
        const body = Object.assign({ model, max_tokens: Math.min((job.max || 8000) + 10000, 32000), system, messages: convo }, tools ? { tools } : {});
        if (!/haiku/.test(model)) body.output_config = { effort: job.deep ? "high" : "medium" };
        res = await call(s.anthropicKey, body);
        if (!res.ok && res.status === 400 && /output_config|effort/i.test(res.txt)) { delete body.output_config; res = await call(s.anthropicKey, body); }
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
  if (j.kind === "report") return runReport(id, j);
  try {
    const result = await runAdvisor(await settings(), j);
    await jobs.setJSON(id, { status: "done", result, at: Date.now() });
  } catch (e) {
    await jobs.setJSON(id, { status: "error", error: /^(ai|noai)/.test(e.code || "") ? e.code : "aifail", message: clean(e.message, 300), at: Date.now() });
  }
}

/* ================= INVESTIGACIÓN PROFUNDA =================
   Cinco etapas: entender → investigar (buscar y leer páginas) → analizar → revisar → entregar.
   Cada afirmación del informe lleva su tipo (dato, hipótesis o recomendación) y sus fuentes.
   El código comprueba que cada fuente exista de verdad: lo que no tiene fuente no puede salir como «dato». */
const PRICE = { "claude-opus-5-5": [4, 20], "claude-sonnet-5-5": [2, 10], "claude-haiku-5-5": [0.1, 0.5] }; // USD por millón de tokens (platform.claude.com, nov 2026)
function newUsage() { return { input: 0, output: 0, searches: 0, fetches: 0, usd: 0, calls: 0 }; }
function addUsage(u, model, d) {
  const x = (d && d.usage) || {}, inp = (x.input_tokens || 0) + (x.cache_creation_input_tokens || 0) + (x.cache_read_input_tokens || 0), out = x.output_tokens || 0;
  const st = x.server_tool_use || {}, pr = PRICE[model] || PRICE["claude-sonnet-5-5"];
  u.input += inp; u.output += out; u.searches += st.web_search_requests || 0; u.fetches += st.web_fetch_requests || 0; u.calls++;
  u.usd += inp / 1e6 * pr[0] + out / 1e6 * pr[1] + (st.web_search_requests || 0) * 0.01;
}
/* Una llamada completa: sigue cuando Anthropic pausa un turno largo, aguanta sin «esfuerzo» o sin lectura web si la cuenta no los acepta. */
async function deepCall(key, usage, o) {
  const models = o.models || ["claude-sonnet-5-5"];
  let last = null;
  for (const model of models) {
    let tools = o.tools ? o.tools.slice() : null, effort = o.effort || "high";
    for (let attempt = 0; attempt < 3; attempt++) {
      const convo = o.messages.slice(), all = [];
      let res = null, stop = "";
      for (let turn = 0; turn < 8; turn++) {
        const body = { model, max_tokens: o.max || 32000, system: o.system, messages: convo };
        if (effort) body.output_config = { effort };
        if (tools && tools.length) body.tools = tools;
        res = await call(key, body);
        if (!res.ok) break;
        addUsage(usage, model, res.data);
        const content = res.data.content || [];
        all.push(...content); stop = res.data.stop_reason;
        if (stop !== "pause_turn") break;
        convo.push({ role: "assistant", content });
      }
      if (res && res.ok) {
        if (stop === "refusal") { const e = new Error("la IA no quiso hacer esta investigación"); e.code = "aifail"; throw e; }
        return { blocks: all, stop, model };
      }
      last = res;
      if (res.status === 400 && /output_config|effort/i.test(res.txt) && effort) { effort = null; continue; }
      if (res.status === 400 && /web_fetch/i.test(res.txt) && tools && tools.some((t) => t.name === "web_fetch")) { tools = tools.filter((t) => t.name !== "web_fetch"); usage.nofetch = true; continue; }
      if (res.status === 400 && /web.?search|server.?tool/i.test(res.txt) && tools) { tools = null; usage.noweb = true; continue; }
      break;
    }
    if (last && !(last.status === 404 || (last.status === 400 && /model/i.test(last.txt)))) break;
  }
  const e = new Error("ai " + (last ? last.status + " " + last.txt : "")); e.code = last ? aiReason(last.status, last.txt) : "aifail"; throw e;
}
const textOf = (blocks) => blocks.filter((b) => b.type === "text").map((b) => b.text || "").join("");
function block(text, name) {
  const m = String(text).match(new RegExp("```" + name + "\\s*([\\s\\S]*?)(```|$)", "i")) || String(text).match(/```json\s*([\s\S]*?)(```|$)/i);
  return parseJSON(m ? m[1] : text);
}
const normUrl = (u) => String(u || "").trim().replace(/#.*$/, "").replace(/\/+$/, "").replace(/^http:\/\//, "https://").replace(/\/\/www\./, "//").toLowerCase();

const R_PLAN = `Eres la jefa de investigación de «Business Growth AI», una asesora empresarial. Te dan la ficha de un negocio, sus datos reales y la pregunta de la dueña.
Tu trabajo ahora es SOLO planear la investigación: qué hay que averiguar en internet para responder con evidencia y encontrar oportunidades que ella no ha visto.
Piensa en: competidoras directas e indirectas (con nombre si se pueden buscar), precios y paquetes del mercado, lo que dicen las clientas en reseñas y foros (quejas, deseos, palabras que usan), demanda y tendencias actuales, temporadas y fechas próximas, canales y alianzas posibles, reglas de plataformas que afectan al negocio.
Las preguntas deben ser concretas para ESTE negocio (producto, público, país o idioma), nunca genéricas.
Responde SOLO con este bloque:
\`\`\`plan
{"preguntas":["(6 a 10 preguntas concretas)"],"busquedas":["(10 a 15 búsquedas exactas que harías, en el idioma del mercado)"],"leer":["(enlaces de la ficha que conviene abrir: su website, competidoras, etc.)"]}
\`\`\``;

const R_SEARCH = `Eres investigadora de mercado. Tienes búsqueda web y lectura de páginas (web_fetch). Investiga las preguntas que te dan para el negocio descrito.
REGLAS
- Busca y ABRE las páginas importantes (websites de competidoras, páginas de precios, reseñas, foros, centros de ayuda oficiales, estudios). Un resumen de buscador no basta para dar un precio o una cifra: abre la página.
- Abre también los enlaces del negocio que te dan (su website, su Instagram, competidoras conocidas) si se pueden leer.
- Prefiere fuentes de los últimos 12 meses. Anota la fecha de cada fuente si aparece.
- Anota SOLO lo que la página dice. No calcules, no supongas, no completes. Si algo no se encontró, no lo anotes.
- Cuando termines, responde SOLO con este bloque, con 15 a 40 hallazgos:
\`\`\`hallazgos
[{"hecho":"(lo que dice la fuente, concreto, con la cifra o el nombre si los hay)","url":"(la página exacta donde lo leíste)","titulo":"(título de la página)","fecha":"(fecha de la fuente o vacío)","tema":"competidora|precio|clientas|demanda|tendencia|canal|regla|otro"}]
\`\`\``;

const R_ANALYZE = `Eres «Business Growth AI»: una asesora empresarial senior, como una socia de estrategia que investiga antes de opinar. Hablas con la dueña del negocio, en español claro, tuteándola.
Tienes: la ficha del negocio, DATOS INTERNOS numerados (I1, I2…: calculados por el panel con sus ventas y estadísticas reales) y HALLAZGOS de internet numerados (F1, F2…: cada uno con su fuente abierta).

LO QUE QUIERE DE TI
- Un diagnóstico profundo y oportunidades que probablemente ella NO ha visto, comparadas entre sí, explicando por qué podrían funcionar, qué evidencia las respalda y cómo ejecutarlas.
- Nada genérico. Prohibido como propuesta principal: «publica más», «únete a grupos de Facebook», «haz un descuento», «crea contenido de valor», «usa hashtags», «sé constante». Prueba anti-genérico: si una oportunidad serviría igual para cualquier empresa, descártala. Cada oportunidad nombra algo propio de este negocio (un producto, un precio, un dato interno, una competidora concreta, una necesidad encontrada).
- Busca oportunidades de varios tipos: precio y paquetes, nuevos públicos o nichos, huecos que dejan las competidoras, lo que piden las clientas y nadie ofrece, alianzas, temporada y fechas próximas, recompra o suscripción, canales donde de verdad está su público, mejoras de conversión en sus páginas.

EVIDENCIA (lo más importante)
- Cada afirmación lleva "tipo": "dato" (comprobado: SOLO si lo dice un hallazgo F o un dato interno I, y lo citas en "fuentes"), "hipotesis" (lo que crees por razonamiento, sin prueba directa) o "recomendacion" (lo que harías).
- NUNCA inventes cifras, nombres, precios, estudios ni fechas. Una cifra que no esté en F o I no puede aparecer como dato. Si estimas algo, es "hipotesis" y dices cómo lo estimaste.
- Si la evidencia es débil o falta algo, dilo en "advertencias" y en "preguntas".

FORMATO: responde SOLO con este bloque JSON válido:
\`\`\`informe
{"titulo":"(corto)","resumen":"(4 a 6 frases: lo más importante que encontraste y qué harías primero)",
 "diagnostico":[{"texto":"…","tipo":"dato|hipotesis|recomendacion","fuentes":["I1","F3"]}],
 "competidoras":[{"nombre":"…","url":"…","ofrece":"…","precio":"(solo si está en un hallazgo)","hueco":"(lo que no cubre)","fuentes":["F2"]}],
 "clientas":[{"texto":"(necesidad, queja o deseo encontrado)","tipo":"dato|hipotesis","fuentes":["F5"]}],
 "oportunidades":[{"titulo":"…","por_que":"(por qué para ESTE negocio)","evidencia":[{"texto":"…","tipo":"dato|hipotesis","fuentes":["F1"]}],"pasos":["(paso concreto y exacto)"],"prueba":{"dias":14,"costo":"$0","metrica":"(número a mirar y meta)"},"riesgo":"…","impacto":4,"esfuerzo":2,"confianza":3}],
 "comparacion":[{"opcion":"(título de una oportunidad)","costo":"…","tiempo":"…","evidencia":"fuerte|media|débil","encaje":"…"}],
 "preguntas":["(datos que faltan para decidir mejor)"],
 "advertencias":["(límites de esta investigación)"]}
\`\`\`
- 4 a 6 oportunidades, ordenadas de mejor a peor. impacto, esfuerzo y confianza van de 1 a 5.
- "comparacion": una fila por oportunidad.`;

const R_REVIEW = `Eres la revisora de calidad de «Business Growth AI». Recibes un informe en JSON, los HALLAZGOS (F…) y los DATOS INTERNOS (I…) que lo respaldan.
Revisa TODAS las afirmaciones:
1. Una afirmación "dato" debe estar respaldada por las fuentes que cita (lo que dicen F o I). Si la fuente no lo dice, cámbiala a "hipotesis" o corrígela para que diga solo lo que la fuente dice.
2. Borra o pasa a "hipotesis" cualquier cifra, precio, nombre o fecha que no aparezca en F o I.
3. Quita las fuentes que no correspondan.
4. Si una oportunidad es genérica (serviría igual para cualquier negocio), reemplázala por una específica respaldada por los hallazgos, o bórrala.
5. Comprueba que los pasos sean concretos y ejecutables, y que la comparación tenga una fila por oportunidad.
No añadas datos nuevos que no estén en F o I. Mantén el mismo formato y el mismo idioma.
Responde SOLO con:
\`\`\`informe
(el informe corregido, mismo formato)
\`\`\`
\`\`\`cambios
["(qué corregiste, en frases cortas)"]
\`\`\``;

/* El código revisa otra vez: fuentes que no existen fuera; un «dato» sin fuente real pasa a «hipótesis». */
function enforce(rep, ids) {
  let fixed = 0;
  const okIds = (arr) => (Array.isArray(arr) ? arr : []).map((x) => String(x).trim().toUpperCase()).filter((x) => ids.has(x));
  const claim = (c) => {
    if (!c || typeof c !== "object") return null;
    const out = { texto: clean(c.texto, 1200), tipo: ["dato", "hipotesis", "recomendacion"].includes(c.tipo) ? c.tipo : "hipotesis", fuentes: okIds(c.fuentes) };
    if (out.tipo === "dato" && !out.fuentes.length) { out.tipo = "hipotesis"; out.sinFuente = true; fixed++; }
    return out.texto ? out : null;
  };
  const list = (a, f) => (Array.isArray(a) ? a : []).map(f).filter(Boolean);
  const n15 = (v) => Math.max(1, Math.min(5, Math.round(Number(v) || 3)));
  const r = {
    titulo: clean(rep.titulo, 140) || "Informe", resumen: clean(rep.resumen, 2500),
    diagnostico: list(rep.diagnostico, claim).slice(0, 14),
    competidoras: list(rep.competidoras, (c) => c && c.nombre ? { nombre: clean(c.nombre, 120), url: /^https?:\/\//.test(c.url || "") ? clean(c.url, 400) : "", ofrece: clean(c.ofrece, 500), precio: okIds(c.fuentes).length ? clean(c.precio, 160) : "", hueco: clean(c.hueco, 500), fuentes: okIds(c.fuentes) } : null).slice(0, 10),
    clientas: list(rep.clientas, claim).slice(0, 12),
    oportunidades: list(rep.oportunidades, (o) => o && o.titulo ? {
      titulo: clean(o.titulo, 160), por_que: clean(o.por_que, 1200), evidencia: list(o.evidencia, claim).slice(0, 8),
      pasos: list(o.pasos, (x) => clean(x, 500) || null).slice(0, 10),
      prueba: { dias: Math.max(1, Math.min(90, Number(o.prueba && o.prueba.dias) || 14)), costo: clean(o.prueba && o.prueba.costo, 120), metrica: clean(o.prueba && o.prueba.metrica, 300) },
      riesgo: clean(o.riesgo, 500), impacto: n15(o.impacto), esfuerzo: n15(o.esfuerzo), confianza: n15(o.confianza),
    } : null).slice(0, 8),
    comparacion: list(rep.comparacion, (c) => c && c.opcion ? { opcion: clean(c.opcion, 160), costo: clean(c.costo, 120), tiempo: clean(c.tiempo, 120), evidencia: clean(c.evidencia, 40), encaje: clean(c.encaje, 300) } : null).slice(0, 8),
    preguntas: list(rep.preguntas, (x) => clean(x, 300) || null).slice(0, 8),
    advertencias: list(rep.advertencias, (x) => clean(x, 400) || null).slice(0, 8),
  };
  return { r, fixed };
}

async function runReport(id, j) {
  const jobs = store("asesor-jobs"), usage = newUsage();
  const step = (n, note) => jobs.setJSON(id, Object.assign({}, j, { status: "working", stage: n, note, started: j.started || Date.now(), usage }));
  try {
    const s = await settings();
    if (!s.anthropicKey) { const e = new Error("noai"); e.code = "noai"; throw e; }
    const internal = (j.internal || []).map((t, i) => ({ id: "I" + (i + 1), text: clean(t, 600) }));
    const intTxt = internal.map((x) => x.id + ": " + x.text).join("\n") || "(no hay datos internos todavía)";
    const brief = "FECHA DE HOY: " + new Date().toISOString().slice(0, 10) + "\n\nFICHA DEL NEGOCIO\n" + clean(j.biz, 12000) + "\n\nENLACES DEL NEGOCIO\n" + ((j.links || []).join("\n") || "(ninguno)") + "\n\nDATOS INTERNOS\n" + intTxt + "\n\nPREGUNTA DE LA DUEÑA\n" + clean(j.question, 2000);

    // 1. Entender: preguntas de investigación
    await step(1, "Entendiendo tu negocio y tu pregunta");
    const p1 = await deepCall(s.anthropicKey, usage, { system: R_PLAN, messages: [{ role: "user", content: brief }], effort: "medium", max: 16000 });
    let plan; try { plan = block(textOf(p1.blocks), "plan"); } catch (_) { plan = { preguntas: [clean(j.question, 400)], busquedas: [], leer: [] }; }

    // 2. Investigar: buscar y leer páginas completas
    await step(2, "Investigando en internet y leyendo páginas");
    const tools = [
      Object.assign({ type: "web_search_20250305", name: "web_search", max_uses: 18 }, j.tz ? { user_location: { type: "approximate", timezone: clean(j.tz, 60) } } : {}),
      { type: "web_fetch_20250910", name: "web_fetch", max_uses: 12, max_content_tokens: 7000 },
    ];
    const ask2 = brief + "\n\nPLAN DE INVESTIGACIÓN\nPreguntas:\n- " + (plan.preguntas || []).join("\n- ") + "\nBúsquedas sugeridas:\n- " + (plan.busquedas || []).join("\n- ") + "\nAbrir primero:\n" + ((plan.leer || []).concat(j.links || [])).filter((x, i, a) => /^https?:\/\//.test(x) && a.indexOf(x) === i).slice(0, 8).join("\n");
    const p2 = await deepCall(s.anthropicKey, usage, { system: R_SEARCH, messages: [{ role: "user", content: ask2 }], tools, effort: "medium", max: 32000 });
    // Lo que de verdad se vio: resultados de búsqueda y páginas leídas
    const seen = new Map();
    for (const b of p2.blocks) {
      if (b.type === "web_search_tool_result" && Array.isArray(b.content)) for (const r of b.content) if (r && r.url) seen.set(normUrl(r.url), { url: r.url, title: r.title || "", age: r.page_age || "", read: false });
      if (b.type === "web_fetch_tool_result" && b.content && b.content.url) { const k = normUrl(b.content.url), o = seen.get(k) || { url: b.content.url, title: "", age: "" }; o.read = b.content.type === "web_fetch_result"; o.title = o.title || (b.content.content && b.content.content.title) || ""; seen.set(k, o); }
    }
    let raw = []; try { raw = block(textOf(p2.blocks), "hallazgos"); } catch (_) { raw = []; }
    const finds = [], dropped = [];
    for (const f of Array.isArray(raw) ? raw : []) {
      if (!f || !f.hecho) continue;
      const src = seen.get(normUrl(f.url));
      if (!src) { dropped.push(clean(f.hecho, 200)); continue; }   // fuente que la IA no abrió ni encontró: fuera
      finds.push({ id: "F" + (finds.length + 1), hecho: clean(f.hecho, 700), url: src.url, titulo: clean(f.titulo || src.title, 200), fecha: clean(f.fecha || src.age, 60), tema: clean(f.tema, 30), leida: !!src.read });
      if (finds.length >= 45) break;
    }
    const fTxt = finds.map((f) => f.id + " [" + (f.tema || "otro") + "] " + f.hecho + " — " + f.titulo + " " + f.url + (f.fecha ? " (" + f.fecha + ")" : "") + (f.leida ? "" : " [solo resumen del buscador]")).join("\n") || "(no se encontraron hallazgos con fuente)";

    // 3. Analizar
    await step(3, "Analizando competidoras, clientas y oportunidades");
    const models = j.model === "opus" ? ["claude-opus-5-5", "claude-sonnet-5-5"] : ["claude-sonnet-5-5"];
    const p3 = await deepCall(s.anthropicKey, usage, { system: R_ANALYZE, messages: [{ role: "user", content: brief + "\n\nHALLAZGOS DE INTERNET\n" + fTxt }], models, effort: "high", max: 40000 });
    let draft; try { draft = block(textOf(p3.blocks), "informe"); } catch (_) { const e = new Error("el análisis no salió completo"); e.code = "aiparse"; throw e; }

    // 4. Revisar
    await step(4, "Revisando cada dato y cada fuente");
    let reviewed = draft, cambios = [];
    try {
      const p4 = await deepCall(s.anthropicKey, usage, { system: R_REVIEW, messages: [{ role: "user", content: "DATOS INTERNOS\n" + intTxt + "\n\nHALLAZGOS\n" + fTxt + "\n\nINFORME\n" + JSON.stringify(draft) }], effort: "high", max: 40000 });
      const t4 = textOf(p4.blocks);
      reviewed = block(t4, "informe");
      try { const c = String(t4).match(/```cambios\s*([\s\S]*?)(```|$)/i); if (c) cambios = parseJSON(c[1]); } catch (_) {}
    } catch (e) { if (e && /^(aikey|aicredit)$/.test(e.code)) throw e; cambios = ["La revisión no se completó; se aplicó solo la revisión automática de fuentes."]; }

    // 5. Entregar
    await step(5, "Guardando tu informe");
    const ids = new Set(finds.map((f) => f.id).concat(internal.map((x) => x.id)));
    const { r, fixed } = enforce(reviewed, ids);
    if (fixed) cambios.push(fixed + " afirmación(es) sin fuente real pasaron de «dato» a «hipótesis» (revisión automática).");
    if (dropped.length) cambios.push(dropped.length + " hallazgo(s) se descartaron porque su página no apareció en la búsqueda.");
    usage.usd = Math.round(usage.usd * 100) / 100;
    const rid = "r" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const rec = { id: rid, at: Date.now(), bizId: clean(j.bizId, 40), bizName: clean(j.bizName, 120), question: clean(j.question, 2000), model: p3.model, report: r, finds, internal, cambios: (Array.isArray(cambios) ? cambios : []).map((x) => clean(x, 300)).slice(0, 15), usage, plan: { preguntas: (plan.preguntas || []).slice(0, 12).map((x) => clean(x, 300)) } };
    await store("asesor-reports").setJSON(rid, rec);
    await jobs.setJSON(id, { status: "done", result: { report: rid }, at: Date.now() });
  } catch (e) {
    await jobs.setJSON(id, { status: "error", error: /^(ai|noai)/.test(e.code || "") ? e.code : "aifail", message: clean(e.message, 300), at: Date.now(), usage });
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
      return json({ status: j.status, result: j.result, error: j.error, message: j.message, stage: j.stage || 0, note: j.note || "", kind: j.kind || "", started: j.started || 0, usage: j.usage || null });
    }
    /* Investigación profunda: se prepara aquí y trabaja en segundo plano (hasta 15 minutos) */
    if (route === "report-start" && m === "POST") {
      const s = await settings();
      if (!s.anthropicKey) return json({ error: "noai" }, 409);
      const b = await req.json().catch(() => ({}));
      const job = { kind: "report", question: clean(b.question, 2000), biz: clean(b.biz, 12000), bizId: clean(b.bizId, 40), bizName: clean(b.bizName, 120),
        links: (Array.isArray(b.links) ? b.links : []).map((x) => clean(x, 300)).filter((x) => /^https?:\/\//.test(x)).slice(0, 12),
        internal: (Array.isArray(b.internal) ? b.internal : []).map((x) => clean(x, 600)).filter(Boolean).slice(0, 60), model: b.model === "opus" ? "opus" : "sonnet", tz: clean(b.tz, 60) };
      if (!job.question) return json({ error: "bad" }, 400);
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
      await store("asesor-jobs").setJSON(id, Object.assign({ status: "pending", at: Date.now() }, job));
      return json({ job: id });
    }
    if (route === "reports" && m === "GET") {
      const rs = store("asesor-reports"), { blobs } = await rs.list(), out = [];
      for (const x of blobs) { const r = await rs.get(x.key, { type: "json" }); if (r) out.push({ id: r.id, at: r.at, bizId: r.bizId, bizName: r.bizName, question: r.question, titulo: r.report && r.report.titulo, usd: r.usage && r.usage.usd, model: r.model }); }
      out.sort((a, b) => b.at - a.at);
      return json({ reports: out });
    }
    if (route.startsWith("reports/")) {
      const rid = route.slice(8); if (!/^r[a-z0-9]{6,30}$/.test(rid)) return json({ error: "bad" }, 400);
      if (m === "GET") { const r = await store("asesor-reports").get(rid, { type: "json" }); return r ? json(r) : json({ error: "notfound" }, 404); }
      if (m === "DELETE") { await store("asesor-reports").delete(rid); return json({ ok: true }); }
    }

    /* Si tu web no tiene trabajos en segundo plano, lo hacemos directo (más corto y sin internet, para que no se corte). */
    if (route.startsWith("run/") && m === "POST") {
      const id = route.slice(4); if (!/^[a-z0-9]{8,30}$/.test(id)) return json({ error: "bad" }, 400);
      const jobs = store("asesor-jobs"), j = await jobs.get(id, { type: "json" });
      if (!j) return json({ error: "notfound" }, 404);
      if (j.status !== "pending" || j.kind === "report") return json({ status: j.status });
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
