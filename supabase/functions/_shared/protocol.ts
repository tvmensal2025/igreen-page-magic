// Geração e envio do "welcome header" (saudação + protocolo de atendimento).
//
// Idempotente: se `customers.tracking_protocol` já estiver preenchido,
// NÃO regera nem reenvia.
//
// Formato do PROTOCOLO DE ATENDIMENTO (ticket do cliente):
//   IGR-{XXX}-{seq4}  ex.: IGR-RFF-0042
//   - XXX = short_code do parceiro OU 3 iniciais do nome (pad 'X' se curto).
//   - seq4 = sequência global crescente por parceiro (não zera por dia).
//
// IMPORTANTE — não confundir com o PROTOCOLO DA CAMPANHA (2026-####),
// que vai no anúncio Meta e é usado pra casar o lead com a campanha/rodízio.
// Esse aqui é o "número do chamado" que fica com o cliente pra suporte.


import { greetingForNow, partnerInitials } from "./greeting.ts";

export interface AssignProtocolResult {
  protocol: string;
  isNew: boolean;
}

export async function assignProtocolToCustomer(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  customerId: string,
  opts: {
    partnerId?: string | null;
    partnerName?: string | null;
    consultantId?: string | null;
    consultantName?: string | null;
  },
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

    // Bucket da sequência: parceiro > consultor > customer (sempre UUID válido)
    const partnerId = opts.partnerId || opts.consultantId || customerId;

    // Busca short_code + nome do parceiro para a RPC (chave estável)
    let partnerName = opts.partnerName || null;
    let shortCode: string | null = null;
    if (opts.partnerId) {
      const { data: p } = await supabase
        .from("referral_partners")
        .select("nome, short_code")
        .eq("id", opts.partnerId)
        .maybeSingle();
      if (p) {
        partnerName = partnerName || (p as any).nome || null;
        shortCode = (p as any).short_code ? String((p as any).short_code) : null;
      }
    }

    // _initials: se temos short_code, a RPC prioriza a coluna do parceiro;
    // ainda assim passamos short_code/iniciais como hint de fallback.
    const initialsHint = shortCode || partnerInitials(partnerName || opts.consultantName || "");

    const { data: gen, error } = await supabase.rpc("generate_partner_protocol", {
      _partner_id: partnerId,
      _initials: initialsHint,
    });
    if (error || !gen) {
      console.warn("[protocol] rpc falhou:", error?.message);
      // Fallback local: short_code ou iniciais + data + 4 chars do customer
      const stamp = new Date().toISOString().slice(2, 10).replace(/-/g, "");
      const key = (shortCode || partnerInitials(partnerName || opts.consultantName || "") || "IGR").toUpperCase();
      const short = String(customerId).replace(/-/g, "").slice(0, 4).toUpperCase();
      const protocol = `${key}-${stamp}-${short}`;
      await supabase.from("customers").update({ tracking_protocol: protocol }).eq("id", customerId);
      return { protocol, isNew: true };
    }

    const protocol = String(gen);
    await supabase.from("customers").update({ tracking_protocol: protocol }).eq("id", customerId);
    return { protocol, isNew: true };
  } catch (e) {
    console.warn("[protocol] assign falhou:", (e as Error).message);
    return null;
  }
}

export function buildWelcomeHeaderGreeting(consultantName?: string | null): string {
  const who = (consultantName || "").trim();
  const lines = [
    `Olá! ${greetingForNow()} 👋`,
    "Este é o canal de atendimento especializado da *iGreen Energy*.",
  ];
  if (who) lines.push(`Você será atendido(a) por *${who}*.`);
  return lines.join("\n");
}

/** Bloco profissional: Atendimento iniciado + consultor + protocolo.
 * Sem linhas unicode (━━━) — no WhatsApp Web/mobile elas quebram o visual.
 * Protocolo em *negrito* numa linha só (continua detectável pelos webhooks). */
export function buildWelcomeHeaderProtocol(
  protocol: string,
  consultantName?: string | null,
): string {
  const who = (consultantName || "").trim();
  return [
    "✅ *Atendimento iniciado*",
    "",
    who ? `👤 Consultor(a): *${who}*` : null,
    `📋 Protocolo: *${protocol}*`,
  ].filter((l) => l !== null).join("\n");
}
