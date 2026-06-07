// Orchestrator da Vendedora (Fluxo B) — state machine determinística +
// extractors + micro-writer + redes anti-foto-cedo/anti-repetição.
// Chamado por fluxo-b-ai.ts via runVendedoraV2.

import { chatCascade, type ChatMsg } from "./gateway.ts";
import { perfilar } from "./perfilador.ts";
import { buscarContexto, formatChunks } from "./rag.ts";
import { criticar } from "./critico.ts";
import { readState, writeState } from "./state.ts";
import { atualizarMemoria, formatMemory, readMemory } from "./memory.ts";
import { tentarFechar, detectarMidiaNova, checklistMinimo } from "./closer.ts";
import { decideEtapa } from "./state-machine.ts";
import { extrairNome, extrairValor, extrairEmail, classificarInteresse } from "./extractors.ts";
import { TRAVA_POR_ETAPA, fallbackPorEtapa, validarResposta, respostaConsideracao, respostaTocaTema, classificarObjecao, leadFezPergunta, respostaPerguntaCurta, respostaDespedida } from "./templates.ts";
import type { Etapa, FluxoBState, SupabaseClient } from "./types.ts";
import type { VendedoraInput, VendedoraResult } from "./index.ts";

const MICRO_MODELS = ["google/gemini-3-flash-preview", "openai/gpt-5-mini"];

const STEP_BY_ETAPA: Partial<Record<Etapa, string>> = {
  foto_conta: "aguardando_conta",
  doc: "aguardando_documento",
  email: "aguardando_email",
  finalizando: "cadastro_finalizando",
};

// Etapas "ricas" — usam RAG e crítico. Outras são mecânicas (texto curto, sem LLM auxiliar).
const ETAPAS_RICAS = new Set<Etapa>(["simulacao", "consideracao", "finalizando"]);

// Etapas onde o template fixo já resolve — pula LLM de escrita e crítico.
const ETAPAS_DETERMINISTICAS = new Set<Etapa>(["nome", "valor", "foto_conta", "doc", "email"]);

