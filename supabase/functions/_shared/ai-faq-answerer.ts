// AI FAQ Answerer — fallback Lovable AI quando lead pergunta algo
// que NÃO existe em bot_flow_qa. Usa ai_knowledge_sections como RAG.
//
// Filosofia:
// - Resposta curta (máx 3 frases)
// - Tom conversacional brasileiro, sem emoji exagerado
// - Se não souber responder com confiança → retorna null (bot mantém comportamento default: repete passo ou faz handoff)
// - NUNCA inventa números, prazos ou taxas que não estejam no conhecimento.
//
// Task 30 (whatsapp-flow-reliability-fix): antes de chamar o LLM, prefere
// `bot_flow_qa.text_response` quando há match exato (case-insensitive,
// trim, colapso de whitespace) entre a pergunta do lead e qualquer
// `phrase` em `bot_flow_qa_triggers` para o flow do consultor. Mantém
// o LLM como fallback quando não há QA cadastrada ou quando a pergunta
// só "encosta" em alguma trigger sem ser exata.

import { aiChatCascade } from "./ai-gateway.ts";
import { trackAIUsage } from "./ai-cost-tracker.ts";
import { formatFaqReply, withSoftFlowClose } from "./format-reply.ts";
import { resolveFlowId } from "./resolve-flow.ts";
import {
  resolveConsultantPresentationLabel,
  resolveAssistantDisplayName,
} from "./consultant-public-label.ts";

export interface FaqAnswer {
  text: string;
  confidence: number;          // 0..1
  shouldHandoff: boolean;      // true → pergunta exige humano
  source: "ai" | "skipped" | "exact_qa";
}

interface KnowledgeSection {
  title: string;
  content: string;
}

/**
 * Persona do FAQ — SEMPRE dinâmica.
 *
 * Bug 2026-07: o prompt fixava "Você é o Rafael", então a IA de QUALQUER
 * consultor (Abel, Janete, Silvia…) se apresentava como Rafael ao lead.
 * Agora a identidade vem do próprio consultor: nome da IA (`assistant_name`)
 * + label público seguro (`resolveConsultantPresentationLabel`).
 */
export function buildFaqSystemPrompt(opts: {
  assistantName?: string | null;
  consultantLabel?: string | null;
}): string {
  const assistant = resolveAssistantDisplayName(opts.assistantName);
  const consultant = String(opts.consultantLabel || "").trim();
  const identidade = consultant
    ? `Você é ${assistant}, assistente de ${consultant} na iGreen Energy`
    : `Você é ${assistant}, assistente da iGreen Energy`;

  return `${identidade}, respondendo dúvidas de leads no WhatsApp. Sua missão é esclarecer a dúvida com precisão e elegância — sem pressão comercial.

REGRAS RÍGIDAS:
0. IDENTIDADE: você se chama *${assistant}*${consultant ? ` e atende em nome de *${consultant}*` : ""}. NUNCA use outro nome próprio para se apresentar, nem invente o nome do consultor.
1. Responda APENAS com base no CONHECIMENTO fornecido + no contexto da conversa. NUNCA invente preços, prazos, taxas, distribuidoras, números ou benefícios que não estejam ali.
2. Resposta clara e completa: 2 a 4 frases curtas. Separe ideias com quebra de linha (use \\n\\n entre parágrafos). No máximo 1 emoji simples — preferível nenhum.
3. Formatação WhatsApp: use *negrito* só em 1–2 termos importantes (ex.: *iGreen*, *sem fidelidade*). NÃO use markdown de título (#), listas longas nem links desnecessários.
4. Tom brasileiro, direto e profissional. Trate o lead pelo primeiro nome quando souber. Sem gíria forçada, sem "bora", sem urgência artificial.
5. Se a pergunta exigir cálculo individual da conta dele, negociação, análise de documento específico, cancelamento, reclamação séria, raiva, desistência ou pedido explícito de humano → shouldHandoff=true (e ainda assim escreva uma resposta curta acolhedora).
6. NÃO termine pedindo cadastro, ativação ou "Posso seguir com seu cadastro?". O sistema já reapresenta as opções do passo. Se precisar fechar, use no máximo uma ponte neutra (ex.: "Qualquer outra dúvida, é só perguntar.").
7. confidence: 0.9+ se a resposta está claramente coberta; 0.6-0.8 se parcial; <0.6 se você não sabe — nesse caso shouldHandoff=true.
8. NUNCA mencione áudio, vídeo ou que vai "mandar de novo" o material. Você está respondendo só com texto.

Retorne JSON: {"text": "...", "confidence": 0.0-1.0, "shouldHandoff": true|false}`;
}

/**
 * Carrega identidade do consultor (IA + label público). Fail-open: erro de
 * banco vira persona genérica, nunca a persona de outro consultor.
 */
