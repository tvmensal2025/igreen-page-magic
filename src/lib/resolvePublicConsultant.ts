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

  const { data: exact, error: exactErr } = await supabase
    .from("consultants_public" as any)
    .select("*")
    .ilike("license", license)
    .maybeSingle();

  if (exactErr) throw exactErr;
  if (exact) {
    const row = exact as unknown as Consultant;
    return { consultant: row, canonicalLicense: row.license };
  }

  // Prefixo único: /joao → /joao-ab12cd quando há só um match.
  const { data: prefixed, error: prefixErr } = await supabase
    .from("consultants_public" as any)
    .select("*")
    .ilike("license", `${license}-%`);

  if (prefixErr) throw prefixErr;
  if (Array.isArray(prefixed) && prefixed.length === 1) {
    const row = prefixed[0] as unknown as Consultant;
    return { consultant: row, canonicalLicense: row.license };
  }

  return null;
}
