// PageBloom para varias clientas: cada clienta tiene sus datos aparte.
// Tus datos (la dueña) siguen donde siempre; los de cada clienta van en almacenes con su nombre: «t-<clienta>-panel», «t-<clienta>-leads»…
import { getStore } from "@netlify/blobs";
import { AsyncLocalStorage } from "node:async_hooks";

export const TCTX = new AsyncLocalStorage();
// Fotos, videos y PDFs públicos se guardan juntos (sus nombres son únicos); la plataforma tiene su propio almacén.
const SHARED = new Set(["img", "video", "pdf", "pdfparts", "platform"]);
export const tenant = () => (TCTX.getStore() || {}).t || "";
export const store = (name) => {
  const t = tenant();
  return getStore({ name: t && !SHARED.has(name) ? "t-" + t + "-" + name : name, consistency: "strong" });
};
export const withTenant = (t, fn, lang) => TCTX.run({ t: t || "", lang: lang || "" }, fn);
// Idioma del panel de quien pide (para que la IA conteste en inglés si el panel está en inglés)
export const panelLang = () => (TCTX.getStore() || {}).lang || "";
export const setPanelLang = (l) => { const s = TCTX.getStore(); if (s) s.lang = l === "en" ? "en" : ""; };
export const EN_RULE = "\n\nIMPORTANT: The person's panel is in English. Write every text meant for her (including every JSON value) in natural US English, even though these instructions are in Spanish. Keep JSON keys and any fixed code values the instructions list as options (for example type labels like dato, hipotesis, recomendacion, or ids) exactly as specified; only free text changes language. If the instructions explicitly ask for a specific text in another language (for example a translation or a Spanish version), follow that for that text.";
export const platform = () => getStore({ name: "platform", consistency: "strong" });

const enc = new TextEncoder();
export async function sha(s) {
  const b = await crypto.subtle.digest("SHA-256", enc.encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
export async function hashPw(pw, salt) {
  const key = await crypto.subtle.importKey("raw", enc.encode(pw), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: enc.encode(salt), iterations: 100000 }, key, 256);
  return [...new Uint8Array(bits)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
export const RESERVED = new Set(["api", "s", "img", "pdf", "video", "popup", "panel", "registro", "admin", "app", "www", "login", "entrar", "privacidad", "privacy", "index", "plataforma", "pagebloom", "soporte", "ayuda", "stickers", "asesor-api", "api-bg"]);
export const DAY = 86400000;

export async function getTenant(slug) {
  if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(String(slug || ""))) return null;
  return platform().get("t:" + slug, { type: "json" }).catch(() => null);
}
export const saveTenant = (t) => platform().setJSON("t:" + t.slug, t);

export async function platSettings() {
  return (await platform().get("settings", { type: "json" }).catch(() => null)) || {};
}
// Estado del plan de una clienta: prueba, activa, gracia (pago fallido), regalo, pausada o vencida.
export function planState(t, now = Date.now()) {
  if (!t) return { ok: false, state: "none" };
  if (t.paused) return { ok: false, state: "paused" };
  if (t.comp) return { ok: true, state: "comp" };
  const ss = t.subStatus || "";
  if (ss === "active" || ss === "trialing") return { ok: true, state: ss === "trialing" ? "trial" : "active", daysLeft: ss === "trialing" && t.periodEnd ? Math.max(0, Math.ceil((t.periodEnd - now) / DAY)) : undefined, paid: true };
  if ((ss === "past_due" || ss === "unpaid") && t.failedAt && now - t.failedAt < 7 * DAY) return { ok: true, state: "grace", daysLeft: Math.max(0, Math.ceil((t.failedAt + 7 * DAY - now) / DAY)), paid: true };
  if (t.trialEnds && now < t.trialEnds) return { ok: true, state: "trial", daysLeft: Math.max(0, Math.ceil((t.trialEnds - now) / DAY)) };
  return { ok: false, state: "expired" };
}

// Sesiones de las clientas (30 días)
export async function newSession(slug) {
  const tok = [...crypto.getRandomValues(new Uint8Array(32))].map((x) => x.toString(16).padStart(2, "0")).join("");
  await platform().setJSON("s:" + (await sha(tok)), { slug, exp: Date.now() + 30 * DAY });
  return tok;
}
export async function sessionTenant(req) {
  const tok = req.headers.get("x-pb-session") || "";
  if (!/^[a-f0-9]{64}$/.test(tok)) return null;
  const s = await platform().get("s:" + (await sha(tok)), { type: "json" }).catch(() => null);
  if (!s || s.exp < Date.now()) return null;
  return getTenant(s.slug);
}
export async function endSession(req) {
  const tok = req.headers.get("x-pb-session") || "";
  if (/^[a-f0-9]{64}$/.test(tok)) await platform().delete("s:" + (await sha(tok))).catch(() => {});
}
export async function listTenants() {
  const p = platform(), { blobs } = await p.list({ prefix: "t:" });
  return (await Promise.all(blobs.map((b) => p.get(b.key, { type: "json" }).catch(() => null)))).filter(Boolean);
}
