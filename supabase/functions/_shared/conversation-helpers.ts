import { wantsToAdvance } from "./bot/cadastro-intent.ts";
import {
  applySofiaCadastroRoutingDefaults,
  isSofiaMulticanalCustomer,
} from "./bot/cadastro-fixes.ts";
import { requiresRgNumber } from "./document-type.ts";

// ─── Normalização e validação pós-OCR documento ─────────────────────────
export function normalizarRG(rg: string | undefined): string {
  if (!rg || typeof rg !== "string") return "";
  // Preserva dígito verificador 'X' do RG antigo; remove demais letras e pontuação
  const limpo = rg.replace(/\s/g, "").replace(/[.\-/]/g, "").replace(/[^\dXx]/g, "").toUpperCase();
  // Garante que só haja 'X' no final, se houver
  const sanitizado = limpo.replace(/X(?=.)/g, "");
  return sanitizado.length >= 7 && sanitizado.length <= 12 ? sanitizado : "";
}

export function validarDataNascimento(data: string | undefined): string {
  if (!data || typeof data !== "string") return "";
  const trim = data.trim();
  const match = trim.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) {
    const iso = trim.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (iso) return `${iso[2]}/${iso[3]}/${iso[1]}`;
    return "";
  }
  const [, d, m, y] = match;
  const dia = parseInt(d, 10), mes = parseInt(m, 10), ano = parseInt(y, 10);
  const anoMax = new Date().getFullYear() - 15;
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31 || ano < 1920 || ano > anoMax) return "";
  return `${d}/${m}/${y}`;
}

export function validarNomeOCR(nome: string | undefined): string {
  if (!nome || typeof nome !== "string") return "";
  let t = nome.trim().replace(/\s+/g, " ");
  t = t.replace(/\s0\s/g, " O ");
  if (t.length < 3) return "";
  if (/^\d+$/.test(t)) return "";
  return t;
}

export function validarCPFDigitos(cpf: string): boolean {
  const c = cpf.replace(/\D/g, "");
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(c[i], 10) * (10 - i);
  let digit = 11 - (sum % 11);
  if (digit >= 10) digit = 0;
  if (digit !== parseInt(c[9], 10)) return false;
  sum = 0;
  for (let i = 0; i < 10; i++) sum += parseInt(c[i], 10) * (11 - i);
  digit = 11 - (sum % 11);
  if (digit >= 10) digit = 0;
  return digit === parseInt(c[10], 10);
}

/**
 * Determina o próximo passo baseado nos dados que faltam.
 * Ordem: nome → cpf → rg → nascimento → telefone → email → cep → número → complemento → instalação → valor → finalizar
 *
 * `opts.consultorEmail` — quando informado, trata `customer.email` igual ao
 * email do consultor como "não preenchido" e devolve `ask_email`. Sem isso,
 * o bot considerava o cadastro "completo" com lixo herdado e tentava finalizar
 * direto, caindo em loop até virar handoff.
 */
