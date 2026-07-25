// Fase 5 — Retargeting Meta automático (job em lote).
// Sobe telefone/email (SHA256) de leads em CLOSE_LOST / RETARGET_META / RETARGET_ADS_15D
// para a Custom Audience configurada em facebook_connections.custom_audience_id.
// Sync pontual por lead também existe em cadence-tick via _shared/meta-audience-sync.ts.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { authConsultant } from "../_shared/fb-graph.ts";
import { isAutomationEnabled, logSkipped } from "../_shared/automation-gate.ts";
import {
  assertCronAuthStrict,
  cronAuthUnauthorized,
} from "../_shared/cron-auth.ts";
import { buildCors } from "../_shared/cors.ts";

// `audience_sync` é human-only na policy central: subir telefone/e-mail para
// Custom Audience nunca roda por cron neste hardening. O clique do consultor no
// MetaAudiencePanel continua valendo, porque aí existe decisão humana explícita.

const GRAPH = "https://graph.facebook.com/v20.0";

const RETARGET_STAGES = [
  "CLOSE_LOST",
  "RETARGET_META",
  "RETARGET_ADS_15D",
] as const;

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(s),
  );
  return Array.from(new Uint8Array(buf)).map((b) =>
    b.toString(16).padStart(2, "0")
  ).join("");
}

function normPhone(p: string | null): string | null {
  if (!p) return null;
  const d = p.replace(/\D/g, "");
  if (d.length < 10) return null;
  return d.startsWith("55") ? d : "55" + d;
}
function normEmail(e: string | null): string | null {
  if (!e) return null;
  const t = e.trim().toLowerCase();
  return t.includes("@") ? t : null;
}

function phoneDdd(ph: string | null): string | null {
  if (!ph) return null;
  const d = ph.replace(/\D/g, "");
  const local = d.startsWith("55") ? d.slice(2) : d;
  if (local.length < 10) return null;
  return local.slice(0, 2);
}

