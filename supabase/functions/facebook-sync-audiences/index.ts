// Sincroniza Custom Audience (clientes ativos) + Lookalike 1-3% BR.
// Sobe e-mails/telefones HASHED (SHA-256) — LGPD-safe, nada em texto puro.
// Idempotente: se já existir, atualiza. CPL costuma cair 30-50% com LAL.
//
// MODOS:
//   - { scope: "platform" } (cron diário ou Super Admin) → consolida TODOS
//     os clientes ativos do projeto numa única audiência criada na
//     `platform_facebook_account` (compartilhada por todos os consultores).
//   - sem body / { scope: "consultant" } → comportamento legado: cria
//     audiência na ad_account do próprio consultor (mantido por compat).
import { adminClient, authConsultant, corsHeaders, fbFetch, loadCampaignConnection, loadPlatformAccount, sha256Hex } from "../_shared/fb-graph.ts";
import { isServiceRoleAuth } from "../_shared/service-role-auth.ts";
import { ensureAdAccountInBusiness } from "../_shared/fb-ensure-business.ts";

function normPhone(p: string | null | undefined): string {
  if (!p) return "";
  const d = p.replace(/\D/g, "");
  // E.164 sem +
  if (d.startsWith("55") && d.length >= 12) return d;
  if (d.length >= 10) return `55${d}`;
  return "";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const scope: "platform" | "consultant" = body?.scope === "platform" ? "platform" : "consultant";
    const admin = adminClient();

    // ============================================================
    // MODO PLATFORM — usado pelo cron diário e Super Admin.
    // Consolida TODOS os clientes ativos numa Custom Audience única
    // na ad_account compartilhada (platform_facebook_account).
    // ============================================================
    if (scope === "platform") {
      // Auth: aceita SERVICE_ROLE (cron/JWT) OU usuário admin autenticado.
      const isCron = isServiceRoleAuth(req);
      if (!isCron) {
        const auth = await authConsultant(req);
        if (!auth) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        const { data: role } = await admin.from("user_roles").select("role").eq("user_id", auth.id).eq("role", "admin").maybeSingle();
        if (!role) return new Response(JSON.stringify({ error: "Apenas admin pode rodar sync de plataforma." }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const platform = await loadPlatformAccount();
      if (!platform?.ad_account_id) {
        return new Response(JSON.stringify({ error: "Conta Facebook da plataforma não configurada." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const accId = platform.ad_account_id;
      const token = platform.token;

      // Meta subcode 1870050: Custom Audience exige ad account dentro de um BM.
      const biz = await ensureAdAccountInBusiness({
        token,
        adAccountId: accId,
        preferredBusinessId: platform.business_id,
        admin,
      });
      if (!biz.ok) {
        return new Response(JSON.stringify({
          error: biz.message,
          code: "AD_ACCOUNT_NOT_IN_BUSINESS",
          steps: biz.steps,
          hint: "business.facebook.com → Configurações → Contas de anúncios → Adicionar esta conta à empresa → Aceitar Termos de Públicos Personalizados.",
        }), { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // Aceita Termos de Públicos Personalizados (quando o token tiver permissão de admin).
      try {
        const tosList = await fbFetch(
          `/${accId}/customaudiencestos?access_token=${token}`,
        );
        const items = (tosList?.data || []) as Array<{ id?: string; tos_id?: string; type?: string }>;
        for (const t of items) {
          const tosId = String(t.tos_id || t.id || "");
          if (!tosId) continue;
          try {
            await fbFetch(`/${accId}/customaudiencestos`, {
              method: "POST",
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: new URLSearchParams({ tos_id: tosId, access_token: token }),
            });
            console.log("[fb-aud] TOS aceito:", tosId);
          } catch (te) {
            console.warn("[fb-aud] TOS skip", tosId, (te as Error).message);
          }
        }
      } catch (te) {
        console.warn("[fb-aud] list TOS:", (te as Error).message);
      }

      // 1) Carrega TODOS os clientes ativos (todos os consultores)
      const { data: customers, error } = await admin
        .from("customers")
        .select("email,phone_whatsapp")
        .in("status", ["active", "approved"])
        .limit(50000);
      if (error) throw error;
      if (!customers?.length) {
        return new Response(JSON.stringify({ ok: true, skipped: "nenhum cliente ativo" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const rows: string[][] = [];
      const seen = new Set<string>();
      for (const c of customers) {
        const emailH = c.email ? await sha256Hex(c.email) : "";
        const phoneH = c.phone_whatsapp ? await sha256Hex(normPhone(c.phone_whatsapp)) : "";
        if (!emailH && !phoneH) continue;
        const dedup = `${emailH}|${phoneH}`;
        if (seen.has(dedup)) continue;
        seen.add(dedup);
        rows.push([emailH, phoneH]);
      }
      if (!rows.length) {
        return new Response(JSON.stringify({ ok: true, skipped: "sem identificadores válidos" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const canCreateLAL = rows.length >= 100;

      const { data: pf } = await admin
        .from("platform_facebook_account")
        .select("custom_audience_id, lookalike_audience_id")
        .eq("id", true)
        .maybeSingle();
      let customAudId = pf?.custom_audience_id || null;

      if (!customAudId) {
        try {
          const r = await fbFetch(`/${accId}/customaudiences`, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              name: `iGreen Plataforma — Clientes Ativos`,
              subtype: "CUSTOM",
              description: "Sync diário — todos os clientes pagantes da plataforma",
              customer_file_source: "USER_PROVIDED_ONLY",
              access_token: token,
            }),
          });
          customAudId = r.id;
        } catch (e) {
          const msg = String((e as Error).message || e);
          const tosUrl = `https://business.facebook.com/ads/manage/customaudiences/tos/?act=${String(accId).replace(/^act_/, "")}`;
          if (/1870090|termos do público|custom audience.*tos|Termos do público/i.test(msg)) {
            return new Response(JSON.stringify({
              error: "Aceite os Termos de Públicos Personalizados na Meta (obrigatório 1x por conta).",
              code: "CUSTOM_AUDIENCE_TOS",
              hint: tosUrl,
              steps: biz.steps,
            }), { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } });
          }
          if (/1870050|conta comercial|business/i.test(msg)) {
            return new Response(JSON.stringify({
              error: msg,
              code: "AD_ACCOUNT_NOT_IN_BUSINESS",
              hint: "business.facebook.com → Contas de anúncios → adicionar esta conta à empresa.",
              steps: biz.steps,
            }), { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } });
          }
          throw e;
        }
      }

      // upload em lotes de 5000
      const schema = ["EMAIL", "PHONE"];
      const chunks: string[][][] = [];
      for (let i = 0; i < rows.length; i += 5000) chunks.push(rows.slice(i, i + 5000));
      const sessionId = Date.now();
      for (let i = 0; i < chunks.length; i++) {
        await fbFetch(`/${customAudId}/users`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            payload: JSON.stringify({ schema, data: chunks[i] }),
            session: JSON.stringify({ session_id: sessionId, batch_seq: i + 1, last_batch_flag: i === chunks.length - 1 }),
            access_token: token,
          }),
        });
      }

      let lalAudId = pf?.lookalike_audience_id || null;
      if (!lalAudId && canCreateLAL) {
        try {
          const r = await fbFetch(`/${accId}/customaudiences`, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              name: `iGreen Plataforma — Lookalike 1-3% BR`,
              subtype: "LOOKALIKE",
              origin_audience_id: customAudId!,
              lookalike_spec: JSON.stringify({ type: "similarity", country: "BR", ratio: 0.03 }),
              access_token: token,
            }),
          });
          lalAudId = r.id;
        } catch (e) {
          console.warn("[fb-aud platform] LAL pendente:", (e as Error).message);
        }
      }

      await admin.from("platform_facebook_account").update({
        custom_audience_id: customAudId,
        lookalike_audience_id: lalAudId,
        audience_synced_at: new Date().toISOString(),
        audience_source_count: rows.length,
      }).eq("id", true);

      return new Response(JSON.stringify({
        ok: true,
        scope: "platform",
        custom_audience_id: customAudId,
        lookalike_audience_id: lalAudId,
        uploaded: rows.length,
        lal_status: lalAudId ? "created" : (canCreateLAL ? "pending_or_failed" : "skipped_low_volume"),
        business_id: biz.business_id,
        business_ready: true,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ============================================================
    // MODO CONSULTANT (legado) — mantido por compat.
    // ============================================================
    const auth = await authConsultant(req);
    if (!auth) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const conn = await loadCampaignConnection(auth.id);
    if (!conn?.ad_account_id) {
      return new Response(JSON.stringify({ error: "Conexão Facebook incompleta." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const accId = conn.ad_account_id;

    // 1) Carrega clientes ativos do consultor
    const { data: customers, error } = await admin
      .from("customers")
      .select("email,phone_whatsapp")
      .eq("consultant_id", auth.id)
      .in("status", ["active", "approved"])
      .limit(10000);
    if (error) throw error;
    if (!customers?.length) {
      return new Response(JSON.stringify({ error: "Nenhum cliente ativo encontrado. Cadastre clientes antes de sincronizar." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 2) Hash dos identificadores (Meta espera schema multi-coluna [EMAIL, PHONE])
    const rows: string[][] = [];
    for (const c of customers) {
      const emailH = c.email ? await sha256Hex(c.email) : "";
      const phoneH = c.phone_whatsapp ? await sha256Hex(normPhone(c.phone_whatsapp)) : "";
      if (!emailH && !phoneH) continue;
      rows.push([emailH, phoneH]);
    }
    if (rows.length === 0) {
      return new Response(JSON.stringify({ error: "Nenhum cliente com email/telefone válido pra sincronizar." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const canCreateLAL = rows.length >= 100;

    // 3) Cria ou atualiza Custom Audience
    const { data: existing } = await admin
      .from("facebook_connections")
      .select("custom_audience_id, lookalike_audience_id")
      .eq("consultant_id", auth.id)
      .maybeSingle();
    let customAudId = existing?.custom_audience_id || null;

    if (!customAudId) {
      const r = await fbFetch(`/${accId}/customaudiences`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          name: `iGreen — Clientes Ativos (${auth.id.slice(0, 8)})`,
          subtype: "CUSTOM",
          description: "Sincronizada automaticamente — clientes pagantes",
          customer_file_source: "USER_PROVIDED_ONLY",
          access_token: conn.token,
        }),
      });
      customAudId = r.id;
    }

    // 4) Faz upload em lotes de 5000 (limite da Meta)
    const schema = ["EMAIL", "PHONE"];
    const chunks: string[][][] = [];
    for (let i = 0; i < rows.length; i += 5000) chunks.push(rows.slice(i, i + 5000));
    const sessionId = Date.now();
    for (let i = 0; i < chunks.length; i++) {
      const payload = {
        schema,
        data: chunks[i],
      };
      await fbFetch(`/${customAudId}/users`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          payload: JSON.stringify(payload),
          session: JSON.stringify({ session_id: sessionId, batch_seq: i + 1, last_batch_flag: i === chunks.length - 1 }),
          access_token: conn.token,
        }),
      });
    }

    // 5) Cria Lookalike 1-3% BR (se ainda não existe e tiver base mínima de 100)
    let lalAudId = existing?.lookalike_audience_id || null;
    let lalSkippedReason: string | null = null;
    if (!lalAudId && !canCreateLAL) {
      lalSkippedReason = `Lookalike pulada: ${rows.length} clientes (mínimo Meta: 100). Continue cadastrando — ela será criada no próximo sync.`;
    }
    if (!lalAudId && canCreateLAL) {
      try {
        const r = await fbFetch(`/${accId}/customaudiences`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            name: `iGreen — Lookalike 1-3% BR (${auth.id.slice(0, 8)})`,
            subtype: "LOOKALIKE",
            origin_audience_id: customAudId!,
            lookalike_spec: JSON.stringify({
              type: "similarity",
              country: "BR",
              ratio: 0.03, // 0-3% (Meta interpreta como faixa)
            }),
            access_token: conn.token,
          }),
        });
        lalAudId = r.id;
      } catch (e) {
        // LAL precisa de ~6h pra processar; não bloquear se falhar agora
        console.warn("[fb-aud] LAL pendente:", (e as Error).message);
        lalSkippedReason = `LAL pendente — Meta processa em ~6h. Detalhe: ${(e as Error).message}`;
      }
    }

    // 6) Persiste IDs
    await admin.from("facebook_connections").update({
      custom_audience_id: customAudId,
      lookalike_audience_id: lalAudId,
      audience_synced_at: new Date().toISOString(),
      audience_source_count: rows.length,
    }).eq("consultant_id", auth.id);

    return new Response(JSON.stringify({
      ok: true,
      custom_audience_id: customAudId,
      lookalike_audience_id: lalAudId,
      uploaded: rows.length,
      lal_status: lalAudId ? "created" : (canCreateLAL ? "pending_or_failed" : "skipped_low_volume"),
      warning: lalSkippedReason,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("[fb-aud]", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});