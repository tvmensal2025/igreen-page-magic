/**
 * Telefone WhatsApp do consultor para links wa.me em SMS/templates.
 *
 * Fonte: chip CONECTADO (Evolution/Whapi) — nunca `notification_phone`
 * (esse é só alerta humano).
 *
 * Cascata: whatsapp_instances.connected_phone → consultants.phone
 */

/**
 * Normaliza telefone WA do consultor: só dígitos, DDI 55, e 9º dígito
 * quando vier celular antigo (55+DDD+8 dígitos começando em 6–9).
 * Ex.: 553484314317 → 5534984314317 (wa.me precisa do celular completo).
 */
export function normalizeWaPhoneDigits(raw: string | null | undefined): string {
  let d = String(raw || "").replace(/\D/g, "").replace(/^0+/, "");
  if (!d) return "";
  if (!d.startsWith("55") && (d.length === 10 || d.length === 11)) d = `55${d}`;
  if (d.length === 12 && d.startsWith("55")) {
    const ddd = d.slice(2, 4);
    const local = d.slice(4);
    if (local.length === 8 && /^[6-9]/.test(local)) {
      d = `55${ddd}9${local}`;
    }
  }
  return d;
}

/** Link WhatsApp clicável em SMS (sempre com https://). */
export function buildConsultantSmsWaLink(rawPhone: string | null | undefined): string {
  const phone = normalizeWaPhoneDigits(rawPhone);
  return phone ? `https://wa.me/${phone}` : "";
}

/** Resolve o número do WhatsApp conectado do consultor (só dígitos, com DDI 55). */
export async function resolveConsultantConnectedWaPhone(
  // deno-lint-ignore no-explicit-any
  supabase: { from: (t: string) => any },
  consultantId: string | null | undefined,
): Promise<string> {
  if (!consultantId) return "";

  const { data: insts } = await supabase
    .from("whatsapp_instances")
    .select("connected_phone, updated_at")
    .eq("consultant_id", consultantId)
    .not("connected_phone", "is", null)
    .order("updated_at", { ascending: false })
    .limit(1);

  let raw = String((insts as Array<{ connected_phone?: string }> | null)?.[0]?.connected_phone || "");

  if (!raw) {
    const { data: c } = await supabase
      .from("consultants")
      .select("phone")
      .eq("id", consultantId)
      .maybeSingle();
    raw = String((c as { phone?: string } | null)?.phone || "");
  }

  return normalizeWaPhoneDigits(raw);
}
