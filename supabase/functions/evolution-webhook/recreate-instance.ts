// Auto-recreate a dead Evolution instance.
//
// Motivo: quando o Evolution devolve connection.close com 401/403/440, a
// sessão foi invalidada pelo WhatsApp. Simplesmente pedir um novo QR na
// mesma instância NÃO funciona — o servidor Evolution ainda mantém o
// socket morto internamente. O correto é apagar a instância no Evolution
// e recriar do zero, mantendo o mesmo `whatsapp_instances.id` no Supabase.
//
// Rate limit:
//   • se a linha foi atualizada há < 15min por outra recreação, pula.
//   • se houve >= 3 recreações em 24h, marca manual_review_required=true
//     e para (chip provavelmente queimado, precisa intervenção humana).

import { fetchWithTimeout } from "../_shared/utils.ts";

export interface RecreateResult {
  ok: boolean;
  skipped?: "rate_limit_15min" | "too_many_24h";
  new_instance_name?: string;
  qr_base64?: string | null;
  error?: string;
}

const SUPABASE_URL_ENV = Deno.env.get("SUPABASE_URL") || "";
const WEBHOOK_URL = `${SUPABASE_URL_ENV.replace(/\/+$/, "")}/functions/v1/evolution-webhook`;

function baseNameOf(instanceName: string): string {
  // Remove sufixos numéricos anteriores tipo "-YYYYMMDDHHmm".
  return instanceName.replace(/-\d{8,14}$/, "");
}

function newInstanceName(oldName: string): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp =
    d.getUTCFullYear().toString() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes());
  return `${baseNameOf(oldName)}-${stamp}`;
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

  // ── Rate limit: recreações recentes no mesmo id ──
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
    if (triggeredBy === "auto_fatal") {
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
    }
  } catch (e: any) {
    console.warn(`[recreateInstance] rate-limit check falhou: ${e?.message}`);
  }

  const newName = newInstanceName(oldInstanceName);
  console.log(`♻️ Recriando instância Evolution: ${oldInstanceName} → ${newName} (trigger=${triggeredBy}, reason=${reason ?? "-"})`);

  // Step 1: DELETE antiga no Evolution (best-effort, pode já não existir).
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

  // Step 2: CREATE nova (com QR + webhook).
  let createBody: any = null;
  try {
    const r = await fetchWithTimeout(`${baseUrl}/instance/create`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        instanceName: newName,
        qrcode: true,
        integration: "WHATSAPP-BAILEYS",
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

  // Step 3: UPDATE linha no Supabase (mesmo id, novo instance_name, reset flags).
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

  // Step 4: registra sinal para rate-limit futuro.
  try {
    await supabase.from("instance_risk_signals").insert({
      instance_name: newName,
      signal_type: "auto_recreate",
      severity: triggeredBy === "auto_fatal" ? "high" : "medium",
      metadata: { old_name: oldInstanceName, trigger: triggeredBy, reason: reason ?? null },
    });
    // Também insere sob o nome ANTIGO para o rate-limit próximo (que
    // pode chegar via connection.close do nome novo em breve).
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
