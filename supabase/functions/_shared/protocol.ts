// Geração e envio do "welcome header" (saudação + protocolo).
//
// Idempotente: se `customers.tracking_protocol` já estiver preenchido,
// NÃO regera nem reenvia.

import { greetingForNow, partnerInitials } from "./greeting.ts";

export interface AssignProtocolResult {
  protocol: string;
  isNew: boolean;
}

export async function assignProtocolToCustomer(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  customerId: string,
  opts: { partnerId?: string | null; partnerName?: string | null; consultantName?: string | null },
): Promise<AssignProtocolResult | null> {
  try {
    const { data: existing } = await supabase
      .from("customers")
      .select("tracking_protocol")
      .eq("id", customerId)
      .maybeSingle();

    if (existing?.tracking_protocol) {
      return { protocol: existing.tracking_protocol, isNew: false };
    }

    const initials = partnerInitials(opts.partnerName || opts.consultantName || "");
    const partnerId = opts.partnerId || customerId; // fallback: usa customerId como bucket

    const { data: gen, error } = await supabase.rpc("generate_partner_protocol", {
      _partner_id: partnerId,
      _initials: initials,
    });
    if (error || !gen) {
      console.warn("[protocol] rpc falhou:", error?.message);
      return null;
    }

    const protocol = String(gen);
    await supabase.from("customers").update({ tracking_protocol: protocol }).eq("id", customerId);
    return { protocol, isNew: true };
  } catch (e) {
    console.warn("[protocol] assign falhou:", (e as Error).message);
    return null;
  }
}

export function buildWelcomeHeaderGreeting(): string {
  return `Olá, ${greetingForNow()}! 👋\nEsse é o canal de atendimento especializado da iGreen Energy.`;
}

export function buildWelcomeHeaderProtocol(protocol: string): string {
  return [
    "━━━━━━━━━━━━━━━━━━━━━━",
    "📋 Protocolo de atendimento",
    `*${protocol}*`,
    "━━━━━━━━━━━━━━━━━━━━━",
    "💚💚💚💚💚💚💚💚💚💚💚💚",
  ].join("\n");
}
