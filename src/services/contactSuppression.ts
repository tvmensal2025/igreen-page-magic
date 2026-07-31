/**
 * Unifica opt-out / "nunca mais contatar" no frontend.
 * Seta customers.do_not_contact + bot_paused, voice_dnc_list, discard captured_leads, log.
 */
import { supabase } from "@/integrations/supabase/client";
import { discardLead } from "@/services/capturedLeads";

export type SuppressionReason = "complaint" | "requested" | "legal" | "opt_out";

export interface SuppressContactInput {
  consultantId: string;
  customerId?: string | null;
  phone?: string | null;
  reason?: SuppressionReason;
  channel?: string;
  notes?: string | null;
  /** Se buffer captado (sem customer ainda). */
  capturedLeadId?: string | null;
}

export interface SuppressContactResult {
  ok: boolean;
  error?: string;
}

function digitsOnly(phone: string | null | undefined): string {
  return String(phone || "").replace(/\D/g, "");
}

/**
 * Marca lead para nunca mais receber contato (automático nem manual na v1).
 */
export async function suppressContact(input: SuppressContactInput): Promise<SuppressContactResult> {
  const reason = input.reason || "complaint";
  const botPausedReason = reason === "complaint" ? "complaint" : "opt_out";
  let phone = digitsOnly(input.phone);
  let customerId = input.customerId || null;

  try {
    const { data: auth } = await supabase.auth.getUser();
    const actorId = auth?.user?.id ?? null;

    if (customerId) {
      if (!phone) {
        const { data: cust } = await supabase
          .from("customers")
          .select("phone_whatsapp")
          .eq("id", customerId)
          .maybeSingle();
        phone = digitsOnly((cust as { phone_whatsapp?: string } | null)?.phone_whatsapp);
      }

      const now = new Date().toISOString();
      const { error: custErr } = await supabase
        .from("customers")
        .update({
          do_not_contact: true,
          bot_paused: true,
          bot_paused_reason: botPausedReason,
          bot_paused_at: now,
          bot_force_enabled: false,
          attendance_rating_requested_at: null,
          conversation_step: "atendimento_finalizado",
        } as never)
        .eq("id", customerId);

      if (custErr) return { ok: false, error: custErr.message };
    }

    if (phone) {
      const { error: dncErr } = await supabase.from("voice_dnc_list").upsert(
        {
          consultant_id: input.consultantId,
          phone,
          reason,
          source: "admin_ui",
        },
        { onConflict: "consultant_id,phone" },
      );
      if (dncErr) return { ok: false, error: dncErr.message };

      // Discard captured leads do mesmo telefone / customer
      let discardQ = supabase
        .from("captured_leads")
        .update({ status: "discarded" })
        .eq("consultant_id", input.consultantId);

      if (customerId) {
        discardQ = discardQ.or(`customer_id.eq.${customerId},phone.eq.${phone}`);
      } else {
        discardQ = discardQ.eq("phone", phone);
      }
      await discardQ;
    }

    if (input.capturedLeadId) {
      await discardLead(input.capturedLeadId);
      if (!customerId) {
        const { data: lead } = await supabase
          .from("captured_leads")
          .select("customer_id, phone")
          .eq("id", input.capturedLeadId)
          .maybeSingle();
        customerId = (lead as { customer_id?: string } | null)?.customer_id || null;
        if (!phone) phone = digitsOnly((lead as { phone?: string } | null)?.phone);
        if (customerId) {
          const now = new Date().toISOString();
          await supabase
            .from("customers")
            .update({
              do_not_contact: true,
              bot_paused: true,
              bot_paused_reason: botPausedReason,
              bot_paused_at: now,
              bot_force_enabled: false,
            } as never)
            .eq("id", customerId);
        }
      }
    }

    const { error: logErr } = await supabase.from("contact_suppression_log").insert({
      customer_id: customerId,
      consultant_id: input.consultantId,
      phone: phone || input.phone || "",
      reason,
      channel: input.channel || "admin_ui",
      actor_id: actorId,
      notes: input.notes ?? null,
    });

    if (logErr) {
      // Log é secundário — flags já aplicadas
      console.warn("[contactSuppression] log insert failed:", logErr.message);
    }

    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error)?.message || "Falha ao bloquear contato" };
  }
}

/**
 * Revoga opt-out (ação explícita). Remove do_not_contact; DNC voz fica até remoção manual na aba Voz.
 */
export async function revokeContactSuppression(input: {
  consultantId: string;
  customerId: string;
}): Promise<SuppressContactResult> {
  try {
    // O bloqueio setou do_not_contact + bot_paused. Revogar só o do_not_contact
    // deixava bot_paused=true e o motor continuava pulando o lead para sempre.
    // Só despausamos quando a pausa veio do próprio opt-out (nunca em handoff humano).
    const { data: current } = await supabase
      .from("customers")
      .select("bot_paused, bot_paused_reason")
      .eq("id", input.customerId)
      .maybeSingle();
    const pauseReason = (current as { bot_paused_reason?: string | null } | null)?.bot_paused_reason || null;
    const pausedByOptOut = !!(current as { bot_paused?: boolean } | null)?.bot_paused &&
      (pauseReason === "complaint" || pauseReason === "opt_out");

    const patch: Record<string, unknown> = {
      do_not_contact: false,
      bot_paused_reason: null,
    };
    if (pausedByOptOut) {
      patch.bot_paused = false;
      patch.bot_paused_at = null;
      patch.bot_paused_until = null;
    }

    const { error } = await supabase
      .from("customers")
      .update(patch as never)
      .eq("id", input.customerId)
      .eq("consultant_id", input.consultantId);

    if (error) return { ok: false, error: error.message };

    const { data: auth } = await supabase.auth.getUser();
    await supabase.from("contact_suppression_log").insert({
      customer_id: input.customerId,
      consultant_id: input.consultantId,
      phone: "",
      reason: "revoked",
      channel: "admin_ui",
      actor_id: auth?.user?.id ?? null,
      notes: "Revogação explícita de opt-out",
    });

    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error)?.message || "Falha ao revogar" };
  }
}

/** Checagem rápida no cliente (antes de enviar). */
export async function isContactSuppressed(customerId: string | null | undefined): Promise<boolean> {
  if (!customerId) return false;
  const { data } = await supabase
    .from("customers")
    .select("do_not_contact")
    .eq("id", customerId)
    .maybeSingle();
  return !!(data as { do_not_contact?: boolean } | null)?.do_not_contact;
}
