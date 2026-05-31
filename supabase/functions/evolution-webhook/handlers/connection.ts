// CONNECTION_UPDATE event handler.
// Extracted verbatim from index.ts — no behavior change.

import { fetchWithTimeout } from "../../_shared/utils.ts";
import { canReconnect, classifyDisconnect } from "../_helpers.ts";
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
    // Classifica o motivo: ban/logout/conflito são FATAIS — reconectar uma
    // sessão derrubada por esses motivos só agrava o bloqueio do número.
    const disconnectClass = classifyDisconnect(statusReason);

    if (disconnectClass === "fatal") {
      console.warn(
        `🛑 Instância ${connInstance} desconectou com motivo FATAL (reason=${statusReason}). ` +
        `NÃO será reconectada automaticamente — exige novo QR Code.`,
      );
      // Marca a instância como needs_reconnect para que o painel/health-cron
      // alertem o consultor e o frontend force a geração de um novo QR.
      // Best-effort: não falha o webhook se o update der erro.
      try {
        await supabase
          .from("whatsapp_instances")
          .update({ status: "needs_reconnect", updated_at: new Date().toISOString() })
          .eq("instance_name", connInstance);
      } catch (e: any) {
        console.warn(`⚠️ Falha ao marcar ${connInstance} como needs_reconnect:`, e?.message);
      }
      return true;
    }

    // Motivo transitório (queda de rede, restart, timeout): reconecta com
    // cooldown de 2 min para não martelar o servidor Evolution.
    if (evolutionApiUrl && evolutionApiKey && canReconnect(connInstance)) {
      const baseUrl = evolutionApiUrl.replace(/\/$/, "");
      console.log(`🔄 Instância ${connInstance} desconectou (reason=${statusReason}, transitório). Tentando reconectar em 5s...`);
      try {
        await new Promise((r) => setTimeout(r, 5000));
        const reconnRes = await fetchWithTimeout(`${baseUrl}/instance/connect/${connInstance}`, {
          method: "GET",
          headers: { apikey: evolutionApiKey },
          timeout: 10_000,
        });
        if (reconnRes.ok) {
          console.log(`✅ Reconexão iniciada para ${connInstance}`);
        } else {
          const errText = await reconnRes.text();
          console.warn(`⚠️ Falha ao reconectar ${connInstance}: ${reconnRes.status} ${errText.substring(0, 200)}`);
        }
      } catch (e: any) {
        console.warn(`⚠️ Erro ao tentar reconectar ${connInstance}: ${e.message}`);
      }
    } else {
      console.log(`⏳ Reconexão em cooldown para ${connInstance}, aguardando 2 min`);
    }
  }

  return true;
}
