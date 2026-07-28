// Resolve customers.conversation_step into a numbered step (e.g. "3/10 Aguardando conta").
// Supports both custom bot_flow steps (UUID or "flow:UUID") and legacy fixed steps.

export const LEGACY_STEP_ORDER: string[] = [
  "welcome",
  "menu_inicial",
  "pos_video",
  "aguardando_humano",
  "aguardando_conta",
  "processando_ocr_conta",
  "confirmando_dados_conta",
  "ask_tipo_documento",
  "aguardando_doc_frente",
  "aguardando_doc_verso",
  "aguardando_doc_auto",
  "confirmando_dados_doc",
  "ask_name",
  "ask_cpf",
  "ask_rg",
  "ask_birth_date",
  "ask_phone_confirm",
  "ask_phone",
  "ask_email",
  "ask_cep",
  "ask_finalizar",
  "finalizando",
  "portal_submitting",
  "aguardando_otp",
  "validando_otp",
  "cadastro_em_analise",
  "aguardando_assinatura",
  "complete",
];

export const LEGACY_STEP_LABELS: Record<string, string> = {
  welcome: "Boas-vindas",
  menu_inicial: "Menu inicial",
  pos_video: "Pós-vídeo",
  aguardando_humano: "Aguardando humano",
  aguardando_conta: "Aguardando conta de luz",
  processando_ocr_conta: "Processando OCR conta",
  confirmando_dados_conta: "Confirmando dados da conta",
  ask_tipo_documento: "Escolhendo tipo de documento",
  aguardando_doc_frente: "Aguardando frente do documento",
  aguardando_doc_verso: "Aguardando verso do documento",
  aguardando_doc_auto: "Aguardando documento",
  confirmando_dados_doc: "Confirmando dados do documento",
  ask_name: "Pedindo nome",
  ask_cpf: "Pedindo CPF",
  ask_rg: "Pedindo RG",
  ask_birth_date: "Pedindo nascimento",
  ask_phone_confirm: "Confirmando telefone",
  ask_phone: "Pedindo telefone",
  ask_email: "Pedindo email",
  ask_cep: "Pedindo CEP",
  ask_finalizar: "Aguardando finalização",
  finalizando: "Finalizando",
  portal_submitting: "Enviando ao portal",
  aguardando_otp: "Aguardando código do celular",
  validando_otp: "Validando OTP",
  cadastro_em_analise: "Cadastro em análise",
  aguardando_assinatura: "Aguardando assinatura",
  complete: "Cadastro completo",
};

export interface FlowStepInfo {
  number: number;
  total: number;
  label: string;
  rawKey: string;
  kind: "custom" | "legacy" | "unknown";
}

export interface CustomStepEntry {
  position: number;
  total: number;
  title: string;
}

export type CustomStepMap = Map<string, CustomStepEntry>;

export function resolveStep(
  conversationStep: string | null | undefined,
  customStepMap: CustomStepMap
): FlowStepInfo | null {
  if (!conversationStep) return null;
  const raw = conversationStep.trim();
  if (!raw) return null;

  // Custom: "flow:<uuid>" or "<uuid>" or "<step_key>" inside the custom flow
  const stripped = raw.startsWith("flow:") ? raw.slice(5) : raw;
  const custom = customStepMap.get(stripped) || customStepMap.get(raw);
  if (custom) {
    return {
      number: custom.position + 1,
      total: custom.total,
      label: custom.title || `Passo ${custom.position + 1}`,
      rawKey: raw,
      kind: "custom",
    };
  }

  // Legacy
  const idx = LEGACY_STEP_ORDER.indexOf(raw);
  if (idx >= 0) {
    return {
      number: idx + 1,
      total: LEGACY_STEP_ORDER.length,
      label: LEGACY_STEP_LABELS[raw] || raw,
      rawKey: raw,
      kind: "legacy",
    };
  }

  return {
    number: 0,
    total: 0,
    label: raw.length > 24 ? raw.slice(0, 24) + "…" : raw,
    rawKey: raw,
    kind: "unknown",
  };
}
