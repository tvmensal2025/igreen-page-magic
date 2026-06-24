import { getAdminClient } from "../_shared/admin-client.ts";
import { resolveCaller } from "../_shared/caller-auth.ts";
import { buildCors } from "../_shared/cors.ts";
import { geocodeAddress } from "../_shared/solar/google-geocode.ts";
import { getGoogleApiKey, useMockMode } from "../_shared/solar/google-solar-client.ts";

Deno.serve(async (req) => {
  const cors = buildCors(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  try {
    const admin = getAdminClient("solar-geocode");
    const caller = await resolveCaller(req, admin);
    if (caller instanceof Response) return caller;
    if (caller.mode !== "jwt") return json({ error: "unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const addressText = String(body.addressText ?? "").trim();
    if (!addressText) return json({ error: "addressText obrigatório" }, 400);

    if (useMockMode()) {
      return json({ ok: true, mock: true, lat: -23.5505, lng: -46.6333, formattedAddress: addressText });
    }
    const key = getGoogleApiKey();
    if (!key) return json({ error: "API Google não configurada" }, 503);
    const result = await geocodeAddress(addressText, key);
    return json({ ok: true, mock: false, ...result });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
