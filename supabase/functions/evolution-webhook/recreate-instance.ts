// Recreate Evolution instance — SOMENTE manual_admin.
//
// 🛡️ 2026-07-30: `auto_fatal` está DESLIGADO. Após 401/403/440 o webhook
// aplica hard-lock (register_fatal_disconnect). Pedir QR automático acelera ban
// de número antigo (anos). Recreate só com super-admin consciente.
//
// Rate limit (manual):
//   • se a linha foi atualizada há < 15min por outra recreação, pula.
//   • se houve >= 3 recreações em 24h, marca manual_review_required=true.

import { fetchWithTimeout } from "../_shared/utils.ts";

export interface RecreateResult {
  ok: boolean;
  skipped?: "rate_limit_15min" | "too_many_24h" | "auto_fatal_disabled";
  new_instance_name?: string;
  qr_base64?: string | null;
  error?: string;
}

/** Settings seguros no create (Evolution docs + baileys-antiban). Sem proxy Evomi. */
export const SAFE_EVOLUTION_INSTANCE_SETTINGS = {
  rejectCall: true,
  msgCall: "Não posso atender agora. Me chama no Zap por texto 🙂",
  groupsIgnore: true,
  alwaysOnline: false,
  readMessages: false,
  readStatus: false,
  syncFullHistory: false,
} as const;

const SUPABASE_URL_ENV = Deno.env.get("SUPABASE_URL") || "";
const WEBHOOK_URL = `${SUPABASE_URL_ENV.replace(/\/+$/, "")}/functions/v1/evolution-webhook`;

/** Nome canônico: `igreen-{12 hex}` — remove sufixo legado `-YYYYMMDDHHmm` se existir. */
function baseNameOf(instanceName: string): string {
  return instanceName.replace(/-\d{8,14}$/, "");
}

