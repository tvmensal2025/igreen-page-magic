/**
 * N8 — Estado / Memória (pt-BR).
 *
 * Spec: `.kiro/specs/cerebro-ia/design.md` — peça N8.
 *
 * Lê e atualiza o estado do cliente CAMPO A CAMPO, preservando os demais
 * campos (Requisito 5.2), e registra o histórico de checkpoints para
 * diagnóstico (Requisito 5.3). REUSA `loadFlowState`, `customer_flow_state`,
 * `fluxo_b_state` e `conversation_summary` — sem tabela nova (Requisito 17.1,
 * 20.2). Organiza a memória em camadas (sessão/perfil/operacional/conteúdo).
 *
 * IMPORTANTE (Tarefa 1): apenas as assinaturas dos contratos. A leitura e a
 * escrita reais entram na Tarefa 2.
 */

import type {
  ConfirmacaoEscritaEstado,
  CustomerSnapshot,
  EntradaEscritaEstado,
  EntradaLeituraEstado,
  EstadoCerebro,
  MemoriaEmCamadas,
} from "./tipos.ts";

// REÚSO (Requisito 5.1, 20.2): a leitura do estado canônico passa pelo helper
// já testado `loadFlowState`, e a escrita campo a campo passa por
// `persistFlowState` (UPDATE atômico que só toca os campos informados,
// preservando os demais — Requisito 5.2). O Cérebro NÃO duplica essa lógica
// nem cria tabela nova.
import { loadFlowState, persistFlowState } from "../customer-flow-state.ts";
import type { PersistFlowStateInput } from "../customer-flow-state.ts";

// Campos estáveis e de memória que o helper do motor não traz, mas que as
// camadas de memória precisam. Lidos numa única consulta a `customers`.
// `fluxo_b_state` e `conversation_summary` são colunas REAIS já existentes.
const COLUNAS_MEMORIA_CLIENTE =
  "id, consultant_id, name, electricity_bill_value, distribuidora, " +
  "address_state, email, sales_phase, conversation_step, " +
  "document_uploaded, otp_validated_at, phone_whatsapp, " +
  "conversation_summary, fluxo_b_state";

/**
 * Lê o estado consolidado do cliente e organiza a memória em camadas
 * (Requisito 5.1, 5.4, 20.1, 20.2, 20.3).
 *
 * Reúso obrigatório, sem tabela nova:
 *   - estado canônico  → `loadFlowState` (`customer_flow_state` + subset de `customers`);
 *   - memória de sessão → `customers.conversation_summary`;
 *   - memória operacional (cadastro/pendências) → coluna `customers.fluxo_b_state`.
 *
 * Fail-open (herdando a postura do `loadFlowState`): qualquer falha de leitura
 * resulta num snapshot mínimo de cliente novo, SEM reiniciar cadastro de quem
 * já estava em andamento (a memória operacional ainda é preenchida a partir de
 * `fluxo_b_state` quando disponível).
 *
 * @param entrada Cliente do Supabase e id do cliente.
 * @returns Snapshot do estado e memória em camadas (sessão/perfil/operacional).
 */
export async function lerEstado(
  entrada: EntradaLeituraEstado,
): Promise<EstadoCerebro> {
  const { supabase, customerId } = entrada;

  // 1) Estado canônico via helper reusado. Pode ser null para leads legados
  //    (sem linha em `customer_flow_state`) — tratado como cliente novo adiante.
  const flowState = await loadFlowState(supabase, customerId);

  // 2) Campos de memória/perfil numa única leitura. Best-effort: em erro,
  //    seguimos só com o que o estado canônico trouxe.
  let clienteRow: Record<string, unknown> = {};
  try {
    const { data } = await supabase
      .from("customers")
      .select(COLUNAS_MEMORIA_CLIENTE)
      .eq("id", customerId)
      .maybeSingle();
    if (data && typeof data === "object") {
      clienteRow = data as Record<string, unknown>;
    }
  } catch (e) {
    console.warn(
      "[cerebro/estado] lerEstado: leitura de customers falhou:",
      (e as { message?: string })?.message,
    );
  }

  // 3) Monta o snapshot a partir do estado canônico; sem ele, cria o de um
  //    cliente novo (Requisito 5.4 — não reinicia cadastro de quem tem memória
  //    operacional em `fluxo_b_state`, apenas não tem fluxo v3 ainda).
  const snapshot = flowState
    ? snapshotDeFlowState(flowState, clienteRow)
    : snapshotDeClienteNovo(customerId, clienteRow);

  // 4) Organiza a memória em camadas separadas (Requisito 20.1).
  const memoria = montarMemoriaEmCamadas(clienteRow, snapshot);

  return { snapshot, memoria };
}

