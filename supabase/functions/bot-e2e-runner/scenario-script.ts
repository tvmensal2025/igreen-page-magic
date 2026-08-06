/**
 * Roteiro do lead simulado — o que o "cliente de teste" responde em cada passo.
 *
 * Vive fora do `index.ts` para que a edge function e o driver local rodem
 * exatamente o mesmo script. Duas cópias divergindo foi justamente o defeito
 * que deixou esta suíte testando nada (ver `resolveStepKey` abaixo).
 */

export type Reply =
  | { kind: "text"; text: string }
  | { kind: "audio"; transcript: string }
  | { kind: "image"; mime?: string }
  | null;

export const TEST_IMAGE_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAIAAAAC64paAAAAHUlEQVR4nGP8//8/A7mAiWydo5pHNY9qHtVMFc0AnKADJXYG/XsAAAAASUVORK5CYII=";

export type CustomerSnapshot = {
  status?: string | null;
  conversation_step?: string | null;
  bot_paused?: boolean | null;
  electricity_bill_value?: number | null;
  document_type?: string | null;
};

/**
 * `customers.conversation_step` guarda `flow:<uuid>` quando o lead está num passo
 * do construtor. O roteiro raciocina em `step_key` (`a2_text_ask_bill_value`), então
 * sem traduzir o uuid nenhum branch casa e o script responde o default para tudo.
 * Foi assim que a suíte passou a "rodar" sem testar nada: o lead simulado respondia
 * "sim" para "quanto você paga na conta de luz?" até a run morrer por travamento.
 */
export type FlowStepMeta = { stepKey: string; stepType: string };
export type StepIndex = Map<string, FlowStepMeta>;

// deno-lint-ignore no-explicit-any
export async function loadStepIndex(supabase: any, consultantId: string): Promise<StepIndex> {
  const index: StepIndex = new Map();
  try {
    const { data } = await supabase
      .from("bot_flow_steps")
      .select("id, step_key, step_type, bot_flows!inner(consultant_id)")
      .eq("bot_flows.consultant_id", consultantId);
    for (const row of data || []) {
      index.set(String(row.id).toLowerCase(), {
        stepKey: String(row.step_key || "").toLowerCase(),
        stepType: String(row.step_type || "").toLowerCase(),
      });
    }
  } catch (e) {
    console.error("[bot-e2e-runner] loadStepIndex falhou:", e);
  }
  return index;
}

export function cleanStep(step: string | null | undefined, index?: StepIndex): string {
  const raw = String(step || "welcome").replace(/^flow:/, "").toLowerCase();
  return index?.get(raw)?.stepKey || raw;
}

export function stepTypeOf(step: string | null | undefined, index?: StepIndex): string {
  const raw = String(step || "").replace(/^flow:/, "").toLowerCase();
  return index?.get(raw)?.stepType || "";
}

/** Passos que só existem depois que o lead saiu do check-in de abertura. */
export const PROGRESSED_STEPS = new Set([
  // roteiro legado
  "qualificacao",
  "aguardando_conta",
  // variante A viva ("Sofia — Ativação Multicanal")
  "a3_explain_with_buttons",
  "a5b_after_club_buttons",
  "a6_ask_bill_photo",
  "a7_ask_document",
  "a8_ask_email",
  "a9_confirm_phone",
  // variantes D / MG
  "d_pedir_conta",
  "d_como_funciona",
  "d_resultado",
  "d_pedir_documento",
]);

