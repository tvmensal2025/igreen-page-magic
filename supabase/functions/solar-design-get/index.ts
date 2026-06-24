import { getAdminClient } from "../_shared/admin-client.ts";
import { assertOwnership, resolveCaller } from "../_shared/caller-auth.ts";
import { buildCors } from "../_shared/cors.ts";
import { SOLAR_DISCLAIMER } from "../_shared/solar/types.ts";

Deno.serve(async (req) => {
  const cors = buildCors(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  try {
    const admin = getAdminClient("solar-design-get");
    const caller = await resolveCaller(req, admin);
    if (caller instanceof Response) return caller;
    if (caller.mode !== "jwt") return json({ error: "unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const snapshotId = String(body.snapshotId ?? body.id ?? "");
    const analysisId = String(body.analysisId ?? "");
    if (!snapshotId && !analysisId) return json({ error: "snapshotId ou analysisId obrigatório" }, 400);

    if (snapshotId) {
      const { data: snap, error } = await admin
        .from("solar_design_snapshots")
        .select("*")
        .eq("id", snapshotId)
        .maybeSingle();
      if (error || !snap) return json({ error: "Não encontrado" }, 404);
      const deny = await assertOwnership(caller, { consultantId: snap.consultant_id }, admin);
      if (deny) return deny;

      const { data: analysis } = await admin
        .from("solar_roof_analyses")
        .select("latitude, longitude, imagery_quality, address_text, building_insights, imagery_view, consultant_id")
        .eq("id", snap.analysis_id)
        .maybeSingle();

      return json({
        snapshot: {
          id: snap.id,
          analysisId: snap.analysis_id,
          panelsCount: snap.panels_count,
          systemKwp: snap.system_kwp,
          yearlyEnergyKwh: snap.yearly_energy_kwh,
          monthlySavingsCents: snap.monthly_savings_cents,
          roofSegments: snap.roof_segments,
          panelPositions: snap.panel_positions,
          salesBlurb: snap.sales_blurb,
          label: snap.label,
        },
        analysis: analysis
          ? {
            lat: analysis.latitude,
            lng: analysis.longitude,
            imageryQuality: analysis.imagery_quality,
            addressText: analysis.address_text,
            imagery: analysis.imagery_view ?? null,
            consultantId: analysis.consultant_id ?? null,
          }
          : null,
        disclaimer: SOLAR_DISCLAIMER,
      });
    }

    const { data: analyses, error: aErr } = await admin
      .from("solar_roof_analyses")
      .select("id, address_text, imagery_quality, max_panels, system_kwp:max_yearly_kwh, created_at, latitude, longitude")
      .eq("id", analysisId)
      .eq("consultant_id", caller.consultantId)
      .maybeSingle();
    if (aErr || !analyses) return json({ error: "Não encontrado" }, 404);

    const { data: snapshots } = await admin
      .from("solar_design_snapshots")
      .select("id, panels_count, system_kwp, label, created_at")
      .eq("analysis_id", analysisId)
      .order("created_at", { ascending: false });

    return json({ analysis: analyses, snapshots: snapshots ?? [] });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
