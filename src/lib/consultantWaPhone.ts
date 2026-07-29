/**
 * Espelho UI de `supabase/functions/_shared/consultant-wa-phone.ts`.
 * Telefone do chip vivo para preview de QR/banner — nunca notification_phone.
 *
 * Cascata:
 *   1) isWhapi → settings.whapi_connected_phone
 *   2) whatsapp_instances.connected_phone só se status saudável
 *   3) consultants.phone / fallbackPhone
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeBrazilPhone } from "@/lib/phone";

const HEALTHY = new Set(["connected", "online", "open"]);

/**
 * WhatsApp vivo? Superadmin Whapi NÃO depende de whatsapp_instances
 * (Evolution legada fica needs_reconnect com telefone null).
 */
export async function consultantHasConnectedWhatsAppForUi(
  supabase: SupabaseClient,
  consultantId: string,
): Promise<boolean> {
  if (!consultantId) return false;

  try {
    const { data: settingsRows } = await supabase
      .from("settings")
      .select("key, value")
      .in("key", ["superadmin_consultant_id", "whapi_connected_phone"]);
    const settings: Record<string, string> = {};
    for (const r of (settingsRows as Array<{ key?: string; value?: string }> | null) || []) {
      if (r?.key) settings[r.key] = String(r.value || "");
    }
    if (settings.superadmin_consultant_id === consultantId) return true;
  } catch {
    /* segue */
  }

  const { data: waRows } = await supabase
    .from("whatsapp_instances")
    .select("connected_phone, instance_name, status")
    .eq("consultant_id", consultantId)
    .limit(5);

  for (const r of (waRows as Array<{
    connected_phone?: string | null;
    instance_name?: string | null;
    status?: string | null;
  }> | null) || []) {
    const p = String(r?.connected_phone || "").replace(/\D/g, "");
    if (p.length < 10) continue;
    const st = String(r?.status || "").toLowerCase();
    if (HEALTHY.has(st)) return true;
  }

  return false;
}

export async function resolveConsultantWaPhoneForUi(
  supabase: SupabaseClient,
  consultantId: string,
  opts?: { isWhapi?: boolean; fallbackPhone?: string | null },
): Promise<string> {
  if (!consultantId) return normalizeBrazilPhone(opts?.fallbackPhone) || "";

  if (opts?.isWhapi) {
    const { data: rows } = await supabase
      .from("settings")
      .select("key, value")
      .eq("key", "whapi_connected_phone")
      .limit(1);
    const raw = String((rows as Array<{ value?: string }> | null)?.[0]?.value || "");
    const whapi = normalizeBrazilPhone(raw);
    if (whapi) return whapi;
  }

  const { data: insts } = await supabase
    .from("whatsapp_instances")
    .select("connected_phone, status, updated_at")
    .eq("consultant_id", consultantId)
    .not("connected_phone", "is", null)
    .order("updated_at", { ascending: false })
    .limit(5);

  for (const row of (insts as Array<{ connected_phone?: string; status?: string }> | null) || []) {
    const st = String(row.status || "").toLowerCase();
    if (st && HEALTHY.has(st) && row.connected_phone) {
      const dig = normalizeBrazilPhone(row.connected_phone);
      if (dig) return dig;
    }
  }

  const { data: cons } = await supabase
    .from("consultants")
    .select("phone")
    .eq("id", consultantId)
    .maybeSingle();

  return (
    normalizeBrazilPhone((cons as { phone?: string } | null)?.phone) ||
    normalizeBrazilPhone(opts?.fallbackPhone) ||
    ""
  );
}
