/**
 * ContentContract (frontend) — espelho do contrato Deno em
 * supabase/functions/_shared/content-contract.ts.
 *
 * Usado pelo painel Multicanal / sync. Regras Whapi idênticas ao Flow Builder.
 */

export const WHAPI_MAX_BUTTONS = 3;
export const WHAPI_MAX_BUTTON_TITLE = 25;

export type ContractButton = { id: string; title: string };

export interface ContentContract {
  message_text: string | null;
  buttons: ContractButton[];
  media_url?: string | null;
  media_type?: string | null;
  voice_audio_clip_id?: string | null;
  personalize_name?: boolean;
}

export function validateContractButtons(
  buttons: ContractButton[] | null | undefined,
): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!buttons || buttons.length === 0) return { ok: true, errors };
  if (buttons.length > WHAPI_MAX_BUTTONS) {
    errors.push(`Máximo ${WHAPI_MAX_BUTTONS} botões (iGreen Chat)`);
  }
  for (const b of buttons) {
    if (!String(b?.id || "").trim()) errors.push("Botão sem id");
    if (!String(b?.title || "").trim()) errors.push("Botão sem título");
    if (String(b?.title || "").length > WHAPI_MAX_BUTTON_TITLE) {
      errors.push(`Título > ${WHAPI_MAX_BUTTON_TITLE} chars: ${b.title}`);
    }
  }
  return { ok: errors.length === 0, errors };
}

export function parseContractButtons(raw: unknown): ContractButton[] | null {
  if (raw == null) return null;
  let arr: unknown = raw;
  if (typeof raw === "string") {
    try {
      arr = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(arr)) return null;
  const out: ContractButton[] = [];
  for (const item of arr) {
    const id = String((item as { id?: unknown })?.id ?? "").trim();
    const title = String((item as { title?: unknown })?.title ?? "").trim();
    if (!id || !title) return null;
    out.push({ id, title });
  }
  if (out.length === 0) return null;
  const v = validateContractButtons(out);
  return v.ok ? out : null;
}
