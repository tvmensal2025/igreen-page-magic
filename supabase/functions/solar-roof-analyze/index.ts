import { getAdminClient } from "../_shared/admin-client.ts";
import { assertOwnership, resolveCaller } from "../_shared/caller-auth.ts";
import { buildCors } from "../_shared/cors.ts";
import { analyzeRoof, updateSnapshotPanels, saveManualSketch } from "../_shared/solar/analyze-service.ts";
import { checkConsultantRateLimit } from "../_shared/solar/rate-limit.ts";

Deno.serve(async (req) => {
  const cors = buildCors(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  try {
    const admin = getAdminClient("solar-roof-analyze");
    const caller = await resolveCaller(req, admin);
    if (caller instanceof Response) return caller;
    if (caller.mode !== "jwt") return json({ error: "unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "analyze");

    if (action === "updatePanels") {
      const snapshotId = String(body.snapshotId ?? "");
      const panelsCount = Number(body.panelsCount);
      if (!snapshotId || !Number.isFinite(panelsCount)) {
        return json({ error: "snapshotId e panelsCount obrigatórios" }, 400);
      }
      const metrics = await updateSnapshotPanels(admin, snapshotId, caller.consultantId, panelsCount);
      return json({ ok: true, metrics });
    }

    if (action === "saveManualSketch") {
      const snapshotId = String(body.snapshotId ?? "");
      const widthM = Number(body.widthM);
      const depthM = Number(body.depthM);
      if (!snapshotId || !Number.isFinite(widthM) || !Number.isFinite(depthM)) {
        return json({ error: "snapshotId, widthM e depthM obrigatórios" }, 400);
      }
      const metrics = await saveManualSketch(admin, snapshotId, caller.consultantId, { widthM, depthM });
      return json({ ok: true, metrics: metrics.metrics, salesBlurb: metrics.salesBlurb });
    }

    const customerId = body.customerId ? String(body.customerId) : null;
    if (customerId) {
      const deny = await assertOwnership(caller, { customerId }, admin);
      if (deny) return deny;
    }

    const { data: consultant } = await admin
      .from("consultants")
      .select("solar_3d_enabled")
      .eq("id", caller.consultantId)
      .maybeSingle();
    const enabled = consultant?.solar_3d_enabled === true || caller.isAdmin;
    if (!enabled && !body.allowExperiment) {
      return json({ error: "Módulo solar não habilitado para este consultor" }, 403);
    }

    if (!body.forceRefresh) {
      const allowed = await checkConsultantRateLimit(admin, caller.consultantId);
      if (!allowed) return json({ error: "Limite diário de análises atingido" }, 429);
    }

    const result = await analyzeRoof(admin, {
      consultantId: caller.consultantId,
      customerId,
      addressText: body.addressText ? String(body.addressText) : null,
      lat: body.lat != null ? Number(body.lat) : null,
      lng: body.lng != null ? Number(body.lng) : null,
      forceRefresh: body.forceRefresh === true,
      panelsCount: body.panelsCount != null ? Number(body.panelsCount) : null,
      electricityBillValue: body.electricityBillValue != null ? Number(body.electricityBillValue) : null,
      includeDataLayers: body.includeDataLayers === true,
      uf: body.uf ? String(body.uf) : null,
      distribuidora: body.distribuidora ? String(body.distribuidora) : null,
      monthlyConsumptionKwh: body.monthlyConsumptionKwh != null ? Number(body.monthlyConsumptionKwh) : null,
    });

    return json(result);
  } catch (e) {
    const err = e as { error?: { message?: string }; message?: string };
    const msg = err?.error?.message ?? err?.message ?? "Erro na análise solar";
    return json({ error: msg, code: err?.error?.status ?? "ANALYZE_FAILED" }, 502);
  }
});
