import { getAdminClient } from "../_shared/admin-client.ts";
import { buildCors } from "../_shared/cors.ts";
import { analyzeRoof } from "../_shared/solar/analyze-service.ts";
import { checkPublicRateLimit } from "../_shared/solar/rate-limit.ts";

async function hashIp(value: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

Deno.serve(async (req) => {
  const cors = buildCors(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  try {
    const admin = getAdminClient("solar-roof-public");
    const body = await req.json().catch(() => ({}));

    const consultantId = String(body.consultantId ?? "");
    const addressText = String(body.addressText ?? "").trim();
    if (!consultantId || !addressText) {
      return json({ error: "consultantId e addressText obrigatórios" }, 400);
    }

    const { data: consultant } = await admin
      .from("consultants")
      .select("solar_3d_enabled, solar_public_widget_enabled")
      .eq("id", consultantId)
      .maybeSingle();

    if (!consultant?.solar_3d_enabled && !consultant?.solar_public_widget_enabled) {
      return json({ error: "Prévia solar não disponível" }, 403);
    }

    const forwarded = req.headers.get("x-forwarded-for") ?? req.headers.get("cf-connecting-ip") ?? "unknown";
    const ipHash = await hashIp(forwarded);
    const allowed = await checkPublicRateLimit(admin, ipHash);
    if (!allowed) return json({ error: "Limite de prévias diárias atingido. Fale com o consultor." }, 429);

    const result = await analyzeRoof(admin, {
      consultantId,
      addressText,
      electricityBillValue: body.electricityBillValue != null ? Number(body.electricityBillValue) : null,
      includeDataLayers: false,
    });

    return json({
      ok: true,
      panelsCount: result.metrics.panelsCount,
      systemKwp: result.metrics.systemSizeKwp,
      yearlyEnergyKwh: result.metrics.yearlyEnergyKwh,
      monthlySavingsCents: result.metrics.estimatedMonthlySavingsCents,
      imageryQuality: result.imageryQuality,
      panelPositions: result.panelPositions,
      roofSegments: result.roofSegments,
      disclaimer: result.disclaimer,
      salesBlurb: result.salesBlurb,
      snapshotId: result.snapshotId,
      imagery: result.imagery,
      consultantId,
    });
  } catch (e) {
    return json({ error: (e as Error).message }, 502);
  }
});