export async function runVendedoraV2(input: VendedoraInput): Promise<VendedoraResult> {
  const t0 = Date.now();
  const { supabase, customerId, inboundText } = input;

  // 1) Contexto
  let customer = input.customer;
  if (customerId) {
    const { data } = await supabase.from("customers").select("*").eq("id", customerId).maybeSingle();
    if (data) customer = data;
  }
  if (!customer) throw new Error(`[vendedora-v2] customer ${customerId} not found`);

  let consultant = input.consultant;
  if (!consultant && customer.consultant_id) {
    const { data } = await supabase
      .from("consultants")
      .select("id, name, ai_persona_fluxo_b")
      .eq("id", customer.consultant_id).maybeSingle();
    consultant = data;
  }
  if (!consultant) throw new Error(`[vendedora-v2] consultant não encontrado`);

  // Histórico
  const { data: histRows } = await supabase
    .from("conversations")
    .select("message_direction, message_text, message_type, created_at")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false })
    .limit(30);
  const historyMsgs: ChatMsg[] = ((histRows || []) as any[])
    .slice().reverse()
    .map((row): ChatMsg => ({
      role: row.message_direction === "outbound" ? "assistant" : "user",
      content: row.message_text || (row.message_type === "image" ? "[imagem]" : "[mídia]"),
    }))
    .filter((m) => m.content && String(m.content).trim().length > 0);
  const historyText = historyMsgs
    .map((m) => `${m.role === "user" ? "Lead" : "Bot"}: ${String(m.content).slice(0, 220)}`)
    .join("\n");

  const state = readState(customer);
  const memory = readMemory(customer);
  const stateBefore = { ...state };

  // 2) Mídia recebida → atualiza state.midia_recebida
  const novaMidia = detectarMidiaNova(customer, state);
  if (novaMidia.conta || novaMidia.doc_frente || novaMidia.doc_verso) {
    state.midia_recebida = {
      conta: state.midia_recebida?.conta || novaMidia.conta,
      doc_frente: state.midia_recebida?.doc_frente || novaMidia.doc_frente,
      doc_verso: state.midia_recebida?.doc_verso || novaMidia.doc_verso,
    };
  }

  // 3) Extractors — rodam em paralelo com perfilador, antes de decidir etapa.
  // Só extrai o que ainda falta — evita LLM call desnecessário.
  const etapaAntes = state.etapa;
  const precisaNome = !customer.name;
  const precisaValor = !(typeof customer.electricity_bill_value === "number" && customer.electricity_bill_value > 0);
  const precisaEmail = !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(customer.email || ""));
  // Detecta interesse quando o lead já viu a simulação e está na fase de
  // consideração (ou ainda no turno em que a simulação foi apresentada).
  const aguardaInteresse = (etapaAntes === "simulacao" || etapaAntes === "consideracao")
    && state.simulacao_apresentada && !state.interesse_confirmado;

  const updates: Record<string, any> = {};
  const toolsApplied: string[] = [];
  let shouldHandoff = false;

  const [perfil, nomeExt, valorExt, emailExt, interesseExt] = await Promise.all([
    perfilar(historyText, inboundText),
    precisaNome ? extrairNome(inboundText) : Promise.resolve(null),
    precisaValor ? extrairValor(inboundText) : Promise.resolve(null),
    precisaEmail ? extrairEmail(inboundText) : Promise.resolve(null),
    aguardaInteresse ? classificarInteresse(inboundText) : Promise.resolve(false),
  ]);

  if (nomeExt)  { updates.name = nomeExt; updates.name_source = "vendedora_v2"; customer.name = nomeExt; toolsApplied.push("extrair_nome"); }
  if (valorExt) { updates.electricity_bill_value = valorExt; customer.electricity_bill_value = valorExt; toolsApplied.push("extrair_valor"); }
  if (emailExt) { updates.email = emailExt; customer.email = emailExt; toolsApplied.push("extrair_email"); }
  if (interesseExt) { state.interesse_confirmado = true; toolsApplied.push("classificar_interesse"); }

  // 4) State machine decide etapa SOMENTE com dados confirmados
  const semHistorico = historyMsgs.length === 0;
  const etapaDecidida = decideEtapa(customer, state, { semHistorico });
  if (etapaDecidida !== state.etapa) {
    state.etapa = etapaDecidida;
    state.tentativas_etapa = 0;
  } else {
    state.tentativas_etapa = (state.tentativas_etapa || 0) + 1;
  }
  state.perfil = perfil.perfil;
  state.ultimo_perfil = perfil;
  state.temperatura_max = Math.max(state.temperatura_max || 0, perfil.temperatura);

  // 5) RAG só pra etapas ricas (paralelizado com nada — já fizemos extractors)
  let ragText = "";
  let ragChunksLen = 0;
  if (ETAPAS_RICAS.has(state.etapa)) {
    try {
      const chunks = await buscarContexto({
        supabase, consultantId: customer.consultant_id,
        etapa: state.etapa, query: `${inboundText} ${state.etapa}`,
      });
      ragText = formatChunks(chunks);
      ragChunksLen = chunks.length;
    } catch { /* RAG é opcional */ }
  }

  // 6) Escrita: short-circuit determinístico em etapas mecânicas; micro-writer nas demais
  const memoryText = formatMemory(memory);
  let reply = "";
  let modelUsed = "deterministic";
  let val: ReturnType<typeof validarResposta> = { ok: true };

  // Última resposta do bot (pra evitar repetir a mesma frase na consideração)
  const ultimaRespBot = [...historyMsgs].reverse().find((m) => m.role === "assistant")?.content || "";
  const norm = (s: string) => String(s).toLowerCase().replace(/[^a-záàâãéêíóôõúç0-9]/gi, "").slice(0, 120);

  // Helper: resposta determinística da consideração que JÁ registra a objeção
  // tratada no state (pra próxima repetição escolher variante diferente).
  const respConsider = (tentativaOffset = 0): string => {
    const r = respostaConsideracao(
      inboundText, customer.name || null,
      state.tentativas_etapa + tentativaOffset,
      state.objecoes_tratadas,
    );
    state.objecoes_tratadas = [...(state.objecoes_tratadas || []), r.tipo].slice(-12);
    return sanitize(r.texto);
  };

  if (ETAPAS_DETERMINISTICAS.has(state.etapa)) {
    // ⚡ Antes do template fixo: o lead fez uma PERGUNTA/objeção em vez de
    // responder o que a etapa pediu? Se sim, responde a dúvida e reancora.
    const q = leadFezPergunta(inboundText, state.etapa);
    if (q.pergunta) {
      // Esta interação respondeu a uma dúvida — não conta como "tentativa
      // falha" da etapa (a etapa simplesmente não avançou porque o lead
      // perguntou outra coisa).
      state.tentativas_etapa = Math.max(0, (state.tentativas_etapa || 1) - 1);

      if (q.tipo === "desistencia") {
        reply = sanitize(respostaDespedida(customer.name));
        modelUsed = "deterministic_despedida";
        shouldHandoff = true;
        updates.bot_paused = true;
        updates.bot_paused_reason = `vendedora_v2: lead desistiu na etapa ${state.etapa}`;
        updates.bot_paused_at = new Date().toISOString();
      } else {
        reply = sanitize(respostaPerguntaCurta(
          q.tipo,
          customer.name || null,
          state.etapa,
          typeof customer.electricity_bill_value === "number" ? customer.electricity_bill_value : null,
          state.tentativas_etapa,
        ));
        modelUsed = `deterministic_duvida:${q.tipo}`;
        state.objecoes_tratadas = [...(state.objecoes_tratadas || []), q.tipo].slice(-12);
      }
    } else {
      reply = sanitize(fallbackPorEtapa(state.etapa, customer.name, customer.electricity_bill_value, state.tentativas_etapa));
      modelUsed = "deterministic_template";
    }
  } else {
    const writeResult = await microWrite({
      etapa: state.etapa,
      nomeLead: customer.name || null,
      valorConta: typeof customer.electricity_bill_value === "number" ? customer.electricity_bill_value : null,
      representante: consultant.name || "Rafael",
      inboundText,
      history: historyMsgs,
      perfil,
      ragText,
      memoryText,
      basePersona: consultant.ai_persona_fluxo_b || null,
    });
    reply = sanitize(writeResult.text);
    modelUsed = writeResult.modelUsed;

    // Validação estrutural barata
    val = validarResposta(reply, state.etapa, customer.name || null);
    if (!val.ok) {
      // Fallback ESPECÍFICO da consideração: responde a dúvida do lead, não frase genérica.
      reply = state.etapa === "consideracao"
        ? respConsider()
        : sanitize(fallbackPorEtapa(state.etapa, customer.name, customer.electricity_bill_value, state.tentativas_etapa));
      modelUsed = `${modelUsed}+fallback:${val.motivo}`;
    } else if (state.etapa === "consideracao") {
      // Em consideração, mesmo com resposta "válida" do LLM, garantimos
      // coerência e anti-repetição com a rede determinística:
      const tocaTema = respostaTocaTema(inboundText, reply);
      const repetiuAnterior = ultimaRespBot && norm(reply) === norm(ultimaRespBot);
      if (!tocaTema) {
        reply = respConsider();
        modelUsed = `${modelUsed}+tema_corrigido`;
      } else if (repetiuAnterior) {
        reply = respConsider(1);
        modelUsed = `${modelUsed}+antirepeticao`;
      } else {
        // LLM respondeu bem e no tema: registra a objeção mesmo assim, pra
        // controle de repetição futura.
        state.objecoes_tratadas = [...(state.objecoes_tratadas || []), classificarObjecao(inboundText)].slice(-12);
      }
    }
  }

  // 7) Crítico — só nas etapas ricas (e nunca em determinísticas)
  let criticoAprovado = true;
  const criticoProblemas: string[] = [];
  if (ETAPAS_RICAS.has(state.etapa) && reply) {
    const c = await criticar({
      texto: reply, perfil,
      jaTemHistorico: historyMsgs.length > 0,
      plano: {
        etapa_atual: state.etapa,
        proxima_jogada: TRAVA_POR_ETAPA[state.etapa],
        tom: "consultivo_seguro",
        info_a_capturar: [],
        objecao_a_tratar: null,
        deve_pedir_humano: false,
        deve_agendar_followup: false,
        razao_da_jogada: "v2 state machine",
      },
      nomeLead: customer.name || null,
    });
    criticoAprovado = c.aprovado;
    criticoProblemas.push(...c.problemas);
    if (!c.aprovado) {
      reply = state.etapa === "consideracao"
        ? respConsider()
        : sanitize(c.sugestao || fallbackPorEtapa(state.etapa, customer.name, customer.electricity_bill_value, state.tentativas_etapa));
      modelUsed = `${modelUsed}+critico_reprovou`;
    }
  }

  // 7b) TRAVA DURA anti-pedido-precoce — rede determinística independente do LLM.
  // Se a etapa atual NÃO é de coleta de mídia/e-mail mas o texto pede
  // foto/conta/documento/RG/CNH/e-mail, o modelo (ou o crítico) furou a trava.
  // Reescreve com o fallback determinístico da etapa. Garante que a foto só
  // é pedida quando a state machine realmente chegou em `foto_conta`.
  if (!["foto_conta", "doc", "email"].includes(state.etapa)) {
    const pedeMidia = /\b(foto|fotografia|print|imagem)\b/i.test(reply) ||
      /\b(conta de luz|fatura).*(envi|mand|manda|me\s+pass)/i.test(reply) ||
      /\b(rg|cnh|documento|identidade)\b/i.test(reply) ||
      /\b(e-?mail)\b/i.test(reply) ||
      /📷|📄|📧/.test(reply);
    if (pedeMidia) {
      const corrigido = state.etapa === "consideracao"
        ? respConsider()
        : sanitize(fallbackPorEtapa(state.etapa, customer.name, customer.electricity_bill_value, state.tentativas_etapa));
      console.warn(`[vendedora-v2] trava anti-foto: etapa=${state.etapa} pediu mídia/email cedo — reescrito p/ fallback`);
      reply = corrigido;
      modelUsed = `${modelUsed}+trava_antifoto`;
    }
  }

  // 8) Pós-escrita: marca flags de progresso
  if (state.etapa === "simulacao" && !state.simulacao_apresentada) {
    state.simulacao_apresentada = true;
  }
  if (state.etapa === "interesse") {
    state.abertura_feita = true;
  }


  // 9) Step do banco
  let conversationStepUpdate: string | null = STEP_BY_ETAPA[state.etapa] || null;
  // shouldHandoff já foi declarado lá em cima (pode ser setado pelo bloco de desistência)

  // Handoff por excesso de tentativas. A etapa `consideracao` é EXCEÇÃO:
  // o lead pode legitimamente fazer várias perguntas/objeções antes de
  // decidir cadastrar — não é "travamento", é negociação. Damos um teto
  // bem mais alto e só então escalamos.
  const tetoTentativas = state.etapa === "consideracao" ? 8 : 4;
  if (state.tentativas_etapa >= tetoTentativas) {
    shouldHandoff = true;
    updates.bot_paused = true;
    updates.bot_paused_reason = `vendedora_v2: ${state.tentativas_etapa} tentativas na etapa ${state.etapa}`;
    updates.bot_paused_at = new Date().toISOString();
  }

  if (conversationStepUpdate) updates.conversation_step = conversationStepUpdate;
  updates.fluxo_b_state = state;
  updates.updated_at = new Date().toISOString();
  await supabase.from("customers").update(updates).eq("id", customerId);

  // 10) Closer — checklist completo? aciona finalize-capture
  let closerResult: Awaited<ReturnType<typeof tentarFechar>> | null = null;
  const checklist = checklistMinimo({ ...customer, ...updates });
  if ((state.etapa === "finalizando" || checklist.pronto) && !shouldHandoff) {
    closerResult = await tentarFechar(supabase, customerId);
    if (closerResult.ok && closerResult.acionou) {
      state.cadastro_finalizado = true;
      await supabase.from("customers").update({
        conversation_step: "portal_submitting",
        fluxo_b_state: state,
      }).eq("id", customerId);
      conversationStepUpdate = "portal_submitting";
    } else if (!closerResult.ok && closerResult.portalMissing?.length) {
      shouldHandoff = true;
      await supabase.from("customers").update({
        bot_paused: true,
        bot_paused_reason: `vendedora_v2: portal rejeitou — ${closerResult.portalMissing.slice(0,4).join(", ")}`,
        bot_paused_at: new Date().toISOString(),
      }).eq("id", customerId);
    }
  }

  // 11) Logging
  try {
    await supabase.from("ai_decisions").insert({
      consultant_id: customer.consultant_id,
      customer_id: customerId,
      phase: "vendedora_v2",
      tool_called: toolsApplied.join(",") || null,
      model: modelUsed,
      user_input: inboundText.slice(0, 500),
      ai_output: {
        text: reply.slice(0, 500),
        tools: toolsApplied,
        perfil,
        etapa_antes: etapaAntes,
        etapa_decidida: state.etapa,
        rag_chunks: ragChunksLen,
        critico_aprovado: criticoAprovado,
        critico_problemas: criticoProblemas,
        state_before: stateBefore,
        state_after: state,
        validacao: val,
      },
      step_before: customer.conversation_step || null,
      step_after: conversationStepUpdate,
      latency_ms: Date.now() - t0,
      source: "vendedora_v2",
    });
  } catch { /* best-effort */ }

  // 12) Memória (fire and forget)
  void atualizarMemoria({
    supabase, customerId, memoriaAtual: memory, history: historyText,
    inbound: inboundText, reply,
  });

  return {
    reply: reply || fallbackPorEtapa(state.etapa, customer.name, customer.electricity_bill_value, state.tentativas_etapa),
    toolsApplied,
    conversationStepUpdate,
    shouldHandoff,
    modelUsed,
    latencyMs: Date.now() - t0,
    customerUpdates: updates,
    debug: {
      perfil,
      plano: { etapa_atual: state.etapa, trava: TRAVA_POR_ETAPA[state.etapa] },
      ragChunks: ragChunksLen,
      criticoAprovado,
      criticoProblemas,
      stateBefore,
      stateAfter: state,
      checklist,
      closer: closerResult,
    },
  };
}

