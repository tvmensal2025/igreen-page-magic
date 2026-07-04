// CONNECTION_UPDATE event handler.
// Extracted verbatim from index.ts — no behavior change.

import { fetchWithTimeout } from "../../_shared/utils.ts";
import {
  canReconnect,
  classifyDisconnect,
  recordRiskSignal,
} from "../_helpers.ts";
import { recreateInstance } from "../recreate-instance.ts";
import type { SupabaseClient } from "./types.ts";

export interface HandleConnectionArgs {
  supabase: SupabaseClient;
  body: any;
  fallbackInstance: string | null;
  evolutionApiUrl: string;
  evolutionApiKey: string;
}

/** Returns true when the event was handled (caller should short-circuit). */
export async function handleConnectionUpdate(args: HandleConnectionArgs): Promise<boolean> {
  const { supabase, body, fallbackInstance, evolutionApiUrl, evolutionApiKey } = args;
  const eventType = body.event;
  if (eventType !== "connection.update" && eventType !== "CONNECTION_UPDATE") {
    return false;
  }

  const connState = body.data?.state || body.state;
  const connInstance = body.instance || body.data?.instance || fallbackInstance;
  // ⚠️ Preserva `undefined`/`null` (campo ausente) para que classifyDisconnect
  // diferencie "Evolution não mandou motivo" (transiente) de "0 explícito" (fatal).
  const rawReason = body.data?.statusReason;
  const statusReason: number | null | undefined =
    rawReason === undefined || rawReason === null ? rawReason : Number(rawReason);
  console.log(`📡 CONNECTION_UPDATE: instance=${connInstance}, state=${connState}, reason=${statusReason ?? "(missing)"}`);

  if (connState === "open" && connInstance) {
    const ownerJid = body.data?.ownerJid || body.ownerJid || "";
    const ownerPhone = ownerJid ? ownerJid.replace(/@.*$/, "") : "";

    // Conexão aberta confirmada: normaliza o status e (importante) limpa o
    // recovery_mode + sinais de risco transitórios automaticamente — agora
    // sim temos prova de que a sessão voltou. NUNCA limpa fatal lock aqui:
    // 401/403/440 exigem revisão manual mesmo que o usuário escaneie um QR
    // novo na mesma instância.
    const instanceUpdate: Record<string, unknown> = {
      status: "connected",
      last_health_check_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    if (ownerPhone) {
      console.log(`📱 Saving connected phone: ${ownerPhone} for instance: ${connInstance}`);
      instanceUpdate.connected_phone = ownerPhone;
    }

    const { data: inst } = await supabase
      .from("whatsapp_instances")
      .update(instanceUpdate)
      .eq("instance_name", connInstance)
      .select("consultant_id, manual_review_required, fatal_lock_until")
      .maybeSingle();

    // Auto-clear recovery_mode + sinais transitórios SOMENTE se não houver
    // fatal lock ativo. Fatal lock só sai por admin_clear_fatal_lock.
    const fatalActive =
      !!(inst as any)?.manual_review_required ||
      (!!(inst as any)?.fatal_lock_until &&
        new Date((inst as any).fatal_lock_until) > new Date());
    if (!fatalActive) {
      try {
        await supabase
          .from("whatsapp_instances")
          .update({ recovery_mode_until: null })
          .eq("instance_name", connInstance);
        await supabase
          .from("instance_risk_signals")
          .delete()
          .eq("instance_name", connInstance)
          .in("signal_type", ["send_failure", "disconnect_transient", "reconnect"]);
        console.log(`✅ Recovery cleared para ${connInstance} após state=open confirmado.`);
      } catch (e: any) {
        console.warn(`[connection] limpeza pós-open falhou: ${e?.message}`);
      }
    }

    // 🔗 CTWA bridge: se o consultor ainda não tem whatsapp_destination_number
    // configurado em consultant_ad_settings (usado para o anúncio Click-to-WhatsApp
    // do Facebook), aproveita o número que acabou de conectar via QR como default.
    const consultantId = (inst as any)?.consultant_id;
    if (ownerPhone && consultantId) {
      try {
        const { data: existing } = await supabase
          .from("consultant_ad_settings")
          .select("whatsapp_destination_number")
          .eq("consultant_id", consultantId)
          .maybeSingle();
        if (!existing?.whatsapp_destination_number) {
          await supabase
            .from("consultant_ad_settings")
            .upsert(
              { consultant_id: consultantId, whatsapp_destination_number: ownerPhone },
              { onConflict: "consultant_id" }
            );
          console.log(`🔗 Sync QR→WABA default: consultant=${consultantId} number=${ownerPhone}`);
        }
      } catch (e: any) {
        console.warn("[connection] sync whatsapp_destination_number falhou:", e?.message);
      }
    }
  }


  if (connState === "close" && connInstance) {
    // 🩹 2026-07-04: Removido o HARD-LOCK automático de 14d.
    // Motivo: 401/403/440 em connection.close representam queda de sessão
    // socket do Evolution (sessão substituída, restart, handshake incompleto)
    // e NÃO ban confirmado do WhatsApp. O antiban pré-04/jun (warmup +
    // min_interval + typing + jitter + recovery_mode + reconnect cooldown)
    // já protege o chip sem travar 14 dias em falso positivo.
    // Ban de verdade agora só é marcado manualmente pelo super-admin via
    // RPC admin_mark_instance_banned.
    const disconnectClass = classifyDisconnect(statusReason);
    const severity = disconnectClass === "fatal" ? "high" : "low";

    try {
      await supabase
        .from("whatsapp_instances")
        .update({ status: "needs_reconnect", updated_at: new Date().toISOString() })
        .eq("instance_name", connInstance);
    } catch (_) { /* non-critical */ }

    await recordRiskSignal(supabase, connInstance, "disconnect_transient", severity, {
      reason: statusReason,
      classified_as: disconnectClass,
    });

    // ── FATAL (401/403/440/…): sessão morta no WhatsApp. Reconectar no mesmo
    // instance_name não resolve — o servidor Evolution mantém o socket morto.
    // Solução: deletar a instância no Evolution e recriar do zero, mantendo o
    // mesmo whatsapp_instances.id. O usuário só precisa escanear o novo QR.
    if (disconnectClass === "fatal" && evolutionApiUrl && evolutionApiKey) {
      const { data: instRow } = await supabase
        .from("whatsapp_instances")
        .select("id, instance_name")
        .eq("instance_name", connInstance)
        .maybeSingle();

      if (instRow?.id) {
        const recreateTask = recreateInstance(supabase, {
          instanceRowId: instRow.id,
          oldInstanceName: connInstance,
          evolutionApiUrl,
          evolutionApiKey,
          triggeredBy: "auto_fatal",
          reason: statusReason ?? null,
        });
        try {
          // @ts-ignore: EdgeRuntime global
          if (typeof EdgeRuntime !== "undefined" && (EdgeRuntime as any)?.waitUntil) {
            // @ts-ignore
            (EdgeRuntime as any).waitUntil(recreateTask);
          } else {
            await recreateTask;
          }
        } catch (_) { void recreateTask; }
      }
      return true;
    }

    // ── TRANSIENTE: apenas agenda reconexão em 30s ──
    const allowedToReconnect = evolutionApiUrl && evolutionApiKey
      && await canReconnect(supabase, connInstance);

    if (allowedToReconnect) {
      const baseUrl = evolutionApiUrl.replace(/\/$/, "");
      console.log(
        `🔄 Instância ${connInstance} desconectou (reason=${statusReason}, class=${disconnectClass}). ` +
        `Agendando reconexão em 30s (background).`,
      );
      const reconnectInBackground = (async () => {
        try {
          await new Promise((r) => setTimeout(r, 30_000));
          const reconnRes = await fetchWithTimeout(`${baseUrl}/instance/connect/${connInstance}`, {
            method: "GET",
            headers: { apikey: evolutionApiKey },
            timeout: 10_000,
          });
          if (reconnRes.ok) {
            console.log(`✅ Reconexão iniciada para ${connInstance}`);
            await recordRiskSignal(supabase, connInstance, "reconnect", "medium", {
              reason: statusReason,
            });
          } else {
            const errText = await reconnRes.text();
            console.warn(`⚠️ Falha ao reconectar ${connInstance}: ${reconnRes.status} ${errText.substring(0, 200)}`);
            await recordRiskSignal(supabase, connInstance, "send_failure", "medium", {
              stage: "reconnect", status: reconnRes.status,
            });
          }
        } catch (e: any) {
          console.warn(`⚠️ Erro ao reconectar ${connInstance}: ${e?.message}`);
        }
      })();
      try {
        // @ts-ignore: EdgeRuntime é global no runtime Supabase Deno.
        if (typeof EdgeRuntime !== "undefined" && (EdgeRuntime as any)?.waitUntil) {
          // @ts-ignore
          (EdgeRuntime as any).waitUntil(reconnectInBackground);
        } else {
          void reconnectInBackground;
        }
      } catch (_) { void reconnectInBackground; }
    } else {
      console.log(`⏳ Reconexão em cooldown persistente (10min) para ${connInstance}`);
    }
  }


  return true;
}
