/**
 * Helpers puros compartilhados Whapi ↔ Evolution (bot-flow).
 * Extraídos sem mudança de comportamento — anti-duplicação.
 */

/** Trigrama similarity para anti-loop (0..1). */
export function trigramSim(a: string, b: string): number {
  const norm = (s: string) =>
    (s || "").toLowerCase().replace(/[^a-zà-ú0-9 ]/gi, "").replace(/\s+/g, " ").trim();
  const A = norm(a), B = norm(b);
  if (!A || !B) return 0;
  if (A === B) return 1;
  const trig = (s: string) => {
    const set = new Set<string>();
    const p = `  ${s}  `;
    for (let i = 0; i < p.length - 2; i++) set.add(p.slice(i, i + 3));
    return set;
  };
  const ta = trig(A), tb = trig(B);
  let inter = 0;
  ta.forEach((t) => {
    if (tb.has(t)) inter++;
  });
  return inter / Math.max(ta.size, tb.size);
}

/**
 * Destino explícito pós-SIM em capture_conta.
 * PRIORIDADE: success_goto_step_id → goto_step_id (mode === "goto").
 */
export function resolvePostBillNextStepId(
  fallback:
    | { mode?: string | null; goto_step_id?: string | null; success_goto_step_id?: string | null }
    | null
    | undefined,
): string | null {
  const fb = fallback || {};
  if (fb.success_goto_step_id) return String(fb.success_goto_step_id);
  if (fb.mode === "goto" && fb.goto_step_id) return String(fb.goto_step_id);
  return null;
}

/**
 * Passo é "esperar resposta" se tem botões, transições com gatilho
 * (intent/phrase) ou fallback repeat/ai.
 */
export function stepHasInteractiveWait(row: any): boolean {
  const captures = Array.isArray(row?.captures) ? row.captures : [];
  const hasButtons = captures.some((c: any) =>
    c?.enabled !== false && c?.field === "_buttons" && Array.isArray(c?.value) && c.value.length > 0
  );
  if (hasButtons) return true;

  const transitions = Array.isArray(row?.transitions) ? row.transitions : [];
  const hasReplyTransition = transitions.some((t: any) => {
    const intent = String(t?.trigger_intent || "").trim();
    const phrases = Array.isArray(t?.trigger_phrases) ? t.trigger_phrases.filter(Boolean) : [];
    return !!t?.goto_special || (!!t?.goto_step_id && (intent !== "default" || phrases.length > 0));
  });
  if (hasReplyTransition) return true;

  const fallbackMode = String(row?.fallback?.mode || "").trim();
  return fallbackMode === "repeat" || fallbackMode === "ai" || fallbackMode === "ai_answer";
}