export function nextReply(
  scenario: string,
  customer: CustomerSnapshot | null,
  turn: number,
  stepHits: Record<string, number>,
  opts: { index?: StepIndex; unknown?: Set<string> } = {},
): Reply {
  const s = cleanStep(customer?.conversation_step, opts.index);
  const type = stepTypeOf(customer?.conversation_step, opts.index);
  const hits = stepHits[s] || 0;

  if (scenario === "lead_some" && turn > 4) return null;

  if (s === "welcome") return { kind: "text", text: "oi" };

  // ── Variante A, fluxo vivo do Grupo A ──
  // As respostas de botão usam o número do gatilho porque ele está em
  // `trigger_phrases` junto do id — serve para Whapi (botão) e Evolution (número).
  if (s === "a1_ask_name") return { kind: "text", text: "Joao Silva Teste" };

  if (s === "a2_text_ask_bill_value") {
    if (scenario === "valor_baixo") return { kind: "text", text: "60" };
    if (scenario === "joia_validacao" && hits === 0) return { kind: "text", text: "👍" };
    return { kind: "text", text: "350" };
  }

  if (s === "a3_explain_with_buttons") {
    // Dúvida em texto livre antes de seguir: exercita FAQ/atalhos sem sair do passo.
    if (scenario === "lead_indeciso" && hits === 0) {
      return { kind: "text", text: "é seguro mesmo? tem alguma taxa escondida?" };
    }
    return { kind: "text", text: "2" }; // "Ativar benefício" → a6_ask_bill_photo
  }

  if (s === "a3b_pedir_pergunta") return { kind: "text", text: "como cancelo se eu quiser?" };
  if (s === "a5b_after_club_buttons") return { kind: "text", text: "1" }; // "Ativar benefício"
  if (s === "a6_ask_bill_photo") return { kind: "image", mime: "image/png" };
  if (s === "a7_ask_document") return { kind: "image", mime: "image/png" };
  if (s === "a8_ask_email") return { kind: "text", text: "joao.silva.teste@gmail.com" };
  if (s === "a9_confirm_phone") return { kind: "text", text: "1" }; // "Sim, este número"
  if (s === "a10_portal_otp_facial" || s === "a11_facial_link") return null;

  // ── Variantes D / MG ──
  if (s === "d_welcome") return { kind: "text", text: "quero economizar" };
  if (s === "d_pedir_conta" || s === "d_simular_pedir_conta") return { kind: "image", mime: "image/png" };
  if (s === "d_pedir_documento") return { kind: "image", mime: "image/png" };
  if (s === "d_pedir_email") return { kind: "text", text: "joao.silva.teste@gmail.com" };
  if (s === "d_confirmar_telefone") return { kind: "text", text: "1" };
  if (s === "d_simular_valor") return { kind: "text", text: "350" };
  if (s === "d_duvidas") return { kind: "text", text: "pode seguir" };

  // ── Roteiro legado (cenários de retry posicionam o lead nestes passos) ──
  if (s === "checkin_pos_video" || s === "menu_inicial" || s === "pos_video") {
    if (scenario === "lead_indeciso" && hits === 0) return { kind: "text", text: "é seguro mesmo? tem alguma taxa escondida?" };
    if (scenario === "valor_baixo") return { kind: "text", text: "minha conta vem uns 60 reais" };
    if (scenario === "joia_validacao") return { kind: "text", text: "👍" };
    return { kind: "text", text: "joia, quero economizar" };
  }

  if (s === "qualificacao") {
    if (scenario === "valor_baixo") return { kind: "audio", transcript: "minha conta vem uns 60 reais" };
    return { kind: "audio", transcript: "minha conta vem em torno de 350 reais" };
  }

  if (s === "valor_baixo") return null;

  if (s === "aguardando_conta" || s === "cadastro") return { kind: "image", mime: "image/png" };

  if (s === "confirmando_dados_conta") {
    if (scenario === "recusa_conta" && hits === 0) return { kind: "text", text: "não" };
    return { kind: "text", text: "sim" };
  }

  if (s === "pitch_conexao_club") return { kind: "text", text: "pode seguir" };

  if (s === "duvidas_pos_club") {
    if (scenario === "lead_indeciso" && hits === 0) return { kind: "text", text: "como cancelo se eu quiser?" };
    return { kind: "text", text: scenario === "joia_validacao" ? "👍" : "pode seguir" };
  }

  if (s === "ask_tipo_documento" || s === "coleta_doc") {
    return { kind: "text", text: scenario === "documento_cnh" ? "cnh" : "rg antigo" };
  }

  if (s === "aguardando_doc_frente" || s === "aguardando_doc_auto" || s === "ask_doc_frente_manual") {
    return { kind: "image", mime: "image/png" };
  }

  if (s === "aguardando_doc_verso" || s === "ask_doc_verso_manual") return { kind: "image", mime: "image/png" };

  if (s === "confirmando_dados_doc") {
    if (scenario === "recusa_documento" && hits === 0) return { kind: "text", text: "não" };
    return { kind: "text", text: "sim" };
  }

  if (s === "ask_phone_confirm") return { kind: "text", text: "2" };
  if (s === "ask_phone") return { kind: "text", text: "11999998888" };
  if (s === "ask_email") return { kind: "text", text: "joao.silva.teste@gmail.com" };
  if (s === "ask_name" || s === "editing_conta_nome" || s === "editing_doc_nome") return { kind: "text", text: "Joao Silva Teste" };
  if (s === "ask_cpf" || s === "editing_doc_cpf") return { kind: "text", text: "12345678909" };
  if (s === "ask_rg" || s === "editing_doc_rg") return { kind: "text", text: "123456789" };
  if (s === "ask_birth_date" || s === "editing_doc_nascimento") return { kind: "text", text: "15/05/1985" };
  if (s === "ask_cep" || s === "editing_conta_cep") return { kind: "text", text: "01310100" };
  if (s === "ask_number") return { kind: "text", text: "123" };
  if (s === "ask_complement") return { kind: "text", text: "não" };
  if (s === "ask_installation_number" || s === "editing_conta_instalacao") return { kind: "text", text: "9876543210" };
  if (s === "ask_distribuidora" || s === "editing_conta_distribuidora") return { kind: "text", text: "CPFL" };
  if (s === "ask_bill_value" || s === "editing_conta_valor") return { kind: "text", text: "350" };
  if (s === "editing_conta_menu" || s === "editing_doc_menu") return { kind: "text", text: "0" };
  if (s === "ask_finalizar") return { kind: "text", text: "finalizar" };
  // Pós-finalização (stubs de sandbox): OTP exige 4-8 dígitos; facial exige confirmação.
  if (s === "aguardando_otp" || s === "validando_otp") return { kind: "text", text: "123456" };
  if (s === "aguardando_facial" || s === "aguardando_assinatura") return { kind: "text", text: "pronto" };
  if (s === "portal_submitting" || s === "complete" || s === "cadastro_em_analise") return null;

  // Passo renomeado no construtor (ex.: `passo_mqzoj1uf`): o tipo ainda diz o que
  // o bot espera, então o roteiro continua respondendo algo plausível.
  if (type === "capture_name") return { kind: "text", text: "Joao Silva Teste" };
  if (type === "capture_conta" || type === "capture_documento") return { kind: "image", mime: "image/png" };
  if (type === "capture_email") return { kind: "text", text: "joao.silva.teste@gmail.com" };
  if (type === "confirm_phone") return { kind: "text", text: "1" };
  if (type === "finalizar_cadastro") return null;

  // Nada casou: registrar para o check de cobertura acusar a defasagem em vez de
  // deixar a run "responder sim" para sempre e falhar por motivo errado.
  opts.unknown?.add(type ? `${s} (${type})` : s);
  return { kind: "text", text: "sim" };
}

// deno-lint-ignore no-explicit-any
export function buildWhapiBody(phone: string, reply: Reply, idx: number): any {
  if (!reply) return null;
  const id = `test_${Date.now()}_${idx}_${Math.random().toString(36).slice(2)}`;
  const chatId = `${phone}@s.whatsapp.net`;
  const base = { id, chat_id: chatId, from: phone, from_me: false, timestamp: Math.floor(Date.now() / 1000) };
  if (reply.kind === "text") {
    return { event: { type: "messages" }, messages: [{ ...base, type: "text", text: { body: reply.text } }] };
  }
  if (reply.kind === "audio") {
    return { event: { type: "messages" }, messages: [{ ...base, type: "voice", voice: { mime_type: "audio/ogg", transcript: reply.transcript, link: null, data: null } }] };
  }
  return {
    event: { type: "messages" },
    messages: [{
      ...base,
      type: "image",
      image: { mime_type: reply.mime || "image/png", data: TEST_IMAGE_BASE64, link: `data:image/png;base64,${TEST_IMAGE_BASE64}` },
    }],
  };
}
