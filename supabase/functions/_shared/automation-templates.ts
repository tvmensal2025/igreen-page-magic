/**
 * Templates de automação editáveis (consultant_message_templates).
 * Fallback hardcoded só se a linha não existir — admin deve editar na Central.
 *
 * REGRA: o cache guarda só o texto do BANCO (com {{placeholders}}).
 * Nunca cachear o `fallback` do caller — ele pode já vir com nome
 * interpolado (`Oi João,…`), e o próximo lead do mesmo cron herdaria
 * o nome errado (incidente Marcos←João, 2026-07-21).
 */

// deno-lint-ignore no-explicit-any
type SB = any;

const cache = new Map<string, { text: string; expires: number }>();
const TTL_MS = 60_000;

async function fetchTemplateText(
  supabase: SB,
  templateKey: string,
  consultantId: string | null,
): Promise<string | null> {
  // Preferência: template do consultor; senão global (consultant_id null).
  // limit(1): evita maybeSingle() falhar quando há duplicatas (NULL no UNIQUE
  // do Postgres permite várias linhas globais com a mesma chave).
  if (consultantId) {
    const { data } = await supabase
      .from("consultant_message_templates")
      .select("text_content")
      .eq("template_key", templateKey)
      .eq("consultant_id", consultantId)
      .eq("is_active", true)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const text = (data as { text_content?: string } | null)?.text_content?.trim() || null;
    if (text) return text;
  }
  const { data } = await supabase
    .from("consultant_message_templates")
    .select("text_content")
    .eq("template_key", templateKey)
    .is("consultant_id", null)
    .eq("is_active", true)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as { text_content?: string } | null)?.text_content?.trim() || null;
}

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
    const text = await fetchTemplateText(supabase, templateKey, consultantId);
    if (text) {
      raw = text;
      cache.set(cacheKey, { text: raw, expires: now + TTL_MS });
    } else {
      // Fallback do caller: NÃO cachear (pode estar personalizado).
      raw = fallback;
    }
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
