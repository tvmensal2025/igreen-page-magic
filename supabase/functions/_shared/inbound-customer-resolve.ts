/**
 * Resolve customer inbound pelo telefone, priorizando carteira iGreen.
 *
 * Bug clássico: sync grava colisão como `5511…_igreenCode` em phone_whatsapp
 * e limpa o dígito em whatsapp_chat_id. O Zap chega com dígitos limpos →
 * lookup exato pega o lead sombra (ou cria lead novo) e o cliente recebe
 * mensagem de cadastro/Grupo A.
 */

import { isWalletCustomer } from "./origin-guard.ts";
import { toWhatsappCanonical } from "./portal-phone.ts";

// deno-lint-ignore no-explicit-any
type SB = any;

export type InboundCustomerRow = Record<string, unknown> & {
  id: string;
  phone_whatsapp?: string | null;
  whatsapp_chat_id?: string | null;
  customer_origin?: string | null;
  status?: string | null;
  created_at?: string | null;
};

function scoreRow(r: InboundCustomerRow): number {
  let s = 0;
  if (isWalletCustomer(r.customer_origin as string | null)) s += 1000;
  const st = String(r.status || "").toLowerCase();
  if (st === "approved" || st === "active" || st === "registered_igreen") s += 100;
  if (st === "pending") s += 10;
  // Mais antigo na carteira costuma ser o canônico; lead sombra é recente.
  const t = r.created_at ? Date.parse(String(r.created_at)) : 0;
  s += t > 0 ? Math.max(0, 50 - Math.floor((Date.now() - t) / 86_400_000)) : 0;
  return s;
}

/** Escolhe a melhor linha entre candidatas (carteira > lead). */
export function pickPreferredInboundCustomer(
  rows: InboundCustomerRow[],
): InboundCustomerRow | null {
  if (!rows.length) return null;
  return [...rows].sort((a, b) => scoreRow(b) - scoreRow(a))[0] || null;
}

/**
 * Busca por phone canônico: exact, chat_id, e sufixo de colisão `_codigo`.
 */
export async function findCustomerForInboundPhone(
  supabase: SB,
  consultantId: string,
  rawPhone: string,
  opts?: { onlyTestLead?: boolean },
): Promise<InboundCustomerRow | null> {
  const phone = toWhatsappCanonical(rawPhone) || String(rawPhone || "").replace(/\D/g, "");
  if (!phone || phone.length < 10) return null;

  const select = "*";
  const base = () => {
    let q = supabase.from("customers").select(select).eq("consultant_id", consultantId);
    if (opts?.onlyTestLead) q = q.eq("is_test_lead", true);
    return q;
  };

  const bag = new Map<string, InboundCustomerRow>();
  const add = (rows: InboundCustomerRow[] | null | undefined) => {
    for (const r of rows || []) {
      if (r?.id) bag.set(String(r.id), r);
    }
  };

  // 1) exact phone_whatsapp
  {
    const { data } = await base().eq("phone_whatsapp", phone).limit(20);
    add(data as InboundCustomerRow[]);
  }
  // 2) whatsapp_chat_id limpo (carteira com sufixo no phone_whatsapp)
  {
    const { data } = await base().eq("whatsapp_chat_id", phone).limit(20);
    add(data as InboundCustomerRow[]);
  }
  // 3) colisão sync: 5511…_<igreen_code>
  {
    const { data } = await base().like("phone_whatsapp", `${phone}_%`).limit(20);
    add(data as InboundCustomerRow[]);
  }

  return pickPreferredInboundCustomer([...bag.values()]);
}

/**
 * Após sync: leads com o mesmo dígito de uma carteira não podem continuar
 * no funil A/B/C. Pausa + DNC (não apaga — histórico/conversas).
 */
export async function absorbLeadShadowsForWalletPhones(
  supabase: SB,
  consultantId: string,
  cleanPhones: string[],
): Promise<{ absorbed: number }> {
  const phones = [...new Set(
    cleanPhones
      .map((p) => toWhatsappCanonical(p) || String(p || "").replace(/\D/g, ""))
      .filter((p) => p.length >= 12),
  )];
  if (!phones.length) return { absorbed: 0 };

  const walletDigits = new Set<string>();
  for (const phone of phones) {
    const { data: byChat } = await supabase
      .from("customers")
      .select("id")
      .eq("consultant_id", consultantId)
      .in("customer_origin", ["igreen_sync", "igreen_extension"])
      .eq("whatsapp_chat_id", phone)
      .limit(1);
    if ((byChat || []).length) {
      walletDigits.add(phone);
      continue;
    }
    const { data: bySuffix } = await supabase
      .from("customers")
      .select("id")
      .eq("consultant_id", consultantId)
      .in("customer_origin", ["igreen_sync", "igreen_extension"])
      .like("phone_whatsapp", `${phone}_%`)
      .limit(1);
    if ((bySuffix || []).length) walletDigits.add(phone);
  }

  const shadowPhones = phones.filter((p) => walletDigits.has(p));
  if (!shadowPhones.length) return { absorbed: 0 };

  let absorbed = 0;
  for (let i = 0; i < shadowPhones.length; i += 100) {
    const chunk = shadowPhones.slice(i, i + 100);
    const { data: leads, error: leadErr } = await supabase
      .from("customers")
      .select("id")
      .eq("consultant_id", consultantId)
      .in("phone_whatsapp", chunk)
      .or("customer_origin.is.null,customer_origin.eq.whatsapp_lead,customer_origin.eq.manual");
    if (leadErr) {
      console.warn("[absorb-lead-shadows] select:", leadErr.message);
      continue;
    }
    const ids = ((leads || []) as Array<{ id: string }>).map((r) => r.id);
    if (!ids.length) continue;
    const { error } = await supabase
      .from("customers")
      .update({
        bot_paused: true,
        do_not_contact: true,
        bot_paused_reason: "absorbed_wallet_duplicate",
        conversation_step: "complete",
      })
      .in("id", ids);
    if (!error) absorbed += ids.length;
    else console.warn("[absorb-lead-shadows] update:", error.message);
  }
  return { absorbed };
}