/** Estados do helper que o snapshot do motor não representa (mapeados). */
function normalizarStatus(
  status: string | null | undefined,
): CustomerSnapshot["status"] {
  // `delegated_legacy` existe em `customer_flow_state` mas não no snapshot do
  // motor; tratamos como pausa de sistema para não inventar um estado novo.
  if (!status || status === "delegated_legacy") return "paused_system";
  return status as CustomerSnapshot["status"];
}

/** Converte o estado canônico (`EngineCustomerState`) no `CustomerSnapshot`. */
function snapshotDeFlowState(
  flowState: NonNullable<Awaited<ReturnType<typeof loadFlowState>>>,
  clienteRow: Record<string, unknown>,
): CustomerSnapshot {
  return {
    customerId: flowState.customerId,
    // `consultantId` vive no topo do snapshot do Cérebro; o helper o expõe
    // dentro de `customer`. Caímos para a coluna `customers.consultant_id`.
    consultantId:
      flowState.customer.consultantId ??
      (clienteRow.consultant_id as string | null) ??
      "",
    flowId: flowState.flowId,
    currentStepId: flowState.currentStepId,
    status: normalizarStatus(flowState.status),
    pauseReason: flowState.pauseReason,
    retries: flowState.retries,
    // O helper não seleciona estes campos; mantemos os defaults seguros.
    aiQuestionsThisStep: 0,
    enteredStepAt: flowState.enteredStepAt,
    expiresAt: flowState.expiresAt,
    lastInboundAt: flowState.lastInboundAt,
    lastOutboundAt: flowState.lastOutboundAt,
    lastOutboundContentHash: null,
    customer: {
      name: flowState.customer.name,
      electricityBillValue: flowState.customer.electricityBillValue,
      documentUploaded: flowState.customer.documentUploaded,
      otpValidatedAt: flowState.customer.otpValidatedAt,
      phoneWhatsapp: flowState.customer.phoneWhatsapp,
    },
  };
}

/**
 * Snapshot de cliente sem estado canônico (lead legado/novo). Não reinicia
 * cadastro: apenas marca `status: "new"` e `currentStepId: null`; a memória
 * operacional segue vindo de `fluxo_b_state` (Requisito 5.4).
 */
function snapshotDeClienteNovo(
  customerId: string,
  clienteRow: Record<string, unknown>,
): CustomerSnapshot {
  const agora = new Date().toISOString();
  return {
    customerId,
    consultantId: (clienteRow.consultant_id as string | null) ?? "",
    flowId: "",
    currentStepId: null,
    status: "new",
    pauseReason: null,
    retries: 0,
    aiQuestionsThisStep: 0,
    enteredStepAt: agora,
    expiresAt: null,
    lastInboundAt: null,
    lastOutboundAt: null,
    lastOutboundContentHash: null,
    customer: {
      name: (clienteRow.name as string | null) ?? null,
      electricityBillValue:
        (clienteRow.electricity_bill_value as number | null) ?? null,
      documentUploaded: !!clienteRow.document_uploaded,
      otpValidatedAt: (clienteRow.otp_validated_at as string | null) ?? null,
      phoneWhatsapp: (clienteRow.phone_whatsapp as string | null) ?? null,
    },
  };
}

/**
 * Lê `fluxo_b_state` de forma defensiva (Requisito 5.4 — estado corrompido não
 * derruba a leitura). Sem duplicar o parser da vendedora: aqui só garantimos
 * que o valor é um objeto; senão, devolvemos `{}`.
 */
function lerFluxoBState(valor: unknown): Record<string, unknown> {
  if (valor && typeof valor === "object" && !Array.isArray(valor)) {
    return valor as Record<string, unknown>;
  }
  return {};
}

/**
 * Organiza a memória em camadas separadas (Requisito 20.1, 20.3):
 *   - sessão:      resumo da conversa atual (`conversation_summary`);
 *   - perfil:      dados estáveis do cliente;
 *   - operacional: cadastro, pendências e próximos passos (`fluxo_b_state` +
 *                  posição no fluxo v3).
 *
 * A base de conteúdo institucional (`ai_knowledge_sections`) NÃO entra aqui —
 * permanece consultada via RAG pelo Escritor (Requisito 20.2/20.3).
 */
