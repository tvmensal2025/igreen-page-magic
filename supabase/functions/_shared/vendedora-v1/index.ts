// Vendedora v1 — orquestrador. Mesma assinatura de runFluxoBAI.
//
// Fluxo: Perfilador → Planner → RAG → Writer → Crítico → tools/state/memory.

import type { ChatMsg } from "./gateway.ts";
import { perfilar } from "./perfilador.ts";
import { planejar } from "./planner.ts";
import { buscarContexto, formatChunks } from "./rag.ts";
import { escrever } from "./writer.ts";
import { criticar } from "./critico.ts";
import { readState, writeState } from "./state.ts";
import { atualizarMemoria, formatMemory, readMemory } from "./memory.ts";
import { tentarFechar, detectarMidiaNova, checklistMinimo } from "./closer.ts";
import type { Etapa, SupabaseClient } from "./types.ts";

// V2 export — state machine determinística
export { runVendedoraV2 } from "./v2-orchestrator.ts";

export interface VendedoraInput {
  supabase: SupabaseClient;
  customerId: string;
  inboundText: string;
  customer?: any;
  consultant?: any;
}

export interface VendedoraResult {
  reply: string;
  toolsApplied: string[];
  conversationStepUpdate: string | null;
  shouldHandoff: boolean;
  modelUsed: string;
  latencyMs: number;
  customerUpdates: Record<string, any>;
  debug?: {
    perfil: any;
    plano: any;
    ragChunks: number;
    criticoAprovado: boolean;
    criticoProblemas: string[];
    stateBefore: any;
    stateAfter: any;
    checklist?: any;
    closer?: any;
  };
}

const STEP_BY_ETAPA: Partial<Record<Etapa, string>> = {
  foto_conta: "aguardando_conta",
  doc: "aguardando_documento",
  email: "aguardando_email",
  finalizando: "cadastro_finalizando",
};

function fallbackPorEtapa(etapa: Etapa, nome?: string | null): string {
  const n = nome ? `, *${nome}*` : "";
  switch (etapa) {
    case "interesse": return `Olá! 😊 Aqui é da *iGreen Energy*. Você passa a pagar *menos* todo mês na conta de luz, sem obra e sem trocar de distribuidora ⚡\nPosso te chamar como?`;
    case "nome": return `Pra eu te atender direitinho, qual o seu nome?`;
    case "valor": return `Show${n}! Qual o *valor médio* da sua conta de luz?`;
    case "simulacao": return `${nome ? `${nome}, com base no seu valor, ` : "Com base no seu valor, "}o desconto fica entre *8% e 20%* ao mês ⚡\nFaz sentido pra você?`;
    case "foto_conta": return `${nome ? `Perfeito${n}! ` : ""}Me manda a *foto da sua conta de luz* 📷`;
    case "doc": return `Agora preciso da foto da *frente do seu RG ou CNH* 📄`;
    case "email": return `Pra finalizar, qual o seu melhor *e-mail* 📧?`;
    case "finalizando": return `${nome ? `${nome}, ` : ""}tá tudo certo pra finalizar seu cadastro. Posso seguir?`;
    case "pos_cadastro": return `Cadastro feito${n}! Em breve te mando os próximos passos ✅`;
    default: return `Pode me contar um pouco mais pra eu te ajudar melhor?`;
  }
}


