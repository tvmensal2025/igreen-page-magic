// voice-dialer-health
// Health-check da conexão Velip para o banner do painel Admin → Ligação.

import { buildCors } from "../_shared/cors.ts";
import {
  getUserID,
  velipConfigured,
  velipWebhookAuthConfigured,
} from "../_shared/voice-dialer/velip.ts";

Deno.serve(async (req) => {
  const cors = buildCors(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });

  if (!velipConfigured()) {
    return json(200, {
      ok: false,
      configured: false,
      webhook_configured: velipWebhookAuthConfigured(),
      message: "VELIP_API_TOKEN não configurado.",
    });
  }

  const r = await getUserID();
  return json(200, {
    ok: r.ok,
    configured: true,
    webhook_configured: velipWebhookAuthConfigured(),
    saldo: r.saldo ?? null,
    error: r.ok ? null : r.error ?? "unknown_error",
    driver: "velip",
  });
});
