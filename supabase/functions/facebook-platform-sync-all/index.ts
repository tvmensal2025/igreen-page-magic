// Orquestra sync completa da plataforma: lista assets (valida/vincula pixel), saldo, métricas e audiências.
// Apenas Super Admin (ou SERVICE_ROLE). Cada step é resiliente — falha de um não interrompe os demais.
import { adminClient, authConsultant, corsHeaders, loadPlatformAccount } from "../_shared/fb-graph.ts";
import { ensurePixelLinkedToAdAccount, PLATFORM_PIXEL_ID } from "../_shared/fb-link-pixel.ts";
import { isServiceRoleAuth } from "../_shared/service-role-auth.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const admin = adminClient();
    const isCron = isServiceRoleAuth(req);

    if (!isCron) {
      const auth = await authConsultant(req);
      if (!auth) return json({ error: "Unauthorized" }, 401);
      const { data: role } = await admin
        .from("user_roles").select("role").eq("user_id", auth.id).eq("role", "admin").maybeSingle();
      if (!role) return json({ error: "Forbidden - Super Admin only" }, 403);
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const client = createClient(SUPABASE_URL, SERVICE_ROLE);

    const userAuth = isCron ? `Bearer ${SERVICE_ROLE}` : (req.headers.get("Authorization") || "");

    const report: Record<string, any> = { started_at: new Date().toISOString() };

    // === Step 1: Validar Pixel e VINCULAR automaticamente se faltar ===
    try {
      const platform = await loadPlatformAccount();
      if (!platform) throw new Error("Plataforma não conectada");
      const pixelId = platform.pixel_id || PLATFORM_PIXEL_ID;
      const link = await ensurePixelLinkedToAdAccount({
        token: platform.token,
        adAccountId: platform.ad_account_id,
        pixelId,
        businessId: platform.business_id,
        admin,
      });
      // Mantém pixel_id oficial na plataforma se ainda estiver vazio
      if (link.ok && !platform.pixel_id) {
        await admin.from("platform_facebook_account").update({
          pixel_id: pixelId,
          pixel_name: "igreen-app-oficial",
          updated_at: new Date().toISOString(),
        }).eq("id", true);
      }
      report.pixel_check = {
        ok: link.ok,
        ad_account_id: link.ad_account_id,
        expected_pixel: pixelId,
        available_pixels: link.available_pixels,
        business_id: link.business_id ?? platform.business_id,
        already_linked: link.already_linked,
        linked_now: link.linked,
        steps: link.steps,
        message: link.message,
        error: link.error,
      };
    } catch (e: any) {
      report.pixel_check = { ok: false, error: e?.message };
    }

    // === Step 2: Saldo ===
    try {
      const r = await client.functions.invoke("facebook-platform-balance", {
        body: {}, headers: { Authorization: userAuth },
      });
      if (r.error) throw r.error;
      const d = r.data as any;
      report.balance = {
        ok: !d?.error,
        currency: d?.currency,
        available_cents: d?.available_cents,
        amount_spent_cents: d?.amount_spent_cents,
        balance_cents: d?.balance_cents,
        error: d?.error,
      };
    } catch (e: any) {
      report.balance = { ok: false, error: e?.message };
    }

    // === Step 3: Sync métricas ===
    try {
      const r = await client.functions.invoke("facebook-sync-metrics", {
        body: {}, headers: { Authorization: `Bearer ${SERVICE_ROLE}` },
      });
      if (r.error) throw r.error;
      report.metrics = { ok: true, ...(r.data as any) };
    } catch (e: any) {
      report.metrics = { ok: false, error: e?.message };
    }

    // === Step 4: Sync audiences (platform scope) ===
    try {
      const r = await client.functions.invoke("facebook-sync-audiences", {
        body: { scope: "platform" }, headers: { Authorization: `Bearer ${SERVICE_ROLE}` },
      });
      const d = (r.data || {}) as any;
      // supabase-js mascara o body em FunctionsHttpError — tenta extrair mensagem real.
      let errMsg = d?.error || null;
      if (r.error && !errMsg) {
        errMsg = r.error.message || String(r.error);
        try {
          const ctx = (r.error as any)?.context;
          if (ctx && typeof ctx.json === "function") {
            const j = await ctx.json();
            if (j?.error) errMsg = j.error;
            else if (j?.hint) errMsg = `${j.error || errMsg} — ${j.hint}`;
          } else if (typeof ctx?.body === "string") {
            const j = JSON.parse(ctx.body);
            if (j?.error) errMsg = j.hint ? `${j.error} — ${j.hint}` : j.error;
          }
        } catch (_) { /* ignore */ }
      }
      report.audiences = {
        ok: !r.error && !d?.error,
        uploaded: d?.uploaded,
        lal_status: d?.lal_status,
        custom_audience_id: d?.custom_audience_id,
        business_id: d?.business_id,
        code: d?.code,
        hint: d?.hint,
        error: errMsg,
      };
    } catch (e: any) {
      report.audiences = { ok: false, error: e?.message };
    }

    report.finished_at = new Date().toISOString();
    return json(report);
  } catch (e: any) {
    return json({ error: e?.message || "Erro desconhecido" }, 500);
  }
});