export async function resolveFaqPersona(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  consultantId?: string | null,
): Promise<{ assistantName: string; consultantLabel: string }> {
  if (!consultantId) {
    return { assistantName: resolveAssistantDisplayName(null), consultantLabel: "" };
  }
  try {
    const { data } = await supabase
      .from("consultants")
      .select("name, display_name, assistant_name")
      .eq("id", consultantId)
      .maybeSingle();
    return {
      assistantName: resolveAssistantDisplayName(data?.assistant_name),
      consultantLabel: resolveConsultantPresentationLabel(data?.name, data?.display_name),
    };
  } catch (e) {
    console.warn("[ai-faq-answerer] persona lookup failed:", (e as Error).message);
    return { assistantName: resolveAssistantDisplayName(null), consultantLabel: "" };
  }
}



/**
 * Normaliza texto para match exato de FAQ:
 *   - lowercase
 *   - remove diacríticos (NFD + remove combining marks)
 *   - trim + colapsa whitespace
 *   - remove pontuação final comum (?, !, ., ,)
 */
export function normalizeFaqQuestion(text: string): string {
  if (!text) return "";
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[?!.,;:]+$/g, "")
    .trim();
}

/**
 * Tenta resolver a pergunta direto em `bot_flow_qa.text_response` quando
 * existe match exato (após `normalizeFaqQuestion`) com qualquer phrase
 * em `bot_flow_qa_triggers` para o flow ativo do consultor.
 *
 * Retorna null se não houver match — caller deve seguir com LLM.
 *
 * Implementação cuidadosa:
 *   - Filtra QA por `consultant_id` via JOIN com `bot_flows.is_active=true`.
 *   - Match por igualdade direta entre triggers normalizados e a pergunta
 *     normalizada (sem fuzzy/ILIKE — Task 30 pede EXATO).
 *   - Se múltiplas QA cobrem o mesmo trigger, escolhe a de menor `position`
 *     (mais "alta" no fluxo) e ignora QA sem `text_response` (que provavelmente
 *     dependem só de mídia).
 */
async function findExactFaqMatch(opts: {
  supabase: any;
  question: string;
  consultantId?: string;
}): Promise<{ text: string } | null> {
  const norm = normalizeFaqQuestion(opts.question);
  if (!norm) return null;

  // Multicanal oficial: flow resolvido (público A).
  let flowIds: string[] = [];
  if (opts.consultantId) {
    const resolved = await resolveFlowId(opts.supabase, opts.consultantId, "A");
    if (resolved?.id) flowIds = [resolved.id];
  }
  if (flowIds.length === 0) return null;

  // Carrega triggers + QA de uma vez. RLS dos JOINs é coberto pelo filtro
  // explícito por flow_id nos campos selecionados.
  const { data: triggers } = await opts.supabase
    .from("bot_flow_qa_triggers")
    .select("phrase, qa_id, bot_flow_qa!inner(id, flow_id, position, text_response)")
    .in("bot_flow_qa.flow_id", flowIds);

  type Row = {
    phrase: string;
    qa_id: string;
    bot_flow_qa: { id: string; flow_id: string; position: number; text_response: string | null };
  };
  const rows = ((triggers as unknown) as Row[]) || [];
  const candidates: Array<{ position: number; text: string }> = [];
  for (const row of rows) {
    const text = (row.bot_flow_qa?.text_response || "").trim();
    if (!text) continue;
    if (normalizeFaqQuestion(row.phrase) === norm) {
      candidates.push({ position: row.bot_flow_qa.position, text });
    }
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.position - b.position);
  return { text: candidates[0].text };
}


