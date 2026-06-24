import { getAdminClient } from "../_shared/admin-client.ts";
import { resolveCaller } from "../_shared/caller-auth.ts";
import { buildCors } from "../_shared/cors.ts";
import { getSolarContextForCustomer } from "../_shared/solar/analyze-service.ts";

/** Retorna resumo de análise solar para injeção na vendedora / bot. */
Deno.serve(async (req) => {
  const cors = buildCors(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  try {
    const admin = getAdminClient("solar-roof-context");
    const caller = await resolveCaller(req, admin);
    if (caller instanceof Response) return caller;

    const body = await req.json().catch(() => ({}));
    const customerId = String(body.customerId ?? "");
    if (!customerId) return json({ error: "customerId obrigatório" }, 400);

    const context = await getSolarContextForCustomer(admin, customerId);
    return json({ ok: true, context });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
