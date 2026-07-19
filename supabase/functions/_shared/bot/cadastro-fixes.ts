/**
 * Helpers de correção do cadastro (F03/F04/F06/F07/F11/F14/F15).
 * Fonte única usada por Whapi + Evolution — não apaga handlers legados,
 * só evita caminhos que corrompem dados / falsos loops.
 */

/** Steps conversacionais: lead pode perguntar sem mudar de passo (não é loop). */
export const CONVERSATIONAL_LOOP_EXEMPT_STEPS = new Set([
  "welcome",
  "d_welcome",
  "d_como_funciona",
  "d_duvidas",
  "menu_inicial",
  "qualificacao",
  "cadastro_em_analise",
  "aguardando_otp",
  "aguardando_facial",
  "aguardando_assinatura",
  "aguardando_avaliacao_atendimento",
]);

const EMAIL_RX = /\b[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}\b/;

/** Texto parece e-mail (evita tratar e-mail como CEP). */
export function looksLikeEmail(text: string): boolean {
  return EMAIL_RX.test(String(text || "").trim());
}

/** 8 dígitos puros (ou 00000-000) — típico de CEP, não de número de casa. */
export function looksLikeCepOnly(text: string): boolean {
  const t = String(text || "").trim();
  if (!t) return false;
  if (/[a-zA-ZÀ-ÿ]/.test(t)) return false;
  const d = t.replace(/\D/g, "");
  return d.length === 8;
}

/** Evita gravar e-mail em address_complement (caso JOSE). */
export function sanitizeComplement(value: string | null | undefined): string | null {
  if (value == null) return null;
  const v = String(value).trim();
  if (!v) return v;
  if (looksLikeEmail(v)) return null;
  return v;
}

/** Colapsa "R$ R$" acidental em templates. */
export function collapseDoubleCurrency(text: string): string {
  return String(text || "").replace(/R\$\s*R\$/gi, "R$");
}

/** Nome claramente não-nome (cumprimento / ok / opção). */
export function isNonNameReply(text: string): boolean {
  const t = String(text || "").trim().toLowerCase();
  if (t.length < 3) return true;
  return /^(oi|ol[aá]|opa|ok|okay|sim|n[aã]o|blz|beleza|obrigad[oa]|valeu|bom dia|boa tarde|boa noite|1|2|3|4|5)$/i.test(t);
}

/** Heurística leve de spam (links/zoom/meet em rajada no welcome). */
export function looksLikeSpamBlast(text: string): boolean {
  const t = String(text || "").toLowerCase();
  if (!t) return false;
  const hits = [
    /https?:\/\//,
    /zoom\.us/,
    /meet\.google/,
    /bit\.ly/,
    /whatsapp\.com\/channel/,
    /t\.me\//,
  ].filter((rx) => rx.test(t)).length;
  return hits >= 1 && (t.length > 120 || hits >= 2);
}

/** Destino após corrigir endereço/bairro no meio do cadastro (não reabrir d_resultado). */
export function resumeAfterAddressEdit(customer: {
  rescue_attempts?: number | null;
  previous_conversation_step?: string | null;
  conversation_step?: string | null;
}): "ask_finalizar" | "confirmando_dados_conta" {
  const prev = String(customer.previous_conversation_step || "");
  const rescue = Number(customer.rescue_attempts || 0);
  if (
    rescue > 0 ||
    /^(ask_finalizar|finalizando|ask_contaunica|ask_transferir_titularidade|portal_submitting)$/.test(prev)
  ) {
    return "ask_finalizar";
  }
  return "confirmando_dados_conta";
}

/**
 * Passos finais SEPARADOS (regra D/M + sys):
 *   1) ask_contaunica  — boleto unificado vs separado
 *   2) ask_finalizar   — confirmação explícita do lead
 *   3) finalizando     — só depois do "Finalizar" (portal)
 *
 * Nunca pular 1→3 nem 2→3 automaticamente a partir de email/telefone/ativar.
 * Testes devem validar a ordem sem chamar o portal.
 *
 * Exceção Sofia Multicanal (a10_portal_otp_facial): pula ask_contaunica e
 * ask_finalizar — boleto único implícito → finalizando/portal → OTP.
 */

/** Passos do Grupo A / Sofia Multicanal (a1_ask_name, a2_*, a10_portal_otp_facial…). */
export function isSofiaMulticanalConversationStep(
  step: string | null | undefined,
): boolean {
  return /^a\d+_/i.test(String(step || "").trim());
}

