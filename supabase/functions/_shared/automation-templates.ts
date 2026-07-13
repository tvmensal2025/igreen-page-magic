/**
 * Templates de automação editáveis (consultant_message_templates).
 * Fallback hardcoded só se a linha não existir — admin deve editar na Central.
 */

// deno-lint-ignore no-explicit-any
type SB = any;

const cache = new Map<string, { text: string; expires: number }>();
const TTL_MS = 60_000;

export async function loadAutomationTemplate(
  supabase: SB,
  templateKey: string,
  fallback: string,
  vars: Record<string, string> = {},
  consultantId: string | null = null,
): Promise<string> {
  const cacheKey = `${consultantId ?? "global"}:${templateKey}`;
  const now = Date.now();
  const hit = cache.get(cacheKey);
  let raw = hit && hit.expires > now ? hit.text : null;

  if (raw == null) {
    // Preferência: template do consultor; senão global (consultant_id null)
    let text: string | null = null;
    if (consultantId) {
      const { data } = await supabase
        .from("consultant_message_templates")
        .select("text_content")
        .eq("template_key", templateKey)
        .eq("consultant_id", consultantId)
        .eq("is_active", true)
        .maybeSingle();
      text = (data as { text_content?: string } | null)?.text_content?.trim() || null;
    }
    if (!text) {
      const { data } = await supabase
        .from("consultant_message_templates")
        .select("text_content")
        .eq("template_key", templateKey)
        .is("consultant_id", null)
        .eq("is_active", true)
        .maybeSingle();
      text = (data as { text_content?: string } | null)?.text_content?.trim() || null;
    }
    raw = text || fallback;
    cache.set(cacheKey, { text: raw, expires: now + TTL_MS });
  }

  return applyTemplateVars(raw, vars);
}

export function applyTemplateVars(text: string, vars: Record<string, string>): string {
  let out = text;
  for (const [k, v] of Object.entries(vars)) {
    const re = new RegExp(`\\{\\{\\s*${k}\\s*\\}\\}`, "gi");
    out = out.replace(re, v ?? "");
  }
  // Limpa placeholders vazios residuais comuns
  out = out.replace(/\{\{\s*\w+\s*\}\}/g, "").replace(/  +/g, " ").trim();
  return out;
}