export function getNextMissingStep(
  c: any,
  opts?: { consultorEmail?: string | null },
): string {
  const raw = c;
  const v = applySofiaCadastroRoutingDefaults(c || {});
  let step: string;
  if (!v.name) step = "ask_name";
  else if (!v.cpf) step = "ask_cpf";
  // CPF com dígitos verificadores inválidos → pedir novamente
  else if (v.cpf && !validarCPFDigitos(v.cpf)) step = "ask_cpf";
  // RG novo / CIN: só CPF — NÃO pedir nº de Registro Geral
  else if (requiresRgNumber(v.document_type) && !v.rg) step = "ask_rg";
  // Data placeholder (2000-01-01) ou vazia → pedir
  else if (!v.data_nascimento || /^2000-01-01/.test(String(v.data_nascimento))) step = "ask_birth_date";
  // Telefone só vale se foi CONFIRMADO pelo cliente (não basta existir phone_landline herdado)
  else if (!v.phone_landline || v.phone_contact_confirmed !== true) step = "ask_phone_confirm";
  // Email vazio, placeholder, do consultor ou de teste → pedir
  else {
    const emailNormalized = String(v.email || "").trim().toLowerCase();
    const consultorEmailNormalized = String(opts?.consultorEmail || "").trim().toLowerCase();
    if (
      !emailNormalized ||
      /@lead\.igreen$/i.test(emailNormalized) ||
      /@teste/i.test(emailNormalized) ||
      /^teste@/i.test(emailNormalized) ||
      /^noreply@/i.test(emailNormalized) ||
      /^sem_email/i.test(emailNormalized) ||
      (consultorEmailNormalized && emailNormalized === consultorEmailNormalized)
    ) step = "ask_email";
    // F03: NUNCA devolver ask_cep ao lead (regra de produto).
    else if (!v.address_number) step = "ask_number";
    // complemento é opcional — Sofia C trata como "" quando já há número (OCR)
    else if (v.address_complement === null || v.address_complement === undefined) step = "ask_complement";
    else if (!v.distribuidora || String(v.distribuidora).trim().length < 2) step = "ask_distribuidora";
    else if (!v.numero_instalacao || String(v.numero_instalacao).replace(/\D/g, "").length < 7) {
      step = "ask_installation_number";
    } else if (!v.electricity_bill_value || v.electricity_bill_value <= 0 || v.electricity_bill_value < 30) {
      step = "ask_bill_value";
    } else if (!v.document_front_url) step = "ask_doc_frente_manual";
    else {
      const dt = String(v.document_type || "").toLowerCase();
      const isCnh = /cnh|habilita/.test(dt);
      const verso = String(v.document_back_url || "").trim();
      if (!isCnh && (!verso || verso === "nao_aplicavel")) step = "ask_doc_verso_manual";
      else if (v.contaunica_answered !== true) step = "ask_contaunica";
      else step = "ask_finalizar";
    }
  }
  // Sofia C: após a9 (telefone) vai direto ao portal — sem boleto nem botão Finalizar extra.
  if (
    isSofiaMulticanalCustomer(raw) &&
    (step === "ask_contaunica" || step === "ask_transferir_titularidade" || step === "ask_finalizar")
  ) {
    return "finalizando";
  }
  return step;
}

/** Opções de botão para preferência de boleto (Whapi/Evolution). */
export const CONTAUNICA_OPTIONS = [
  { id: "boleto_unificado", title: "1️⃣ Unificado" },
  { id: "boleto_separado", title: "2️⃣ Separado" },
] as const;

export function getPreferenceOptions(step: string): ReadonlyArray<{ id: string; title: string }> | null {
  if (step === "ask_contaunica" || step === "ask_transferir_titularidade") {
    // ask_transferir_titularidade: legado mid-flight — reapresenta a pergunta de boleto.
    return CONTAUNICA_OPTIONS;
  }
  return null;
}

/**
 * Preferência obrigatória ainda não respondida, ou null se ok.
 * Usado nos gates de ask_finalizar / finalizando.
 */
export function missingPreferenceStep(c: any): "ask_contaunica" | null {
  if (isSofiaMulticanalCustomer(c)) return null;
  if (c?.contaunica_answered !== true) return "ask_contaunica";
  return null;
}

/**
 * Retorna a mensagem para cada step
 */
export function getReplyForStep(step: string, c: any): string {
  switch (step) {
    case "ask_name": return "Qual é o seu *nome completo*?";
    case "ask_tipo_documento": return "Qual documento de identidade você vai enviar? Toque em uma opção:";
    case "ask_cpf": return "Qual o seu *CPF*? (apenas números)";
    case "ask_rg": return "Qual o seu *número do RG* (Registro Geral do RG antigo)?";
    case "ask_birth_date": return "Qual sua *data de nascimento*? (DD/MM/AAAA)";
    case "ask_phone_confirm": {
      let p = (c.phone_whatsapp || "").replace(/\D/g, "");
      if (p.startsWith("55") && p.length >= 12) p = p.substring(2);
      const fmt = p.length >= 11 ? `(${p.slice(0, 2)}) ${p.slice(2, 7)}-${p.slice(7)}` : (c.phone_whatsapp || "");
      return `📞 Esse é o seu *telefone de contato*?\n\n*${fmt}*`;
    }
    case "ask_phone": return "Informe seu *telefone* com DDD (ex: 11999998888):";
    case "ask_email": return "📧 *Qual o seu melhor e-mail?*\n\n_Vou usar pra liberar o seu acesso ao app *iGreen Club* 📱_\n_(onde você acompanha cashback, faturas e indicações)_\n\nPode ser Gmail, Outlook, iCloud…";
    case "ask_cep": return "Qual o seu *CEP*? (8 dígitos)";
    case "ask_number": return `📍 Endereço: *${c.address_street || ""}*\n\nQual o *número* da residência?`;
    case "ask_complement": return "🏠 *Tem complemento no endereço?*\n_Apto, bloco, casa, fundos, etc._";
    case "ask_distribuidora": return "Qual a sua *distribuidora de energia*?\n(É a concessionária que aparece na sua conta de luz — ex: CPFL, Enel, Cemig, Light, Coelba…)";
    case "ask_installation_number": return "Qual o *número da instalação* de energia?\n(Campo \"Seu Código\" na conta de luz)";
    case "ask_bill_value": return "Qual o *valor médio* da sua conta de luz? (ex: 350)";
    case "ask_doc_frente_manual": return "📸 Envie a *FRENTE do seu documento* (RG ou CNH)";
    case "ask_doc_verso_manual": return "📸 Envie o *VERSO do seu documento*";
    case "ask_contaunica":
    case "ask_transferir_titularidade":
      // UX: perguntamos boleto (mais fácil). No portal a pergunta é titularidade;
      // unificado ⇔ transferir; separado ⇔ não transferir.
      return "📄 *Como você prefere receber a fatura?*\n\n1️⃣ *Boleto unificado* — um boleto só (energia + iGreen)\n2️⃣ *Boleto separado* — dois boletos (um da distribuidora e outro da iGreen)\n\n_Toque em uma opção ou digite *1* / *2*:_";
    case "ask_finalizar": return "✅ *Todos os dados foram preenchidos!*\n\n1️⃣ ✅ Finalizar\n\n_Digite *1* ou *FINALIZAR* para concluir:_";
    case "finalizando": return "✅ Todos os dados coletados! Processando...";
    default: return `Continuando... (${step})`;
  }
}

