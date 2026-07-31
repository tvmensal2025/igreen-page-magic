// Auto-takeover: ao consultor enviar QUALQUER coisa (texto, áudio, imagem, doc),
// pausamos o bot pra IA não falar por cima. Único ponto de verdade no frontend.
//
// Regra: ação manual do consultor sobre um lead = aquele lead é despausado
// e marcado como `humano_assumiu`. Pausa global (`manual_global_pause`)
// continua nos leads que ninguém tocou — só é tirada por:
//   - clique "Religar bot global" (RPC admin_unpause_global_bot)
//   - envio manual / takeover (esta função)
//
// Uso:
//   import { autoTakeoverByPhone } from "@/lib/whatsapp/auto-takeover";
//   await autoTakeoverByPhone(rawPhone, "humano_assumiu");

import { supabase } from "@/integrations/supabase/client";
import { pauseCadenceForHandoff } from "@/lib/handoffReturnToPizza";

type Reason =
  | "humano_assumiu"
  | "humano_assumiu_midia"
  | "humano_assumiu_audio"
  | "humano_assumiu_template"
  | "humano_assumiu_whatsapp";

async function applyPause(customerId: string, reason: Reason) {
  const { data: userRes } = await supabase.auth.getUser();
  const uid = userRes?.user?.id || null;
  // Takeover por echo/outbound `fromMe` (`humano_assumiu_whatsapp`) expira em 24h —
  // é um motivo automático propenso a falso positivo; sem timeout, leads travam para sempre.
  const pausedUntil = reason === "humano_assumiu_whatsapp"
    ? new Date(Date.now() + 24 * 3600_000).toISOString()
    : null;
  const patch = {
    bot_paused: true,
    bot_paused_reason: reason,
    bot_paused_at: new Date().toISOString(),
    bot_paused_until: pausedUntil,
    assigned_human_id: uid,
    // Corta reply atrasado do bot-flow que ainda está processando.
    bot_processing_until: null,
    updated_at: new Date().toISOString(),
  };
  // RLS negando UPDATE em customers NÃO gera erro: retorna 0 linhas. Sem
  // exigir a linha de volta, o fallback da edge nunca era acionado e o bot
  // continuava respondendo em cima do humano.
  const { data: updated, error } = await supabase
    .from("customers")
    .update(patch as never)
    .eq("id", customerId)
    .select("id")
    .maybeSingle();
  if (error || !updated) {
    console.warn("[auto-takeover] update RLS falhou — tentando edge:", error?.message || "0 linhas");
    const { error: invErr } = await supabase.functions.invoke("customer-takeover", {
      body: { customerId, paused: true, reason },
    });
    if (invErr) {
      console.error("[auto-takeover] edge fallback falhou:", invErr.message);
      return false;
    }
  }
  // Entra no painel do dashboard (voltar / esquecer / bloquear).
  await pauseCadenceForHandoff(customerId);
  return true;
}

export async function autoTakeoverByCustomerId(
  customerId: string,
  reason: Reason = "humano_assumiu",
): Promise<boolean> {
  const r = await takeoverByCustomerIdDetailed(customerId, reason);
  return r === "new" || r === "already";
}

export async function takeoverByCustomerIdDetailed(
  customerId: string,
  reason: Reason = "humano_assumiu",
): Promise<"new" | "already" | "fail"> {
  if (!customerId) return "fail";
  try {
    const { data: cust } = await supabase
      .from("customers")
      .select("id, bot_paused, assigned_human_id")
      .eq("id", customerId)
      .maybeSingle();
    if (!cust) return "fail";
    // Já pausado com humano: só reforça timestamp/processing (sem toast "novo").
    if (cust.bot_paused && cust.assigned_human_id) {
      await applyPause(customerId, reason);
      return "already";
    }
    const ok = await applyPause(customerId, reason);
    return ok ? "new" : "fail";
  } catch (e) {
    console.warn("[auto-takeover] erro inesperado:", e);
    return "fail";
  }
}

export async function autoTakeoverByPhone(
  rawPhone: string,
  reason: Reason = "humano_assumiu",
): Promise<boolean> {
  const r = await takeoverByPhoneDetailed(rawPhone, reason);
  return r === "new" || r === "already";
}

export async function takeoverByPhoneDetailed(
  rawPhone: string,
  reason: Reason = "humano_assumiu",
): Promise<"new" | "already" | "fail"> {
  const phoneDigits = (rawPhone || "").replace(/\D/g, "");
  if (!phoneDigits) return "fail";
  try {
    const { data: cust } = await supabase
      .from("customers")
      .select("id, bot_paused, assigned_human_id")
      .eq("phone_whatsapp", phoneDigits)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!cust) {
      console.warn(`[auto-takeover] nenhum customer encontrado para ${phoneDigits}`);
      return "fail";
    }
    if (cust.bot_paused && cust.assigned_human_id) {
      await applyPause(cust.id, reason);
      return "already";
    }
    const ok = await applyPause(cust.id, reason);
    return ok ? "new" : "fail";
  } catch (e) {
    console.warn("[auto-takeover] erro inesperado:", e);
    return "fail";
  }
}

/** Desfaz o takeover: religa o bot e remove a vinculação humana.
 *  Não religa se do_not_contact (opt-out / reclamação).
 */
export async function undoTakeoverByPhone(rawPhone: string): Promise<boolean> {
  const phoneDigits = (rawPhone || "").replace(/\D/g, "");
  if (!phoneDigits) return false;
  try {
    const { data: cust } = await supabase
      .from("customers")
      .select("id, do_not_contact")
      .eq("phone_whatsapp", phoneDigits)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!cust) return false;
    if ((cust as { do_not_contact?: boolean }).do_not_contact) {
      console.warn("[auto-takeover] undo bloqueado — do_not_contact");
      return false;
    }
    const patch = {
      bot_paused: false,
      bot_paused_reason: null,
      bot_paused_until: null,
      assigned_human_id: null,
      updated_at: new Date().toISOString(),
    };
    const { data: resumed, error } = await supabase
      .from("customers")
      .update(patch)
      .eq("id", cust.id)
      .select("id")
      .maybeSingle();
    if (error || !resumed) {
      const { error: invErr } = await supabase.functions.invoke("customer-takeover", {
        body: { customerId: cust.id, paused: false },
      });
      if (invErr) return false;
    }
    // Tira do painel de handoff se estava lá.
    await supabase
      .from("lead_cadence_state")
      .update({
        paused_reason: null,
        paused_until: null,
        next_action_at: new Date().toISOString(),
      } as never)
      .eq("customer_id", cust.id)
      .eq("paused_reason", "handoff_humano");
    return true;
  } catch {
    return false;
  }
}

