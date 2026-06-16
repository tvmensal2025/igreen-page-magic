// Fluxo B IA — agente de IA livre que conduz o cliente do "oi" até o pedido
// da foto da conta de luz (ou handoff). Sem máquina de estado: o LLM decide,
// turno a turno, o que falar e quando avançar.
//
// Pipeline de um turno:
//   1) Carrega customer + últimas mensagens (histórico) de `conversations`.
//   2) Faz RAG: busca trechos relevantes em `bot_flow_qa` + `ai_knowledge_sections`
//      via `lookupKnowledge` (já existente).
//   3) Monta prompt: PERSONA (system) + CONHECIMENTO (system) + histórico
//      (user/assistant) + nova mensagem (user).
//   4) Chama LLM (Lovable AI Gateway, default gemini-3-flash-preview).
//   5) Parseia marcadores [PEDIR_FOTO_CONTA] / [FINALIZAR_CADASTRO] / [HANDOFF].
//   6) Executa side-effects (marca bill_requested_at, dispara handoff).
//   7) Envia o texto limpo via `enviarTexto` (sender REAL do canal).
//   8) Grava inbound e outbound em `conversations`.

import { aiChatCascade } from "../ai-gateway.ts";
import { lookupKnowledge } from "../knowledge-lookup.ts";
import { FLUXO_B_PERSONA } from "./persona.ts";
import { buscarRespostaDiretaFaq } from "./faq-direct.ts";
import { trackAIUsage } from "../ai-cost-tracker.ts";
import { maybeUpdateSummary } from "../ai-summary.ts";

const MAX_HISTORY_TURNS = 20;

export type FluxoBInput = {
  // deno-lint-ignore no-explicit-any
  supabase: any;
  customerId: string;
  consultantId: string;
  inboundText: string | null;
  inboundKind: "text" | "media" | "button_click" | null;
  inboundMediaKind?: "image" | "audio" | "document" | null;
  inboundMessageId?: string | null;
  telefone?: string | null;
  enviarTexto: (texto: string) => Promise<boolean>;
  dryRun?: boolean;
  // Em dryRun (simulador admin) o histórico não está em `conversations` ainda.
  // O cliente envia o histórico local turno-a-turno; se presente, usamos ele.
  clientHistory?: Array<{ role: "user" | "assistant"; content: string }>;
};


export type FluxoBResult = {
  respondeu: boolean;
  texto: string;
  acoes: string[];
  modelUsed?: string;
  rag?: { source: string; confidence: number } | null;
};

const ACTION_RE = /\[(PEDIR_FOTO_CONTA|FINALIZAR_CADASTRO|HANDOFF)\]/gi;

function extractActions(raw: string): { texto: string; acoes: string[] } {
  const acoes: string[] = [];
  const texto = raw.replace(ACTION_RE, (_m, a) => {
    acoes.push(String(a).toUpperCase());
    return "";
  }).replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return { texto, acoes };
}