// ─── Strong intent (deterministic override before LLM) ───────────────
/** @deprecated Prefer `wantsToAdvance()` — mantido para `.test()` legado. */
export const RE_INTENT_CADASTRAR = {
  test(text: string): boolean {
    return wantsToAdvance(text);
  },
};

export const RE_INTENT_HUMANO =
  /\b(humano|atendente|pessoa real|operador|consultor de verdade|falar com algu[eé]m)\b/i;

export const RE_INTENT_RESET =
  /\b(n[ãa]o sou eu|esses dados n[ãa]o s[ãa]o meus|essa conta n[ãa]o [eé] minha|recome[çc]ar|come[çc]ar de novo|outra conta|nova conta|resetar|reiniciar|zerar)\b/i;

// Names sources we trust for personalization / "bill is yours" logic.
export const TRUSTED_NAME_SOURCES = new Set(["ocr", "self_introduced", "manual"]);

/**
 * Wipes lead-identity / OCR fields so the bot can restart cleanly.
 * Used when the user explicitly says "não sou eu" / "recomeçar"
 * or when the webhook detects polluted state from a reused phone.
 */
export async function resetLeadIdentity(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  customerId: string,
  opts: { keepStep?: boolean } = {},
): Promise<void> {
  const patch: Record<string, unknown> = {
    name: null,
    name_source: "unknown",
    electricity_bill_photo_url: null,
    bill_base64: null,
    bill_message_id: null,
    bill_requested_at: null,
    ocr_done: false,
    ocr_confianca: null,
    ocr_conta_attempts: 0,
    ocr_doc_attempts: 0,
    distribuidora: null,
    numero_instalacao: null,
    electricity_bill_value: null,
    address_street: null,
    address_number: null,
    address_complement: null,
    address_neighborhood: null,
    address_city: null,
    address_state: null,
    cep: null,
    document_front_url: null,
    document_back_url: null,
    document_front_base64: null,
    document_back_base64: null,
    document_type: null,
    cpf: null,
    rg: null,
    data_nascimento: null,
    nome_pai: null,
    nome_mae: null,
    pain_point: null,
    sales_phase: "abertura",
    qualification_score: 0,
    bot_paused: false,
    bot_paused_reason: null,
    bot_paused_at: null,
    error_message: null,
    rescue_attempts: 0,
  };
  if (!opts.keepStep) patch.conversation_step = "welcome";
  await supabase.from("customers").update(patch).eq("id", customerId);
}

// ─── shouldSkipAsk ──────────────────────────────────────────────────────
// Helper aditivo: indica se um step "ask_*" pode ser pulado porque o dado
// associado já existe e é válido. Usado como guarda extra antes de
// enviar perguntas — evita repergunta quando o cliente já informou o dado
// antes (ex: "Oi, sou João" no welcome → ao chegar em ask_name, pula).
// NÃO altera nenhum comportamento existente; é só um utilitário.
//
// IMPORTANTE: para "name", só considera "preenchido" quando a fonte é
// confiável — caso contrário, mantém o comportamento de perguntar.
export type AskField =
  | "name"
  | "cpf"
  | "rg"
  | "data_nascimento"
  | "phone_landline"
  | "email"
  | "cep"
  | "address_number"
  | "address_complement"
  | "distribuidora"
  | "numero_instalacao"
  | "electricity_bill_value"
  | "document_front"
  | "document_back"
  | "contaunica"
  | "transferir_titularidade";

