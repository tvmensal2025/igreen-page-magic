/**
 * Gate único: este lead/telefone pode receber contato?
 * Fonte da verdade: customers.do_not_contact (+ voice_dnc_list para voz/SMS).
 * Additivo — não remove bot_paused / checkCustomerCanSend.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export type ContactChannel = "whatsapp" | "voice" | "sms" | "reheat" | "bulk" | "any";

export interface ContactSuppressionInput {
  customerId?: string | null;
  phone?: string | null;
  consultantId?: string | null;
  channel?: ContactChannel;
}

export interface ContactSuppressionResult {
  allowed: boolean;
  reason: string | null;
  doNotContact: boolean;
  voiceDnc: boolean;
}

function digitsOnly(phone: string | null | undefined): string {
  return String(phone || "").replace(/\D/g, "");
}

function phonesMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  return a.endsWith(b) || b.endsWith(a);
}

/**
 * Retorna allowed=false se do_not_contact ou (canais voz/sms/reheat) voice_dnc.
 * Nunca lança — em erro falha fechado (allowed=false) sempre.
 */
export async function assertCanContact(
  supabase: SupabaseClient,
  input: ContactSuppressionInput,
): Promise<ContactSuppressionResult> {
  const channel = input.channel ?? "any";
  const phoneDigits = digitsOnly(input.phone);
  let doNotContact = false;
  let voiceDnc = false;
  let consultantId = input.consultantId ?? null;

  try {
    if (input.customerId) {
      const { data, error } = await supabase
        .from("customers")
        .select("id, do_not_contact, phone_whatsapp, consultant_id")
        .eq("id", input.customerId)
        .maybeSingle();

      if (error) {
        console.warn("[contact-suppression] customer lookup failed:", error.message);
        return { allowed: false, reason: "lookup_error", doNotContact: true, voiceDnc: false };
      }
      if (!data) {
        return { allowed: false, reason: "customer_not_found", doNotContact: false, voiceDnc: false };
      }
      doNotContact = !!(data as { do_not_contact?: boolean }).do_not_contact;
      consultantId = consultantId || (data as { consultant_id?: string }).consultant_id || null;
      if (!phoneDigits) {
        const wa = digitsOnly((data as { phone_whatsapp?: string }).phone_whatsapp);
        if (wa) {
          // used below for DNC match
          (input as { phone?: string }).phone = wa;
        }
      }
    }

    if (doNotContact) {
      return {
        allowed: false,
        reason: "do_not_contact",
        doNotContact: true,
        voiceDnc: false,
      };
    }

    // Sem customerId: ainda bloqueia se algum customer DNC bater no telefone.
    const phoneForLookup = digitsOnly(input.phone) || phoneDigits;
    if (!input.customerId && phoneForLookup.length >= 10) {
      const tail = phoneForLookup.slice(-11);
      let q = supabase
        .from("customers")
        .select("id, do_not_contact, phone_whatsapp, consultant_id")
        .eq("do_not_contact", true)
        .ilike("phone_whatsapp", `%${tail}`)
        .limit(10);
      if (consultantId) q = q.eq("consultant_id", consultantId);
      const { data: dncRowsByPhone, error: phoneLookupErr } = await q;
      if (phoneLookupErr) {
        console.warn("[contact-suppression] phone DNC lookup failed:", phoneLookupErr.message);
        return { allowed: false, reason: "lookup_error", doNotContact: true, voiceDnc: false };
      }
      const hit = (dncRowsByPhone ?? []).some((r: { phone_whatsapp?: string }) => {
        const d = digitsOnly(r.phone_whatsapp);
        return phonesMatch(phoneForLookup, d);
      });
      if (hit) {
        return {
          allowed: false,
          reason: "do_not_contact",
          doNotContact: true,
          voiceDnc: false,
        };
      }
    }

    const checkVoiceDnc = channel === "voice" || channel === "sms" || channel === "reheat" || channel === "any";
    const phoneForDnc = digitsOnly(input.phone) || phoneDigits;

    if (checkVoiceDnc && consultantId && phoneForDnc) {
      const { data: dncRows, error: voiceDncErr } = await supabase
        .from("voice_dnc_list")
        .select("phone")
        .eq("consultant_id", consultantId);

      if (voiceDncErr) {
        console.warn("[contact-suppression] voice_dnc lookup failed:", voiceDncErr.message);
        return { allowed: false, reason: "lookup_error", doNotContact: false, voiceDnc: true };
      }

      const blocked = (dncRows ?? []).map((r: { phone: string }) => digitsOnly(r.phone)).filter(Boolean);
      voiceDnc = blocked.some((b) => phonesMatch(phoneForDnc, b));
      if (voiceDnc) {
        return {
          allowed: false,
          reason: "voice_dnc",
          doNotContact: false,
          voiceDnc: true,
        };
      }
    }

    return { allowed: true, reason: null, doNotContact: false, voiceDnc: false };
  } catch (e) {
    console.warn("[contact-suppression] unexpected:", (e as Error)?.message);
    // Fail-closed sempre: erro na verificação NÃO libera envio (manual, auto, voz, bulk).
    return { allowed: false, reason: "exception", doNotContact: true, voiceDnc: false };
  }
}

/** Aplica flags de suppression em customers (service role). */
export async function applyCustomerSuppression(
  supabase: SupabaseClient,
  params: {
    customerId: string;
    consultantId: string;
    phone: string;
    reason?: string;
    channel?: string;
    actorId?: string | null;
    notes?: string | null;
  },
): Promise<{ ok: boolean; error?: string }> {
  const reason = params.reason || "complaint";
  const phone = digitsOnly(params.phone);
  const now = new Date().toISOString();

  const { error: custErr } = await supabase
    .from("customers")
    .update({
      do_not_contact: true,
      bot_paused: true,
      bot_paused_reason: reason === "complaint" ? "complaint" : "opt_out",
      bot_paused_at: now,
      bot_force_enabled: false,
      attendance_rating_requested_at: null,
      conversation_step: "atendimento_finalizado",
    })
    .eq("id", params.customerId);

  if (custErr) return { ok: false, error: custErr.message };

  if (phone) {
    await supabase.from("voice_dnc_list").upsert(
      {
        consultant_id: params.consultantId,
        phone,
        reason,
        source: "admin_ui",
      },
      { onConflict: "consultant_id,phone" },
    );

    await supabase
      .from("captured_leads")
      .update({ status: "discarded" })
      .eq("consultant_id", params.consultantId)
      .or(`customer_id.eq.${params.customerId},phone.eq.${phone}`);
  }

  await supabase.from("contact_suppression_log").insert({
    customer_id: params.customerId,
    consultant_id: params.consultantId,
    phone: phone || params.phone || "",
    reason,
    channel: params.channel || "admin_ui",
    actor_id: params.actorId ?? null,
    notes: params.notes ?? null,
  });

  return { ok: true };
}
