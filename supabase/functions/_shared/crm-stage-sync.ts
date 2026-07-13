// Sincroniza o estágio do deal no Kanban com base no conversation_step
// do customer. Chamado pelos webhooks (whapi + evolution) após cada mudança
// de step. Nunca rebaixa o deal e nunca toca em estágios pós-aprovação.

// Mapa estável: conversation_step (legacy) → stage_key alvo.
const LEGACY_STEP_TO_STAGE: Record<string, string> = {
  // novo_lead — não mexe
  welcome: "novo_lead",
  aguardando_nome: "novo_lead",

  // qualificando (já temos o nome, aguardando valor da conta)
  aguardando_valor_conta: "qualificando",
  ask_email: "doc_enviado",
  ask_phone_confirm: "doc_enviado",

  // valor_conta (lead já informou ou estamos pedindo a conta)
  aguardando_conta: "valor_conta",

  // conta_enviada (OCR rodou, pedindo doc)
  aguardando_doc_auto: "conta_enviada",
  aguardando_documento: "conta_enviada",

  // doc_enviado (confirmando dados)
  confirmando_dados_conta: "doc_enviado",
  confirmando_dados: "doc_enviado",

  // finalizando (envio final ao portal / pós-cadastro aguardando análise)
  finalizando: "finalizando",
  finalizando_cadastro: "finalizando",
  portal_submitting: "finalizando",
  aguardando_otp: "finalizando",
  validando_otp: "finalizando",
  cadastro_em_analise: "finalizando",
  aguardando_assinatura: "finalizando",
  aguardando_facial: "finalizando",
  complete: "finalizando",
};

// Mapa para step_type de bot_flow_steps (passos custom flow:UUID).
const FLOW_STEP_TYPE_TO_STAGE: Record<string, string> = {
  capture_nome: "qualificando",
  capture_valor: "qualificando",
  capture_conta: "valor_conta",
  capture_documento: "conta_enviada",
  capture_doc: "conta_enviada",
  capture_email: "doc_enviado",
  confirm_phone: "doc_enviado",
  finalizar_cadastro: "finalizando",
};

// Estágios "ativos do funil" — únicos onde podemos atuar.
// Nunca tocamos em aprovado/reprovado/30/60/90/120.
const ACTIVE_FUNNEL_STAGES = new Set([
  "novo_lead",
  "qualificando",
  "valor_conta",
  "conta_enviada",
  "doc_enviado",
  "finalizando",
]);

// Ordem do funil (menor = mais cedo). Usado para nunca rebaixar.
const STAGE_ORDER: Record<string, number> = {
  novo_lead: 0,
  qualificando: 1,
  valor_conta: 2,
  conta_enviada: 3,
  doc_enviado: 4,
  finalizando: 5,
};

async function resolveTargetStage(
  supabase: any,
  conversationStep: string | null | undefined,
): Promise<string | null> {
  if (!conversationStep) return null;

  // 1) Custom flow: prefixo "flow:UUID" ou UUID puro.
  const flowMatch = conversationStep.match(/^(?:flow:)?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
  if (flowMatch) {
    const stepId = flowMatch[1];
    const { data } = await supabase
      .from("bot_flow_steps")
      .select("step_type")
      .eq("id", stepId)
      .maybeSingle();
    if (data?.step_type) {
      return FLOW_STEP_TYPE_TO_STAGE[data.step_type] ?? null;
    }
    return null;
  }

  // 2) Step legado.
  return LEGACY_STEP_TO_STAGE[conversationStep] ?? null;
}

export async function syncDealStageFromStep(
  supabase: any,
  customerId: string | null | undefined,
  conversationStep: string | null | undefined,
): Promise<void> {
  if (!customerId || !conversationStep) return;

  try {
    const targetStage = await resolveTargetStage(supabase, conversationStep);
    if (!targetStage) return;
    if (!ACTIVE_FUNNEL_STAGES.has(targetStage)) return;

    // Busca o deal mais recente do customer.
    const { data: deal } = await supabase
      .from("crm_deals")
      .select("id, stage")
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!deal) return;

    const currentStage = deal.stage as string;

    // Guard 1: só atua em deals que estão num estágio ativo do funil.
    if (!ACTIVE_FUNNEL_STAGES.has(currentStage)) return;

    // Guard 2: nunca rebaixa.
    const currentOrder = STAGE_ORDER[currentStage] ?? 0;
    const targetOrder = STAGE_ORDER[targetStage] ?? 0;
    if (targetOrder <= currentOrder) return;

    // Atualiza.
    const { error } = await supabase
      .from("crm_deals")
      .update({ stage: targetStage })
      .eq("id", deal.id);

    if (error) {
      console.error(`[crm-stage] update failed customer=${customerId}:`, error.message);
      return;
    }

    console.log(`[crm-stage] customer=${customerId} step=${conversationStep} deal=${deal.id} ${currentStage} → ${targetStage}`);
  } catch (e) {
    console.error(`[crm-stage] error customer=${customerId}:`, (e as Error).message);
  }
}

// Export interno para teste.
export const __test = { LEGACY_STEP_TO_STAGE, FLOW_STEP_TYPE_TO_STAGE, ACTIVE_FUNNEL_STAGES, STAGE_ORDER, resolveTargetStage };
