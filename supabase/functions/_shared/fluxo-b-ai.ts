// Fluxo B — núcleo da IA livre. Chamado pelo whapi/evolution webhook
// quando customer.flow_variant === "B" (texto inbound, não-mídia).
//
// Responsabilidades:
// 1. Carrega contexto (consultor, lead, histórico, super prompt).
// 2. Roda cascata Gemini 3 Flash → GPT-5.5 com tool calling.
// 3. Aplica tool calls (registrar_nome, pedir_foto_conta, etc).
// 4. Retorna o texto que o webhook deve enviar ao lead.
// 5. Em background, atualiza customers.conversation_summary (memória persistente).
//
// MEMÓRIA: o bot tem memória permanente via customers.conversation_summary +
// últimos 40 turnos brutos. Essa memória NUNCA é apagada automaticamente —
// só pelos resets administrativos manuais (botão admin / migrations de manutenção).

import { aiChatCascade, aiChat, type AIChatMessage } from "./ai-gateway.ts";
import { buildFluxoBSystemPrompt, FLUXO_B_TOOLS, type FluxoBContext } from "./fluxo-b-prompt.ts";
import { maybeUpdateSummary } from "./ai-summary.ts";
import { runVendedoraV1 } from "./vendedora-v1/index.ts";
import { pickVariant } from "./vendedora-v1/variant-picker.ts";

// SupabaseClient genérico para evitar conflitos de tipos entre callers
// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

export interface FluxoBRunInput {
  supabase: SupabaseClient;
  customerId: string;
  inboundText: string;
  // se já temos os objetos carregados, pular re-fetch
  customer?: any;
  consultant?: any;
}

export interface FluxoBRunResult {
  reply: string;                              // texto a enviar ao lead
  toolsApplied: string[];                     // nomes das tools que rodaram
  conversationStepUpdate: string | null;      // novo conversation_step (se mudou)
  shouldHandoff: boolean;                     // bot_paused = true?
  modelUsed: string;
  latencyMs: number;
  customerUpdates: Record<string, any>;       // campos persistidos no customer (útil pro tester dryRun)
  variantId?: string | null;                  // qual variante foi sorteada/usada
  debug?: any;                                // debug interno (somente v1, útil pro tester)
}

const FLASH_MODEL = "google/gemini-3-flash-preview";
const PRO_MODEL = "openai/gpt-5.5";

