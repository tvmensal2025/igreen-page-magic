// Reconnect a degraded WhatsApp instance.
//
// ⚠️ Plano B — Segurança máxima:
// Após um incidente de desconexão fatal (statusReason 403/401/440/...) o WhatsApp
// pode ter restringido ou bloqueado o número. Reconectar imediatamente costuma
// piorar a situação. Por isso esta função:
//   • REJEITA reconexão se a instância está em `manual_review_required` ou
//     `fatal_lock_until` ativo. Só super_admin destrava via `admin_clear_fatal_lock`.
//   • NÃO faz logout forçado por padrão (`forceLogout` precisa ser `true` explícito).
//   • NÃO limpa `recovery_mode` automaticamente — usuário precisa confirmar pelo
//     painel após validar manualmente que o número voltou normal.
//   • NÃO apaga sinais de risco automaticamente.
//
// Em estado saudável (sem fatal lock) ela apenas pede um novo QR via
// `/instance/connect`, sem mexer na sessão atual.

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const EVOLUTION_API_URL = (Deno.env.get("EVOLUTION_API_URL") || "").replace(/\/+$/, "");
const EVOLUTION_API_KEY = Deno.env.get("EVOLUTION_API_KEY") || "";

interface ReconnectBody {
  instanceName: string;
  /** Se TRUE, faz logout antes de pedir novo QR (perigoso após fatal). Default FALSE. */
  forceLogout?: boolean;
  /** Se TRUE, ignora o bloqueio de fatal lock (somente super_admin). */
  overrideFatalLock?: boolean;
  /** Se TRUE, deleta a instância no Evolution e recria do zero (mesmo id no Supabase). */
  recreate?: boolean;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    if (!EVOLUTION_API_URL || !EVOLUTION_API_KEY) {
      return json({ error: "Evolution API not configured" }, 500);
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "missing_auth" }, 401);

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) return json({ error: "unauthorized" }, 401);

    const body = (await req.json().catch(() => ({}))) as Partial<ReconnectBody>;
    const instanceName = String(body?.instanceName || "").trim();
    if (!instanceName) return json({ error: "instanceName_required" }, 400);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Ownership / admin check
    const { data: inst } = await admin
      .from("whatsapp_instances")
      .select("id, instance_name, consultant_id, manual_review_required, fatal_lock_until, fatal_disconnect_reason, fatal_disconnect_at, recovery_mode_until")
      .eq("instance_name", instanceName)
      .maybeSingle();
    if (!inst) return json({ error: "instance_not_found" }, 404);

    const owns = inst.consultant_id === user.id;
    let isAdmin = false;
    if (!owns || body?.overrideFatalLock) {
      const { data: roleRow } = await admin
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .in("role", ["admin", "super_admin"])
        .maybeSingle();
      isAdmin = !!roleRow;
    }
    if (!owns && !isAdmin) return json({ error: "forbidden" }, 403);

    // ── HARD-LOCK: bloqueia reconexão se instância está em revisão manual ──
    const fatalLockActive =
      !!inst.manual_review_required ||
      (inst.fatal_lock_until && new Date(inst.fatal_lock_until) > new Date());
    if (fatalLockActive && !(isAdmin && body?.overrideFatalLock)) {
      return json({
        error: "manual_review_required",
        message:
          "Este número teve uma desconexão grave (possível restrição/bloqueio do WhatsApp). " +
          "Não reconecte aqui agora. Verifique no app oficial do WhatsApp se o número voltou " +
          "ao normal. Se quiser usar outro chip, escolha 'Desconectar / trocar chip'.",
        fatal_disconnect_reason: inst.fatal_disconnect_reason,
        fatal_disconnect_at: inst.fatal_disconnect_at,
        fatal_lock_until: inst.fatal_lock_until,
      }, 423); // 423 Locked
    }

    // ── RECREATE: apaga instância no Evolution e cria uma nova ──
    if (body?.recreate === true) {
      if (!isAdmin && !owns) return json({ error: "forbidden" }, 403);
      const { recreateInstance } = await import("../evolution-webhook/recreate-instance.ts");
      const result = await recreateInstance(admin, {
        instanceRowId: inst.id,
        oldInstanceName: instanceName,
        evolutionApiUrl: EVOLUTION_API_URL,
        evolutionApiKey: EVOLUTION_API_KEY,
        triggeredBy: "manual_admin",
        reason: "manual_recreate",
      });
      if (!result.ok) {
        return json({ error: result.error || result.skipped || "recreate_failed" }, 500);
      }
      return json({
        ok: true,
        recreated: true,
        new_instance_name: result.new_instance_name,
        qr_base64: result.qr_base64,
      });
    }

    const headers = { "Content-Type": "application/json", apikey: EVOLUTION_API_KEY };

    // Step 1: logout SOMENTE se foi pedido explicitamente (default = FALSE).
    let loggedOut = false;
    if (body?.forceLogout === true) {
      try {
        const r = await fetch(`${EVOLUTION_API_URL}/instance/logout/${instanceName}`, {
          method: "DELETE", headers,
        });
        loggedOut = r.ok;
        await r.text();
      } catch (_) { /* swallow */ }
    }

    // Step 2: connect — pede novo QR.
    let qrPayload: any = null;
    try {
      const r = await fetch(`${EVOLUTION_API_URL}/instance/connect/${instanceName}`, {
        method: "GET", headers,
      });
      qrPayload = await r.json().catch(() => null);
      if (!r.ok) {
        return json({ error: "evolution_connect_failed", status: r.status, body: qrPayload }, 502);
      }
    } catch (e: any) {
      return json({ error: "evolution_connect_exception", message: e?.message }, 502);
    }

    // ⚠️ NÃO limpa recovery_mode e NÃO apaga risk_signals automaticamente.
    // O destravamento agora é manual (botão de admin) ou expira por tempo.

    return json({
      ok: true,
      logged_out: loggedOut,
      qr_base64: qrPayload?.base64 ?? qrPayload?.qrcode?.base64 ?? null,
      pairing_code: qrPayload?.pairingCode ?? qrPayload?.code ?? null,
      raw: qrPayload,
    });
  } catch (err: any) {
    console.error("[evolution-instance-reconnect] error:", err);
    return json({ error: String(err?.message || err) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
