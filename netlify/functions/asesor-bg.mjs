// Business Growth AI trabajando «en segundo plano» (hasta 15 minutos), para que las investigaciones con internet no se corten.
import { runJob } from "./asesor.mjs";
import { withTenant, getTenant } from "../lib/tenant.mjs";

export default async (req) => {
  const b = await req.json().catch(() => ({}));
  const id = String(b.job || "");
  if (!/^[a-z0-9]{8,30}$/.test(id)) return;
  const t = b.pbt ? await getTenant(b.pbt) : null;
  if (b.pbt && !t) return;
  await withTenant(t ? t.slug : "", () => runJob(id));
};

export const config = { path: "/asesor-api-bg/run", background: true };