/**
 * Sofia Multicanal (Grupo A): variante A é a base desde 2026-07-17.
 * Variante C permanece só para leads legados até migração completa.
 */
export function isSofiaMulticanalCustomer(
  c: {
    flow_variant?: string | null;
    conversation_step?: string | null;
  } | null | undefined,
): boolean {
  if (!c) return false;
  const variant = String(c.flow_variant || "").toUpperCase();
  // Grupo A = Sofia Multicanal (base desde 2026-07-17); C = legado.
  if (variant === "A" || variant === "C") return true;
  if (isSofiaMulticanalConversationStep(c.conversation_step)) return true;
  return false;
}

/** Passo 9 do Grupo A / Sofia — portal + OTP sem perguntar boleto. */
export function isSofiaPortalOtpStep(stepKey: string | null | undefined): boolean {
  return String(stepKey || "") === "a10_portal_otp_facial";
}

/**
 * Defaults virtuais para routing Sofia C: boleto único implícito e complemento
 * vazio quando já há número (OCR). Não altera o customer no banco — só o cálculo
 * do próximo passo (`getNextMissingStep`).
 */
export function applySofiaCadastroRoutingDefaults<T extends Record<string, unknown>>(
  c: T,
): T {
  if (!isSofiaMulticanalCustomer(c as { flow_variant?: string | null })) return c;
  const out = { ...c } as T & {
    contaunica?: boolean;
    contaunica_answered?: boolean;
    address_complement?: string | null;
  };
  if (out.contaunica_answered !== true) {
    out.contaunica = true;
    out.contaunica_answered = true;
  }
  if (
    (out.address_complement === null || out.address_complement === undefined) &&
    String((out as Record<string, unknown>).address_number || "").trim()
  ) {
    out.address_complement = "";
  }
  return out as T;
}

/** Patch para persistir defaults Sofia ao entrar em finalizando/portal. */
export function sofiaCadastroPersistPatch(customer: {
  flow_variant?: string | null;
  address_complement?: string | null;
  address_number?: string | null;
}): Record<string, unknown> {
  if (!isSofiaMulticanalCustomer(customer)) return {};
  const patch: Record<string, unknown> = { ...sofiaPortalContaunicaPrefill() };
  if (
    (customer.address_complement === null || customer.address_complement === undefined) &&
    String(customer.address_number || "").trim()
  ) {
    patch.address_complement = "";
  }
  return patch;
}

/** Prefill boleto único para Sofia a10 (sem perguntar ao lead). */
export function sofiaPortalContaunicaPrefill(): {
  contaunica: true;
  contaunica_answered: true;
} {
  return { contaunica: true, contaunica_answered: true };
}

export function nextSeparatedCadastroStep(
  customer: {
    contaunica_answered?: boolean | null;
    flow_variant?: string | null;
    conversation_step?: string | null;
  } | null | undefined,
  opts?: { fromStepKey?: string | null },
): "ask_contaunica" | "ask_finalizar" | "finalizando" {
  if (isSofiaPortalOtpStep(opts?.fromStepKey) || isSofiaMulticanalCustomer(customer)) {
    return "finalizando";
  }
  if (!customer || customer.contaunica_answered !== true) return "ask_contaunica";
  return "ask_finalizar";
}

/** true se o step ainda é coleta/confirmação (não processa portal). */
export function isPrePortalCadastroStep(step: string | null | undefined): boolean {
  const s = String(step || "");
  return s === "ask_contaunica" || s === "ask_transferir_titularidade" || s === "ask_finalizar";
}

/**
 * Gate do portal na IA livre (ai-agent-router).
 * Funil obrigatório: INTERESSE → CONTA → DOCUMENTO → E-MAIL → telefone → PORTAL.
 * Antes: bastava valor + cpf (+rg/nascimento) para despachar o portal — sem
 * e-mail e sem foto do documento. Agora o próximo passo vem de
 * `getNextMissingStep`: só vai ao portal quando NADA falta; senão devolve o
 * passo real faltante (ask_email, ask_doc_frente_manual, …) sem pular etapa.
 */
export function resolvePortalGate(
  nextMissingStep: string,
): { action: "portal" } | { action: "goto"; step: string } {
  const s = String(nextMissingStep || "").trim();
  if (s === "finalizando") return { action: "portal" };
  // ask_contaunica / ask_finalizar: pré-portal legítimo — pergunta antes.
  if (!s) return { action: "goto", step: "ask_name" };
  return { action: "goto", step: s };
}
