// Vendedora v2 — orquestrador (state machine pura).
// Coexiste com runVendedoraV1 em index.ts.
//
// Pipeline:
//   1. carregaContexto (customer/consultant/history/state/memory)
//   2. detectaMidiaNova (mesma lógica da v1)
//   3. etapa = decideEtapa(customer, state)            // determinística
//   4. extractors (nome / valor / email / interesse)   // tools forçadas
//   5. re-decide etapa após extração
//   6. handler[etapa] roda (template OU writer micro)
//   7. crítico apenas em RICH_ETAPAS
//   8. aplica updates + state + ai_decisions
//   9. se finalizando → tentarFechar (closer.ts)

import type { ChatMsg } from "./gateway.ts";
import { readState } from "./state.ts";
import { atualizarMemoria, formatMemory, readMemory } from "./memory.ts";
import { tentarFechar, detectarMidiaNova, checklistMinimo } from "./closer.ts";
import { perfilar } from "./perfilador.ts";
import { buscarContexto, formatChunks } from "./rag.ts";
import { criticar } from "./critico.ts";
import { decideEtapa, RICH_ETAPAS } from "./state-machine.ts";
import { extractName, extractValor, extractEmail, extractInteresse } from "./extractors.ts";
import { templatePorEtapa } from "./templates.ts";
import type { Etapa, FluxoBState, PerfilOutput, SupabaseClient } from "./types.ts";

import { interesseHandler } from "./handlers/interesse.ts";
import { nomeHandler } from "./handlers/nome.ts";
import { valorHandler } from "./handlers/valor.ts";
import { simulacaoHandler } from "./handlers/simulacao.ts";
import { confirmacaoHandler } from "./handlers/confirmacao.ts";
import { fotoContaHandler } from "./handlers/foto-conta.ts";
import { docHandler } from "./handlers/doc.ts";
import { emailHandler } from "./handlers/email.ts";
import { finalizandoHandler } from "./handlers/finalizando.ts";
import { posCadastroHandler } from "./handlers/pos-cadastro.ts";
import type { Handler, HandlerCtx } from "./handlers/_types.ts";

export interface VendedoraV2Input {
  supabase: SupabaseClient;
  customerId: string;
  inboundText: string;
  customer?: any;
  consultant?: any;
}

export interface VendedoraV2Result {
  reply: string;
  toolsApplied: string[];
  conversationStepUpdate: string | null;
  shouldHandoff: boolean;
  modelUsed: string;
  latencyMs: number;
  customerUpdates: Record<string, any>;
  debug?: any;
}

const HANDLERS: Record<string, Handler> = {
  interesse: interesseHandler,
  nome: nomeHandler,
  valor: valorHandler,
  simulacao: simulacaoHandler,
  confirmacao: confirmacaoHandler as unknown as Handler,
  foto_conta: fotoContaHandler,
  doc: docHandler,
  email: emailHandler,
  finalizando: finalizandoHandler,
  pos_cadastro: posCadastroHandler,
};

