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

export type InboundCustomerRow = {
  id: string;
  phone_whatsapp?: string | null;
  whatsapp_chat_id?: string | null;
  customer_origin?: string | null;
  status?: string | null;
  created_at?: string | null;
  conversation_step?: string | null;
  consultant_id?: string | null;
  // Campos extras do select("*") — tipagem frouxa p/ não quebrar webhooks.
  // deno-lint-ignore no-explicit-any
  [key: string]: any;
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
  // deno-lint-ignore no-explicit-any
): Promise<any> {
  const phone = toWhatsappCanonical(rawPhone) || String(rawPhone || "").replace(/\D/g, "");
  if (!phone || phone.length < 10) return null;

  const select = "*";
  const base = () => {
    let q = supabase.from("customers").select(select).eq("consultant_id", consultantId);
    if (opts?.onlyTestLead) q = q.eq("is_test_lead", true);
    // Preferência canônica fica em pickPreferredInboundCustomer (carteira > status).
    // Não ordenar por name: com limit(20) poderia excluir o registro de carteira.
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
 * Copia a atribuição de parceiro do lead sombra para a linha de CARTEIRA do
 * mesmo telefone, quando a carteira ainda não tem parceiro.
 *
 * Por que existe: a absorção de sombra marca `do_not_contact=true` na linha do
 * lead. O portal do parceiro (`get_partner_banner_portal`) e o
 * `notifyPartnerNewLead` filtram DNC, então o parceiro perdia o crédito de um
 * cliente que ele mesmo indicou assim que o cadastro entrava na carteira.
 *
 * CAS: só escreve se a carteira estiver com `referral_partner_id` nulo — nunca
 * sobrescreve atribuição existente (rodízio ou outro parceiro).
 */
async function carryPartnerAttributionToWalletRow(
  supabase: SB,
  consultantId: string,
  shadow: InboundCustomerRow,
): Promise<boolean> {
  const partnerId = String(shadow?.referral_partner_id ?? "").trim();
  if (!partnerId) return false;

  const basePhone = toWhatsappCanonical(shadow?.phone_whatsapp ?? "") ||
    String(shadow?.phone_whatsapp ?? "").replace(/\D/g, "");
  if (basePhone.length < 12) return false;

  const walletSelect = "id, referral_partner_id";
  const walletBase = () =>
    supabase
      .from("customers")
      .select(walletSelect)
      .eq("consultant_id", consultantId)
      .in("customer_origin", ["igreen_sync", "igreen_extension"]);

  // Tipo NOMEADO: `as typeof target` seria resolvido como `as null` pelo
  // control-flow (target acabou de receber null) e apagaria a tipagem.
  type WalletTarget = { id: string; referral_partner_id?: string | null };
  let target: WalletTarget | null = null;
  {
    const { data } = await walletBase().eq("whatsapp_chat_id", basePhone).limit(1);
    target = ((data || [])[0] as WalletTarget | undefined) ?? null;
  }
  if (!target) {
    const { data } = await walletBase().like("phone_whatsapp", `${basePhone}_%`).limit(1);
    target = ((data || [])[0] as WalletTarget | undefined) ?? null;
  }
  if (!target?.id || target.referral_partner_id) return false;

  const { data: applied, error } = await supabase
    .from("customers")
    .update({
      referral_partner_id: partnerId,
      referral_keyword_matched: shadow?.referral_keyword_matched ?? null,
      referral_detected_at: shadow?.referral_detected_at ?? new Date().toISOString(),
    })
    .eq("id", target.id)
    .is("referral_partner_id", null)
    .select("id")
    .maybeSingle();

  if (error) {
    console.warn("[absorb-lead-shadows] carry parceiro falhou:", error.message);
    return false;
  }
  if (applied) {
    console.log(
      `[absorb-lead-shadows] parceiro ${partnerId} migrado sombra=${shadow.id} -> carteira=${target.id}`,
    );
    return true;
  }
  return false;
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
      .select(
        "id, phone_whatsapp, referral_partner_id, referral_keyword_matched, referral_detected_at",
      )
      .eq("consultant_id", consultantId)
      .in("phone_whatsapp", chunk)
      .or("customer_origin.is.null,customer_origin.eq.whatsapp_lead,customer_origin.eq.manual");
    if (leadErr) {
      console.warn("[absorb-lead-shadows] select:", leadErr.message);
      continue;
    }
    const ids = ((leads || []) as Array<{ id: string }>).map((r) => r.id);
    if (!ids.length) continue;

    // ANTES de marcar DNC: leva a atribuição de parceiro para a linha de
    // carteira. Sem isso o crédito do parceiro ficava numa linha
    // `do_not_contact=true`, que o portal do parceiro e o `notifyPartnerNewLead`
    // ignoram — o parceiro indicou, o cliente entrou na carteira, e o parceiro
    // simplesmente desaparecia do lead.
    for (const shadow of (leads || []) as InboundCustomerRow[]) {
      await carryPartnerAttributionToWalletRow(supabase, consultantId, shadow);
    }

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