export async function runFluxoBAI(input: FluxoBRunInput): Promise<FluxoBRunResult> {
  const t0 = Date.now();
  const { supabase, customerId, inboundText } = input;

  // 1) Carrega customer. Sempre relê do banco quando temos customerId, mesmo
  // se o webhook passou um objeto cacheado — precisamos do conversation_summary
  // e dados de cadastro mais recentes para a memória funcionar.
  let customer = input.customer;
  if (customerId && customerId !== "00000000-0000-0000-0000-000000000000") {
    const { data } = await supabase.from("customers").select("*").eq("id", customerId).maybeSingle();
    if (data) customer = data;
  }
  if (!customer) throw new Error(`[fluxo-b-ai] customer ${customerId} not found`);

  // ── A/B routing: vendedora_v1 vs legacy ───────────────────────────────
  // Se variante ainda não foi atribuída, sorteia 50/50 e persiste.
  let variant: string = String(customer.fluxo_b_variant || "").toLowerCase();
  if (variant !== "v1" && variant !== "legacy") {
    variant = Math.random() < 0.5 ? "v1" : "legacy";
    try {
      await supabase.from("customers").update({ fluxo_b_variant: variant }).eq("id", customerId);
      customer.fluxo_b_variant = variant;
    } catch (_) { /* tolera ausência da coluna em ambientes antigos */ }
  }

  if (variant === "v1") {
    try {
      const v1 = await runVendedoraV1({ supabase, customerId, inboundText, customer, consultant: input.consultant });
      return {
        reply: v1.reply,
        toolsApplied: v1.toolsApplied,
        conversationStepUpdate: v1.conversationStepUpdate,
        shouldHandoff: v1.shouldHandoff,
        modelUsed: v1.modelUsed,
        latencyMs: v1.latencyMs,
        customerUpdates: v1.customerUpdates,
      };
    } catch (e) {
      console.error(`[fluxo-b-ai] vendedora_v1 falhou, caindo pra legacy:`, (e as Error).message);
      // fall-through pro legacy
    }
  }

  let consultant = input.consultant;
  if (!consultant && customer.consultant_id) {
    const { data } = await supabase
      .from("consultants")
      .select("id, name, ai_persona_fluxo_b, ai_persona_fluxo_b_temperature, ai_persona_fluxo_b_cascade_enabled")
      .eq("id", customer.consultant_id)
      .maybeSingle();
    consultant = data;
  }
  if (!consultant) throw new Error(`[fluxo-b-ai] consultant for customer ${customerId} not found`);

  // 2) Histórico recente: últimos 40 turnos (cobre conversas longas; resumo
  // persistente cuida do que vem antes disso).
  const { data: histRows } = await supabase
    .from("conversations")
    .select("message_direction, message_text, message_type, created_at")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false })
    .limit(40);
  const history: AIChatMessage[] = ((histRows || []) as any[])
    .slice()
    .reverse()
    .map((row): AIChatMessage => ({
      role: row.message_direction === "outbound" ? "assistant" : "user",
      content: row.message_text || (row.message_type === "image" ? "[imagem]" : row.message_type === "audio" ? "[áudio]" : "[mídia]"),
    }))
    .filter((m) => m.content && String(m.content).trim().length > 0);

  // 3) Monta system prompt + bloco de dados estruturados já conhecidos.
  // 3a) FAQ / base de conhecimento: seções globais + as do consultor (até ~6000 chars).
  let knowledgeBase: string | null = null;
  try {
    const { data: kbRows } = await supabase
      .from("ai_knowledge_sections")
      .select("title, content, is_critical, position, consultant_id")
      .eq("is_active", true)
      .or(`consultant_id.is.null,consultant_id.eq.${customer.consultant_id}`)
      .order("is_critical", { ascending: false })
      .order("position", { ascending: true })
      .limit(40);
    if (kbRows && kbRows.length > 0) {
      const BUDGET = 6000;
      const parts: string[] = [];
      let used = 0;
      for (const row of kbRows as any[]) {
        const block = `## ${row.title}\n${(row.content || "").trim()}`;
        if (used + block.length > BUDGET) break;
        parts.push(block);
        used += block.length + 2;
      }
      knowledgeBase = parts.join("\n\n");
    }
  } catch (e) {
    console.warn("[fluxo-b-ai] knowledge fetch falhou:", (e as Error).message);
  }

  const ctx: FluxoBContext = {
    representante: consultant.name || "Rafael",
    nomeCliente: customer.name || null,
    valorConta: typeof customer.electricity_bill_value === "number" ? customer.electricity_bill_value : null,
    conversationSummary: customer.conversation_summary || null,
    customerId,
    knowledgeBase,
  };
  const baseSystemPrompt = buildFluxoBSystemPrompt(consultant.ai_persona_fluxo_b, ctx);

  const knownFacts: string[] = [];
  if (customer.address_city) knownFacts.push(`Cidade: ${customer.address_city}`);
  if (customer.address_state) knownFacts.push(`Estado: ${customer.address_state}`);
  if (customer.distribuidora) knownFacts.push(`Distribuidora: ${customer.distribuidora}`);
  if (customer.sales_phase) knownFacts.push(`Fase de venda: ${customer.sales_phase}`);
  if (customer.conversation_step) knownFacts.push(`Passo atual: ${customer.conversation_step}`);
  const factsBlock = knownFacts.length
    ? `\n\n# Dados já confirmados deste lead (NÃO pergunte de novo)\n- ${knownFacts.join("\n- ")}`
    : "";

  const systemPrompt = baseSystemPrompt + factsBlock;

  const messages: AIChatMessage[] = [
    { role: "system", content: systemPrompt },
    ...history,
    { role: "user", content: inboundText },
  ];

  // 4) Chama IA — Flash primeiro, escala pra Pro se cascade habilitado e Flash recusar/falhar
  const temperature = typeof consultant.ai_persona_fluxo_b_temperature === "number"
    ? consultant.ai_persona_fluxo_b_temperature
    : 0.7;
  const cascadeEnabled = consultant.ai_persona_fluxo_b_cascade_enabled !== false;

  let chosen = await callWithTools(FLASH_MODEL, messages, temperature);

  // Escalada: se Flash respondeu vazio E cascade ligado, tenta GPT-5.5
  if (cascadeEnabled && (!chosen.text || chosen.text.trim().length < 3) && chosen.toolCalls.length === 0) {
    console.log(`[fluxo-b-ai] flash retornou vazio, escalando pra ${PRO_MODEL}`);
    try {
      chosen = await callWithTools(PRO_MODEL, messages, temperature);
    } catch (e) {
      console.warn(`[fluxo-b-ai] cascade pro falhou: ${(e as Error).message}`);
    }
  }

  // 5) Aplica tool calls
  const toolsApplied: string[] = [];
  let conversationStepUpdate: string | null = null;
  let shouldHandoff = false;
  const updates: Record<string, any> = {};

  for (const tc of chosen.toolCalls) {
    toolsApplied.push(tc.name);
    try {
      if (tc.name === "registrar_nome" && tc.arguments?.nome) {
        const nome = String(tc.arguments.nome).trim().slice(0, 80);
        if (nome) {
          updates.name = nome;
          updates.name_source = "ai_chat";
        }
      } else if (tc.name === "registrar_valor_conta" && typeof tc.arguments?.valor === "number") {
        const v = Number(tc.arguments.valor);
        if (v > 0 && v < 100000) updates.electricity_bill_value = v;
      } else if (tc.name === "pedir_foto_conta") {
        conversationStepUpdate = "aguardando_conta";
      } else if (tc.name === "pedir_documento") {
        conversationStepUpdate = "aguardando_documento";
      } else if (tc.name === "finalizar_cadastro") {
        conversationStepUpdate = "cadastro_finalizando";
      } else if (tc.name === "escalar_humano") {
        shouldHandoff = true;
        updates.bot_paused = true;
        updates.bot_paused_reason = String(tc.arguments?.motivo || "ai_escalou").slice(0, 200);
        updates.bot_paused_at = new Date().toISOString();
      }
    } catch (e) {
      console.warn(`[fluxo-b-ai] erro aplicando tool ${tc.name}:`, (e as Error).message);
    }
  }

  if (conversationStepUpdate) updates.conversation_step = conversationStepUpdate;

  if (Object.keys(updates).length > 0) {
    updates.updated_at = new Date().toISOString();
    const { error: upErr } = await supabase.from("customers").update(updates).eq("id", customerId);
    if (upErr) console.warn(`[fluxo-b-ai] update customer falhou:`, upErr.message);
  }

  // 6) Logging em ai_decisions (best-effort, fire-and-forget)
  try {
    await supabase.from("ai_decisions").insert({
      consultant_id: customer.consultant_id,
      customer_id: customerId,
      phase: "fluxo_b_chat",
      tool_called: toolsApplied.join(",") || null,
      model: chosen.modelUsed,
      user_input: inboundText.slice(0, 500),
      ai_output: { text: chosen.text.slice(0, 500), tools: toolsApplied },
      step_before: customer.conversation_step || null,
      step_after: conversationStepUpdate,
      latency_ms: Date.now() - t0,
      source: "fluxo_b_ai",
    });
  } catch (_) { /* tabela pode não existir em alguns ambientes */ }

  // Fallback profissional quando o modelo devolveu texto vazio: nunca usar
  // frases tipo "me conta um pouquinho mais". Sempre reavançar o funil.
  function buildProfessionalFallback(): string {
    if (shouldHandoff) return "Vou transferir seu atendimento para um consultor humano agora. Um momento, por favor.";
    if (!customer.name && !updates.name) {
      return "Para iniciarmos seu cadastro na iGreen Energy, por favor me informe seu nome completo.";
    }
    const knownValor = typeof updates.electricity_bill_value === "number"
      ? updates.electricity_bill_value
      : (typeof customer.electricity_bill_value === "number" ? customer.electricity_bill_value : null);
    if (!knownValor) {
      return "Para calcular sua economia, qual é o valor médio mensal da sua conta de luz?";
    }
    if (conversationStepUpdate === "aguardando_conta" || customer.conversation_step === "aguardando_conta") {
      return "Por favor, envie aqui a foto ou PDF da sua última conta de luz. 📷";
    }
    if (conversationStepUpdate === "aguardando_documento" || customer.conversation_step === "aguardando_documento") {
      return "Agora preciso da foto da frente do seu RG ou CNH para finalizar o cadastro. 📄";
    }
    return "Vamos continuar seu cadastro. Pode me confirmar a próxima informação que pedi?";
  }

  const reply = sanitizeReply((chosen.text || "").trim() || buildProfessionalFallback());

  // 7) Memória persistente: atualiza conversation_summary em background a cada
  // ~6 inbounds. Fire-and-forget — não bloqueia a resposta ao lead.
  try {
    const { count: inboundCount } = await supabase
      .from("conversations")
      .select("id", { count: "exact", head: true })
      .eq("customer_id", customerId)
      .eq("message_direction", "inbound");
    const historyText = [...history, { role: "user", content: inboundText } as AIChatMessage, { role: "assistant", content: reply } as AIChatMessage]
      .map((m) => `${m.role === "user" ? "Lead" : "Bot"}: ${String(m.content).slice(0, 240)}`)
      .join("\n");
    void maybeUpdateSummary({
      supabase,
      customerId,
      consultantId: customer.consultant_id,
      history: historyText,
      customer: { ...customer, ...updates },
      inboundTurnCount: inboundCount || 0,
      previousSummary: customer.conversation_summary || null,
    });
  } catch (_) { /* best-effort */ }

  return {
    reply,
    toolsApplied,
    conversationStepUpdate,
    shouldHandoff,
    modelUsed: chosen.modelUsed,
    latencyMs: Date.now() - t0,
    customerUpdates: updates,
  };
}