export async function runVendedoraV2(input: VendedoraV2Input): Promise<VendedoraV2Result> {
  const t0 = Date.now();
  const { supabase, customerId, inboundText } = input;

  // 1. Contexto
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
      .eq("id", customer.consultant_id)
      .maybeSingle();
    consultant = data;
  }
  if (!consultant) throw new Error(`[vendedora-v2] consultant não encontrado`);

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
  const stateBefore = { ...state };

  // 2. Mídia nova → avanço determinístico de flags
  const novaMidia = detectarMidiaNova(customer, state);
  if (novaMidia.conta || novaMidia.doc_frente || novaMidia.doc_verso) {
    state.midia_recebida = {
      ...(state.midia_recebida || {}),
      conta: state.midia_recebida?.conta || novaMidia.conta,
      doc_frente: state.midia_recebida?.doc_frente || novaMidia.doc_frente,
      doc_verso: state.midia_recebida?.doc_verso || novaMidia.doc_verso,
    };
    // Se entrou a foto da conta, o lead claramente confirmou interesse.
    if (novaMidia.conta) state.interesse_confirmado = true;
  }

  // 3. Etapa antes da extração
  const etapaAntes = decideEtapa(customer, state);

  // 4. Extractors — tenta capturar dado da mensagem do lead conforme a etapa
  const updates: Record<string, any> = {};
  const toolsApplied: string[] = [];

  if (etapaAntes === "nome") {
    const r = await extractName(inboundText, historyText);
    if (r.nome && r.confianca === "alta") {
      updates.name = r.nome;
      updates.name_source = "vendedora_v2";
      customer = { ...customer, name: r.nome };
      toolsApplied.push("extrair_nome");
    }
  } else if (etapaAntes === "valor") {
    const r = await extractValor(inboundText, historyText);
    if (r.valor != null && r.confianca === "alta") {
      updates.electricity_bill_value = r.valor;
      customer = { ...customer, electricity_bill_value: r.valor };
      toolsApplied.push("extrair_valor");
    }
  } else if (etapaAntes === "email") {
    const r = await extractEmail(inboundText);
    if (r.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email)) {
      updates.email = r.email;
      customer = { ...customer, email: r.email };
      toolsApplied.push("extrair_email");
    }
  } else if (etapaAntes === "confirmacao") {
    const r = await extractInteresse(inboundText, historyText);
    if (r.interessado === true && r.confianca === "alta") {
      state.interesse_confirmado = true;
      toolsApplied.push("extrair_interesse");
    } else if (r.interessado === false && r.confianca === "alta") {
      // recusa explícita → handoff
      const updatesAll = {
        bot_paused: true,
        bot_paused_reason: "vendedora_v2: lead recusou seguir após simulação",
        bot_paused_at: new Date().toISOString(),
      };
      await supabase.from("customers").update(updatesAll).eq("id", customerId);
      return {
        reply: "Sem problema! Se mudar de ideia, é só me chamar 😉",
        toolsApplied: [...toolsApplied, "escalar_humano"],
        conversationStepUpdate: null,
        shouldHandoff: true,
        modelUsed: "template",
        latencyMs: Date.now() - t0,
        customerUpdates: updatesAll,
      };
    }
  }

  // 5. Re-decide etapa após extração
  const etapa = decideEtapa(customer, state);
  if (etapa !== state.etapa) {
    // mapeia confirmacao -> etapa schema (mantém compat: usamos foto_conta)
    state.etapa = (etapa === "confirmacao" ? "simulacao" : etapa) as Etapa;
    state.tentativas_etapa = 0;
  } else {
    state.tentativas_etapa = (state.tentativas_etapa || 0) + 1;
  }

  // 6. Perfilador + RAG paralelos (apenas em etapas ricas)
  let perfil: PerfilOutput | null = null;
  let ragText = "";
  let ragCount = 0;
  if (RICH_ETAPAS.has(etapa)) {
    try {
      const [p, chunks] = await Promise.all([
        perfilar(historyText, inboundText),
        buscarContexto({
          supabase,
          consultantId: customer.consultant_id,
          etapa: state.etapa,
          query: `${inboundText}\n${etapa}`,
        }),
      ]);
      perfil = p;
      ragText = formatChunks(chunks);
      ragCount = chunks.length;
      state.perfil = p.perfil;
      state.ultimo_perfil = p;
      state.temperatura_max = Math.max(state.temperatura_max || 0, p.temperatura);
    } catch (e) {
      console.warn("[v2] perfil/rag paralelo falhou:", (e as Error).message);
    }
  }

  // 7. Handler
  const ctx: HandlerCtx = {
    supabase,
    customerId,
    customer,
    consultant,
    state,
    perfil,
    inboundText,
    historyMsgs,
    historyText,
    memoryText: formatMemory(memory),
    ragText,
    representante: consultant.name || "Rafael",
    nomeLead: customer.name || state.info?.nome || null,
  };
  const handler = HANDLERS[etapa] || HANDLERS["interesse"];
  let result = await handler(ctx);

  // 8. Crítico — apenas em etapas ricas
  if (RICH_ETAPAS.has(etapa) && perfil) {
    try {
      const critico = await criticar({
        texto: result.reply,
        perfil,
        jaTemHistorico: historyMsgs.length > 0,
        nomeLead: ctx.nomeLead,
      });
      if (!critico.aprovado) {
        // Substitui pelo template determinístico — não tenta retry no handler
        // (microWrite já tentou retry internamente).
        result = {
          ...result,
          reply: critico.sugestao || templatePorEtapa(etapa as any, ctx.nomeLead),
        };
      }
    } catch (e) {
      console.warn("[v2] critico falhou:", (e as Error).message);
    }
  }

  // 9. Aplica updates
  Object.assign(updates, result.updates);
  Object.assign(state, result.stateUpdates);
  toolsApplied.push(...result.toolsApplied);

  let shouldHandoff = !!result.handoff;
  if (result.handoff) {
    updates.bot_paused = true;
    updates.bot_paused_reason = `vendedora_v2: ${result.handoff.reason}`;
    updates.bot_paused_at = new Date().toISOString();
  }

  // Tentativas demais → handoff
  if (state.tentativas_etapa >= 4 && !shouldHandoff) {
    shouldHandoff = true;
    updates.bot_paused = true;
    updates.bot_paused_reason = `vendedora_v2: ${state.tentativas_etapa} tentativas na etapa ${etapa}`;
    updates.bot_paused_at = new Date().toISOString();
  }

  const conversationStepUpdate = updates.conversation_step ?? null;
  updates.fluxo_b_state = state;
  updates.updated_at = new Date().toISOString();
  await supabase.from("customers").update(updates).eq("id", customerId);

  // 10. Closer
  let closerResult: Awaited<ReturnType<typeof tentarFechar>> | null = null;
  const checklist = checklistMinimo({ ...customer, ...updates });
  const deveTentar = (result.closerHint || etapa === "finalizando" || checklist.pronto) && !shouldHandoff;
  if (deveTentar) {
    closerResult = await tentarFechar(supabase, customerId);
    if (closerResult.ok && closerResult.acionou) {
      await supabase.from("customers").update({ conversation_step: "portal_submitting" }).eq("id", customerId);
      state.cadastro_finalizado = true;
    } else if (!closerResult.ok && closerResult.portalMissing?.length) {
      shouldHandoff = true;
      await supabase.from("customers").update({
        bot_paused: true,
        bot_paused_reason: `vendedora_v2: cadastro incompleto pelo portal — ${closerResult.portalMissing.slice(0, 4).join(", ")}`,
        bot_paused_at: new Date().toISOString(),
      }).eq("id", customerId);
    }
  }

  // 11. ai_decisions
  try {
    await supabase.from("ai_decisions").insert({
      consultant_id: customer.consultant_id,
      customer_id: customerId,
      phase: "vendedora_v2",
      tool_called: toolsApplied.join(",") || null,
      model: result.modelUsed || "v2",
      user_input: inboundText.slice(0, 500),
      ai_output: {
        text: result.reply.slice(0, 500),
        tools: toolsApplied,
        etapa_antes: etapaAntes,
        etapa_depois: etapa,
        perfil,
        rag_chunks: ragCount,
        state_before: stateBefore,
        state_after: state,
      },
      step_before: customer.conversation_step || null,
      step_after: conversationStepUpdate,
      latency_ms: Date.now() - t0,
      source: "vendedora_v2",
    });
  } catch (_) { /* best-effort */ }

  // Memória — fire and forget
  void atualizarMemoria({
    supabase,
    customerId,
    memoriaAtual: memory,
    history: historyText,
    inbound: inboundText,
    reply: result.reply,
  });

  return {
    reply: result.reply,
    toolsApplied,
    conversationStepUpdate,
    shouldHandoff,
    modelUsed: result.modelUsed || "v2",
    latencyMs: Date.now() - t0,
    customerUpdates: updates,
    debug: {
      etapa_antes: etapaAntes,
      etapa_depois: etapa,
      perfil,
      ragChunks: ragCount,
      stateBefore,
      stateAfter: state,
      checklist,
      closer: closerResult,
    },
  };
}