export async function answerFaqWithAI(opts: {
  supabase: any;
  question: string;
  leadName?: string;
  currentStepLabel?: string;
  consultantId?: string;
  recentHistory?: string;
  model?: string;
  signal?: AbortSignal;
}): Promise<FaqAnswer> {

  const q = (opts.question || "").trim();
  if (!q || q.length < 3) {
    return { text: "", confidence: 0, shouldHandoff: false, source: "skipped" };
  }

  // Task 30: shortcut exato em bot_flow_qa antes de pagar LLM.
  // Garante consistência (resposta cadastrada pelo consultor sempre vence
  // o que a IA inventaria) e poupa quota Gemini para perguntas que
  // realmente precisam de raciocínio.
  try {
    const exact = await findExactFaqMatch({
      supabase: opts.supabase,
      question: q,
      consultantId: opts.consultantId,
    });
    if (exact) {
      return {
        text: formatFaqReply(exact.text.slice(0, 1200)),
        confidence: 1,
        shouldHandoff: false,
        source: "exact_qa",
      };
    }
  } catch (e) {
    console.warn("[ai-faq-answerer] exact-match lookup failed (fallback to LLM):", (e as Error).message);
  }

  // Busca knowledge base: seções do consultor + globais
  // Carrega título+ID de todas as seções ativas (até 60). Depois Flash
  // rerank seleciona top-5 mais relevantes para a pergunta — só essas
  // entram no prompt do Pro. Resolve "IA não vai em conhecimento" sem
  // precisar de embeddings.
  const { data: sectionsIdx } = await opts.supabase
    .from("ai_knowledge_sections")
    .select("id, title, content")
    .eq("is_active", true)
    .or(`consultant_id.is.null${opts.consultantId ? `,consultant_id.eq.${opts.consultantId}` : ""}`)
    .order("position", { ascending: true })
    .limit(60);

  const allSections = ((sectionsIdx as Array<{ id: string; title: string; content: string }>) || []);

  // Rerank com Flash quando temos > 5 candidatos. Caso contrário usa todas.
  let chosen = allSections;
  if (allSections.length > 5) {
    try {
      const titlesList = allSections.map((s, i) => `${i}: ${s.title}`).join("\n");
      const ctrlR = new AbortController();
      const toR = setTimeout(() => ctrlR.abort(), 6000);
      const rr = await aiChatCascade({
        model: "google/gemini-3-flash-preview",
        temperature: 0.0,
        maxTokens: 120,
        jsonSchema: {
          name: "rerank",
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              indices: { type: "array", items: { type: "integer" }, maxItems: 5 },
            },
            required: ["indices"],
          },
        },
        messages: [
          { role: "system", content: "Você é um reranker. Recebe uma PERGUNTA e uma lista de TÍTULOS numerados. Retorne JSON {\"indices\":[...]} com até 5 índices dos títulos mais relevantes para responder a pergunta, em ordem de relevância." },
          { role: "user", content: `PERGUNTA: "${q.slice(0, 400)}"\n\nTÍTULOS:\n${titlesList}` },
        ],
        signal: ctrlR.signal,
      });
      clearTimeout(toR);
      const idxs: number[] = Array.isArray(rr.json?.indices) ? rr.json.indices.slice(0, 5) : [];
      const picked = idxs.map((i) => allSections[i]).filter(Boolean);
      if (picked.length > 0) chosen = picked;
      void trackAIUsage({
        supabase: opts.supabase,
        consultantId: opts.consultantId,
        model: rr.modelUsed,
        phase: "triage",
        usage: rr.usage,
      });
    } catch (e) {
      console.warn("[ai-faq-answerer] rerank failed, using all sections:", (e as Error).message);
    }
  }

  const knowledge = chosen
    .map((s) => `### ${s.title}\n${(s.content || "").slice(0, 1200)}`)
    .join("\n\n")
    .slice(0, 8000);

  if (!knowledge) {
    // Sem base de conhecimento: melhor mandar pra humano
    return { text: "", confidence: 0, shouldHandoff: true, source: "skipped" };
  }

  const userPrompt = `CONHECIMENTO IGREEN:
${knowledge}

CONTEXTO:
- Nome do lead: ${opts.leadName || "(desconhecido)"}
- Passo atual do funil: ${opts.currentStepLabel || "(início)"}
${opts.recentHistory ? `\nÚLTIMAS MENSAGENS DA CONVERSA:\n${opts.recentHistory.slice(0, 2000)}\n` : ""}
PERGUNTA DO LEAD: "${q.slice(0, 600)}"`;

  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 15_000);
    const res = await aiChatCascade({
      model: opts.model || "google/gemini-3.1-pro-preview",
      temperature: 0.35,
      maxTokens: 1500,
      jsonSchema: {
        name: "faq_answer",
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            text: { type: "string" },
            confidence: { type: "number" },
            shouldHandoff: { type: "boolean" },
          },
          required: ["text", "confidence", "shouldHandoff"],
        },
      },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      signal: opts.signal || ctrl.signal,
    });
    clearTimeout(to);

    void trackAIUsage({
      supabase: opts.supabase,
      consultantId: opts.consultantId,
      model: res.modelUsed,
      phase: "faq",
      usage: res.usage,
    });

    const parsed = res.json;
    if (!parsed || typeof parsed.text !== "string") {
      return { text: "", confidence: 0, shouldHandoff: true, source: "skipped" };
    }

    const answer = String(parsed.text).trim().slice(0, 1200);
    const handoff = !!parsed.shouldHandoff;
    // Fechamento neutro (sem pressão de cadastro). Em handoff, não anexa
    // ponte — a mensagem de transferência cuida do próximo passo.
    const prepared = handoff ? answer : withSoftFlowClose(answer);

    return {
      text: formatFaqReply(prepared),
      confidence: Number(parsed.confidence) || 0,
      shouldHandoff: handoff,
      source: "ai",
    };
  } catch (e) {
    console.warn("[ai-faq-answerer] failed:", (e as Error).message);
    return { text: "", confidence: 0, shouldHandoff: false, source: "skipped" };
  }
}
