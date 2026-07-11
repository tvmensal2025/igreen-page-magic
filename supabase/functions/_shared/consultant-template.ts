// Resolve a message template for a given consultant.
// Priority: consultant's custom (if is_active) → default (consultant_id IS NULL) → hardcoded fallback.
// Applies {{var}} substitution.

// deno-lint-ignore no-explicit-any
type SB = any;

export interface ResolvedTemplate {
  text: string;
  audio_url: string | null;
  typing_delay_ms: number;
  source: "consultant" | "default" | "fallback";
}

export async function resolveConsultantMessage(
  supabase: SB,
  consultantId: string | null,
  templateKey: string,
  vars: Record<string, string | number | null | undefined> = {},
  fallbackText = "",
): Promise<ResolvedTemplate> {
  let text = fallbackText;
  let audio_url: string | null = null;
  let typing_delay_ms = 1500;
  let source: ResolvedTemplate["source"] = "fallback";

  const { data: rows } = await supabase
    .from("consultant_message_templates")
    .select("consultant_id, text_content, audio_url, typing_delay_ms, is_active")
    .eq("template_key", templateKey)
    .in("consultant_id", consultantId ? [consultantId, null] : [null as unknown as string]);

  const list = (rows || []) as Array<{
    consultant_id: string | null;
    text_content: string;
    audio_url: string | null;
    typing_delay_ms: number;
    is_active: boolean;
  }>;

  const own = list.find((r) => r.consultant_id === consultantId && r.is_active && r.text_content);
  if (own) {
    text = own.text_content;
    audio_url = own.audio_url;
    typing_delay_ms = own.typing_delay_ms ?? 1500;
    source = "consultant";
  } else {
    const def = list.find((r) => r.consultant_id === null && r.is_active && r.text_content);
    if (def) {
      text = def.text_content;
      audio_url = def.audio_url;
      typing_delay_ms = def.typing_delay_ms ?? 1500;
      source = "default";
    }
  }

  text = applyVars(text, vars);
  return { text, audio_url, typing_delay_ms, source };
}

function applyVars(text: string, vars: Record<string, string | number | null | undefined>): string {
  return text.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, k: string) => {
    const v = vars[k];
    return v === null || v === undefined ? "" : String(v);
  });
}