export async function recreateInstance(
  supabase: any,
  args: {
    instanceRowId: string;
    oldInstanceName: string;
    evolutionApiUrl: string;
    evolutionApiKey: string;
    triggeredBy: "auto_fatal" | "manual_admin";
    reason?: number | string | null;
  },
): Promise<RecreateResult> {
  const {
    instanceRowId,
    oldInstanceName,
    evolutionApiUrl,
    evolutionApiKey,
    triggeredBy,
    reason,
  } = args;
  const baseUrl = evolutionApiUrl.replace(/\/+$/, "");
  const headers = { "Content-Type": "application/json", apikey: evolutionApiKey };

  // Fail-closed: auto_fatal nunca recria (defesa em profundidade).
  if (triggeredBy === "auto_fatal") {
    console.error(
      `[recreateInstance] BLOQUEADO auto_fatal em ${oldInstanceName} (reason=${reason ?? "-"}). ` +
      `Use manual_admin após admin_clear_fatal_lock.`,
    );
    return { ok: false, skipped: "auto_fatal_disabled" };
  }

  try {
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: recent } = await supabase
      .from("instance_risk_signals")
      .select("id, created_at")
      .eq("instance_name", oldInstanceName)
      .eq("signal_type", "auto_recreate")
      .gte("created_at", since24h)
      .order("created_at", { ascending: false });

    const list = (recent as { created_at: string }[] | null) ?? [];
    if (list.length > 0) {
      const lastMs = Date.parse(list[0].created_at);
      if (Date.now() - lastMs < 15 * 60 * 1000) {
        console.log(`[recreateInstance] skip ${oldInstanceName}: última recreação há <15min`);
        return { ok: false, skipped: "rate_limit_15min" };
      }
    }
    if (list.length >= 3) {
      console.warn(`[recreateInstance] ${oldInstanceName}: >=3 recreações em 24h → manual_review_required`);
      await supabase
        .from("whatsapp_instances")
        .update({
          manual_review_required: true,
          fatal_disconnect_reason: typeof reason === "number" ? reason : null,
          fatal_disconnect_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", instanceRowId);
      return { ok: false, skipped: "too_many_24h" };
    }
  } catch (e: any) {
    console.warn(`[recreateInstance] rate-limit check falhou: ${e?.message}`);
  }

  // Nome FIXO (mesmo consultor = mesma instância). Sufixo timestamp gerava
  // multi-QR / zumbis e acelerava ban (Abel 2026-07-28). Se old já era fresh,
  // normaliza para base `igreen-{slug}`.
  const newName = baseNameOf(oldInstanceName);
  console.log(
    `♻️ Recriando instância Evolution: ${oldInstanceName} → ${newName} (trigger=${triggeredBy}, reason=${reason ?? "-"}; nome fixo)`,
  );

  try {
    const r = await fetchWithTimeout(`${baseUrl}/instance/delete/${oldInstanceName}`, {
      method: "DELETE",
      headers,
      timeout: 10_000,
    });
    await r.text().catch(() => "");
    console.log(`[recreateInstance] DELETE ${oldInstanceName} → ${r.status}`);
  } catch (e: any) {
    console.warn(`[recreateInstance] DELETE falhou (ok, seguindo): ${e?.message}`);
  }

  // Se normalizou nome (tirou sufixo legado), apaga também o canônico caso exista zumbi.
  if (newName !== oldInstanceName) {
    try {
      const r = await fetchWithTimeout(`${baseUrl}/instance/delete/${newName}`, {
        method: "DELETE",
        headers,
        timeout: 10_000,
      });
      await r.text().catch(() => "");
      console.log(`[recreateInstance] DELETE canônico ${newName} → ${r.status}`);
    } catch (e: any) {
      console.warn(`[recreateInstance] DELETE canônico falhou (ok): ${e?.message}`);
    }
  }

  let createBody: any = null;
  try {
    const r = await fetchWithTimeout(`${baseUrl}/instance/create`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        instanceName: newName,
        qrcode: true,
        integration: "WHATSAPP-BAILEYS",
        ...SAFE_EVOLUTION_INSTANCE_SETTINGS,
        webhook: {
          url: WEBHOOK_URL,
          byEvents: false,
          base64: true,
          enabled: true,
          events: ["MESSAGES_UPSERT", "MESSAGES_UPDATE", "CONNECTION_UPDATE"],
        },
      }),
      timeout: 30_000,
    });
    createBody = await r.json().catch(() => null);
    if (!r.ok) {
      console.error(`[recreateInstance] CREATE ${newName} falhou: ${r.status}`, createBody);
      return { ok: false, error: `create_failed_${r.status}` };
    }
  } catch (e: any) {
    console.error(`[recreateInstance] CREATE exception: ${e?.message}`);
    return { ok: false, error: `create_exception: ${e?.message}` };
  }

  try {
    await supabase
      .from("whatsapp_instances")
      .update({
        instance_name: newName,
        status: "awaiting_qr",
        connected_phone: null,
        manual_review_required: false,
        fatal_lock_until: null,
        fatal_disconnect_reason: null,
        fatal_disconnect_at: null,
        recovery_mode_until: null,
        last_health_check_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", instanceRowId);
  } catch (e: any) {
    console.error(`[recreateInstance] UPDATE row falhou: ${e?.message}`);
  }

  try {
    await supabase.from("instance_risk_signals").insert({
      instance_name: newName,
      signal_type: "auto_recreate",
      severity: "medium",
      metadata: { old_name: oldInstanceName, trigger: triggeredBy, reason: reason ?? null },
    });
    await supabase.from("instance_risk_signals").insert({
      instance_name: oldInstanceName,
      signal_type: "auto_recreate",
      severity: "medium",
      metadata: { new_name: newName, trigger: triggeredBy },
    });
  } catch (_) { /* non-critical */ }

  const qr = createBody?.qrcode?.base64 ?? createBody?.base64 ?? null;
  return { ok: true, new_instance_name: newName, qr_base64: qr };
}
