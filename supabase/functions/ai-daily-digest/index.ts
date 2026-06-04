// Cron 09:00 BRT: monta resumo do que a IA aprendeu nas últimas 24h e envia
// no WhatsApp do super-admin via Evolution API. Idempotente por digest_date.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { createEvolutionSender } from "../_shared/evolution-api.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function brl(cents: number): string {
  return `R$ ${(cents / 100).toFixed(2).replace(".", ",")}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const url = new URL(req.url);
    const force = url.searchParams.get("force") === "1";
    const today = new Date().toISOString().slice(0, 10);

    // Idempotência: já enviado hoje?
    if (!force) {
      const { data: existing } = await supabase
        .from("ai_learning_digest")
        .select("id, sent_at")
        .eq("digest_date", today)
        .maybeSingle();
      if (existing?.sent_at) {
        return new Response(JSON.stringify({ ok: true, already_sent: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const since24h = new Date(Date.now() - 24 * 3600_000).toISOString();
    const since48h = new Date(Date.now() - 48 * 3600_000).toISOString();

    // Métricas
    const [perfRows, perfPrev, paused, recs, comp, playbook, recAlerts] = await Promise.all([
      supabase.from("ad_creative_performance")
        .select("spend_cents, leads")
        .gte("evaluated_at", since24h),
      supabase.from("ad_creative_performance")
        .select("spend_cents, leads")
        .gte("evaluated_at", since48h)
        .lt("evaluated_at", since24h),
      supabase.from("ad_creative_performance")
        .select("id")
        .gte("paused_by_ai_at", since24h),
      supabase.from("ad_recommendations")
        .select("type, title")
        .gte("created_at", since24h),
      supabase.from("ad_competitor_creatives")
        .select("id, image_url"),
      supabase.from("ad_playbooks")
        .select("payload")
        .eq("scope", "global")
        .order("generated_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase.from("ad_recommendations")
        .select("title, severity")
        .eq("severity", "warning")
        .is("dismissed_at", null)
        .gte("created_at", since48h)
        .limit(5),
    ]);

    const totLeads24 = (perfRows.data || []).reduce((s, r: any) => s + (r.leads || 0), 0);
    const totSpend24 = (perfRows.data || []).reduce((s, r: any) => s + (r.spend_cents || 0), 0);
    const totLeadsPrev = (perfPrev.data || []).reduce((s, r: any) => s + (r.leads || 0), 0);
    const totSpendPrev = (perfPrev.data || []).reduce((s, r: any) => s + (r.spend_cents || 0), 0);

    const cpl24 = totLeads24 > 0 ? totSpend24 / totLeads24 : 0;
    const cplPrev = totLeadsPrev > 0 ? totSpendPrev / totLeadsPrev : 0;
    const cplDelta = cplPrev > 0 ? ((cpl24 - cplPrev) / cplPrev) * 100 : 0;

    const pausedCount = (paused.data || []).length;
    const promotedCount = (recs.data || []).filter((r: any) => /promov|winner/i.test(r.type || "")).length;
    const compTotal = (comp.data || []).length;
    const compWithImg = (comp.data || []).filter((r: any) => r.image_url).length;

    const topPattern = (playbook.data?.payload as any)?.top_winning_patterns?.[0];
    const actions = (recAlerts.data || []).slice(0, 2);

    // Monta texto
    const cplLine = totLeads24 > 0
      ? `• CPL médio: ${brl(cpl24)}${cplPrev > 0 ? ` (${cplDelta >= 0 ? "+" : ""}${cplDelta.toFixed(0)}% vs ontem ${cplDelta < 0 ? "✅" : "⚠️"})` : ""}`
      : "• CPL: sem leads nas últimas 24h";

    const lines: string[] = [
      "🤖 *IA aprendeu hoje*",
      "",
      cplLine,
      `• ${pausedCount} anúncio${pausedCount === 1 ? "" : "s"} pausado${pausedCount === 1 ? "" : "s"} pela IA`,
      `• ${promotedCount} vencedor${promotedCount === 1 ? "" : "es"} promovido${promotedCount === 1 ? "" : "s"} (+budget)`,
    ];
    if (topPattern) {
      lines.push(`• Padrão vencedor: "${topPattern.pattern || topPattern}"`);
    }
    lines.push(`• ${compWithImg}/${compTotal} concorrentes monitorados (com imagem)`);
    if (actions.length > 0) {
      lines.push("");
      lines.push(`⚠️ ${actions.length} ação${actions.length === 1 ? "" : "s"} sua${actions.length === 1 ? "" : "s"}:`);
      actions.forEach((a: any) => lines.push(`  • ${a.title}`));
    }

    const summary = lines.join("\n");
    const metrics = {
      cpl_cents_24h: Math.round(cpl24),
      cpl_cents_prev: Math.round(cplPrev),
      cpl_delta_pct: cplDelta,
      leads_24h: totLeads24,
      spend_cents_24h: totSpend24,
      paused_count: pausedCount,
      promoted_count: promotedCount,
      competitors_total: compTotal,
      competitors_with_image: compWithImg,
      pending_actions: actions.length,
    };

    // Upsert digest
    await supabase.from("ai_learning_digest").upsert(
      { digest_date: today, metrics, summary_text: summary },
      { onConflict: "digest_date" },
    );

    // Envia para super-admin via Evolution
    const { data: superAdmins } = await supabase
      .from("user_roles")
      .select("user_id")
      .eq("role", "super_admin");

    const adminIds = (superAdmins || []).map((r: any) => r.user_id);
    if (adminIds.length === 0) {
      return new Response(JSON.stringify({ ok: true, summary, sent: false, reason: "no_super_admin" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: admins } = await supabase
      .from("consultants")
      .select("id, phone")
      .in("id", adminIds);

    const apiUrl = Deno.env.get("EVOLUTION_API_URL");
    const apiKey = Deno.env.get("EVOLUTION_API_KEY");
    let sentTo: string[] = [];

    if (apiUrl && apiKey) {
      // Para enviar precisamos da instância de algum super-admin que esteja conectada
      const { data: instances } = await supabase
        .from("whatsapp_instances")
        .select("instance_name, consultant_id")
        .in("consultant_id", adminIds)
        .limit(1);

      const sourceInstance = instances?.[0]?.instance_name;
      if (sourceInstance) {
        const _raw = createEvolutionSender(apiUrl, apiKey, sourceInstance);
        const { wrapSenderWithGuard } = await import("../_shared/sender-guard.ts");
        const sender = wrapSenderWithGuard(_raw, { supabase, instanceName: sourceInstance });
        for (const a of admins || []) {
          if (!a.phone) continue;
          const jid = `${a.phone.replace(/\D/g, "")}@s.whatsapp.net`;
          const ok = await sender.sendText(jid, summary);
          if (ok) sentTo.push(a.phone);
        }
      }
    }

    if (sentTo.length > 0) {
      await supabase.from("ai_learning_digest")
        .update({ sent_at: new Date().toISOString(), sent_to: sentTo.join(",") })
        .eq("digest_date", today);
    }

    return new Response(JSON.stringify({ ok: true, summary, metrics, sent_to: sentTo }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("ai-daily-digest error", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