export async function processarTurnoFluxoB(input: FluxoBInput): Promise<FluxoBResult> {
  const { supabase, customerId, consultantId, inboundText, inboundKind, inboundMediaKind } = input;

  // 1) Customer + histórico
  const { data: customer } = await supabase
    .from("customers")
    .select("id, name, phone_whatsapp, bill_requested_at, electricity_bill_photo_url, bot_paused, conversation_summary, address_state, electricity_bill_value")
    .eq("id", customerId)
    .maybeSingle();

  if (!customer) return { respondeu: false, texto: "", acoes: [] };
  if (customer.bot_paused) return { respondeu: false, texto: "", acoes: [] };

  // Dados do consultor para a IA se apresentar corretamente:
  // "assistente virtual {assistant_name} do/da {representante}".
  let assistantName = "Camila";
  let representante = "";
  let artigoRep = "do"; // do (consultor) | da (consultora)
  try {
    const { data: consultor } = await supabase
      .from("consultants")
      .select("name, assistant_name, gender")
      .eq("id", consultantId)
      .maybeSingle();
    if (consultor) {
      if ((consultor as any).assistant_name?.trim()) assistantName = (consultor as any).assistant_name.trim();
      representante = (consultor as any).name?.trim() || "";
      if (String((consultor as any).gender) === "consultora") artigoRep = "da";
    }
  } catch (_e) { /* usa defaults */ }

  // Se entrou foto da conta, sinaliza para a IA fechar com [FINALIZAR_CADASTRO]
  const billPhotoArrived = inboundKind === "media" && inboundMediaKind === "image";

  // ─── Resposta DIRETA do FAQ (sem LLM) ─────────────────────────────────
  // Se a mensagem de texto do cliente casa com uma intenção/gatilho do FAQ,
  // respondemos com o texto EXATO da base — sem chamar o LLM. Economiza custo
  // e garante congruência (resposta sempre oficial). Só para texto puro: foto,
  // botões e abertura seguem pelo LLM (que controla os marcadores de avanço).
  if (inboundKind === "text" && !billPhotoArrived) {
    const direta = await buscarRespostaDiretaFaq(
      supabase, consultantId, inboundText, customer.name ?? null,
    ).catch(() => null);
    if (direta) {
      console.log(`[fluxo-b-ia] resposta DIRETA do FAQ (sem LLM) intent="${direta.intentName}" trigger="${direta.triggerMatched}"`);
      if (!input.dryRun) {
        await supabase.from("customers").update({
          last_bot_reply_at: new Date().toISOString(),
          last_bot_interaction_at: new Date().toISOString(),
        }).eq("id", customerId);

        if (inboundText) {
          await supabase.from("conversations").insert({
            customer_id: customerId,
            message_direction: "inbound",
            message_text: inboundText,
            message_type: inboundKind || "text",
            external_message_id: input.inboundMessageId || null,
          });
        }
        const enviado = await input.enviarTexto(direta.texto).catch(() => false);
        if (!enviado) return { respondeu: false, texto: direta.texto, acoes: [] };
        await supabase.from("conversations").insert({
          customer_id: customerId,
          message_direction: "outbound",
          message_text: direta.texto,
          message_type: "text",
        });
      }
      return {
        respondeu: true,
        texto: direta.texto,
        acoes: [],
        modelUsed: "faq-direct",
        rag: { source: "bot_flow_qa", confidence: 1 },
      };
    }
  }

  let historyMessages: Array<{ role: "user" | "assistant"; content: string }> = [];
  if (input.dryRun && input.clientHistory && input.clientHistory.length > 0) {
    // Simulador admin: usa o histórico mantido localmente no painel (dryRun não grava em conversations).
    historyMessages = input.clientHistory
      .filter((m) => m && m.content)
      .slice(-MAX_HISTORY_TURNS * 2)
      .map((m) => ({ role: m.role, content: String(m.content).slice(0, 1500) }));
  } else {
    const { data: history } = await supabase
      .from("conversations")
      .select("message_direction, message_text, message_type, created_at")
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false })
      .limit(MAX_HISTORY_TURNS * 2);

    const historyAsc = (history || []).reverse();
    historyMessages = historyAsc
      .filter((m: any) => m?.message_text)
      .map((m: any) => ({
        role: m.message_direction === "outbound" ? "assistant" as const : "user" as const,
        content: String(m.message_text).slice(0, 1500),
      }));
  }


  // 2) RAG
  const ragQuery = inboundText || (billPhotoArrived ? "cliente enviou foto da conta" : "saudação inicial");
  const rag = await lookupKnowledge({ supabase, question: ragQuery, consultantId }).catch(() => null);

  // Persona: tenta carregar a versão editável de app_settings; cai pro arquivo se vazia.
  let personaText = FLUXO_B_PERSONA;
  try {
    const { data: appCfg } = await supabase
      .from("app_settings")
      .select("fluxo_b_persona")
      .eq("id", "global")
      .maybeSingle();
    const editable = (appCfg as any)?.fluxo_b_persona;
    if (editable && typeof editable === "string" && editable.trim().length > 50) {
      personaText = editable;
    }
  } catch (_e) { /* keep fallback */ }

  // 3) Monta prompt
  const identidade = representante
    ? `IDENTIDADE: Você é ${assistantName}, a assistente virtual ${artigoRep} ${representante} (consultor(a) da iGreen Energy). Logo no primeiro contato, apresente-se assim: "Oi! Aqui é a ${assistantName}, assistente virtual ${artigoRep} ${representante}." Seja transparente: se o cliente perguntar se você é um robô/IA/atendente, confirme com naturalidade que é uma assistente virtual (IA) que ajuda ${artigoRep} ${representante} — NUNCA diga que é humana. Não invente que é pessoa.`
    : `IDENTIDADE: Você é ${assistantName}, a assistente virtual da iGreen Energy. Apresente-se no primeiro contato como assistente virtual. Se perguntarem se você é robô/IA, confirme com naturalidade que é uma assistente virtual (IA) — NUNCA diga que é humana.`;

  const systemMessages = [
    { role: "system" as const, content: personaText },
    { role: "system" as const, content: identidade },
  ];

  // Memória persistente: injeta o resumo da conversa (gerado a cada ~6 turnos).
  // Ajuda em conversas longas ou retomadas, sem depender só das últimas 20 msgs.
  if (customer.conversation_summary && String(customer.conversation_summary).trim()) {
    systemMessages.push({
      role: "system" as const,
      content: `RESUMO DA CONVERSA ATÉ AGORA (memória — use para não repetir perguntas e manter o contexto):\n${customer.conversation_summary}`,
    });
  }


  if (rag?.found && rag.text) {
    systemMessages.push({
      role: "system" as const,
      content: `CONHECIMENTO RELEVANTE (use SOMENTE estas informações para responder dúvidas específicas; se não for suficiente, seja honesta):\n\n${rag.text}`,
    });
  }

  if (customer.name) {
    systemMessages.push({
      role: "system" as const,
      content: `O nome do cliente é ${customer.name}.`,
    });
  }

  if (billPhotoArrived) {
    systemMessages.push({
      role: "system" as const,
      content: `IMPORTANTE: o cliente acabou de enviar uma FOTO. Trate como foto da conta de luz. Agradeça, diga que vai analisar e adicione [FINALIZAR_CADASTRO] no final.`,
    });
  } else if (customer.bill_requested_at && !customer.electricity_bill_photo_url) {
    systemMessages.push({
      role: "system" as const,
      content: `Você JÁ pediu a foto da conta de luz neste cliente. Se ele ainda não enviou e está enrolando, reforce a importância da foto sem ser insistente.`,
    });
  }

  const userTurn = inboundText
    ? inboundText
    : billPhotoArrived
      ? "[o cliente enviou uma imagem]"
      : inboundKind === "media"
        ? `[o cliente enviou ${inboundMediaKind || "uma mídia"}]`
        : inboundKind === "button_click"
          ? "[o cliente clicou em um botão]"
          : "[turno vazio]";

  const messages = [
    ...systemMessages,
    ...historyMessages,
    { role: "user" as const, content: userTurn },
  ];

  // 4) LLM — maxTokens 2048 evita truncamento em respostas mais longas
  // (anteriormente 600 cortava no meio e parecia "IA não respondeu mais").
  const llm = await aiChatCascade({
    model: "google/gemini-3-flash-preview",
    temperature: 0.6,
    maxTokens: 2048,
    messages,
  }).catch((e) => {
    console.error("[fluxo-b-ia] LLM error:", e?.message);
    return null;
  });

  // Registra uso/custo por consultor (best-effort) — alimenta o painel de gastos.
  if (!input.dryRun && llm) {
    const u = llm.raw?.usage || {};
    void trackAIUsage({
      supabase,
      consultantId,
      model: llm.modelUsed || "google/gemini-3-flash-preview",
      phase: "orchestrator",
      usage: {
        input: Number(u.prompt_tokens || 0),
        output: Number(u.completion_tokens || 0),
      },
    });
  }

  if (!llm || !llm.text) {
    console.warn("[fluxo-b-ia] LLM returned empty text", { hasLlm: !!llm });
    return { respondeu: false, texto: "", acoes: [] };
  }

  // 5) Parse marcadores
  const { texto, acoes } = extractActions(llm.text);
  if (!texto) {
    console.warn("[fluxo-b-ia] após remover marcadores texto ficou vazio", { acoes, raw: llm.text.slice(0, 200) });
    return { respondeu: false, texto: "", acoes };
  }



  // 6) Side-effects (skip em dryRun)
  if (!input.dryRun) {
    const updates: Record<string, any> = {
      last_bot_reply_at: new Date().toISOString(),
      last_bot_interaction_at: new Date().toISOString(),
    };

    if (acoes.includes("PEDIR_FOTO_CONTA") && !customer.bill_requested_at) {
      updates.bill_requested_at = new Date().toISOString();
    }
    if (acoes.includes("HANDOFF")) {
      updates.bot_paused = true;
      updates.bot_paused_at = new Date().toISOString();
      updates.bot_paused_reason = "fluxo-b-ia: handoff solicitado pela IA";
    }
    if (acoes.includes("FINALIZAR_CADASTRO")) {
      updates.sales_phase = "fechamento_aguardando_humano";
    }

    await supabase.from("customers").update(updates).eq("id", customerId);

    // Grava inbound (se houver texto novo) e outbound em conversations.
    if (inboundText) {
      await supabase.from("conversations").insert({
        customer_id: customerId,
        message_direction: "inbound",
        message_text: inboundText,
        message_type: inboundKind || "text",
        external_message_id: input.inboundMessageId || null,
      });
    }

    // 7) Envia para o cliente
    const enviado = await input.enviarTexto(texto).catch(() => false);
    if (!enviado) return { respondeu: false, texto, acoes, modelUsed: llm.modelUsed };

    await supabase.from("conversations").insert({
      customer_id: customerId,
      message_direction: "outbound",
      message_text: texto,
      message_type: "text",
    });

    // 8) Memória: atualiza o resumo da conversa a cada ~6 turnos do lead.
    // Fire-and-forget — não bloqueia a resposta. Conta os turnos inbound do
    // histórico + 1 (o turno atual).
    try {
      const inboundCount = historyMessages.filter((m) => m.role === "user").length + 1;
      const historicoFmt = [...historyMessages, { role: "user" as const, content: userTurn }, { role: "assistant" as const, content: texto }]
        .map((m) => `${m.role === "user" ? "Lead" : "Camila"}: ${m.content}`)
        .join("\n");
      void maybeUpdateSummary({
        supabase,
        customerId,
        consultantId,
        history: historicoFmt,
        customer,
        inboundTurnCount: inboundCount,
        previousSummary: customer.conversation_summary || null,
      });
    } catch (_e) { /* best-effort */ }
  }

  return {
    respondeu: true,
    texto,
    acoes,
    modelUsed: llm.modelUsed,
    rag: rag?.found ? { source: rag.source, confidence: rag.confidence } : null,
  };
}
