/**
 * Telefone WhatsApp do consultor para links wa.me em SMS/templates.
 *
 * Fonte: chip CONECTADO (Evolution/Whapi) — nunca `notification_phone`
 * (esse é só alerta humano).
 *
 * Cascata: whatsapp_instances.connected_phone → consultants.phone
 */

export function normalizeWaPhoneDigits(raw: string | null | undefined): string {
  let d = String(raw || "").replace(/\D/g, "");
  if (!d) return "";
  if (!d.startsWith("55") && (d.length === 10 || d.length === 11)) d = `55${d}`;
  return d;
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
