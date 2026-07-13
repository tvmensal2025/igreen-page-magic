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