// ─── helpers internos ────────────────────────────────────────────────────

// Sanitiza a resposta da IA antes de enviar ao lead:
// - Converte **negrito** (Markdown) em *negrito* (WhatsApp)
// - Remove listas markdown soltas no início de linha
// - Colapsa linhas em branco duplicadas
// - Garante no máximo 4 linhas não-vazias (impede "2 mensagens em 1")
// - Limita a 600 caracteres preservando a última frase
function sanitizeReply(raw: string): string {
  let s = String(raw || "").trim();
  if (!s) return s;
  // **bold** -> *bold*  (WhatsApp não entende dupla)
  s = s.replace(/\*\*(.+?)\*\*/g, "*$1*");
  // Remove bullets markdown "- " / "* " no começo de linha
  s = s.replace(/^[ \t]*[-*][ \t]+/gm, "");
  // Colapsa múltiplas linhas em branco
  s = s.replace(/\n{3,}/g, "\n\n");
  // Máx 4 linhas não-vazias
  const lines = s.split("\n");
  const kept: string[] = [];
  let nonEmpty = 0;
  for (const ln of lines) {
    const t = ln.trim();
    if (t) {
      if (nonEmpty >= 4) continue;
      nonEmpty++;
    }
    kept.push(ln);
  }
  s = kept.join("\n").trim();
  // Limite duro de 600 chars, cortando na última frase completa
  if (s.length > 600) {
    const cut = s.slice(0, 600);
    const lastStop = Math.max(cut.lastIndexOf("."), cut.lastIndexOf("?"), cut.lastIndexOf("!"));
    s = lastStop > 200 ? cut.slice(0, lastStop + 1) : cut;
  }
  return s.trim();
}


