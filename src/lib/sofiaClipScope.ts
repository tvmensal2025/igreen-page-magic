import { supabase } from "@/integrations/supabase/client";

/**
 * Escopo de áudios Sofia visíveis para um consultor:
 * os próprios + a biblioteca compartilhada do super admin.
 *
 * Regra de produto: consultor com saldo pode ligar/mandar SMS mesmo sem ter
 * gerado áudio próprio no Estúdio — ele usa a biblioteca oficial.
 */
let cachedSuperId: string | null | undefined;

export async function getSuperAdminConsultantId(): Promise<string | null> {
  if (cachedSuperId !== undefined) return cachedSuperId ?? null;
  try {
    const { data } = await supabase
      .from("settings")
      .select("value")
      .eq("key", "superadmin_consultant_id")
      .maybeSingle();
    cachedSuperId = ((data as { value?: string } | null)?.value || "").trim() || null;
  } catch {
    cachedSuperId = null;
  }
  return cachedSuperId ?? null;
}

/** IDs de consultor a usar em `.in("consultant_id", ids)` para listar clipes. */
export async function sofiaClipOwnerIds(consultantId: string): Promise<string[]> {
  const superId = await getSuperAdminConsultantId();
  return superId && superId !== consultantId ? [consultantId, superId] : [consultantId];
}