export function shouldSkipAsk(field: AskField, customer: any): boolean {
  if (!customer) return false;
  switch (field) {
    case "name": {
      const v = String(customer.name || "").trim();
      if (v.length < 2) return false;
      const src = String(customer.name_source || "");
      // Só pula se a fonte for confiável (evita pular por nome herdado/lixo).
      return TRUSTED_NAME_SOURCES.has(src) || src === "manual" || src === "user_confirmed" || src === "ocr_conta" || src === "ocr_doc";
    }
    case "cpf": {
      const v = String(customer.cpf || "").replace(/\D/g, "");
      return v.length === 11 && validarCPFDigitos(v);
    }
    case "rg": {
      const v = normalizarRG(customer.rg);
      return v.length >= 7;
    }
    case "data_nascimento": {
      const v = validarDataNascimento(String(customer.data_nascimento || ""));
      return !!v && !/^2000-01-01/.test(String(customer.data_nascimento || ""));
    }
    case "phone_landline":
      return !!customer.phone_landline && customer.phone_contact_confirmed === true;
    case "email": {
      const v = String(customer.email || "");
      if (!v) return false;
      if (/@lead\.igreen$/i.test(v)) return false;
      if (/^(tvmensal|teste@|sem_email|noreply@)/i.test(v)) return false;
      if (/@teste/i.test(v)) return false;
      return /@.+\./.test(v);
    }
    case "cep": {
      const v = String(customer.cep || "").replace(/\D/g, "");
      // Pula só quando CEP é válido E temos endereço+cidade+UF (OCR completo / ViaCEP resolvido).
      const hasAddr = !!(customer.address_street && customer.address_city && customer.address_state);
      return v.length === 8 && !/000$/.test(v) && hasAddr;
    }
    case "address_number": {
      const v = String(customer.address_number || "").trim();
      return v.length >= 1;
    }
    case "address_complement": {
      // Complemento é opcional: respondido se já está setado (mesmo vazio "").
      return customer.address_complement !== null && customer.address_complement !== undefined;
    }
    case "distribuidora": {
      // Pula quando já temos uma distribuidora preenchida (do OCR da conta).
      // A validação de concessionária válida por UF é feita na ficha/portal.
      return String(customer.distribuidora || "").trim().length >= 2;
    }
    case "numero_instalacao": {
      const v = String(customer.numero_instalacao || "").replace(/\D/g, "");
      return v.length >= 7;
    }
    case "electricity_bill_value": {
      const v = Number(customer.electricity_bill_value || 0);
      return v >= 30;
    }
    case "document_front": {
      const v = String(customer.document_front_url || "").trim();
      return v.length > 0 && v !== "evolution-media:pending";
    }
    case "document_back": {
      const dt = String(customer.document_type || "").toLowerCase();
      if (/cnh|habilita/.test(dt)) return true; // CNH não precisa verso
      const v = String(customer.document_back_url || "").trim();
      return v.length > 0 && v !== "evolution-media:pending" && v !== "nao_aplicavel";
    }
    case "contaunica":
    case "transferir_titularidade":
      // Mesma resposta: boleto unificado ⇔ transferir titularidade.
      return customer.contaunica_answered === true;
    default:
      return false;
  }
}

// Mapeia step "ask_*" / "aguardando_doc_*" → campo correspondente.
const ASK_STEP_TO_FIELD: Record<string, AskField> = {
  "ask_name": "name",
  "ask_cpf": "cpf",
  "ask_rg": "rg",
  "ask_birth_date": "data_nascimento",
  "ask_phone": "phone_landline",
  "ask_phone_confirm": "phone_landline",
  "ask_email": "email",
  "ask_cep": "cep",
  "ask_number": "address_number",
  "ask_complement": "address_complement",
  "ask_distribuidora": "distribuidora",
  "ask_installation_number": "numero_instalacao",
  "ask_bill_value": "electricity_bill_value",
  "ask_doc_frente_manual": "document_front",
  "ask_doc_verso_manual": "document_back",
  "ask_contaunica": "contaunica",
  "ask_transferir_titularidade": "transferir_titularidade",
  "aguardando_doc_auto": "document_front",
  "aguardando_doc_frente": "document_front",
  "aguardando_doc_verso": "document_back",
};