function montarMemoriaEmCamadas(
  clienteRow: Record<string, unknown>,
  snapshot: CustomerSnapshot,
): MemoriaEmCamadas {
  const fluxoB = lerFluxoBState(clienteRow.fluxo_b_state);

  const sessao =
    typeof clienteRow.conversation_summary === "string"
      ? (clienteRow.conversation_summary as string)
      : null;

  const perfil: Record<string, unknown> = {
    name: snapshot.customer.name,
    electricityBillValue: snapshot.customer.electricityBillValue,
    distribuidora: clienteRow.distribuidora ?? null,
    addressState: clienteRow.address_state ?? null,
    email: clienteRow.email ?? null,
    salesPhase: clienteRow.sales_phase ?? null,
    phoneWhatsapp: snapshot.customer.phoneWhatsapp,
  };

  const operacional: Record<string, unknown> = {
    // Posição no fluxo v3 (fonte canônica de etapa, Requisito 6.4).
    currentStepId: snapshot.currentStepId,
    status: snapshot.status,
    retries: snapshot.retries,
    documentUploaded: snapshot.customer.documentUploaded,
    otpValidatedAt: snapshot.customer.otpValidatedAt,
    // Etapa antiga, usada pela migração de clientes em conversa (Tarefa 12).
    conversationStep: clienteRow.conversation_step ?? null,
    // Estado operacional legado (cadastro/pendências) preservado cru.
    fluxoBState: fluxoB,
  };

  return { sessao, perfil, operacional };
}

/**
 * Mapeia os campos do `patch` (subset de `CustomerSnapshot`) para os nomes da
 * entrada de `persistFlowState`. Só inclui as chaves PRESENTES no patch, para
 * que o UPDATE atômico toque apenas o que mudou e preserve o resto
 * (Requisito 5.2). Os subcampos `customer.*` do snapshot são espelho
 * somente-leitura de `customers` (sincronizados pelo motor/trigger) e NÃO são
 * escritos aqui — esta peça cuida apenas do estado canônico em
 * `customer_flow_state`.
 *
 * @returns A entrada do helper e a lista de nomes de campo alterados.
 */
function mapearPatchParaPersist(
  customerId: string,
  patch: Partial<CustomerSnapshot>,
): { input: PersistFlowStateInput; camposAlterados: string[] } {
  const input: PersistFlowStateInput = { customerId };
  const camposAlterados: string[] = [];

  // Cada campo é copiado SOMENTE quando explicitamente presente no patch
  // (checagem por `in`/`!== undefined`), preservando os demais (Requisito 5.2).
  if (patch.flowId !== undefined) {
    input.flowId = patch.flowId;
    camposAlterados.push("flowId");
  }
  if (patch.currentStepId !== undefined) {
    input.currentStepId = patch.currentStepId;
    camposAlterados.push("currentStepId");
  }
  if (patch.status !== undefined) {
    // O tipo de `status` do snapshot é subconjunto do aceito pelo helper.
    input.status = patch.status as PersistFlowStateInput["status"];
    camposAlterados.push("status");
  }
  if (patch.pauseReason !== undefined) {
    input.pauseReason = patch.pauseReason as PersistFlowStateInput["pauseReason"];
    camposAlterados.push("pauseReason");
  }
  if (patch.retries !== undefined) {
    input.retries = patch.retries;
    camposAlterados.push("retries");
  }
  if (patch.aiQuestionsThisStep !== undefined) {
    input.aiQuestionsThisStep = patch.aiQuestionsThisStep;
    camposAlterados.push("aiQuestionsThisStep");
  }
  if (patch.enteredStepAt !== undefined) {
    input.enteredStepAt = patch.enteredStepAt;
    camposAlterados.push("enteredStepAt");
  }
  if (patch.expiresAt !== undefined) {
    input.expiresAt = patch.expiresAt;
    camposAlterados.push("expiresAt");
  }
  if (patch.lastInboundAt !== undefined) {
    input.lastInboundAt = patch.lastInboundAt;
    camposAlterados.push("lastInboundAt");
  }
  if (patch.lastOutboundAt !== undefined) {
    input.lastOutboundAt = patch.lastOutboundAt;
    camposAlterados.push("lastOutboundAt");
  }

  return { input, camposAlterados };
}

/**
 * Registra a alteração de estado no histórico de checkpoints para diagnóstico
 * (Requisito 5.3). REÚSO: grava em `engine_logs` — o log estruturado já
 * existente (append-only) que alimenta as métricas de rollout —, sem criar
 * tabela nova (Requisito 17.1). Usa o `kind` próprio do Cérebro
 * `cerebro_state_checkpoint`.
 *
 * `engine_logs.flow_id` é NOT NULL com FK para `bot_flows`. Quando o cliente
 * ainda não tem fluxo associado (lead legado), seguimos a mesma postura do
 * `migrate-engine-v3`: pulamos a gravação do checkpoint em vez de sintetizar
 * uma `flow_id` falsa. Best-effort: nunca lança (o diagnóstico não pode
 * derrubar a escrita do estado).
 */
