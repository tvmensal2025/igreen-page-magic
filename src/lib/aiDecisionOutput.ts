/**
 * Normalizador de `ai_decisions.ai_output`.
 *
 * A coluna `ai_output` é gravada de formas DIFERENTES dependendo de quem
 * escreve no backend:
 *   - `_shared/ai-cost-tracker.ts` grava STRING (texto puro).
 *   - `ai-sales-agent` / `vendedora/orchestrator` gravam OBJETO
 *     (`{ message }`, `{ reply }`, `{ caption }`, `{ text }`, etc.).
 *
 * Sem normalização, a UI mostra `[object Object]` (quando espera string) ou
 * vazio (quando espera `.message` mas veio string). Este helper unifica a
 * leitura para os painéis de Decisões e Cérebro IA — front-only, não altera
 * o que o backend grava.
 */

export type AiDecisionOutput = string | Record<string, unknown> | null | undefined;

/** Chaves de texto preferenciais, em ordem de prioridade. */
const TEXT_KEYS = ["message", "reply", "caption", "text", "reason"] as const;

/**
 * Extrai o texto legível de um `ai_output` que pode ser string OU objeto.
 * Retorna string vazia quando não há texto exibível.
 */
export function aiOutputText(output: AiDecisionOutput): string {
  if (output == null) return "";

  if (typeof output === "string") return output.trim();

  if (typeof output === "object") {
    for (const key of TEXT_KEYS) {
      const v = (output as Record<string, unknown>)[key];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    // Sem chave de texto conhecida: serializa de forma compacta para não
    // exibir "[object Object]" e ainda dar alguma pista do conteúdo.
    try {
      const json = JSON.stringify(output);
      return json && json !== "{}" ? json : "";
    } catch {
      return "";
    }
  }

  return String(output);
}

/**
 * Versão truncada para listas/cards. `max` default 200 chars.
 */
export function aiOutputPreview(output: AiDecisionOutput, max = 200): string {
  const text = aiOutputText(output);
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
