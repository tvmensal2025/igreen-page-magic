/**
 * Telefone WhatsApp do consultor para links wa.me em SMS/templates.
 *
 * Fonte: chip do CANAL REAL de conversa — nunca `notification_phone`.
 *
 * Cascata:
 *   1) Se channelKind=whapi → settings.whapi_connected_phone
 *   2) whatsapp_instances.connected_phone só se status saudável
 *      (connected/online/open) — NÃO usar needs_reconnect/awaiting_qr
 *   3) consultants.phone
 *   4) settings.whapi_connected_phone (fallback linha compartilhada)
 *
 * Motivo: Silvia tinha Evolution needs_reconnect com connected_phone antigo;
 * WA ia no Whapi (5534…) e SMS apontava wa.me/5514… (chip morto).
 */

const HEALTHY_INSTANCE_STATUSES = new Set(["connected", "online", "open"]);

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

type SettingsRow = { key?: string; value?: string | null };

export type ResolveWaPhoneOpts = {
  /**
   * Canal real de outbound / origem do lead.
   * `whapi` → prioriza chip Whapi settings (evita wa.me de Evolution morta).
   */
  channelKind?: string | null;
};

async function loadWhapiPhoneFromSettings(
  // deno-lint-ignore no-explicit-any
  supabase: { from: (t: string) => any },
): Promise<string> {
  try {
    const { data } = await supabase
      .from("settings")
      .select("key, value")
      .in("key", ["whapi_connected_phone"]);
    const row = ((data as SettingsRow[] | null) || []).find((r) => r?.key === "whapi_connected_phone");
    return normalizeWaPhoneDigits(row?.value);
  } catch {
    return "";
  }
}

/** Resolve o número do WhatsApp conectado do consultor (só dígitos, com DDI 55). */
export async function resolveConsultantConnectedWaPhone(
  // deno-lint-ignore no-explicit-any
  supabase: { from: (t: string) => any },
  consultantId: string | null | undefined,
  opts?: ResolveWaPhoneOpts,
): Promise<string> {
  if (!consultantId) return "";

  const kind = String(opts?.channelKind || "").toLowerCase();

  // Conversa no Whapi → link deve ser o chip Whapi, não Evolution legada.
  if (kind === "whapi") {
    const whapi = await loadWhapiPhoneFromSettings(supabase);
    if (whapi) return whapi;
  }

  const { data: insts } = await supabase
    .from("whatsapp_instances")
    .select("connected_phone, status, updated_at")
    .eq("consultant_id", consultantId)
    .not("connected_phone", "is", null)
    .order("updated_at", { ascending: false })
    .limit(5);

  let raw = "";
  for (const row of (insts as Array<{ connected_phone?: string; status?: string }> | null) || []) {
    const st = String(row.status || "").toLowerCase();
    if (st && HEALTHY_INSTANCE_STATUSES.has(st) && row.connected_phone) {
      raw = String(row.connected_phone);
      break;
    }
  }

  if (!raw) {
    const { data: c } = await supabase
      .from("consultants")
      .select("phone")
      .eq("id", consultantId)
      .maybeSingle();
    raw = String((c as { phone?: string } | null)?.phone || "");
  }

  const fromOwn = normalizeWaPhoneDigits(raw);
  if (fromOwn) return fromOwn;

  // Sem chip próprio saudável: linha Whapi compartilhada.
  return await loadWhapiPhoneFromSettings(supabase);
}
