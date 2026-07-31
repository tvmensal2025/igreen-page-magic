import { supabase } from "@/integrations/supabase/client";
import type { Consultant } from "@/types/consultant";

function normalizeSlug(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Resolve consultor público pela licença da URL.
 * Todos com `license` preenchida são públicos (view consultants_public).
 *
 * Ordem:
 * 1) match exato (case-insensitive)
 * 2) prefixo único (`tvmensal01` → `tvmensal01-953f` se só existir um)
 */
export async function resolvePublicConsultant(
  rawLicense: string,
): Promise<{ consultant: Consultant; canonicalLicense: string } | null> {
  const license = normalizeSlug(rawLicense);
  if (!license) return null;

  // RPC pública individual: resolve exato ou prefixo único no servidor,
  // sem permitir varredura da base de consultores.
  const { data, error } = await supabase.rpc(
    "get_public_consultant" as any,
    { _license: license },
  );

  if (error) throw error;

  const rows = (Array.isArray(data) ? data : data ? [data] : []) as unknown as Consultant[];
  const row = rows[0];
  if (!row) return null;

  return { consultant: row, canonicalLicense: row.license };
}
