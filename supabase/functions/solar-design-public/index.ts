import { getAdminClient } from "../_shared/admin-client.ts";
import { buildCors } from "../_shared/cors.ts";
import { SOLAR_DISCLAIMER } from "../_shared/solar/types.ts";

Deno.serve(async (req) => {
  const cors = buildCors(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  try {
    const body = await req.json().catch(() => ({}));
    const token = String(body.token ?? "").trim();
    // AUD-011: snapshotId sozinho era IDOR. Exige public_token da proposta.
    if (!token) {
      return json({ error: "token obrigatório" }, 400);
    }

    const admin = getAdminClient("solar-design-public");

    const { data: proposal } = await admin
      .from("proposals")
      .select("solar_snapshot_id, status")
      .eq("public_token", token)
      .maybeSingle();
    if (!proposal?.solar_snapshot_id) return json({ solar: null });

    const resolvedSnapshotId = proposal.solar_snapshot_id;

    const { data: snap } = await admin
      .from("solar_design_snapshots")
      .select(
        "panels_count, system_kwp, yearly_energy_kwh, monthly_savings_cents, roof_segments, panel_positions, sales_blurb, analysis_id",
      )
      .eq("id", resolvedSnapshotId)
      .maybeSingle();
    if (!snap) return json({ solar: null });

    const { data: analysis } = await admin
      .from("solar_roof_analyses")
      .select("imagery_quality, address_text, imagery_view, consultant_id")
      .eq("id", snap.analysis_id)
      .maybeSingle();

    return json({
      solar: {
        panelsCount: snap.panels_count,
        systemKwp: snap.system_kwp,
        yearlyEnergyKwh: snap.yearly_energy_kwh,
        monthlySavingsCents: snap.monthly_savings_cents,
        roofSegments: snap.roof_segments,
        panelPositions: snap.panel_positions,
        salesBlurb: snap.sales_blurb,
        imageryQuality: analysis?.imagery_quality ?? "UNKNOWN",
        addressCity: analysis?.address_text?.split(",").slice(-3, -1).join(",") ?? null,
        disclaimer: SOLAR_DISCLAIMER,
        imagery: analysis?.imagery_view ?? null,
        consultantId: analysis?.consultant_id ?? null,
        analysisId: snap.analysis_id ?? null,
      },
    });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