export async function runVendedoraV1(input: VendedoraInput): Promise<VendedoraResult> {
  const t0 = Date.now();
  const { supabase, customerId, inboundText } = input;

  // 1. Carrega contexto
  let customer = input.customer;
  if (customerId) {
    const { data } = await supabase.from("customers").select("*").eq("id", customerId).maybeSingle();
    if (data) customer = data;
  }
  if (!customer) throw new Error(`[vendedora-v1] customer ${customerId} not found`);

  let consultant = input.consultant;
  if (!consultant && customer.consultant_id) {
    const { data } = await supabase
      .from("consultants")
      .select("id, name, ai_persona_fluxo_b")
      .eq("id", customer.consultant_id)
      .maybeSingle();
    consultant = data;
  }
  if (!consultant) throw new Error(`[vendedora-v1] consultant não encontrado`);

  // Histórico
  const { data: histRows } = await supabase
    .from("conversations")
    .select("message_direction, message_text, message_type, created_at")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false })
    .limit(30);
  const historyMsgs: ChatMsg[] = ((histRows || []) as any[])
    .slice()
    .reverse()
    .map((row): ChatMsg => ({
      role: row.message_direction === "outbound" ? "assistant" : "user",
      content: row.message_text || (row.message_type === "image" ? "[imagem]" : row.message_type === "audio" ? "[áudio]" : "[mídia]"),
    }))
    .filter((m) => m.content && String(m.content).trim().length > 0);
  const historyText = historyMsgs
    .map((m) => `${m.role === "user" ? "Lead" : "Bot"}: ${String(m.content).slice(0, 220)}`)
    .join("\n");

  const state = readState(customer);
  const memory = readMemory(customer);

  // 1.1 Detecta mídia recém-recebida (foto da conta / documento) e avança
  // a etapa automaticamente. Sem isso, a v1 ignorava o avanço quando o webhook
  // só passava "[imagem]" como inboundText.
  const novaMidia = detectarMidiaNova(customer, state);
  if (novaMidia.conta || novaMidia.doc_frente || novaMidia.doc_verso) {
    state.midia_recebida = {
      ...(state.midia_recebida || {}),
      conta: state.midia_recebida?.conta || novaMidia.conta,
      doc_frente: state.midia_recebida?.doc_frente || novaMidia.doc_frente,
      doc_verso: state.midia_recebida?.doc_verso || novaMidia.doc_verso,
    };
    if (novaMidia.conta && (state.etapa === "interesse" || state.etapa === "nome" || state.etapa === "valor" || state.etapa === "simulacao" || state.etapa === "foto_conta")) {
      state.etapa = "doc";
      state.tentativas_etapa = 0;
    } else if (novaMidia.doc_frente && (state.etapa === "doc" || state.etapa === "foto_conta")) {
      state.etapa = customer.email ? "finalizando" : "email";
      state.tentativas_etapa = 0;
    }
  }

  const knownFacts: string[] = [];
  if (customer.name) knownFacts.push(`Nome: ${customer.name}`);
  if (customer.email) knownFacts.push(`E-mail: ${customer.email}`);
  if (customer.electricity_bill_value) knownFacts.push(`Valor da conta: R$ ${Number(customer.electricity_bill_value).toFixed(2)}`);
  if (customer.address_city) knownFacts.push(`Cidade: ${customer.address_city}`);
  if (customer.address_state) knownFacts.push(`Estado: ${customer.address_state}`);
  if (customer.distribuidora) knownFacts.push(`Distribuidora: ${customer.distribuidora}`);
  if (state.midia_recebida?.conta) knownFacts.push(`Foto da conta: já recebida ✅`);
  if (state.midia_recebida?.doc_frente) knownFacts.push(`Documento (frente): já recebido ✅`);
  for (const [k, v] of Object.entries(state.info || {})) {
    if (v) knownFacts.push(`${k}: ${v}`);
  }
  const knownFactsText = knownFacts.length
    ? `# Dados já confirmados (NÃO pergunte de novo)\n- ${knownFacts.join("\n- ")}`
    : "";

  // 2. Perfilador
  const perfil = await perfilar(historyText, inboundText);

  // 3. Planner
  const plano = await planejar({
    state,
    perfil,
    inboundText,
    history: historyText,
    knownFacts,
  });

  // Atualiza estado intermediário
  const stateBefore = { ...state };
  state.perfil = perfil.perfil;
  state.ultimo_perfil = perfil;
  state.temperatura_max = Math.max(state.temperatura_max || 0, perfil.temperatura);
  if (plano.etapa_atual !== state.etapa) {
    state.etapa = plano.etapa_atual;
    state.tentativas_etapa = 0;
  } else {
    state.tentativas_etapa = (state.tentativas_etapa || 0) + 1;
  }
  state.ultima_jogada = plano.proxima_jogada;

  // 4. RAG
  const ragQuery = `${inboundText}\n${plano.proxima_jogada} ${plano.objecao_a_tratar || ""}`;
  const ragChunks = await buscarContexto({
    supabase,
    consultantId: customer.consultant_id,
    etapa: plano.etapa_atual,
    query: ragQuery,
  });
  const ragText = formatChunks(ragChunks);

  // 5. Writer
  const memoryText = formatMemory(memory);
  let writerResult = await escrever({
    representante: consultant.name || "Rafael",
    nomeLead: customer.name || null,
    valorConta: typeof customer.electricity_bill_value === "number" ? customer.electricity_bill_value : null,
    history: historyMsgs,
    inboundText,
    perfil,
    plano,
    ragText,
    memoryText,
    knownFactsText,
    basePersona: consultant.ai_persona_fluxo_b || null,
  });
  let writerText = sanitize(writerResult.text);

  // 6. Crítico — bloqueia mensagens reprovadas (até 1 retry forçado, senão fallback determinístico)
  let critico = await criticar({
    texto: writerText,
    perfil,
    jaTemHistorico: historyMsgs.length > 0,
    plano,
    nomeLead: customer.name || null,
  });
  if (!critico.aprovado) {
    const problemas = critico.problemas.join("; ") || "não atende às regras";
    const hint = critico.sugestao ? `Sugestão: "${critico.sugestao}".` : "";
    try {
      const retry = await escrever({
        representante: consultant.name || "Rafael",
        nomeLead: customer.name || null,
        valorConta: typeof customer.electricity_bill_value === "number" ? customer.electricity_bill_value : null,
        history: historyMsgs,
        inboundText: `${inboundText}\n\n[CORREÇÃO INTERNA OBRIGATÓRIA: sua resposta anterior foi REPROVADA por: ${problemas}. ${hint} Reescreva seguindo a TRAVA DA ETAPA e o plano. NÃO repita o erro.]`,
        perfil,
        plano,
        ragText,
        memoryText,
        knownFactsText,
        basePersona: consultant.ai_persona_fluxo_b || null,
      });
      writerResult = retry;
      writerText = sanitize(retry.text);
    } catch {/* mantém writerText original */}

    // Reavalia. Se reprovou de novo, usa fallback determinístico por etapa.
    const critico2 = await criticar({
      texto: writerText,
      perfil,
      jaTemHistorico: historyMsgs.length > 0,
      plano,
      nomeLead: customer.name || null,
    });
    if (!critico2.aprovado) {
      writerText = sanitize(critico2.sugestao || fallbackPorEtapa(plano.etapa_atual, customer.name));
      critico = { aprovado: false, problemas: [...critico.problemas, ...critico2.problemas].slice(0, 5) };
    } else {
      critico = critico2;
    }
  }



  // 7. Aplica tool calls
  const toolsApplied: string[] = [];
  const updates: Record<string, any> = {};
  let conversationStepUpdate: string | null = STEP_BY_ETAPA[plano.etapa_atual] || null;
  let shouldHandoff = false;
  let pediuFinalizar = false;

  for (const tc of writerResult.toolCalls) {
    toolsApplied.push(tc.name);
    try {
      if (tc.name === "registrar_nome" && tc.arguments?.nome) {
        const nome = String(tc.arguments.nome).trim().slice(0, 80);
        if (nome) { updates.name = nome; updates.name_source = "vendedora_v1"; }
      } else if (tc.name === "registrar_valor_conta" && typeof tc.arguments?.valor === "number") {
        const v = Number(tc.arguments.valor);
        if (v > 0 && v < 100000) updates.electricity_bill_value = v;
      } else if (tc.name === "registrar_email" && tc.arguments?.email) {
        const email = String(tc.arguments.email).trim().toLowerCase().slice(0, 120);
        if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          updates.email = email;
          // após capturar o e-mail, etapa avança pra finalizando
          if (state.etapa === "email" || state.etapa === "doc") {
            state.etapa = "finalizando";
            state.tentativas_etapa = 0;
            conversationStepUpdate = "cadastro_finalizando";
          }
        }
      } else if (tc.name === "confirmar_telefone" && tc.arguments?.telefone) {
        const tel = String(tc.arguments.telefone).replace(/\D/g, "").slice(0, 14);
        if (tel.length >= 10) updates.phone_whatsapp = tel;
      } else if (tc.name === "registrar_info" && tc.arguments?.campo && tc.arguments?.valor) {
        const campo = String(tc.arguments.campo).trim().toLowerCase().slice(0, 40);
        const valor = String(tc.arguments.valor).trim().slice(0, 200);
        state.info[campo] = valor;
        if (campo === "cidade") updates.address_city = valor;
        if (campo === "estado") updates.address_state = valor;
        if (campo === "distribuidora") updates.distribuidora = valor;
      } else if (tc.name === "registrar_objecao_tratada" && tc.arguments?.tipo) {
        const tipo = String(tc.arguments.tipo).trim().toLowerCase().slice(0, 40);
        if (tipo && !state.objecoes_tratadas.includes(tipo)) state.objecoes_tratadas.push(tipo);
      } else if (tc.name === "pedir_foto_conta") {
        conversationStepUpdate = "aguardando_conta";
        state.etapa = "foto_conta";
      } else if (tc.name === "pedir_documento") {
        conversationStepUpdate = "aguardando_documento";
        state.etapa = "doc";
      } else if (tc.name === "finalizar_cadastro") {
        pediuFinalizar = true;
        conversationStepUpdate = "cadastro_finalizando";
        state.etapa = "finalizando";
      } else if (tc.name === "agendar_followup" && tc.arguments?.quando_iso) {
        const iso = String(tc.arguments.quando_iso);
        // Coluna do banco é next_followup_at; mantém compat com followup_at se existir
        updates.next_followup_at = iso;
        updates.followup_hook = String(tc.arguments?.gancho || "").slice(0, 240);
      } else if (tc.name === "marcar_quente") {
        updates.lead_priority = "hot";
      } else if (tc.name === "pedir_humano_proativo" || tc.name === "escalar_humano") {
        shouldHandoff = true;
        updates.bot_paused = true;
        updates.bot_paused_reason = String(tc.arguments?.motivo || tc.name).slice(0, 200);
        updates.bot_paused_at = new Date().toISOString();
      }
    } catch (e) {
      console.warn(`[vendedora-v1] tool ${tc.name} falhou:`, (e as Error).message);
    }
  }

  // Tentativas demais → forçar troca de gancho ou humano
  if (state.tentativas_etapa >= 4 && !shouldHandoff) {
    shouldHandoff = true;
    updates.bot_paused = true;
    updates.bot_paused_reason = `vendedora_v1: ${state.tentativas_etapa} tentativas na etapa ${state.etapa}`;
    updates.bot_paused_at = new Date().toISOString();
  }

  if (conversationStepUpdate) updates.conversation_step = conversationStepUpdate;
  updates.fluxo_b_state = state;

  // Fallback de texto
  const reply = writerText || buildFallback(state.etapa, customer, updates);

  // Persiste customer
  if (Object.keys(updates).length > 0) {
    updates.updated_at = new Date().toISOString();
    await supabase.from("customers").update(updates).eq("id", customerId);
  } else {
    await writeState(supabase, customerId, state);
  }

  // 8. Fecha cadastro de verdade
  // Dispara `finalize-capture` quando:
  //  - o Writer pediu via tool `finalizar_cadastro`; OU
  //  - a etapa virou `finalizando` (via mídia ou e-mail); OU
  //  - o checklist mínimo da IA já está completo (atalho oportunista).
  let closerResult: Awaited<ReturnType<typeof tentarFechar>> | null = null;
  const checklist = checklistMinimo({ ...customer, ...updates });
  const deveTentar = pediuFinalizar || state.etapa === "finalizando" || checklist.pronto;
  if (deveTentar && !shouldHandoff) {
    closerResult = await tentarFechar(supabase, customerId);
    if (closerResult.ok && closerResult.acionou) {
      // Sucesso real — atualiza step (finalize-capture já marcou portal_submitting)
      updates.conversation_step = "portal_submitting";
    } else if (!closerResult.ok && closerResult.portalMissing?.length) {
      // Portal rejeitou — pausa bot pra humano corrigir
      shouldHandoff = true;
      await supabase.from("customers").update({
        bot_paused: true,
        bot_paused_reason: `vendedora_v1: cadastro incompleto pelo portal — ${closerResult.portalMissing.slice(0, 4).join(", ")}`,
        bot_paused_at: new Date().toISOString(),
      }).eq("id", customerId);
    }
  }

  // Logging
  try {
    await supabase.from("ai_decisions").insert({
      consultant_id: customer.consultant_id,
      customer_id: customerId,
      phase: "vendedora_v1",
      tool_called: toolsApplied.join(",") || null,
      model: writerResult.modelUsed,
      user_input: inboundText.slice(0, 500),
      ai_output: {
        text: reply.slice(0, 500),
        tools: toolsApplied,
        perfil,
        plano,
        rag_chunks: ragChunks.length,
        critico_aprovado: critico.aprovado,
        critico_problemas: critico.problemas,
        state_before: stateBefore,
        state_after: state,
      },
      step_before: customer.conversation_step || null,
      step_after: conversationStepUpdate,
      latency_ms: Date.now() - t0,
      source: "vendedora_v1",
    });
  } catch (_) { /* best-effort */ }

  // Memória — fire and forget
  void atualizarMemoria({
    supabase,
    customerId,
    memoriaAtual: memory,
    history: historyText,
    inbound: inboundText,
    reply,
  });

  return {
    reply,
    toolsApplied,
    conversationStepUpdate,
    shouldHandoff,
    modelUsed: writerResult.modelUsed,
    latencyMs: Date.now() - t0,
    customerUpdates: updates,
    debug: {
      perfil,
      plano,
      ragChunks: ragChunks.length,
      criticoAprovado: critico.aprovado,
      criticoProblemas: critico.problemas,
      stateBefore,
      stateAfter: state,
      checklist,
      closer: closerResult,
    },
  };
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

function buildFallback(etapa: Etapa, customer: any, updates: Record<string, any>): string {
  if (etapa === "interesse" || etapa === "nome") {
    if (!customer.name && !updates.name) {
      return "Pra eu fazer sua simulação de economia, qual é seu nome completo?";
    }
  }
  if (etapa === "valor" && !customer.electricity_bill_value && !updates.electricity_bill_value) {
    return "Qual o valor médio mensal da sua conta de luz? Assim já te mostro quanto vai economizar ⚡";
  }
  if (etapa === "foto_conta") return "Pode me enviar a foto ou PDF da sua última conta de luz? 📷";
  if (etapa === "doc") return "Agora só preciso da foto da frente do seu RG ou CNH pra finalizar 📄";
  if (etapa === "email") return "Última info: me passa seu melhor e-mail pra eu travar seu cadastro 📧";
  if (etapa === "finalizando") return "Tudo pronto! Estou finalizando seu cadastro agora ✅";
  return "Bora seguir com seu cadastro? Me confirma a próxima informação que pedi.";
}
