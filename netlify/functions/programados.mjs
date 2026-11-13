// Cada 15 minutos revisa si hay correos programados que ya deben salir: los tuyos y los de cada clienta activa.
import { getStore } from "@netlify/blobs";
import { listTenants, planState } from "../lib/tenant.mjs";

export default async () => {
  const site = (process.env.URL || process.env.DEPLOY_PRIME_URL || "").replace(/\/$/, "");
  if (!site) return;
  const tick = async (t) => {
    const s = (await getStore({ name: t ? "t-" + t + "-panel" : "panel", consistency: "strong" }).get("settings", { type: "json" }).catch(() => null)) || {};
    if (!s.secret) return;
    // Solo si hay algo esperando, para no despertar a todas las clientas cada vez
    const ob = (await getStore({ name: t ? "t-" + t + "-panel" : "panel", consistency: "strong" }).get("outbox", { type: "json" }).catch(() => null)) || {};
    if (!(ob.items || []).some((x) => x.status === "queued" && x.sendAt <= Date.now())) return;
    await fetch(site + "/api/cron-tick" + (t ? "?pbt=" + t : ""), { method: "POST", headers: { "x-cron": s.secret } }).catch(() => {});
  };
  await tick("");
  const all = await listTenants().catch(() => []);
  for (const t of all) if (planState(t).ok) await tick(t.slug);
};

export const config = { schedule: "*/15 * * * *" };