// ───── micro-writer ─────────────────────────────────────────────────────
// Prompt mínimo, focado na TRAVA da etapa. Sem persona inflada, sem plano,
// sem "regras absolutas" enterradas. O LLM vê 1 trava + 1 contexto + escreve.
async function microWrite(args: {
  etapa: Etapa;
  nomeLead: string | null;
  valorConta: number | null;
  representante: string;
  inboundText: string;
  history: ChatMsg[];
  perfil: any;
  ragText: string;
  memoryText: string;
  basePersona: string | null;
}): Promise<{ text: string; modelUsed: string }> {
  const trava = TRAVA_POR_ETAPA[args.etapa];
  const economia = args.valorConta ? `R$ ${(args.valorConta * 0.2).toFixed(0)}/mês` : null;

  const sys = `Você é ${args.representante}, vendedora da iGreen Energy no WhatsApp.

# 🔒 TRAVA DESTA RESPOSTA (etapa: ${args.etapa})
${trava}

# Dados confirmados
- nome: ${args.nomeLead || "(ainda não)"}
- valor da conta: ${args.valorConta ? `R$ ${args.valorConta.toFixed(2)}` : "(ainda não)"}
${economia ? `- economia estimada (×0,20): ${economia}` : ""}

# Perfil do lead
${args.perfil.perfil} · sentimento ${args.perfil.sentimento} · temperatura ${args.perfil.temperatura}

# Regras absolutas (curtas)
- MÁX 3 linhas, ≤600 chars, *negrito assim* (nunca **assim**), sem bullets.
- 1 pergunta no final (exceto pos_cadastro).
- Use o nome do lead se já souber.
- Nunca prometa vídeo/áudio/link/retorno futuro.
- Nunca "como posso te ajudar", "me conta mais", "estou à disposição".
${args.ragText ? `\n# Contexto relevante\n${args.ragText.slice(0, 1200)}` : ""}
${args.memoryText ? `\n${args.memoryText.slice(0, 600)}` : ""}

Responda APENAS a mensagem que vai ao lead, em PT-BR.`;

  const messages: ChatMsg[] = [
    { role: "system", content: sys },
    ...args.history.slice(-10),
    { role: "user", content: args.inboundText },
  ];
  try {
    const r = await chatCascade({ models: MICRO_MODELS, messages, temperature: 0.6 });
    return { text: r.text, modelUsed: r.modelUsed };
  } catch (e) {
    return { text: "", modelUsed: `error:${(e as Error).message.slice(0, 60)}` };
  }
}

function sanitize(raw: string): string {
  let s = String(raw || "").trim();
  if (!s) return s;
  s = s.replace(/\*\*(.+?)\*\*/g, "*$1*");
  s = s.replace(/^[ \t]*[-*][ \t]+/gm, "");
  s = s.replace(/\n{3,}/g, "\n\n");
  const lines = s.split("\n");
  const kept: string[] = [];
  let n = 0;
  for (const ln of lines) {
    const t = ln.trim();
    if (t) { if (n >= 4) continue; n++; }
    kept.push(ln);
  }
  s = kept.join("\n").trim();
  if (s.length > 600) {
    const cut = s.slice(0, 600);
    const stop = Math.max(cut.lastIndexOf("."), cut.lastIndexOf("?"), cut.lastIndexOf("!"));
    s = stop > 200 ? cut.slice(0, stop + 1) : cut;
  }
  return s.trim();
}
