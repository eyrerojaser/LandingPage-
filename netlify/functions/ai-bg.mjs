// La IA trabajando «en segundo plano» (hasta 15 minutos), para que las respuestas largas no se corten.
import { getStore } from "@netlify/blobs";
const store = (name) => getStore({ name, consistency: "strong" });
const AI_STRATEGY = "Eres una estratega senior de marketing y ventas para emprendedoras que venden productos digitales. Trabajas SOLO con los datos reales que te dan (perfil, productos, precios, páginas, números). Reglas: 1) Nada genérico: cada idea nombra el producto, la clienta y el canal concretos. 2) Cada recomendación dice exactamente qué hacer, dónde y cuándo. 3) Usa los números reales y haz las cuentas; si falta un dato, haz una suposición conservadora y dila. 4) Prohibido: 'crea contenido de valor', 'conoce a tu audiencia', 'sé constante', 'aporta valor' y frases parecidas. 5) Escribe claro, cálido y directo, sin relleno. Respondes SOLO con JSON válido, sin markdown.";
const AI_SYSTEM = "Eres la redactora de marketing de una emprendedora que vende productos digitales (planners, guías, plantillas) a mujeres. Escribes con calidez, claridad y frases cortas, sin exagerar ni usar clichés. Respondes SOLO con JSON válido, sin explicaciones ni markdown.";
const AI_COACH = "Eres la directora creativa y coach de contenido de una emprendedora que vende productos digitales a mujeres. Ella muchas veces no sabe qué decir: tú le das el contenido listo para grabar o publicar. Reglas: 1) Escribe como habla ella: cercana, cálida, frases cortas, en primera persona, nada de clichés de marketing. 2) Todo concreto y usable tal cual: palabras exactas que decir, qué mostrar en pantalla, cuánto dura cada parte. 3) Conecta el tema con sus productos y páginas reales cuando tenga sentido, sin sonar a anuncio. 4) Recomendaciones prácticas y específicas (formato, hora, cómo grabarlo con el teléfono), nunca genéricas. 5) Si te da un idioma, escribe en ese idioma. Respondes SOLO con JSON válido, sin markdown.";
async function askClaude(s, system, prompt, maxTokens, best) {
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
  const m = String(text).match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  return JSON.parse(m ? m[0] : text);
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
    let result; try { result = parseJSON(text); } catch (_) { await jobs.setJSON(id, { status: "error", error: "aiparse" }); return; }
    await jobs.setJSON(id, { status: "done", result });
  } catch (e) {
    await jobs.setJSON(id, { status: "error", error: /^ai/.test(e.code || "") ? e.code : "aifail", message: String(e.message).slice(0, 300) });
  }
};

export const config = { path: "/api-bg/ai", background: true };
