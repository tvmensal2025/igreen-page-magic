// Notifica os parceiros do rodízio quando uma campanha do Meta é pausada.
// Uma mensagem única por evento de pausa (dedup via
// rodizio_pools.paused_notified_at). O campo é resetado para NULL quando a
// campanha volta a ficar ACTIVE (em facebook-toggle-campaign), permitindo que
// o próximo evento de pausa dispare a mensagem outra vez.
//
// Sempre no tom "estamos cuidando" — nunca alarma o parceiro.

import { sendRawToNumber } from "./notify-consultant.ts";
import { formatCampaignPausedMessage, type CampaignPausedReason } from "./rodizio-metrics-format.ts";

// deno-lint-ignore no-explicit-any
export async function notifyRodizioOnCampaignPaused(
  supabase: any,
  campaignId: string,
  reason: CampaignPausedReason | string,
): Promise<{ sent: number; skipped: number; errors: number }> {
  let sent = 0;
  let skipped = 0;
  let errors = 0;
  try {
    if (!campaignId) return { sent, skipped, errors };

    // Pools desta campanha que ainda não foram avisadas nesta pausa.
    const { data: pools, error: poolErr } = await supabase
      .from("rodizio_pools")
      .select(`
        id, campaign_id, consultant_id, paused_notified_at,
        facebook_campaigns!inner(id, name)
      `)
      .eq("campaign_id", campaignId)
      .is("paused_notified_at", null);
    if (poolErr) {
      console.error("[rodizio-pause-notify] pools query erro:", poolErr.message);
      return { sent, skipped, errors: errors + 1 };
    }

    for (const pool of (pools || []) as any[]) {
      const camp = pool.facebook_campaigns;
      const text = formatCampaignPausedMessage(camp?.name || "Sua campanha", reason);

      // Membros elegíveis (ativos + toggle ligado + com telefone)
      const { data: members } = await supabase
        .from("rodizio_pool_members")
        .select(`
          partner_id, position,
          referral_partners!inner(nome, notification_phone, rodizio_metrics_enabled, is_active)
        `)
        .eq("pool_id", pool.id)
        .order("position", { ascending: true });

      const eligible = (members || []).filter((m: any) => {
        const p = m.referral_partners;
        return p?.is_active !== false && p?.rodizio_metrics_enabled !== false && p?.notification_phone;
      });
      if (eligible.length === 0) { skipped++; continue; }

      // Bucket ISO por minuto — se a mesma pausa dispara em 2 caminhos ao
      // mesmo tempo (raro), a idempotência do log evita mensagem duplicada.
      const pauseBucket = new Date().toISOString().slice(0, 16);
      let anySent = false;

      for (const m of eligible as any[]) {
        const partner = m.referral_partners;
        const idem = `rodizio_paused:${m.partner_id}:${campaignId}:${pauseBucket}`;
        const { error: insErr } = await supabase
          .from("outbound_message_log")
          .insert({
            idempotency_key: idem,
            consultant_id: pool.consultant_id,
            payload_hash: idem,
            result_status: "queued_rodizio_paused",
          });
        if (insErr && (insErr as any)?.code === "23505") { skipped++; continue; }

        try {
          const ok = await sendRawToNumber(pool.consultant_id, partner.notification_phone, text);
          if (ok) { sent++; anySent = true; } else { errors++; }
        } catch (e) {
          errors++;
          console.error("[rodizio-pause-notify] send erro:", (e as Error).message);
        }
      }

      if (anySent) {
        await supabase
          .from("rodizio_pools")
          .update({
            paused_notified_at: new Date().toISOString(),
            last_pause_reason: String(reason).slice(0, 50),
          })
          .eq("id", pool.id);
      }
    }
  } catch (e) {
    errors++;
    console.error("[rodizio-pause-notify] erro geral:", (e as Error).message);
  }
  console.log(`[rodizio-pause-notify] camp=${campaignId} reason=${reason} sent=${sent} skipped=${skipped} errors=${errors}`);
  return { sent, skipped, errors };
}
