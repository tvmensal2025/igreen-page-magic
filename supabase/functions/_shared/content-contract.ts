/**
 * ContentContract — contrato de CONTEÚDO compartilhado entre o Flow Builder
 * (Grupo A / bot_flow_steps) e o motor de cadência (Grupos B/C /
 * cadence_stage_config).
 *
 * Escopo (Fase 0 do plano de convergência):
 *   - Somente conteúdo: texto, botões, mídia, clip de voz.
 *   - NUNCA executor: transitions/fallback/position (A) e
 *     delay_hours/stage/claims (B/C) ficam fora deste contrato.
 *
 * Regras Whapi (mesmas do Flow Builder / painel Multicanal):
 *   - máx. 3 botões; título ≤ 25 chars; id e título obrigatórios.
 *
 * Fail-safe: qualquer botão inválido vindo do banco → descarta o conjunto
 * inteiro e o caller usa o fallback hardcoded (comportamento atual do tick).
 */

export const WHAPI_MAX_BUTTONS = 3;
export const WHAPI_MAX_BUTTON_TITLE = 25;

export type ContractButton = { id: string; title: string };

export interface ContentContract {
  message_text: string | null;
  buttons: ContractButton[];
  media_url: string | null;
  media_type: string | null;
  voice_audio_clip_id: string | null;
  personalize_name: boolean;
}

export function validateContractButtons(
  buttons: ContractButton[] | null | undefined,
): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!buttons || buttons.length === 0) return { ok: true, errors };
  if (buttons.length > WHAPI_MAX_BUTTONS) {
    errors.push(`max_buttons:${buttons.length}`);
  }
  for (const b of buttons) {
    if (!String(b?.id || "").trim()) errors.push("button_missing_id");
    if (!String(b?.title || "").trim()) errors.push(`button_missing_title:${b?.id || "?"}`);
    if (String(b?.title || "").length > WHAPI_MAX_BUTTON_TITLE) {
      errors.push(`button_title_too_long:${b?.id || "?"}`);
    }
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Converte jsonb do banco (`cadence_stage_config.buttons` ou
 * `bot_flow_steps.captures._buttons.value`) em botões validados.
 * Retorna null quando o valor é ausente/inválido — caller decide o fallback.
 */
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
  if (!v.ok) {
    console.warn(`[content-contract] botões inválidos descartados: ${v.errors.join(",")}`);
    return null;
  }
  return out;
}

/** Extrai botões do shape `captures` do Flow Builder (campo `_buttons`). */
export function buttonsFromFlowCaptures(captures: unknown): ContractButton[] | null {
  if (!Array.isArray(captures)) return null;
  const cap = captures.find(
    (c) =>
      c &&
      (c as { field?: string }).field === "_buttons" &&
      (c as { enabled?: boolean }).enabled !== false,
  ) as { value?: unknown } | undefined;
  if (!cap) return null;
  return parseContractButtons(cap.value);
}