async function registrarCheckpoint(
  supabase: EntradaEscritaEstado["supabase"],
  customerId: string,
  flowId: string | null,
  patch: Partial<CustomerSnapshot>,
  camposAlterados: string[],
): Promise<void> {
  // Sem fluxo válido não há âncora para o log (FK NOT NULL). Pula sem erro.
  if (!flowId) return;

  try {
    await supabase.from("engine_logs").insert({
      at: new Date().toISOString(),
      kind: "cerebro_state_checkpoint",
      customer_id: customerId,
      flow_id: flowId,
      step_id: null,
      payload: {
        // Apenas os campos alterados e seus novos valores — suficiente para
        // reconstruir o "antes/depois" em diagnóstico sem inchar o log.
        camposAlterados,
        patch: patch as Record<string, unknown>,
      },
    });
  } catch (e) {
    console.warn(
      "[cerebro/estado] registrarCheckpoint: falha ao gravar engine_logs:",
      (e as { message?: string })?.message,
    );
  }
}

/**
 * Atualiza o estado do cliente CAMPO A CAMPO, preservando os demais campos
 * (Requisito 5.2), e registra a alteração no histórico de checkpoints para
 * diagnóstico (Requisito 5.3).
 *
 * Reúso obrigatório, sem tabela nova:
 *   - escrita do estado canônico → `persistFlowState` (UPDATE atômico que só
 *     toca os campos informados);
 *   - hash do último envio (`lastOutboundContentHash`) → atualização separada
 *     na coluna `customer_flow_state.last_outbound_content_hash` (mesmo padrão
 *     do dispatcher, pois o campo fica fora da superfície de `persistFlowState`);
 *   - histórico de checkpoint → `engine_logs` (kind `cerebro_state_checkpoint`).
 *
 * Quando o patch vem vazio (nada a alterar), a escrita é um no-op de sucesso e
 * nenhum checkpoint é gravado.
 *
 * @param entrada Cliente do Supabase, id do cliente e o patch a aplicar.
 * @returns Confirmação da escrita e a lista de campos alterados.
 */
export async function atualizarEstado(
  entrada: EntradaEscritaEstado,
): Promise<ConfirmacaoEscritaEstado> {
  const { supabase, customerId, patch } = entrada;

  if (!customerId) {
    return { ok: false, camposAlterados: [] };
  }

  // 1) Mapeia o patch para os campos do estado canônico (só os presentes).
  const { input, camposAlterados } = mapearPatchParaPersist(customerId, patch);

  // O hash do último envio fica fora de `persistFlowState`; tratamos à parte.
  const alteraHash = patch.lastOutboundContentHash !== undefined;

  // Nada a alterar: no-op de sucesso, sem checkpoint (Requisito 5.2/5.3).
  if (camposAlterados.length === 0 && !alteraHash) {
    return { ok: true, camposAlterados: [] };
  }

  // 2) Escrita campo a campo do estado canônico (UPDATE atômico que preserva
  //    os demais campos). Só chamamos quando há campos do helper para tocar.
  let ok = true;
  if (camposAlterados.length > 0) {
    ok = await persistFlowState(supabase, input);
  }

  // 3) Hash do último envio: atualização separada e best-effort, espelhando o
  //    dispatcher. Não derruba o resultado se falhar isoladamente.
  if (alteraHash) {
    try {
      const { error } = await supabase
        .from("customer_flow_state")
        .update({ last_outbound_content_hash: patch.lastOutboundContentHash })
        .eq("customer_id", customerId);
      if (error) {
        console.warn(
          "[cerebro/estado] atualizarEstado: update de last_outbound_content_hash falhou:",
          error.message,
        );
        ok = false;
      } else {
        camposAlterados.push("lastOutboundContentHash");
      }
    } catch (e) {
      console.warn(
        "[cerebro/estado] atualizarEstado: exceção em last_outbound_content_hash:",
        (e as { message?: string })?.message,
      );
      ok = false;
    }
  }

  // 4) Histórico de checkpoint para diagnóstico (Requisito 5.3). Precisa de uma
  //    `flow_id` válida como âncora: usa a do patch quando presente, senão lê o
  //    estado atual via helper reusado. Best-effort — não afeta `ok`.
  if (camposAlterados.length > 0) {
    let flowId = patch.flowId ?? null;
    if (!flowId) {
      const atual = await loadFlowState(supabase, customerId);
      flowId = atual?.flowId ?? null;
    }
    await registrarCheckpoint(supabase, customerId, flowId, patch, camposAlterados);
  }

  return { ok, camposAlterados };
}
