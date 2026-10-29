// Cada 15 minutos revisa si hay correos programados que ya deben salir.
import { getStore } from "@netlify/blobs";

export default async () => {
  const s = (await getStore({ name: "panel", consistency: "strong" }).get("settings", { type: "json" })) || {};
  const site = process.env.URL || process.env.DEPLOY_PRIME_URL;
  if (!s.secret || !site) return;
  await fetch(site.replace(/\/$/, "") + "/api/cron-tick", { method: "POST", headers: { "x-cron": s.secret } }).catch(() => {});
};

export const config = { schedule: "*/15 * * * *" };