/**
 * Retorna true se este step pode ser pulado porque o dado já existe e é válido.
 * Usar como guard ANTES de enviar a pergunta — evita reperguntar dados já
 * coletados via OCR, edição manual, ou passos anteriores.
 */
export function shouldSkipAskStep(step: string, customer: any): boolean {
  const field = ASK_STEP_TO_FIELD[step];
  if (!field) return false;
  return shouldSkipAsk(field, customer);
}

/**
 * Resume determinístico: dado o estado dos campos do customer (não o
 * conversation_step do banco), devolve qual é o próximo passo que falta.
 *
 * Uso: chamar SEMPRE que precisar despachar um capture_* — se o resultado
 * diferir do step que ia ser disparado, usar o resultado daqui. Garante que
 * um reset silencioso de conversation_step não force o cliente a reenviar
 * dado já salvo.
 *
 * Ordem do funil:
 *   1. conta (foto+OCR) → confirma conta
 *   2. doc frente → (se RG) doc verso → confirma doc
 *   3. demais campos pessoais (delegado a getNextMissingStep)
 */
export function resolveResumeStep(customer: any): string {
  if (!customer) return "aguardando_conta";
  // 1. Conta de luz
  if (!hasBillData(customer)) return "aguardando_conta";
  if (!customer.bill_data_confirmed_at) return "confirmando_dados_conta";
  // 2. Documento frente
  if (!shouldSkipAsk("document_front", customer)) return "aguardando_doc_auto";
  // 3. Verso (CNH dispensa — shouldSkipAsk já trata)
  if (!shouldSkipAsk("document_back", customer)) return "aguardando_doc_verso";
  // 4. Confirmação dos dados do doc
  if (!customer.doc_data_confirmed_at) return "confirmando_dados_doc";
  // 5+ delega para o resolver clássico que cobre nome/cpf/rg/email/cep/etc
  return getNextMissingStep(customer);
}


/**
 * Retorna true se já existem evidências de que a *fatura real* foi
 * recebida — foto, base64, OCR concluído ou número de instalação extraído.
 * Usado para bloquear o disparo de capture_documento ANTES da conta E para
 * o `resolveResumeStep` decidir se pode pular `aguardando_conta`.
 *
 * ⚠️ Bug 2026-06-29 (lead 5511971254913): antes este helper tratava
 * `electricity_bill_value >= 30` e `media_consumo > 0` como prova de
 * conta enviada. Mas esses campos também são populados pela "Simulação
 * rápida" (valor digitado pelo cliente, ex.: "800"). Resultado: depois
 * da rápida o cliente clicava em "Quero me cadastrar", enviava a foto da
 * conta, e o guard de resume pulava direto para `confirmando_dados_conta`
 * sem rodar OCR — a imagem era descartada e o doc era pedido em cima da
 * estimativa. Corrigido exigindo evidência REAL de fatura.
 */
export function hasBillData(customer: any): boolean {
  if (!customer) return false;
  const url = String(customer.electricity_bill_photo_url || customer.electricity_bill_url || "").trim();
  if (url && url !== "evolution-media:pending") return true;
  if (customer.bill_base64) return true;
  if (customer.ocr_done === true) return true;
  if (String(customer.numero_instalacao || "").replace(/\D/g, "").length >= 7) return true;
  return false;
}

/**
 * True quando só temos a *estimativa* da Simulação rápida
 * (`electricity_bill_value` / `media_consumo`) e NENHUMA evidência de
 * fatura real. Quem chama (handler de mídia, resume guard) usa para nunca
 * pular `aguardando_conta` só por causa da estimativa.
 */
export function hasBillEstimateOnly(customer: any): boolean {
  if (!customer) return false;
  if (hasBillData(customer)) return false;
  if (Number(customer.electricity_bill_value || 0) >= 30) return true;
  if (Number(customer.media_consumo || 0) > 0) return true;
  return false;
}

// ─── detectQuestionIntent ───────────────────────────────────────────────
// Heurística leve para "isso parece uma pergunta?". Usada pelo midflow QA
// para decidir se vale tentar casar uma FAQ no meio do cadastro.
const RE_MIDFLOW_QUESTION =
  /\?|\b(quanto|como|porqu[eê]|por\s*qu[eê]|seguro|golpe|funciona|tem\s+taxa|cobra|paga|vou\s+pagar|fatura|conta|garant|cancelar|desisti|prazo|demora|quando|preço|valor\s+da|d[uú]vida)\b/i;

export function detectQuestionIntent(text: string): boolean {
  if (!text) return false;
  const t = String(text).trim();
  if (t.length < 3) return false;
  return RE_MIDFLOW_QUESTION.test(t);
}
