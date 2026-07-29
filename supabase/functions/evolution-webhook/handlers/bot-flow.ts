// Main bot state machine — extracted verbatim from the giant switch in index.ts.
// All conversation steps live here. Receives a BotContext and returns
// { reply, updates }. The caller persists updates and sends reply.
//
// Behavior is identical to the previous inline version. Only structural change:
// the closure variables are now properties of `ctx`.

import { resolveFlowId } from "../../_shared/resolve-flow.ts";
import { discountRates } from "../../_shared/discount-rates.ts";
import {
  isUsableCustomerName,
  safeFirstNameForAddress,
} from "../../_shared/customer-display-name.ts";
import {
  extractQuestionTail,
  resolveStepReentry,
} from "../../_shared/bot/step-goal.ts";
import {
  isClubProgressIntent,
  isComoFuncionaStep,
  isConfidentDocDetection,
  isPositiveCheckinIntent,
} from "../../_shared/bot/flow-predicates.ts";
import {
  resolveOcrFallback,
  sendOcrRetryMessage,
} from "../../_shared/bot/ocr-fallback.ts";
// runFluxoBAI removido — Cérebro IA responde via responderComCerebro no webhook (vendedora apagada).
import {
  validateCustomerForPortal,
  isPlaceholderEmail,
  isValidEmailFormat,
  isSameContact,
} from "../../_shared/validators.ts";
import {
  decideCorrection,
  isValidCelular,
  isValidCorrectionEmail,
  isValidInstallation,
  isSameNormalized,
  incrementAttempts,
  maskCorrectionValueForLog,
  type CorrectionKind,
} from "../../_shared/portal-correction.ts";
import { isResolverStrictMode } from "../../_shared/bot/global-flag.ts";
import {
  fetchWithTimeout,
  fetchInsecure,
  withRetry,
  buscarCepPorEndereco,
  buscarEnderecoPorCep,
  normalizePhone,
  TIMEOUT_VIA_CEP,
  logStructured,
} from "../../_shared/utils.ts";
import {
  toWhatsappCanonical,
  toNationalPhoneDigits,
  formatBrLandline,
  isValidBrNationalPhone,
} from "../../_shared/portal-phone.ts";
import { parseMoneyBR, extractMoneyFromText } from "../../_shared/parse-money.ts";
import { getStepMediaOrder, makeKindComparator } from "../../_shared/step-media-order.ts";
import { canSendMediaOnce } from "../../_shared/media-dedupe.ts";
import { detectPostponeIntent, buildPostponeReplyResolved } from "../../_shared/postpone-intent.ts";
import { renderTemplateVars } from "../../_shared/render-vars.ts";
import { buildCadastroLink } from "../../_shared/keyword-matcher.ts";
import {
  getReplyForStep,
  getNextMissingStep,
  getPreferenceOptions,
  missingPreferenceStep,
  validarCPFDigitos,
  RE_INTENT_CADASTRAR,
  RE_INTENT_HUMANO,
  RE_INTENT_RESET,
  TRUSTED_NAME_SOURCES,
  resetLeadIdentity,
  detectQuestionIntent,
  shouldSkipAskStep,
  hasBillData,
  resolveResumeStep,
} from "../../_shared/conversation-helpers.ts";

import { matchQA } from "./conversational/index.ts";
import { buildQaStepClose, withQaStepClose } from "../../_shared/qa-step-close.ts";
import { getTemplate } from "./conversational/templates.ts";
import { extractMultiField, buildMultiFieldPatch } from "../../_shared/multi-field-extractor.ts";
import {
  looksLikeEmail,
  looksLikeCepOnly,
  sanitizeComplement,
  isNonNameReply,
  resumeAfterAddressEdit,
  looksLikeSpamBlast,
  nextSeparatedCadastroStep,
  isSofiaMulticanalCustomer,
  sofiaCadastroPersistPatch,
  isPlausibleAddressNumber,
  addressValidationRedirect,
  extractCepFromText,
  FINALIZE_ADDRESS_PROMPT,
} from "../../_shared/bot/cadastro-fixes.ts";
import {
  advanceSofiaToDocumentAfterBill,
  advanceGenericToDocumentAfterBill,
  markDocAutoConfirmed,
  OCR_RETRY_CONTA_SHORT,
  OCR_RETRY_DOC_SHORT,
  isSofiaPostBillCadastro,
} from "../../_shared/bot/sofia-post-bill-routing.ts";

import { detectFlowSwitch, CADASTRO_STEPS } from "../../_shared/flow-router.ts";
import { ocrContaEnergia, ocrDocumentoFrenteVerso, resolveOcrImageForBill, resolveOcrImageForDocument } from "../../_shared/ocr.ts";
import { normalizeDocumentType, isCNH, friendlyLabel } from "../../_shared/document-type.ts";
import { detectDocumentTypeDetailed } from "../../_shared/detect-doc-type.ts";
import {
  salvageIfDocumentMisroutedAtBillOcr,
  resolveEarlyDocumentStepAfterBill,
  buildEarlyDocConfirmMessage,
} from "../../_shared/bot/salvage-doc-at-bill-ocr.ts";
import { uploadMediaToMinio, OCR_CONFIDENCE_THRESHOLD } from "../_helpers.ts";
import { jsonLog } from "../../_shared/audit.ts";
import { isTestMode, isCustomerSandbox } from "../../_shared/test-mode.ts";
import { notifyHandoff } from "../../_shared/notify-consultant.ts";
import { recordFlowDAlert } from "../../_shared/captation/flow-d-alerts.ts";
import { phraseMatchesMessage } from "../../_shared/qa-phrase-match.ts";
import type { BotContext, BotResult } from "./types.ts";
import {
  trigramSim,
  resolvePostBillNextStepId,
  stepHasInteractiveWait,
} from "../../_shared/bot/step-interaction.ts";
import { checkHolderMatch, nameLevSim } from "../../_shared/bot/holder-match.ts";
export { checkHolderMatch };
import { buildConfirmacaoConta, buildConfirmacaoDoc, formatBRL } from "../../_shared/bot/confirmation-formatters.ts";

// ── Sleep entre mídias (ZERO espera artificial) ──
async function sleepForMedia(_kind: string, _durationSec?: number | null): Promise<void> {
  if (isTestMode()) return;
  await new Promise((r) => setTimeout(r, 150));
}

// ── Fetch URL → base64 (for OCR when proxy didn't deliver bytes) ──
async function fetchUrlToBase64(url: string, timeoutMs = 15_000): Promise<{ base64: string; mime: string } | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const r = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) return null;
    const mime = r.headers.get("content-type") || "application/octet-stream";
    const buf = new Uint8Array(await r.arrayBuffer());
    let bin = "";
    for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
    return { base64: btoa(bin), mime };
  } catch (e) {
    console.warn("[fetchUrlToBase64] falhou:", (e as any)?.message);
    return null;
  }
}

// OCR retry (texto Multicanal + áudio opcional) — ver _shared/bot/ocr-fallback.ts

async function applyOcrRetryReply(opts: {
  supabase: any;
  customer: any;
  updates: any;
  remoteJid: string;
  sendText: (jid: string, text: string) => Promise<any>;
  sendMedia: (jid: string, url: string, caption: string, kind: string, durationSec?: number) => Promise<any>;
  stepType: "capture_conta" | "capture_documento";
  attempts: number;
  defaultRetryText: string;
  nomeRepresentante: string;
  conversationStep: string;
  pauseReason: string;
}): Promise<string> {
  const {
    supabase, customer, updates, remoteJid, sendText, sendMedia,
    stepType, attempts, defaultRetryText, nomeRepresentante, conversationStep, pauseReason,
  } = opts;
  const { retryText, escalate, retryAudioClipId } = await resolveOcrFallback(
    supabase, customer.id, customer.consultant_id, stepType, attempts, defaultRetryText, (customer as any)?.flow_variant,
  );
  const finalText = escalate
    ? `${retryText}\n\nVou chamar ${nomeRepresentante} para te ajudar pessoalmente 🙌`
    : retryText;
  if (escalate) {
    updates.bot_paused = true;
    updates.bot_paused_reason = pauseReason;
    updates.bot_paused_at = new Date().toISOString();
  } else {
    updates.conversation_step = conversationStep;
  }
  const sent = await sendOcrRetryMessage({
    supabase,
    remoteJid,
    customerId: customer.id,
    conversationStep: String(updates.conversation_step || conversationStep),
    text: finalText,
    retryAudioClipId,
    sendText,
    sendMedia,
  });
  if (sent) {
    (updates as any).__inline_sent = true;
    return "";
  }
  return finalText;
}


/**
 * Após preencher campo da conta (nome/valor), avança ao doc sem SIM.
 */
async function autoAdvanceBillAfterFieldEdit(opts: {
  customer: any;
  updates: Record<string, unknown>;
  dispatchStep: (k: string, v: Record<string, string>) => Promise<unknown>;
  logPrefix: string;
}): Promise<string> {
  if (await advanceSofiaToDocumentAfterBill({
    customer: opts.customer,
    updates: opts.updates,
    dispatchStep: opts.dispatchStep,
    logPrefix: opts.logPrefix,
  })) {
    return "";
  }
  return advanceGenericToDocumentAfterBill(opts.updates);
}

/**
 * OCR doc ok → avança sem pedir SIM/NÃO/EDITAR.
 * Mantém checagem de titularidade (conta × doc) quando há mismatch.
 */
async function autoAdvanceAfterDocOcr(opts: {
  customer: any;
  updates: Record<string, unknown>;
  remoteJid: string;
  sendOptions: (jid: string, text: string, buttons: Array<{ id: string; title: string }>) => Promise<unknown>;
}): Promise<string> {
  const { customer, updates, remoteJid, sendOptions } = opts;
  markDocAutoConfirmed(updates);
  const mismatch = (updates.name_mismatch_flag ?? customer.name_mismatch_flag) === true;
  const acked = updates.name_mismatch_acknowledged_at ?? customer.name_mismatch_acknowledged_at;
  if (mismatch && !acked) {
    updates.conversation_step = "confirmar_titularidade";
    const bill = customer.bill_holder_name || updates.bill_holder_name || "—";
    const doc = customer.doc_holder_name || updates.doc_holder_name || "—";
    await sendOptions(
      remoteJid,
      `Antes de finalizar preciso confirmar:\n\n👤 Conta de luz: *${bill}*\n🪪 Documento: *${doc}*\n\nÉ a mesma pessoa?`,
      [
        { id: "titular_mesmo", title: "Mesma pessoa" },
        { id: "titular_outro", title: "Outro titular" },
        { id: "titular_corrigir", title: "Corrigir" },
      ],
    );
    return "";
  }
  const merged = { ...customer, ...updates };
  const next = await autoResolveCepIfNeeded(merged, updates);
  updates.conversation_step = next;
  return getReplyForStep(next, merged);
}

// ── Auto-resolve CEP from address data (avoid asking user) ──
async function autoResolveCepIfNeeded(merged: any, updates: any): Promise<string> {
  let step = getNextMissingStep(merged);

  // Caso A: já tem CEP válido salvo → pular ask_cep e completar endereço via ViaCEP direto
  if (step === "ask_cep") {
    const cepClean = String(merged.cep || "").replace(/\D/g, "");
    if (cepClean.length === 8 && !/000$/.test(cepClean)) {
      console.log(`🔍 CEP já existe (${cepClean}). Buscando endereço via ViaCEP direto...`);
      try {
        const end = await buscarEnderecoPorCep(cepClean);
        if (end) {
          if (!merged.address_street && end.logradouro) { merged.address_street = end.logradouro; updates.address_street = end.logradouro; }
          if (!merged.address_neighborhood && end.bairro) { merged.address_neighborhood = end.bairro; updates.address_neighborhood = end.bairro; }
          if (!merged.address_city && end.localidade) { merged.address_city = end.localidade; updates.address_city = end.localidade; }
          if (!merged.address_state && end.uf) { merged.address_state = end.uf; updates.address_state = end.uf; }
          merged.cep = cepClean;
          updates.cep = cepClean;
          console.log(`✅ Endereço auto-preenchido via CEP: ${end.logradouro || "(s/rua)"} - ${end.bairro || "(s/bairro)"} - ${end.localidade}/${end.uf}`);
          step = getNextMissingStep(merged);
        }
      } catch (e: any) {
        console.warn(`⚠️ Erro ViaCEP forward em autoResolve: ${e?.message}`);
      }
    }
  }

  // Caso B: tem endereço mas falta CEP → reverse lookup
  if (step === "ask_cep" && merged.address_city && merged.address_state && merged.address_street) {
    console.log("🔍 Auto-resolvendo CEP via ViaCEP antes de perguntar ao usuário...");
    try {
      const cepAuto = await buscarCepPorEndereco(merged.address_state, merged.address_city, merged.address_street);
      if (cepAuto && cepAuto.length === 8 && !/000$/.test(cepAuto)) {
        console.log(`✅ CEP auto-resolvido: ${cepAuto}`);
        merged.cep = cepAuto;
        updates.cep = cepAuto;
        step = getNextMissingStep(merged);
      } else {
        console.log("⚠️ ViaCEP não retornou CEP específico, perguntando ao usuário.");
      }
    } catch (e: any) {
      console.warn(`⚠️ Erro auto-resolve CEP: ${e?.message}`);
    }
  }
  // 🚀 Pular o botão "✅ Finalizar" — quando todos os campos estiverem prontos,
  // ir direto para "finalizando" (que dispara a submissão ao portal em 4939).
  // O case "ask_finalizar" continua existindo como fallback para leads antigos
  // que já estão parados nesse step.
  if (step === "ask_finalizar") return "finalizando";
  // 🚫 NUNCA pedir CEP ao cliente. Se OCR não pegou e ViaCEP não resolveu,
  // segue o fluxo silencioso (portal pode falhar depois — fallback humano).
  if (step === "ask_cep") {
    console.warn("⚠️ CEP não resolvido (OCR genérico + ViaCEP sem retorno) — seguindo sem pedir ao cliente (regra do produto).");
    const mock = { ...merged, cep: "01310100" };
    let nxt = getNextMissingStep(mock);
    if (nxt === "ask_cep") nxt = "ask_number";
    step = nxt;
  }
  return step;
}

// ── Reachability check tolerant a backends que rejeitam HEAD ──
// 2026-06-26: Supabase Storage e alguns CDNs retornam 400 em HEAD mesmo
// quando o objeto existe. Tenta HEAD; em qualquer falha tenta GET com
// `Range: bytes=0-0`. 2 tentativas com backoff curto antes de desistir.
async function urlExists(url: string): Promise<boolean> {
  const attempt = async (method: "HEAD" | "GET"): Promise<boolean> => {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 5000);
      const headers: Record<string, string> = {
        "User-Agent": "igreen-bot-mediacheck/1.0",
      };
      if (method === "GET") headers["Range"] = "bytes=0-0";
      const r = await fetch(url, { method, signal: ctrl.signal, headers });
      clearTimeout(timer);
      // 2xx = OK, 206 (partial) = OK, 304 = OK
      if (r.ok || r.status === 206 || r.status === 304) {
        try { await r.body?.cancel(); } catch (_) { /* noop */ }
        return true;
      }
      try { await r.body?.cancel(); } catch (_) { /* noop */ }
      return false;
    } catch {
      return false;
    }
  };
  // tentativa 1: HEAD
  if (await attempt("HEAD")) return true;
  // tentativa 2: GET range
  if (await attempt("GET")) return true;
  // backoff curto e mais 1 GET range
  await new Promise((r) => setTimeout(r, 500));
  return await attempt("GET");
}

const NON_NAME_RESPONSES = /^(oi|ola|olá|hey|opa|bom dia|boa tarde|boa noite|sim|nao|não|ok|tudo bem|pode|quero|cadastrar|humano|atendente|menu|reset|recomecar|recomeçar|nao sou eu|não sou eu|como funciona|me explica|o que é|que é isso|quanto custa|é caro|preço|valor|tem taxa|minha distribuidora|qual distribuidora|atende aqui|cidade|golpe|fraude|engana[cç][aã]o|enrola[cç][aã]o|spam|propaganda|virus|v[ií]rus|risco|seguro|confiavel|confiável|verdade|mentira|fake|falso|suspeito|pegadinha|robo|robô|bot|teste|testando|negativo|talvez|depende|nada|tanto faz|nao quero|não quero|cancelar|sair|parar|chega|esquece|esqueça|porque|pq|aff|hmm|hum|nossa|caramba|sei la|sei lá|nao sei|não sei)$/i;
const RE_GREETING_ONLY = /^(oi|ol[aá]|opa|bom dia|boa tarde|boa noite|hey)$/i;
// Reapresentação: "me chamo X", "meu nome é X", "sou (a|o) X", "aqui (é|eh) (a|o) X", "(eu )?sou X" — captura o primeiro nome.
const RE_SELF_INTRO = /(?:me\s+chamo|meu\s+nome\s+(?:é|eh|e)|aqui\s+(?:é|eh|e)\s+(?:o|a)|(?:eu\s+)?sou\s+(?:o|a))\s+([A-Za-zÀ-ÖØ-öø-ÿ]{2,30})/i;
// Lead recusa mandar foto da conta — aceita seguir sem.
const RE_REFUSE_BILL = /\b(n[aã]o\s+(?:tenho|quero|posso|vou)\s+(?:mandar|enviar|tirar|mostrar)|sem\s+(?:foto|conta|comprovante)|n[aã]o\s+(?:tenho|achei)\s+a\s+conta|conta\s+(?:n[aã]o|nao)\s+est[aá]\s+aqui|s[oó]\s+(?:o\s+)?valor)\b/i;

function buildMissingDocPrompt(label: string, merged: any): string {
  const missing = [
    !String(merged?.cpf || "").replace(/\D/g, "") ? "CPF" : "",
    !String(merged?.rg || "").trim() ? (label === "CNH" ? "RG/registro da CNH" : "RG") : "",
    !String(merged?.data_nascimento || "").trim() ? "data de nascimento" : "",
  ].filter(Boolean);
  if (missing.length <= 1 && missing[0] === "CPF") {
    return `Não consegui ler o CPF na ${label}. Digite os *11 números do CPF* para continuar:`;
  }
  return `Consegui ler o documento, mas alguns dados ficaram ilegíveis.\n\nMe envie em uma única mensagem:\n${missing.map((m) => `• ${m}`).join("\n")}`;
}

// Verbos/interrogativas que indicam PERGUNTA, não nome.
const RE_LOOKS_LIKE_QUESTION = /^(quanto|como|quando|onde|por que|porque|pq|o que|qual|sera|será|tem|posso|preciso|precisa|vou|vai|da|dá|nao|não|sim|ok|cade|cadê|quem|cmo)\b/i;

function normalizeLeadName(rawText: string | null | undefined): string | null {
  const rawWithPunct = String(rawText || "").trim();
  // 🚧 Pergunta nunca é nome — checa ANTES de remover pontuação.
  if (rawWithPunct.includes("?") || RE_LOOKS_LIKE_QUESTION.test(rawWithPunct)) {
    console.log(`[name-capture] ⏭️ rejeitado (question): "${rawWithPunct.slice(0, 40)}"`);
    return null;
  }
  const raw = rawWithPunct.replace(/[.!?,;:"']/g, "").replace(/\s+/g, " ");
  const looksLikeName =
    raw.length >= 2 &&
    raw.length <= 60 &&
    /^[A-Za-zÀ-ÖØ-öø-ÿ' ]+$/.test(raw) &&
    raw.split(/\s+/).length <= 4 &&
    !NON_NAME_RESPONSES.test(raw);
  if (!looksLikeName) {
    if (raw && raw.length > 0) {
      console.log(`[name-capture] ⏭️ rejeitado (stopword/length/non_alpha): "${raw.slice(0, 40)}"`);
    }
    return null;
  }
  const formatted = raw
    .toLowerCase()
    .split(/\s+/)
    .map((w) => (w.length > 2 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
  if (!isUsableCustomerName(formatted)) {
    console.log(`[name-capture] ⏭️ rejeitado (unusable): "${formatted.slice(0, 40)}"`);
    return null;
  }
  return formatted;
}

function isBogusCapturedName(name: string | null | undefined): boolean {
  if (!name) return false;
  if (NON_NAME_RESPONSES.test(String(name).trim())) return true;
  return !isUsableCustomerName(name);
}

function buildNotReadyReply(nomeRepresentante: string): string {
  return `Sem problema, vou respeitar seu tempo 😊\n\nSe quiser continuar depois, é só mandar *cadastrar* ou chamar ${nomeRepresentante}.`;
}

// ───────────────────────────────────────────────────────────────
// Anti-alucinação: nome OCR só sobrescreve nome confirmado se for muito similar
// ───────────────────────────────────────────────────────────────
const RG_HEADER_TERMS = /REP[ÚU]BLICA|FEDERATIVA|CARTEIRA|IDENTIDADE|MINIST[ÉE]RIO|NACIONAL|SECRETARIA|SEGURAN[ÇC]A|INSTITUTO|DETRAN|VALIDA EM TODO|REGISTRO GERAL/i;

/**
 * Fontes de nome consideradas "confiáveis" — uma vez setado, só pode ser
 * sobrescrito por confirmação explícita do usuário (editing_* / user_confirmed).
 */
const TRUSTED_NAME_SOURCES_LOCK = new Set(["user_confirmed", "ocr_conta", "ocr_doc"]);

/**
 * Decide o nome a usar dado OCR de doc.
 * Retorna null se OCR é alucinação OU se o nome atual veio de fonte confiável.
 * Fontes confiáveis (ocr_conta, ocr_doc, user_confirmed) só podem ser sobrescritas
 * via fluxo de edição explícito (editing_conta_nome / editing_doc_nome).
 */
function safeAssignName(currentName: string | null | undefined, currentSource: string | null | undefined, ocrName: string | null | undefined): string | null {
  if (!ocrName) return null;
  const cleaned = String(ocrName).trim().replace(/\s+/g, " ");
  if (cleaned.length < 5) return null;
  if (/\d/.test(cleaned)) return null;
  if (cleaned.split(/\s+/).length < 2) return null;
  if (RG_HEADER_TERMS.test(cleaned)) return null;
  const src = String(currentSource || "");
  const isOcrSource = src === "ocr_conta" || src === "ocr_doc";
  // Fonte confiável (outro OCR ou confirmação explícita do usuário) só pode
  // ser sobrescrita via fluxo de edição. Nome digitado (self_introduced/typed/null)
  // SEMPRE é sobrescrito pelo OCR — é o nome do titular real da conta/doc.
  if (currentName && String(currentName).trim().length >= 3 && TRUSTED_NAME_SOURCES_LOCK.has(src)) {
    if (isOcrSource || src === "user_confirmed") {
      // Sprint D-B9: log explícito quando OCR é descartado por lock — antes era silencioso
      console.warn(`[name-lock] OCR descartado: atual="${currentName}" (src=${src}) novo="${cleaned}" — use editing_*_nome para alterar`);
      return null;
    }
  }
  // Nome atual veio de OCR e é muito diferente: mantém (não confiamos no novo OCR)
  if (isOcrSource && currentName && String(currentName).trim().length >= 5) {
    if (nameLevSim(currentName, cleaned) < 0.7) {
      console.warn(`[name-lock] OCR rejeitado por baixa similaridade: atual="${currentName}" novo="${cleaned}" sim=${nameLevSim(currentName, cleaned).toFixed(2)}`);
      return null;
    }
  }
  return cleaned;
}

/**
 * Acha o próximo step ativo do fluxo customizado do consultor por position,
 * opcionalmente filtrando por step_type. Retorna null se não houver fluxo
 * configurado ou nenhum step compatível (caller usa fallback legado).
 */
async function findNextActiveFlowStep(
  supabase: any,
  consultantId: string | null | undefined,
  opts: { afterPosition?: number; stepType?: string; stepTypeIn?: string[]; variant?: string; flowId?: string } = {},
): Promise<{ id: string; step_key: string; step_type: string; position: number; transitions: any[]; message_text: string; slot_key: string | null } | null> {
  try {
    let flowId: string | null = opts.flowId || null;
    if (!flowId) {
      if (!consultantId) return null;
      const variant = opts.variant || "A";
      const flow = await resolveFlowId(supabase, consultantId, variant);
      if (!flow?.id) {
        console.warn(`[findNextActiveFlowStep] sem fluxo ativo consultant=${consultantId} variant=${variant}`);
        return null;
      }
      flowId = String((flow as any).id);
    }
    let q = supabase.from("bot_flow_steps")
      .select("id, step_key, step_type, position, transitions, message_text, slot_key")
      .eq("flow_id", flowId).eq("is_active", true)
      .order("position", { ascending: true });
    if (typeof opts.afterPosition === "number") q = q.gt("position", opts.afterPosition);
    if (opts.stepType) q = q.eq("step_type", opts.stepType);
    if (opts.stepTypeIn && opts.stepTypeIn.length) q = q.in("step_type", opts.stepTypeIn);
    const { data } = await q.limit(1);
    const row = Array.isArray(data) ? data[0] : null;
    return row ? {
      id: String(row.id),
      step_key: String(row.step_key),
      step_type: String(row.step_type),
      position: Number(row.position),
      transitions: Array.isArray((row as any).transitions) ? (row as any).transitions : [],
      message_text: String((row as any).message_text || ""),
      slot_key: (row as any).slot_key ? String((row as any).slot_key) : null,
    } : null;
  } catch (e) {
    console.warn("[findNextActiveFlowStep] erro:", (e as any)?.message || e);
    return null;
  }
}

// Heurística: a mensagem tem o formato esperado pelo step?
function isExpectedShape(step: string, text: string): boolean {
  const t = String(text || "").trim();
  if (!t) return false;
  const digits = t.replace(/\D/g, "");
  switch (step) {
    case "ask_cpf":
    case "editing_doc_cpf":
      return digits.length >= 11;
    case "ask_cep":
    case "editing_conta_cep":
      return digits.length >= 8;
    case "ask_birth_date":
    case "editing_doc_nascimento":
      return /\d{2}\/\d{2}\/\d{4}/.test(t);
    case "ask_phone":
    case "ask_phone_confirm":
      return digits.length >= 10;
    case "corrigir_celular_portal":
      return digits.length >= 10;
    case "ask_bill_value":
    case "editing_conta_valor":
      return /^[r\$\s]*\d{2,6}([\.,]\d{1,2})?\s*$/i.test(t);
    case "ask_installation_number":
    case "editing_conta_instalacao":
      return digits.length >= 7;
    case "ask_distribuidora":
      return t.length >= 2 && !/\?/.test(t);
    case "corrigir_instalacao_portal":
      return digits.length >= 7;
    case "ask_name":
    case "editing_conta_nome":
    case "editing_doc_nome":
      return t.length >= 3 && t.split(/\s+/).length >= 1 && !/\?/.test(t);
    case "ask_rg":
    case "editing_doc_rg":
      return digits.length >= 4;
    case "editing_conta_endereco":
    case "editing_conta_distribuidora":
      return t.length >= 3 && !/\?/.test(t);
    case "ask_email":
      return /@/.test(t);
    case "corrigir_email_portal": {
      const _at = t.indexOf("@");
      return _at >= 1 && _at < t.length - 1;
    }
    case "ask_number":
      return digits.length >= 1 && t.length <= 10;
    case "ask_complement":
      return true; // qualquer coisa serve
    case "editing_conta_menu":
      return /^[0-6]$/.test(t) || /\b(nome|valor|rua|endere[çc]o|cep|distribuidora|instala[çc][ãa]o|cancelar|voltar)\b/i.test(t);
    case "editing_doc_menu":
      return /^[0-4]$/.test(t) || /\b(nome|cpf|rg|nascimento|data|cancelar|voltar)\b/i.test(t);
    case "confirmando_dados_conta":
    case "confirmando_dados_doc":
    case "confirmar_titularidade":
    case "ask_tipo_documento":
      return /^(sim|s|nao|n[aã]o|n|ok|editar|3|2|1|✅|❌|✏️|mesma|outro|corrigir|titular_)/i.test(t);
    default:
      return false;
  }
}

// Steps onde QA semântico NUNCA deve disparar (cadastro/edição determinísticos)
const NO_QA_STEPS = new Set([
  "aguardando_conta", "processando_ocr_conta", "confirmando_dados_conta",
  "aguardando_doc_auto", "aguardando_doc_frente", "aguardando_doc_verso",
  "confirmando_dados_doc", "confirmar_titularidade", "ask_tipo_documento",
  "ask_name", "ask_cpf", "ask_rg", "ask_birth_date", "ask_phone", "ask_phone_confirm",
  "ask_email", "ask_cep", "ask_number", "ask_complement",
  "ask_installation_number", "ask_distribuidora", "ask_bill_value",
  "ask_doc_frente_manual", "ask_doc_verso_manual", "ask_contaunica", "ask_transferir_titularidade", "ask_finalizar",
  "finalizando", "portal_submitting", "aguardando_otp", "validando_otp", "otp_falhou", "otp_confirmar",
  "aguardando_assinatura", "complete", "aguardando_humano",
  "aguardando_avaliacao_atendimento", "atendimento_finalizado",
  // Loop de correção Portal 2 — steps determinísticos, QA semântico não dispara.
  "corrigir_celular_portal", "corrigir_email_portal", "corrigir_instalacao_portal", "corrigir_documento_portal", "corrigir_documento_verso_portal",
  "editing_conta_menu", "editing_conta_nome", "editing_conta_endereco",
  "editing_conta_cep", "editing_conta_distribuidora", "editing_conta_instalacao", "editing_conta_valor",
  "editing_doc_menu", "editing_doc_nome", "editing_doc_cpf", "editing_doc_rg",
  "editing_doc_nascimento",
]);

export async function runBotFlow(ctx: BotContext): Promise<BotResult> {
  const {
    supabase,
    sender: { sendText, sendButtons, sendMedia },
    customer,
    consultorId,
    nomeRepresentante,
    nomeAssistente,
    remoteJid,
    phone,
    messageText,
    buttonId,
    isFile,
    isButton,
    hasImage,
    hasDocument,
    hasAudio,
    imageMessage,
    documentMessage,
    message,
    messageId,
    fileUrl,
    fileBase64,
    geminiApiKey,
  } = ctx;

  // ═══════════════════════════════════════════════════════════════════
  // 🧠 FLUXO B — desativado. Cérebro IA (responderComCerebro) já respondeu
  // antes de chegar aqui (evolution-webhook/index.ts). Vendedora apagada.
  // ═══════════════════════════════════════════════════════════════════


  // ═══════════════════════════════════════════════════════════════════
  // 🛟 respondAndReentry — fallback universal pra mensagens fora do esperado.
  // Responde a dúvida (FAQ → IA → fallback) + reconduz ao passo atual repetindo
  // SÓ a pergunta final do prompt. Nunca silencia, nunca lança exceção.
  // Só pausa+handoff após 5 desvios no mesmo lead (com mensagem de cortesia).
  // ═══════════════════════════════════════════════════════════════════
  const _extractQuestionTail = extractQuestionTail;

  async function respondAndReentry(opts: {
    reason: "midflow_qa_miss" | "off_topic_collect" | "custom_step_no_match";
    questionText: string;
    reentryFull?: string;
  }): Promise<BotResult> {
    const { reason, questionText } = opts;
    const stepNow = String((customer as any).conversation_step || "");
    let reentryFull = opts.reentryFull || "";
    let reentryTail = "";
    if (reentryFull) {
      reentryTail = _extractQuestionTail(reentryFull);
    } else {
      const resolved = await resolveStepReentry(supabase, customer, stepNow, nomeRepresentante);
      reentryFull = resolved.full;
      reentryTail = resolved.tail;
    }

    let answer = "";
    let source: "faq" | "ai" | "fallback" = "fallback";

    // 1) FAQ
    try {
      const flowRow = await resolveFlowId(supabase, customer.consultant_id, (customer as any)?.flow_variant || "A");
      if (flowRow?.id) {
        const qa = await matchQA(supabase, (flowRow as any).id, customer.consultant_id, questionText);
        if (qa && (qa.text || qa.mediaUrls.length)) {
          for (const m of qa.mediaUrls) {
            try { await sendMedia(remoteJid, m.url, "", m.kind, Number((m as any).duration_sec || 0) || undefined); } catch (_) { /* segue */ }
          }
          answer = (qa.text || "").trim();
          if (answer) {
            const { formatFaqReply } = await import("../../_shared/format-reply.ts");
            answer = formatFaqReply(answer);
          }
          source = "faq";
        }
      }
    } catch (e) { console.warn("[respondAndReentry] FAQ falhou:", (e as any)?.message); }

    // Detour + handoff suave após 8 desvios
    const detourNext = Number((customer as any).detour_count || 0) + 1;
    const patch: Record<string, any> = { detour_count: detourNext };
    let courtesyTail = "";

    // 2) Orquestrador + RAG quando FAQ não casou (Fluxo D bypassa Cérebro no topo)
    // KB-only: sem GPT-5.5, mas consulta base gravada (lookup + RAG). FAQ hit = grátis.
    let kbOnly = true;
    try {
      const { isKbOnlyMode } = await import("../../_shared/ai-decisions.ts");
      kbOnly = await isKbOnlyMode();
    } catch (_) { /* fail-safe: mantém ligado */ }

    if (!answer && questionText.trim()) {
      try {
        const { resolveKnowledgeAnswer } = await import("../../_shared/bot/kb-answer.ts");
        const kb = await resolveKnowledgeAnswer(supabase, {
          question: questionText,
          consultantId: customer.consultant_id,
          leadName: safeFirstNameForAddress((customer as any).name, (customer as any).name_source),
          currentStepLabel: stepNow || "Cadastro",
        });
        if (kb.text) {
          answer = kb.text;
          source = kb.source === "kb" ? "faq" : "ai";
          patch.ai_followups_count = Number((customer as any).ai_followups_count || 0) + 1;
          console.log(`[respondAndReentry] knowledge via ${kb.source} kbOnly=${kbOnly}`);
        }
      } catch (e) {
        console.warn("[respondAndReentry] knowledge falhou:", (e as Error).message);
      }
    }

    if (!answer && questionText.trim() && !kbOnly) {
      try {
        const { data: hist } = await supabase
          .from("conversations")
          .select("message_direction, message_text, created_at")
          .eq("customer_id", customer.id)
          .order("created_at", { ascending: false })
          .limit(8);
        const recentHistory = ((hist as any[]) || [])
          .slice()
          .reverse()
          .map((r) => `${r.message_direction === "inbound" ? "Lead" : "Bot"}: ${String(r.message_text || "").slice(0, 240)}`)
          .join("\n");

        const { runOrchestrator } = await import("../../_shared/ai-orchestrator.ts");
        const orch = await runOrchestrator({
          supabase,
          customer,
          consultantId: customer.consultant_id,
          message: questionText,
          step: stepNow,
          stepGoal: reentryTail || undefined,
          history: recentHistory,
          isButton: false,
          hasMedia: false,
        });

        const orchText = (orch.reply || "").trim();
        if (orchText && orch.confidence >= 0.55) {
          answer = orchText;
          source = "ai";
          patch.ai_followups_count = Number((customer as any).ai_followups_count || 0) + 1;
          console.log(
            `[respondAndReentry] orchestrator route=${orch.route} conf=${orch.confidence.toFixed(2)} chain=${orch.modelChain.join("→")}`,
          );
          if (orch.shouldHandoff) {
            patch.bot_paused = true;
            patch.bot_paused_reason = "ai_handoff_duvidas";
            patch.bot_paused_at = new Date().toISOString();
            courtesyTail = "\n\n🙌 Vou chamar alguém do time para te atender pessoalmente — em instantes alguém responde por aqui.";
            try {
              const { notifyHandoff } = await import("../../_shared/notify-consultant.ts");
              await notifyHandoff(supabase, customer, "IA detectou necessidade de humano").catch(() => {});
            } catch (_) { /* noop */ }
          }
        }
      } catch (e) {
        console.warn("[respondAndReentry] orchestrator falhou:", (e as Error).message);
      }
    }

    if (!answer) {
      source = "fallback";
    }

    // 🛒 Detecção de intenção de compra — só AVANÇO (status/pergunta não disparam incentivo)
    const { classifyLeadIntent } = await import("../../_shared/bot/purchase-intent.ts");
    if (classifyLeadIntent(questionText) === "advance") {
      console.log(`[respondAndReentry] 🛒 purchase intent detected — resetting detour`);
      try {
        await supabase.from("customers").update({ detour_count: 0 }).eq("id", customer.id);
      } catch (_) { /* noop */ }
      // Responde com incentivo e reapresenta botões (não fica silencioso)
      const firstName = safeFirstNameForAddress((customer as any).name, (customer as any).name_source);
      const encourageText = firstName
        ? `Ótimo, ${firstName}! Vamos lá então 😊`
        : `Ótimo! Vamos lá então 😊`;
      try { await sendText(remoteJid, encourageText); } catch (_) { /* noop */ }
      try {
        await supabase.from("conversations").insert({
          customer_id: customer.id, message_direction: "outbound",
          message_text: encourageText, message_type: "text", conversation_step: stepNow,
        });
      } catch (_) { /* noop */ }
      // Reapresenta botões para o lead avançar
      try {
        const { reemitStepButtons } = await import("../../_shared/bot/reemit-buttons.ts");
        await reemitStepButtons({
          supabase, customerId: customer.id, consultantId: customer.consultant_id,
          flowVariant: (customer as any)?.flow_variant || "A", stepKey: stepNow,
          remoteJid, sendButtons, sendText,
        });
      } catch (_) { /* noop */ }
      return { reply: "", updates: { __inline_sent: true, detour_count: 0 } as any };
    }

    if (detourNext >= 5) {
      patch.bot_paused = true;
      patch.bot_paused_reason = "muitas_duvidas";
      patch.bot_paused_at = new Date().toISOString();
      courtesyTail = "\n\n🙌 Vou chamar alguém do time para te atender pessoalmente — em instantes alguém responde por aqui.";
      try {
        await supabase.from("bot_handoff_alerts").insert({
          customer_id: customer.id,
          consultant_id: customer.consultant_id,
          reason: "muitas_duvidas",
          user_message: String(questionText).slice(0, 300),
          phone: (customer as any).phone_whatsapp || null,
          metadata: { detour_count: detourNext, source, trigger: reason, step: stepNow },
        } as any);
      } catch (e) { console.warn("[respondAndReentry] handoff alert falhou:", (e as any)?.message); }
      try {
        notifyHandoff(
          customer.consultant_id,
          {
            id: customer.id,
            name: (customer as any).name,
            name_source: (customer as any).name_source,
            phone_whatsapp: (customer as any).phone_whatsapp,
            conversation_step: stepNow,
          },
          questionText,
          "muitas_duvidas",
        ).catch(() => {});
      } catch (_) { /* noop */ }
    }
    try { await supabase.from("customers").update(patch).eq("id", customer.id); } catch (_) { /* noop */ }

    // Telemetria leve
    try {
      await supabase.from("bot_step_transitions").insert({
        customer_id: customer.id,
        consultant_id: customer.consultant_id,
        from_step: stepNow,
        to_step: stepNow,
        reason: `recovery:${reason}:${source}`,
      } as any);
    } catch (_) { /* noop */ }

    // Sempre reconduz à ação pendente concreta (ex: confirmar telefone), mesmo
    // quando a IA respondeu — a IA esclarece a dúvida e o sistema reapresenta o
    // que falta fazer. Só não reapresenta em handoff (bot pausado).
    const reentryLine = reentryTail && !patch.bot_paused ? `\n\n📋 Voltando: ${reentryTail}` : "";
    const finalMsg = answer
      ? `${answer}${reentryLine}${courtesyTail}`
      : `${reentryFull || reentryTail || ""}${courtesyTail}`.trim();

    try { await sendText(remoteJid, finalMsg); } catch (e) {
      console.warn("[respondAndReentry] sendText falhou:", (e as any)?.message);
    }
    try {
      await supabase.from("conversations").insert({
        customer_id: customer.id, message_direction: "outbound",
        message_text: finalMsg, message_type: "text", conversation_step: stepNow,
      });
    } catch (_) { /* noop */ }

    // 🔁 Reemite botões/lista numerada após FAQ/IA
    try {
      if (detourNext < 8 && !patch.bot_paused) {
        const { reemitStepButtons } = await import("../../_shared/bot/reemit-buttons.ts");
        await reemitStepButtons({
          supabase,
          customerId: customer.id,
          consultantId: customer.consultant_id,
          flowVariant: (customer as any)?.flow_variant || "A",
          stepKey: stepNow,
          remoteJid,
          sendButtons,
          sendText,
        });
      }
    } catch (e) { console.warn("[respondAndReentry] button re-emission failed:", (e as Error).message); }

    console.log(`[respondAndReentry] reason=${reason} source=${source} detour=${detourNext} step=${stepNow}`);
    return { reply: "", updates: { ...patch, __inline_sent: true } as any };
  }

  // ═══════════════════════════════════════════════════════════════════
  // 🔁 AUTO-RESUME: se o bot foi pausado por "lead_nao_pronto" / "lead_quer_pensar"
  // e o lead voltou a falar, despausa automaticamente. Vendedor humano não fica mudo.
  // ═══════════════════════════════════════════════════════════════════
  if (
    (customer as any).bot_paused &&
    ["lead_nao_pronto", "lead_quer_pensar"].includes(String((customer as any).bot_paused_reason || ""))
  ) {
    console.log(`[auto-resume] Despausando bot — lead voltou a falar (motivo: ${(customer as any).bot_paused_reason})`);
    try {
      await supabase
        .from("customers")
        .update({ bot_paused: false, bot_paused_reason: null, bot_paused_at: null })
        .eq("id", customer.id);
    } catch (e) {
      console.warn("[auto-resume] update falhou:", (e as any)?.message);
    }
    (customer as any).bot_paused = false;
    (customer as any).bot_paused_reason = null;
    (customer as any).bot_paused_at = null;
    if ((customer as any).conversation_step === "aguardando_humano") {
      (customer as any).conversation_step = "qualificacao";
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // 🪪 NOME — sobrescreve se o lead se reapresentou ("me chamo X", "sou a X", etc.)
  // Resolve o bug do "Olá, Pedro" quando o lead na verdade é Larissa.
  // ═══════════════════════════════════════════════════════════════════
  if (messageText && !isFile && !isButton) {
    const intro = String(messageText).match(RE_SELF_INTRO);
    if (intro && intro[1]) {
      const candidate = normalizeLeadName(intro[1]);
      if (candidate) {
        const currentFirst = String((customer as any).name || "").trim().split(/\s+/)[0]?.toLowerCase();
        if (currentFirst !== candidate.toLowerCase()) {
          console.log(`[name-overwrite] "${(customer as any).name || "—"}" → "${candidate}" (auto-introdução)`);
          try {
            await supabase
              .from("customers")
              .update({ name: candidate, name_source: "self_introduced" })
              .eq("id", customer.id);
          } catch (e) {
            console.warn("[name-overwrite] update falhou:", (e as any)?.message);
          }
          (customer as any).name = candidate;
          (customer as any).name_source = "self_introduced";
        }
      }
    }
  }


  // ═══════════════════════════════════════════════════════════════════
  // 🎯 MULTI-FIELD EXTRACTOR — captura nome/CEP/valor/CPF/email/tel
  // de uma mensagem livre, preenchendo slots vazios (Sprint E1).
  // Só preenche o que tá vazio — não sobrescreve campos fortes (manual/OCR).
  // ═══════════════════════════════════════════════════════════════════
  if (messageText && !isFile && !isButton) {
    try {
      const multi = extractMultiField(messageText);
      const patch = buildMultiFieldPatch(customer as any, multi);
      if (Object.keys(patch).length > 0) {
        console.log(`[multi-extract] captured ${Object.keys(patch).join(",")} from livre msg`);
        await supabase.from("customers").update(patch).eq("id", customer.id);
        Object.assign(customer as any, patch);
      }
    } catch (e) {
      console.warn("[multi-extract] falhou:", (e as Error).message);
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // 🔀 FLOW ROUTER — detecta pedido de troca de fluxo (PJ / Licenciada / etc).
  // Se já tem switch pendente, processa afirmação/negação. Senão, propõe troca.
  // Sprint E2.
  // ═══════════════════════════════════════════════════════════════════
  if (messageText && !isFile && !isButton) {
    try {
      const pending = String((customer as any).pending_flow_switch || "").trim();
      const stepNow = String((customer as any).conversation_step || "");
      const norm = messageText.toLowerCase().trim();

      if (pending) {
        const isYes = /^(sim|s|claro|pode|positivo|isso|quero|vamos|bora|👍|✅|1)\b/.test(norm);
        const isNo = /^(n[ãa]o|n|nao|negativo|deixa|👎|❌|2)\b/.test(norm);
        if (isYes) {
          console.log(`[flow-router] confirmed switch → ${pending}`);
          await supabase.from("customers").update({
            pending_flow_switch: null,
            conversation_step: "boas_vindas",
          }).eq("id", customer.id);
          (customer as any).pending_flow_switch = null;
          (customer as any).conversation_step = "boas_vindas";
          try {
            await supabase.from("bot_handoff_alerts").insert({
              customer_id: customer.id,
              consultant_id: customer.consultant_id,
              reason: "flow_switch_confirmed",
              user_message: messageText.slice(0, 200),
            } as any);
          } catch {}
          try {
            await supabase.from("bot_step_transitions").insert({
              customer_id: customer.id,
              consultant_id: customer.consultant_id,
              from_step: stepNow,
              to_step: "boas_vindas",
              intent: `flow_router:${pending}`,
            });
          } catch {}
          return { reply: `Beleza! Vou te atender pelo fluxo **${pending}**. 🙌\n\nMe conta — em que posso te ajudar primeiro?`, updates: {} };
        }
        if (isNo) {
          console.log(`[flow-router] rejected switch → ${pending}`);
          await supabase.from("customers").update({ pending_flow_switch: null }).eq("id", customer.id);
          (customer as any).pending_flow_switch = null;
          try {
            await supabase.from("bot_handoff_alerts").insert({
              customer_id: customer.id,
              consultant_id: customer.consultant_id,
              reason: "flow_switch_rejected",
            } as any);
          } catch {}
          return { reply: "Tranquilo, segue aqui mesmo então! 😉 Onde a gente tava?", updates: {} };
        }
        // sem sim/não claro → segue fluxo normal (limpa o pending pra não travar)
        await supabase.from("customers").update({ pending_flow_switch: null }).eq("id", customer.id);
        (customer as any).pending_flow_switch = null;
      } else {
        const candidate = await detectFlowSwitch(supabase, customer.consultant_id, messageText, null);
        if (candidate) {
          // 🛡️ Guard global: se o cliente está no PIPELINE de cadastro, NUNCA
          // trocar de fluxo por palavra-chave. Caso real: lead Flow D enviou um
          // CEP no passo ask_email e o "13354016" disparou Flow B (simulação),
          // resetando todo o cadastro. Mantém o handler determinístico no
          // controle até portal_submitting / handoff.
          {
            const curStep = String((customer as any).conversation_step || "");
            const stripped = curStep.startsWith("flow:") ? curStep.slice(5) : curStep;
            if (CADASTRO_STEPS.has(stripped)) {
              console.log(`[flow-router] skipped_router=in_cadastro_pipeline step=${stripped} kw="${candidate.matched_keyword}" target=${candidate.target_flow_key}`);
              try {
                await supabase.from("engine_logs").insert({
                  customer_id: customer.id,
                  event: "skipped_router",
                  payload: { reason: "in_cadastro_pipeline", step: stripped, matched_keyword: candidate.matched_keyword, target: candidate.target_flow_key },
                } as any);
              } catch {}
              // segue silenciosamente para o handler do step atual
            } else {
          // 🚀 ATIVAÇÃO IMEDIATA DO FLUXO A POR PALAVRA-CHAVE (sem sim/não).
          // Só ativa se: (a) não está já em A, (b) não está no meio de um passo de cadastro.
          if (candidate.target_flow_key === "fluxo_a_cadastro") {
            const curVariant = String((customer as any).flow_variant || "").toUpperCase();
            const curStep = String((customer as any).conversation_step || "");
            const stripped = curStep.startsWith("flow:") ? curStep.slice(5) : curStep;
            const inCadastro = CADASTRO_STEPS.has(stripped);
            if (curVariant !== "A" && !inCadastro) {
              console.log(`[flow-router] activating Fluxo A (kw="${candidate.matched_keyword}") customer=${customer.id}`);
              await supabase.from("customers").update({
                flow_variant: "A",
                conversation_step: "aguardando_conta",
                pending_flow_switch: null,
                sales_phase: "abertura",
                bot_paused: false,
              }).eq("id", customer.id);
              (customer as any).flow_variant = "A";
              (customer as any).conversation_step = "aguardando_conta";
              try {
                await supabase.from("bot_step_transitions").insert({
                  customer_id: customer.id,
                  consultant_id: customer.consultant_id,
                  from_step: curStep || null,
                  to_step: "aguardando_conta",
                  intent: `flow_router:fluxo_a_cadastro:${candidate.matched_keyword}`,
                });
              } catch {}
              return {
                reply: "Perfeito! 🙌\n\n📸 Me envia agora uma *foto da sua conta de luz* (fatura do mês atual ou a anterior).💚",
                updates: {},
              };
            }
            // já está em A ou no cadastro — ignora silenciosamente
          } else {
            console.log(`[flow-router] proposing switch → ${candidate.target_flow_key} (kw="${candidate.matched_keyword}")`);
            await supabase.from("customers").update({ pending_flow_switch: candidate.target_flow_key }).eq("id", customer.id);
            (customer as any).pending_flow_switch = candidate.target_flow_key;
            try {
              await supabase.from("bot_handoff_alerts").insert({
                customer_id: customer.id,
                consultant_id: customer.consultant_id,
                reason: "flow_switch_requested",
                user_message: messageText.slice(0, 200),
              } as any);
            } catch {}
            return {
              reply: `Vi que você quer falar sobre **${candidate.target_flow_label}** — quer que eu mude pra esse atendimento? (responde *sim* ou *não*)`,
              updates: {},
            };
          }
            } // /else (not in cadastro)
          } // /guard block
        }
      }
    } catch (e) {
      console.warn("[flow-router] falhou:", (e as Error).message);
    }
  }


  // ═══════════════════════════════════════════════════════════════════
  // 🤔 MIDFLOW QA — cliente faz pergunta no meio do cadastro
  // Aditivo, gated por env MIDFLOW_QA_ENABLED (default "true").
  // Se a mensagem parece pergunta e casa com a FAQ do consultor:
  //   1) responde a FAQ
  //   2) anexa "gancho" do step atual (não muda conversation_step)
  //   3) incrementa detour_count; 3+ sem progresso → handoff humano
  // Se NÃO casa → não faz nada (fluxo segue como hoje, zero efeito).
  // ═══════════════════════════════════════════════════════════════════
  try {
    const midflowEnabled = (Deno.env.get("MIDFLOW_QA_ENABLED") ?? "true").toLowerCase() !== "false";
    const { isCadastroStepForMidflowQa } = await import("../../_shared/bot/kb-answer.ts");
    const inCadastro = isCadastroStepForMidflowQa(String((customer as any).conversation_step || ""));
    if (
      midflowEnabled &&
      inCadastro &&
      messageText && !isFile && !isButton &&
      detectQuestionIntent(messageText)
    ) {
      const flowRow = await resolveFlowId(supabase, customer.consultant_id, (customer as any)?.flow_variant || "A");
      if (flowRow?.id) {
        const qa = await matchQA(supabase, (flowRow as any).id, customer.consultant_id, messageText);
        if (qa && (qa.text || qa.mediaUrls.length)) {
          console.log(`[midflow-qa] hit=true step="${(customer as any).conversation_step}" detour=${(customer as any).detour_count || 0}`);
          // Envia mídias da FAQ (se houver)
          for (const m of qa.mediaUrls) {
            try { await sendMedia(remoteJid, m.url, "", m.kind, Number((m as any).duration_sec || 0) || undefined); } catch (_) { /* noop */ }
          }
          const stepKey = String((customer as any).conversation_step || "");
          const { full: reentry } = await resolveStepReentry(supabase, customer, stepKey, nomeRepresentante);
          const text = [qa.text, reentry].filter(Boolean).join("\n\n");

          // Threshold 5 desvios + handoff alert visível ao consultor
          const detourNext = Number((customer as any).detour_count || 0) + 1;
          const patch: Record<string, any> = { detour_count: detourNext };
          if (detourNext >= 5) {
            patch.bot_paused = true;
            patch.bot_paused_reason = "muitas_duvidas";
            patch.bot_paused_at = new Date().toISOString();
            try {
              await supabase.from("bot_handoff_alerts").insert({
                customer_id: customer.id,
                consultant_id: customer.consultant_id,
                reason: "muitas_duvidas",
                metadata: { detour_count: detourNext, last_question: messageText.slice(0, 200) },
              });
            } catch (e) { console.warn("[midflow-qa] handoff alert falhou:", (e as Error).message); }
          }
          try { await supabase.from("customers").update(patch).eq("id", customer.id); } catch (_) {}

          // Reemite botões do step após a FAQ (se não vai para handoff).
          // Envia o texto inline aqui para garantir ordem: FAQ → botões.
          if (detourNext < 8 && text) {
            try {
              await sendText(remoteJid, text);
              await supabase.from("conversations").insert({
                customer_id: customer.id, message_direction: "outbound",
                message_text: text, message_type: "text", conversation_step: stepKey,
              });
            } catch (_) { /* noop */ }
            try {
              const { reemitStepButtons } = await import("../../_shared/bot/reemit-buttons.ts");
              await reemitStepButtons({
                supabase, customerId: customer.id, consultantId: customer.consultant_id,
                flowVariant: (customer as any)?.flow_variant || "A", stepKey,
                remoteJid, sendButtons, sendText,
              });
            } catch (_) { /* noop */ }
            return { reply: "", updates: { __inline_sent: true } as any };
          }
          return { reply: text, updates: { __inline_sent: qa.mediaUrls.length > 0 || undefined } as any };
        } else {
          console.log(`[midflow-qa] hit=false step="${(customer as any).conversation_step}" → respondAndReentry (IA + reentry)`);
          return await respondAndReentry({
            reason: "midflow_qa_miss",
            questionText: messageText,
          });
        }
      }
    } else if (
      midflowEnabled && inCadastro && messageText && !isFile && !isButton &&
      Number((customer as any).detour_count || 0) > 0
    ) {
      // Mensagem não é pergunta → cliente voltou ao fluxo: zera detour_count.
      try {
        await supabase.from("customers").update({ detour_count: 0 }).eq("id", customer.id);
        (customer as any).detour_count = 0;
      } catch (_) { /* noop */ }
    }
  } catch (e) {
    console.warn("[midflow-qa] falhou (seguindo fluxo normal):", (e as any)?.message);
  }


  // ═══════════════════════════════════════════════════════════════════
  // HELPER: Evolution NÃO usa botão (botões reais só no Whapi).
  // Envia mensagem + opções numeradas como texto puro.
  // ═══════════════════════════════════════════════════════════════════
  async function sendOptions(jid: string, msg: string, options: { id: string; title: string }[]): Promise<boolean> {
    const textWithOptions = `${msg}\n\n${options.map((b, i) => `*${i + 1}.* ${b.title}`).join("\n")}\n\n_Digite o número da opção desejada._`;
    return sendText(jid, textWithOptions);
  }


  // ═══════════════════════════════════════════════════════════════════
  // 🎯 Dispatcher genérico: envia o que está configurado em /admin/fluxos
  // para um step específico (Flow Builder).
  //   1) bot_flow_steps (flow_id, step_key) → message_text, slot_key, media_order
  //   2) ai_media_library (consultant_id, slot_key) → mídias reais (kind/url)
  //   3) Monta lista [texto + mídias] e ordena pela ordem configurada
  //      (media_order do step → flow_step_media_order do consultor →
  //      fallback global text → audio → video → image → document).
  //   4) Envia respeitando dedup por cliente e pausa proporcional entre mídias.
  // Texto suporta variáveis: {nome}, {nome_completo}, {representante},
  // {valor}, {economia_mensal}, {economia_anual}. Se não houver nada
  // configurado, NÃO inventa texto — apenas retorna false.
  // ═══════════════════════════════════════════════════════════════════
  async function dispatchStepFromFlow(stepKey: string, extraVars: Record<string, string> = {}): Promise<boolean> {
    if (!customer?.consultant_id) return false;
    try {
      // Anti-repetição reforçado: olha os últimos 8 outbounds (não só 1) e
      // normaliza o prefixo "flow:" dos dois lados — pega passos custom + legacy.
      try {
        const sinceIso = new Date(Date.now() - 10 * 60_000).toISOString();
        const { data: recentOuts } = await supabase
          .from("conversations")
          .select("conversation_step, created_at")
          .eq("customer_id", customer.id)
          .eq("message_direction", "outbound")
          .gte("created_at", sinceIso)
          .order("created_at", { ascending: false })
          .limit(8);
        const norm = (v: any) => String(v || "").replace(/^flow:/, "");
        const target = norm(stepKey);
        const hit = ((recentOuts as any[]) || []).find((r) => norm(r.conversation_step) === target);
        if (hit) {
          const ageMs = Date.now() - new Date((hit as any).created_at).getTime();
          console.log(`[dispatch:${stepKey}] skip — já enviado há ${Math.round(ageMs/1000)}s (anti-rep reforçado)`);
          return true;
        }
      } catch (_e) { /* ignora — anti-rep é best-effort */ }

      // R1 (2026-06-05): advisory lock por (customer, step) — fecha race
      // condition entre 2 webhooks concorrentes do Evolution.
      try {
        const { data: gotLock } = await supabase.rpc("try_lock_step_dispatch", {
          p_customer_id: customer.id,
          p_step_key: stepKey,
        });
        if (gotLock === false) {
          console.log(`[dispatch:${stepKey}] 🔒 lock ocupado por outro webhook — skip`);
          return true;
        }
      } catch (e) {
        console.warn(`[dispatch:${stepKey}] try_lock_step_dispatch falhou (segue sem lock):`, (e as any)?.message);
      }

      const flow = await resolveFlowId(supabase, customer.consultant_id, (customer as any)?.flow_variant || "A");
      if (!flow?.id) return false;
      // mediaOwnerId: em sync_mode='public', mídias e flow_step_media_order vêm
      // do dono do flow público (Super Admin). Garante paridade 100% entre
      // todos os consultores em modo público.
      const { resolveMediaOwnerId } = await import("../../_shared/resolve-flow.ts");
      const mediaOwnerId = await resolveMediaOwnerId(
        supabase,
        customer.consultant_id,
        (customer as any)?.flow_variant || "A",
      );

      const { data: stepRow } = await supabase
        .from("bot_flow_steps")
        .select("step_key, slot_key, message_text, media_order, captures, transitions, step_type")
        .eq("flow_id", (flow as any).id)
        .eq("step_key", stepKey)
        .maybeSingle();
      if (!stepRow) {
        console.log(`[dispatch:${stepKey}] step não configurado no Flow Builder — nada para enviar`);
        return false;
      }

      // R6 (2026-06-05): step que depende de valor_conta NÃO pode disparar sem
      // a captura — antes vazava "{{economia_range}}" literal. Detecta pelo
      // texto referenciando as chaves de economia/valor.
      const _stepText = String((stepRow as any).message_text || "");
      const _needsBill = /\{\{?\s*(valor_conta|economia_range|economia_faixa|economia_mensal|economia_anual|valor)\s*\}?\}/i.test(_stepText);
      const _hasBill = Number((customer as any).electricity_bill_value || 0) >= 30;
      if (_needsBill && !_hasBill) {
        console.warn(`[dispatch:${stepKey}] bloqueado: step exige valor_conta mas lead não tem (electricity_bill_value=${(customer as any).electricity_bill_value}). Redirecionando para aguardando_conta.`);
        try {
          await supabase
            .from("customers")
            .update({ conversation_step: "aguardando_conta", updated_at: new Date().toISOString() })
            .eq("id", customer.id);
        } catch (_) { /* best-effort */ }
        try {
          const nudge = `Antes de calcular sua economia, me conta: *quanto vem em média a sua conta de luz por mês?* 💡`;
          await sendText(remoteJid, nudge);
        } catch (_) { /* segue */ }
        return false;
      }

      // ─── AI ANSWER MODE: passos de "esclarecer dúvidas" ──────────────
      // Espelho da lógica do whapi-webhook: passos *duvid* ou slot
      // "esclarecer_duvidas" respondem via Gemini 3.1 Pro com texto puro
      // (sem áudio/vídeo/imagem), usando a última pergunta do lead + KB.
      const _slot = String((stepRow as any).slot_key || "").toLowerCase();
      const _sk = String((stepRow as any).step_key || stepKey).toLowerCase();
      const isAiAnswerStep =
        _slot === "esclarecer_duvidas" ||
        (/duvid/.test(_sk) && _sk !== "duvidas_pos_club");
      if (isAiAnswerStep) {
        // ── Limite de perguntas (fallback: { mode: "ai_limit", max_questions, then })
        try {
          const fb: any = (stepRow as any)?.fallback ?? null;
          if (fb && fb.mode === "ai_limit") {
            const maxQ = Math.max(1, Number(fb.max_questions ?? 3));
            const since = (customer as any)?.last_step_advanced_at || null;
            let q = supabase
              .from("conversations")
              .select("id", { count: "exact", head: true })
              .eq("customer_id", customer.id)
              .eq("message_direction", "inbound")
              .eq("conversation_step", stepKey);
            if (since) q = q.gte("created_at", since);
            const { count } = await q;
            const askedCount = Number(count || 0);
            console.log(`[dispatch:${stepKey}] ai_limit check: ${askedCount}/${maxQ} perguntas (then=${fb.then})`);
            if (askedCount >= maxQ) {
              const then = String(fb.then || "humano");
              if (then === "humano") {
                await supabase
                  .from("customers")
                  .update({ bot_paused: true, bot_paused_reason: "ai_limit_atingido" })
                  .eq("id", customer.id);
                try {
                  const { notifyHandoff } = await import("../../_shared/notify-consultant.ts");
                  await notifyHandoff(supabase, customer, `Limite de ${maxQ} perguntas IA atingido no passo "${stepKey}"`).catch(() => {});
                } catch (_) { /* best-effort */ }
                const firstName = safeFirstNameForAddress((customer as any).name, (customer as any).name_source);
                const msg = firstName
                  ? `${firstName}, vou te conectar com um especialista agora para tirar suas dúvidas com calma 🙌`
                  : "Vou te conectar com um especialista agora para tirar suas dúvidas com calma 🙌";
                await sendText(remoteJid, msg);
                await supabase.from("conversations").insert({
                  customer_id: customer.id,
                  message_direction: "outbound",
                  message_text: msg,
                  message_type: "text",
                  conversation_step: stepKey,
                });
                return true;
              }
              if (then === "next") {
                const { data: nextStep } = await supabase
                  .from("bot_flow_steps")
                  .select("step_key, position")
                  .eq("flow_id", (flow as any).id)
                  .eq("is_active", true)
                  .gt("position", 0)
                  .order("position", { ascending: true });
                const current = (nextStep as any[])?.find((s) => s.step_key === stepKey);
                const next = current
                  ? (nextStep as any[])?.find((s) => s.position > current.position)
                  : null;
                if (next?.step_key) {
                  console.log(`[dispatch:${stepKey}] ai_limit → next=${next.step_key}`);
                  await supabase
                    .from("customers")
                    .update({ conversation_step: next.step_key, last_step_advanced_at: new Date().toISOString() })
                    .eq("id", customer.id);
                  return true;
                }
              }
            }
          }
        } catch (e) {
          console.warn(`[dispatch:${stepKey}] ai_limit check falhou:`, (e as Error).message);
        }

        try {
          const { data: lastInbound } = await supabase
            .from("conversations")
            .select("message_text, created_at")
            .eq("customer_id", customer.id)
            .eq("message_direction", "inbound")
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          const question = String((lastInbound as any)?.message_text || extraVars["pergunta"] || "").trim();

          const { data: hist } = await supabase
            .from("conversations")
            .select("message_direction, message_text, created_at")
            .eq("customer_id", customer.id)
            .order("created_at", { ascending: false })
            .limit(8);
          const recentHistory = ((hist as any[]) || [])
            .slice()
            .reverse()
            .map((r) => `${r.message_direction === "inbound" ? "Lead" : "Bot"}: ${String(r.message_text || "").slice(0, 240)}`)
            .join("\n");

          // Paridade Whapi: orquestrador unificado (Triagem → GPT → Gemini RAG)
          const { runOrchestrator } = await import("../../_shared/ai-orchestrator.ts");
          const firstName = safeFirstNameForAddress((customer as any).name, (customer as any).name_source);
          const orch = await runOrchestrator({
            supabase,
            customer,
            consultantId: customer.consultant_id,
            message: question || "",
            step: stepKey,
            history: recentHistory,
          });

          let answerText = (orch.reply || "").trim();
          if (!answerText) {
            answerText = firstName
              ? `${firstName}, pode mandar sua dúvida que eu te explico tudo agora 😊`
              : "Pode mandar sua dúvida, que eu explico tudo agora 😊";
          }

          await sendText(remoteJid, answerText);
          await supabase.from("conversations").insert({
            customer_id: customer.id,
            message_direction: "outbound",
            message_text: answerText,
            message_type: "text",
            conversation_step: stepKey,
          });

          // 🔁 Reemite botões do passo após resposta IA (paridade Whapi)
          if (!orch.shouldHandoff) {
            try {
              const followups = Number((customer as any).ai_followups_count || 0);
              const { reemitStepButtons } = await import("../../_shared/bot/reemit-buttons.ts");
              await reemitStepButtons({
                supabase,
                customerId: customer.id,
                consultantId: customer.consultant_id,
                flowVariant: (customer as any)?.flow_variant || "A",
                stepKey,
                remoteJid,
                sendButtons,
                sendText,
                followups,
                stepCaptures: Array.isArray((stepRow as any)?.captures) ? (stepRow as any).captures : [],
              });
            } catch (e) {
              console.warn(`[dispatch:${stepKey}] button re-emission failed:`, (e as Error).message);
            }
          }

          if (orch.shouldHandoff) {
            try {
              await supabase
                .from("customers")
                .update({ bot_paused: true, bot_paused_reason: "ai_handoff_duvidas" })
                .eq("id", customer.id);
              const { notifyHandoff } = await import("../../_shared/notify-consultant.ts");
              await notifyHandoff(supabase, customer, "Dúvida exigiu humano (passo esclarecer_duvidas)").catch(() => {});
            } catch (_e) { /* best-effort */ }
          }

          console.log(`[dispatch:${stepKey}] orchestrator reply (route=${orch.route} conf=${orch.confidence.toFixed(2)} handoff=${orch.shouldHandoff} chain=${orch.modelChain.join("→")})`);
          return true;
        } catch (e) {
          console.warn(`[dispatch:${stepKey}] AI answer falhou — enviando fallback texto puro (sem mídia):`, (e as Error).message);
          try {
            const firstName = safeFirstNameForAddress((customer as any).name, (customer as any).name_source);
            const fallbackText = firstName
              ? `${firstName}, pode mandar sua dúvida que eu te explico tudo agora 😊`
              : "Pode mandar sua dúvida, que eu explico tudo agora 😊";
            await sendText(remoteJid, fallbackText);
            await supabase.from("conversations").insert({
              customer_id: customer.id,
              message_direction: "outbound",
              message_text: fallbackText,
              message_type: "text",
              conversation_step: stepKey,
            });
          } catch (_) { /* best-effort */ }
          return true;
        }
      }


      const slotKey = (stepRow as any).slot_key || stepKey;
      // Busca mídia do próprio consultor PRIMEIRO; se vazio, cai no público
      // (mídia do superadmin marcada como is_public=true). Isso permite que
      // qualquer consultor reaproveite os templates oficiais sem ter que
      // re-uppar áudios/vídeos.
      const { data: personalRows } = await supabase
        .from("ai_media_library")
        .select("id, kind, url, slot_key, send_order, duration_sec, delay_before_ms, consultant_id, is_public")
        .eq("consultant_id", mediaOwnerId)
        .eq("slot_key", slotKey)
        .eq("active", true)
        .eq("is_draft", false)
        .order("send_order", { ascending: true });
      let medias = ((personalRows as any[]) || []).filter((m) => !!m?.url);
      if (medias.length === 0) {
        const { data: publicRows } = await supabase
          .from("ai_media_library")
          .select("id, kind, url, slot_key, send_order, duration_sec, delay_before_ms, consultant_id, is_public")
          .eq("is_public", true)
          .is("consultant_id", null) // só órfãs públicas — evita vazar de outros consultores
          .eq("slot_key", slotKey)
          .eq("active", true)
          .order("send_order", { ascending: true });
        // B2 (2026-06-05): NÃO usar áudio público quando consultor não subiu mídia
        // própria. Áudio é a mídia "íntima" (voz alheia confunde lead).
        // Imagem/vídeo público continua liberado.
        medias = ((publicRows as any[]) || [])
          .filter((m) => !!m?.url)
          .filter((m) => String(m.kind).toLowerCase() !== "audio");
        if (medias.length > 0) console.log(`[dispatch:${stepKey}] fallback público sem áudio (${medias.length} mídia(s))`);
      }

      // A2/A3/A3b/A5: NUNCA enviar MP3 da prévia (Maria/Rodrigo).
      try {
        const { isPersonalizedWaAudioSlot, pickSafePersonalizedWaAudio } = await import(
          "../../_shared/wa-audio-stitch.ts"
        );
        if (isPersonalizedWaAudioSlot(String(slotKey))) {
          const nonAudio = medias.filter((m) => String(m.kind).toLowerCase() !== "audio");
          medias = nonAudio;
          const safe = await pickSafePersonalizedWaAudio(supabase, {
            consultantId: mediaOwnerId,
            slotKey: String(slotKey),
            customerName: (customer as any)?.name,
            nameSource: (customer as any)?.name_source,
            timeoutMs: 90_000,
          });
          if (safe.ok && safe.url && (safe.mode === "stitch" || safe.mode === "body_only")) {
            medias = [
              ...nonAudio,
              {
                id: null,
                kind: "audio",
                url: String(safe.url),
                slot_key: slotKey,
                send_order: 0,
                duration_sec: null,
                delay_before_ms: 0,
              },
            ];
            console.log(
              `[dispatch:${stepKey}] wa-audio SAFE name=${safe.displayName} mode=${safe.mode} cached=${safe.cached}`,
            );
          } else {
            console.warn(
              `[dispatch:${stepKey}] wa-audio SKIP preview err=${safe.error} — segue sem áudio (nunca Maria)`,
            );
          }
        }
      } catch (stitchErr) {
        console.warn(`[dispatch:${stepKey}] wa-stitch erro:`, (stitchErr as Error)?.message || stitchErr);
        try {
          const { isPersonalizedWaAudioSlot } = await import("../../_shared/wa-audio-stitch.ts");
          if (isPersonalizedWaAudioSlot(String(slotKey))) {
            medias = medias.filter((m) => String(m.kind).toLowerCase() !== "audio");
          }
        } catch (_) { /* noop */ }
      }

      const _flowVariant = (customer as any)?.flow_variant || 'A';
      if (_flowVariant === 'B') {
        const _before = medias.length;
        medias = medias.filter((m) => String(m.kind).toLowerCase() !== 'audio');
        if (_before !== medias.length) console.log(`[dispatch:${stepKey}] variant=B: removed ${_before - medias.length} audio media(s)`);
      }

      // B1 (2026-06-05): usar renderTemplateVars para cobrir {{valor_conta}},
      // {{economia_range}}, {{economia_mensal}}, {{economia_anual}} além de
      // {{nome}}/{{representante}}. Antes só nome/representante eram trocados
      // e d_resultado vazava "R$ {{valor_conta}}" literal pro cliente.
      const _billValue = Number((customer as any).electricity_bill_value || 0);
      const applyVars = (s: string) =>
        renderTemplateVars(s, {
          name: (customer as any).name,
          name_source: (customer as any).name_source,
          phone: (customer as any).phone_whatsapp,
          cpf: (customer as any).cpf,
          representante: nomeRepresentante,
          assistente: nomeAssistente || "",
          valor_conta: _billValue > 0 ? _billValue : null,
          variant: (customer as any)?.flow_variant,
          extra: extraVars as Record<string, string>,
        });

      type Item = { kind: string; text?: string; media?: any };
      const items: Item[] = medias.map((m) => ({
        kind: String(m.kind || "document").toLowerCase(),
        media: m,
      }));
      const baseText = (stepRow as any).message_text
        ? applyVars(String((stepRow as any).message_text))
        : "";
      if (baseText.trim()) items.push({ kind: "text", text: baseText });

      if (items.length === 0) {
        console.warn(`[dispatch:${stepKey}] EMPTY — step sem texto nem mídia (slot=${slotKey}). Configure no /admin/fluxos.`);
        return false;
      }

      // Precedência: UI (consultants.flow_step_media_order[slotKey]) → bot_flow_steps.media_order → default.
      // A UI do /admin/fluxos grava em consultants.flow_step_media_order, então ela vence
      // o default semeado em bot_flow_steps.media_order.
      const uiOrder = await getStepMediaOrder(supabase, mediaOwnerId, [(stepRow as any).step_key || stepKey, slotKey]);
      const stepOrder = Array.isArray((stepRow as any).media_order) && (stepRow as any).media_order.length > 0
        ? (stepRow as any).media_order.map((k: any) => String(k).toLowerCase())
        : null;
      const configuredOrder = uiOrder || stepOrder || ["audio", "image", "video", "text", "document"];
      items.sort(makeKindComparator((it: Item) => it.kind, configuredOrder));

      // ─── BOTÕES (carregamos cedo p/ unir com o último texto, espelhando Whapi) ──
      // Antes: enviávamos texto e DEPOIS um segundo `sendText` com a lista numerada.
      // Em chamadas back-to-back, o segundo envio podia falhar silenciosamente
      // (bug do número 11971254913 — d_como_funciona perdia o texto final).
      // Agora: se o último item da sequência é texto e o passo tem _buttons,
      // disparamos UMA única chamada via sendButtons (que no Evolution já anexa
      // a lista numerada no próprio texto).
      let _buttons: { id: string; title: string }[] = [];
      try {
        const captures = Array.isArray((stepRow as any).captures) ? (stepRow as any).captures : [];
        const buttonsCapture = captures.find((c: any) => c?.field === "_buttons" && Array.isArray(c?.value));
        if (buttonsCapture && Array.isArray(buttonsCapture.value)) {
          _buttons = buttonsCapture.value
            .map((b: any) => ({
              id: String(b?.id || "").trim(),
              title: applyVars(String(b?.title || "")).trim().slice(0, 60),
            }))
            .filter((b: any) => b.id && b.title)
            .slice(0, 3);
        }
      } catch (_) { /* noop */ }

      let sent = false;
      let buttonsSent = false;
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const isLast = i === items.length - 1;

        if (it.kind === "text" && it.text) {
          const useButtonsHere = isLast && _buttons.length > 0;
          const finalText = useButtonsHere
            ? it.text
            : it.text;
          try {
            let okSend = false;
            if (useButtonsHere) {
              // sendButtons no Evolution já formata "1. opt …" no próprio texto
              okSend = (await sendButtons(remoteJid, finalText, _buttons)) !== false;
              if (okSend) buttonsSent = true;
            } else {
              okSend = (await sendText(remoteJid, finalText)) !== false;
            }
            if (okSend) {
              await supabase.from("conversations").insert({
                customer_id: customer.id,
                message_direction: "outbound",
                message_text: finalText,
                message_type: useButtonsHere ? "buttons" : "text",
                conversation_step: stepKey,
              });
              sent = true;
            } else {
              console.warn(`[dispatch:${stepKey}] envio de texto retornou false (useButtons=${useButtonsHere})`);
            }
            if (!isLast) await new Promise((r) => setTimeout(r, 800));
          } catch (e) {
            console.warn(`[dispatch:${stepKey}] envio de texto falhou:`, (e as any)?.message);
          }
          continue;
        }

        const m = it.media;
        if (!m?.url) continue;
        const kind = ["audio", "video", "image"].includes(it.kind) ? it.kind : "document";

        const canSend = await canSendMediaOnce(supabase, {
          consultantId: customer.consultant_id,
          customerId: customer.id,
          mediaId: m.id,
          slotKey: m.slot_key || slotKey,
          kind,
        });
        if (!canSend) {
          console.log(`[dispatch:${stepKey}] ⏭️ ${kind} já enviado anteriormente — pulando`);
          continue;
        }

        const delayMs = Number(m.delay_before_ms || 0);
        // Áudio/vídeo seguem imediatamente; os demais tipos têm teto baixo
        // para não segurar a cascata nem estourar o lock do customer.
        const kindLower = String(kind).toLowerCase();
        const effectiveDelay = (kindLower === "audio" || kindLower === "video")
          ? 0
          : Math.min(delayMs, 1_500);
        if (effectiveDelay > 0 && !isTestMode()) {
          await new Promise((r) => setTimeout(r, effectiveDelay));
        }

        // R3 (2026-06-26): healthcheck NÃO desativa mais a mídia automaticamente.
        // O check antigo derrubava mídia boa quando o backend respondia 400 em
        // HEAD (Supabase Storage faz isso) e ia "raspando" o slot até sobrar
        // nada (bug do `como_funciona` em 2026-06-26). Agora só loga e pula
        // este envio; a decisão de desativar fica explícita para o operador.
        try {
          const isPublic = !m.consultant_id || m.is_public === true;
          if (isPublic) {
            const reachable = await urlExists(String(m.url));
            if (!reachable) {
              console.warn(`[dispatch:${stepKey}] ⚠️ healthcheck falhou media_id=${m.id} kind=${kind} url=${String(m.url).slice(0, 80)} — pulando este envio, mídia permanece ativa`);
              continue;
            }
          }
        } catch (_) { /* healthcheck é best-effort */ }


        try {
          const ok = await sendMedia(remoteJid, m.url, "", kind, Number(m.duration_sec || 0) || undefined);
          if (ok !== false) {
            sent = true;
            await supabase.from("conversations").insert({
              customer_id: customer.id,
              message_direction: "outbound",
              message_text: `[${kind}:${m.slot_key || slotKey}]`,
              message_type: kind,
              conversation_step: stepKey,
            });
            if (!isLast) await sleepForMedia(kind, Number(m.duration_sec || 0) || null);
          }
        } catch (e) {
          console.warn(`[dispatch:${stepKey}] envio de ${kind} falhou:`, (e as any)?.message);
        }
      }

      // ─── BOTÕES INTERATIVOS (fallback) ───────────────────────────────
      // Se os botões NÃO foram anexados ao último texto (porque a ordem
      // configurada coloca texto antes de mídia, ex.: text→audio→video),
      // disparamos a lista numerada como mensagem curta separada.
      // Anti-duplicação: pula se já enviamos via sendButtons acima.
      if (sent && _buttons.length > 0 && !buttonsSent) {
        try {
          await new Promise((r) => setTimeout(r, 600));
          const promptText = "👇 *Escolha uma opção:*";
          await sendButtons(remoteJid, promptText, _buttons);
          await supabase.from("conversations").insert({
            customer_id: customer.id,
            message_direction: "outbound",
            message_text: promptText,
            message_type: "buttons",
            conversation_step: stepKey,
          });
          buttonsSent = true;
          console.log(`[dispatch:${stepKey}] enviou ${_buttons.length} botão(ões) como CTA (fallback pós-mídia)`);
        } catch (e) {
          console.warn(`[dispatch:${stepKey}] envio dos botões (fallback) falhou:`, (e as any)?.message);
        }
      }


      return sent;
    } catch (e) {
      console.warn(`[dispatch:${stepKey}] erro geral:`, (e as any)?.message);
      return false;
    }
  }

  // CTA por etapa — reconduz ao passo atual após atalho/FAQ.
  function buildStepNudge(currentStep: string, leadName: string | null): string {
    const close = buildQaStepClose(currentStep, { leadName });
    return close ? `\n\n${close}` : "";
  }

  async function trySendConfiguredQa(opts?: { force?: boolean; keepStep?: boolean }): Promise<BotResult | null> {
    if (!messageText || isFile || isButton || !customer.consultant_id) return null;
    // E: bypass em passos de cadastro/edição (a não ser que force=true via off-topic intercept)
    if (!opts?.force && NO_QA_STEPS.has(step)) return null;
    const normalizedText = messageText.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
    if (normalizedText.length < 2) return null;
    if (!opts?.force && step === "checkin_pos_video" && isPositiveCheckinIntent(normalizedText)) return null;
    if (!opts?.force && step === "duvidas_pos_club" && isClubProgressIntent(normalizedText)) return null;
    // 🚧 Em qualificacao, se a msg contém um valor numérico (conta de luz),
    // NÃO deixa QA semântica capturar — o handler determinístico (linha ~961)
    // precisa extrair o valor e avançar pra aguardando_conta.
    if (!opts?.force && step === "qualificacao" && /\d{2,5}/.test(normalizedText)) return null;

    const activeFlow = await resolveFlowId(supabase, customer.consultant_id, (customer as any)?.flow_variant || "A");
    if (!activeFlow) return null;
    const { resolveMediaOwnerId } = await import("../../_shared/resolve-flow.ts");
    const mediaOwnerId = await resolveMediaOwnerId(
      supabase,
      customer.consultant_id,
      (customer as any)?.flow_variant || "A",
    );

    const { data: qaRows } = await supabase
      .from("bot_flow_qa")
      .select("id, text_response, is_closing")
      .eq("flow_id", (activeFlow as any).id)
      .eq("is_opening", false);
    const qaIds = ((qaRows as any[]) || []).map((q) => q.id);
    if (!qaIds.length) return null;

    const { data: triggers } = await supabase
      .from("bot_flow_qa_triggers")
      .select("qa_id, phrase")
      .in("qa_id", qaIds);
    const triggerList = ((triggers as any[]) || []);

    // 1) Match conservador (word-boundary / frases compostas) — sem includes bruto
    let matchedQaId: string | null = null;
    let hitLen = -1;
    for (const t of triggerList) {
      const phrase = String(t.phrase || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
      if (!phrase) continue;
      if (!phraseMatchesMessage(phrase, normalizedText)) continue;
      if (phrase.length > hitLen) {
        matchedQaId = t.qa_id;
        hitLen = phrase.length;
      }
    }
    if (!matchedQaId) {
      const fuzzyHit = triggerList.find((t) => {
        const phrase = String(t.phrase || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
        if (!phrase || phrase.length < 6) return false;
        return trigramSim(normalizedText, phrase) >= 0.88;
      });
      if (fuzzyHit) matchedQaId = fuzzyHit.qa_id;
    }

    // 2) Fallback semântico via IA (só se temos triggers cadastradas e nenhuma bateu)
    if (!matchedQaId && triggerList.length > 0 && geminiApiKey) {
      try {
        // Agrupa triggers por qa_id pra dar contexto melhor pro LLM
        const byQa = new Map<string, string[]>();
        for (const t of triggerList) {
          const arr = byQa.get(t.qa_id) || [];
          arr.push(String(t.phrase || ""));
          byQa.set(t.qa_id, arr);
        }
        const optionsList = Array.from(byQa.entries()).map(([id, phrases], i) =>
          `${i + 1}. id=${id} | exemplos: ${phrases.slice(0, 6).join(" / ")}`
        ).join("\n");

        const prompt =
          `Você é um classificador de intenção em PT-BR para um bot de vendas de energia (iGreen).\n` +
          `Dado a MENSAGEM do lead, escolha a OPÇÃO cuja intenção semanticamente melhor responde.\n` +
          `Se NENHUMA opção responder claramente a mensagem, devolva qa_id="" e confidence=0.\n\n` +
          `MENSAGEM: """${messageText.slice(0, 400)}"""\n\nOPÇÕES:\n${optionsList}\n\n` +
          `Responda APENAS JSON: {"qa_id":"<id ou vazio>","confidence":0..1}`;

        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${geminiApiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ role: "user", parts: [{ text: prompt }] }],
              generationConfig: {
                temperature: 0,
                responseMimeType: "application/json",
                responseSchema: {
                  type: "object",
                  properties: {
                    qa_id: { type: "string" },
                    confidence: { type: "number" },
                  },
                  required: ["qa_id", "confidence"],
                },
                thinkingConfig: { thinkingBudget: 0 },
              },
            }),
          },
        );
        if (res.ok) {
          const data = await res.json();
          const txt = data?.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
          const parsed = JSON.parse(txt);
          const candidateId = String(parsed?.qa_id || "").trim();
          const conf = Number(parsed?.confidence || 0);
          if (candidateId && conf >= 0.6 && qaIds.includes(candidateId)) {
            matchedQaId = candidateId;
            console.log(`[qa-semantic] match qa=${candidateId} conf=${conf} msg="${messageText.slice(0, 60)}"`);
          }
        }
      } catch (e) {
        console.warn("[qa-semantic] falhou:", (e as any)?.message);
      }
    }

    if (!matchedQaId) return null;
    const qa = ((qaRows as any[]) || []).find((q) => q.id === matchedQaId);
    if (!qa) return null;

    const { data: mediaRows } = await supabase
      .from("bot_flow_qa_media")
      .select("media_kind, slot_key, media_id, position")
      .eq("qa_id", qa.id)
      .order("position");
    let sentSomething = false;

    // F: texto entra como item ordenável junto com mídias
    // Nome do lead só com fonte confiável — nunca pushName do Zap.
    let baseText = qa.text_response
      ? renderTemplateVars(String(qa.text_response), {
          name: customer.name || "",
          name_source: (customer as any).name_source,
          representante: nomeRepresentante || "",
        })
      : "";
    const nudgeStep = qa.is_closing ? "aguardando_conta" : (step || "qualificacao");
    if (baseText) {
      const { formatFaqReply } = await import("../../_shared/format-reply.ts");
      baseText = formatFaqReply(withQaStepClose(baseText, nudgeStep, {
        leadName: safeFirstNameForAddress((customer as any).name, (customer as any).name_source) || null,
        skip: qa.is_closing,
      }));
    }
    const nudge = "";
    const responseText = (baseText + nudge).trim();

    type QaItem = {
      kind: string;
      mediaRef?: any;
      text?: string;
      url?: string | null;
      resolvedMediaId?: string | null;
      durationSec?: number | null;
    };
    // Resolve mídias primeiro: se houver áudio tocável, NÃO envia o texto escrito.
    const mediaOnly: QaItem[] = ((mediaRows as any[]) || []).map((m) => ({
      kind: String(m.media_kind || "document").toLowerCase(),
      mediaRef: m,
    }));
    const resolved: QaItem[] = [];
    for (const it of mediaOnly) {
      const m = it.mediaRef;
      if (!m) continue;
      let url: string | null = null;
      let resolvedMediaId: string | null = m.media_id || null;
      let kind = it.kind === "audio" ? "audio" : it.kind === "video" ? "video" : it.kind === "image" ? "image" : "document";
      let durationSec: number | null = null;
      if (m.media_id) {
        const { data: mediaRow } = await supabase.from("ai_media_library").select("url, kind, duration_sec").eq("id", m.media_id).eq("active", true).maybeSingle();
        if (mediaRow?.url) {
          url = mediaRow.url;
          if (mediaRow.kind) kind = mediaRow.kind;
          if ((mediaRow as any).duration_sec) durationSec = Number((mediaRow as any).duration_sec);
        }
      }
      if (!url && m.slot_key) {
        const { data: personal } = await supabase
          .from("ai_media_library")
          .select("id, url, duration_sec")
          .eq("consultant_id", mediaOwnerId)
          .eq("slot_key", m.slot_key)
          .eq("active", true).eq("is_draft", false)
          .order("send_order", { ascending: true })
          .limit(1).maybeSingle();
        if (personal?.url) { url = personal.url; resolvedMediaId = (personal as any).id || resolvedMediaId; durationSec = Number((personal as any).duration_sec || 0) || null; }
        else {
          const { data: pub } = await supabase
            .from("ai_media_library")
            .select("id, url, duration_sec")
            .eq("is_public", true)
            .is("consultant_id", null) // só órfãs públicas — evita vazar de outros consultores
            .eq("slot_key", m.slot_key)
            .eq("active", true)
            .order("send_order", { ascending: true })
            .limit(1).maybeSingle();
          if (pub?.url) { url = pub.url; resolvedMediaId = (pub as any).id || resolvedMediaId; durationSec = Number((pub as any).duration_sec || 0) || null; }
        }
      }
      if (!url) continue;
      resolved.push({ kind, mediaRef: m, url, resolvedMediaId, durationSec });
    }
    const hasPlayableAudio = resolved.some((r) => r.kind === "audio");
    const items: QaItem[] = [...resolved];
    if (responseText && !hasPlayableAudio) items.push({ kind: "text", text: responseText });

    const _qaOrder = (await getStepMediaOrder(supabase, mediaOwnerId, [step])) || ["text", "audio", "image", "video", "document"];
    items.sort(makeKindComparator((it: QaItem) => it.kind, _qaOrder));

    for (let mi = 0; mi < items.length; mi++) {
      const it = items[mi];
      const isLast = mi === items.length - 1;

      if (it.kind === "text" && it.text) {
        await sendText(remoteJid, it.text);
        await supabase.from("conversations").insert({
          customer_id: customer.id, message_direction: "outbound",
          message_text: it.text, message_type: "text", conversation_step: step,
        });
        sentSomething = true;
        continue;
      }

      const m = it.mediaRef;
      const url = it.url || null;
      const resolvedMediaId = it.resolvedMediaId || null;
      const kind = it.kind;
      const durationSec = it.durationSec ?? null;
      if (!m || !url) continue;
      // 🚫 Regra: nunca repetir áudio/vídeo para o mesmo cliente
      const canSend = await canSendMediaOnce(supabase, {
        consultantId: customer.consultant_id, customerId: customer.id,
        mediaId: resolvedMediaId, slotKey: m.slot_key, kind,
      });
      if (!canSend) continue;
      await sendMedia(remoteJid, url, "", kind, durationSec || undefined);
      sentSomething = true;
      await supabase.from("conversations").insert({
        customer_id: customer.id, message_direction: "outbound",
        message_text: `[flow-qa:${qa.id}:${kind}]`, message_type: kind, conversation_step: step,
      });
      if (!isLast) await sleepForMedia(kind, durationSec);
    }

    // Sem áudio e sem texto do QA: nudge curto só como fallback
    if (sentSomething && !hasPlayableAudio && !responseText && !qa.is_closing) {
      const nudgeOnly = buildStepNudge(
        step || "qualificacao",
        safeFirstNameForAddress((customer as any).name, (customer as any).name_source) || null,
      ).trim();
      if (nudgeOnly) {
        await sendText(remoteJid, nudgeOnly);
        await supabase.from("conversations").insert({
          customer_id: customer.id, message_direction: "outbound",
          message_text: nudgeOnly, message_type: "text", conversation_step: step,
        });
      }
    }


    if (!sentSomething) return null;

    if (opts?.keepStep) {
      try {
        const { reemitStepButtons } = await import("../../_shared/bot/reemit-buttons.ts");
        await reemitStepButtons({
          supabase,
          customerId: customer.id,
          consultantId: customer.consultant_id,
          flowVariant: (customer as any)?.flow_variant || "A",
          stepKey: step,
          remoteJid,
          sendButtons,
          sendText,
        });
      } catch (_) { /* noop */ }
      return { reply: "", updates: { __inline_sent: true } as any };
    }
    return { reply: "", updates: { conversation_step: qa.is_closing ? "aguardando_conta" : (step || "qualificacao"), __inline_sent: true } as any };
  }



  let step = customer.conversation_step || "welcome";
  let reply = "";
  const updates: Record<string, any> = {};

  // F11: spam/blast no início — pausa sem engajar (não auto-envia em massa)
  if (
    !isFile && !isButton && messageText && looksLikeSpamBlast(messageText) &&
    /^(welcome|d_welcome|qualificacao|menu_inicial)$/i.test(String(step).replace(/^flow:/, ""))
  ) {
    console.warn(`[spam] lead=${customer.id} step=${step} — pausando`);
    return {
      reply: "",
      updates: {
        bot_paused: true,
        bot_paused_reason: "spam_blast",
        bot_paused_at: new Date().toISOString(),
        conversation_step: "aguardando_humano",
        __inline_sent: true,
      } as any,
    };
  }

  // ═══════════════════════════════════════════════════════════════════
  // 🔁 persistAndRedispatch — Portal 2 correction loop (Req 9.3/9.4, 7.4).
  // Espelha o caso de auto-correção de consumo do step `portal_submitting`:
  // grava o campo corrigido (já setado em `updates` pelo caller), incrementa
  // o contador por classe, reabre `portal_submitting` em `retry_ready`, limpa
  // o erro e re-despacha via o Despachante existente. Best-effort: falha de
  // dispatch não derruba a conversa. Logs sempre com PII mascarada (Req 12.4).
  // ═══════════════════════════════════════════════════════════════════
  async function persistAndRedispatch(kind: CorrectionKind, maskedValue: string): Promise<void> {
    // Req 9.3/9.4 — incrementa Tentativas_por_Classe (jsonb {kind:int}).
    updates.portal2_correction_attempts = incrementAttempts(
      (customer as any).portal2_correction_attempts,
      kind,
    );
    // Reabre o submit (marcador transitório `retry_ready` p/ o painel) e limpa
    // o erro anterior. conversation_step volta a `portal_submitting`.
    updates.portal2_status = "retry_ready";
    updates.portal2_error = null;
    updates.conversation_step = "portal_submitting";
    const attemptN = (updates.portal2_correction_attempts as Record<string, number>)[kind];
    console.log(`[portal-correction] redispatch kind=${kind} attempt=${attemptN} value=${maskedValue}`);
    try {
      const { dispatchPortalWorker } = await import("../../_shared/portal-worker.ts");
      await supabase.from("customers").update(updates).eq("id", customer.id);
      await dispatchPortalWorker(supabase, customer.id);
    } catch (e: any) {
      console.warn(`[portal-correction] redispatch falhou kind=${kind}:`, e?.message);
    }
    // O caller já enviou a confirmação inline? Não — deixamos o outbound padrão
    // enviar `reply` (espelha o caso do consumo: __inline_sent=false).
    (updates as any).__inline_sent = false;
  }

  // ═══════════════════════════════════════════════════════════════════
  // 🎙️  OPENING DO BOT_FLOW — envia o áudio de abertura (slot) configurado
  // pelo consultor no Flow Builder ANTES de qualquer texto/IA.
  // Dispara apenas no PRIMEIRO contato (zero outbound prévio para este lead).
  // ═══════════════════════════════════════════════════════════════════
  try {
    const currentStep = customer.conversation_step;
    const stepIsInitial = !currentStep || currentStep === "welcome";
    if (!isFile && !isButton && customer.consultant_id && !customer.bot_paused && stepIsInitial) {
      // 🛑 Se o consultor tem Fluxo da Camila ativo, NÃO usar abertura legada
      // (bot_flow_qa.is_opening). O motor dinâmico (runConversationalFlow) é
      // a única fonte de verdade. Esse caminho só serve para consultores que
      // ainda não migraram para o Flow Builder.
      const hasDynamicFlow = await resolveFlowId(supabase, customer.consultant_id, (customer as any)?.flow_variant || "A");
      if (hasDynamicFlow?.id) {
        console.log(`[opening-flow] pulado — consultor tem Fluxo da Camila ativo (${(hasDynamicFlow as any).id})`);
        // segue o switch normal
      } else {
      const { count: outboundCount } = await supabase
        .from("conversations")
        .select("id", { count: "exact", head: true })
        .eq("customer_id", customer.id)
        .eq("message_direction", "outbound");
      const isFirstContact = (outboundCount || 0) === 0;

      if (isFirstContact) {
        const activeFlow = await resolveFlowId(supabase, customer.consultant_id, (customer as any)?.flow_variant || "A");
        const { resolveMediaOwnerId } = await import("../../_shared/resolve-flow.ts");
        const mediaOwnerId = await resolveMediaOwnerId(
          supabase,
          customer.consultant_id,
          (customer as any)?.flow_variant || "A",
        );

        if (activeFlow) {
          const { data: openingQa } = await supabase
            .from("bot_flow_qa")
            .select("id, text_response")
            .eq("flow_id", (activeFlow as any).id)
            .eq("is_opening", true)
            .maybeSingle();

          if (openingQa) {
            const { data: medias } = await supabase
              .from("bot_flow_qa_media")
              .select("media_kind, slot_key, media_id, position")
              .eq("qa_id", (openingQa as any).id)
              .order("position");

            const orderedMedia = (medias as any[]) || [];
            const _openOrder = await getStepMediaOrder(supabase, mediaOwnerId, [step]);
            if (_openOrder) orderedMedia.sort(makeKindComparator((m: any) => m.media_kind, _openOrder));
            let sentSomething = false;

            for (let oi = 0; oi < orderedMedia.length; oi++) {
              const m = orderedMedia[oi];
              let url: string | null = null;
              let resolvedMediaId: string | null = m.media_id || null;
              let kind = m.media_kind === "audio" ? "audio" : m.media_kind === "video" ? "video" : m.media_kind === "image" ? "image" : "document";
              let durationSec: number | null = null;

              // 1) Resolve por media_id direto
              if (m.media_id) {
                const { data: mediaRow } = await supabase
                  .from("ai_media_library")
                  .select("url, kind, duration_sec")
                  .eq("id", m.media_id)
                  .eq("active", true)
                  .maybeSingle();
                if (mediaRow?.url) {
                  url = mediaRow.url;
                  if (mediaRow.kind) kind = mediaRow.kind;
                  if ((mediaRow as any).duration_sec) durationSec = Number((mediaRow as any).duration_sec);
                }
              }

              // 2) Resolve por slot_key (personal ativo → público)
              if (!url && m.slot_key) {
                const { data: personal } = await supabase
                  .from("ai_media_library")
                  .select("id, url, duration_sec")
                  .eq("consultant_id", mediaOwnerId)
                  .eq("slot_key", m.slot_key)
                  .eq("active", true)
                  .eq("is_draft", false)
                  .order("send_order", { ascending: true })
                  .limit(1)
                  .maybeSingle();
                if (personal?.url) {
                  url = personal.url;
                  resolvedMediaId = (personal as any).id || resolvedMediaId;
                  durationSec = Number((personal as any).duration_sec || 0) || null;
                } else {
                  const { data: pub } = await supabase
                    .from("ai_media_library")
                    .select("id, url, duration_sec")
                    .eq("is_public", true)
                    .is("consultant_id", null)
                    .eq("slot_key", m.slot_key)
                    .eq("active", true)
                    .order("send_order", { ascending: true })
                    .limit(1)
                    .maybeSingle();
                  if (pub?.url) {
                    url = pub.url;
                    resolvedMediaId = (pub as any).id || resolvedMediaId;
                    durationSec = Number((pub as any).duration_sec || 0) || null;
                  }
                }
              }

              if (!url) continue;

              // 🚫 Regra: nunca repetir áudio/vídeo para o mesmo cliente
              const canSend = await canSendMediaOnce(supabase, {
                consultantId: customer.consultant_id, customerId: customer.id,
                mediaId: resolvedMediaId, slotKey: m.slot_key, kind,
              });
              if (!canSend) continue;

              try {
                const ok = await sendMedia(remoteJid, url, "", kind, durationSec || undefined);
                if (ok !== false) {
                  sentSomething = true;
                  await supabase.from("conversations").insert({
                    customer_id: customer.id,
                    message_direction: "outbound",
                    message_text: `[${kind}:${m.slot_key || "media"}]`,
                    message_type: kind,
                    conversation_step: step,
                  });
                  // Espera proporcional à duração da mídia (áudio de 2min → não joga vídeo em cima)
                  const isLast = oi === orderedMedia.length - 1;
                  if (!isLast) await sleepForMedia(kind, durationSec);
                }
              } catch (e) {
                console.warn("[bot-flow] opening media send failed:", (e as any)?.message);
              }
            }

            // Texto de abertura opcional, se configurado
            const openingText = (openingQa as any).text_response;
            if (openingText) {
              try {
                await sendText(remoteJid, renderTemplateVars(String(openingText), {
                  name: customer.name || "",
                  name_source: (customer as any).name_source,
                  representante: nomeRepresentante || "",
                }));
                await supabase.from("conversations").insert({
                  customer_id: customer.id,
                  message_direction: "outbound",
                  message_text: openingText,
                  message_type: "text",
                  conversation_step: step,
                });
                sentSomething = true;
              } catch (e) {
                console.warn("[bot-flow] opening text send failed:", (e as any)?.message);
              }
            }

            if (sentSomething) {
              console.log(`🎙️ [opening-flow] Abertura (Passo 1) enviada para customer ${customer.id} — aguardando resposta conforme Fluxo da Camila`);
              // Removido o "Deu pra entender?" hardcoded: o Passo 1 já contém áudio + texto
              // configurados pelo usuário. Apenas avançamos o step e aguardamos a resposta do lead;
              // o state-machine de checkin_pos_video cuida das transições seguintes.
              return {
                reply: "",
                updates: { conversation_step: "checkin_pos_video", __inline_sent: true } as any,
              };
            }
          }
        }
      }
      } // fecha else hasDynamicFlow
    }
  } catch (e) {
    console.warn("[bot-flow] opening-flow check failed:", (e as any)?.message);
  }

  // ═══════════════════════════════════════════════════════════════════
  // 🤖 SALES AI — delegação opcional para LLM com tool-calling.
  // Ativa quando: ai_agent_config.handoff_rules.use_sales_ai = true
  // E o step está em fase conversacional (antes da coleta de docs).
  // Steps de coleta (aguardando_conta em diante) seguem determinísticos.
  // ═══════════════════════════════════════════════════════════════════
  // ═══════════════════════════════════════════════════════════════════
  // 🛡️  INTENT OVERRIDE DETERMINÍSTICO — roda ANTES da IA.
  // Garante que palavras-chave críticas funcionem mesmo se o LLM falhar.
  // ═══════════════════════════════════════════════════════════════════
  if (messageText && !isFile && !isButton) {
    const txt = messageText.trim();

    // 1) "não sou eu" / "recomeçar" → limpa contexto poluído e reinicia.
    if (RE_INTENT_RESET.test(txt)) {
      console.log(`[intent-override] RESET detectado: "${txt.slice(0, 60)}"`);
      await resetLeadIdentity(supabase, customer.id);
      const msg =
        "Sem problema, vamos recomeçar do zero.\n\n" +
        `Oi! 👋 Aqui é o assistente digital de *${nomeRepresentante}*.\n\n` +
        "Já pensou em pagar menos na sua conta de luz todo mês? 💚\n" +
        "Posso te explicar rapidinho como funciona?";
      await sendOptions(remoteJid, msg, [
        { id: "entender_desconto", title: "💡 Quero saber mais" },
        { id: "cadastrar_agora", title: "📋 Já quero participar" },
        { id: "falar_humano", title: "🧑 Falar com humano" },
      ]);
      return { reply: "", updates: { conversation_step: "menu_inicial", __inline_sent: true } as any };
    }

    // 2) "cadastrar / quero participar / vamos lá" → pula direto pro pedido da conta,
    //    mas SOMENTE se ainda não temos a foto da conta.
    if (RE_INTENT_CADASTRAR.test(txt) && !customer.electricity_bill_photo_url) {
      console.log(`[intent-override] CADASTRAR detectado: "${txt.slice(0, 60)}"`);
      return {
        reply:
          "Perfeito! 🙌\n\n" +
          "📸 Me envia agora uma *foto da sua conta de luz* (fatura do mês atual ou a anterior).💚",
        updates: { conversation_step: "aguardando_conta", sales_phase: "fechamento" },
      };
    }

    // 2.5) Recusa/adiamento explícito → IA cuida do tom acolhedor (sem pausar bot).
    //      Se quiser pausar, ela vai chamar pause_bot via tool. Por padrão deixamos o
    //      diálogo seguir natural — vendedor humano não desliga só porque o lead disse "depois".

    // 3) "humano / atendente" → handoff explícito.
    if (RE_INTENT_HUMANO.test(txt)) {
      console.log(`[intent-override] HUMANO detectado: "${txt.slice(0, 60)}"`);
      return {
        reply:
          `🧑 Sem problema! Um consultor da equipe *${nomeRepresentante}* vai te chamar em breve.\n\n` +
          "Se mudar de ideia e quiser começar agora, é só digitar *cadastrar*.",
        updates: {
          conversation_step: "aguardando_humano",
          bot_paused: true,
          bot_paused_reason: "lead_pediu_humano",
          bot_paused_at: new Date().toISOString(),
        },
      };
    }

    if (step !== "checkin_pos_video" && step !== "duvidas_pos_club") {
      const configuredQaResult = await trySendConfiguredQa();
      if (configuredQaResult) return configuredQaResult;
    }
  }

  if (
    step === "aguardando_conta" &&
    messageText &&
    !isFile &&
    !isButton &&
    !customer.electricity_bill_photo_url &&
    isBogusCapturedName((customer as any).name)
  ) {
    const recoveredName = normalizeLeadName(messageText);
    if (recoveredName) {
      const first = safeFirstNameForAddress(recoveredName, "self_introduced");
      return {
        reply: first
          ? `${first}, qual a média da sua conta de luz?`
          : "Qual a média da sua conta de luz?",
        updates: { name: recoveredName, name_source: "self_introduced", conversation_step: "qualificacao" },
      };
    }
    return {
      reply: "Qual é o seu nome?",
      updates: { name: null, name_source: "unknown", conversation_step: "qualificacao" },
    };
  }

  // ═══════════════════════════════════════════════════════════════════
  // 🪪 CAPTURA DETERMINÍSTICA DE NOME
  // O primeiro áudio de boas-vindas já pede o nome do lead. Se ainda
  // não temos `customer.name` e a resposta atual parece um nome (1-4
  // palavras alfabéticas), salvamos imediatamente para não perder.
  // ═══════════════════════════════════════════════════════════════════
  if (
    messageText &&
    !isFile &&
    !isButton &&
    !customer.name &&
    !customer.electricity_bill_photo_url &&
    // 🚧 Não capturar "nome" quando o lead está só confirmando que entendeu
    // ("joia quero economizar", "pode seguir", etc).
    step !== "checkin_pos_video" &&
    step !== "duvidas_pos_club" &&
    !isPositiveCheckinIntent(messageText.trim())
  ) {
    const formatted = normalizeLeadName(messageText);
    if (formatted) {
      updates.name = formatted;
      updates.name_source = "self_introduced";
      (customer as any).name = formatted;
      (customer as any).name_source = "self_introduced";
      console.log(`🪪 [name-capture] Nome capturado: "${formatted}"`);
    }
  }

  // A etapa de qualificação é determinística: primeiro captura nome/valor.
  // A IA só entra aqui para perguntas reais depois que já temos um nome confiável.
  if (
    step === "qualificacao" &&
    messageText &&
    !isFile &&
    !isButton
  ) {
    const txt = messageText.trim();
    const currentNameTrusted = !!safeFirstNameForAddress(
      (customer as any).name,
      (customer as any).name_source,
    );
    const typedName = normalizeLeadName(txt);
    const typedBillValue = extractMoneyFromText(txt) ?? 0;

    if (RE_GREETING_ONLY.test(txt)) {
      return {
        reply: currentNameTrusted ? "Oi! Qual a média da sua conta de luz?" : "Oi! Qual é o seu nome?",
        updates: { conversation_step: "qualificacao" },
      };
    }

    if (typedName) {
      const first = safeFirstNameForAddress(typedName, "self_introduced");
      return {
        reply: first
          ? `${first}, qual a média da sua conta de luz?`
          : "Qual a média da sua conta de luz?",
        updates: { name: typedName, name_source: "self_introduced", conversation_step: "qualificacao" },
      };
    }

    if (Number.isFinite(typedBillValue) && typedBillValue > 0 && typedBillValue < 100) {
      return {
        reply: `Obrigada por me falar. Com conta em torno de R$ ${typedBillValue.toFixed(0)}, normalmente a economia fica pequena e pode não compensar agora. Vou deixar registrado e, se seu consumo subir, a gente retoma 💚`,
        updates: { electricity_bill_value: typedBillValue, status: "rejected", bot_paused: true, bot_paused_reason: "low_bill_value", conversation_step: "valor_baixo" },
      };
    }

    if (Number.isFinite(typedBillValue) && typedBillValue >= 100) {
      return {
        reply: "Com essa média, já dá para calcular sua economia. Me envie uma FOTO ou PDF da sua conta de energia para eu confirmar os dados.",
        updates: { electricity_bill_value: typedBillValue, sales_phase: "fechamento", conversation_step: "aguardando_conta" },
      };
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // 🤖 SALES AI — delegação opcional para LLM com tool-calling.
  // Ativa quando: ai_agent_config.handoff_rules.use_sales_ai = true
  // E o step está em fase conversacional (antes da coleta de docs).
  // Steps de coleta (aguardando_conta em diante) seguem determinísticos.
  // ═══════════════════════════════════════════════════════════════════
  const conversationalSteps = new Set(["welcome", "menu_inicial", "pos_video", "checkin_pos_video", "aguardando_humano", "qualificacao", "duvidas_pos_club"]);

  // 💰 Pré-captura do valor da conta em qualquer step conversacional.
  // Antes o "1600" do lead só era gravado dentro do case qualificacao —
  // se o step ainda fosse "welcome", a IA respondia com cálculo R$ 0.
  if (
    messageText &&
    !isFile &&
    !isButton &&
    !customer.electricity_bill_value &&
    !customer.electricity_bill_photo_url
  ) {
    const raw = messageText.trim();
    // Só captura se a msg parece um valor (curta e majoritariamente numérica)
    if (raw.length <= 24) {
      const v = extractMoneyFromText(raw) ?? 0;
      const looksLikeBareValue = /^[r\$\s]*[\d.,]+[\s,reais]*$/i.test(raw);
      if (looksLikeBareValue && Number.isFinite(v) && v >= 30 && v <= 50000) {
        updates.electricity_bill_value = v;
        (customer as any).electricity_bill_value = v;
        console.log(`💰 [bill-precapture] valor=${v} capturado em step=${step}`);
      }
    }
  }

  // Steps de coleta também aceitam pergunta off-script (FAQ), mas só se a mensagem PARECE pergunta.
  const collectionSteps = new Set(["aguardando_conta", "coleta_doc", "ask_email", "ask_cep"]);
  const looksLikeQuestion = !!messageText && (
    /\?/.test(messageText) ||
    /^(como|quanto|quando|onde|quem|qual|posso|preciso|funciona|é|tem|vou|vai|porqu[eê]|por que|sera|será|sera que|me explica|me conta|d[uú]vida)/i.test(messageText.trim())
  );
  // Bypass: se já temos a conta com OCR + nome confiável, NÃO chamar a IA —
  // o switch determinístico vai cuidar de confirmar/avançar sem virar handoff loop.
  const billTrusted =
    !!customer.electricity_bill_photo_url &&
    !!customer.ocr_done &&
    TRUSTED_NAME_SOURCES.has(String(customer.name_source || ""));

  // 🎯 Atalho determinístico: intenção forte de cadastro em step conversacional
  // → pula a IA e empurra para coletar a conta de luz (próximo passo físico).
  // Resolve o caso "Jeferson disse 'Cadastro' e a IA mandou 2 vídeos sem texto".
  const conversationalForShortcut = new Set(["welcome", "menu_inicial", "pos_video", "checkin_pos_video", "qualificacao"]);
  const { wantsToAdvance } = await import("../../_shared/bot/cadastro-intent.ts");
  if (
    !isFile && !customer.bot_paused && !billTrusted &&
    conversationalForShortcut.has(step) &&
    messageText && wantsToAdvance(messageText.trim())
  ) {
    console.log(`🎯 [intent-shortcut] cadastro detectado em step=${step} → forçando aguardando_conta`);
    step = "aguardando_conta";
    (customer as any).conversation_step = "aguardando_conta";
    updates.conversation_step = "aguardando_conta";
    const firstNm = safeFirstNameForAddress((customer as any).name, (customer as any).name_source);
    const v = firstNm ? `${firstNm}, ` : "";
    const reply = `Show, ${v.trim().replace(/,$/, "")}! 📸 Pra eu já calcular sua economia exata e iniciar o cadastro, me envia uma *foto ou PDF da sua conta de luz* (qualquer página serve).`;
    return { reply, updates };
  }

  // ✅ Caminho determinístico para validação/conversão: respostas positivas no check-in
  // não podem cair na IA e repetir áudio/vídeo. Se vier valor junto, já avança direto.
  if (!isFile && !isButton && step === "checkin_pos_video" && messageText) {
    const txt = messageText.trim();
    const firstNm = safeFirstNameForAddress((customer as any).name, (customer as any).name_source);
    const v = firstNm ? `${firstNm}, ` : "";
    const billValue = extractMoneyFromText(txt) ?? 0;
    const positive = isPositiveCheckinIntent(txt);
    if (Number.isFinite(billValue) && billValue >= 100) {
      return {
        reply: `Ótimo! Com R$ ${billValue.toFixed(0)} já consigo calcular sua economia. Envie uma *foto* ou PDF da conta de luz para eu confirmar os dados 📸`,
        updates: { electricity_bill_value: billValue, sales_phase: "fechamento", conversation_step: "aguardando_conta" },
      };
    }
    if (Number.isFinite(billValue) && billValue > 0 && billValue < 100) {
      return {
        reply: `Obrigada por me falar. Com conta em torno de R$ ${billValue.toFixed(0)}, normalmente a economia fica pequena e pode não compensar agora. Vou deixar registrado e, se seu consumo subir, a gente retoma 💚`,
        updates: { electricity_bill_value: billValue, status: "rejected", bot_paused: true, bot_paused_reason: "low_bill_value", conversation_step: "valor_baixo" },
      };
    }
    if (positive) {
      return {
        reply: `Boa! ${v}me conta uma coisa: quanto vem em média na sua conta de luz? Assim eu já te calculo quanto dá pra economizar 💡`,
        updates: { conversation_step: "qualificacao" },
      };
    }
    if (/\?|seguro|taxa|pagar|custa|funciona|entendi|d[uú]vida/i.test(txt)) {
      return {
        reply: `Sem problema! Funciona assim: você continua recebendo energia normalmente, sem obra e sem trocar instalação. O desconto vem na conta porque a iGreen aplica créditos de energia limpa.\n\n${v}pra eu calcular se vale a pena no seu caso, quanto vem em média na sua conta de luz?`,
        updates: { conversation_step: "qualificacao" },
      };
    }
  }

  // ✅ No pós-pitch, “pode seguir/joia/sem dúvida” precisa abrir documento imediatamente,
  // sem passar pela IA e sem loop de mídia.
  if (!isFile && !customer.bot_paused && step === "duvidas_pos_club" && messageText) {
    const txt = messageText.trim().toLowerCase();
    const segueAgora = isClubProgressIntent(txt);
    if (segueAgora) {
      // 🔧 PARIDADE WHAPI (FIX C1): pedir CONTA DE LUZ antes do documento.
      // Fluxo correto é conta → simulação → CTA → documento. Antes pulava
      // direto pro doc, quebrando a ordem do funil.
      const ctaMsg = `Perfeito! Pra eu calcular sua economia, me envia uma *foto ou PDF da sua conta de luz* 📸`;
      await sendText(remoteJid, ctaMsg);
      await supabase.from("conversations").insert({
        customer_id: customer.id, message_direction: "outbound",
        message_text: ctaMsg, message_type: "text",
        conversation_step: "aguardando_conta",
      });
      return { reply: "", updates: { conversation_step: "aguardando_conta", __inline_sent: true } as any };
    }
    if (/\?|cancel|cancela|taxa|fidelidade|seguro|pagar|custa|club|clube|funciona/i.test(txt)) {
      return {
        reply: "Pode ficar tranquilo: não tem obra, não muda instalação e você pode pedir suporte se tiver qualquer dúvida. O Conexão Club é um benefício extra de descontos/cashback em parceiros; o principal aqui é reduzir sua conta de luz.\n\nSe estiver tudo certo, responda *pode seguir* e eu solicito seu RG ou CNH para finalizar.",
        updates: { conversation_step: "duvidas_pos_club" },
      };
    }
  }

  if (
    !isFile &&
    !customer.bot_paused &&
    !billTrusted &&
    (conversationalSteps.has(step) || (collectionSteps.has(step) && looksLikeQuestion)) &&
    messageText &&
    messageText.trim().length > 0
  ) {
    try {
      const { data: cfgPrivate } = customer.consultant_id
        ? await supabase
          .from("ai_agent_config")
          .select("handoff_rules, enabled")
          .eq("consultant_id", customer.consultant_id)
          .maybeSingle()
        : { data: null };
      const { data: cfgGlobal } = !cfgPrivate
        ? await supabase
          .from("ai_agent_config")
          .select("handoff_rules, enabled")
          .is("consultant_id", null)
          .maybeSingle()
        : { data: null };
      const cfg = cfgPrivate || cfgGlobal;

      const useSalesAi = false; // vendedora apagada — Cérebro IA responde no webhook antes deste handler
      if (useSalesAi) {
        // 🔄 Persiste updates pendentes ANTES de chamar a IA, senão o
        // ai-sales-agent re-busca o customer do banco e lê valores stale
        // (ex: electricity_bill_value=null mesmo após preCapture do "1600").
        if (Object.keys(updates).length > 0) {
          try {
            await supabase.from("customers").update(updates).eq("id", customer.id);
            console.log(`💾 [pre-ai-flush] persistiu ${Object.keys(updates).length} campos antes da IA:`, Object.keys(updates));
          } catch (e) {
            console.error("[pre-ai-flush] falha ao persistir updates antes da IA:", e);
          }
        }
        const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
        const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
        const aiResp = await fetch(`${supabaseUrl}/functions/v1/ai-sales-agent`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${serviceKey}`,
            apikey: serviceKey,
          },
          body: JSON.stringify({ customer_id: customer.id, user_input: messageText }),
        });

        if (aiResp.ok) {
          const aiBody = await aiResp.json();
          const decision = aiBody?.decision;
          const media = aiBody?.media;
          const medias: Array<{ id: string; url: string; kind: string; label: string }> = Array.isArray(aiBody?.medias) && aiBody.medias.length > 0 ? aiBody.medias : (media ? [media] : []);
          const tool = decision?.tool;
          const args = decision?.args || {};

          if (tool === "send_text" || tool === "advance_to_closing") {
            reply = args.message || "";
            if (tool === "advance_to_closing") {
              updates.conversation_step = "aguardando_conta";
              if (!reply) {
                reply = "Perfeito! 📸 Para iniciar seu cadastro, me envie uma *foto ou PDF da sua conta de luz*.";
              }
            }
            // Anti-loop: se o reply for ≥80% similar à última msg outbound, troca por lembrete do step atual.
            try {
              const { data: lastOut } = await supabase
                .from("conversations")
                .select("message_text")
                .eq("customer_id", customer.id)
                .eq("message_direction", "outbound")
                .order("created_at", { ascending: false })
                .limit(1)
                .maybeSingle();
              if (lastOut?.message_text && reply && trigramSim(reply, lastOut.message_text) >= 0.8) {
                console.warn("[anti-loop] reply parecido com última outbound — trocando por lembrete do step");
                if (collectionSteps.has(step)) {
                  reply = step === "aguardando_conta"
                    ? "Para seguir, me envie uma foto ou PDF da sua conta de luz, por favor."
                    : "Vamos continuar de onde paramos.";
                } else {
                  reply = "";
                }
              }
            } catch (_) { /* best-effort */ }
            // Lembrete do step de coleta após responder dúvida off-script
            if (reply && collectionSteps.has(step) && !updates.conversation_step) {
              if (step === "aguardando_conta") reply += "\n\nVoltando: me manda a foto ou PDF da sua conta de luz pra eu seguir 📸";
              else if (step === "coleta_doc") reply += "\n\nVoltando: me manda a frente do seu documento (CNH ou RG) pra eu seguir 🪪";
            }
            return { reply, updates };
          }
          if (tool === "request_handoff") {
            updates.conversation_step = "aguardando_humano";
            reply = `🧑 Vou chamar ${nomeRepresentante} para te atender pessoalmente. 👍`;
            return { reply, updates };
          }
          if (tool === "schedule_followup") {
            // Mensagem leve agora; cron de follow-up faz o resto
            reply = "Beleza! Quando quiser continuar é só me chamar 👍";
            return { reply, updates };
          }
          if (tool === "send_media") {
            const ordered = [...medias].sort((a, b) => (a.kind === "audio" ? -1 : b.kind === "audio" ? 1 : 0));
            // Detecta vídeo do Conexão Club entre as mídias para forçar follow-up determinístico
            const isClubMedia = (m: any) =>
              m && m.kind === "video" && /club|conex[aã]o[_\s-]*club/i.test(`${m.label || ""} ${m.slot_key || ""} ${m.url || ""}`);
            const clubMedia = ordered.find(isClubMedia);
            for (let i = 0; i < ordered.length; i++) {
              const m = ordered[i];
              const k = ["audio", "video", "image"].includes(m.kind) ? m.kind : "document";
              const cap = i === 0 ? (args.caption || "") : "";
              // 🚫 Regra: nunca repetir áudio/vídeo para o mesmo cliente
              const canSend = await canSendMediaOnce(supabase, {
                consultantId: customer.consultant_id, customerId: customer.id,
                mediaId: (m as any).id || null, slotKey: (m as any).slot_key || null, kind: k,
              });
              if (!canSend) continue;
              try {
                await sendMedia(remoteJid, m.url, cap, k, Number((m as any).duration_sec || 0) || undefined);
                if (i < ordered.length - 1 && !isTestMode()) await new Promise((r) => setTimeout(r, 1500));
              } catch (e) {
                console.warn("[bot-flow] sendMedia (AI) falhou:", (e as any)?.message);
              }
            }
            // 🎬 Após vídeo do Conexão Club: pergunta determinística "ficou alguma dúvida?"
            // e avança step pra duvidas_pos_club (regra de negócio do usuário).
            if (clubMedia) {
              try {
                await sleepForMedia("video", Number((clubMedia as any).duration_sec || 0) || null);
              } catch (_) { /* best-effort */ }
              const firstNm = safeFirstNameForAddress((customer as any).name, (customer as any).name_source);
              const duvidaMsg = firstNm
                ? `${firstNm}, ficou alguma dúvida sobre o Conexão Club ou sobre como funciona? Pode mandar aqui que eu te explico 😊\n\nSe estiver tudo certo, é só me dizer *"pode seguir"* que a gente já avança pro cadastro.`
                : `Ficou alguma dúvida sobre o Conexão Club ou sobre como funciona? Pode mandar aqui que eu te explico 😊\n\nSe estiver tudo certo, é só me dizer *"pode seguir"* que a gente já avança pro cadastro.`;
              try {
                await sendText(remoteJid, duvidaMsg);
                await supabase.from("conversations").insert({
                  customer_id: customer.id, message_direction: "outbound",
                  message_text: duvidaMsg, message_type: "text",
                  conversation_step: "duvidas_pos_club",
                });
              } catch (e) { console.warn("[club-followup] envio falhou:", (e as any)?.message); }
              updates.conversation_step = "duvidas_pos_club";
              console.log("🎬 [club-followup] vídeo do Conexão Club enviado → step=duvidas_pos_club");
            }
            reply = "";
            (updates as any).__inline_sent = true;
            return { reply, updates };
          }
          if (tool === "mark_lost") {
            reply = "Tranquilo! Se mudar de ideia é só me chamar 💚";
            return { reply, updates };
          }
          if (tool === "update_lead_field") {
            reply = args.followup_message || "";
            return { reply, updates };
          }
          if (tool === "confirm_and_handoff") {
            reply = args.message || `Vou conectar você com ${nomeRepresentante} para finalizar.`;
            updates.conversation_step = "aguardando_humano";
            return { reply, updates };
          }
          if (tool === "ask_for_name") {
            reply = args.message || "Como posso te chamar?";
            return { reply, updates };
          }
        } else {
          console.warn("[bot-flow] ai-sales-agent falhou, caindo no fluxo determinístico", aiResp.status);
        }
      }
    } catch (e: any) {
      console.warn("[bot-flow] erro ao chamar ai-sales-agent:", e?.message);
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // CAPTURA INTELIGENTE: Se o cliente digitar um email válido em
  // QUALQUER step (ex: welcome, menu_inicial), salvar no banco
  // para não perder. Caso da Judite/Erica que digitaram email
  // antes do bot pedir.
  // ═══════════════════════════════════════════════════════════════════
  if (
    messageText &&
    !isFile &&
    !isButton &&
    step !== "ask_email" && // No ask_email o handler já cuida
    isValidEmailFormat(messageText.trim()) &&
    !isPlaceholderEmail(messageText.trim()) &&
    !customer.email // Só salvar se ainda não tem email
  ) {
    updates.email = messageText.trim().toLowerCase();
    console.log(`📧 [CAPTURA] Email "${updates.email}" salvo automaticamente (digitado no step "${step}")`);
  }

  // ═══════════════════════════════════════════════════════════════════
  // 🕊️ INTERCEPÇÃO DE ADIAMENTO (PARIDADE WHAPI): "amanhã eu mando",
  // "tô sem luz", "mais tarde te envio" nos passos que aguardam mídia
  // (conta/doc). Vale para texto E para áudio transcrito — vendedor
  // humano não repete "manda a foto" 10s depois do cliente avisar que
  // envia amanhã.
  //
  // - Confirma com empatia ("Combinado, fico no aguardo amanhã cedo")
  // - Pausa bot até pauseUntil (bot_paused_until)
  // - Agenda follow-up (next_followup_at)
  // - NÃO muda conversation_step → quando cliente voltar, segue do mesmo lugar.
  // ═══════════════════════════════════════════════════════════════════
  try {
    const MEDIA_WAIT_RX = /^aguardando_(?:conta|doc(?:_auto|_frente|_verso)?)$/;
    const isAudioTranscript = isFile && !hasImage && !hasDocument;
    const isPlainText = !isFile && !isButton;
    const canCheckPostpone = !!messageText && (isPlainText || isAudioTranscript);
    if (canCheckPostpone && MEDIA_WAIT_RX.test(step)) {
      const intent = detectPostponeIntent(messageText);
      if (intent) {
        const firstName = safeFirstNameForAddress((customer as any)?.name, (customer as any)?.name_source);
        const waitingDoc = step.startsWith("aguardando_doc");
        const reply = await buildPostponeReplyResolved(supabase, (customer as any)?.consultant_id, { firstName, when: intent.when, waitingDoc });
        console.log(`[postpone] customer=${customer.id} step=${step} when="${intent.when}" until=${intent.pauseUntil}`);
        try {
          await sendText(remoteJid, reply);
          await supabase.from("conversations").insert({
            customer_id: customer.id,
            message_direction: "outbound",
            message_text: reply,
            message_type: "text",
            conversation_step: step,
          });
        } catch (e) {
          console.warn("[postpone] send falhou:", (e as any)?.message);
        }
        try {
          await supabase.from("ai_decisions" as any).insert({
            customer_id: customer.id,
            consultant_id: customer.consultant_id || null,
            phase: "postpone",
            tool_called: "schedule_followup",
            user_input: String(messageText).slice(0, 240),
            reasoning: `Lead pediu adiamento (${intent.when}). Pausando até ${intent.pauseUntil}.`,
            ai_output: { message: reply, when: intent.when, pause_until: intent.pauseUntil },
          });
        } catch (e) {
          console.warn("[postpone] ai_decisions insert falhou:", (e as any)?.message);
        }
        return {
          reply: "",
          updates: {
            ...updates,
            bot_paused_until: intent.pauseUntil,
            next_followup_at: intent.pauseUntil,
            __inline_sent: true,
          } as any,
        };
      }
    }
  } catch (e) {
    console.warn("[postpone] interceptor erro:", (e as any)?.message);
  }


  // ═══════════════════════════════════════════════════════════════════
  // G: INTERCEPÇÃO OFF-TOPIC durante coleta/edição.
  // Se o lead está em ask_*/editing_*/confirmando_*/aguardando_(conta|doc)
  // e digita uma pergunta que NÃO tem o formato esperado pelo step,
  // responde via QA configurada (force=true bypassa NO_QA_STEPS) SEM mudar o step,
  // e reenvia o prompt do passo atual ("Voltando ao seu cadastro: ...").
  // ═══════════════════════════════════════════════════════════════════
  if (messageText && !isFile && !isButton) {
    const ASK_OR_EDIT_RX = /^(ask_|editing_|confirmando_|aguardando_(?:conta|doc))/;
    if (ASK_OR_EDIT_RX.test(step)) {
      const t = messageText.trim();
      const expected = isExpectedShape(step, t);
      const looksLikeQuestion =
        /\?/.test(t) ||
        /^(como|quanto|quando|onde|quem|qual|posso|preciso|funciona|porqu[eê]|por que|me explica|me conta|d[uú]vida|e\s+(se|quando|caso))/i.test(t);
      // Mensagem longa sem formato esperado também é provavelmente off-topic
      const probablyOffTopic = !expected && (looksLikeQuestion || t.length > 30);
      if (probablyOffTopic) {
        console.log(`[off-topic] step=${step} msg="${t.slice(0, 60)}" → respondendo dúvida e reenviando prompt`);
        const qaResult = await trySendConfiguredQa({ force: true, keepStep: true });
        if (qaResult) {
          const { full: reentry } = await resolveStepReentry(supabase, customer, step, nomeRepresentante);
          if (reentry) {
            try {
              await sendText(remoteJid, reentry);
              await supabase.from("conversations").insert({
                customer_id: customer.id, message_direction: "outbound",
                message_text: reentry, message_type: "text", conversation_step: step,
              });
            } catch (e) { console.warn("[off-topic] reentry falhou:", (e as any)?.message); }
          }
          return { reply: "", updates: { ...updates, __inline_sent: true } as any };
        }
        // Sem QA configurada: IA responde + reentry (nunca silencia, nunca "❌ inválido")
        return await respondAndReentry({
          reason: "off_topic_collect",
          questionText: messageText,
        });
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // 🧭 RESOLVER de passos do FluxoCamila (/admin/fluxos)
  // Se conversation_step for um UUID ou um step_key custom (qualquer valor
  // que não bate com os "case" do switch abaixo), procura o registro em
  // bot_flow_steps e:
  //   • capture_conta       → roteia para "aguardando_conta"
  //   • capture_documento   → roteia para "aguardando_doc_auto"
  //   • capture_email       → roteia para "ask_email"
  //   • confirm_phone       → roteia para "ask_phone_confirm"
  //   • finalizar_cadastro  → roteia para "finalizando"
  //   • message             → passo informativo: avança para o próximo passo
  //                            ativo por position e despacha (text+mídia).
  // Assim os passos 1..N criados pelo consultor NUNCA travam o bot, nem
  // caem no default que reseta para "aguardando_conta".
  // ═══════════════════════════════════════════════════════════════════
  const LEGACY_STEPS = new Set<string>([
    "welcome", "menu_inicial", "qualificacao", "aguardando_conta", "processando_ocr_conta",
    "confirmando_dados_conta", "editing_conta_menu", "editing_conta_nome", "editing_conta_endereco",
    "editing_conta_cep", "editing_conta_distribuidora", "editing_conta_instalacao",
    "editing_conta_valor", "pitch_conexao_club", "duvidas_pos_club",
    "aguardando_doc_auto", "aguardando_doc_frente", "aguardando_doc_verso",
    "ask_tipo_documento", "confirmando_dados_doc", "editing_doc_menu", "editing_doc_nome",
    "editing_doc_rg", "editing_doc_cpf", "editing_doc_nascimento",
    "ask_name", "ask_cpf", "ask_birth_date", "ask_phone", "ask_phone_confirm",
    "ask_bill_value", "ask_installation_number", "ask_cep", "ask_number",
    "ask_complement", "ask_email", "ask_rg", "ask_contaunica", "ask_transferir_titularidade", "ask_finalizar", "ask_distribuidora",
    "confirmar_titularidade", "validacao_facial", "pos_video",
    "finalizando", "finalizar_cadastro", "complete", "valor_baixo",
    "cadastro_em_analise", "aguardando_facial", "otp_falhou", "otp_confirmar",
    "aguardando_humano",
    // Loop de correção Portal 2: steps que pedem o dado rejeitado ao cliente.
    "corrigir_celular_portal", "corrigir_email_portal", "corrigir_instalacao_portal", "corrigir_documento_portal", "corrigir_documento_verso_portal",
  ]);
  const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  // ═══════════════════════════════════════════════════════════════════
  // 🔒 LOCK GLOBAL (PARIDADE WHAPI): consultor com fluxo custom ativo
  // NUNCA cai nos passos legacy conversacionais. Remapeia "welcome"/
  // "qualificacao"/"pitch_*"/"duvidas_*" para o passo equivalente do
  // fluxo do admin. Estados de cadastro também são mapeados pelo
  // step_type correspondente no fluxo custom — se existir. Sem
  // mapeamento → mantém legacy (fallback seguro).
  // ═══════════════════════════════════════════════════════════════════
  const CONVERSATIONAL_LEGACY = new Set<string>([
    "welcome", "menu_inicial", "qualificacao", "pos_video",
    "pitch_conexao_club", "duvidas_pos_club", "checkin_pos_video",
  ]);
  const STATE_LEGACY_TO_TYPE: Record<string, string> = {
    "aguardando_conta": "capture_conta",
    "aguardando_doc_auto": "capture_documento",
    "ask_email": "capture_email",
    "ask_phone_confirm": "confirm_phone",
    "finalizando": "finalizar_cadastro",
  };
  if (customer.consultant_id && (CONVERSATIONAL_LEGACY.has(step) || STATE_LEGACY_TO_TYPE[step])) {
    try {
      const activeFlow = await resolveFlowId(supabase, customer.consultant_id, (customer as any)?.flow_variant || "A");
      if (activeFlow?.id) {
        let mapped: any = null;
        if (CONVERSATIONAL_LEGACY.has(step)) {
          const { data } = await supabase
            .from("bot_flow_steps")
            .select("id, step_key, position")
            .eq("flow_id", (activeFlow as any).id).eq("is_active", true)
            .order("position", { ascending: true }).limit(1);
          mapped = Array.isArray(data) ? data[0] : null;
        } else {
          const wantedType = STATE_LEGACY_TO_TYPE[step];
          const { data } = await supabase
            .from("bot_flow_steps")
            .select("id, step_key, position")
            .eq("flow_id", (activeFlow as any).id).eq("is_active", true)
            .eq("step_type", wantedType)
            .order("position", { ascending: true }).limit(1);
          mapped = Array.isArray(data) ? data[0] : null;
        }
        if (mapped?.id) {
          console.log(`[legacy→custom] step "${step}" → ${mapped.id} (${mapped.step_key})`);
          step = String(mapped.id);
        } else {
          console.log(`[legacy→custom] sem mapeamento para "${step}" no fluxo ${(activeFlow as any).id} — segue legacy`);
        }
      }
    } catch (e) {
      console.warn("[legacy→custom] erro:", (e as any)?.message);
    }
  }

  const stepIsUuid = UUID_RX.test(step);
  const stepIsCustom = !LEGACY_STEPS.has(step) && !step.startsWith("editing_") && !step.startsWith("ask_");

  if (customer.consultant_id && (stepIsUuid || stepIsCustom)) {
    try {
      const flow = await resolveFlowId(supabase, customer.consultant_id, (customer as any)?.flow_variant || "A");
      if (flow?.id) {
        let stepRow: any = null;
        if (stepIsUuid) {
          const { data } = await supabase
            .from("bot_flow_steps")
            .select("id, step_key, step_type, position, transitions, captures")
            .eq("flow_id", flow.id).eq("id", step).maybeSingle();
          stepRow = data;
        }
        if (!stepRow) {
          const { data } = await supabase
            .from("bot_flow_steps")
            .select("id, step_key, step_type, position, transitions, captures")
            .eq("flow_id", flow.id).eq("step_key", step).maybeSingle();
          stepRow = data;
        }

        if (stepRow) {
          const stype = String(stepRow.step_type || "message");
          console.log(`[custom-step-resolver] step="${step}" → type=${stype} pos=${stepRow.position}`);

          // 3b — “Tenho dúvida”: áudio já foi enviado ao entrar no passo.
          // Texto livre do lead → IA responde → volta ao a3 com botões.
          if (
            String(stepRow.step_key || "") === "a3b_pedir_pergunta" &&
            messageText &&
            String(messageText).trim().length > 0 &&
            !isButton &&
            !isFile
          ) {
            console.log(`[custom-step-resolver] a3b_pedir_pergunta → IA + volta a3_explain_with_buttons`);
            (customer as any).conversation_step = "a3_explain_with_buttons";
            const result = await respondAndReentry({
              reason: "custom_step_no_match",
              questionText: String(messageText),
            });
            return {
              reply: "",
              updates: {
                ...(result as any)?.updates,
                conversation_step: "a3_explain_with_buttons",
                __inline_sent: true,
              } as any,
            };
          }

          if (stype === "capture_conta") {
            if ((stepRow as any)?.id) {
              updates.previous_conversation_step = String((stepRow as any).id);
              (customer as any).previous_conversation_step = String((stepRow as any).id);
            }
            step = "aguardando_conta";
          }
          else if (stype === "capture_documento" || stype === "capture_doc") step = "aguardando_doc_auto";
          else if (stype === "capture_email") step = "ask_email";
          else if (stype === "confirm_phone") step = "ask_phone_confirm";
          else if (stype === "finalizar_cadastro") {
            step = nextSeparatedCadastroStep(customer as any, {
              fromStepKey: (stepRow as any)?.step_key,
            });
            if (String((stepRow as any)?.step_key || "") === "a10_portal_otp_facial") {
              updates.contaunica = true;
              updates.contaunica_answered = true;
            }
          }

          // 🛡️ Guarda ordem do funil: NUNCA pedir documento antes da conta+simulação.
          if ((stype === "capture_documento" || stype === "capture_doc") && !hasBillData(customer)) {
            try {
              const { data: contaStep } = await supabase
                .from("bot_flow_steps")
                .select("step_key,position")
                .eq("flow_id", stepRow.flow_id)
                .eq("step_type", "capture_conta")
                .eq("is_active", true)
                .order("position", { ascending: true })
                .limit(1)
                .maybeSingle();
              if (contaStep?.step_key) {
                console.log(`[custom-step-resolver] 🛡️ block doc-before-bill → redirect ${stepRow.step_key} → ${contaStep.step_key}`);
                step = "aguardando_conta";
                stepRow = { ...stepRow, step_key: contaStep.step_key, step_type: "capture_conta" } as any;
              }
            } catch (_e) { /* fallback silencioso */ }
          }

          // 🔁 RESUME determinístico (SIBLING, fora do guard doc-before-bill):
          // se o capture solicitado JÁ tem dado salvo, pula direto para o
          // próximo passo realmente faltante. Bloqueia o bug
          // "step resetado → bot re-pede dado que já está no banco".
          if (
            step === "aguardando_conta" ||
            step === "aguardando_doc_auto" ||
            step === "aguardando_doc_verso"
          ) {
            try {
              const resumed = resolveResumeStep(customer);
              if (resumed && resumed !== step) {
                console.log(`[resume] dispatcher quis ${step}, resume aponta ${resumed} — usando ${resumed}`);
                step = resumed;
              }
            } catch (e) {
              console.warn(`[resume] falha resolveResumeStep:`, (e as any)?.message);
            }
          }

          // 🛡️ Skip-guard global: se o passo determinístico mapeado já tem
          // o dado preenchido (OCR, edição manual, passo anterior), avança
          // para o próximo realmente faltante.
          if (step && shouldSkipAskStep(step, customer)) {
            const merged = { ...customer };
            const skipped = step;
            step = getNextMissingStep(merged);
            console.log(`[custom-step-resolver] skip ${skipped} → ${step} (dado já existe)`);
          }
          // 🛡️ Para passos de captura (capture_conta/documento/email/confirm_phone),
          // NÃO re-emitir prompt nem avançar por posição. O handler legacy
          // (aguardando_conta/aguardando_doc_auto/ask_email/ask_phone_confirm)
          // processa o inbound (arquivo/texto) e decide o próximo passo.
          // Re-emitir aqui causa prompt duplicado; avançar por posição faz o
          // bot pular o documento sem processar a foto.
          else if (
            stype === "capture_conta" ||
            stype === "capture_documento" || stype === "capture_doc" ||
            stype === "capture_email" || stype === "confirm_phone"
          ) {
            console.log(`[custom-step-resolver] capture-passthrough step=${stepRow.step_key} type=${stype} → legacy ${step}`);
            // step já foi setado para o alias legacy acima; cai no switch
          }
          else {
            // step_type === "message" → passo informativo.
            // ANTES de avançar, garante que o conteúdo do step ATUAL foi emitido
            // (dispatchStepFromFlow tem anti-rep interno de 10 min, então não duplica).
            const _fmtBRL = (n: number) => n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            const _valor = Number((customer as any).electricity_bill_value || 0);
            const _rates = discountRates((customer as any)?.flow_variant);
            const _vars = {
              "{valor}": _fmtBRL(_valor),
              "{{valor}}": _fmtBRL(_valor),
              "{economia_mensal}": _fmtBRL(_valor * _rates.max),
              "{{economia_mensal}}": _fmtBRL(_valor * _rates.max),
              "{economia_anual}": _fmtBRL(_valor * _rates.max * 12),
              "{{economia_anual}}": _fmtBRL(_valor * _rates.max * 12),
            };
            const emittedCurrent = await dispatchStepFromFlow(stepRow.step_key, _vars).catch(() => false);
            console.log(`[custom-step-resolver] emit-current step=${stepRow.step_key} ok=${emittedCurrent}`);

            // ── Resolução do próximo passo HONRANDO transitions/goto_step_id ──
            // Evita pular perguntas e objeções: se o passo atual tem trigger_phrases
            // (afirmacao/negacao), só avança quando a mensagem casar com elas;
            // se tem default com goto_step_id, segue esse goto explicitamente.
            const _norm = (s: string) => String(s || "").toLowerCase()
              .normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
            const _loadStepById = async (id: string) => {
              const { data } = await supabase
                .from("bot_flow_steps")
                .select("id, step_key, step_type, position, transitions, message_text, captures")
                .eq("flow_id", flow.id).eq("id", id).eq("is_active", true).maybeSingle();
              return data ? {
                id: String(data.id), step_key: String(data.step_key),
                step_type: String(data.step_type), position: Number(data.position),
                transitions: Array.isArray((data as any).transitions) ? (data as any).transitions : [],
                message_text: String((data as any).message_text || ""),
                captures: Array.isArray((data as any).captures) ? (data as any).captures : [],
              } : null;
            };
            const _loadStepByKey = async (stepKey: string) => {
              const { data } = await supabase
                .from("bot_flow_steps")
                .select("id, step_key, step_type, position, transitions, message_text, captures")
                .eq("flow_id", flow.id).eq("step_key", stepKey).eq("is_active", true).maybeSingle();
              return data ? {
                id: String(data.id), step_key: String(data.step_key),
                step_type: String(data.step_type), position: Number(data.position),
                transitions: Array.isArray((data as any).transitions) ? (data as any).transitions : [],
                message_text: String((data as any).message_text || ""),
                captures: Array.isArray((data as any).captures) ? (data as any).captures : [],
              } : null;
            };
            const _flowDQuickCadastroIntent = (() => {
              const _fv = String((customer as any)?.flow_variant || "").toUpperCase();
              if (_fv !== "D" && _fv !== "M") return false;
              const raw = `${buttonId || ""} ${messageText || ""}`.toLowerCase()
                .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
              return /cadastro[_\s-]*rapido|cadastrar\s*e\s*finalizar|quero\s*me\s*cadastrar|\bcadastrar\b/.test(raw)
                || (String(stepRow.step_key || "") === "d_welcome" && /\bhumano\b/.test(raw));
            })();
            const _resolveNextFromTransitions = async (txns: any[], msg: string) => {
              const arr = Array.isArray(txns) ? txns : [];
              const msgN = _norm(msg);
              const candidates = new Set<string>([msgN, _norm(buttonId || "")].filter(Boolean));
              const n = Number((msgN.match(/^([1-9])(?:\D|$)/) || [])[1] || 0);
              const btns = (Array.isArray((stepRow as any).captures) ? (stepRow as any).captures : [])
                .find((c: any) => c?.field === "_buttons" && Array.isArray(c?.value))?.value || [];
              const selectedBtn = n > 0 ? btns[n - 1] : null;
              if (selectedBtn?.id) candidates.add(_norm(selectedBtn.id));
              if (selectedBtn?.title) candidates.add(_norm(selectedBtn.title));
              // 1) match por trigger_phrases (intents afirmacao/negacao/etc)
              for (const t of arr) {
                const phrases = Array.isArray(t?.trigger_phrases) ? t.trigger_phrases : [];
                if (!phrases.length) continue;
                for (const p of phrases) {
                  const pn = _norm(p);
                  if (!pn) continue;
                  const safe = pn.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                  const matched = Array.from(candidates).some((cand) => cand === pn || new RegExp(`(^|\\W)${safe}(\\W|$)`).test(cand));
                  if (matched) {
                    if (t?.goto_step_id) return { matched: true, next: await _loadStepById(String(t.goto_step_id)) };
                    if (t?.goto_special) return { matched: true, next: { __special: String(t.goto_special) } as any };
                  }
                }
              }
              // 2) default explícito com goto_step_id
              const def = arr.find((t: any) =>
                String(t?.trigger_intent || "").toLowerCase() === "default"
                && (!Array.isArray(t?.trigger_phrases) || t.trigger_phrases.length === 0)
                && t?.goto_step_id
              );
              if (def?.goto_step_id) return { matched: false, next: await _loadStepById(String(def.goto_step_id)) };
              if (def?.goto_special) return { matched: false, next: { __special: String(def.goto_special) } as any };
              return { matched: false, next: null as any };
            };

            const txnsNow = Array.isArray(stepRow.transitions) ? stepRow.transitions : [];
            const hasIntentTxns = txnsNow.some((t: any) =>
              Array.isArray(t?.trigger_phrases) && t.trigger_phrases.length > 0
            );
            const resolved = await _resolveNextFromTransitions(txnsNow, messageText);
            let nextCustom: any = resolved.next;
            if (_flowDQuickCadastroIntent) {
              const docStep = await _loadStepByKey("d_pedir_documento");
              if (docStep) {
                console.log(`[flow-d-guard] cadastro rápido/cadastrar → ${docStep.step_key} (nunca simulação)`);
                nextCustom = docStep;
              }
            }

            if (nextCustom?.__special) {
              const sp = String(nextCustom.__special).toLowerCase().trim();
              if (sp === "humano" && _flowDQuickCadastroIntent) {
                const docStep = await _loadStepByKey("d_pedir_documento");
                if (docStep) nextCustom = docStep;
                else return { reply: "Para continuar, me envia uma foto da *frente do seu documento* 📄\n\nPode ser RG ou CNH, o que estiver mais à mão.", updates: { conversation_step: "aguardando_doc_auto", __inline_sent: emittedCurrent || undefined } as any };
              } else
              if (sp === "humano") {
                return { reply: `Tudo bem! Vou chamar ${nomeRepresentante || "um consultor"} para te ajudar por aqui 🙌`, updates: { conversation_step: "aguardando_humano", bot_paused: true, bot_paused_reason: "flow_button_humano", bot_paused_at: new Date().toISOString(), __inline_sent: emittedCurrent || undefined } as any };
              }
              if (sp === "cadastro") {
                return { reply: "", updates: { conversation_step: "aguardando_conta", sales_phase: "fechamento", __inline_sent: emittedCurrent || undefined } as any };
              }
              if (sp === "menu") {
                nextCustom = await _loadStepById(String(stepRow.id));
              } else {
                nextCustom = null;
              }
            }

            // Cobertura / cidade vizinha: responde a dúvida ANTES do no-match rude.
            if (!nextCustom && hasIntentTxns) {
              try {
                const { isCoverageCityIntent, coverageCityReply } = await import("../../_shared/coverage-city-intent.ts");
                if (isCoverageCityIntent(String(messageText || ""))) {
                  const cov = coverageCityReply((customer as any)?.name);
                  console.log(`[custom-step-resolver] coverage-city intent — FAQ antes de no-match`);
                  const stepNow = String(stepRow.step_key || stepRow.id);
                  try { await sendText(remoteJid, cov); } catch (_) { /* noop */ }
                  try {
                    const { reemitStepButtons } = await import("../../_shared/bot/reemit-buttons.ts");
                    await reemitStepButtons({
                      supabase, customerId: customer.id, consultantId: customer.consultant_id || consultorId,
                      flowVariant: (customer as any)?.flow_variant || "A", stepKey: stepNow,
                      remoteJid, sendButtons, sendText,
                    });
                  } catch (_) { /* noop */ }
                  return {
                    reply: "",
                    updates: {
                      __inline_sent: true,
                      custom_step_retries: 0,
                      custom_step_retries_step: null,
                      conversation_step: stepNow,
                    } as any,
                  };
                }
              } catch (e) {
                console.warn("[custom-step-resolver] coverage-city check:", (e as Error)?.message);
              }
            }

            // Se há perguntas (intent txns) e a resposta NÃO casou e não há default,
            // aguarda nova mensagem (não pula o passo) — mas só até 2 tentativas;
            // depois escala para humano (anti-loop).
            if (!nextCustom && hasIntentTxns && !txnsNow.some((t: any) => String(t?.trigger_intent||"").toLowerCase()==="default")) {
              const stepKeyForRetry = String(stepRow.step_key || stepRow.id);
              const sameStep = String((customer as any).custom_step_retries_step || "") === stepKeyForRetry;
              const retries = sameStep ? Number((customer as any).custom_step_retries || 0) : 0;
              const MAX_RETRIES = 2;
              if (retries >= MAX_RETRIES) {
                console.warn(`[custom-step-resolver] anti-loop: step=${stepKeyForRetry} retries=${retries} → handoff humano`);
                try {
                  await supabase.from("bot_handoff_alerts").insert({
                    customer_id: customer.id,
                    consultant_id: customer.consultant_id || consultorId,
                    reason: "custom_step_no_match_retries_exhausted",
                    metadata: { step_key: stepKeyForRetry, step_id: stepRow.id, retries, last_message: String(messageText || "").slice(0, 200) },
                  });
                } catch (e) { console.warn("[custom-step-resolver] handoff alert falhou:", (e as Error).message); }
                try {
                  notifyHandoff(
                    customer.consultant_id || consultorId,
                    {
                      id: customer.id,
                      name: (customer as any).name,
                      name_source: (customer as any).name_source,
                      phone_whatsapp: (customer as any).phone_whatsapp || phone,
                      conversation_step: stepKeyForRetry,
                    },
                    messageText,
                    "custom_step_no_match_retries_exhausted",
                  ).catch((e) => console.warn("[notify-handoff] falhou:", (e as Error).message));
                } catch (_) { /* notify opcional */ }
                return {
                  reply: "Vou chamar um consultor para te ajudar agora. Em instantes alguém responde por aqui. 👋",
                  updates: {
                    bot_paused: true,
                    bot_paused_reason: "custom_step_no_match_retries_exhausted",
                    bot_paused_at: new Date().toISOString(),
                    conversation_step: "aguardando_humano",
                    custom_step_retries: 0,
                    custom_step_retries_step: null,
                    __inline_sent: emittedCurrent || undefined,
                  } as any,
                };
              }
              // Resposta não casou: IA responde a dúvida + reentry só com a pergunta final do step
              const nextRetries = retries + 1;
              console.log(`[custom-step-resolver] no-match step=${stepKeyForRetry} retry=${nextRetries}/${MAX_RETRIES} → respondAndReentry`);
              // Atualiza contador antes de chamar (helper pode pausar se detour>=5)
              try {
                await supabase.from("customers").update({
                  custom_step_retries: nextRetries,
                  custom_step_retries_step: stepKeyForRetry,
                }).eq("id", customer.id);
                (customer as any).custom_step_retries = nextRetries;
                (customer as any).custom_step_retries_step = stepKeyForRetry;
              } catch (_) { /* noop */ }
              return await respondAndReentry({
                reason: "custom_step_no_match",
                questionText: messageText,
                reentryFull: String(stepRow.message_text || ""),
              });
            }

            // Match resolvido ou avanço por default → zera contador de retry
            if (nextCustom && (customer as any).custom_step_retries) {
              (updates as any).custom_step_retries = 0;
              (updates as any).custom_step_retries_step = null;
            }

            // Fallback: próximo por position
            if (!nextCustom) {
              nextCustom = await findNextActiveFlowStep(supabase, customer.consultant_id, { variant: (customer as any).flow_variant,
                afterPosition: Number(stepRow.position) || 0,
              });
            }

            if (nextCustom) {
              // Heurística: passo cujo texto termina em "?" é uma pergunta — aguarda resposta.
              const _looksLikeQuestion = (s: any) =>
                String(s?.message_text || "").trim().replace(/[\s\u200B-\u200D\uFEFF]+$/g, "").endsWith("?");

              // Chain: avança automaticamente passos message que tenham default sem phrases
              // E que NÃO sejam perguntas (texto não termina em "?").
              let current = nextCustom;
              let dispatchedAny = false;
              for (let hops = 0; hops < 20; hops++) {
                const ok = await dispatchStepFromFlow(current.step_key, _vars);
                dispatchedAny = dispatchedAny || !!ok;
                console.log(`[custom-step-resolver] chain-emit step=${current.step_key} pos=${current.position} dispatched=${ok}`);
                const ctype = String(current.step_type || "message");
                if (ctype !== "message") break;
                if (_looksLikeQuestion(current)) {
                  console.log(`[chain-stop] pos=${current.position} step=${current.step_key} motivo=pergunta(text ends with ?)`);
                  break;
                }
                const ctxns = Array.isArray(current.transitions) ? current.transitions : [];
                const defTxn = ctxns.find((t: any) =>
                  String(t?.trigger_intent || "").toLowerCase() === "default"
                  && (!Array.isArray(t?.trigger_phrases) || t.trigger_phrases.length === 0)
                );
                if (!defTxn) break; // tem pergunta/objeção → aguarda resposta
                let nxt: any = null;
                if (defTxn?.goto_step_id) nxt = await _loadStepById(String(defTxn.goto_step_id));
                if (!nxt) {
                  nxt = await findNextActiveFlowStep(supabase, customer.consultant_id, { variant: (customer as any).flow_variant,
                    afterPosition: Number(current.position) || 0,
                  });
                }
                if (!nxt) break;
                // Pre-check do próximo: se já parece pergunta, dispara e para
                if (_looksLikeQuestion(nxt)) {
                  await new Promise((r) => setTimeout(r, 1500));
                  const okQ = await dispatchStepFromFlow(nxt.step_key, _vars);
                  dispatchedAny = dispatchedAny || !!okQ;
                  console.log(`[chain-stop] pos=${nxt.position} step=${nxt.step_key} motivo=proxima-eh-pergunta dispatched=${okQ}`);
                  current = nxt;
                  break;
                }
                console.log(`[chain-skip] from=${current.position} to=${nxt.position} motivo=default-no-phrases`);
                await new Promise((r) => setTimeout(r, 1500));
                current = nxt;
              }
              const ntype = String(current.step_type || "message");
              let nextStepValue: string = current.id;
              let _isCapture = false;
              if (ntype === "capture_conta") {
                nextStepValue = "aguardando_conta";
                _isCapture = true;
                if (current?.id) (customer as any).previous_conversation_step = String(current.id);
              }
              else if (ntype === "capture_documento" || ntype === "capture_doc") { nextStepValue = "aguardando_doc_auto"; _isCapture = true; }
              else if (ntype === "capture_email") { nextStepValue = "ask_email"; _isCapture = true; }
              else if (ntype === "confirm_phone") { nextStepValue = "ask_phone_confirm"; _isCapture = true; }
              else if (ntype === "finalizar_cadastro") {
                nextStepValue = nextSeparatedCadastroStep(customer as any, {
                  fromStepKey: current?.step_key,
                });
                if (String(current?.step_key || "") === "a10_portal_otp_facial") {
                  (customer as any).contaunica = true;
                  (customer as any).contaunica_answered = true;
                }
              }
              // 🛡️ Skip-guard: se o capture seguinte já tem o dado, avança direto.
              if (_isCapture && shouldSkipAskStep(nextStepValue, customer)) {
                const skipped = nextStepValue;
                nextStepValue = getNextMissingStep({ ...customer });
                _isCapture = false;
                console.log(`[custom-step-resolver] skip ${skipped} → ${nextStepValue} (dado já existe)`);
              }
              console.log(`[custom-step-resolver] message→advance final=${current.step_key} type=${ntype} isCapture=${_isCapture}`);
              const _updates: any = { conversation_step: nextStepValue, __inline_sent: (emittedCurrent || dispatchedAny) || undefined };
              if (ntype === "capture_conta" && current?.id) {
                _updates.previous_conversation_step = String(current.id);
              }
              const _currentHasInlineCapture = Array.isArray((current as any)?.captures)
                && (current as any).captures.some((c: any) => c?.enabled === true);
              if ((_isCapture || _currentHasInlineCapture) && (emittedCurrent || dispatchedAny)) {
                _updates.last_custom_prompt_at = new Date().toISOString();
              }
              return { reply: "", updates: _updates };
            }
            // Sem próximo passo configurado → finaliza
            console.log(`[custom-step-resolver] sem próximo passo após pos=${stepRow.position} → finalizando`);
            step = "finalizando";
          }
        } else {
          // UUID/step_key órfão (passo deletado, fluxo trocado ou step de OUTRO consultor)
          console.warn(`[custom-step-resolver] step "${step}" não encontrado no fluxo ativo — tentando recuperar`);
          // 🛡️ FIX 2026-06-06: step órfão + resposta afirmativa → retoma pelo
          // estado REAL do lead (foto/OCR/confirmação), não só electricity_bill_value
          // (estimativa da simulação rápida não conta como conta enviada).
          const _t = String(messageText || "").trim().toLowerCase();
          const _afirm = /^(1|sim|s|ok|claro|quero|cadastrar|cadastrar.?me|quero\s+me\s+cadastrar|continuar|bora|vamos)\b/.test(_t)
            || /^(btn_)?(quero_cadastrar|cadastrar)\b/.test(String(buttonId || "").toLowerCase());
          if (_afirm) {
            const resumed = resolveResumeStep(customer);
            console.log(`[custom-step-resolver] órfão+afirm → resume ${resumed} (hasBillData=${hasBillData(customer)})`);
            step = resumed;
          } else {
            if (!stepIsUuid) {
              await dispatchStepFromFlow(step).catch(() => false);
            }
            return { reply: "", updates: { __inline_sent: true } as any };
          }
        }
      }
    } catch (e) {
      console.warn("[custom-step-resolver] falhou:", (e as any)?.message);
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // 🛟 GUARDA DE CORREÇÃO (Req 7.1) — defesa independente do worker.
  // Se o Portal 2 rejeitou um dado recuperável (portal2_status=
  // 'awaiting_correction'), FORÇA o roteamento para o step de correção
  // correto — não importa em que conversation_step o worker deixou o lead
  // (bug observado: worker deixava em 'cadastro_em_analise' e a resposta do
  // cliente com o número novo era ignorada). Assim a próxima mensagem do
  // cliente cai no handler corrigir_* e o dado é re-despachado ao portal.
  // Guarda: classe não-recuperável ou limite esgotado → needs_human (não pede).
  // ═══════════════════════════════════════════════════════════════════
  if (
    String((customer as any).portal2_status || "") === "awaiting_correction" &&
    !["corrigir_celular_portal", "corrigir_email_portal", "corrigir_instalacao_portal", "corrigir_documento_portal", "corrigir_documento_verso_portal", "portal_submitting"].includes(step)
  ) {
    const _decision = decideCorrection(
      (customer as any).portal2_error_kind,
      (customer as any).portal2_correction_attempts,
    );
    if (_decision.action === "open") {
      console.log(`[portal-correction:guard] forçando step=${_decision.spec.step} (era ${step}) kind=${_decision.kind}`);
      step = _decision.spec.step;
      (customer as any).conversation_step = _decision.spec.step;
    } else if (_decision.action === "needs_human") {
      updates.portal2_status = "needs_human";
      reply = "Recebi seu cadastro aqui! Esse caso específico vou encaminhar para um de nossos consultores finalizar com você — em breve alguém te chama por aqui 👍";
      return { reply, updates };
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // 📸 REDIRECT DE FOTO/PDF EM PASSO NÃO-CADASTRO (cadastro completo na IA livre)
  // Se o lead manda foto/PDF (não áudio) enquanto está num passo conversacional
  // inicial (welcome/qualificacao/etc.) e ainda não temos a conta, tratamos como
  // a CONTA DE LUZ e roteamos para "aguardando_conta" — assim o OCR real roda
  // e o pipeline determinístico segue até o portal. Sem isso, o case "welcome"
  // só mandava a saudação e IGNORAVA a foto (a IA livre "engolia" o arquivo).
  // Áudio nunca entra aqui: vira transcrição/texto e segue como mensagem comum.
  // ═══════════════════════════════════════════════════════════════════
  {
    // Passos iniciais/conversacionais onde uma foto deve ser tratada como a
    // CONTA DE LUZ. NÃO inclui passos de coleta de documento/edição — lá a foto
    // já tem dono (aguardando_doc_auto, etc.) e o switch trata corretamente.
    const _PHOTO_REDIRECT_STEPS = new Set<string>([
      "welcome", "menu_inicial", "pos_video", "checkin_pos_video",
      "qualificacao", "apresentacao", "objecoes", "duvidas_pos_club",
      "pitch_conexao_club", "aguardando_humano",
    ]);
    const _docAlreadyOcr = !!(customer as any).cpf || !!(customer as any).rg ||
      !!(customer as any).document_uploaded;
    if (
      (isFile || hasImage || hasDocument) &&
      !hasAudio &&
      _PHOTO_REDIRECT_STEPS.has(step) &&
      !(customer as any).electricity_bill_photo_url &&
      !_docAlreadyOcr
    ) {
      console.log(`[bot-flow] 📸 foto recebida em step="${step}" → redirecionando para aguardando_conta (OCR)`);
      step = "aguardando_conta";
      (customer as any).conversation_step = "aguardando_conta";
    }
  }

  switch (step) {
    // ─── 1. BOAS-VINDAS ────────────────────
    case "welcome": {
      // Vendedor humano: saudação curta sem botões. O áudio de abertura (slot)
      // já tocou. A partir daqui a IA assume a conversa em "qualificacao".
      const first = safeFirstNameForAddress((customer as any).name, (customer as any).name_source);
      const saud = first ? `Oi, ${first}! ` : "Oi! ";
      reply = `${saud}Tudo bem? Aqui é da equipe da *${nomeRepresentante}* 💚\n\nMe conta rapidinho: você paga em torno de quanto na sua conta de luz hoje?`;
      updates.conversation_step = "qualificacao";
      break;
    }

    case "qualificacao": {
      // 🛡️ Clique de botão NUNCA é nome — ignora capture quando isButton=true
      // (título do botão "Quero simular" virava name="Quero Simular").
      // Bug confirmado em sandbox 2026-05-29.
      const capturedName = !isButton ? normalizeLeadName(messageText) : null;
      if (capturedName) {
        updates.name = capturedName;
        updates.name_source = "self_introduced";
        (customer as any).name = capturedName;
        (customer as any).name_source = "self_introduced";
        const first = safeFirstNameForAddress(capturedName, "self_introduced");
        reply = first
          ? `${first}, qual a média da sua conta de luz?`
          : "Qual a média da sua conta de luz?";
        updates.conversation_step = "qualificacao";
        break;
      }

      if (isBogusCapturedName((customer as any).name)) {
        updates.name = null;
        updates.name_source = "unknown";
        (customer as any).name = null;
        (customer as any).name_source = "unknown";
      }

      const billValue = extractMoneyFromText(messageText) ?? 0;
      if (billValue > 0) {
        if (Number.isFinite(billValue) && billValue > 0 && billValue < 100) {
          updates.electricity_bill_value = billValue;
          updates.status = "rejected";
          updates.bot_paused = true;
          updates.bot_paused_reason = "low_bill_value";
          reply = `Obrigada por me falar. Com conta em torno de R$ ${billValue.toFixed(0)}, normalmente a economia fica pequena e pode não compensar agora. Vou deixar registrado e, se seu consumo subir, a gente retoma 💚`;
          updates.conversation_step = "valor_baixo";
          break;
        }
        if (Number.isFinite(billValue) && billValue >= 100) {
          updates.electricity_bill_value = billValue;
          updates.sales_phase = "fechamento";
          reply = `Com essa média, já dá para calcular sua economia. Me envie uma FOTO ou PDF da sua conta de energia para eu confirmar os dados.`;
          updates.conversation_step = "aguardando_conta";
          break;
        }
      }

      {
        const first = safeFirstNameForAddress(
          (customer as any).name,
          (customer as any).name_source,
        );
        reply = first
          ? `Certo, ${first}. Qual a média da sua conta de luz?`
          : "Qual é o seu nome?";
      }
      updates.conversation_step = "qualificacao";
      break;
    }

    // ─── 1b. CHECK-IN PÓS ÁUDIO/VÍDEO ────────────
    // Pergunta "deu pra entender?" depois do opening. Se afirmativo, vai pra qualificacao.
    // Se for dúvida/negativa, deixa a IA responder (mesma rota do qualificacao).
    case "checkin_pos_video": {
      const txt = String(messageText || "").trim().toLowerCase();
      const first = safeFirstNameForAddress((customer as any).name, (customer as any).name_source);
      const v = first ? `${first}, ` : "";
      const RE_AFFIRM = /(^(sim|ss+|s|deu|entendi|entendido|claro|ok|okay|beleza|blz|certo|positivo|isso|com\s*certeza|perfeito|bacana|massa|legal|joia|tranquilo)\b|^[\s]*(🆗|👌|👍|✅))/iu;
      const RE_NEG = /^(n[aã]o|nn|n|nada|n[aã]o\s*entendi|n[aã]o\s*muito|mais\s*ou\s*menos|m[ãa]is\s*menos|confuso)\b/i;
      if (RE_AFFIRM.test(txt)) {
        reply = `Boa! ${v}me conta uma coisa: quanto vem em média na sua conta de luz? Assim eu já te calculo quanto dá pra economizar 💡`;
        updates.conversation_step = "qualificacao";
        break;
      }
      if (RE_NEG.test(txt) || /\?/.test(txt)) {
        // Tenta Q&A configurado primeiro
        const qaResult = await trySendConfiguredQa();
        if (qaResult) return qaResult;
        // Caso contrário, resposta padrão e empurra pra qualificação
        reply = `Sem problema! Em resumo: a iGreen reduz o valor da sua conta de luz aplicando descontos da energia limpa, sem trocar nada na sua casa 💚\n\nMe diz: quanto vem em média na sua conta hoje?`;
        updates.conversation_step = "qualificacao";
        break;
      }
      // Não deu pra classificar → trata como começo de qualificação
      const billValue = extractMoneyFromText(txt) ?? 0;
      if (billValue > 0) {
        if (Number.isFinite(billValue) && billValue >= 30) {
          updates.electricity_bill_value = billValue;
          updates.sales_phase = "fechamento";
          reply = `Ótimo! Com R$ ${billValue.toFixed(0)} já consigo calcular sua economia. Envie uma *foto* (ou PDF) da sua conta de luz para eu confirmar os dados 📸`;
          updates.conversation_step = "aguardando_conta";
          break;
        }
      }
      reply = `${v}deu pra ouvir o áudio? Se quiser, me conta já o valor médio da sua conta de luz que eu adianto a economia pra você 💡`;
      updates.conversation_step = "qualificacao";
      break;
    }

    case "menu_inicial":
    case "pos_video": {
      // Legado: leads existentes presos no menu de botões. Migra direto pra IA conversacional.
      const resp = isButton ? buttonId : (messageText || "").toLowerCase().trim();
      if (resp === "cadastrar_agora" || resp?.includes("cadastr") || resp?.includes("participar")) {
        const first = safeFirstNameForAddress((customer as any).name, (customer as any).name_source);
        const v = first ? `${first}, ` : "";
        reply = `Boa! ${v}pra eu travar a sua economia exata, me manda uma *foto* (ou PDF) da sua última conta de luz aqui no chat 📸`;
        updates.conversation_step = "aguardando_conta";
        updates.sales_phase = "fechamento";
      } else if (resp === "falar_humano" || resp?.includes("humano") || resp?.includes("atendente")) {
        reply = `Tranquilo! Já te encaminhei pra *${nomeRepresentante}*, ela te chama aqui mesmo, ok?`;
        updates.conversation_step = "aguardando_humano";
      } else {
        // Qualquer outra coisa → vira conversa livre, IA assume.
        const first = safeFirstNameForAddress((customer as any).name, (customer as any).name_source);
        const v = first ? `${first}, ` : "";
        reply = `${v}me conta: quanto vem em média na sua conta de luz? Assim eu já te calculo quanto dá pra economizar 💡`;
        updates.conversation_step = "qualificacao";
      }
      break;
    }

    case "aguardando_humano": {
      const resp = messageText.toLowerCase().trim();
      if (resp?.includes("cadastr") || resp === "2") {
        reply = "Perfeito! 🙌\n\n📸 Me envia agora uma *foto da sua conta de luz* (fatura do mês atual ou a anterior).💚";
        updates.conversation_step = "aguardando_conta";
      } else {
        reply = `⏳ Sua solicitação já foi registrada! Um consultor da equipe *${nomeRepresentante}* entrará em contato em breve.\n\nSe quiser iniciar o cadastro agora, digite *cadastrar*.`;
      }
      break;
    }

    // ─── 2. AGUARDANDO CONTA ──────────────
    case "aguardando_conta": {
      // 🔁 IDEMPOTÊNCIA: conta JÁ recebida e confirmada — não reprocessar.
      if (hasBillData(customer) && (customer as any).bill_data_confirmed_at) {
        const resumed = resolveResumeStep(customer);
        console.log(`[idempotency] aguardando_conta — conta já confirmada, retomando em ${resumed}`);
        updates.conversation_step = resumed;
        reply = isFile
          ? `Já recebi sua conta de luz ✅ Vamos continuar de onde paramos 👇\n\n${getReplyForStep(resumed, customer)}`
          : getReplyForStep(resumed, customer);
        break;
      }
      // 🛡️ Clique de botão (welcome residual) chegando em aguardando_conta:

      // re-emite prompt da conta em vez de tratar título como texto livre.
      // Bug confirmado em sandbox 2026-05-29.
      if (isButton) {
        const _firstName = safeFirstNameForAddress((customer as any).name, (customer as any).name_source);
        const _v = _firstName ? `${_firstName}, ` : "";
        reply = `${_v}me manda uma *foto* (ou PDF) da sua conta de luz, por favor 📸\n\nSe estiver sem a conta agora, é só me dizer o valor médio que você paga.`;
        break;
      }
      // F07: diagnóstico OCR → engine_logs (não poluir customers.error_message)
      try {
        await supabase.from("engine_logs").insert({
          customer_id: customer.id,
          event: "aguard_conta_debug",
          payload: {
            isFile,
            hasImage,
            fileBase64Len: fileBase64?.length ?? 0,
            sandbox: isCustomerSandbox(customer),
          },
        } as any);
      } catch (_) { /* noop */ }
      if (!isFile) {
        const txt = String(messageText || "").trim();
        const first = safeFirstNameForAddress((customer as any).name, (customer as any).name_source);
        const v = first ? `${first}, ` : "";

        // Lead recusa mandar a foto → aceita seguir só com o valor.
        // Grupo A / Sofia: NÃO — exige foto da conta (OCR). Sem bypass.
        if (txt && RE_REFUSE_BILL.test(txt)) {
          const variant = String((customer as any)?.flow_variant || "").toUpperCase();
          const isGrupoA = variant === "A" || variant === "C" ||
            /^a\d+_/i.test(String((customer as any)?.conversation_step || ""));
          if (isGrupoA) {
            reply = `${first ? first + ", " : ""}pra seguir o cadastro preciso da *foto da conta de luz* 📸\n\nQuando puder, manda aqui (página com o valor e os dados da unidade). Sem a foto não consigo avançar.`;
            break;
          }
          const billVal = Number((customer as any).electricity_bill_value || 0);
          if (billVal >= 30) {
            reply = `Tranquilo, ${first || "vamos"}! Já tenho o valor que você passou (R$ ${billVal.toFixed(0)}), seguimos sem a foto então 👍\n\nPra fechar o cadastro me manda só uma foto da *frente do seu documento* (RG ou CNH, tanto faz — eu reconheço sozinho).`;
            updates.conversation_step = "aguardando_doc_auto";
            break;
          }
          // Sem valor ainda → pede só o valor, sem cobrar foto.
          reply = `Sem problema! Então me passa só o valor médio que vem na sua conta de luz (uns R$?). Com isso eu já consigo te dar a economia 💡`;
          updates.conversation_step = "qualificacao";
          break;
        }

        // Captura valor digitado no meio do aguardando_conta (lead já mandando dado útil)
        const billValue = extractMoneyFromText(txt) ?? 0;
        if (billValue > 0 && !((customer as any).electricity_bill_value)) {
          if (Number.isFinite(billValue) && billValue >= 30) {
            updates.electricity_bill_value = billValue;
            // Simulação inicial já com base no valor digitado. Fluxo M usa 10-28%; demais 8-20%.
            const _rates = discountRates((customer as any)?.flow_variant);
            const economiaMin = Math.max(1, Math.round(billValue * _rates.min));
            const economiaMax = Math.max(2, Math.round(billValue * _rates.max));
            const fmt = (n: number) => n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            reply =
              `Boa, ${first || "anotado"}! Anotei R$ ${fmt(billValue)} 💚\n\n` +
              `💡 Conta atual: *R$ ${fmt(billValue)}*\n` +
              `💚 Economia estimada: *R$ ${economiaMin} a R$ ${economiaMax}* por mês (${_rates.label})\n\n` +
              `✅ Sem obra\n✅ Sem instalação\n✅ Mesma distribuidora\n\n` +
              `Pra travar o cálculo exato e seguir o cadastro, me manda agora a *foto* (ou PDF) da sua última conta de luz 📸`;
            break;
          }
        }

        // ANTI-DUP: se o passo custom acabou de perguntar, NÃO duplica o prompt legacy.
        // Apenas espera o cliente mandar a foto/PDF (ou valor).
        const _lastCustom = (customer as any).last_custom_prompt_at;
        if (_lastCustom && (Date.now() - new Date(_lastCustom).getTime()) < 10 * 60 * 1000) {
          console.log(`[anti-dup] aguardando_conta: passo custom já perguntou (${_lastCustom}) — silenciando re-prompt`);
          reply = "";
          break;
        }

        reply = `${v}me manda uma *foto* (ou PDF) da sua conta de luz, por favor 📸\n\nSe estiver sem a conta agora, é só me dizer o valor médio que você paga que eu já te calculo a economia.`;
        break;
      }
      const inboundMime = imageMessage?.mimetype || documentMessage?.mimetype || "application/octet-stream";
      // ⚠️ FIX 2026-05-30: removido o "preflight" que rejeitava a conta como
      // documento (classificador RG/CNH não conhece "conta de luz"). A blindagem
      // correta já existe no processando_ocr_conta (OCR real da conta).
      if (fileBase64) {
        const mime = inboundMime;
        // OOM-FIX 2026-06-28: não gravar `data:${mime};base64,...` nem o base64 cru
        // em colunas do banco. A foto vai para o MinIO logo abaixo (background) e
        // a URL real sobrescreve `electricity_bill_photo_url`. O sentinel curto
        // mantém o `hasFile()` do portal-worker truthy enquanto a URL não chega.
        updates.electricity_bill_photo_url = "evolution-media:pending";
        updates.bill_base64 = "inline";
        updates.bill_message_id = messageId || null;
        updates.media_storage = "inline";
        const custId = customer.id;
        uploadMediaToMinio({
          fileBase64, mimeType: mime, consultantFolder: consultorId, consultantName: nomeRepresentante,
          customerName: customer.name || "cliente", customerBirth: customer.data_nascimento, kind: "conta",
        }).then(async (minioUrl) => {
          if (minioUrl) {
            await supabase.from("customers").update({ electricity_bill_photo_url: minioUrl, media_storage: "minio" }).eq("id", custId);
            console.log(`📦✅ [BG] Conta uploaded MinIO: ${minioUrl.substring(0, 80)}`);
          }
        }).catch((e) => console.warn(`📦⚠️ [BG] MinIO conta falhou: ${e?.message}`));
      } else {
        updates.electricity_bill_photo_url = fileUrl?.startsWith("http") ? fileUrl : "evolution-media:pending";
        updates.bill_message_id = messageId || null;
      }
      updates.conversation_step = "processando_ocr_conta";
      await sendText(remoteJid, "✅ Conta recebida! ⏳ Analisando seus dados...\n\nAguarde alguns instantes...");

      // 📣 Avisa parceiro (se houver referral_partner_id): conta de luz recebida
      try {
        const { notifyPartnerStep } = await import("../../_shared/notify-consultant.ts");
        notifyPartnerStep(consultorId, customer.id, "bill_received")
          .catch((e) => console.warn("[evo bot-flow] notify bill_received:", e?.message));
      } catch (_) { /* noop */ }

      console.log("📥 Arquivo recebido:");
      console.log("  - isFile:", isFile);
      console.log("  - hasImage:", hasImage);
      console.log("  - hasDocument:", hasDocument);
      console.log("  - imageMessage:", !!imageMessage);
      console.log("  - documentMessage:", !!documentMessage);
      console.log("  - fileUrl:", fileUrl?.substring(0, 100));
      console.log("  - fileBase64 length:", fileBase64?.length || 0);
      console.log("  - mimetype:", imageMessage?.mimetype || documentMessage?.mimetype);

      if (fileBase64) {
        if (fileBase64.length < 100) {
          console.error("❌ Base64 muito pequeno:", fileBase64.length);
          updates.conversation_step = "aguardando_conta";
          reply = "⚠️ Erro ao processar imagem. Tente enviar uma foto mais nítida.";
          break;
        }
        try { atob(fileBase64.substring(0, 100)); } catch {
          console.error("❌ Base64 inválido");
          updates.conversation_step = "aguardando_conta";
          reply = "⚠️ Erro ao processar imagem. Tente enviar novamente.";
          break;
        }
      }

      const mediaMsg = documentMessage || imageMessage || {
        mimetype: imageMessage?.mimetype || documentMessage?.mimetype || "image/jpeg",
      };

      try {
        console.log("📡 Chamando OCR Gemini para conta:", fileUrl?.substring(0, 100));
        const resolvedImg = await resolveOcrImageForBill({
          fileBase64,
          fileUrl,
          mediaMessage: mediaMsg,
          customer,
          pendingUpdates: updates,
          fetchAuthBearer: Deno.env.get("WHAPI_TOKEN") || null,
        });
        if (!resolvedImg) {
          console.error("❌ OCR conta: sem bytes de imagem (fileBase64/url/customer)");
          updates.conversation_step = "aguardando_conta";
          reply = "⚠️ Não consegui abrir a foto da conta. Envie de novo como *imagem* ou *PDF*, bem nítida 📸";
          break;
        }
        const ocrBase64 = resolvedImg.b64;
        const ocrFileUrl = resolvedImg.resolvedUrl || fileUrl;
        if (resolvedImg.source !== "fileBase64") {
          console.log(`📥 OCR imagem via ${resolvedImg.source} (${ocrBase64.length}b)`);
        }
        // Timeout de 25s para o OCR (evita travar "Analisando...")
        const ocrData: any = await Promise.race([
          ocrContaEnergia(ocrFileUrl, geminiApiKey, ocrBase64, mediaMsg),
          new Promise((_, rej) => setTimeout(() => rej(new Error("OCR_TIMEOUT_25s")), 25_000)),
        ]);
        console.log("📊 OCR Conta resultado:", JSON.stringify(ocrData).substring(0, 400));
        if (ocrData.sucesso && ocrData.dados) {
          const d = ocrData.dados;
          const confianca = typeof d.confianca === "number" ? d.confianca : 100;
          if (confianca < OCR_CONFIDENCE_THRESHOLD) {
            jsonLog("warn", "OCR conta abaixo do threshold", { customer_id: customer.id, confianca, threshold: OCR_CONFIDENCE_THRESHOLD });
            const salvagedReply = await salvageIfDocumentMisroutedAtBillOcr({
              supabase,
              customer,
              updates,
              ocrBase64,
              mediaMsg,
              fileUrl,
              geminiApiKey,
              messageId,
            });
            if (salvagedReply) {
              reply = salvagedReply;
              break;
            }
            updates.conversation_step = "aguardando_conta";
            reply = OCR_RETRY_CONTA_SHORT;
            break;
          }
          // BLINDAGEM: OCR pode retornar sucesso=true com dados vazios.
          // Exigir ao menos 3 campos críticos preenchidos.
          const criticos = [d.nome, d.endereco, d.cep, d.cidade, d.distribuidora, d.numeroInstalacao, d.valorConta]
            .filter((v) => v && String(v).trim().length > 0);
          if (criticos.length < 3) {
            jsonLog("warn", "OCR conta com poucos campos válidos", { customer_id: customer.id, validos: criticos.length });
            const salvagedReply = await salvageIfDocumentMisroutedAtBillOcr({
              supabase,
              customer,
              updates,
              ocrBase64,
              mediaMsg,
              fileUrl,
              geminiApiKey,
              messageId,
            });
            if (salvagedReply) {
              reply = salvagedReply;
              break;
            }
            const tries = (customer.ocr_conta_attempts || 0) + 1;
            updates.ocr_conta_attempts = tries;
            if (tries < 2) {
              updates.conversation_step = "aguardando_conta";
              reply = OCR_RETRY_CONTA_SHORT;
            } else {
              updates.conversation_step = "ask_name";
              reply = "⚠️ Tive dificuldade em ler sua conta. Vou perguntar os dados manualmente.\n\nQual é o seu *nome completo*?";
            }
            break;
          }
          // C: validação anti-alucinação no nome OCR da conta
          {
            const ocrName = (d.nome || "").trim();
            // Sempre grava o nome bruto da conta para auditoria/conferência
            if (ocrName) updates.bill_holder_name = ocrName;
            const safe = safeAssignName(customer.name, (customer as any).name_source, ocrName);
            if (safe) {
              updates.name = safe;
              updates.name_source = "ocr_conta";
            } else if (!customer.name && ocrName) {
              // Sem nome prévio: aceita o nome do OCR mas marca como não confirmado
              updates.name = ocrName;
              updates.name_source = "ocr_conta";
            }
          }
          updates.address_street = d.endereco || "";
          updates.address_number = d.numero || "";
          updates.address_neighborhood = d.bairro || "";
          updates.cep = d.cep || "";
          updates.address_city = d.cidade || "";
          updates.address_state = d.estado || "";
          updates.distribuidora = d.distribuidora || "";
          // Validação número instalação ≥7 dígitos
          {
            const inst = String(d.numeroInstalacao || "").replace(/\D/g, "");
            updates.numero_instalacao = inst.length >= 7 ? inst : "";
          }
          updates.ocr_confianca = confianca;
          updates.ocr_done = true;
          const valorParsed = d.valorConta ? parseFloat(d.valorConta) : 0;
          updates.electricity_bill_value = (valorParsed >= 30) ? valorParsed : 0;
          // Consumo médio (kWh) — usa OCR se disponível; senão estima pelo valor
          // (tarifa B1 ~R$1,10/kWh, clamp 100..2000). Garante que o
          // worker-portal-2 nunca receba media_consumo=NULL.
          // Sanity-check: rejeita OCR se R$/kWh ficar fora de [0.70 .. 1.60].
          {
            const kwhOcr = parseInt(String(d.consumoMedio || "").replace(/\D/g, ""), 10);
            const valor = Number(updates.electricity_bill_value || 0);
            let ratioOk = true;
            if (!isNaN(kwhOcr) && kwhOcr >= 50 && valor >= 30) {
              const ratio = valor / kwhOcr;
              ratioOk = ratio >= 0.70 && ratio <= 1.60;
              if (!ratioOk) {
                console.warn(`⚡ [sanity] OCR consumo=${kwhOcr} kWh valor=R$${valor} ratio=${ratio.toFixed(2)} fora de [0.70..1.60] — rejeitado`);
                (updates as any).ocr_consumo_rejeitado = true;
                (updates as any).ocr_consumo_original = kwhOcr;
              }
            }
            if (ratioOk && !isNaN(kwhOcr) && kwhOcr >= 50 && kwhOcr <= 5000) {
              updates.media_consumo = kwhOcr;
            } else if (valor >= 30) {
              const est = Math.round(valor / 1.10);
              updates.media_consumo = Math.max(100, Math.min(2000, est));
              console.log(`⚡ media_consumo estimado=${updates.media_consumo} kWh (valor=R$${valor})`);
            }
          }
          // CEP: só aceita se tiver 8 dígitos
          if (updates.cep) {
            const cepClean = String(updates.cep).replace(/\D/g, "");
            updates.cep = cepClean.length === 8 ? cepClean : "";
          }
          if (!updates.cep) {
            console.warn(`[telemetry] ocr_cep_missing customer=${customer.id} has_street=${!!updates.address_street} has_city=${!!updates.address_city} has_state=${!!updates.address_state}`);
          }
          if (!updates.cep && updates.address_city && updates.address_state && updates.address_street) {
            console.log("🔍 CEP não encontrado. Buscando via ViaCEP (reverse)...");
            const cepBuscado = await buscarCepPorEndereco(updates.address_state, updates.address_city, updates.address_street);
            if (cepBuscado) {
              updates.cep = cepBuscado;
              console.log(`✅ CEP auto-preenchido: ${cepBuscado}`);
            }
          }
          // OCR trouxe CEP mas faltam campos do endereço → forward lookup
          if (updates.cep && (!updates.address_street || !updates.address_neighborhood || !updates.address_city || !updates.address_state)) {
            console.log(`🔍 CEP ${updates.cep} presente, completando endereço via ViaCEP (forward)...`);
            const end = await buscarEnderecoPorCep(updates.cep);
            if (end) {
              if (!updates.address_street && end.logradouro) updates.address_street = end.logradouro;
              if (!updates.address_neighborhood && end.bairro) updates.address_neighborhood = end.bairro;
              if (!updates.address_city && end.localidade) updates.address_city = end.localidade;
              if (!updates.address_state && end.uf) updates.address_state = end.uf;
              console.log(`✅ Endereço completado via CEP: ${end.logradouro || "(s/rua)"} - ${end.localidade}/${end.uf}`);
            }
          }

          // BLINDAGEM: nome e valor são obrigatórios. Se faltar, perguntar antes da confirmação.
          const finalName = updates.name || customer.name;
          if (!finalName || String(finalName).trim().length < 3) {
            updates.conversation_step = "editing_conta_nome";
            reply = "📋 Consegui ler quase tudo da sua conta! Só preciso confirmar uma coisa:\n\n👤 Qual é o seu *nome completo* (como aparece na conta)?";
            break;
          }
          if (!updates.electricity_bill_value || updates.electricity_bill_value < 30) {
            updates.conversation_step = "editing_conta_valor";
            reply = `📋 Já peguei seus dados, ${safeFirstNameForAddress(finalName, "ocr_conta")}! Só me confirma uma coisa:\n\n💰 Qual o *valor médio* da sua conta de luz? (ex: 350,00)`;
            break;
          }

          // OCR conta ok → avança sozinho (sem SIM/NÃO/EDITAR). Sofia → a7; demais → doc genérico.
          if (await advanceSofiaToDocumentAfterBill({
            customer,
            updates,
            dispatchStep: (k, v) => dispatchStepFromFlow(k, v),
            logPrefix: "ocr-bill/evolution",
          })) {
            reply = "";
            break;
          }
          reply = advanceGenericToDocumentAfterBill(updates);
          console.log(`[ocr-bill/evolution] auto-advance conta→doc (sem confirmação) customer=${customer.id}`);
          break;


        } else {
          console.error("❌ OCR conta falhou:", ocrData.erro);
          const salvagedReply = await salvageIfDocumentMisroutedAtBillOcr({
            supabase,
            customer,
            updates,
            ocrBase64,
            mediaMsg,
            fileUrl,
            geminiApiKey,
            messageId,
          });
          if (salvagedReply) {
            reply = salvagedReply;
            break;
          }
          // Task 6 (captacao-fluxo-d-conversao): registra alerta para
          // que o consultor veja no NotificationCenter quando lead em
          // Fluxo D não consegue passar do OCR. Para A/B/C/E o helper
          // pula sozinho (variant != 'D').
          void recordFlowDAlert({
            supabase,
            customerId: customer.id,
            consultantId: customer.consultant_id,
            conversationStep: "aguardando_conta",
            alertType: "flow_d_ocr_failed_bill",
            reason: String(ocrData?.erro || "ocr_failed"),
            flowVariant: (customer as any)?.flow_variant,
          });
          const tries = (customer.ocr_conta_attempts || 0) + 1;
          updates.ocr_conta_attempts = tries;
          const ocrFb = await resolveOcrFallback(
            supabase,
            customer.id,
            customer.consultant_id,
            "capture_conta",
            tries,
            OCR_RETRY_CONTA_SHORT,
            (customer as any).flow_variant,
          );
          if (ocrFb.escalate) {
            updates.bot_paused = true;
            updates.bot_paused_reason = "ocr_conta_retry_exhausted";
            updates.bot_paused_at = new Date().toISOString();
            updates.conversation_step = "aguardando_humano";
            reply = await getTemplate(supabase, "aguardando_humano", "avisado", {
              nome: customer.name,
              representante: nomeRepresentante,
            });
          } else {
            updates.conversation_step = "aguardando_conta";
            const sent = await sendOcrRetryMessage({
              supabase,
              remoteJid,
              customerId: customer.id,
              conversationStep: "aguardando_conta",
              text: ocrFb.retryText,
              retryAudioClipId: ocrFb.retryAudioClipId ?? null,
              sendText,
              sendMedia,
            });
            if (sent) {
              reply = "";
              (updates as any).__inline_sent = true;
            } else {
              reply = ocrFb.retryText;
            }
          }
        }
      } catch (e) {
        console.error("❌ Erro OCR conta:", e);
        // Task 6: alerta também em exception (timeout, rede, etc).
        void recordFlowDAlert({
          supabase,
          customerId: customer.id,
          consultantId: customer.consultant_id,
          conversationStep: "aguardando_conta",
          alertType: "flow_d_ocr_failed_bill",
          reason: (e as Error)?.message ?? String(e),
          flowVariant: (customer as any)?.flow_variant,
        });
        const tries = (customer.ocr_conta_attempts || 0) + 1;
        updates.ocr_conta_attempts = tries;
        const ocrFb = await resolveOcrFallback(
          supabase,
          customer.id,
          customer.consultant_id,
          "capture_conta",
          tries,
          "⚠️ Erro ao processar a conta. Tente enviar novamente.",
          (customer as any).flow_variant,
        );
        if (ocrFb.escalate) {
          updates.bot_paused = true;
          updates.bot_paused_reason = "ocr_conta_retry_exhausted";
          updates.bot_paused_at = new Date().toISOString();
          updates.conversation_step = "aguardando_humano";
          reply = await getTemplate(supabase, "aguardando_humano", "avisado", {
            nome: customer.name,
            representante: nomeRepresentante,
          });
        } else {
            updates.conversation_step = "aguardando_conta";
            const sent = await sendOcrRetryMessage({
              supabase,
              remoteJid,
              customerId: customer.id,
              conversationStep: "aguardando_conta",
              text: ocrFb.retryText,
              retryAudioClipId: ocrFb.retryAudioClipId ?? null,
              sendText,
              sendMedia,
            });
            if (sent) {
              reply = "";
              (updates as any).__inline_sent = true;
            } else {
              reply = ocrFb.retryText;
            }
          }
      }
      break;
    }

    // ─── 3. CONFIRMANDO DADOS DA CONTA ──────────
    case "confirmando_dados_conta": {
      const resp = isButton ? buttonId : messageText.toLowerCase().trim();
      console.log(`[post-confirm-conta] ENTER resp="${resp}" customer=${customer.id}`);
      if (resp === "sim_conta" || resp === "sim" || resp === "s" || resp === "1" || resp === "ok" || resp === "correto" || resp === "✅") {
        // Sofia A: SIM na conta → documento (nunca re-dispacha economia a3).
        if (await advanceSofiaToDocumentAfterBill({
          customer,
          updates,
          dispatchStep: (k, v) => dispatchStepFromFlow(k, v),
          logPrefix: "post-confirm-conta/evolution",
        })) {
          reply = "";
          break;
        }
        // 🛡️ SAFETY: dispatch pós-SIM em try/catch — nunca deixa o lead mudo.
        try {
        // 🔑 FIX (regressão ask_quero_cadastrar → loop): marca a conta como
        // CONFIRMADA pelo cliente. Sem isso, `resolveResumeStep` (chamado em
        // ask_quero_cadastrar e aguardando_conta) via `!bill_data_confirmed_at`
        // e devolvia o lead para `confirmando_dados_conta` em loop. No modo
        // `manual` o webhook já gravava esse timestamp; no modo `auto` ninguém
        // gravava. Idempotente: só seta se ainda não estava marcado.
        if (!(customer as any).bill_data_confirmed_at) {
          updates.bill_data_confirmed_at = new Date().toISOString();
          updates.bill_data_confirmation_by = "client";
        }
        // FIX 2: garantir que o nome confirmado é o do TITULAR DA CONTA (OCR),
        // não o nome digitado pelo lead no boas-vindas.
        const _billHolder = String((customer as any).bill_holder_name || (updates as any).bill_holder_name || "").trim();
        const _curSrc = String((customer as any).name_source || "");
        if (_billHolder && _billHolder.length >= 5 && _curSrc !== "ocr_conta" && _curSrc !== "ocr_doc") {
          updates.name = _billHolder;
          updates.name_source = "ocr_conta";
          console.log(`[name-override] SIM da conta → name="${_billHolder}" (era src=${_curSrc})`);
        }
        // Usuário confirmou os dados → blindar contra OCR de doc futuro
        if (updates.name || customer.name) updates.name_source = "user_confirmed";

        // Doc enviado cedo (antes da conta): após SIM da conta, usa o doc já
        // salvo — não pede foto de novo. Funil continua CONTA → DOCUMENTO.
        {
          const _mergedEarly = { ...customer, ...updates };
          const _earlyDocStep = resolveEarlyDocumentStepAfterBill(_mergedEarly);
          if (_earlyDocStep) {
            console.log(`[post-confirm-conta] doc precoce → ${_earlyDocStep} (sem re-pedir foto)`);
            updates.conversation_step = _earlyDocStep;
            if (_earlyDocStep === "confirmando_dados_doc") {
              reply = await autoAdvanceAfterDocOcr({
                customer: _mergedEarly,
                updates,
                remoteJid,
                sendOptions,
              });
            } else {
              reply = "✅ Conta recebida!\n\n📸 Agora envie o *VERSO do RG*.\n\nFormatos: JPG, PNG ou PDF";
            }
            break;
          }
        }

        const _valor = Number((customer as any).electricity_bill_value || 0);
        const _rates = discountRates((customer as any)?.flow_variant);
        const _fmtBRL = (n: number) => n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const _vars = {
          "{valor}": _fmtBRL(_valor),
          "{{valor}}": _fmtBRL(_valor),
          "{economia_mensal}": _fmtBRL(_valor * _rates.max),
          "{{economia_mensal}}": _fmtBRL(_valor * _rates.max),
          "{economia_anual}": _fmtBRL(_valor * _rates.max * 12),
          "{{economia_anual}}": _fmtBRL(_valor * _rates.max * 12),
        };

        // FIX: continuar a partir da POSIÇÃO do capture_conta no fluxo custom.
        // Se não conseguir descobrir essa posição, NUNCA usa afterPosition=0,
        // porque isso retorna o primeiro passo ativo (geralmente "Nome do cliente").
        let _captureContaPos = 0;
        try {
          const _flowRow = await resolveFlowId(supabase, customer.consultant_id, (customer as any)?.flow_variant || "A");
          if (_flowRow?.id) {
            const { data: _captureRow } = await supabase
              .from("bot_flow_steps").select("position")
              .eq("flow_id", (_flowRow as any).id).eq("is_active", true)
              .eq("step_type", "capture_conta")
              .order("position", { ascending: true }).limit(1).maybeSingle();
            if (_captureRow?.position != null) _captureContaPos = Number(_captureRow.position) || 0;
          }
        } catch (e) {
          console.warn(`[post-confirm-conta] falha ao localizar capture_conta: ${(e as any)?.message || e}`);
        }
        console.log(`[post-confirm-conta] capture_conta_pos=${_captureContaPos || "not_found"}`);
        // 🔑 Honra o destino configurado pelo consultor no capture_conta antes
        // de cair na busca por posição. PRIORIDADE: fallback.success_goto_step_id
        // → fallback.goto_step_id (quando fallback.mode === "goto", que é o que
        // o FlowBuilder grava em "Plano B: ir para passo X"). Sem isso o handler
        // avançava por posição e podia despachar o passo errado (ex.:
        // d_como_funciona em vez de d_resultado) após confirmar a conta.
        let nextCustom: any = null;
        try {
          const _flowRowSuccess = await resolveFlowId(supabase, customer.consultant_id, (customer as any)?.flow_variant || "A");
          if (_flowRowSuccess?.id) {
            const { data: _allSteps } = await supabase
              .from("bot_flow_steps").select("id, step_key, step_type, title, position, fallback, transitions, is_active")
              .eq("flow_id", (_flowRowSuccess as any).id).eq("is_active", true)
              .order("position", { ascending: true });
            let _recentInbound = "";
            try {
              const { data: _li } = await supabase
                .from("conversations")
                .select("message_text")
                .eq("customer_id", customer.id)
                .eq("message_direction", "inbound")
                .order("created_at", { ascending: false })
                .limit(5);
              _recentInbound = (((_li as any[]) || []).map((r) => String(r.message_text || "")).join(" | ")).slice(0, 500);
            } catch (_) { /* noop */ }
            const { pickCaptureContaForPostBill } = await import("../../_shared/bot/post-bill-capture.ts");
            const _captureStep = pickCaptureContaForPostBill((_allSteps as any[]) || [], {
              preferredStepId: (customer as any).previous_conversation_step || null,
              recentInbound: _recentInbound,
            });
            console.log(`[post-confirm-conta] capture escolhido=${(_captureStep as any)?.step_key || "null"}`);
            const _fb = (_captureStep as any)?.fallback || {};
            const _successId = resolvePostBillNextStepId(_fb);
            const _successSource = _fb.success_goto_step_id ? "success_goto_step_id" : "fallback.goto_step_id";
            if (_successId) {
              // 🛡️ FIX 2026-06-06: PRENDE ao flow_id ativo. Sem esse filtro
              // o success_goto podia apontar para step de outro consultor
              // (caso lead 11971254913), o que persistia conversation_step
              // com UUID órfão e o resolver reenviava welcome no próximo turno.
              const { data: _target } = await supabase
                .from("bot_flow_steps").select("*")
                .eq("flow_id", (_flowRowSuccess as any).id)
                .eq("id", _successId).eq("is_active", true).maybeSingle();
              if (_target) {
                nextCustom = _target;
                console.log(`[post-confirm-conta] capture=${(_captureStep as any)?.step_key} ${_successSource}=${_successId} → ${(_target as any).step_key}`);
              } else {
                console.warn(`[post-confirm-conta] success_goto ${_successId} NÃO pertence ao flow ativo ${(_flowRowSuccess as any).id} — ignorando e usando posição`);
              }
            }
          }
        } catch (_e) { /* best-effort */ }
        if (!nextCustom) {
          nextCustom = _captureContaPos > 0
            ? await findNextActiveFlowStep(supabase, customer.consultant_id, { variant: (customer as any).flow_variant, afterPosition: _captureContaPos })
            : null;
        }
        // 🛡️ Rede de segurança: se a resolução (por goto OU por posição) caiu no
        // passo "como funciona", pula para o passo de simulação/resultado — o
        // "como funciona" só deve sair quando o lead clica no botão respectivo,
        // nunca após confirmar a conta.
        if (nextCustom && isComoFuncionaStep(nextCustom)) {
          const _flowRowResultado = await resolveFlowId(supabase, customer.consultant_id, (customer as any)?.flow_variant || "A");
          if (_flowRowResultado?.id) {
            const { data: _resultado } = await supabase
              .from("bot_flow_steps").select("*")
              .eq("flow_id", (_flowRowResultado as any).id).eq("is_active", true)
              .or("step_key.eq.d_resultado,message_text.ilike.%economia%,message_text.ilike.%valor_conta%")
              .order("position", { ascending: true }).limit(1).maybeSingle();
            if (_resultado) {
              console.log(`[post-confirm-conta] pulando ${nextCustom.step_key} pós-conta → ${(_resultado as any).step_key}`);
              nextCustom = _resultado;
            }
          }
        }
        if (nextCustom && Number(nextCustom.position || 0) <= _captureContaPos) {
          console.warn(`[post-confirm-conta] ignorando regressão next=${nextCustom.step_key} pos=${nextCustom.position} capture_pos=${_captureContaPos}`);
          nextCustom = null;
        }
        if (!nextCustom) {
          nextCustom = await findNextActiveFlowStep(supabase, customer.consultant_id, { variant: (customer as any).flow_variant,
            afterPosition: _captureContaPos > 0 ? _captureContaPos : undefined,
            stepTypeIn: ["capture_documento", "capture_doc", "finalizar_cadastro"],
          });
        }
        // SAFETY-BELT: após SIM, pula apenas passos `message` VAZIOS (sem
        // texto e sem slot_key). Passos de simulação/pitch/conversão DEVEM
        // ser enviados — é onde o lead vê a economia e decide finalizar.
        // Detecta passos de conversão pela presença de:
        //   - mídia (slot_key)
        //   - botões (captures._buttons)
        //   - variáveis de economia ({{economia_mensal}}, {{economia_anual}}, {{valor}})
        //   - texto não vazio com mais de 20 chars
        if (nextCustom && nextCustom.step_type === "message") {
          const text = String(nextCustom.message_text || "").trim();
          const hasSlot = !!(nextCustom.slot_key && String(nextCustom.slot_key).trim());
          const hasButtons = Array.isArray((nextCustom as any).captures)
            && (nextCustom as any).captures.some((c: any) => c?.field === "_buttons" && Array.isArray(c?.value) && c.value.length > 0);
          const hasEconomyVar = /\{\{?\s*(economia|valor|simul)/i.test(text);
          const hasMeaningfulText = text.length >= 20;
          const isMeaningful = hasSlot || hasButtons || hasEconomyVar || hasMeaningfulText;

          if (!isMeaningful) {
            // Passo realmente vazio — pula direto para captura/finalização
            const forwardCapture = await findNextActiveFlowStep(supabase, customer.consultant_id, { variant: (customer as any).flow_variant,
              afterPosition: Number(nextCustom.position) || (_captureContaPos > 0 ? _captureContaPos : undefined),
              stepTypeIn: ["capture_documento", "capture_doc", "finalizar_cadastro"],
            });
            if (forwardCapture) {
              console.warn(`[post-confirm-conta] pulando message vazio "${nextCustom.step_key}" → ${forwardCapture.step_key}`);
              nextCustom = forwardCapture;
            }
          } else {
            console.log(`[post-confirm-conta] mantendo message "${nextCustom.step_key}" (slot=${hasSlot} btns=${hasButtons} econ=${hasEconomyVar} chars=${text.length}) — passo de simulação/conversão`);
            // 🚦 PARIDADE WHAPI: se o passo de simulação tem botões/transições
            // próprias ("Continuar Cadastro" / "Tenho dúvidas" / etc.), NÃO
            // disparar capture_documento agora — seria atropelar o CTA.
            // Aguarda resposta no step REAL para honrar o goto_step_id.
            try {
              if (stepHasInteractiveWait(nextCustom)) {
                (updates as any).__last_chain_had_buttons = true;
                (updates as any).__post_bill_wait_step_id = (nextCustom as any).id;
                (updates as any).__post_bill_wait_step_key = (nextCustom as any).step_key;
              }
            } catch (_) { /* best-effort */ }
          }
        }
        const DOC_FALLBACK = `Para continuar, me envia uma foto da *frente do seu documento* 📄\n\nPode ser RG ou CNH, o que estiver mais à mão.`;
        const FINAL_FALLBACK_TEXT = `✅ *Tudo pronto!*\n\nSeus dados foram preenchidos. Podemos concluir no portal iGreen?`;
        const sendFallback = async (text: string, stepStr: string) => {
          await sendText(remoteJid, text);
          await supabase.from("conversations").insert({
            customer_id: customer.id, message_direction: "outbound",
            message_text: text, message_type: "text", conversation_step: stepStr,
          });
        };
        const sendFinalizarButton = async () => {
          await sendOptions(remoteJid, FINAL_FALLBACK_TEXT, [
            { id: "btn_finalizar", title: "✅ Finalizar cadastro" },
          ]);
          await supabase.from("conversations").insert({
            customer_id: customer.id, message_direction: "outbound",
            message_text: FINAL_FALLBACK_TEXT, message_type: "text", conversation_step: "ask_finalizar",
          });
        };

        if (nextCustom) {
          console.log(`[post-confirm-conta] next=${nextCustom.step_key} type=${nextCustom.step_type} reason=customflow`);

          // 🚦 GATE pós-simulação (PARIDADE WHAPI): se a chain anterior já
          // tinha botões/transições próprias ("Continuar Cadastro" / "Tenho
          // dúvidas"), NÃO disparar capture_documento agora. Aguarda
          // resposta no step REAL enviado para honrar o goto_step_id.
          if (nextCustom.step_type === "capture_documento" || nextCustom.step_type === "capture_doc") {
            const _waitForCta = (updates as any).__last_chain_had_buttons === true;
            if (_waitForCta && !isSofiaPostBillCadastro({ ...customer, ...updates })) {
              const waitStep = (updates as any).__post_bill_wait_step_id || "ask_quero_cadastrar";
              console.log(`[post-confirm-conta] chain final é interativa → aguardando resposta em ${waitStep} (não disparando capture_documento agora)`);
              updates.conversation_step = waitStep;
            } else {
              try {
                await dispatchStepFromFlow(nextCustom.step_key, _vars);
              } catch (e) {
                console.warn(`[post-confirm-conta] dispatch direto capture_documento falhou:`, (e as Error).message);
                await sendText(remoteJid, "Para continuar, me envia uma foto da *frente do seu documento* 📄\n\nPode ser RG ou CNH, o que estiver mais à mão.");
              }
              updates.conversation_step = "aguardando_doc_auto";
            }
          } else {
            const ok = nextCustom.step_type === "finalizar_cadastro"
              ? true
              : await dispatchStepFromFlow(nextCustom.step_key, _vars);
            if (nextCustom.step_type === "finalizar_cadastro") {
              const gate = nextSeparatedCadastroStep(customer as any);
              try {
                if (gate === "ask_contaunica") {
                  const msg = getReplyForStep("ask_contaunica", customer);
                  const opts = getPreferenceOptions("ask_contaunica") || [];
                  await sendOptions(remoteJid, msg, [...opts]);
                } else {
                  const rawText = (nextCustom.message_text || "").trim();
                  const firstName = safeFirstNameForAddress(customer.name, (customer as any).name_source);
                  const finalText = (rawText || FINAL_FALLBACK_TEXT)
                    .replaceAll("{{nome}}", firstName)
                    .replaceAll("{{representante}}", nomeRepresentante || "");
                  await sendOptions(remoteJid, finalText, [
                    { id: "btn_finalizar", title: "✅ Finalizar" },
                  ]);
                  await supabase.from("conversations").insert({
                    customer_id: customer.id, message_direction: "outbound",
                    message_text: finalText, message_type: "text", conversation_step: "ask_finalizar",
                  });
                }
              } catch (e) {
                console.warn(`[post-confirm-conta] envio gate finalizar falhou:`, (e as Error).message);
                if (gate === "ask_finalizar") await sendFinalizarButton();
              }
              updates.conversation_step = gate;
            } else if (nextCustom.step_type === "capture_conta") {
              updates.conversation_step = "aguardando_conta";
            } else if (nextCustom.step_type === "capture_email") {
              updates.conversation_step = "ask_email";
            } else if (nextCustom.step_type === "confirm_phone") {
              updates.conversation_step = "ask_phone_confirm";
            } else {
              updates.conversation_step = nextCustom.id;
            }
            void ok;
          }
        } else {
          // PARIDADE WHAPI: sem próximo passo seguro NÃO pede doc direto —
          // aguarda resposta no último step interativo ou repete o atual.
          const waitStep = (updates as any).__post_bill_wait_step_id || (customer as any).conversation_step || "confirmando_dados_conta";
          console.warn(`[post-confirm-conta] nenhum próximo passo seguro — NÃO pedindo doc direto; aguardando resposta em ${waitStep}`);
          updates.conversation_step = waitStep;
        }

        (updates as any).__inline_sent = true;
        reply = "";
        } catch (dispatchErr: any) {
          const msg = String(dispatchErr?.message || dispatchErr).slice(0, 200);
          console.error(`[post-confirm-conta] ❌ DISPATCH FALHOU customer=${customer.id} err=${msg}`, dispatchErr);
          try {
            const fallbackTxt = "✅ Recebido! Estou preparando os próximos passos do seu cadastro. Aguarde um instante 🙏";
            await sendText(remoteJid, fallbackTxt);
            await supabase.from("conversations").insert({
              customer_id: customer.id, message_direction: "outbound",
              message_text: fallbackTxt, message_type: "text",
              conversation_step: "post_confirm_dispatch_fallback",
            });
          } catch (_) { /* best-effort */ }
          try {
            await supabase.from("customers")
              .update({ error_message: `post_bill_dispatch_failed: ${msg}`, updated_at: new Date().toISOString() })
              .eq("id", customer.id);
          } catch (_) { /* best-effort */ }
          (updates as any).__inline_sent = true;
          updates.conversation_step = "aguardando_doc_auto";
          reply = "";
        }
      } else if (resp === "nao_conta" || resp === "nao" || resp === "não" || resp === "n" || resp === "2" || resp === "errado" || resp === "❌") {
        updates.conversation_step = "aguardando_conta";
        reply = "📸 Ok! Envie novamente a *FOTO da conta de energia* com melhor qualidade.";
      } else if (resp === "editar_conta" || resp === "editar" || resp === "3") {
        updates.conversation_step = "editing_conta_menu";
        reply = "✏️ Qual campo deseja editar?\n\n1️⃣ Nome\n2️⃣ Endereço\n3️⃣ CEP\n4️⃣ Distribuidora\n5️⃣ Nº Instalação\n6️⃣ Valor da conta\n0️⃣ Cancelar\n\nDigite o número (ou a palavra-chave: nome, valor, cep…):";
      } else {
        const sent = await sendOptions(remoteJid, "Os dados da conta estão corretos?", [
          { id: "sim_conta", title: "✅ SIM" },
          { id: "nao_conta", title: "❌ NÃO" },
          { id: "editar_conta", title: "✏️ EDITAR" },
        ]);
        if (!sent) reply = "Digite *SIM*, *NÃO* ou *EDITAR*:";
      }
      break;
    }

    // ─── 3a. PITCH CONEXÃO CLUB (fallback caso lead reentre nesse step) ─────────
    case "pitch_conexao_club": {
      // Paridade Whapi: aguardar interação pós-vídeo; cadastro começa pela conta.
      reply = "Curtiu o Conexão Club? Me conta o que achou — ou se preferir, *bora pro cadastro* que eu já te peço sua conta de luz 📸";
      updates.conversation_step = "duvidas_pos_club";
      break;
    }

    // ─── 3a-bis. DÚVIDAS PÓS-CLUB ─────────
    case "duvidas_pos_club": {
      const txt = (messageText || "").trim().toLowerCase();
      const segueAgora =
        isButton ||
        /^(sim|s|ok|pode|pode seguir|bora|vamos|partiu|segue|seguir|tudo certo|sem d[uú]vida|nenhuma|nao tenho|n[ãa]o tenho|n[ãa]o|t[ãa]|fechou|beleza|blz)\b/.test(txt) ||
        /(quero|vamos|bora).*(cadastr|seguir|finaliz|economiz)/i.test(messageText || "");
      if (segueAgora) {
        const ctaMsg = `Perfeito! Pra eu calcular sua economia, me envia uma *foto ou PDF da sua conta de luz* 📸`;
        await sendText(remoteJid, ctaMsg);
        await supabase.from("conversations").insert({
          customer_id: customer.id, message_direction: "outbound",
          message_text: ctaMsg, message_type: "text",
          conversation_step: "aguardando_conta",
        });
        updates.conversation_step = "aguardando_conta";
        (updates as any).__inline_sent = true;
        reply = "";
      } else {
        reply = "Pode mandar sua dúvida, que eu explico 😊 — ou diga *pode seguir* para avançar e calcular sua economia.";
      }
      break;
    }

    // ─── 3a-AUTO. CAPTURA DE DOC COM DETECÇÃO AUTOMÁTICA DE TIPO ─────
    // Usado pelos passos do FluxoCamila com step_type=capture_documento
    // (auto_detect_doc_type=true). A IA olha a foto e classifica RG/CNH
    // sem perguntar. Se não vier foto ainda, pede a foto.
    case "aguardando_doc_auto": {
      // 🔁 IDEMPOTÊNCIA: doc frente já recebido — não re-OCR.
      if (shouldSkipAskStep("aguardando_doc_auto", customer)) {
        const resumed = resolveResumeStep(customer);
        console.log(`[idempotency] aguardando_doc_auto — doc já recebido, retomando em ${resumed}`);
        updates.conversation_step = resumed;
        reply = isFile
          ? `Já recebi seu documento ✅ Vamos continuar de onde paramos 👇\n\n${getReplyForStep(resumed, customer)}`
          : getReplyForStep(resumed, customer);
        break;
      }
      if (!isFile) {
        // ANTI-DUP: se o passo custom acabou de perguntar, NÃO duplica o prompt legacy.
        const _lastCustom = (customer as any).last_custom_prompt_at;
        if (_lastCustom && (Date.now() - new Date(_lastCustom).getTime()) < 10 * 60 * 1000) {
          console.log(`[anti-dup] aguardando_doc_auto: passo custom já perguntou (${_lastCustom}) — silenciando re-prompt`);
          reply = "";
          break;
        }
        reply = "📸 Me envie a foto da *frente do seu documento*.\n\nPode ser RG ou CNH, o que estiver mais à mão. Formatos: JPG, PNG ou PDF.";
        break;
      }
      const mime = imageMessage?.mimetype || documentMessage?.mimetype || "image/jpeg";
      const resolvedDocImg = await resolveOcrImageForDocument({
        fileBase64,
        fileUrl,
        mediaMessage: documentMessage || imageMessage,
        customer,
        pendingUpdates: updates,
        fetchAuthBearer: Deno.env.get("WHAPI_TOKEN") || null,
      });
      if (!resolvedDocImg) {
        reply = "⚠️ Não consegui abrir a foto do documento. Envie de novo como *imagem* ou *PDF*, bem nítida 📸";
        break;
      }
      const docFileBase64 = resolvedDocImg.b64;
      const docFileUrl = resolvedDocImg.resolvedUrl || fileUrl
        || `data:${resolvedDocImg.mime};base64,${docFileBase64}`;

      let detectedType: "cnh" | "rg_novo" | "rg_antigo" | "outro" = "rg_antigo";
      let detectConfidence = 0;
      let detectSource: string = "fallback";
      let detectMotivo: string | undefined;
      try {
        const det = await detectDocumentTypeDetailed({
          base64: docFileBase64,
          mimeType: mime,
          imageUrl: docFileUrl.startsWith("http") ? docFileUrl : undefined,
          geminiApiKey,
        });
        detectedType = det.tipo;
        detectConfidence = det.confianca;
        detectSource = det.source;
        detectMotivo = det.motivo;
        console.log(`🤖 [doc-auto] tipo=${detectedType} conf=${detectConfidence.toFixed(2)} source=${detectSource} motivo=${detectMotivo || "-"}`);
      } catch (e) {
        console.warn(`⚠️ [doc-auto] falha detectando tipo:`, (e as Error).message);
      }

      // 🚫 FIX 2026-05-30 (caso 5511971254913): rejeita arquivos que NÃO são
      // RG/CNH (conta de energia, selfie, boleto, print). Sem isso o handler
      // salvava como frente do RG e pedia "envie o VERSO do RG" para uma conta
      // de luz. Mantém o cliente em aguardando_doc_auto e pede o documento certo.
      if (detectedType === "outro") {
        const motivoTxt = detectMotivo ? ` (parece *${detectMotivo}*)` : "";
        console.log(`🚫 [doc-auto] rejeitado: não é RG/CNH${motivoTxt}`);
        reply = `❌ Esse arquivo não parece ser um *RG* ou *CNH*${motivoTxt}.\n\n` +
                `📸 Por favor, me envia uma foto/PDF da *frente do seu RG* ou da sua *CNH*.\n\n` +
                `Formatos aceitos: JPG, PNG ou PDF.`;
        // NÃO atualiza document_front_url, NÃO avança conversation_step.
        break;
      }


      // Salva a frente recebida (sempre — independente da confiança da detecção).
      if (docFileBase64) {
        updates.document_front_url = `data:${mime};base64,${docFileBase64}`;
        updates.document_front_base64 = docFileBase64;
        updates.media_message_id = messageId || null;
        updates.media_storage = "inline";
      } else if (docFileUrl) {
        updates.document_front_url = docFileUrl.startsWith("http") ? docFileUrl : "evolution-media:pending";
      }

      // ⚠️ FIX 2026-05-30: NÃO perguntar "RG ou CNH" quando a confiança da
      // CLASSIFICAÇÃO é baixa. O Gemini lê os DADOS com perfeição mesmo na dúvida
      // entre rg_novo/rg_antigo (distinção só interna). Rodamos OCR DIRETO.
      const treatAsCnh = detectedType === "cnh" && detectConfidence >= 0.55;
      updates.document_type = treatAsCnh ? "cnh" : (detectedType === "rg_novo" ? "rg_novo" : "rg_antigo");
      updates.conversation_step = "aguardando_doc_frente";
      if (treatAsCnh) {
        updates.document_back_url = "nao_aplicavel";
        await sendText(remoteJid, "✅ Documento recebido! ⏳ Analisando os dados...");
      } else {
        await sendText(remoteJid, `✅ Documento recebido! ⏳ Analisando a frente...`);
      }
      // Roda OCR da frente já agora (mesma lógica do aguardando_doc_frente)
      try {
        const docFrenteUrl = docFileUrl || updates.document_front_url || "evolution-media:pending";
        const ocrData = await ocrDocumentoFrenteVerso(
          docFrenteUrl,
          treatAsCnh ? "nao_aplicavel" : (customer.document_back_url || ""),
          treatAsCnh ? "CNH" : (detectedType === "rg_novo" ? "RG_NOVO" : "RG_ANTIGO"),
          geminiApiKey,
          docFileBase64,
          documentMessage || imageMessage,
          undefined,
        );
        if (ocrData.sucesso && ocrData.dados) {
          const d = ocrData.dados;
          { if (d.nome) updates.doc_holder_name = String(d.nome).trim(); const _safe = safeAssignName(customer.name, (customer as any).name_source, d.nome); if (_safe) { updates.name = _safe; updates.name_source = "ocr_doc"; } const _bill = customer.bill_holder_name || updates.bill_holder_name; if (_bill && d.nome) { const _chk = checkHolderMatch(_bill, d.nome); if (!_chk.match) { updates.name_mismatch_flag = true; updates.name_mismatch_reason = `bill="${_bill}" doc="${d.nome}" ${_chk.reason}`; } else { updates.name_mismatch_flag = false; updates.name_mismatch_reason = null; } } }
          if (d.cpf) updates.cpf = d.cpf.replace(/\D/g, "");
          // ⚠️ FIX: RG só grava se diferente do CPF (OCR às vezes devolve CPF no RG).
          if (d.rg) {
            const _rgDigits = String(d.rg).replace(/\D/g, "");
            const _cpfDigits = String(d.cpf || updates.cpf || "").replace(/\D/g, "");
            if (_rgDigits && _rgDigits !== _cpfDigits) updates.rg = d.rg;
          }
          const dataConf = String(d.dataNascimentoConfianca || "").toLowerCase();
          if (d.dataNascimento && (!treatAsCnh || dataConf === "alta")) {
            updates.data_nascimento = d.dataNascimento;
          }
          if (d.nomePai) updates.nome_pai = d.nomePai;
          if (d.nomeMae) updates.nome_mae = d.nomeMae;
        }
      } catch (e) {
        console.warn(`[doc-auto] OCR falhou:`, (e as Error).message);
      }
      // CNH → vai direto pra confirmação (ou ask_cpf se faltar CPF). RG → pede verso.
      if (treatAsCnh) {
        const _cpfOcr = String(updates.cpf || customer.cpf || "").replace(/\D/g, "");
        if (_cpfOcr.length !== 11) {
          updates.conversation_step = "ask_cpf";
          const _nome = updates.name || customer.name || "";
          const _rg = updates.rg || customer.rg || "";
          const _resumo = [_nome ? `👤 Nome: *${_nome}*` : "", _rg ? `📄 RG: *${_rg}*` : ""].filter(Boolean).join("\n");
          reply = `📋 Consegui ler sua CNH:\n\n${_resumo}\n\nSó preciso do seu *CPF* pra continuar (apenas números):`;
          break;
        }
        updates.conversation_step = "confirmando_dados_doc";
        reply = await autoAdvanceAfterDocOcr({
          customer,
          updates,
          remoteJid,
          sendOptions,
        });
      } else {
        updates.conversation_step = "aguardando_doc_verso";
        reply = "✅ Frente recebida!\n\n📸 Agora envie o *VERSO do RG*.\n\nFormatos: JPG, PNG ou PDF";
      }
      break;
    }

    // ─── 3b. TIPO DE DOCUMENTO (legado) ─────────
    // Mantido só para retrocompat. Hoje o fluxo redireciona para `aguardando_doc_auto`,
    // onde o bot detecta RG/CNH automaticamente sem perguntar nada ao cliente.
    case "ask_tipo_documento": {
      // Se o cliente já mandou a foto, deixa o aguardando_doc_auto processar.
      if (isFile) {
        updates.conversation_step = "aguardando_doc_auto";
        reply = "";
        await sendText(remoteJid, "📄 Recebi a foto, analisando agora...");
        break;
      }

      // ⚠️ FIX 2026-05-30: cliente clicou RG/CNH. Se a frente já foi enviada,
      // NÃO pedir de novo — roda OCR reaproveitando a foto salva.
      const _choice = (isButton ? String(buttonId ?? "") : messageText.toLowerCase().trim());
      const _isCnh = /cnh|habilita|^2$/i.test(_choice);
      const _frenteSalva = String((customer as any).document_front_url || "").trim();
      const _temFrente = _frenteSalva && _frenteSalva !== "evolution-media:pending";
      if (_temFrente) {
        updates.document_type = _isCnh ? "cnh" : "rg_antigo";
        if (_isCnh) updates.document_back_url = "nao_aplicavel";
        await sendText(remoteJid, _isCnh ? "✅ CNH recebida! ⏳ Analisando os dados..." : "✅ Documento recebido! ⏳ Analisando a frente...");
        try {
          const _b64 = (customer as any).document_front_base64 || undefined;
          const _frenteUrl = _frenteSalva.startsWith("http") ? _frenteSalva : (_b64 ? "inline" : _frenteSalva);
          const ocrData = await ocrDocumentoFrenteVerso(
            _frenteUrl,
            _isCnh ? "nao_aplicavel" : (customer.document_back_url || ""),
            _isCnh ? "CNH" : "RG_ANTIGO",
            geminiApiKey,
            _b64,
            undefined,
            undefined,
          );
          if (ocrData.sucesso && ocrData.dados) {
            const d = ocrData.dados;
            { if (d.nome) updates.doc_holder_name = String(d.nome).trim(); const _safe = safeAssignName(customer.name, (customer as any).name_source, d.nome); if (_safe) { updates.name = _safe; updates.name_source = "ocr_doc"; } const _bill = customer.bill_holder_name || updates.bill_holder_name; if (_bill && d.nome) { const _chk = checkHolderMatch(_bill, d.nome); if (!_chk.match) { updates.name_mismatch_flag = true; updates.name_mismatch_reason = `bill="${_bill}" doc="${d.nome}" ${_chk.reason}`; } else { updates.name_mismatch_flag = false; updates.name_mismatch_reason = null; } } }
            if (d.cpf) updates.cpf = d.cpf.replace(/\D/g, "");
            if (d.rg) {
              const _rgDigits = String(d.rg).replace(/\D/g, "");
              const _cpfDigits = String(d.cpf || updates.cpf || "").replace(/\D/g, "");
              if (_rgDigits && _rgDigits !== _cpfDigits) updates.rg = d.rg;
            }
            const dataConf = String(d.dataNascimentoConfianca || "").toLowerCase();
            if (d.dataNascimento && (!_isCnh || dataConf === "alta")) updates.data_nascimento = d.dataNascimento;
            if (d.nomePai) updates.nome_pai = d.nomePai;
            if (d.nomeMae) updates.nome_mae = d.nomeMae;
          }
        } catch (e) {
          console.warn(`[ask_tipo_documento] OCR reaproveitando frente falhou:`, (e as Error).message);
        }
        if (_isCnh) {
          const _cpfOcr = String(updates.cpf || customer.cpf || "").replace(/\D/g, "");
          if (_cpfOcr.length !== 11) {
            updates.conversation_step = "ask_cpf";
            const _nome = updates.name || customer.name || "";
            reply = `📋 Consegui ler sua CNH${_nome ? `:\n\n👤 Nome: *${_nome}*` : ""}\n\nSó preciso do seu *CPF* pra continuar (apenas números):`;
            break;
          }
          updates.conversation_step = "confirmando_dados_doc";
          reply = await autoAdvanceAfterDocOcr({
            customer,
            updates,
            remoteJid,
            sendOptions,
          });
          break;
        }
        updates.conversation_step = "aguardando_doc_verso";
        reply = "✅ Frente recebida!\n\n📸 Agora envie o *VERSO do RG*.\n\nFormatos: JPG, PNG ou PDF";
        break;
      }

      reply = `Me manda só uma foto da *frente do seu documento* 📄\n\nPode ser RG ou CNH, o que estiver mais à mão.`;
      updates.conversation_step = "aguardando_doc_auto";
      break;
    }

    // ─── 4. FRENTE DO DOC ───────────
    case "aguardando_doc_frente": {
      if (!isFile) {
        const msgDoc = isCNH(customer.document_type) ? "FRENTE da sua CNH" : "FRENTE do seu documento (RG ou CNH)";
        reply = `📸 Envie a *${msgDoc}*.\n\nFormatos: JPG, PNG ou PDF`;
        break;
      }
      if (fileBase64) {
        const mime = imageMessage?.mimetype || documentMessage?.mimetype || "application/octet-stream";
        // OOM-FIX 2026-06-28: sentinel curto; MinIO sobrescreve em background.
        updates.document_front_url = "evolution-media:pending";
        updates.document_front_base64 = "inline";
        updates.media_message_id = messageId || null;
        updates.media_storage = "inline";
        const custId = customer.id;
        uploadMediaToMinio({
          fileBase64, mimeType: mime, consultantFolder: consultorId, consultantName: nomeRepresentante,
          customerName: customer.name || "cliente", customerBirth: customer.data_nascimento, kind: "doc_frente",
        }).then(async (minioUrl) => {
          if (minioUrl) {
            await supabase.from("customers").update({ document_front_url: minioUrl, media_storage: "minio" }).eq("id", custId);
            console.log(`📦✅ [BG] Doc frente uploaded MinIO: ${minioUrl.substring(0, 80)}`);
          }
        }).catch((e) => console.warn(`📦⚠️ [BG] MinIO doc_frente falhou: ${e?.message}`));
      } else {
        updates.document_front_url = fileUrl?.startsWith("http") ? fileUrl : "evolution-media:pending";
        updates.media_message_id = messageId || null;
      }

      const tipoEscolhido = normalizeDocumentType(customer.document_type);
      if (tipoEscolhido === "cnh") {
        updates.document_back_url = "nao_aplicavel";
        updates.document_type = "cnh";
        await sendText(remoteJid, "✅ CNH recebida! ⏳ Analisando...\n\nAguarde...");
        try {
          const docFrenteUrl = fileUrl || updates.document_front_url || "evolution-media:pending";
          console.log("📡 Chamando OCR documento CNH (apenas frente)");
          const ocrData = await ocrDocumentoFrenteVerso(
            docFrenteUrl, "nao_aplicavel", "CNH", geminiApiKey,
            fileBase64 || undefined, documentMessage || imageMessage, undefined
          );
          console.log("📊 OCR CNH resultado:", JSON.stringify(ocrData).substring(0, 400));
          if (ocrData.sucesso && ocrData.dados) {
            const d = ocrData.dados;
            { if (d.nome) updates.doc_holder_name = String(d.nome).trim(); const _safe = safeAssignName(customer.name, (customer as any).name_source, d.nome); if (_safe) { updates.name = _safe; updates.name_source = "ocr_doc"; } const _bill = customer.bill_holder_name || updates.bill_holder_name; if (_bill && d.nome) { const _chk = checkHolderMatch(_bill, d.nome); if (!_chk.match) { updates.name_mismatch_flag = true; updates.name_mismatch_reason = `bill="${_bill}" doc="${d.nome}" ${_chk.reason}`; } else { updates.name_mismatch_flag = false; updates.name_mismatch_reason = null; } } }
            if (d.cpf) updates.cpf = d.cpf.replace(/\D/g, "");
            if (d.rg) {
              const _rgDigits = String(d.rg).replace(/\D/g, "");
              const _cpfDigits = String(d.cpf || updates.cpf || "").replace(/\D/g, "");
              if (_rgDigits && _rgDigits !== _cpfDigits) updates.rg = d.rg;
            }
            const dataConf = String(d.dataNascimentoConfianca || "").toLowerCase();
            if (d.dataNascimento && dataConf === "alta") {
              updates.data_nascimento = d.dataNascimento;
              console.log(`✅ CNH: data nasc ${d.dataNascimento} aceita (confiança alta)`);
            } else if (d.dataNascimento) {
              console.warn(`⚠️ CNH: data nasc ${d.dataNascimento} NÃO salva (confiança ${dataConf || "n/a"}). Portal preencherá via CPF.`);
            }
            if (d.nomePai) updates.nome_pai = d.nomePai;
            if (d.nomeMae) updates.nome_mae = d.nomeMae;
          }
        } catch (e) { console.error("❌ OCR CNH falhou:", e); }
        const _cpfOcr = String(updates.cpf || customer.cpf || "").replace(/\D/g, "");
        if (_cpfOcr.length !== 11) {
          updates.conversation_step = "ask_cpf";
          const _nome = updates.name || customer.name || "";
          const _rg = updates.rg || customer.rg || "";
          const _resumo = [_nome ? `👤 Nome: *${_nome}*` : "", _rg ? `📄 RG: *${_rg}*` : ""].filter(Boolean).join("\n");
          reply = `📋 Consegui ler sua CNH:\n\n${_resumo}\n\nSó preciso do seu *CPF* pra continuar (apenas números):`;
          break;
        }
        updates.conversation_step = "confirmando_dados_doc";
        reply = await autoAdvanceAfterDocOcr({
          customer,
          updates,
          remoteJid,
          sendOptions,
        });
        break;
      }
      updates.conversation_step = "aguardando_doc_verso";
      reply = "✅ Frente recebida!\n\n📸 Agora envie o *VERSO do RG*.\n\nFormatos: JPG, PNG ou PDF";
      break;
    }

    // ─── 5. VERSO ────────
    case "aguardando_doc_verso": {
      // 🔁 IDEMPOTÊNCIA: verso já recebido — não reprocessar.
      if (shouldSkipAskStep("aguardando_doc_verso", customer)) {
        const resumed = resolveResumeStep(customer);
        console.log(`[idempotency] aguardando_doc_verso — verso já recebido, retomando em ${resumed}`);
        updates.conversation_step = resumed;
        reply = isFile
          ? `Já recebi o verso ✅ Vamos continuar 👇\n\n${getReplyForStep(resumed, customer)}`
          : getReplyForStep(resumed, customer);
        break;
      }
      if (!isFile) { reply = "📸 Envie o *VERSO do documento*.\n\nFormatos: JPG, PNG ou PDF"; break; }
      if (fileBase64) {
        const mime = imageMessage?.mimetype || documentMessage?.mimetype || "application/octet-stream";
        // OOM-FIX 2026-06-28: sentinel curto; MinIO sobrescreve em background.
        updates.document_back_url = "evolution-media:pending";
        updates.document_back_base64 = "inline";
        const custId = customer.id;
        uploadMediaToMinio({
          fileBase64, mimeType: mime, consultantFolder: consultorId, consultantName: nomeRepresentante,
          customerName: customer.name || "cliente", customerBirth: customer.data_nascimento, kind: "doc_verso",
        }).then(async (minioUrl) => {
          if (minioUrl) {
            await supabase.from("customers").update({ document_back_url: minioUrl }).eq("id", custId);
            console.log(`📦✅ [BG] Doc verso uploaded MinIO: ${minioUrl.substring(0, 80)}`);
          }
        }).catch((e) => console.warn(`📦⚠️ [BG] MinIO doc_verso falhou: ${e?.message}`));
      } else {
        updates.document_back_url = fileUrl?.startsWith("http") ? fileUrl : "evolution-media:pending";
      }
      await sendText(remoteJid, "✅ Documento recebido! ⏳ Analisando...\n\nAguarde...");
      console.log("📥 Documento verso recebido:");
      console.log("  - fileBase64 length:", fileBase64?.length || 0);
      console.log("  - mimetype:", imageMessage?.mimetype || documentMessage?.mimetype);
      if (fileBase64 && fileBase64.length < 100) {
        console.error("❌ Base64 muito pequeno:", fileBase64.length);
        updates.conversation_step = "aguardando_doc_verso";
        reply = "⚠️ Erro ao processar documento. Tente enviar uma foto mais nítida.";
        break;
      }
      const mediaMsg = documentMessage || imageMessage || {
        mimetype: imageMessage?.mimetype || documentMessage?.mimetype || "image/jpeg",
      };
      try {
        const docFrenteUrl = customer.document_front_url || updates.document_front_url;
        const docVersoUrl = updates.document_back_url || customer.document_back_url;
        const frenteBase64: string | undefined = undefined;
        console.log("📡 Chamando OCR documento (verso; frente já analisada se disponível)");
        console.log(`📡 Frente base64 banco: NÃO (descontinuado), Verso base64: ${fileBase64 ? 'SIM' : 'NÃO'}`);
        const ocrData = await ocrDocumentoFrenteVerso(
          docFrenteUrl, docVersoUrl, customer.document_type || "rg_antigo",
          geminiApiKey, frenteBase64, undefined, fileBase64 || undefined
        );
        console.log("📊 OCR Doc resultado:", JSON.stringify(ocrData).substring(0, 400));
        if (ocrData.sucesso && ocrData.dados) {
          const d = ocrData.dados;
          { if (d.nome) updates.doc_holder_name = String(d.nome).trim(); const _safe = safeAssignName(customer.name, (customer as any).name_source, d.nome); if (_safe) { updates.name = _safe; updates.name_source = "ocr_doc"; } const _bill = customer.bill_holder_name || updates.bill_holder_name; if (_bill && d.nome) { const _chk = checkHolderMatch(_bill, d.nome); if (!_chk.match) { updates.name_mismatch_flag = true; updates.name_mismatch_reason = `bill="${_bill}" doc="${d.nome}" ${_chk.reason}`; } else { updates.name_mismatch_flag = false; updates.name_mismatch_reason = null; } } }
          if (d.cpf) updates.cpf = d.cpf.replace(/\D/g, "");
          if (d.rg) {
            const _rgDigits = String(d.rg).replace(/\D/g, "");
            const _cpfDigits = String(d.cpf || updates.cpf || "").replace(/\D/g, "");
            if (_rgDigits && _rgDigits !== _cpfDigits) updates.rg = d.rg;
          }
          if (d.dataNascimento) updates.data_nascimento = d.dataNascimento;
          if (d.nomePai) updates.nome_pai = d.nomePai;
          if (d.nomeMae) updates.nome_mae = d.nomeMae;

          // Se OCR não trouxe CPF, pula confirmação e pede CPF direto (sem perder nome/RG/nascimento).
          const _cpfOcr = String(updates.cpf || customer.cpf || "").replace(/\D/g, "");
          if (_cpfOcr.length !== 11) {
            console.log(`📋 OCR doc sem CPF — salvando demais campos e indo direto para ask_cpf`);
            updates.conversation_step = "ask_cpf";
            const _nome = updates.name || customer.name || "";
            const _rg = updates.rg || customer.rg || "";
            const _nasc = updates.data_nascimento || customer.data_nascimento || "";
            const _resumo = [
              _nome ? `👤 Nome: *${_nome}*` : "",
              _rg ? `📄 RG: *${_rg}*` : "",
              _nasc ? `🎂 Nascimento: *${_nasc}*` : "",
            ].filter(Boolean).join("\n");
            reply = `📋 Consegui ler seu documento:\n\n${_resumo}\n\nSó preciso do seu *CPF* pra continuar (apenas números):`;
            break;
          }

          updates.conversation_step = "confirmando_dados_doc";
          reply = await autoAdvanceAfterDocOcr({
            customer,
            updates,
            remoteJid,
            sendOptions,
          });
          console.log(`[ocr-doc/evolution] auto-advance doc (sem confirmação) customer=${customer.id}`);
          break;

        } else {
          console.error("❌ OCR doc falhou:", ocrData.erro);
          // Task 6 (captacao-fluxo-d-conversao): alerta para Fluxo D.
          void recordFlowDAlert({
            supabase,
            customerId: customer.id,
            consultantId: customer.consultant_id,
            conversationStep: customer.conversation_step ?? "aguardando_doc_verso",
            alertType: "flow_d_ocr_failed_doc",
            reason: String(ocrData?.erro || "ocr_failed"),
            flowVariant: (customer as any)?.flow_variant,
          });
          const tries = (customer.ocr_doc_attempts || 0) + 1;
          updates.ocr_doc_attempts = tries;
          const ocrFb = await resolveOcrFallback(
            supabase,
            customer.id,
            customer.consultant_id,
            "capture_documento",
            tries,
            OCR_RETRY_DOC_SHORT,
            (customer as any).flow_variant,
          );
          if (ocrFb.escalate) {
            updates.bot_paused = true;
            updates.bot_paused_reason = "ocr_documento_retry_exhausted";
            updates.bot_paused_at = new Date().toISOString();
            updates.conversation_step = "aguardando_humano";
            reply = await getTemplate(supabase, "aguardando_humano", "avisado", {
              nome: customer.name,
              representante: nomeRepresentante,
            });
          } else {
            updates.conversation_step = "aguardando_doc_verso";
            const sent = await sendOcrRetryMessage({
              supabase,
              remoteJid,
              customerId: customer.id,
              conversationStep: "aguardando_doc_verso",
              text: ocrFb.retryText,
              retryAudioClipId: ocrFb.retryAudioClipId ?? null,
              sendText,
              sendMedia,
            });
            if (sent) {
              reply = "";
              (updates as any).__inline_sent = true;
            } else {
              reply = ocrFb.retryText;
            }
          }
        }
      } catch (e) {
        console.error("❌ Erro OCR doc:", e);
        // Task 6: alerta também em exception (timeout, rede, etc).
        void recordFlowDAlert({
          supabase,
          customerId: customer.id,
          consultantId: customer.consultant_id,
          conversationStep: customer.conversation_step ?? "aguardando_doc_verso",
          alertType: "flow_d_ocr_failed_doc",
          reason: (e as Error)?.message ?? String(e),
          flowVariant: (customer as any)?.flow_variant,
        });
        const tries = (customer.ocr_doc_attempts || 0) + 1;
        updates.ocr_doc_attempts = tries;
        const ocrFb = await resolveOcrFallback(
          supabase,
          customer.id,
          customer.consultant_id,
          "capture_documento",
          tries,
          "⚠️ Erro ao processar o documento. Tente enviar novamente.",
          (customer as any).flow_variant,
        );
        if (ocrFb.escalate) {
          updates.bot_paused = true;
          updates.bot_paused_reason = "ocr_documento_retry_exhausted";
          updates.bot_paused_at = new Date().toISOString();
          updates.conversation_step = "aguardando_humano";
          reply = await getTemplate(supabase, "aguardando_humano", "avisado", {
            nome: customer.name,
            representante: nomeRepresentante,
          });
        } else {
            updates.conversation_step = "aguardando_doc_verso";
            const sent = await sendOcrRetryMessage({
              supabase,
              remoteJid,
              customerId: customer.id,
              conversationStep: "aguardando_doc_verso",
              text: ocrFb.retryText,
              retryAudioClipId: ocrFb.retryAudioClipId ?? null,
              sendText,
              sendMedia,
            });
            if (sent) {
              reply = "";
              (updates as any).__inline_sent = true;
            } else {
              reply = ocrFb.retryText;
            }
          }
      }
      break;
    }

    // ─── 6. CONFIRMANDO DADOS DOC ─────────
    case "confirmando_dados_doc": {
      const resp = isButton ? buttonId : messageText.toLowerCase().trim();
      if (resp === "sim_doc" || resp === "sim" || resp === "s" || resp === "1" || resp === "ok" || resp === "correto" || resp === "✅") {
        // 🔑 FIX (mesmo loop do bill): marca o documento como CONFIRMADO. Sem
        // isso `resolveResumeStep` via `!doc_data_confirmed_at` e devolvia o
        // lead para `confirmando_dados_doc` em loop no modo auto. Idempotente.
        if (!(customer as any).doc_data_confirmed_at) {
          updates.doc_data_confirmed_at = new Date().toISOString();
          updates.doc_data_confirmation_by = "client";
        }
        if (customer.name || updates.name) updates.name_source = "user_confirmed";
        const _mismatch = (updates.name_mismatch_flag ?? (customer as any).name_mismatch_flag) === true;
        const _acked = (updates.name_mismatch_acknowledged_at ?? (customer as any).name_mismatch_acknowledged_at);
        if (_mismatch && !_acked) {
          updates.conversation_step = "confirmar_titularidade";
          const _bill = (customer as any).bill_holder_name || updates.bill_holder_name || "—";
          const _doc = (customer as any).doc_holder_name || updates.doc_holder_name || "—";
          await sendOptions(remoteJid, `Antes de finalizar preciso confirmar:\n\n👤 Conta de luz: *${_bill}*\n🪪 Documento: *${_doc}*\n\nÉ a mesma pessoa?`, [
            { id: "titular_mesmo", title: "Mesma pessoa" },
            { id: "titular_outro", title: "Outro titular" },
            { id: "titular_corrigir", title: "Corrigir" },
          ]);
          reply = "";
        } else {
          const merged = { ...customer, ...updates };
          const next = await autoResolveCepIfNeeded(merged, updates);
          updates.conversation_step = next;
          reply = getReplyForStep(next, merged);
        }
      } else if (resp === "nao_doc" || resp === "nao" || resp === "não" || resp === "n" || resp === "2" || resp === "errado" || resp === "❌") {
        // ── ANTI-LOOP: após 2 rejeições, força avanço para coleta manual em vez de re-pedir foto ──
        const rejectCount = (customer.ocr_doc_attempts || 0) + 1;
        updates.ocr_doc_attempts = rejectCount;
        if (rejectCount >= 2) {
          console.warn(`⚠️ [ANTI-LOOP DOC] ${customer.id} rejeitou doc ${rejectCount}x — indo para coleta manual.`);
          updates.conversation_step = "ask_cpf";
          reply = "Sem problema! Vamos coletar os dados manualmente.\n\nQual o seu *CPF*? (apenas números)";
        } else {
          updates.conversation_step = "aguardando_doc_frente";
          reply = "📸 Ok! Envie novamente a *FRENTE do documento* com melhor qualidade.";
        }
      } else if (resp === "editar_doc" || resp === "editar" || resp === "3") {
        updates.conversation_step = "editing_doc_menu";
        reply = "✏️ Qual campo deseja editar?\n\n1️⃣ Nome\n2️⃣ CPF\n3️⃣ RG\n4️⃣ Data de Nascimento\n0️⃣ Cancelar\n\nDigite o número (ou a palavra-chave: nome, cpf, rg, data):";
      } else {
        const sent = await sendOptions(remoteJid, "Os dados estão corretos?", [
          { id: "sim_doc", title: "✅ SIM" },
          { id: "nao_doc", title: "❌ NÃO" },
          { id: "editar_doc", title: "✏️ EDITAR" },
        ]);
        if (!sent) reply = "Digite *SIM*, *NÃO* ou *EDITAR*:";
      }
      break;
    }

    // ─── 6b. CONFIRMAR TITULARIDADE (mismatch conta × RG) ─────────
    case "confirmar_titularidade": {
      // resp pode ser string vazia (não null) — coerção defensiva via String()
      // satisfaz o typecheck do regex.test() que exige string.
      const rawResp: string = isButton ? String(buttonId ?? "") : messageText.toLowerCase().trim();
      // Canais sem botões nativos (Evolution/Baileys) renderizam as opções
      // como lista numerada. Mapeia 1/2/3 para os ids dos botões.
      const numMap: Record<string, string> = { "1": "titular_mesmo", "2": "titular_outro", "3": "titular_corrigir" };
      const resp = numMap[rawResp] ?? rawResp;
      if (resp === "titular_mesmo" || /mesma|sou eu|é eu|eh eu|igual/i.test(resp)) {
        updates.name_mismatch_acknowledged_at = new Date().toISOString();
        const merged = { ...customer, ...updates };
        const next = await autoResolveCepIfNeeded(merged, updates);
        updates.conversation_step = next;
        reply = "Perfeito, anotado! ✅\n\n" + getReplyForStep(next, merged);
      } else if (resp === "titular_outro" || /outro|c[ôo]njuge|esposa|esposo|marido|pai|m[ãa]e|filho|filha|parente/i.test(resp)) {
        updates.name_mismatch_acknowledged_at = new Date().toISOString();
        updates.bill_owner_relationship = messageText.trim().slice(0, 60) || "outro_titular";
        const merged = { ...customer, ...updates };
        const next = await autoResolveCepIfNeeded(merged, updates);
        updates.conversation_step = next;
        reply = "Entendido — a conta está em nome de outra pessoa. Vou registrar isso para o consultor revisar na hora do cadastro. ✅\n\n" + getReplyForStep(next, merged);
      } else if (resp === "titular_corrigir" || /corrigir|errado|edit/i.test(resp)) {
        updates.conversation_step = "editing_doc_menu";
        reply = "✏️ O que deseja corrigir?\n\n1️⃣ Nome\n2️⃣ CPF\n3️⃣ RG\n4️⃣ Data de Nascimento\n0️⃣ Cancelar";
      } else {
        const sent = await sendOptions(remoteJid, "Me ajuda a confirmar: é a mesma pessoa, outro titular ou quer corrigir?", [
          { id: "titular_mesmo", title: "Mesma pessoa" },
          { id: "titular_outro", title: "Outro titular" },
          { id: "titular_corrigir", title: "Corrigir" },
        ]);
        if (!sent) reply = "Responda com o número:\n\n*1* Mesma pessoa\n*2* Outro titular\n*3* Corrigir dados";
      }
      break;
    }

    // ─── 7. EDIÇÃO CONTA ─────────
    case "editing_conta_menu": {
      const op = messageText.trim().toLowerCase();
      const fieldMap: Record<string, [string, string]> = {
        "1": ["editing_conta_nome", "Digite o *nome completo* correto:"],
        "2": ["editing_conta_endereco", "Digite o *endereço completo* correto:"],
        "3": ["editing_conta_cep", "Digite o *CEP* correto (8 dígitos):"],
        "4": ["editing_conta_distribuidora", "Digite o nome da *distribuidora*:"],
        "5": ["editing_conta_instalacao", "Digite o *número da instalação*:"],
        "6": ["editing_conta_valor", "Digite o *valor da conta* (ex: 350,50):"],
      };
      // Palavras-chave (atalho amigável)
      let target: [string, string] | null = fieldMap[op] || null;
      if (!target) {
        if (/\bnome\b/.test(op)) target = fieldMap["1"];
        else if (/\b(endere[çc]o|rua)\b/.test(op)) target = fieldMap["2"];
        else if (/\bcep\b/.test(op)) target = fieldMap["3"];
        else if (/\bdistribuidora\b/.test(op)) target = fieldMap["4"];
        else if (/\binstala[çc][ãa]o\b/.test(op)) target = fieldMap["5"];
        else if (/\bvalor\b/.test(op)) target = fieldMap["6"];
      }
      if (op === "0" || /\b(cancelar|voltar)\b/.test(op)) {
        // Volta pra tela completa de confirmação
        updates.conversation_step = "confirmando_dados_conta";
        const merged = { ...customer, ...updates };
        await sendOptions(remoteJid, buildConfirmacaoConta(merged), [
          { id: "sim_conta", title: "✅ SIM" },
          { id: "nao_conta", title: "❌ NÃO" },
          { id: "editar_conta", title: "✏️ EDITAR" },
        ]);
        reply = "";
      } else if (target) {
        updates.conversation_step = target[0];
        reply = target[1];
      } else {
        reply = "❌ Opção inválida. Digite *1-6* ou *0* para cancelar:\n\n1️⃣ Nome\n2️⃣ Endereço\n3️⃣ CEP\n4️⃣ Distribuidora\n5️⃣ Nº Instalação\n6️⃣ Valor da conta\n0️⃣ Cancelar";
      }
      break;
    }

    // Helper local: salva campo da conta e reenvia tela completa de confirmação
    case "editing_conta_nome": {
      const v = messageText.trim();
      if (v.length < 3) { reply = "❌ Nome muito curto. Digite o *nome completo*:"; break; }
      updates.name = v;
      updates.name_source = "user_confirmed";
      reply = await autoAdvanceBillAfterFieldEdit({
        customer,
        updates,
        dispatchStep: (k, vars) => dispatchStepFromFlow(k, vars),
        logPrefix: "edit-conta-nome/evolution",
      });
      break;
    }

    case "editing_conta_endereco": {
      const v = messageText.trim();
      if (v.length < 3) { reply = "❌ Endereço muito curto. Digite novamente:"; break; }

      // CEP puro (8 dígitos) → ViaCEP completa cidade/UF/bairro/rua
      if (looksLikeCepOnly(v)) {
        const cepOnly = v.replace(/\D/g, "");
        updates.cep = cepOnly;
        try {
          const viaCep = await buscarEnderecoPorCep(cepOnly);
          if (viaCep) {
            if (viaCep.logradouro) updates.address_street = viaCep.logradouro;
            if (viaCep.bairro) updates.address_neighborhood = viaCep.bairro;
            if (viaCep.localidade) updates.address_city = viaCep.localidade;
            if (viaCep.uf) updates.address_state = viaCep.uf;
          }
        } catch (e) {
          console.warn("[editing_conta_endereco] ViaCEP falhou:", (e as Error)?.message);
        }
        const mergedCep = { ...customer, ...updates };
        if (!isPlausibleAddressNumber(mergedCep.address_number)) {
          updates.conversation_step = "ask_number";
          reply = `📍 CEP *${cepOnly.replace(/(\d{5})(\d{3})/, "$1-$2")}* anotado` +
            (updates.address_city ? ` (${updates.address_city}/${updates.address_state})` : "") +
            ".\n\nAgora qual o *número* da residência? (ex: 105 — ou S/N)";
          break;
        }
        updates.previous_conversation_step = "finalizando";
        updates.conversation_step = "finalizando";
        reply = "";
        break;
      }

      updates.address_street = v;
      const cepInText = extractCepFromText(v);
      if (cepInText) {
        updates.cep = cepInText;
        try {
          const viaCep = await buscarEnderecoPorCep(cepInText);
          if (viaCep) {
            if (viaCep.bairro && !customer.address_neighborhood) updates.address_neighborhood = viaCep.bairro;
            if (viaCep.localidade) updates.address_city = viaCep.localidade;
            if (viaCep.uf) updates.address_state = viaCep.uf;
            if ((!customer.address_street || String(customer.address_street).trim().length < 8) && viaCep.logradouro) {
              updates.address_street = viaCep.logradouro;
            }
          }
        } catch (_) { /* best-effort */ }
      }
      const cityUf = v.match(/,\s*([A-Za-zÀ-ÿ\s]{2,40})\s*[-/]\s*([A-Za-z]{2})\b/);
      if (cityUf) {
        if (!updates.address_city) updates.address_city = cityUf[1].trim();
        if (!updates.address_state) updates.address_state = cityUf[2].trim().toUpperCase();
      }

      const resumeTo = resumeAfterAddressEdit(customer as any);
      updates.conversation_step = resumeTo;
      const merged = { ...customer, ...updates };
      if (resumeTo === "ask_finalizar") {
        if (!isPlausibleAddressNumber(merged.address_number)) {
          updates.conversation_step = "ask_number";
          reply = "✅ Endereço anotado!\n\nAgora qual o *número* da residência? (ex: 105 — ou S/N)";
          break;
        }
        updates.conversation_step = "finalizando";
        reply = "";
        break;
      }
      await sendOptions(remoteJid, `✅ Endereço atualizado.\n\n` + buildConfirmacaoConta(merged), [
        { id: "sim_conta", title: "✅ SIM" }, { id: "nao_conta", title: "❌ NÃO" }, { id: "editar_conta", title: "✏️ EDITAR" },
      ]);
      reply = "";
      break;
    }

    case "editing_conta_cep": {
      const cepClean = messageText.replace(/\D/g, "");
      if (cepClean.length !== 8) { reply = "❌ CEP inválido. Digite os 8 números:"; break; }
      updates.cep = cepClean;
      updates.conversation_step = "confirmando_dados_conta";
      const merged = { ...customer, ...updates };
      await sendOptions(remoteJid, `✅ CEP: *${cepClean.replace(/(\d{5})(\d{3})/, "$1-$2")}*\n\n` + buildConfirmacaoConta(merged), [
        { id: "sim_conta", title: "✅ SIM" }, { id: "nao_conta", title: "❌ NÃO" }, { id: "editar_conta", title: "✏️ EDITAR" },
      ]);
      reply = "";
      break;
    }

    case "editing_conta_distribuidora": {
      const v = messageText.trim();
      if (v.length < 2) { reply = "❌ Nome muito curto. Digite a *distribuidora*:"; break; }
      updates.distribuidora = v;
      updates.conversation_step = "confirmando_dados_conta";
      const merged = { ...customer, ...updates };
      await sendOptions(remoteJid, `✅ Distribuidora: *${v}*\n\n` + buildConfirmacaoConta(merged), [
        { id: "sim_conta", title: "✅ SIM" }, { id: "nao_conta", title: "❌ NÃO" }, { id: "editar_conta", title: "✏️ EDITAR" },
      ]);
      reply = "";
      break;
    }

    case "editing_conta_instalacao": {
      const instClean = messageText.replace(/\D/g, "");
      if (instClean.length < 7) { reply = "❌ Número inválido. Digite pelo menos 7 dígitos:"; break; }
      updates.numero_instalacao = instClean;
      updates.conversation_step = "confirmando_dados_conta";
      const merged = { ...customer, ...updates };
      await sendOptions(remoteJid, `✅ Nº Instalação: *${instClean}*\n\n` + buildConfirmacaoConta(merged), [
        { id: "sim_conta", title: "✅ SIM" }, { id: "nao_conta", title: "❌ NÃO" }, { id: "editar_conta", title: "✏️ EDITAR" },
      ]);
      reply = "";
      break;
    }

    case "editing_conta_valor": {
      const val = (parseMoneyBR(messageText) ?? NaN);
      if (isNaN(val) || val < 30) { reply = "❌ Valor inválido. Digite um número (ex: 350,50):"; break; }
      updates.electricity_bill_value = val;
      reply = await autoAdvanceBillAfterFieldEdit({
        customer,
        updates,
        dispatchStep: (k, vars) => dispatchStepFromFlow(k, vars),
        logPrefix: "edit-conta-valor/evolution",
      });
      break;
    }

    // ─── 8. EDIÇÃO DOCUMENTO ─────────
    case "editing_doc_menu": {
      const op = messageText.trim().toLowerCase();
      const fieldMap: Record<string, [string, string]> = {
        "1": ["editing_doc_nome", "Digite o *nome completo* correto:"],
        "2": ["editing_doc_cpf", "Digite o *CPF* correto (apenas números):"],
        "3": ["editing_doc_rg", "Digite o *RG* correto:"],
        "4": ["editing_doc_nascimento", "Digite a *data de nascimento* (DD/MM/AAAA):"],
      };
      let target: [string, string] | null = fieldMap[op] || null;
      if (!target) {
        if (/\bnome\b/.test(op)) target = fieldMap["1"];
        else if (/\bcpf\b/.test(op)) target = fieldMap["2"];
        else if (/\brg\b/.test(op)) target = fieldMap["3"];
        else if (/\b(nascimento|data)\b/.test(op)) target = fieldMap["4"];
      }
      if (op === "0" || /\b(cancelar|voltar)\b/.test(op)) {
        updates.conversation_step = "confirmando_dados_doc";
        const merged = { ...customer, ...updates };
        await sendOptions(remoteJid, buildConfirmacaoDoc(merged), [
          { id: "sim_doc", title: "✅ SIM" }, { id: "nao_doc", title: "❌ NÃO" }, { id: "editar_doc", title: "✏️ EDITAR" },
        ]);
        reply = "";
      } else if (target) {
        updates.conversation_step = target[0];
        reply = target[1];
      } else {
        reply = "❌ Opção inválida. Digite *1-4* ou *0* para cancelar:\n\n1️⃣ Nome\n2️⃣ CPF\n3️⃣ RG\n4️⃣ Data de Nascimento\n0️⃣ Cancelar";
      }
      break;
    }

    case "editing_doc_nome": {
      const v = messageText.trim();
      if (v.length < 3) { reply = "❌ Nome muito curto. Digite o *nome completo*:"; break; }
      updates.name = v;
      updates.name_source = "user_confirmed";
      updates.conversation_step = "confirmando_dados_doc";
      const merged = { ...customer, ...updates };
      await sendOptions(remoteJid, `✅ Nome: *${v}*\n\n` + buildConfirmacaoDoc(merged), [
        { id: "sim_doc", title: "✅ SIM" }, { id: "nao_doc", title: "❌ NÃO" }, { id: "editar_doc", title: "✏️ EDITAR" },
      ]);
      reply = "";
      break;
    }

    case "editing_doc_cpf": {
      const cpfClean = messageText.replace(/\D/g, "");
      if (cpfClean.length !== 11) { reply = "❌ CPF inválido. Digite os 11 números:"; break; }
      updates.cpf = cpfClean;
      updates.conversation_step = "confirmando_dados_doc";
      const merged = { ...customer, ...updates };
      await sendOptions(remoteJid, `✅ CPF: *${cpfClean.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4")}*\n\n` + buildConfirmacaoDoc(merged), [
        { id: "sim_doc", title: "✅ SIM" }, { id: "nao_doc", title: "❌ NÃO" }, { id: "editar_doc", title: "✏️ EDITAR" },
      ]);
      reply = "";
      break;
    }

    case "editing_doc_rg": {
      const v = messageText.trim();
      if (v.replace(/\D/g, "").length < 4) { reply = "❌ RG inválido. Digite novamente:"; break; }
      updates.rg = v;
      updates.conversation_step = "confirmando_dados_doc";
      const merged = { ...customer, ...updates };
      await sendOptions(remoteJid, `✅ RG: *${v}*\n\n` + buildConfirmacaoDoc(merged), [
        { id: "sim_doc", title: "✅ SIM" }, { id: "nao_doc", title: "❌ NÃO" }, { id: "editar_doc", title: "✏️ EDITAR" },
      ]);
      reply = "";
      break;
    }

    case "editing_doc_nascimento": {
      const dateMatch = messageText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
      if (!dateMatch) { reply = "❌ Data inválida. Use DD/MM/AAAA (ex: 20/07/1993):"; break; }
      updates.data_nascimento = messageText.trim();
      updates.conversation_step = "confirmando_dados_doc";
      const merged = { ...customer, ...updates };
      await sendOptions(remoteJid, `✅ Data: *${messageText.trim()}*\n\n` + buildConfirmacaoDoc(merged), [
        { id: "sim_doc", title: "✅ SIM" }, { id: "nao_doc", title: "❌ NÃO" }, { id: "editar_doc", title: "✏️ EDITAR" },
      ]);
      reply = "";
      break;
    }

    // ─── 9. PERGUNTAS MANUAIS ─────────
    case "ask_name": {
      const nameRaw = String(messageText || "").trim();
      if (nameRaw.length < 3 || isNonNameReply(nameRaw)) {
        reply = "Por favor, digite seu *nome completo* (nome e sobrenome).";
        break;
      }
      updates.name = nameRaw;
      updates.name_source = "user_confirmed";
      const merged = { ...customer, ...updates };
      const next = await autoResolveCepIfNeeded(merged, updates);
      updates.conversation_step = next;
      reply = getReplyForStep(next, merged);
      break;
    }

    case "ask_cpf": {
      const cpfClean = messageText.replace(/\D/g, "");
      if (cpfClean.length !== 11) { reply = "❌ CPF inválido. Digite os *11 números*:"; break; }
      if (!validarCPFDigitos(cpfClean)) { reply = "❌ CPF inválido. Verifique os números:"; break; }
      updates.cpf = cpfClean;
      // OCR doc já veio, só faltava CPF → avança sem SIM (evita resume em confirmando_dados_doc).
      const _docFront = String(customer.document_front_url || updates.document_front_url || "").trim();
      if (_docFront && _docFront !== "evolution-media:pending") {
        reply = await autoAdvanceAfterDocOcr({
          customer,
          updates,
          remoteJid,
          sendOptions,
        });
        break;
      }
      const merged = { ...customer, ...updates };
      const next = await autoResolveCepIfNeeded(merged, updates);
      updates.conversation_step = next;
      reply = getReplyForStep(next, merged);
      break;
    }

    case "ask_rg": {
      if (messageText.length < 4) { reply = "Por favor, informe um *RG válido*:"; break; }
      updates.rg = messageText.trim();
      const merged = { ...customer, ...updates };
      const next = await autoResolveCepIfNeeded(merged, updates);
      updates.conversation_step = next;
      reply = getReplyForStep(next, merged);
      break;
    }

    case "ask_birth_date": {
      const dateMatch = messageText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
      if (!dateMatch) { reply = "❌ Data inválida. Use *DD/MM/AAAA* (ex: 20/07/1993):"; break; }
      updates.data_nascimento = messageText.trim();
      const merged = { ...customer, ...updates };
      const next = await autoResolveCepIfNeeded(merged, updates);
      updates.conversation_step = next;
      reply = getReplyForStep(next, merged);
      break;
    }

    case "ask_phone_confirm": {
      const rawResp: string = isButton ? String(buttonId ?? "") : messageText.toLowerCase().trim();
      // Evolution renderiza sendOptions como texto numerado, então "1"/"2" sempre
      // chegam como texto. Aceitamos numérico independente de isButton.
      const numKey = ({
        "1": "sim_phone",
        "2": "editar_phone",
        "phone_ok": "sim_phone",
        "phone_other": "editar_phone",
        "sim, este número": "sim_phone",
        "quero outro": "editar_phone",
      } as Record<string, string>)[rawResp] ?? rawResp;
      const sim = numKey === "sim_phone"
        || /^(sim|s|isso|isso\s+mesmo|é\s+meu|eh\s+meu|confirmo|pode|certo|correto|positivo)\b/.test(rawResp);
      const editar = numKey === "editar_phone"
        || /^(n[aã]o|n|editar|outro|outro\s+n[uú]mero|trocar|mudar|errado|quero\s+outro)\b/.test(rawResp);

      // Cliente digitou um telefone em vez de Sim/Não (caso Osmar: "034 99992-7145").
      // Brasil só — DDI 55 fixo via toNationalPhoneDigits.
      if (!isButton && !sim && !editar && isValidBrNationalPhone(messageText)) {
        const num = toNationalPhoneDigits(messageText);
        const land = formatBrLandline(num);
        if (land) {
          updates.phone_landline = land;
          updates.portal2_celular_alt = toWhatsappCanonical(num);
          updates.phone_contact_confirmed = true;
          const merged = { ...customer, ...updates };
          const next = await autoResolveCepIfNeeded(merged, updates);
          updates.conversation_step = next;
          reply = getReplyForStep(next, merged);
          break;
        }
      }

      // ── PROTEÇÃO: Se o phone_whatsapp é o número do consultor/instância,
      // NÃO permitir confirmar — forçar digitar outro número ──
      let phoneIsConsultant = false;
      if (sim) {
        try {
          const [{ data: cons }, { data: inst }] = await Promise.all([
            supabase.from("consultants").select("phone").eq("id", consultorId).maybeSingle(),
            supabase.from("whatsapp_instances").select("connected_phone").eq("consultant_id", consultorId).maybeSingle(),
          ]);
          const blockNumbers = [cons?.phone, inst?.connected_phone].filter(Boolean) as string[];
          const whatsNum = (customer.phone_whatsapp || phone || "").replace(/\D/g, "");
          if (blockNumbers.some((n) => isSameContact(whatsNum, n))) {
            phoneIsConsultant = true;
            console.log(`⚠️ [ask_phone_confirm] Telefone do WhatsApp é do consultor — forçando ask_phone`);
          }
        } catch (_) { /* segue */ }
      }

      if (sim && !phoneIsConsultant) {
        // NUNCA slice(-11) em WA com DDI — corrompe 12 dígitos (55+DDD+8 → DDD 53).
        const num = toNationalPhoneDigits(customer.phone_whatsapp || phone);
        const land = formatBrLandline(num);
        if (!land || !isValidBrNationalPhone(num)) {
          updates.conversation_step = "ask_phone";
          reply = "Não consegui confirmar esse número. Informe o *telefone com DDD* (ex: 11999998888):";
          break;
        }
        updates.phone_landline = land;
        // Troca completa: o número confirmado também vira o celular do Portal 2.
        // phone_whatsapp permanece a chave da conversa (unique).
        updates.portal2_celular_alt = toWhatsappCanonical(num);
        updates.phone_contact_confirmed = true;
        const merged = { ...customer, ...updates };
        const next = await autoResolveCepIfNeeded(merged, updates);
        updates.conversation_step = next;
        reply = getReplyForStep(next, merged);
      } else if (sim && phoneIsConsultant) {
        // Telefone do WhatsApp é do consultor — não pode usar como contato
        updates.conversation_step = "ask_phone";
        reply = "⚠️ Esse número é do consultor e não pode ser usado como seu contato.\n\nInforme *seu próprio telefone* com DDD (ex: 11999998888):";
      } else if (editar) {
        updates.conversation_step = "ask_phone";
        reply = "Informe o *telefone* com DDD (ex: 11999998888):";
      } else {
        const msgConfirm = getReplyForStep("ask_phone_confirm", { ...customer, phone_whatsapp: phone });
        const sent = await sendOptions(remoteJid, msgConfirm, [
          { id: "sim_phone", title: "✅ Sim" },
          { id: "editar_phone", title: "📱 Outro número" },
        ]);
        if (!sent) reply = "Digite *1* se esse telefone é seu, ou *2* para informar outro número:";
        else reply = "";
      }
      break;
    }

    case "ask_phone": {
      // ── DETECÇÃO INTELIGENTE: se o cliente mandou email ao invés de telefone, salvar e avançar ──
      if (messageText.includes("@") && isValidEmailFormat(messageText.trim())) {
        console.log(`📧 [ask_phone] Cliente enviou email (${messageText.trim().length} chars) ao invés de telefone — salvando e avançando`);
        updates.email = messageText.trim().toLowerCase();
        // Usar telefone do WhatsApp como telefone de contato (NÃO alterar phone_whatsapp — é chave da conversa)
        const num = toNationalPhoneDigits(customer.phone_whatsapp || phone);
        const land = formatBrLandline(num);
        if (land) {
          updates.phone_landline = land;
          // NÃO atualizar phone_whatsapp — causa duplicate key violation
          updates.portal2_celular_alt = toWhatsappCanonical(num);
          updates.phone_contact_confirmed = true;
        }
        const merged = { ...customer, ...updates };
        const next = await autoResolveCepIfNeeded(merged, updates);
        updates.conversation_step = next;
        reply = getReplyForStep(next, merged);
        break;
      }
      // Brasil só — DDI 55 fixo. Aceita +55, 55, 034…, (11) 9…
      const num11 = toNationalPhoneDigits(messageText);
      if (!isValidBrNationalPhone(num11)) {
        reply = "❌ Telefone inválido. Digite com DDD (ex: 11999998888):";
        break;
      }
      // Buscar telefone do consultor + número da instância conectada para evitar auto-cadastro acidental
      try {
        const [{ data: cons }, { data: inst }] = await Promise.all([
          supabase.from("consultants").select("phone").eq("id", consultorId).maybeSingle(),
          supabase.from("whatsapp_instances").select("connected_phone").eq("consultant_id", consultorId).maybeSingle(),
        ]);
        const blockNumbers = [cons?.phone, inst?.connected_phone].filter(Boolean) as string[];
        if (blockNumbers.some((n) => isSameContact(num11, n))) {
          reply = "❌ Esse telefone é o número do consultor. Por favor, informe *seu próprio telefone* de contato:";
          break;
        }
      } catch (_) { /* segue */ }
      updates.phone_landline = formatBrLandline(num11)!;
      // ⚠️ NÃO atualizar phone_whatsapp — chave da conversa (unique).
      // Troca completa: o número DIGITADO vira o celular do Portal 2.
      updates.portal2_celular_alt = toWhatsappCanonical(num11);
      updates.phone_contact_confirmed = true;
      const merged = { ...customer, ...updates };
      const next = await autoResolveCepIfNeeded(merged, updates);
      updates.conversation_step = next;
      reply = getReplyForStep(next, merged);
      break;
    }

    case "ask_email": {
      // Sanitiza ANTES de validar: WhatsApp costuma mandar "fulano@gmail.com. br"
      // (com espaço) quando o usuário separa o sobrenome por engano. Sem isso,
      // o tail vazava para address_complement e o consultor-check podia confundir
      // com o email do dono. Pegamos só o primeiro token e limpamos pontuação no fim.
      const rawText = (messageText || "").trim();
      const txt = rawText
        .split(/\s+/)[0]
        .replace(/[.,;]+$/, "")
        .trim();
      const lower = txt.toLowerCase();
      console.log(`[ask_email] customer=${customer.id} raw="${rawText}" clean="${lower}"`);
      // ⚠️ Email é OBRIGATÓRIO no portal iGreen. Não aceitar PULAR.
      if (["pular", "skip", "não tenho", "nao tenho", "sem email", "sem e-mail", "n", "não", "nao"].includes(lower)) {
        console.log(`[ask_email] customer=${customer.id} → recusa de email, pedindo de novo`);
        reply = "📧 Esse aqui é *importante*! É o login do seu app *iGreen Club* 📱\n\nMe passa um e-mail seu — pode criar rapidinho em qualquer provedor (Gmail, Outlook, iCloud…).";
        break;
      }
      if (!isValidEmailFormat(txt)) {
        console.log(`[ask_email] customer=${customer.id} → formato inválido "${txt}"`);
        reply = "❌ E-mail inválido. Confere o *@* e o domínio (ex: *seunome@gmail.com*):";
        break;
      }
      if (isPlaceholderEmail(txt)) {
        console.log(`[ask_email] customer=${customer.id} → placeholder/teste "${txt}"`);
        reply = "❌ Esse e-mail parece de teste. Me manda o seu *de verdade*:";
        break;
      }
      // Bloquear email do consultor dono — NÃO grava nada antes desse check.
      let consultorEmailForCustomer: string | null = null;
      try {
        const { data: cons } = await supabase
          .from("consultants")
          .select("igreen_portal_email")
          .eq("id", consultorId)
          .maybeSingle();
        consultorEmailForCustomer = cons?.igreen_portal_email || null;
        if (consultorEmailForCustomer && isSameContact(txt, consultorEmailForCustomer)) {
          console.log(`[ask_email] customer=${customer.id} → email do consultor, rejeitado`);
          reply = "❌ Esse é o e-mail do consultor. Preciso de um e-mail *seu*:";
          break;
        }
      } catch (_) { /* segue */ }
      updates.email = lower;
      const merged = { ...customer, ...updates };
      const next = await autoResolveCepIfNeeded(merged, updates);
      console.log(`[ask_email] customer=${customer.id} → aceito, next_step="${next}"`);
      // Passos finais SEPARADOS: nunca pular boleto/confirmação direto pro portal.
      if (next === "ask_finalizar" || next === "ask_contaunica" || next === "ask_transferir_titularidade") {
        const gate = nextSeparatedCadastroStep(merged as any);
        updates.conversation_step = gate;
        if (gate === "ask_contaunica") {
          const msg = getReplyForStep("ask_contaunica", merged);
          const opts = getPreferenceOptions("ask_contaunica") || [];
          const sent = await sendOptions(remoteJid, msg, [...opts]);
          if (!sent) reply = msg;
          else reply = "";
        } else {
          const sent = await sendOptions(remoteJid, getReplyForStep("ask_finalizar", merged), [
            { id: "btn_finalizar", title: "✅ Finalizar" },
          ]);
          if (!sent) reply = getReplyForStep("ask_finalizar", merged);
          else reply = "";
        }
      } else {
        updates.conversation_step = next;
        if (next === "ask_email") {
          reply = "❌ E-mail não aceito. Me manda *outro e-mail seu* (qualquer provedor):";
        } else {
          reply = getReplyForStep(next, merged);
        }
      }


      break;
    }


    case "ask_cep": {
      // F03: nunca martelar CEP. E-mail neste step → captura e-mail.
      if (looksLikeEmail(messageText) && !(customer as any).email) {
        const em = String(messageText || "").trim().split(/\s+/)[0].replace(/[.,;]+$/, "").toLowerCase();
        updates.email = em;
        const mergedEm = { ...customer, ...updates };
        let nextEm = await autoResolveCepIfNeeded(mergedEm, updates);
        if (nextEm === "ask_cep") nextEm = "ask_number";
        updates.conversation_step = nextEm;
        reply = getReplyForStep(nextEm, mergedEm);
        break;
      }
      const cepClean = messageText.replace(/\D/g, "");
      if (cepClean.length !== 8) {
        const mergedSkip = { ...customer, ...updates };
        let nextSkip = await autoResolveCepIfNeeded(mergedSkip, updates);
        if (nextSkip === "ask_cep") nextSkip = "ask_number";
        updates.conversation_step = nextSkip;
        reply = getReplyForStep(nextSkip, mergedSkip);
        break;
      }
      try {
        const viaCep = await buscarEnderecoPorCep(cepClean);
        if (!viaCep) { reply = "❌ CEP não encontrado. Verifique e tente novamente:"; break; }
        updates.cep = cepClean;
        updates.address_street = viaCep.logradouro || customer.address_street || "";
        updates.address_neighborhood = viaCep.bairro || customer.address_neighborhood || "";
        updates.address_city = viaCep.localidade || customer.address_city || "";
        updates.address_state = viaCep.uf || customer.address_state || "";
      } catch { reply = "⚠️ Erro ao buscar CEP. Tente novamente:"; break; }
      const merged = { ...customer, ...updates };
      const next = await autoResolveCepIfNeeded(merged, updates);
      updates.conversation_step = next;
      reply = getReplyForStep(next, merged);
      break;
    }

    case "ask_number": {
      // F03: 8 dígitos puros = CEP, não número da casa (Julia)
      if (looksLikeCepOnly(messageText)) {
        const cepOnly = messageText.replace(/\D/g, "");
        updates.cep = cepOnly;
        const mergedCep = { ...customer, ...updates };
        let nextCep = await autoResolveCepIfNeeded(mergedCep, updates);
        if (nextCep === "ask_number" || nextCep === "ask_cep") {
          updates.conversation_step = "ask_number";
          reply = "📍 Anotei o CEP. Agora qual o *número* da residência? (ex: 105)";
        } else {
          updates.conversation_step = nextCep;
          reply = getReplyForStep(nextCep, mergedCep);
        }
        break;
      }
      // E-mail colado no lugar do número (caso Salto 19/07)
      if (looksLikeEmail(messageText)) {
        if (!(customer as any).email) updates.email = String(messageText).trim().split(/\s+/)[0].replace(/[.,;]+$/, "").toLowerCase();
        updates.conversation_step = "ask_number";
        reply = "Isso parece um *e-mail*. Qual o *número* da residência? (ex: 105 — ou S/N)";
        break;
      }
      const numRaw = messageText.trim();
      if (!isPlausibleAddressNumber(numRaw)) {
        reply = "❌ Número inválido. Digite o *número* da residência (ex: 105 — ou S/N):";
        break;
      }
      updates.address_number = numRaw;
      const merged = { ...customer, ...updates };
      const next = await autoResolveCepIfNeeded(merged, updates);
      updates.conversation_step = next;
      reply = getReplyForStep(next, merged);
      break;
    }

    case "ask_complement": {
      const resp = isButton ? buttonId : (messageText || "").toLowerCase().trim();
      const skipWords = ["não", "nao", "n", "pular", "skip", "sem complemento", "sem", "nenhum", "não tem", "nao tem", "skip_complement", "no_complement"];

      // Cliente pediu para adicionar complemento → repete o passo aguardando o texto
      if (resp === "add_complement") {
        reply = "✍️ Digite o complemento (ex: Apto 12, Bloco B, Casa 2):";
        (updates as any).__inline_sent = false;
        break;
      }

      // Pular / Não tem → salva vazio
      if (resp === "skip_complement" || resp === "no_complement" || skipWords.includes(String(resp).toLowerCase())) {
        updates.address_complement = "";
      } else if (messageText && messageText.trim().length > 0) {
        if (looksLikeEmail(messageText)) {
          if (!(customer as any).email) updates.email = String(messageText).trim().toLowerCase();
          updates.address_complement = "";
        } else {
          updates.address_complement = sanitizeComplement(messageText.trim()) ?? messageText.trim();
        }
      } else {
        // Sem texto válido nem botão → reenvia pergunta com 3 botões
        const sent = await sendOptions(
          remoteJid,
          "🏠 *Tem complemento no endereço?*\n_Apto, bloco, casa, fundos, etc._",
          [
            { id: "add_complement", title: "✍️ Adicionar" },
            { id: "skip_complement", title: "⏭️ Pular" },
            { id: "no_complement", title: "🚫 Não tem" },
          ],
        );
        if (sent) { reply = ""; (updates as any).__inline_sent = true; }
        else reply = "🏠 Tem complemento? Digite o complemento, *PULAR* ou *NÃO TEM*.";
        break;
      }

      const merged = { ...customer, ...updates };
      const next = await autoResolveCepIfNeeded(merged, updates);
      // Passos finais SEPARADOS: boleto → confirmar (nunca portal direto).
      if (next === "ask_finalizar" || next === "ask_contaunica" || next === "ask_transferir_titularidade") {
        const gate = nextSeparatedCadastroStep(merged as any);
        updates.conversation_step = gate;
        if (gate === "ask_contaunica") {
          const msg = getReplyForStep("ask_contaunica", merged);
          const opts = getPreferenceOptions("ask_contaunica") || [];
          const sent = await sendOptions(remoteJid, msg, [...opts]);
          if (!sent) reply = msg;
          else reply = "";
        } else {
          const sent = await sendOptions(remoteJid, getReplyForStep("ask_finalizar", merged), [
            { id: "btn_finalizar", title: "✅ Finalizar" },
          ]);
          if (!sent) reply = getReplyForStep("ask_finalizar", merged);
          else reply = "";
        }
      } else {
        updates.conversation_step = next;
        reply = getReplyForStep(next, merged);
      }
      break;
    }

    case "ask_distribuidora": {
      const v = messageText.trim();
      if (v.length < 2) { reply = "❌ Nome muito curto. Qual a *distribuidora* da sua conta de luz? (ex: CPFL, Enel, Cemig)"; break; }
      updates.distribuidora = v;
      const merged = { ...customer, ...updates };
      const next = await autoResolveCepIfNeeded(merged, updates);
      updates.conversation_step = next;
      reply = getReplyForStep(next, merged);
      break;
    }

    case "ask_installation_number": {
      const instClean = messageText.replace(/\D/g, "");
      if (instClean.length < 7) { reply = "❌ Número inválido. Digite pelo menos 7 dígitos:"; break; }
      updates.numero_instalacao = instClean;
      const merged = { ...customer, ...updates };
      const next = await autoResolveCepIfNeeded(merged, updates);
      updates.conversation_step = next;
      reply = getReplyForStep(next, merged);
      break;
    }

    case "ask_bill_value": {
      // 🛡️ Se já temos valor (via OCR da conta), NÃO sobrescrever — apenas avança.
      const existingVal = Number((customer as any).electricity_bill_value || 0);
      if (existingVal >= 30) {
        console.log(`[ask_bill_value] skip — valor já existe (R$ ${existingVal})`);
        const merged = { ...customer };
        const next = await autoResolveCepIfNeeded(merged, updates);
        updates.conversation_step = next;
        reply = getReplyForStep(next, merged);
        break;
      }
      const val = (parseMoneyBR(messageText) ?? NaN);
      if (isNaN(val) || val <= 0) { reply = "❌ Valor inválido. Digite um número (ex: 350):"; break; }
      updates.electricity_bill_value = val;
      const merged = { ...customer, ...updates };
      const next = await autoResolveCepIfNeeded(merged, updates);
      updates.conversation_step = next;
      reply = getReplyForStep(next, merged);
      break;
    }

    // ─── 10. DOCUMENTOS MANUAIS ────────
    case "ask_doc_frente_manual": {
      if (!isFile) { reply = "📸 Envie a *FRENTE do seu documento* (RG ou CNH)\n\nFormatos: JPG, PNG ou PDF"; break; }
      if (fileBase64) {
        const mime = imageMessage?.mimetype || documentMessage?.mimetype || "application/octet-stream";
        const minioUrl = await uploadMediaToMinio({
          fileBase64, mimeType: mime, consultantFolder: consultorId, consultantName: nomeRepresentante,
          customerName: customer.name || "cliente", customerBirth: customer.data_nascimento, kind: "doc_frente",
        });
        updates.document_front_url = minioUrl || (fileUrl?.startsWith("http") ? fileUrl : "evolution-media:pending");
      } else {
        updates.document_front_url = fileUrl?.startsWith("http") ? fileUrl : "evolution-media:pending";
      }
      const merged = { ...customer, ...updates };
      const next = await autoResolveCepIfNeeded(merged, updates);
      updates.conversation_step = next;
      reply = getReplyForStep(next, merged);
      break;
    }

    case "ask_doc_verso_manual": {
      if (!isFile) { reply = "📸 Envie o *VERSO do seu documento*\n\nFormatos: JPG, PNG ou PDF"; break; }
      if (fileBase64) {
        const mime = imageMessage?.mimetype || documentMessage?.mimetype || "application/octet-stream";
        const minioUrl = await uploadMediaToMinio({
          fileBase64, mimeType: mime, consultantFolder: consultorId, consultantName: nomeRepresentante,
          customerName: customer.name || "cliente", customerBirth: customer.data_nascimento, kind: "doc_verso",
        });
        updates.document_back_url = minioUrl || (fileUrl?.startsWith("http") ? fileUrl : "evolution-media:pending");
        updates.document_back_base64 = "inline"; // OOM-FIX 2026-06-28: sentinel curto.
      } else {
        updates.document_back_url = fileUrl?.startsWith("http") ? fileUrl : "evolution-media:pending";
      }
      const merged = { ...customer, ...updates };
      const next = await autoResolveCepIfNeeded(merged, updates);
      updates.conversation_step = next;
      reply = getReplyForStep(next, merged);
      break;
    }

    // ─── 11. CONFIRMAR FINALIZAR ────────
    case "ask_quero_cadastrar": {
      const resp = (isButton ? buttonId : messageText.toLowerCase().trim()) || "";
      const triggers = ["btn_quero_cadastrar", "quero_cadastrar", "sim_cadastrar", "cadastrar", "btn_cadastrar", "quero_simular", "btn_simular", "simular", "btn_quero_simular", "1", "sim", "s", "quero", "bora", "vamos", "vamo", "pode", "ok", "blz", "beleza"];
      const wants = triggers.includes(resp) || /^(sim|quero|bora|vamos|pode|ok)\b/i.test(resp);
      if (wants) {
        // 🔁 RESUME determinístico — pula pro próximo passo faltante.
        const resumed = resolveResumeStep(customer);
        if (resumed !== "aguardando_doc_auto" && resumed !== "aguardando_doc_verso") {
          console.log(`[ask_quero_cadastrar] resume → ${resumed} (dados já cobrem doc)`);
          const merged = { ...customer };
          updates.conversation_step = resumed === "ask_finalizar" ? "finalizando" : resumed;
          reply = resumed === "ask_finalizar" ? "✅ Tudo certo! Processando seu cadastro..." : getReplyForStep(resumed, merged);
          break;
        }

        try {
          const _flowRow = await resolveFlowId(supabase, customer.consultant_id, (customer as any)?.flow_variant || "A");
          if (_flowRow?.id) {
            const { data: _docStep } = await supabase
              .from("bot_flow_steps")
              .select("step_key")
              .eq("flow_id", (_flowRow as any).id).eq("is_active", true)
              .in("step_type", ["capture_documento", "capture_doc"])
              .order("position", { ascending: true })
              .limit(1).maybeSingle();
            if (_docStep?.step_key) {
              await dispatchStepFromFlow(_docStep.step_key);
            } else {
              await sendText(remoteJid, "Para continuar, me envia uma foto da *frente do seu documento* 📄\n\nPode ser RG ou CNH, o que estiver mais à mão.");
            }
          }
        } catch (e) {
          console.warn("[ask_quero_cadastrar] erro:", (e as Error).message);
        }
        updates.conversation_step = "aguardando_doc_auto";
        reply = "";
      } else {
        const ctaText = "Para continuar, é só tocar no botão abaixo 👇";
        const sent = await sendOptions(remoteJid, ctaText, [
          { id: "btn_quero_cadastrar", title: "✅ Quero me cadastrar" },
        ]);
        if (!sent) reply = "Toque no botão *✅ Quero me cadastrar* acima — ou responda *SIM* para continuar.";
        else reply = "";
      }
      break;
    }

    case "ask_transferir_titularidade":
      // Legado mid-flight: redireciona para a pergunta de boleto (mesma escolha).
      updates.conversation_step = "ask_contaunica";
      // fallthrough
    case "ask_contaunica": {
      const rawResp: string = isButton ? String(buttonId ?? "") : messageText.toLowerCase().trim();
      // Aceita ids novos (boleto_*) e legado (titularidade_*) — mesma semântica.
      const numKey = ({
        "1": "boleto_unificado",
        "2": "boleto_separado",
        "titularidade_sim": "boleto_unificado",
        "titularidade_nao": "boleto_separado",
      } as Record<string, string>)[rawResp] ?? rawResp;
      const unificado = numKey === "boleto_unificado"
        || /^(unificad[oa]|unico|única|unica|junto|sim|s|quero|transferir|1)\b/.test(rawResp)
        || /\bunificad|\btransfer/.test(rawResp);
      const separado = numKey === "boleto_separado"
        || /^(separad[oa]|dois|nao|não|n|2)\b/.test(rawResp)
        || /\bseparad|\bn[aã]o\b/.test(rawResp);

      if (unificado || separado) {
        // Se ambos casarem (ex.: "não transferir"), prioriza separado/não.
        const chooseUnificado = separado ? false : true;
        // Portal: transferir titularidade ⇒ boleto único; não transferir ⇒ 2 boletos.
        // Bot pergunta boleto (UX mais clara) e grava os dois campos juntos.
        updates.contaunica = chooseUnificado;
        updates.transferir_titularidade = chooseUnificado;
        updates.contaunica_answered = true;
        updates.transferir_titularidade_answered = true;
        const merged = { ...customer, ...updates };
        const next = await autoResolveCepIfNeeded(merged, updates);
        // SEPARADO: após boleto → ask_finalizar (NÃO portal ainda).
        if (next === "ask_finalizar" || next === "ask_transferir_titularidade" || next === "ask_contaunica") {
          updates.conversation_step = "ask_finalizar";
          const note = chooseUnificado
            ? "✅ *Boleto unificado* anotado!"
            : "✅ *Boleto separado* anotado!";
          const msg = `${note}\n\n${getReplyForStep("ask_finalizar", merged)}`;
          const sent = await sendOptions(remoteJid, msg, [
            { id: "btn_finalizar", title: "✅ Finalizar" },
          ]);
          if (!sent) reply = msg;
          else reply = "";
        } else {
          updates.conversation_step = next;
          reply = getReplyForStep(next, merged);
        }
      } else {
        updates.conversation_step = "ask_contaunica";
        const msg = getReplyForStep("ask_contaunica", customer);
        const opts = getPreferenceOptions("ask_contaunica") || [];
        const sent = await sendOptions(remoteJid, msg, [...opts]);
        if (!sent) reply = "Digite *1* para boleto unificado ou *2* para boleto separado:";
        else reply = "";
      }
      break;
    }

    case "ask_finalizar": {
      // Gate: preferência de boleto obrigatória antes de finalizar
      {
        const pref = missingPreferenceStep({ ...customer, ...updates });
        if (pref) {
          updates.conversation_step = pref;
          const msg = getReplyForStep(pref, customer);
          const opts = getPreferenceOptions(pref) || [];
          const sent = await sendOptions(remoteJid, msg, [...opts]);
          if (!sent) reply = msg;
          else reply = "";
          break;
        }
      }

      const resp = (isButton ? buttonId : messageText.toLowerCase().trim()) || "";
      // Aceita botão OU texto livre (cliente quase nunca clica no botão)
      const triggers = ["btn_finalizar", "1", "finalizar", "sim", "s", "ok", "concluir", "prosseguir", "vamos", "pode", "pode sim", "pronto"];
      const finalizar = triggers.includes(resp);
      if (finalizar) { updates.conversation_step = "finalizando"; reply = ""; }
      else {
        const sent = await sendOptions(remoteJid, "📋 Todos os dados foram preenchidos!\n\nDeseja finalizar o cadastro?\n\n_(Você também pode digitar *FINALIZAR* ou *OK*)_", [
          { id: "btn_finalizar", title: "✅ Finalizar" },
        ]);
        if (!sent) reply = "Toque no botão *✅ Finalizar* acima — ou responda *FINALIZAR* para concluir o cadastro.";
      }
      break;
    }

    case "finalizando": {
      // 🔧 FIX 19/07/2026 (espelha whapi): o custom-step-resolver pode pular
      // DIRETO para "finalizando" (skip-guard: dados completos). Sem este
      // case, caía no `default` → "não roteado" → nada enviado e o portal
      // nunca disparava. Setar updates.conversation_step ativa o bloco
      // AUTO-FINALIZAÇÃO pós-switch (valida → portal → OTP → facial).
      updates.conversation_step = "finalizando";
      reply = "";
      break;
    }

    case "portal_submitting": {
      if (String((customer as any).portal2_error || "").includes("Consumo médio não informado")) {
        const valorConta = Number((customer as any).electricity_bill_value || 0);
        if (valorConta >= 30) {
          updates.media_consumo = Math.max(100, Math.min(2000, Math.round(valorConta / 1.10)));
          updates.portal2_status = "retry_ready";
          updates.error_message = null;
          reply = "Já ajustei os dados da conta por aqui e estou reenviando seu cadastro para o portal. Pode aguardar alguns instantes ✅";
          try {
            const { dispatchPortalWorker } = await import("../../_shared/portal-worker.ts");
            await supabase.from("customers").update(updates).eq("id", customer.id);
            await dispatchPortalWorker(supabase, customer.id);
            (updates as any).__inline_sent = false;
          } catch (e: any) {
            console.warn("[portal_submitting] retry consumo falhou:", e?.message);
          }
          break;
        }
      }

      // ── Loop de correção genérico (Req 7.1, 9.5, 10.1/10.4) ──
      // Generaliza o caso do consumo: se o worker marcou o cadastro como
      // `awaiting_correction` (Classe_de_Erro recuperável, tentativas < 3),
      // abre o step de correção e pede ao cliente APENAS o dado rejeitado.
      // Guarda (Req 10.4): classe não-recuperável ou limite esgotado →
      // mantém `needs_human` e NÃO pede correção.
      const _portalStatus = String((customer as any).portal2_status || "");
      if (_portalStatus === "awaiting_correction" || _portalStatus === "needs_human") {
        const decision = decideCorrection(
          (customer as any).portal2_error_kind,
          (customer as any).portal2_correction_attempts,
        );
        if (decision.action === "open") {
          updates.conversation_step = decision.spec.step;
          reply = decision.spec.prompt;
          console.log(`[portal-correction] abrindo step=${decision.spec.step} kind=${decision.kind}`);
          break;
        }
        if (decision.action === "needs_human") {
          if (_portalStatus !== "needs_human") updates.portal2_status = "needs_human";
          console.log(`[portal-correction] guarda needs_human reason=${decision.reason} kind=${(customer as any).portal2_error_kind}`);
          reply = "Recebi seu cadastro aqui! Esse caso específico vou encaminhar para um de nossos consultores finalizar com você — em breve alguém te chama por aqui 👍";
          break;
        }
        // decision.action === "none" (ex.: missing_consumo sem valor) → segue
        // para a mensagem padrão de processamento abaixo.
      }

      reply = "⏳ Estamos processando seu cadastro no portal...\n\n📱 Em breve você receberá um *código de verificação no WhatsApp*. Quando receber, *digite aqui*!\n\nAguarde alguns instantes...";
      break;
    }

    // ─── LOOP DE CORREÇÃO PORTAL 2 (Req 7, 8, 9) ───────────────────────
    // Steps abertos pelo `portal_submitting` quando o Portal 2 rejeita um dado
    // recuperável. Cada um valida o formato, recusa repetição do valor
    // anteriormente rejeitado (normalizado) e, no sucesso, persiste o campo +
    // re-despacha via `persistAndRedispatch`. NUNCA tocam `phone_whatsapp`.
    case "corrigir_celular_portal": {
      // Req 8.1/8.3 + 9.2: ≥10 dígitos, ≠ phone_whatsapp, ≠ valor já rejeitado.
      if (!isValidCelular(messageText)) {
        reply = "❌ Número inválido. Me envia um *celular com DDD* (pelo menos 10 dígitos), ex: 11999998888:";
        break;
      }
      if (isSameNormalized("duplicate_phone", messageText, (customer as any).phone_whatsapp)) {
        reply = "Esse é o mesmo número que você já usa aqui no WhatsApp. Me envia um *número diferente* (com DDD) pra concluir:";
        break;
      }
      if (isSameNormalized("duplicate_phone", messageText, (customer as any).portal2_celular_alt)) {
        reply = "Esse número já tentamos e não foi aceito. Me envia *outro* número de celular (com DDD):";
        break;
      }
      const _celDigits = toWhatsappCanonical(messageText);
      // ⚠️ NUNCA grava phone_whatsapp (chave única da conversa) — só o campo
      // alternativo do Portal 2 (Req 8.2/8.6, Property 2).
      updates.portal2_celular_alt = _celDigits;
      updates.phone_landline = (() => {
        const n = toNationalPhoneDigits(messageText);
        return n.length === 11
          ? n.replace(/(\d{2})(\d{5})(\d{4})/, "($1) $2-$3")
          : n.replace(/(\d{2})(\d{4})(\d{4})/, "($1) $2-$3");
      })();
      updates.phone_contact_confirmed = true;
      reply = "Perfeito! Atualizei o número e estou reenviando seu cadastro para o portal. Pode aguardar alguns instantes ✅";
      await persistAndRedispatch("duplicate_phone", maskCorrectionValueForLog("duplicate_phone", _celDigits));
      break;
    }

    case "corrigir_email_portal": {
      const _emailTxt = (messageText || "").trim();
      // Req 7.2: 1+ char antes e depois de `@`.
      if (!isValidCorrectionEmail(_emailTxt)) {
        reply = "❌ E-mail inválido. Confere o *@* e o domínio (ex: seunome@gmail.com) e me envia de novo:";
        break;
      }
      // Req 9.2: diferente do e-mail anteriormente rejeitado (trim + lowercase).
      if (isSameNormalized("duplicate_email", _emailTxt, (customer as any).email)) {
        reply = "Esse e-mail é o mesmo que já tentamos e não foi aceito. Me envia um *e-mail diferente*:";
        break;
      }
      updates.email = _emailTxt.toLowerCase();
      reply = "Show! Atualizei seu e-mail e estou reenviando seu cadastro para o portal. Pode aguardar alguns instantes ✅";
      await persistAndRedispatch("duplicate_email", maskCorrectionValueForLog("duplicate_email", _emailTxt));
      break;
    }

    case "corrigir_instalacao_portal": {
      // Req 7.7: número de instalação com ≥7 dígitos.
      if (!isValidInstallation(messageText)) {
        reply = "❌ Número inválido. O número de instalação tem pelo menos *7 dígitos* — confere na conta e me envia de novo:";
        break;
      }
      // Req 9.2: diferente do número anteriormente rejeitado (só dígitos).
      if (isSameNormalized("duplicate_installation", messageText, (customer as any).numero_instalacao)) {
        reply = "Esse número de instalação é o mesmo que já tentamos. Confere na conta e me envia um *número diferente* (7+ dígitos):";
        break;
      }
      const _instDigits = messageText.replace(/\D/g, "");
      updates.numero_instalacao = _instDigits;
      reply = "Perfeito! Atualizei o número de instalação e estou reenviando seu cadastro para o portal. Pode aguardar alguns instantes ✅";
      await persistAndRedispatch("duplicate_installation", maskCorrectionValueForLog("duplicate_installation", _instDigits));
      break;
    }

    case "corrigir_documento_portal": {
      // Documento vencido: CNH = só frente; RG = frente + verso.
      if (!isFile) {
        reply =
          "📸 Me envia um documento *dentro da validade*, bem nítido:\n\n" +
          "• *CNH* → só a *frente*\n" +
          "• *RG* → *frente e verso*\n\n" +
          "Pode começar pela *frente* (JPG, PNG ou PDF).";
        break;
      }
      const mime = (documentMessage as any)?.mimetype || (imageMessage as any)?.mimetype || "image/jpeg";
      const docFileBase64 = fileBase64 || "";
      const docFileUrl = fileUrl || "";
      if (!docFileBase64 && !docFileUrl) {
        reply = "Não consegui abrir essa foto. Pode reenviar a *frente* do RG ou CNH (JPG/PNG/PDF)?";
        break;
      }

      let detectedType: string = "outro";
      let detectConfidence = 0;
      try {
        const det = await detectDocumentTypeDetailed({
          base64: docFileBase64,
          mimeType: mime,
          imageUrl: String(docFileUrl).startsWith("http") ? docFileUrl : undefined,
          geminiApiKey,
        });
        detectedType = det.tipo;
        detectConfidence = det.confianca;
      } catch (e) {
        console.warn(`[corrigir_documento_portal] detect tipo falhou:`, (e as Error).message);
      }
      if (detectedType === "outro") {
        reply =
          "❌ Esse arquivo não parece ser um *RG* ou *CNH*.\n\n" +
          "📸 Me envia a *frente* do documento *dentro da validade* (JPG, PNG ou PDF).";
        break;
      }

      if (docFileBase64) {
        updates.document_front_url = `data:${mime};base64,${docFileBase64}`;
        updates.document_front_base64 = docFileBase64;
        updates.media_message_id = messageId || null;
        updates.media_storage = "inline";
        const _custId = customer.id;
        uploadMediaToMinio({
          fileBase64: docFileBase64, mimeType: mime, consultantFolder: consultorId, consultantName: nomeRepresentante,
          customerName: customer.name || "cliente", customerBirth: customer.data_nascimento, kind: "doc_frente",
        }).then(async (minioUrl) => {
          if (minioUrl) {
            await supabase.from("customers").update({ document_front_url: minioUrl, media_storage: "minio" }).eq("id", _custId);
          }
        }).catch((e) => console.warn(`📦⚠️ [BG] MinIO doc_frente (corrigir) falhou: ${e?.message}`));
      } else {
        updates.document_front_url = String(docFileUrl).startsWith("http") ? docFileUrl : "evolution-media:pending";
      }

      const treatAsCnh = detectedType === "cnh" && detectConfidence >= 0.55;
      updates.document_type = treatAsCnh ? "cnh" : (detectedType === "rg_novo" ? "rg_novo" : "rg_antigo");

      if (treatAsCnh) {
        updates.document_back_url = "nao_aplicavel";
        reply = "Recebi a *frente da CNH*! ✅ Estou reenviando seu cadastro — pode aguardar alguns instantes 🌱";
        await persistAndRedispatch("doc_vencido", "doc");
      } else {
        updates.document_back_url = null;
        updates.document_back_base64 = null;
        updates.conversation_step = "corrigir_documento_verso_portal";
        reply =
          "✅ Frente do RG recebida!\n\n" +
          "Agora me envia a foto do *verso* do RG (também *dentro da validade*), bem nítida 📸";
      }
      break;
    }

    case "corrigir_documento_verso_portal": {
      if (!isFile) {
        reply = "📸 Me envia agora a foto do *verso* do RG (*dentro da validade*), bem nítida. JPG, PNG ou PDF.";
        break;
      }
      const mimeBack = (documentMessage as any)?.mimetype || (imageMessage as any)?.mimetype || "image/jpeg";
      if (fileBase64) {
        updates.document_back_url = `data:${mimeBack};base64,${fileBase64}`;
        updates.document_back_base64 = fileBase64;
        updates.media_message_id = messageId || null;
        updates.media_storage = "inline";
        const _custId = customer.id;
        uploadMediaToMinio({
          fileBase64, mimeType: mimeBack, consultantFolder: consultorId, consultantName: nomeRepresentante,
          customerName: customer.name || "cliente", customerBirth: customer.data_nascimento, kind: "doc_verso",
        }).then(async (minioUrl) => {
          if (minioUrl) {
            await supabase.from("customers").update({ document_back_url: minioUrl, media_storage: "minio" }).eq("id", _custId);
          }
        }).catch((e) => console.warn(`📦⚠️ [BG] MinIO doc_verso (corrigir) falhou: ${e?.message}`));
      } else if (fileUrl) {
        updates.document_back_url = String(fileUrl).startsWith("http") ? fileUrl : "evolution-media:pending";
      } else {
        reply = "Não consegui abrir essa foto. Pode reenviar o *verso* do RG (JPG/PNG/PDF)?";
        break;
      }
      reply = "Verso recebido! ✅ Estou reenviando seu cadastro com frente e verso — pode aguardar alguns instantes 🌱";
      await persistAndRedispatch("doc_vencido", "doc");
      break;
    }


    case "aguardando_otp": {
      const otpCode = messageText.replace(/\D/g, "");
      if (otpCode.length >= 4 && otpCode.length <= 8) {
        updates.otp_code = otpCode;
        updates.otp_received_at = new Date().toISOString();
        reply = `✅ Código *${otpCode}* recebido! ⏳ Validando no portal...\n\nEm instantes vou te enviar o link da *validação facial* (última etapa).`;
        // Sprint A3: dispara submit-otp (fire-and-forget) para o worker validar de fato
        try {
          const baseUrl = Deno.env.get("SUPABASE_URL");
          const srk = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
          if (baseUrl && srk) {
            fetch(`${baseUrl}/functions/v1/submit-otp`, {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${srk}` },
              body: JSON.stringify({ customer_id: customer.id, otp_code: otpCode }),
            }).catch((e) => console.warn("[aguardando_otp] submit-otp dispatch falhou:", (e as Error).message));
          }
        } catch (e) {
          console.warn("[aguardando_otp] submit-otp dispatch erro:", (e as Error).message);
        }
      } else {
        reply = "📱 Por favor, digite o *código numérico* que você recebeu no WhatsApp.\n\n(Geralmente são 4 a 6 dígitos)";
      }
      break;
    }

    case "processando_ocr_conta": {
      // Sprint A1: evita cair no default que reseta para aguardando_conta
      reply = "⏳ Ainda estou analisando sua conta, só mais um instante...";
      break;
    }

    case "validando_otp": {
      reply = "⏳ Estamos validando seu código no portal. Aguarde um momento...\n\nSe já passou mais de 2 minutos, digite o código novamente.";
      break;
    }

    case "otp_confirmar": {
      // Paridade Whapi: resposta sim/não no intercept; fallback textual aqui.
      const { parseOtpConfirmReply, handleOtpConfirmedByClient, handleOtpDeniedByClient, resolveCodigoConfirmCopy } =
        await import("../../_shared/otp-confirm-flow.ts");
      const decision = parseOtpConfirmReply(messageText || "", buttonId || null);
      if (decision === "sim") {
        const { clientReply } = await handleOtpConfirmedByClient(supabase, {
          id: customer.id,
          name: customer.name,
          phone_whatsapp: customer.phone_whatsapp,
          consultant_id: customer.consultant_id,
          otp_code: (customer as any).otp_code,
        });
        reply = clientReply;
        break;
      }
      if (decision === "nao") {
        const { clientReply } = await handleOtpDeniedByClient(
          supabase,
          customer.id,
          customer.consultant_id,
        );
        reply = clientReply;
        updates.conversation_step = "aguardando_otp";
        updates.status = "awaiting_otp";
        break;
      }
      {
        const code = String((customer as any).otp_code || "").replace(/\D/g, "") || "???";
        const copy = await resolveCodigoConfirmCopy(supabase, customer.consultant_id, code);
        // Evolution: lista numerada (sendOptions já formata 1/2/3).
        await sendOptions(remoteJid, copy.ask, copy.buttons);
        reply = "";
      }
      break;
    }

    case "otp_falhou": {
      const otpCode = messageText.replace(/\D/g, "");
      if (otpCode.length >= 4 && otpCode.length <= 8) {
        updates.otp_code = otpCode;
        updates.otp_received_at = new Date().toISOString();
        updates.conversation_step = "aguardando_otp";
        updates.status = "awaiting_otp";
        reply = `✅ Código *${otpCode}* recebido. Vou validar novamente agora — aguarde um instante.`;
        try {
          const baseUrl = Deno.env.get("SUPABASE_URL");
          const srk = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
          if (baseUrl && srk) {
            fetch(`${baseUrl}/functions/v1/submit-otp`, {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${srk}` },
              body: JSON.stringify({ customer_id: customer.id, otp_code: otpCode }),
            }).catch((e) => console.warn("[otp_falhou] submit-otp dispatch falhou:", (e as Error).message));
          }
        } catch (e) {
          console.warn("[otp_falhou] submit-otp dispatch erro:", (e as Error).message);
        }
      } else {
        reply = "O código anterior não confirmou. Me envie o *novo código numérico* que aparecer no WhatsApp para eu validar novamente.";
      }
      break;
    }

    case "aguardando_facial":
    case "aguardando_assinatura": {
      const link = customer.link_facial || customer.link_assinatura;
      const txt = (messageText || "").toLowerCase().trim();
      const confirmou = /\b(pronto|prontinho|conclu[ií]do|conclui|conclu[ií]|finalizei|terminei|terminado|finalizado|fiz|feito|feita|ok|okay|okk?|certo|sim|j[aá]\s+(assinei|fiz|tirei|validei|terminei|terminado)|assinei|tirei|validei|selfie|liberado|consegui)\b/i.test(txt);
      // Produção: NÃO concluir facial só por texto. Watchdog/portal confirma.
      if (confirmou && link && isCustomerSandbox(customer)) {
        updates.facial_confirmed_at = new Date().toISOString();
        updates.conversation_step = "cadastro_em_analise";
        updates.status = "cadastro_concluido";
        const _firstName = safeFirstNameForAddress(customer.name, (customer as any).name_source);
        reply = `🎉 *Validação facial confirmada!*\n\nPrimeiro, parabéns ${_firstName ? _firstName + " " : ""}por dar esse passo rumo à economia! 💚\n\nSeu cadastro foi enviado para a equipe da *iGreen Energy* e agora entra na fila de análise.\n\n⏳ A aprovação costuma sair em *24 a 48 horas úteis*.\n\nAssim que estiver aprovado eu te aviso por aqui com os próximos passos. Pode relaxar — daqui em diante é com a gente. ☀️`;
      } else if (confirmou && link && !isCustomerSandbox(customer)) {
        reply = "Recebi ✅ Estou aguardando a *confirmação oficial* da validação facial no portal.\n\nAssim que o sistema liberar, eu te aviso por aqui — não precisa mandar de novo.";
      } else if (link) {
        reply = "📸 *Última etapa: Validação Facial*\n\n👉 Abra este link no seu celular e siga as instruções:\n" + `${link}\n\n` + "Quando terminar a selfie, *aguarde a confirmação automática* por aqui. Se demorar, me avisa que eu checo o status. ✅";
      } else {
        reply = "⏳ Estamos preparando o link da validação facial. Você será notificado em instantes!";
      }
      break;
    }

    case "cadastro_em_analise": {
      // F15: áudio/texto livre enquanto espera portal — ack curto
      {
        const rawIn = String(messageText || "").trim();
        const otpLike = /^\d{4,8}$/.test(rawIn.replace(/\s/g, ""));
        if (!otpLike && (rawIn || isFile)) {
          reply = "Recebi sim ✅ Estou finalizando seu cadastro no portal — assim que sair o código ou o link, eu te aviso por aqui.";
          break;
        }
      }

      // Guarda: nunca fingir "em análise" se OTP ainda pendente (caso Osmar).
      {
        const st = String(customer.status || "");
        if (st === "awaiting_otp" || st === "portal_submitting" || st === "validating_otp") {
          updates.conversation_step = "aguardando_otp";
          reply =
            "📱 Ainda estamos aguardando o *código de verificação* que a iGreen enviou no WhatsApp.\n\n" +
            "Quando chegar, *digite o código aqui* (4 a 6 dígitos).";
          break;
        }
        if (
          (st === "awaiting_signature" || st === "awaiting_facial") &&
          ((customer as any).link_facial || (customer as any).link_assinatura) &&
          !(customer as any).facial_confirmed_at
        ) {
          updates.conversation_step = "aguardando_facial";
          const link = (customer as any).link_facial || (customer as any).link_assinatura;
          reply =
            "📸 *Última etapa: Validação Facial*\n\n👉 Abra este link no seu celular e siga as instruções:\n" +
            `${link}\n\n` +
            "Quando terminar a selfie, me responda *PRONTO* aqui que finalizamos seu cadastro! ✅";
          break;
        }
      }
      // Lead já concluiu a selfie. Aguardando aprovação da iGreen (24-48h).
      // Não voltar para aguardando_conta nem reiniciar fluxo. Só responder educadamente.
      const _firstName = safeFirstNameForAddress(customer.name, (customer as any).name_source);
      reply = `Oi${_firstName ? " " + _firstName : ""}! 💚 Seu cadastro ainda está em análise pela equipe da *iGreen Energy*.\n\n⏳ O prazo de aprovação é de *24 a 48 horas úteis* — assim que sair, eu te aviso aqui mesmo.\n\nSe precisar de qualquer coisa enquanto isso, é só chamar! ☀️`;
      break;
    }

    case "complete": {
      // Mensagem padrão se a admin não tiver configurado um passo "finalizar_cadastro"
      // no FluxoCamila. Se tiver, usa o message_text do passo dela.
      let parabens = "✅ Seus dados já foram registrados! Se precisar de algo, um consultor entrará em contato. ☀️";
      try {
        const flow = await resolveFlowId(supabase, customer.consultant_id || consultorId, (customer as any)?.flow_variant || "A");
        if (flow?.id) {
          const { data: passo } = await supabase
            .from("bot_flow_steps")
            .select("message_text")
            .eq("flow_id", flow.id)
            .eq("step_type", "finalizar_cadastro")
            .eq("is_active", true)
            .order("position", { ascending: true })
            .limit(1).maybeSingle();
          const txt = (passo?.message_text || "").trim();
          if (txt) {
            parabens = renderTemplateVars(txt, {
              name: customer.name || "",
              name_source: (customer as any).name_source,
              representante: nomeRepresentante || "",
            });
          }
        }
      } catch (e) {
        console.warn("[complete] busca de passo finalizar_cadastro falhou:", (e as Error).message);
      }
      reply = parabens;
      break;
    }

    default: {
      // Se o consultor tem fluxo custom ativo, NUNCA reseta para aguardando_conta:
      // tenta redispatch idempotente do passo atual e mantém. Evita derrubar
      // o lead pro Passo 1 quando o resolver não conseguiu mapear o step.
      if (step?.startsWith("editing_")) {
        reply = "❌ Opção inválida. Digite novamente:";
      } else {
        let hasCustomFlow = false;
        try {
          const flow = await resolveFlowId(supabase, customer.consultant_id, (customer as any)?.flow_variant || "A");
          hasCustomFlow = !!flow?.id;
        } catch (_) { /* noop */ }

        if (hasCustomFlow) {
          console.warn(`⚠️ Step "${step}" não roteado — fluxo custom ativo, redispatching idempotente`);
          const ok = await dispatchStepFromFlow(step).catch(() => false);
          (updates as any).__inline_sent = ok || true;
          reply = "";
        } else {
          // F2 — strict mode: não reseta para aguardando_conta nem manda welcome
          // genérico. Mantém step atual; consultor deve cuidar manualmente.
          const _strict = await isResolverStrictMode(supabase).catch(() => false);
          if (_strict) {
            console.warn(`[resolver:strict] step "${step}" sem mapeamento e sem custom flow — mantendo step, sem reply`);
            (updates as any).__inline_sent = true;
            reply = "";
          } else {
            console.warn(`⚠️ Step desconhecido: ${step} — resetando para aguardando_conta`);
            updates.conversation_step = "aguardando_conta";
            reply = `Perfeito! 🙌\n\n📸 Me envia agora uma *foto da sua conta de luz* (fatura do mês atual ou a anterior).💚`;
          }
        }
      }
      break;
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // AUTO-FINALIZAÇÃO (BLOCO ESPECIAL — extraído verbatim do index.ts antigo)
  // ═══════════════════════════════════════════════════════════════════
  if (updates.conversation_step === "finalizando") {
    Object.assign(updates, sofiaCadastroPersistPatch({ ...customer, ...updates }));

    // Gate: não finaliza sem escolha de boleto (unificado ⇔ transferir titularidade)
    {
      const pref = missingPreferenceStep({ ...customer, ...updates });
      if (pref) {
        updates.conversation_step = pref;
        const msg = getReplyForStep(pref, { ...customer, ...updates });
        const opts = getPreferenceOptions(pref) || [];
        const sent = await sendOptions(remoteJid, msg, [...opts]);
        if (!sent) reply = msg;
        else reply = "";
        return { reply, updates };
      }
    }

    // ── AUTO-CONFIRM: Se o cliente chegou até aqui pelo WhatsApp e tem telefone válido,
    // garantir que phone_contact_confirmed=true e phone_landline está preenchido.
    // Evita o bug do Valdeir onde o campo não existia na época do cadastro.
    if (!customer.phone_contact_confirmed && !updates.phone_contact_confirmed) {
      const num = toNationalPhoneDigits(customer.phone_whatsapp || phone || "");
      const land = formatBrLandline(num);
      if (land) {
        updates.phone_contact_confirmed = true;
        updates.phone_landline = land;
        updates.portal2_celular_alt = toWhatsappCanonical(num);
        console.log(`📞 [AUTO-CONFIRM] Telefone auto-confirmado para finalização: ${updates.phone_landline}`);
      }
    }

    // Carregar dados do consultor dono para validação reforçada
    let consultantRow: any = null;
    try {
      const { data: c } = await supabase
        .from("consultants")
        .select("id, phone, igreen_portal_email, cadastro_url, igreen_id")
        .eq("id", customer.consultant_id || consultorId)
        .maybeSingle();
      consultantRow = c;
    } catch (_) { /* segue sem checar */ }

    const merged = {
      ...customer,
      ...updates,
      // Injeta dados do consultor para que validateCustomerForPortal possa comparar
      consultant_email: consultantRow?.igreen_portal_email || null,
      consultant_phone: consultantRow?.phone || null,
    };

    // ── ViaCEP antes de validar: se tem CEP mas falta cidade/UF/bairro, completa.
    // Evita o loop "CEP inválido → ask_name" (caso Salto 19/07).
    {
      const cepDigits = String(merged.cep || "").replace(/\D/g, "");
      const needsGeo = !merged.address_city || !merged.address_state ||
        !merged.address_neighborhood || !merged.address_street;
      if (cepDigits.length === 8 && needsGeo) {
        try {
          const viaCep = await buscarEnderecoPorCep(cepDigits);
          if (viaCep) {
            if (!merged.address_street && viaCep.logradouro) {
              merged.address_street = viaCep.logradouro;
              updates.address_street = viaCep.logradouro;
            }
            if (!merged.address_neighborhood && viaCep.bairro) {
              merged.address_neighborhood = viaCep.bairro;
              updates.address_neighborhood = viaCep.bairro;
            }
            if (!merged.address_city && viaCep.localidade) {
              merged.address_city = viaCep.localidade;
              updates.address_city = viaCep.localidade;
            }
            if (!merged.address_state && viaCep.uf) {
              merged.address_state = viaCep.uf;
              updates.address_state = viaCep.uf;
            }
            updates.cep = cepDigits;
            merged.cep = cepDigits;
            console.log(
              `[finalize:viacep] customer=${customer.id} city=${viaCep.localidade}/${viaCep.uf}`,
            );
          }
        } catch (e) {
          console.warn("[finalize:viacep] falhou:", (e as Error)?.message);
        }
      }
    }

    let validation = validateCustomerForPortal(merged);
    if (!validation.valid) {
      logStructured("warn", "validation_failed", {
        customer_id: customer.id, step: "finalizando", errors: validation.errors,
      });
      
      // ── ANTI-LOOP: Só escala para humano após 3+ redirecionamentos (era 1) ──
      // Com threshold 1, qualquer dado faltante (ex.: complemento nunca perguntado)
      // gerava handoff prematuro. 3+ garante que demos chance real ao lead de completar.
      const redirectCount = customer.rescue_attempts || 0;
      if (redirectCount >= 3) {
        console.warn(`⚠️ [ANTI-LOOP] ${customer.id} já foi redirecionado ${redirectCount}x. Escalando para humano.`);
        logStructured("warn", "force_finalize_after_redirects", {
          customer_id: customer.id, errors: validation.errors, redirects: redirectCount,
        });
        // Sprint C2: em vez de ficar mudo ou seguir pro portal com lixo, escala pra humano com diagnóstico
        updates.bot_paused = true;
        updates.bot_paused_reason = "dados_incompletos_pos_loop";
        updates.bot_paused_at = new Date().toISOString();
        updates.conversation_step = "aguardando_humano";
        try {
          await supabase.from("bot_handoff_alerts").insert({
            customer_id: customer.id,
            consultant_id: customer.consultant_id || consultorId,
            reason: "dados_incompletos_pos_loop",
            metadata: { errors: validation.errors, redirects: redirectCount },
          });
        } catch (e) { console.warn("[anti-loop] handoff alert falhou:", (e as Error).message); }
        reply = "Vou te encaminhar para um consultor humano para finalizarmos com calma. Em instantes alguém te responde por aqui. 👋";
        return { reply, updates };
      } else {
        updates.rescue_attempts = redirectCount + 1;
        
        let redirected = false;
        // Endereço incompleto (CEP/cidade/UF/rua/bairro/número) → NUNCA ask_name
        const addrRedirect = addressValidationRedirect(validation.errors);
        if (addrRedirect) {
          updates.previous_conversation_step = "finalizando";
          updates.conversation_step = addrRedirect.step;
          reply = addrRedirect.reply;
          redirected = true;
          console.log(
            `[finalize:addr-redirect] customer=${customer.id} → ${addrRedirect.step} errors=${validation.errors.join("|")}`,
          );
        }
        for (const err of validation.errors) {
          if (redirected) break;
        // ── Email: placeholder, formato, consultor, ou ausente → volta a perguntar ──
        if (err.includes("Email")) {
          updates.conversation_step = "ask_email";
          reply = `⚠️ ${err}\n\nMe manda um e-mail *seu*, diferente do consultor — pode ser qualquer provedor:`;
          redirected = true; break;
        }
        // ── Telefone não confirmado / placeholder / DDD inválido / do consultor ──
        if (err.includes("Telefone") || err.includes("telefone")) {
          updates.conversation_step = "ask_phone_confirm";
          reply = `⚠️ ${err}\n\nPreciso confirmar seu telefone de contato. Aguarde a próxima mensagem...`;
          redirected = true; break;
        }
        if (err.includes("CPF")) { updates.conversation_step = "ask_cpf"; reply = `⚠️ ${err}\n\nQual o seu *CPF*? (apenas números)`; redirected = true; break; }
        if (err.includes("RG")) { updates.conversation_step = "ask_rg"; reply = `⚠️ ${err}\n\nQual o seu *RG*?`; redirected = true; break; }
        // CEP/Cidade/Estado/Endereço/Número/Bairro já tratados por addressValidationRedirect
        if (err.includes("CEP") || err.includes("Cidade") || err.includes("Estado") ||
            err.includes("rua") || err.includes("Endereço") || err.includes("Bairro") ||
            err.includes("Número")) {
          continue;
        }
        if (err.includes("Valor")) { updates.conversation_step = "ask_bill_value"; reply = `⚠️ ${err}\n\nQual o *valor* da sua conta de luz?`; redirected = true; break; }
        if (err.includes("Distribuidora")) { updates.conversation_step = "ask_distribuidora"; reply = `⚠️ ${err}\n\nQual a *distribuidora* da sua conta de luz? (ex: CPFL, Enel, Cemig)`; redirected = true; break; }
        if (err.includes("instalação") || err.includes("instalacao")) { updates.conversation_step = "ask_installation_number"; reply = `⚠️ ${err}\n\nQual o *número da instalação* da conta? (Campo "Seu Código", 7+ dígitos)`; redirected = true; break; }
        if (err.includes("Foto da conta")) { updates.conversation_step = "aguardando_conta"; reply = `⚠️ ${err}\n\n📸 Envie a foto da conta de energia:`; redirected = true; break; }
        if (err.includes("Documento") && err.includes("frente")) { updates.conversation_step = "ask_doc_frente_manual"; reply = `⚠️ ${err}\n\n📸 Envie a frente do documento:`; redirected = true; break; }
        if (err.includes("Documento") && err.includes("verso")) { updates.conversation_step = "ask_doc_verso_manual"; reply = `⚠️ ${err}\n\n📸 Envie o verso do documento:`; redirected = true; break; }
        if (err.includes("Nome")) { updates.conversation_step = "ask_name"; reply = `⚠️ ${err}\n\nQual é o seu *nome completo*?`; redirected = true; break; }
      }
      if (!redirected) {
        // Último recurso: endereço completo — NUNCA ask_name genérico
        const firstError = validation.errors[0] || "Dados incompletos";
        const nextMissing = getNextMissingStep(merged);
        if (nextMissing && nextMissing !== "ask_finalizar" && nextMissing !== "finalizando" && nextMissing !== "ask_name") {
          updates.conversation_step = nextMissing;
          reply = `⚠️ ${firstError}\n\n` + getReplyForStep(nextMissing, merged);
        } else {
          updates.previous_conversation_step = "finalizando";
          updates.conversation_step = "editing_conta_endereco";
          reply = FINALIZE_ADDRESS_PROMPT;
        }
      }
      // Se o passo redirecionado for ask_phone_confirm, reenviar os botões aqui
      if (updates.conversation_step === "ask_phone_confirm") {
        const msgConfirm = getReplyForStep("ask_phone_confirm", { ...merged, phone_whatsapp: phone });
        await sendOptions(remoteJid, msgConfirm, [
          { id: "sim_phone", title: "✅ Sim, é meu" },
          { id: "editar_phone", title: "✏️ Usar outro número" },
        ]);
        reply = "";
      }
      } // fecha else do anti-loop
    } else {
      updates.possui_procurador = false;
      updates.conta_pdf_protegida = false;
      updates.debitos_aberto = false;
      updates.status = "portal_submitting";
      updates.conversation_step = "portal_submitting";

      // Blindagem final: se o OCR/revisão não gravou consumo médio, estima pelo
      // valor da conta antes de montar o payload do Portal 2.
      {
        const mediaAtual = Number((updates as any).media_consumo ?? (customer as any).media_consumo ?? 0);
        const valorConta = Number((updates as any).electricity_bill_value ?? (customer as any).electricity_bill_value ?? 0);
        if ((!Number.isFinite(mediaAtual) || mediaAtual < 50) && Number.isFinite(valorConta) && valorConta >= 30) {
          updates.media_consumo = Math.max(100, Math.min(2000, Math.round(valorConta / 1.10)));
          console.log(`⚡ media_consumo final estimado=${updates.media_consumo} kWh (valor=R$${valorConta})`);
        }
      }

      if (isTestMode()) {
        reply = "✅ *Teste concluído:* todos os dados foram coletados e o lead chegou ao ponto de envio para o portal.";
        return { reply, updates };
      }

      // ✅ Regenerar igreen_link:
      //   - cli = consultor abonador → vira ?id= (abona no lugar do dono)
      //   - partner_igreen_id = cliente cashback → vira &cli=
      if (consultantRow?.igreen_id) {
        let idBase = String(consultantRow.igreen_id);
        let partnerCli: string | null = null;
        if ((customer as any).referral_partner_id) {
          try {
            const { data: partner } = await supabase
              .from("referral_partners")
              .select("cli, partner_igreen_id")
              .eq("id", (customer as any).referral_partner_id)
              .maybeSingle();
            const abonador = Number(String((partner as any)?.cli ?? "").replace(/\D/g, "")) || 0;
            const clienteCashback =
              Number(String((partner as any)?.partner_igreen_id ?? "").replace(/\D/g, "")) || 0;
            if (abonador > 0) idBase = String(abonador);
            if (clienteCashback > 0 && String(clienteCashback) !== idBase) {
              partnerCli = String(clienteCashback);
            }
          } catch (_) { /* segue sem cli */ }
        }
        updates.igreen_link = buildCadastroLink(idBase, partnerCli);
        console.log(`🔗 igreen_link regenerado: id=${idBase}${partnerCli ? ` + cashback_cli=${partnerCli}` : ""}`);
      } else if (consultantRow?.cadastro_url) {
        updates.igreen_link = consultantRow.cadastro_url;
        console.log(`🔗 igreen_link regenerado para consultor dono: ${consultantRow.id}`);
      }

      console.log(`📝 Salvando updates ANTES do portal worker para ${customer.id}:`, JSON.stringify(updates).substring(0, 500));
      const { error: saveError } = await supabase.from("customers").update(updates).eq("id", customer.id).select();
      if (saveError) console.error(`❌ ERRO ao salvar updates antes do portal:`, saveError);

      if (isSofiaMulticanalCustomer({ ...customer, ...updates })) {
        try {
          const _first = safeFirstNameForAddress(merged.name, (merged as any).name_source);
          const ok = await dispatchStepFromFlow("a10_portal_otp_facial", {
            "{nome}": _first,
            "{{nome}}": _first,
            "{representante}": nomeRepresentante || "",
            "{{representante}}": nomeRepresentante || "",
          });
          if (ok) (updates as any).__inline_sent = true;
        } catch (e) {
          console.warn("[sofia-a10] dispatchStepFromFlow falhou:", (e as Error)?.message || e);
        }
      }

      if (!(updates as any).__inline_sent) {
      // Aviso ao lead SÓ depois do dispatch OK — nunca prometer OTP com docs/worker falhando.
      }

      console.log(`✅ Lead completo: ${merged.name} (${merged.id}) - disparando worker-portal`);

      // Roteamento + retry + payload Portal2 fica no helper compartilhado.
      // Sempre Portal Worker 2 (autoconexao). portal_kind legado é ignorado.
      try {
        const { dispatchPortalWorker } = await import("../../_shared/portal-worker.ts");
        const dr = await dispatchPortalWorker(supabase, customer.id);
        logStructured("info", "lead_complete", {
          customer_id: customer.id,
          step: "data_complete",
          worker: dr.worker || "unknown",
          mode: dr.mode,
          status: dr.status,
        });
        if (dr.ok) {
          if (!(updates as any).__inline_sent) {
            await sendText(remoteJid,
              "✅ *Todos os dados coletados com sucesso!* 🎉\n\n" +
              "⏳ Estamos processando seu cadastro no portal...\n\n" +
              "📱 Em breve você receberá um *código de verificação no WhatsApp*. Quando receber, *digite aqui*!"
            );
          }
        } else if (dr.error === "missing_documents") {
          console.warn(`[lead_complete] docs ilegíveis customer=${customer.id} — sem aviso de OTP`);
          if (!(updates as any).__inline_sent) {
            try {
              await sendText(remoteJid,
                "Recebi seus dados, mas preciso que você *reenvie a conta de luz e o documento* (foto nítida) pra eu concluir o cadastro. Pode mandar de novo?"
              );
            } catch (_) {}
          }
        } else if (dr.mode !== "not_configured") {
          try {
            await sendText(remoteJid,
              "⏳ Estamos com um pequeno atraso no processamento. Em até *alguns minutos* você receberá o link para continuar pelo celular.\n\n" +
              "Se não receber em *10 minutos*, responda aqui que verificamos para você. Obrigado!"
            );
          } catch (_) {}
        }
      } catch (e: any) {
        logStructured("error", "worker_portal_dispatch_failed", { customer_id: customer.id, error: e?.message });
        console.error("⚠️ Erro ao disparar worker-portal:", e?.message);
        await supabase.from("customers").update({
          status: "worker_offline",
          error_message: `Dispatch falhou: ${(e?.message || "").substring(0, 200)}`,
        }).eq("id", customer.id);
        try {
          await sendText(remoteJid,
            "⏳ Estamos com um pequeno atraso no processamento. Em até *alguns minutos* você receberá o link para continuar pelo celular.\n\n" +
            "Se não receber em *10 minutos*, responda aqui que verificamos para você. Obrigado!"
          );
        } catch (_) {}
      }

      // Updates ja foram salvos acima — limpar para o caller nao salvar de novo
      for (const k of Object.keys(updates)) delete updates[k];
      // Marcar que o handler já enviou mensagem inline (evita fallback "Estou aqui!")
      updates.__inline_sent = true;
      reply = "";
    }
  }

  // 📝 Evolution NÃO usa botão (botões reais só no Whapi). Em vez disso,
  // a pergunta é enviada como texto natural; o parser de captura aceita
  // "sim", "é meu", "outro número", "adicionar", "pular", "não tem", etc.
  try {
    const nextStep = (updates as any)?.conversation_step;
    if (reply && nextStep === "ask_phone_confirm") {
      const txt = `${reply}\n\nResponda *sim* se eu posso usar esse número, ou me envie *o outro número* (com DDD).`;
      const sent = await sendText(remoteJid, txt);
      if (sent) { reply = ""; (updates as any).__inline_sent = true; }
    } else if (reply && nextStep === "ask_complement") {
      const txt = `${reply}\n\nSe tiver complemento (apto, bloco, casa, fundos…), me envie agora. Se *não tem* ou quiser pular, responda *pular*.`;
      const sent = await sendText(remoteJid, txt);
      if (sent) { reply = ""; (updates as any).__inline_sent = true; }
    }
  } catch (e) {
    console.warn("[bot-flow] inline-question wrapper falhou:", (e as any)?.message);
  }


  return { reply, updates };
}

// ── Test-only re-exports (não alteram comportamento) ──
export const __test = { sleepForMedia, fetchUrlToBase64, trigramSim, resolveOcrFallback, resolvePostBillNextStepId, stepHasInteractiveWait };

