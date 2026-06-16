// Atualiza customers.conversation_summary com Gemini Flash a cada ~6 turnos.
// Best-effort: nunca lança. Roda fire-and-forget após orquestrador.
import { aiChatCascade } from "./ai-gateway.ts";
import { trackAIUsage } from "./ai-cost-tracker.ts";

// PREMIUM: resumo persistente usa GPT-5-mini (memória da conversa é crítica)
const SUMMARY_MODEL = "openai/gpt-5-mini";
const SUMMARY_EVERY = 6; // turnos do lead

const SYSTEM = `Você resume conversas de WhatsApp entre um lead e o bot da iGreen Energy.
Produza um resumo enxuto (máx 600 chars, PT-BR) com:
- Quem é o lead (nome, estado, valor de conta se já souber)
- Estágio/intenção atual
- Objeções ou dúvidas relevantes já levantadas
- Próximo passo combinado
Sem markdown, sem emojis, frases curtas separadas por ponto.`;

export interface SummaryInput {
  supabase: any;
  customerId: string;
  consultantId?: string | null;
  history: string;          // já formatado "Lead: ... / Bot: ..."
  customer: any;            // pra contexto (nome, valor, estado)
  inboundTurnCount?: number; // se passado, só roda quando múltiplo de SUMMARY_EVERY
  previousSummary?: string | null;
}

export async function maybeUpdateSummary(input: SummaryInput): Promise<void> {
  try {
    // Dispara quando o contador é múltiplo de SUMMARY_EVERY OU quando já passou
    // do limiar e ainda não existe resumo (cobre casos em que turnos foram
    // respondidos por outro caminho e o contador "pulou" o múltiplo exato).
    if (typeof input.inboundTurnCount === "number" && input.inboundTurnCount > 0) {
      const isMultiple = input.inboundTurnCount % SUMMARY_EVERY === 0;
      const firstAfterThreshold = !input.previousSummary && input.inboundTurnCount >= SUMMARY_EVERY;
      if (!isMultiple && !firstAfterThreshold) return;
    }
    if (!input.history || input.history.length < 200) return;

    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 12_000);
    const r = await aiChatCascade({
      model: SUMMARY_MODEL,
      temperature: 0.2,
      maxTokens: 400,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content:
`CONTEXTO LEAD:
- Nome: ${input.customer?.name || "(?)"}
- Estado: ${input.customer?.address_state || "(?)"}
- Valor conta: ${input.customer?.electricity_bill_value || "(?)"}

RESUMO ANTERIOR:
${input.previousSummary || "(nenhum)"}

HISTÓRICO RECENTE:
${input.history.slice(-3500)}

Atualize o resumo.`
        },
      ],
      signal: ctrl.signal,
    });
    clearTimeout(to);
    void trackAIUsage({
      supabase: input.supabase, consultantId: input.consultantId,
      model: r.modelUsed, phase: "other", usage: r.usage,
    });
    const text = (r.text || "").trim().slice(0, 1200);
    if (!text) return;
    await input.supabase.from("customers").update({
      conversation_summary: text,
      summary_updated_at: new Date().toISOString(),
    }).eq("id", input.customerId);
  } catch (e) {
    console.warn("[ai-summary] failed:", (e as Error).message);
  }
}
