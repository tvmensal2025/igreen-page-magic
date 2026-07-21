/**
 * Fechamento contextual de respostas de atalho/FAQ — volta ao passo atual
 * do funil sem pedir link, endereço ou mídia na explicação.
 */

import { hasSoftClose } from "./format-reply.ts";

export interface QaStepCloseOpts {
  leadName?: string | null;
  /** Não anexa fechamento (ex.: handoff humano já tratado). */
  skip?: boolean;
}

/** Remove fechamento genérico legado do texto cadastrado no banco. */
const LEGACY_GENERIC_CLOSE =
  /(?:\n\s*)?Se estiver tudo certo, é só me dizer \*pode seguir\* que a gente continua seu cadastro\.[^\n]*$/iu;

export function normalizeQaStep(stepKey: string): string {
  return String(stepKey || "")
    .replace(/^flow:/i, "")
    .trim()
    .toLowerCase();
}

export function stripShortcutBoilerplate(text: string): string {
  return String(text || "").replace(LEGACY_GENERIC_CLOSE, "").trim();
}

function firstName(leadName?: string | null): string {
  return String(leadName || "").trim().split(/\s+/)[0] || "";
}

/**
 * Mensagem curta que reconduz o lead ao que o passo atual espera.
 */
export function buildQaStepClose(stepKey: string, opts: QaStepCloseOpts = {}): string {
  if (opts.skip) return "";

  const step = normalizeQaStep(stepKey);
  const fn = firstName(opts.leadName);
  const v = fn ? `${fn}, ` : "";

  const exact: Record<string, string> = {
    // Sofia — Grupo A
    a1_ask_name: `${v}me diz seu *primeiro nome* que a gente continua. 😊⚡`,
    a2_text_ask_bill_value: `${v}me passa o *valor* da sua conta de luz que eu calculo sua *economia*. ⚡🌱`,
    a3_explain_with_buttons: `${v}escolhe uma opção acima ou me diz *quero ativar* pra seguir. 😊⚡`,
    a5b_after_club_buttons: `${v}quer ativar? Toca em *Cadastrar* ou me diz *pode seguir*. 😊🌱`,
    a6_ask_bill_photo: `${v}quando quiser continuar a ativação, é só me dizer *pode seguir*. 😊⚡`,
    a7_ask_document: `${v}pra seguir o cadastro, é só me dizer *pode seguir* — te guio no próximo passo. 😊🌱`,
    a8_ask_email: `${v}me passa seu *e-mail* que seguimos com a ativação. 📧⚡`,
    a9_confirm_phone: `${v}confirma o *telefone* nas opções acima ou responde por aqui. 😊⚡`,
    a10_portal_otp_facial: `${v}digite o *código* quando receber, ou me diz *pode seguir* pra retomar. ⚡`,
    a11_facial_link: `${v}conclua a *validação* do passo anterior e me avise por aqui. 😊🌱`,

    // Legado / outros funis
    welcome: `${v}me conta quanto vem a sua *conta de luz* que eu calculo a *economia*. 💡⚡`,
    menu_inicial: `${v}me conta quanto vem a sua *conta de luz* que eu calculo a *economia*. 💡⚡`,
    qualificacao: `${v}me passa o *valor* da conta de luz que eu calculo sua *economia*. ⚡🌱`,
    aguardando_conta: `${v}quando quiser continuar a ativação, é só me dizer *pode seguir*. 😊⚡`,
    aguardando_doc_auto: `${v}pra finalizar, continue por aqui que eu te guio no cadastro. 😊🌱`,
    coleta_doc: `${v}pra finalizar, continue respondendo por aqui que eu te guio. 😊🌱`,
    ask_name: `${v}me diz seu *nome* que continuamos. 😊⚡`,
    ask_cpf: `${v}me passa seu *CPF* que seguimos o cadastro. 😊⚡`,
    ask_rg: `${v}me passa os dados do *documento* que seguimos. 😊🌱`,
    ask_email: `${v}me passa seu *e-mail* que seguimos. 📧⚡`,
    ask_phone: `${v}me passa o *telefone* com DDD que seguimos. 😊⚡`,
    ask_phone_confirm: `${v}confirma o *número* nas opções ou responde por aqui. 😊`,
    ask_cep: `${v}me passa o *CEP* que seguimos o cadastro. 😊⚡`,
    ask_number: `${v}me passa o *número* do endereço que seguimos. 😊`,
    ask_complement: `${v}me passa o *complemento* (ou diga *sem complemento*) que seguimos. 😊`,
    portal_submitting: `${v}aguarde um instante — já estou finalizando seu cadastro. ⚡`,
    aguardando_otp: `${v}digite o *código* aqui quando receber. ⚡`,
    validando_otp: `${v}estou validando o código — já te retorno. ⚡`,
    otp_falhou: `${v}tente digitar o *código* de novo ou me diz *pode seguir*. 😊`,
    otp_confirmar: `${v}confirma se o *código* digitado é o mesmo que chegou — toca nas opções acima. 😊`,
    finalizando: `${v}estamos quase lá — continue por aqui que eu te guio. 😊🌱`,
    cadastro_em_analise: `${v}seu cadastro está em análise — qualquer dúvida, é só perguntar. 😊`,
  };

  if (exact[step]) return exact[step];

  // Passos de captura genéricos do fluxo A (a6_ocr_retry, etc.)
  if (/^a6/.test(step)) {
    return `${v}quando quiser continuar a ativação, é só me dizer *pode seguir*. 😊⚡`;
  }
  if (/^a7/.test(step)) {
    return `${v}pra seguir o cadastro, é só me dizer *pode seguir* — te guio no próximo passo. 😊🌱`;
  }
  if (/^a[89]/.test(step) || /^a10/.test(step)) {
    return `${v}continue por aqui que eu te guio no próximo passo do cadastro. 😊⚡`;
  }
  if (/^a\d/.test(step)) {
    return `${v}é só me dizer *pode seguir* que continuamos seu cadastro. 😊⚡🌱`;
  }

  if (/aguardando_/.test(step) || /ask_/.test(step) || /capture/.test(step)) {
    return `${v}continue por aqui que eu te guio no cadastro. 😊🌱`;
  }

  return `${v}se ficou claro, é só me dizer *pode seguir* que continuamos seu cadastro. 😊⚡🌱`;
}

/** Anexa fechamento por etapa ao corpo da resposta de atalho. */
export function withQaStepClose(
  text: string,
  stepKey: string,
  opts: QaStepCloseOpts = {},
): string {
  const base = stripShortcutBoilerplate(text);
  if (!base) return base;
  // Handoff / textos que já trazem retorno ao fluxo.
  if (/pode seguir|em instantes te respondem|vou chamar alguém do \*time\*/i.test(base)) {
    return base;
  }
  if (hasSoftClose(base)) return base;

  const close = buildQaStepClose(stepKey, opts).trim();
  if (!close) return base;

  return `${base}\n\n${close}`;
}
