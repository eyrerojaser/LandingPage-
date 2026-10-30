// La IA trabajando «en segundo plano» (hasta 15 minutos), para que las respuestas largas no se corten.
import { getStore } from "@netlify/blobs";
const store = (name) => getStore({ name, consistency: "strong" });
const AI_STRATEGY = "Eres una estratega senior de marketing y ventas para emprendedoras que venden productos digitales. Trabajas SOLO con los datos reales que te dan (perfil, productos, precios, páginas, números). Reglas: 1) Nada genérico: cada idea nombra el producto, la clienta y el canal concretos. 2) Cada recomendación dice exactamente qué hacer, dónde y cuándo. 3) Usa los números reales y haz las cuentas; si falta un dato, haz una suposición conservadora y dila. 4) Prohibido: 'crea contenido de valor', 'conoce a tu audiencia', 'sé constante', 'aporta valor' y frases parecidas. 5) Escribe claro, cálido y directo, sin relleno. Respondes SOLO con JSON válido, sin markdown.";
const AI_SYSTEM = "Eres la redactora de marketing de una emprendedora que vende productos digitales (planners, guías, plantillas) a mujeres. Escribes con calidez, claridad y frases cortas, sin exagerar ni usar clichés. Respondes SOLO con JSON válido, sin explicaciones ni markdown.";
const AI_COACH = "Eres la directora creativa y coach de contenido de una emprendedora que vende productos digitales a mujeres. Ella muchas veces no sabe qué decir: tú le das el contenido listo para grabar o publicar. Reglas: 1) Escribe como habla ella: cercana, cálida, frases cortas, en primera persona, nada de clichés de marketing. 2) Todo concreto y usable tal cual: palabras exactas que decir, qué mostrar en pantalla, cuánto dura cada parte. 3) Conecta el tema con sus productos y páginas reales cuando tenga sentido, sin sonar a anuncio. 4) Recomendaciones prácticas y específicas (formato, hora, cómo grabarlo con el teléfono), nunca genéricas. 5) Si te da un idioma, escribe en ese idioma. Respondes SOLO con JSON válido, sin markdown.";
async function askClaude(s, system, prompt, maxTokens, best) {
  // Los modelos Claude 5.5 «piensan» antes de responder y ese pensamiento gasta parte de max_tokens.
  // Con un límite pequeño se quedaban sin espacio y no llegaban a escribir la respuesta («La IA respondió algo raro»).
  // Por eso: en Haiku apagamos el pensamiento; en Sonnet (que no deja apagarlo) le damos un esfuerzo medio y mucho más espacio.
  const models = best ? ["claude-sonnet-5-5", "claude-haiku-5-5"] : ["claude-haiku-5-5", "claude-sonnet-5-5"];
  const want = maxTokens || 1500;
  let last;
  for (const model of models) {
    const haiku = /haiku/.test(model);
    let body = { model, max_tokens: haiku ? want : Math.min(want + 8000, 32000), system, messages: [{ role: "user", content: prompt }] };
    if (haiku) body.thinking = { type: "disabled" }; else body.output_config = { effort: "medium" };
    for (let round = 0; round < 3; round++) {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": s.anthropicKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (r.ok) {
        const d = await r.json();
        const text = (d.content || []).filter((c) => c.type === "text").map((c) => c.text || "").join("");
        if (d.stop_reason === "refusal") { const e = new Error("la IA no quiso responder a esta petición"); e.code = "aifail"; throw e; }
        // Si se cortó por largo, la pedimos otra vez con más espacio.
        if (d.stop_reason === "max_tokens" && round < 2 && body.max_tokens < 32000) { body = { ...body, max_tokens: Math.min(body.max_tokens * 2 + 4000, 32000) }; continue; }
        if (d.stop_reason === "max_tokens" && !text.trim()) { const e = new Error("respuesta cortada por largo"); e.code = "aiparse"; throw e; }
        return text;
      }
      const txt = (await r.text()).slice(0, 400);
      last = { status: r.status, txt };
      // Si este modelo no acepta alguna opción (pensamiento o esfuerzo), lo intentamos sin ella.
      if (r.status === 400 && /thinking|output_config|effort/i.test(txt) && (body.thinking || body.output_config)) { body = { ...body }; delete body.thinking; delete body.output_config; body.max_tokens = Math.min(want + 8000, 32000); continue; }
      break;
    }
    if (!last || last.status === 200) continue;
    if (last.status !== 404 && !(last.status === 400 && /model/i.test(last.txt))) break;
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

export default async (req) => {
  const b = await req.json().catch(() => ({}));
  const id = String(b.job || "");
  if (!/^[a-z0-9]{8,30}$/.test(id)) return;
  const jobs = store("aijobs"), j = await jobs.get(id, { type: "json" });
  if (!j || j.status !== "pending") return;
  await jobs.setJSON(id, { ...j, status: "working" });
  const s = (await store("panel").get("settings", { type: "json" })) || {};
  if (!s.anthropicKey) { await jobs.setJSON(id, { status: "error", error: "noai" }); return; }
  try {
    const text = await askClaude(s, j.mode === "strategy" ? AI_STRATEGY : j.mode === "coach" ? AI_COACH : AI_SYSTEM, j.prompt, j.max, j.mode === "coach");
    let result; try { result = parseJSON(text); } catch (_) { await jobs.setJSON(id, { status: "error", error: "aiparse", message: "no se pudo leer: " + String(text).slice(0, 160) }); return; }
    await jobs.setJSON(id, { status: "done", result });
  } catch (e) {
    await jobs.setJSON(id, { status: "error", error: /^ai/.test(e.code || "") ? e.code : "aifail", message: String(e.message).slice(0, 300) });
  }
};

export const config = { path: "/api-bg/ai", background: true };
