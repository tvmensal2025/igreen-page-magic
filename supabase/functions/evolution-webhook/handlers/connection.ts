// CONNECTION_UPDATE event handler.
// Extracted verbatim from index.ts — no behavior change.

import { fetchWithTimeout } from "../../_shared/utils.ts";
import {
  canReconnect,
  classifyDisconnect,
  recordRiskSignal,
  activateRecoveryMode,
} from "../_helpers.ts";
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
  const statusReason = body.data?.statusReason || 0;
  console.log(`📡 CONNECTION_UPDATE: instance=${connInstance}, state=${connState}, reason=${statusReason}`);

  if (connState === "open" && connInstance) {
    const ownerJid = body.data?.ownerJid || body.ownerJid || "";
    const ownerPhone = ownerJid ? ownerJid.replace(/@.*$/, "") : "";

    // Conexão aberta: sempre normaliza o status para `connected` (limpando um
    // eventual `needs_reconnect` de uma desconexão fatal anterior) e grava o
    // telefone conectado quando disponível.
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
      .select("consultant_id")
      .maybeSingle();

    // 🔗 CTWA bridge: se o consultor ainda não tem whatsapp_destination_number
    // configurado em consultant_ad_settings (usado para o anúncio Click-to-WhatsApp
    // do Facebook), aproveita o número que acabou de conectar via QR como default.
    // O consultor pode sobrescrever depois no formulário de Dados ou via WABA real.
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
    const disconnectClass = classifyDisconnect(statusReason);

    if (disconnectClass === "fatal") {
      console.warn(
        `🛑 Instância ${connInstance} desconectou FATAL (reason=${statusReason}). ` +
        `Marcando needs_reconnect + ativando recovery mode (14d).`,
      );
      try {
        await supabase
          .from("whatsapp_instances")
          .update({ status: "needs_reconnect", updated_at: new Date().toISOString() })
          .eq("instance_name", connInstance);
      } catch (e: any) {
        console.warn(`⚠️ Falha ao marcar ${connInstance} needs_reconnect:`, e?.message);
      }
      // Registra sinal crítico — bloqueia disparos via check_send_quota
      await recordRiskSignal(supabase, connInstance, "disconnect_fatal", "critical", {
        reason: statusReason,
      });
      // Ativa modo recuperação 14 dias — só sai com confirmação manual
      await activateRecoveryMode(supabase, connInstance, 336);
      return true;
    }

    // Transiente: registra sinal + tenta reconectar com cooldown PERSISTENTE de 10 min
    await recordRiskSignal(supabase, connInstance, "disconnect_transient", "low", {
      reason: statusReason,
    });

    const allowedToReconnect = evolutionApiUrl && evolutionApiKey
      && await canReconnect(supabase, connInstance);

    if (allowedToReconnect) {
      const baseUrl = evolutionApiUrl.replace(/\/$/, "");
      console.log(
        `🔄 Instância ${connInstance} desconectou (reason=${statusReason}, transitório). ` +
        `Aguardando 30s antes de reconectar (anti-ban).`,
      );
      try {
        // Delay 30s (era 5s) — pico de reconnect rápido é interpretado como abuso
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
        console.warn(`⚠️ Erro ao reconectar ${connInstance}: ${e.message}`);
      }
    } else {
      console.log(`⏳ Reconexão em cooldown persistente (10min) para ${connInstance}`);
    }
  }

  return true;
}