interface AIToolCallParsed { name: string; arguments: any }
interface AICallResult { text: string; toolCalls: AIToolCallParsed[]; modelUsed: string }

async function callWithTools(model: string, messages: AIChatMessage[], temperature: number): Promise<AICallResult> {
  // Como aiChat/aiChatCascade não suporta tools nativamente, chamamos o gateway direto.
  const key = Deno.env.get("LOVABLE_API_KEY");
  if (!key) throw new Error("LOVABLE_API_KEY not configured");

  const body: Record<string, any> = {
    model,
    messages,
    tools: FLUXO_B_TOOLS,
    tool_choice: "auto",
  };
  // openai/gpt-5* não aceita temperature
  if (!/^openai\/(gpt-5|o[134])/i.test(model)) body.temperature = temperature;

  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`AI gateway ${res.status}: ${errText.slice(0, 200)}`);
  }
  const data = await res.json();
  const choice = data?.choices?.[0]?.message;
  const text = String(choice?.content ?? "");
  const rawToolCalls = Array.isArray(choice?.tool_calls) ? choice.tool_calls : [];
  const toolCalls: AIToolCallParsed[] = rawToolCalls.map((tc: any) => {
    let parsed: any = {};
    try { parsed = JSON.parse(tc?.function?.arguments || "{}"); } catch (_) { /* ignore */ }
    return { name: tc?.function?.name || "", arguments: parsed };
  }).filter((t: AIToolCallParsed) => t.name);
  return { text, toolCalls, modelUsed: model };
}

// Sem warning sobre import não-usado de aiChat/aiChatCascade — mantemos
// disponíveis caso queiramos migrar pra cascata centralizada.
void aiChat; void aiChatCascade;