Deno.serve(async (req) => {
  const corsHeaders = buildCors(req, "x-service-secret, x-internal-secret");
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  // Cron (credencial de serviço) ou clique do consultor no MetaAudiencePanel (JWT).
  const cronAuth = await assertCronAuthStrict(req, admin);
  const caller = cronAuth.ok ? null : await authConsultant(req);
  if (!cronAuth.ok && !caller) {
    return cronAuthUnauthorized(cronAuth.reason, corsHeaders);
  }

  if (!(await isAutomationEnabled(admin, "facebook_retarget_sync"))) {
    await logSkipped(admin, "facebook_retarget_sync");
    return new Response(
      JSON.stringify({
        skipped: "automation_disabled",
        key: "facebook_retarget_sync",
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  const { data: flag } = await admin.from("app_settings").select(
    "retarget_enabled",
  ).limit(1).maybeSingle();
  if (flag && flag.retarget_enabled === false) {
    return new Response(JSON.stringify({ ok: true, skipped: "disabled" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Sem decisão humana no request, não sobe dado pessoal para a Meta.
  if (!caller) {
    return new Response(
      JSON.stringify({ ok: true, skipped: "audience_sync_requires_human" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const { data: conns } = await admin
    .from("facebook_connections")
    .select(
      "consultant_id, access_token_encrypted, custom_audience_id, ad_account_id",
    )
    .not("custom_audience_id", "is", null)
    .eq("status", "active");

  const { decryptToken } = await import("../_shared/fb-crypto.ts");
  const { loadPlatformAccount } = await import("../_shared/fb-graph.ts");
  const results: Array<
    {
      consultant_id: string;
      audience_id: string;
      added: number;
      error?: string;
    }
  > = [];

  // Fallback: conta da plataforma (Custom Audience compartilhada).
  type SyncTarget = {
    consultant_id: string | null;
    custom_audience_id: string;
    token: string;
    scope: "consultant" | "platform";
  };
  const targets: SyncTarget[] = [];

  for (const c of conns ?? []) {
    if (!c.access_token_encrypted || !c.custom_audience_id) continue;
    try {
      targets.push({
        consultant_id: c.consultant_id,
        custom_audience_id: c.custom_audience_id,
        token: await decryptToken(c.access_token_encrypted),
        scope: "consultant",
      });
    } catch (_) { /* token inválido */ }
  }

  if (targets.length === 0) {
    const platform = await loadPlatformAccount();
    const { data: pf } = await admin
      .from("platform_facebook_account")
      .select("custom_audience_id")
      .eq("id", true)
      .maybeSingle();
    if (platform?.token && pf?.custom_audience_id) {
      targets.push({
        consultant_id: null,
        custom_audience_id: pf.custom_audience_id,
        token: platform.token,
        scope: "platform",
      });
    }
  }

  const { data: pfDdd } = await admin
    .from("platform_facebook_account")
    .select("retarget_ddd_allowlist")
    .eq("id", true)
    .maybeSingle();
  const dddAllow: number[] | null =
    Array.isArray((pfDdd as any)?.retarget_ddd_allowlist) &&
      (pfDdd as any).retarget_ddd_allowlist.length
      ? (pfDdd as any).retarget_ddd_allowlist.map(Number).filter((n: number) =>
        n >= 11 && n <= 99
      )
      : null;

  for (const c of targets) {
    const cutoff = new Date(Date.now() - 90 * 86400_000).toISOString();
    let leadsQuery = admin
      .from("lead_cadence_state")
      .select(
        "customer_id, stage, updated_at, customer:customers!inner(id, consultant_id, phone_whatsapp, email)",
      )
      .in("stage", [...RETARGET_STAGES])
      .gte("updated_at", cutoff)
      .limit(5000);
    if (c.consultant_id) {
      leadsQuery = leadsQuery.eq("customer.consultant_id", c.consultant_id);
    }
    const { data: leads } = await leadsQuery;

    const labelId = c.consultant_id || "platform";
    if (!leads?.length) {
      results.push({
        consultant_id: labelId,
        audience_id: c.custom_audience_id,
        added: 0,
      });
      continue;
    }

    const ids = leads.map((l) => l.customer_id);
    const { data: optouts } = await admin
      .from("customers")
      .select("id")
      .in("id", ids)
      .eq("do_not_contact", true);
    const blocked = new Set((optouts ?? []).map((o: { id: string }) => o.id));

    const rows: Array<[string, string]> = [];
    const acceptedIds: string[] = [];
    const logRows: Array<Record<string, unknown>> = [];
    for (const l of leads) {
      if (blocked.has(l.customer_id)) continue;
      const cust = Array.isArray(l.customer) ? l.customer[0] : l.customer;
      const ph = normPhone(cust?.phone_whatsapp ?? null);
      const em = normEmail(cust?.email ?? null);
      const ddd = phoneDdd(ph);
      if (dddAllow && dddAllow.length) {
        const dddNum = ddd ? Number(ddd) : NaN;
        if (!Number.isFinite(dddNum) || !dddAllow.includes(dddNum)) {
          logRows.push({
            audience_id: c.custom_audience_id,
            customer_id: l.customer_id,
            consultant_id: cust?.consultant_id || c.consultant_id || null,
            source: "bulk_retarget",
            ok: false,
            detail: `ddd_filtered:${ddd || "none"}`,
            phone_ddd: ddd,
          });
          continue;
        }
      }
      const phH = ph ? await sha256Hex(ph) : "";
      const emH = em ? await sha256Hex(em) : "";
      if (phH || emH) {
        rows.push([phH, emH]);
        acceptedIds.push(l.customer_id);
        logRows.push({
          audience_id: c.custom_audience_id,
          customer_id: l.customer_id,
          consultant_id: cust?.consultant_id || c.consultant_id || null,
          source: "bulk_retarget",
          ok: true,
          detail: "queued",
          phone_ddd: ddd,
        });
      }
    }
    if (!rows.length) {
      if (logRows.length) {
        await admin.from("meta_audience_sync_log").insert(logRows);
      }
      results.push({
        consultant_id: labelId,
        audience_id: c.custom_audience_id,
        added: 0,
      });
      continue;
    }

    try {
      const payload = { schema: ["PHONE", "EMAIL"], data: rows };
      const url = `${GRAPH}/${c.custom_audience_id}/users?access_token=${
        encodeURIComponent(c.token)
      }`;
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payload }),
      });
      const body = await resp.json();
      if (!resp.ok) throw new Error(JSON.stringify(body));

      if (c.scope === "consultant" && c.consultant_id) {
        await admin.from("facebook_connections").update({
          audience_synced_at: new Date().toISOString(),
          audience_source_count: rows.length,
        }).eq("consultant_id", c.consultant_id);
      } else {
        await admin.from("platform_facebook_account").update({
          audience_synced_at: new Date().toISOString(),
          audience_source_count: rows.length,
        }).eq("id", true);
      }

      const retargetMetaDue = new Date(Date.now() + 24 * 3600_000)
        .toISOString();
      await admin.from("lead_cadence_state").update({
        stage: "RETARGET_META",
        next_action_at: retargetMetaDue,
      })
        .in("customer_id", acceptedIds)
        .eq("stage", "CLOSE_LOST");

      await admin.from("cadence_action_log").insert({
        customer_id: acceptedIds[0],
        stage: "RETARGET_META",
        channel: "meta_audience",
        status: "sent",
        cost_cents: 0,
        detail: {
          synced: rows.length,
          audience_id: c.custom_audience_id,
          consultant_id: c.consultant_id,
          scope: c.scope,
          stages: [...RETARGET_STAGES],
          ddd_allowlist: dddAllow,
        },
      });

      // Marca ok no log (já montados como queued → synced)
      for (const r of logRows) {
        if (r.ok) r.detail = "synced";
      }
      if (logRows.length) {
        await admin.from("meta_audience_sync_log").insert(logRows);
      }

      results.push({
        consultant_id: labelId,
        audience_id: c.custom_audience_id,
        added: rows.length,
      });
    } catch (e) {
      for (const r of logRows) {
        if (r.ok) {
          r.ok = false;
          r.detail = `graph_error:${
            String((e as Error).message).slice(0, 120)
          }`;
        }
      }
      if (logRows.length) {
        await admin.from("meta_audience_sync_log").insert(logRows);
      }
      results.push({
        consultant_id: labelId,
        audience_id: c.custom_audience_id,
        added: 0,
        error: String((e as Error).message).slice(0, 200),
      });
    }
  }

  return new Response(JSON.stringify({ ok: true, results }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
