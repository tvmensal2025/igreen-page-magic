/**
 * Resposta a dúvida a partir da base gravada (sem orquestrador GPT-5.5).
 * Ordem: lookupKnowledge (FAQ triggers + embeddings + keyword) → answerFaqWithAI.
 * FAQ hit em matchQA do caller continua grátis (0 LLM).
 */
export async function resolveKnowledgeAnswer(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  opts: {
    question: string;
    consultantId?: string | null;
    leadName?: string;
    currentStepLabel?: string;
  },
): Promise<{ text: string; source: "kb" | "ai" | null }> {
  const q = String(opts.question || "").trim();
  if (q.length < 3) return { text: "", source: null };

  try {
    const { lookupKnowledge } = await import("../knowledge-lookup.ts");
    const hit = await lookupKnowledge({
      supabase,
      question: q,
      consultantId: opts.consultantId || undefined,
    });
    if (hit.found && hit.confidence >= 0.55 && String(hit.text || "").trim().length >= 20) {
      const { formatFaqReply } = await import("../format-reply.ts");
      return {
        text: formatFaqReply(String(hit.text).trim().slice(0, 1200)),
        source: "kb",
      };
    }
  } catch (e) {
    console.warn("[resolveKnowledgeAnswer] lookup:", (e as Error).message);
  }

  try {
    const { answerFaqWithAI } = await import("../ai-faq-answerer.ts");
    const ai = await answerFaqWithAI({
      supabase,
      question: q,
      consultantId: opts.consultantId || undefined,
      leadName: opts.leadName,
      currentStepLabel: opts.currentStepLabel || "Cadastro Grupo A",
    });
    if (ai.text && ai.confidence >= 0.55 && String(ai.text).trim().length >= 16) {
      return { text: String(ai.text).trim().slice(0, 1200), source: "ai" };
    }
  } catch (e) {
    console.warn("[resolveKnowledgeAnswer] ai-faq:", (e as Error).message);
  }

  return { text: "", source: null };
}

/** Passos do cadastro A onde pergunta midflow deve rodar (inclui Sofia a1/a6…). */
export function isCadastroStepForMidflowQa(step: string | null | undefined): boolean {
  const s = String(step || "").trim();
  if (!s) return false;
  if (/^(ask_|aguardando_|editing_|confirm|qualificacao|valor_baixo)/.test(s)) return true;
  // Sofia Multicanal / flow builder
  if (/^a\d/.test(s)) return true;
  if (/^flow:/.test(s)) return true;
  if (/^(portal_|facial_|otp_|waiting_)/.test(s)) return true;
  return false;
}
