// Main bot state machine — extracted verbatim from the giant switch in index.ts.
// All conversation steps live here. Receives a BotContext and returns
// { reply, updates }. The caller persists updates and sends reply.
//
// Behavior is identical to the previous inline version. Only structural change:
// the closure variables are now properties of `ctx`.

import {
  validateCustomerForPortal,
  isPlaceholderEmail,
  isValidEmailFormat,
  isSameContact,
} from "../../_shared/validators.ts";
import { isResolverStrictMode } from "../../_shared/bot/global-flag.ts";
import {
  fetchWithTimeout,
  fetchInsecure,
  withRetry,
  buscarCepPorEndereco,
  normalizePhone,
  TIMEOUT_VIA_CEP,
  logStructured,
} from "../../_shared/utils.ts";
import { getStepMediaOrder, makeKindComparator } from "../../_shared/step-media-order.ts";
import { canSendMediaOnce } from "../../_shared/media-dedupe.ts";
import { buildCadastroLink } from "../../_shared/keyword-matcher.ts";
import {
  getReplyForStep,
  getNextMissingStep,
  validarCPFDigitos,
  RE_INTENT_CADASTRAR,
  RE_INTENT_HUMANO,
  RE_INTENT_RESET,
  TRUSTED_NAME_SOURCES,
  resetLeadIdentity,
  detectQuestionIntent,
} from "../../_shared/conversation-helpers.ts";
import { matchQA } from "./conversational/index.ts";
import { getTemplate } from "./conversational/templates.ts";
import { extractMultiField, buildMultiFieldPatch } from "../../_shared/multi-field-extractor.ts";
import { detectFlowSwitch } from "../../_shared/flow-router.ts";
import { ocrContaEnergia, ocrDocumentoFrenteVerso } from "../../_shared/ocr.ts";
import { normalizeDocumentType, isCNH, friendlyLabel } from "../../_shared/document-type.ts";
import { detectDocumentType } from "../../_shared/detect-doc-type.ts";
import { uploadMediaToMinio, OCR_CONFIDENCE_THRESHOLD } from "../_helpers.ts";
import { jsonLog } from "../../_shared/audit.ts";
import { isTestMode } from "../../_shared/test-mode.ts";
import { notifyHandoff } from "../../_shared/notify-consultant.ts";
import { recordFlowDAlert } from "../../_shared/captation/flow-d-alerts.ts";
import type { BotContext, BotResult } from "./types.ts";

// Trigrama similarity para anti-loop (0..1)
function trigramSim(a: string, b: string): number {
  const norm = (s: string) => (s || "").toLowerCase().replace(/[^a-zà-ú0-9 ]/gi, "").replace(/\s+/g, " ").trim();
  const A = norm(a), B = norm(b);
  if (!A || !B) return 0;
  if (A === B) return 1;
  const trig = (s: string) => {
    const set = new Set<string>();
    const p = `  ${s}  `;
    for (let i = 0; i < p.length - 2; i++) set.add(p.slice(i, i + 3));
    return set;
  };
  const ta = trig(A), tb = trig(B);
  let inter = 0;
  ta.forEach((t) => { if (tb.has(t)) inter++; });
  return inter / Math.max(ta.size, tb.size);
}

// ── Sleep based on media duration (lets audio finish before sending video) ──
async function sleepForMedia(kind: string, durationSec?: number | null): Promise<void> {
  if (isTestMode()) return; // 🧪 modo teste: zero espera entre mídias
  if (kind === "audio") {
    const ms = Math.min(((durationSec && durationSec > 0) ? durationSec : 90) * 1000, 120_000);
    await new Promise((r) => setTimeout(r, ms));
    return;
  }
  if (kind === "video") {
    const ms = Math.min(((durationSec && durationSec > 0) ? durationSec : 30) * 1000, 90_000);
    await new Promise((r) => setTimeout(r, ms));
    return;
  }
  await new Promise((r) => setTimeout(r, 1500));
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

/**
 * Resolve fallback de OCR a partir do step configurado no Flow Builder.
 *
 * **Fonte canônica:** este helper é espelhado byte-for-byte de
 * `supabase/functions/whapi-webhook/handlers/bot-flow.ts` (linhas ~110-163).
 * Ambos os webhooks DEVEM manter implementação idêntica — qualquer alteração
 * aqui precisa ser replicada no Whapi (e vice-versa) para preservar
 * comportamento entre canais (ver Requirement 2.5 do spec
 * `flow-d-retry-rules-fix`).
 *
 * Lê o campo `fallback` do bot_flow_step atual (`capture_conta` /
 * `capture_documento`) e retorna o `retry_text` configurado pelo consultor,
 * ou o `defaultRetryText` se não houver. Quando `then === "humano"` e as
 * tentativas esgotaram, sinaliza `escalate = true` para o caller pausar o
 * bot e disparar handoff.
 */
// ── Resolve fallback de OCR a partir do step configurado no Flow Builder ──
// Lê o campo `fallback` do bot_flow_step atual (capture_conta / capture_documento)
// e retorna o retry_text configurado pelo consultor, ou null se não houver.
// Quando `then === "humano"` e as tentativas esgotaram, pausa o bot.
interface OcrFallbackResult {
  retryText: string;
  escalate: boolean; // true = pausa bot + notifica consultor
}
async function resolveOcrFallback(
  supabase: any,
  customerId: string,
  consultantId: string | null | undefined,
  stepType: "capture_conta" | "capture_documento",
  attempts: number,
  defaultRetryText: string,
  flowVariant?: string | null,
): Promise<OcrFallbackResult> {
  try {
    if (!consultantId) return { retryText: defaultRetryText, escalate: false };
    const variant = String(flowVariant || "A").toUpperCase();
    // Busca o fluxo ativo DA variante correta (A/B/C/D) — sem isso herdaria
    // fallback de outra variante e estouraria com multiple rows.
    let flowQ = supabase
      .from("bot_flows").select("id")
      .eq("consultant_id", consultantId).eq("is_active", true)
      .eq("variant", variant)
      .order("created_at", { ascending: true }).limit(1);
    let { data: flow } = await flowQ.maybeSingle();
    if (!flow?.id) {
      // Fallback: primeiro fluxo ativo do consultor (legado, sem variante)
      const { data: anyFlow } = await supabase
        .from("bot_flows").select("id")
        .eq("consultant_id", consultantId).eq("is_active", true)
        .order("created_at", { ascending: true }).limit(1).maybeSingle();
      flow = anyFlow;
    }
    if (!flow?.id) return { retryText: defaultRetryText, escalate: false };
    const { data: stepRow } = await supabase
      .from("bot_flow_steps").select("fallback")
      .eq("flow_id", flow.id).eq("step_type", stepType).eq("is_active", true)
      .order("position", { ascending: true }).limit(1).maybeSingle();
    const fb = (stepRow as any)?.fallback;
    if (!fb || fb.mode !== "retry") return { retryText: defaultRetryText, escalate: false };
    const maxRetries = Math.max(1, Number(fb.max_retries ?? 2));
    const retryText = String(fb.retry_text || defaultRetryText);
    const escalate = attempts >= maxRetries && String(fb.then || "") === "humano";
    return { retryText, escalate };
  } catch (e) {
    console.warn("[resolveOcrFallback] erro:", (e as any)?.message);
    return { retryText: defaultRetryText, escalate: false };
  }
}

// ── Auto-resolve CEP from address data (avoid asking user) ──
async function autoResolveCepIfNeeded(merged: any, updates: any): Promise<string> {
  let step = getNextMissingStep(merged);
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
  return step;
}

// ── Quick HEAD check to confirm a media URL is reachable before sending ──
async function urlExists(url: string): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3000);
    const r = await fetch(url, { method: "HEAD", signal: ctrl.signal });
    clearTimeout(timer);
    return r.ok;
  } catch {
    return false;
  }
}

const NON_NAME_RESPONSES = /^(oi|ola|olá|hey|opa|bom dia|boa tarde|boa noite|sim|nao|não|ok|tudo bem|pode|quero|cadastrar|humano|atendente|menu|reset|recomecar|recomeçar|nao sou eu|não sou eu|como funciona|me explica|o que é|que é isso|quanto custa|é caro|preço|valor|tem taxa|minha distribuidora|qual distribuidora|atende aqui|cidade)$/i;
const RE_GREETING_ONLY = /^(oi|ol[aá]|opa|bom dia|boa tarde|boa noite|hey)$/i;
// Reapresentação: "me chamo X", "meu nome é X", "sou (a|o) X", "aqui (é|eh) (a|o) X", "(eu )?sou X" — captura o primeiro nome.
const RE_SELF_INTRO = /(?:me\s+chamo|meu\s+nome\s+(?:é|eh|e)|aqui\s+(?:é|eh|e)\s+(?:o|a)|(?:eu\s+)?sou\s+(?:o|a))\s+([A-Za-zÀ-ÖØ-öø-ÿ]{2,30})/i;
// Lead recusa mandar foto da conta — aceita seguir sem.
const RE_REFUSE_BILL = /\b(n[aã]o\s+(?:tenho|quero|posso|vou)\s+(?:mandar|enviar|tirar|mostrar)|sem\s+(?:foto|conta|comprovante)|n[aã]o\s+(?:tenho|achei)\s+a\s+conta|conta\s+(?:n[aã]o|nao)\s+est[aá]\s+aqui|s[oó]\s+(?:o\s+)?valor)\b/i;

function isPositiveCheckinIntent(text: string): boolean {
  return /^(sim|s|ss+|joia|ok|okay|blz|beleza|perfeito|quero|pode|vamos|bora|seguir|claro|certo|tranquilo|entendi|deu|show|fechou)\b/i.test(text) || /[👍✅]/.test(text);
}

function isClubProgressIntent(text: string): boolean {
  return isPositiveCheckinIntent(text) || /^(pode seguir|sem duvida|nenhuma|nao tenho|não tenho|nao|não|tudo certo|partiu|segue)\b/i.test(text) || /(quero|vamos|bora).*(cadastr|seguir|finaliz)/i.test(text);
}

function normalizeLeadName(rawText: string | null | undefined): string | null {
  const raw = String(rawText || "").trim().replace(/[.!?,;:"']/g, "").replace(/\s+/g, " ");
  const looksLikeName =
    raw.length >= 2 &&
    raw.length <= 60 &&
    /^[A-Za-zÀ-ÖØ-öø-ÿ' ]+$/.test(raw) &&
    raw.split(/\s+/).length <= 4 &&
    !NON_NAME_RESPONSES.test(raw);
  if (!looksLikeName) return null;
  return raw
    .toLowerCase()
    .split(/\s+/)
    .map((w) => (w.length > 2 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

function isBogusCapturedName(name: string | null | undefined): boolean {
  if (!name) return false;
  return NON_NAME_RESPONSES.test(String(name).trim());
}

function buildNotReadyReply(nomeRepresentante: string): string {
  return `Sem problema, vou respeitar seu tempo 😊\n\nSe quiser continuar depois, é só mandar *cadastrar* ou chamar ${nomeRepresentante}.`;
}

// ───────────────────────────────────────────────────────────────
// Anti-alucinação: nome OCR só sobrescreve nome confirmado se for muito similar
// ───────────────────────────────────────────────────────────────
const RG_HEADER_TERMS = /REP[ÚU]BLICA|FEDERATIVA|CARTEIRA|IDENTIDADE|MINIST[ÉE]RIO|NACIONAL|SECRETARIA|SEGURAN[ÇC]A|INSTITUTO|DETRAN|VALIDA EM TODO|REGISTRO GERAL/i;

function _normName(s: string): string {
  return String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();
}
function _levSim(a: string, b: string): number {
  a = _normName(a); b = _normName(b);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const m = a.length, n = b.length;
  const dp: number[] = Array(n + 1).fill(0).map((_, i) => i);
  for (let i = 1; i <= m; i++) {
    let prev = i - 1; dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return 1 - dp[n] / Math.max(m, n);
}

/**
 * Fontes de nome consideradas "confiáveis" — uma vez setado, só pode ser
 * sobrescrito por confirmação explícita do usuário (editing_* / user_confirmed).
 */
const TRUSTED_NAME_SOURCES_LOCK = new Set(["user_confirmed", "ocr_conta", "ocr_doc"]);

/**
 * Verifica se dois nomes (conta de luz × RG) representam a mesma pessoa.
 * Match se similaridade ≥ 0.85 ou se primeiro+último nome coincidem.
 */
export function checkHolderMatch(billName: string | null | undefined, docName: string | null | undefined): { match: boolean; similarity: number; reason: string } {
  const a = _normName(String(billName || ""));
  const b = _normName(String(docName || ""));
  if (!a || !b) return { match: true, similarity: 1, reason: "missing_one_side" };
  const sim = _levSim(a, b);
  const partsA = a.split(/\s+/);
  const partsB = b.split(/\s+/);
  const firstLastMatch = partsA[0] === partsB[0] && partsA[partsA.length - 1] === partsB[partsB.length - 1];
  const match = sim >= 0.85 || firstLastMatch;
  return { match, similarity: sim, reason: `sim=${sim.toFixed(2)} firstLast=${firstLastMatch}` };
}

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
    if (_levSim(currentName, cleaned) < 0.7) {
      console.warn(`[name-lock] OCR rejeitado por baixa similaridade: atual="${currentName}" novo="${cleaned}" sim=${_levSim(currentName, cleaned).toFixed(2)}`);
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
  opts: { afterPosition?: number; stepType?: string; stepTypeIn?: string[] } = {},
): Promise<{ id: string; step_key: string; step_type: string; position: number; transitions: any[]; message_text: string; slot_key: string | null } | null> {
  if (!consultantId) return null;
  try {
    const { data: flow } = await supabase
      .from("bot_flows").select("id")
      .eq("consultant_id", consultantId).eq("is_active", true).eq("variant", "A").maybeSingle();
    if (!flow?.id) return null;
    let q = supabase.from("bot_flow_steps")
      .select("id, step_key, step_type, position, transitions, message_text, slot_key")
      .eq("flow_id", (flow as any).id).eq("is_active", true)
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
    case "ask_bill_value":
    case "editing_conta_valor":
      return /^[r\$\s]*\d{2,6}([\.,]\d{1,2})?\s*$/i.test(t);
    case "ask_installation_number":
    case "editing_conta_instalacao":
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

function getReentryPromptForStep(step: string, customer: any): string {
  const first = ((customer?.name || "") as string).split(/\s+/)[0];
  const v = first ? `${first}, ` : "";
  const prefix = "📋 *Voltando ao seu cadastro:* ";
  const map: Record<string, string> = {
    "ask_name": `${v}qual é o seu *nome completo*?`,
    "ask_cpf": `${v}qual é o seu *CPF*? (apenas números)`,
    "ask_rg": `${v}qual é o seu *RG*?`,
    "ask_birth_date": `${v}qual sua *data de nascimento*? (DD/MM/AAAA)`,
    "ask_phone": `${v}me confirma seu *telefone* (com DDD)?`,
    "ask_phone_confirm": `${v}me confirma seu *telefone* (com DDD)?`,
    "ask_email": `${v}me passa seu *e-mail* 📧\n_É por ele que você vai acessar o app *iGreen Club* 📱 (cashback, faturas e indicações)._`,
    "ask_cep": `${v}qual o *CEP* da sua casa? (8 dígitos)`,
    "ask_number": `${v}qual o *número* da sua casa?`,
    "ask_complement": `${v}tem *complemento* no endereço? (apto, bloco) — ou *PULAR* / *NÃO TEM*.`,
    "ask_installation_number": `${v}qual o *número da instalação* da conta?`,
    "ask_bill_value": `${v}qual a *média* da sua conta de luz? (ex: 350,50)`,
    "ask_tipo_documento": `Me manda só uma foto da *frente do seu documento* (RG ou CNH — eu identifico sozinho).`,
    "aguardando_conta": `${v}me envia uma *foto ou PDF da conta de luz* pra eu seguir 📸`,
    "aguardando_doc_frente": `${v}me envia a *frente* do seu documento 🪪`,
    "aguardando_doc_verso": `${v}me envia o *verso* do seu documento 🪪`,
    "aguardando_doc_auto": `${v}me envia o seu *documento* (RG ou CNH) 🪪`,
    "editing_conta_menu": "Qual campo deseja editar?\n\n1️⃣ Nome\n2️⃣ Endereço\n3️⃣ CEP\n4️⃣ Distribuidora\n5️⃣ Nº Instalação\n6️⃣ Valor da conta\n0️⃣ Cancelar",
    "editing_doc_menu": "Qual campo deseja editar?\n\n1️⃣ Nome\n2️⃣ CPF\n3️⃣ RG\n4️⃣ Data de Nascimento\n0️⃣ Cancelar",
    "editing_conta_nome": "Digite o *nome completo* correto:",
    "editing_conta_endereco": "Digite o *endereço completo* correto:",
    "editing_conta_cep": "Digite o *CEP* correto (8 dígitos):",
    "editing_conta_distribuidora": "Digite o nome da *distribuidora*:",
    "editing_conta_instalacao": "Digite o *número da instalação*:",
    "editing_conta_valor": "Digite o *valor da conta* (ex: 350,50):",
    "editing_doc_nome": "Digite o *nome completo* correto:",
    "editing_doc_cpf": "Digite o *CPF* correto (apenas números):",
    "editing_doc_rg": "Digite o *RG* correto:",
    "editing_doc_nascimento": "Digite a *data de nascimento* (DD/MM/AAAA):",
    "confirmando_dados_conta": "Os dados da conta estão corretos? Responda *SIM*, *NÃO* ou *EDITAR*.",
    "confirmando_dados_doc": "Os dados estão corretos? Responda *SIM*, *NÃO* ou *EDITAR*.",
    "confirmar_titularidade": "Antes de finalizar: é a *mesma pessoa* da conta de luz, *outro titular* (cônjuge/pai/mãe) ou quer *corrigir*?",
  };
  const txt = map[step];
  return txt ? prefix + txt : "";
}

// Steps onde QA semântico NUNCA deve disparar (cadastro/edição determinísticos)
const NO_QA_STEPS = new Set([
  "aguardando_conta", "processando_ocr_conta", "confirmando_dados_conta",
  "aguardando_doc_auto", "aguardando_doc_frente", "aguardando_doc_verso",
  "confirmando_dados_doc", "confirmar_titularidade", "ask_tipo_documento",
  "ask_name", "ask_cpf", "ask_rg", "ask_birth_date", "ask_phone", "ask_phone_confirm",
  "ask_email", "ask_cep", "ask_number", "ask_complement",
  "ask_installation_number", "ask_bill_value",
  "ask_doc_frente_manual", "ask_doc_verso_manual", "ask_finalizar",
  "finalizando", "portal_submitting", "aguardando_otp", "validando_otp", "otp_falhou",
  "aguardando_assinatura", "complete", "aguardando_humano",
  "editing_conta_menu", "editing_conta_nome", "editing_conta_endereco",
  "editing_conta_cep", "editing_conta_distribuidora", "editing_conta_instalacao", "editing_conta_valor",
  "editing_doc_menu", "editing_doc_nome", "editing_doc_cpf", "editing_doc_rg",
  "editing_doc_nascimento",
]);

// Helpers de tela de confirmação completa (usados após editar campo)
function _formatBRL(n: number): string {
  return Number(n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function buildConfirmacaoConta(merged: any): string {
  const v = Number(merged.electricity_bill_value || 0);
  return "📋 *Dados da conta:*\n\n" +
    `👤 *Nome:* ${merged.bill_holder_name || merged.name || "❌"}\n` +
    `📍 *Endereço:* ${merged.address_street || "❌"} ${merged.address_number || ""}\n` +
    `🏘️ *Bairro:* ${merged.address_neighborhood || "❌"}\n` +
    `🏙️ *Cidade:* ${merged.address_city || "❌"} - ${merged.address_state || ""}\n` +
    `📮 *CEP:* ${merged.cep || "❌"}\n` +
    `⚡ *Distribuidora:* ${merged.distribuidora || "❌"}\n` +
    `🔢 *Nº Instalação:* ${merged.numero_instalacao || "❌"}\n` +
    `💰 *Valor:* R$ ${_formatBRL(v)}\n\n` +
    "Está tudo correto?";
}
function buildConfirmacaoDoc(merged: any): string {
  return `📋 *Confirme seus dados pessoais:*\n\n` +
    `👤 Nome: *${merged.doc_holder_name || merged.name || "—"}*\n` +
    `🆔 CPF: *${merged.cpf || "—"}*\n` +
    `🪪 RG: *${merged.rg || "—"}*\n` +
    `🎂 Nascimento: *${merged.data_nascimento || "—"}*\n\n` +
    "Está tudo correto?";
}

export async function runBotFlow(ctx: BotContext): Promise<BotResult> {
  const {
    supabase,
    sender: { sendText, sendButtons, sendMedia },
    customer,
    consultorId,
    nomeRepresentante,
    remoteJid,
    phone,
    messageText,
    buttonId,
    isFile,
    isButton,
    hasImage,
    hasDocument,
    imageMessage,
    documentMessage,
    message,
    messageId,
    fileUrl,
    fileBase64,
    geminiApiKey,
  } = ctx;

  // ═══════════════════════════════════════════════════════════════════
  // 🛟 respondAndReentry — fallback universal pra mensagens fora do esperado.
  // Responde a dúvida (FAQ → IA → fallback) + reconduz ao passo atual repetindo
  // SÓ a pergunta final do prompt. Nunca silencia, nunca lança exceção.
  // Só pausa+handoff após 5 desvios no mesmo lead (com mensagem de cortesia).
  // ═══════════════════════════════════════════════════════════════════
  const _extractQuestionTail = (text: string): string => {
    if (!text) return "";
    const cleaned = String(text).replace(/^📋\s*\*?Voltando ao seu cadastro:\*?\s*/i, "").trim();
    const qMatches = cleaned.match(/[^.!?\n]*\?+/g);
    if (qMatches && qMatches.length > 0) return qMatches[qMatches.length - 1].trim();
    const sents = cleaned.split(/(?<=[.!?])\s+/).filter(Boolean);
    return (sents[sents.length - 1] || cleaned).trim();
  };

  async function respondAndReentry(opts: {
    reason: "midflow_qa_miss" | "off_topic_collect" | "custom_step_no_match";
    questionText: string;
    reentryFull?: string;
  }): Promise<BotResult> {
    const { reason, questionText } = opts;
    const stepNow = String((customer as any).conversation_step || "");
    const reentryFull = opts.reentryFull || getReentryPromptForStep(stepNow, customer) || "";
    const reentryTail = _extractQuestionTail(reentryFull);

    let answer = "";
    let source: "faq" | "ai" | "fallback" = "fallback";

    // 1) FAQ
    try {
      const { data: flowRow } = await supabase
        .from("bot_flows").select("id")
        .eq("consultant_id", customer.consultant_id)
        .eq("is_active", true).eq("variant", (customer as any)?.flow_variant || "A").maybeSingle();
      if (flowRow?.id) {
        const qa = await matchQA(supabase, (flowRow as any).id, customer.consultant_id, questionText);
        if (qa && (qa.text || qa.mediaUrls.length)) {
          for (const m of qa.mediaUrls) {
            try { await sendMedia(remoteJid, m.url, "", m.kind, Number((m as any).duration_sec || 0) || undefined); } catch (_) { /* segue */ }
          }
          answer = (qa.text || "").trim();
          source = "faq";
        }
      }
    } catch (e) { console.warn("[respondAndReentry] FAQ falhou:", (e as any)?.message); }

    // 2) IA de vendas (timeout 8s) — só responder, não muda step
    if (!answer) {
      try {
        const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
        const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
        const ctrl = new AbortController();
        const tid = setTimeout(() => ctrl.abort(), 8000);
        const aiResp = await fetch(`${supabaseUrl}/functions/v1/ai-sales-agent`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${serviceKey}`,
            apikey: serviceKey,
          },
          body: JSON.stringify({
            customer_id: customer.id,
            user_input: questionText,
            mode: "answer_only",
          }),
          signal: ctrl.signal,
        });
        clearTimeout(tid);
        if (aiResp.ok) {
          const body = await aiResp.json().catch(() => ({}));
          const txt = (body?.decision?.args?.message || body?.reply || body?.message || "").toString().trim();
          if (txt) { answer = txt; source = "ai"; }
        }
      } catch (e) { console.warn("[respondAndReentry] IA falhou:", (e as any)?.message); }
    }

    // 3) Fallback genérico (nunca silêncio)
    if (!answer) {
      answer = "Boa pergunta! Te explico melhor já já 💬";
      source = "fallback";
    }

    // Detour + handoff suave após 5 desvios
    const detourNext = Number((customer as any).detour_count || 0) + 1;
    const patch: Record<string, any> = { detour_count: detourNext };
    let courtesyTail = "";
    if (detourNext >= 5) {
      patch.bot_paused = true;
      patch.bot_paused_reason = "muitas_duvidas";
      patch.bot_paused_at = new Date().toISOString();
      courtesyTail = "\n\n🙌 Vou chamar alguém do time pra te atender pessoalmente — já já alguém responde por aqui.";
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

    const reentryLine = reentryTail ? `\n\n📋 Voltando: ${reentryTail}` : "";
    const finalMsg = `${answer}${reentryLine}${courtesyTail}`;

    try { await sendText(remoteJid, finalMsg); } catch (e) {
      console.warn("[respondAndReentry] sendText falhou:", (e as any)?.message);
    }
    try {
      await supabase.from("conversations").insert({
        customer_id: customer.id, message_direction: "outbound",
        message_text: finalMsg, message_type: "text", conversation_step: stepNow,
      });
    } catch (_) { /* noop */ }

    console.log(`[respondAndReentry] reason=${reason} source=${source} detour=${detourNext} step=${stepNow}`);
    return { reply: "", updates: { __inline_sent: true } as any };
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
    const inCadastro = /^(ask_|aguardando_|editing_|confirm)/.test(String((customer as any).conversation_step || ""));
    if (
      midflowEnabled &&
      inCadastro &&
      messageText && !isFile && !isButton &&
      detectQuestionIntent(messageText)
    ) {
      const { data: flowRow } = await supabase
        .from("bot_flows").select("id")
        .eq("consultant_id", customer.consultant_id)
        .eq("is_active", true).eq("variant", (customer as any)?.flow_variant || "A").maybeSingle();
      if (flowRow?.id) {
        const qa = await matchQA(supabase, (flowRow as any).id, customer.consultant_id, messageText);
        if (qa && (qa.text || qa.mediaUrls.length)) {
          console.log(`[midflow-qa] hit=true step="${(customer as any).conversation_step}" detour=${(customer as any).detour_count || 0}`);
          // Envia mídias da FAQ (se houver)
          for (const m of qa.mediaUrls) {
            try { await sendMedia(remoteJid, m.url, "", m.kind, Number((m as any).duration_sec || 0) || undefined); } catch (_) { /* noop */ }
          }
          const stepKey = String((customer as any).conversation_step || "");
          const reentry = getReentryPromptForStep(stepKey, customer);
          const text = [qa.text, reentry].filter(Boolean).join("\n\n");

          // Sprint C3: threshold 5 (era 3) + handoff alert visível ao consultor
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

      const { data: flow } = await supabase
        .from("bot_flows")
        .select("id")
        .eq("consultant_id", customer.consultant_id)
        .eq("is_active", true).eq("variant", (customer as any)?.flow_variant || "A")
        .maybeSingle();
      if (!flow?.id) return false;

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

          const { answerFaqWithAI } = await import("../../_shared/ai-faq-answerer.ts");
          const firstName = String((customer as any).name || "").trim().split(/\s+/)[0] || "";
          const ai = await answerFaqWithAI({
            supabase,
            question: question || "O lead chegou no passo de esclarecer dúvidas. Convide-o gentilmente a fazer a pergunta dele e tranquilize-o de que vamos esclarecer tudo.",
            leadName: firstName,
            currentStepLabel: stepKey,
            consultantId: customer.consultant_id,
            recentHistory,
            model: "google/gemini-3.1-pro-preview",
          });

          let answerText = (ai.text || "").trim();
          if (!answerText) {
            answerText = firstName
              ? `${firstName}, pode mandar sua dúvida que eu te explico tudo agora 😊`
              : "Pode mandar sua dúvida que eu te explico tudo agora 😊";
          }

          await sendText(remoteJid, answerText);
          await supabase.from("conversations").insert({
            customer_id: customer.id,
            message_direction: "outbound",
            message_text: answerText,
            message_type: "text",
            conversation_step: stepKey,
          });

          if (ai.shouldHandoff) {
            try {
              await supabase
                .from("customers")
                .update({ bot_paused: true, bot_paused_reason: "ai_handoff_duvidas" })
                .eq("id", customer.id);
              const { notifyHandoff } = await import("../../_shared/notify-consultant.ts");
              await notifyHandoff(supabase, customer, "Dúvida exigiu humano (passo esclarecer_duvidas)").catch(() => {});
            } catch (_e) { /* best-effort */ }
          }

          console.log(`[dispatch:${stepKey}] AI answer enviada (conf=${ai.confidence.toFixed(2)} handoff=${ai.shouldHandoff})`);
          return true;
        } catch (e) {
          console.warn(`[dispatch:${stepKey}] AI answer falhou — caindo no texto estático:`, (e as Error).message);
          // segue fluxo padrão abaixo
        }
      }


      const slotKey = (stepRow as any).slot_key || stepKey;
      const { data: mediaRows } = await supabase
        .from("ai_media_library")
        .select("id, kind, url, slot_key, send_order, duration_sec, delay_before_ms")
        .eq("consultant_id", customer.consultant_id)
        .eq("slot_key", slotKey)
        .eq("active", true)
        .eq("is_draft", false)
        .order("send_order", { ascending: true });
      let medias = ((mediaRows as any[]) || []).filter((m) => !!m?.url);
      const _flowVariant = (customer as any)?.flow_variant || 'A';
      if (_flowVariant === 'B') {
        const _before = medias.length;
        medias = medias.filter((m) => String(m.kind).toLowerCase() !== 'audio');
        if (_before !== medias.length) console.log(`[dispatch:${stepKey}] variant=B: removed ${_before - medias.length} audio media(s)`);
      }

      const firstName = String((customer as any).name || "").trim().split(/\s+/)[0] || "";
      const vars: Record<string, string> = {
        "{nome}": firstName,
        "{{nome}}": firstName,
        "{nome_completo}": String((customer as any).name || ""),
        "{{nome_completo}}": String((customer as any).name || ""),
        "{representante}": nomeRepresentante || "",
        "{{representante}}": nomeRepresentante || "",
        ...extraVars,
      };
      const applyVars = (s: string) =>
        Object.entries(vars).reduce((acc, [k, v]) => acc.split(k).join(v), s);

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
      const uiOrder = await getStepMediaOrder(supabase, customer.consultant_id, [(stepRow as any).step_key || stepKey, slotKey]);
      const stepOrder = Array.isArray((stepRow as any).media_order) && (stepRow as any).media_order.length > 0
        ? (stepRow as any).media_order.map((k: any) => String(k).toLowerCase())
        : null;
      const configuredOrder = uiOrder || stepOrder || ["audio", "image", "video", "text", "document"];
      items.sort(makeKindComparator((it: Item) => it.kind, configuredOrder));

      let sent = false;
      let videoFailed = false;
      let hadVideo = false;
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const isLast = i === items.length - 1;

        if (it.kind === "text" && it.text) {
          try {
            await sendText(remoteJid, it.text);
            await supabase.from("conversations").insert({
              customer_id: customer.id,
              message_direction: "outbound",
              message_text: it.text,
              message_type: "text",
              conversation_step: stepKey,
            });
            sent = true;
            if (!isLast) await new Promise((r) => setTimeout(r, 800));
          } catch (e) {
            console.warn(`[dispatch:${stepKey}] envio de texto falhou:`, (e as any)?.message);
          }
          continue;
        }

        const m = it.media;
        if (!m?.url) continue;
        const kind = ["audio", "video", "image"].includes(it.kind) ? it.kind : "document";
        if (kind === "video") hadVideo = true;

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
        if (delayMs > 0) await new Promise((r) => setTimeout(r, Math.min(delayMs, 10_000)));

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
          } else if (kind === "video") {
            videoFailed = true;
          }
        } catch (e) {
          if (kind === "video") videoFailed = true;
          console.warn(`[dispatch:${stepKey}] envio de ${kind} falhou:`, (e as any)?.message);
        }
      }

      // F10 — Fallback variant C → B quando o vídeo inicial falha.
      // Critério: variant=C, slot tinha vídeo, vídeo falhou e nada foi entregue.
      // Promove o customer para B e re-dispara o mesmo step.
      const _variant = (customer as any)?.flow_variant || "A";
      if (_variant === "C" && hadVideo && videoFailed && !sent) {
        console.warn(`[dispatch:${stepKey}] [variant-c] video failed, fallback to B`, {
          customerId: customer.id,
          stepKey,
        });
        try {
          await supabase
            .from("customers")
            .update({ flow_variant: "B", updated_at: new Date().toISOString() })
            .eq("id", customer.id);
          (customer as any).flow_variant = "B";
          return await dispatchStepFromFlow(stepKey, extraVars);
        } catch (e) {
          console.warn(`[dispatch:${stepKey}] fallback C→B falhou:`, (e as any)?.message);
        }
      }

      // ─── BOTÕES INTERATIVOS ──────────────────────────────────────────
      // Se o passo tem botões configurados (captures._buttons), envia
      // como mensagem com opções numeradas DEPOIS do conteúdo principal.
      // Isso permite que passos de simulação/conversão tenham CTAs claros
      // ("✅ Quero finalizar", "❓ Tenho dúvidas", "👤 Falar com humano").
      try {
        const captures = Array.isArray((stepRow as any).captures) ? (stepRow as any).captures : [];
        const buttonsCapture = captures.find((c: any) => c?.field === "_buttons" && Array.isArray(c?.value));
        const buttons = buttonsCapture?.value || [];
        if (buttons.length > 0 && sent) {
          // Pequena pausa pra separar o conteúdo dos botões visualmente
          await new Promise((r) => setTimeout(r, 600));
          // Evolution não suporta botões reais — envia como opções numeradas
          const buttonText = buttons.map((b: any, i: number) => `${i + 1}. ${b.title}`).join("\n");
          const ctaText = `\n*Toque numa opção (ou digite o número):*\n${buttonText}`;
          await sendText(remoteJid, ctaText);
          await supabase.from("conversations").insert({
            customer_id: customer.id,
            message_direction: "outbound",
            message_text: ctaText,
            message_type: "text",
            conversation_step: stepKey,
          });
          console.log(`[dispatch:${stepKey}] enviou ${buttons.length} botão(ões) como CTA`);
        }
      } catch (e) {
        console.warn(`[dispatch:${stepKey}] envio de botões falhou:`, (e as any)?.message);
      }

      return sent;
    } catch (e) {
      console.warn(`[dispatch:${stepKey}] erro geral:`, (e as any)?.message);
      return false;
    }
  }

  // CTA por etapa do funil — sempre puxa o lead pro próximo passo após responder.
  function buildStepNudge(currentStep: string, leadName: string | null): string {
    const first = (leadName || "").split(/\s+/)[0] || "";
    const v = first ? `${first}, ` : "";
    switch (currentStep) {
      case "welcome":
      case "menu_inicial":
      case "qualificacao":
        return `\n\n${v}me conta: quanto vem em média a sua conta de luz? Assim eu já te calculo a economia. 💡`;
      case "aguardando_conta":
        return `\n\n${v}pra eu confirmar tudo certinho, me manda agora a *foto* (ou PDF) da sua conta de luz. 📸`;
      case "coleta_doc":
      case "ask_email":
      case "ask_cep":
        return `\n\nBora finalizar seu cadastro? Continua respondendo aqui que eu te guio. ✅`;
      default:
        return "";
    }
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

    const { data: activeFlow } = await supabase
      .from("bot_flows")
      .select("id")
      .eq("consultant_id", customer.consultant_id)
      .eq("is_active", true).eq("variant", (customer as any)?.flow_variant || "A")
      .maybeSingle();
    if (!activeFlow) return null;

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

    // 1) Match rápido por substring/normalização
    let matchedQaId: string | null = null;
    const directHit = triggerList.find((t) => {
      const phrase = String(t.phrase || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
      if (!phrase) return false;
      if (normalizedText === phrase || normalizedText.includes(phrase)) return true;
      // similaridade trigrama alta (typos curtos)
      return trigramSim(normalizedText, phrase) >= 0.72;
    });
    if (directHit) matchedQaId = directHit.qa_id;

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
    const baseText = qa.text_response
      ? String(qa.text_response).replaceAll("{nome}", customer.name || "").replaceAll("{representante}", nomeRepresentante || "")
      : "";
    const nudgeStep = qa.is_closing ? "aguardando_conta" : (step || "qualificacao");
    const nudge = qa.is_closing ? "" : buildStepNudge(nudgeStep, customer.name || null);
    const responseText = (baseText + nudge).trim();

    type QaItem = { kind: string; mediaRef?: any; text?: string };
    const items: QaItem[] = ((mediaRows as any[]) || []).map((m) => ({
      kind: String(m.media_kind || "document").toLowerCase(),
      mediaRef: m,
    }));
    if (responseText) items.push({ kind: "text", text: responseText });

    const _qaOrder = (await getStepMediaOrder(supabase, customer.consultant_id, [step])) || ["text", "audio", "image", "video", "document"];
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
          .eq("consultant_id", customer.consultant_id)
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
            .eq("slot_key", m.slot_key)
            .eq("active", true)
            .order("send_order", { ascending: true })
            .limit(1).maybeSingle();
          if (pub?.url) { url = pub.url; resolvedMediaId = (pub as any).id || resolvedMediaId; durationSec = Number((pub as any).duration_sec || 0) || null; }
        }
      }
      if (!url) continue;
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

    // Se mídia foi enviada sem texto, manda um nudge curto (mantém comportamento)
    if (sentSomething && !responseText && !qa.is_closing) {
      const nudgeOnly = buildStepNudge(step || "qualificacao", customer.name || null).trim();
      if (nudgeOnly) {
        await sendText(remoteJid, nudgeOnly);
        await supabase.from("conversations").insert({
          customer_id: customer.id, message_direction: "outbound",
          message_text: nudgeOnly, message_type: "text", conversation_step: step,
        });
      }
    }

    if (!sentSomething) return null;
    // G: keepStep=true (off-topic intercept) → não muda conversation_step
    if (opts?.keepStep) {
      return { reply: "", updates: { __inline_sent: true } as any };
    }
    return { reply: "", updates: { conversation_step: qa.is_closing ? "aguardando_conta" : (step || "qualificacao"), __inline_sent: true } as any };
  }



  let step = customer.conversation_step || "welcome";
  let reply = "";
  const updates: Record<string, any> = {};

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
      const { data: hasDynamicFlow } = await supabase
        .from("bot_flows")
        .select("id")
        .eq("consultant_id", customer.consultant_id)
        .eq("is_active", true).eq("variant", (customer as any)?.flow_variant || "A")
        .maybeSingle();
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
        const { data: activeFlow } = await supabase
          .from("bot_flows")
          .select("id")
          .eq("consultant_id", customer.consultant_id)
          .eq("is_active", true).eq("variant", (customer as any)?.flow_variant || "A")
          .maybeSingle();

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
            const _openOrder = await getStepMediaOrder(supabase, customer.consultant_id, [step]);
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
                  .eq("consultant_id", customer.consultant_id)
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
                await sendText(remoteJid, String(openingText)
                  .replaceAll("{nome}", customer.name || "")
                  .replaceAll("{representante}", nomeRepresentante || ""));
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
          "📋 Ótimo! Vamos iniciar seu cadastro.\n\n" +
          "📸 *Envie uma FOTO ou PDF da sua conta de energia* para começarmos!\n\n" +
          "Formatos aceitos: JPG, PNG ou PDF",
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
      return {
        reply: `${recoveredName.split(/\s+/)[0]}, qual a média da sua conta de luz?`,
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
    const currentNameTrusted = !!(customer as any).name && !isBogusCapturedName((customer as any).name);
    const typedName = normalizeLeadName(txt);
    const valueMatch = String(txt || "").match(/(?:r\$\s*)?(\d{2,5}(?:[\.,]\d{1,2})?)/i);
    const typedBillValue = valueMatch ? Number(valueMatch[1].replace(".", "").replace(",", ".")) : 0;

    if (RE_GREETING_ONLY.test(txt)) {
      return {
        reply: currentNameTrusted ? "Oi! Qual a média da sua conta de luz?" : "Oi! Qual é o seu nome?",
        updates: { conversation_step: "qualificacao" },
      };
    }

    if (typedName) {
      return {
        reply: `${typedName.split(/\s+/)[0]}, qual a média da sua conta de luz?`,
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
    if (raw.length <= 20 && /^[r\$\s]*\d{2,5}([\.,]\d{1,2})?[\s,reais]*$/i.test(raw)) {
      const m = raw.match(/(\d{2,5}(?:[\.,]\d{1,2})?)/);
      const v = m ? Number(m[1].replace(".", "").replace(",", ".")) : 0;
      if (Number.isFinite(v) && v >= 30 && v <= 50000) {
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
  const STRONG_PURCHASE_INTENT = /^(cadastr|quero\s+(?:cadastr|fazer|come[çc]ar|entrar|me\s*cadastr)|bora|vamos|partiu|simbora|aceito|topo|t[oô]\s+dentro|pode\s+(?:fazer|cadastr)|fa[çc]a\s+(?:o\s*)?cadastr|come[çc]ar|fechado|fechou)\b/i;
  const conversationalForShortcut = new Set(["welcome", "menu_inicial", "pos_video", "checkin_pos_video", "qualificacao"]);
  if (
    !isFile && !customer.bot_paused && !billTrusted &&
    conversationalForShortcut.has(step) &&
    messageText && STRONG_PURCHASE_INTENT.test(messageText.trim())
  ) {
    console.log(`🎯 [intent-shortcut] cadastro detectado em step=${step} → forçando aguardando_conta`);
    step = "aguardando_conta";
    (customer as any).conversation_step = "aguardando_conta";
    updates.conversation_step = "aguardando_conta";
    const firstNm = ((customer as any).name || "").split(/\s+/)[0];
    const v = firstNm ? `${firstNm}, ` : "";
    const reply = `Show, ${v.trim().replace(/,$/, "")}! 📸 Pra eu já calcular sua economia exata e iniciar o cadastro, me envia uma *foto ou PDF da sua conta de luz* (qualquer página serve).`;
    return { reply, updates };
  }

  // ✅ Caminho determinístico para validação/conversão: respostas positivas no check-in
  // não podem cair na IA e repetir áudio/vídeo. Se vier valor junto, já avança direto.
  if (!isFile && !isButton && step === "checkin_pos_video" && messageText) {
    const txt = messageText.trim();
    const firstNm = ((customer as any).name || "").split(/\s+/)[0];
    const v = firstNm ? `${firstNm}, ` : "";
    const valueMatch = txt.match(/(?:r\$\s*)?(\d{2,5}(?:[\.,]\d{1,2})?)/i);
    const billValue = valueMatch ? Number(valueMatch[1].replace(".", "").replace(",", ".")) : 0;
    const positive = isPositiveCheckinIntent(txt);
    if (Number.isFinite(billValue) && billValue >= 100) {
      return {
        reply: `Boa! Com R$ ${billValue.toFixed(0)} já dá pra calcular sua economia. Me envia uma *foto* ou PDF da conta de luz pra eu confirmar os dados 📸`,
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
      const ctaMsg = `Show! Pra finalizar seu cadastro, me manda só uma foto da *frente do seu documento* 📄\n\nPode ser RG ou CNH, o que estiver mais à mão.`;
      await sendText(remoteJid, ctaMsg);
      await supabase.from("conversations").insert({
        customer_id: customer.id, message_direction: "outbound",
        message_text: ctaMsg, message_type: "text",
        conversation_step: "aguardando_doc_auto",
      });
      return { reply: "", updates: { conversation_step: "aguardando_doc_auto", __inline_sent: true } as any };
    }
    if (/\?|cancel|cancela|taxa|fidelidade|seguro|pagar|custa|club|clube|funciona/i.test(txt)) {
      return {
        reply: "Pode ficar tranquilo: não tem obra, não muda instalação e você pode pedir suporte se tiver qualquer dúvida. O Conexão Club é um benefício extra de descontos/cashback em parceiros; o principal aqui é reduzir sua conta de luz.\n\nSe estiver tudo certo, me responde *pode seguir* que eu peço seu RG ou CNH pra finalizar.",
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

      const useSalesAi = cfg?.enabled !== false && cfg?.handoff_rules?.use_sales_ai === true;
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
            reply = `🧑 Vou chamar o ${nomeRepresentante} aqui pra te atender pessoalmente, ok?`;
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
              const firstNm = ((customer as any).name || "").split(/\s+/)[0];
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
          const reentry = getReentryPromptForStep(step, customer);
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
    "ask_complement", "ask_email", "ask_rg", "ask_finalizar",
    "confirmar_titularidade", "validacao_facial", "pos_video",
    "finalizando", "finalizar_cadastro", "complete", "valor_baixo",
    "cadastro_em_analise", "aguardando_facial", "otp_falhou",
    "aguardando_humano",
  ]);
  const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const stepIsUuid = UUID_RX.test(step);
  const stepIsCustom = !LEGACY_STEPS.has(step) && !step.startsWith("editing_") && !step.startsWith("ask_");

  if (customer.consultant_id && (stepIsUuid || stepIsCustom)) {
    try {
      const { data: flow } = await supabase
        .from("bot_flows").select("id")
        .eq("consultant_id", customer.consultant_id)
        .eq("is_active", true).eq("variant", (customer as any)?.flow_variant || "A").maybeSingle();
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

          if (stype === "capture_conta") step = "aguardando_conta";
          else if (stype === "capture_documento" || stype === "capture_doc") step = "aguardando_doc_auto";
          else if (stype === "capture_email") step = "ask_email";
          else if (stype === "confirm_phone") step = "ask_phone_confirm";
          else if (stype === "finalizar_cadastro") step = "finalizando";
          else {
            // step_type === "message" → passo informativo.
            // ANTES de avançar, garante que o conteúdo do step ATUAL foi emitido
            // (dispatchStepFromFlow tem anti-rep interno de 10 min, então não duplica).
            const _fmtBRL = (n: number) => n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            const _valor = Number((customer as any).electricity_bill_value || 0);
            const _vars = {
              "{valor}": _fmtBRL(_valor),
              "{{valor}}": _fmtBRL(_valor),
              "{economia_mensal}": _fmtBRL(_valor * 0.20),
              "{{economia_mensal}}": _fmtBRL(_valor * 0.20),
              "{economia_anual}": _fmtBRL(_valor * 0.20 * 12),
              "{{economia_anual}}": _fmtBRL(_valor * 0.20 * 12),
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

            if (nextCustom?.__special) {
              const sp = String(nextCustom.__special).toLowerCase().trim();
              if (sp === "humano") {
                return { reply: `Tranquilo! Vou chamar ${nomeRepresentante || "um consultor"} pra te ajudar por aqui 🙌`, updates: { conversation_step: "aguardando_humano", bot_paused: true, bot_paused_reason: "flow_button_humano", bot_paused_at: new Date().toISOString(), __inline_sent: emittedCurrent || undefined } as any };
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
                      phone_whatsapp: (customer as any).phone_whatsapp || phone,
                      conversation_step: stepKeyForRetry,
                    },
                    messageText,
                    "custom_step_no_match_retries_exhausted",
                  ).catch((e) => console.warn("[notify-handoff] falhou:", (e as Error).message));
                } catch (_) { /* notify opcional */ }
                return {
                  reply: "Vou chamar um consultor humano pra te ajudar agora, tá bom? Em instantes alguém responde por aqui. 👋",
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
              nextCustom = await findNextActiveFlowStep(supabase, customer.consultant_id, {
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
                  nxt = await findNextActiveFlowStep(supabase, customer.consultant_id, {
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
              if (ntype === "capture_conta") { nextStepValue = "aguardando_conta"; _isCapture = true; }
              else if (ntype === "capture_documento" || ntype === "capture_doc") { nextStepValue = "aguardando_doc_auto"; _isCapture = true; }
              else if (ntype === "capture_email") { nextStepValue = "ask_email"; _isCapture = true; }
              else if (ntype === "confirm_phone") { nextStepValue = "ask_phone_confirm"; _isCapture = true; }
              else if (ntype === "finalizar_cadastro") nextStepValue = "finalizando";
              console.log(`[custom-step-resolver] message→advance final=${current.step_key} type=${ntype} isCapture=${_isCapture}`);
              const _updates: any = { conversation_step: nextStepValue, __inline_sent: (emittedCurrent || dispatchedAny) || undefined };
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
          // UUID/step_key órfão (passo deletado, fluxo trocado): tenta redispatch idempotente
          console.warn(`[custom-step-resolver] step "${step}" não encontrado no fluxo ativo — tentando redispatch e mantendo`);
          if (!stepIsUuid) {
            await dispatchStepFromFlow(step).catch(() => false);
          }
          return { reply: "", updates: { __inline_sent: true } as any };
        }
      }
    } catch (e) {
      console.warn("[custom-step-resolver] falhou:", (e as any)?.message);
    }
  }

  switch (step) {
    // ─── 1. BOAS-VINDAS ────────────────────
    case "welcome": {
      // Vendedor humano: saudação curta sem botões. O áudio de abertura (slot)
      // já tocou. A partir daqui a IA assume a conversa em "qualificacao".
      const first = ((customer as any).name || "").split(/\s+/)[0];
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
        reply = `${capturedName.split(/\s+/)[0]}, qual a média da sua conta de luz?`;
        updates.conversation_step = "qualificacao";
        break;
      }

      if (isBogusCapturedName((customer as any).name)) {
        updates.name = null;
        updates.name_source = "unknown";
        (customer as any).name = null;
        (customer as any).name_source = "unknown";
      }

      const valueMatch = String(messageText || "").match(/(?:r\$\s*)?(\d{2,5}(?:[\.,]\d{1,2})?)/i);
      if (valueMatch) {
        const billValue = Number(valueMatch[1].replace(".", "").replace(",", "."));
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

      reply = (customer as any).name && !isBogusCapturedName((customer as any).name)
        ? `Certo, ${(customer as any).name.split(/\s+/)[0]}. Qual a média da sua conta de luz?`
        : "Qual é o seu nome?";
      updates.conversation_step = "qualificacao";
      break;
    }

    // ─── 1b. CHECK-IN PÓS ÁUDIO/VÍDEO ────────────
    // Pergunta "deu pra entender?" depois do opening. Se afirmativo, vai pra qualificacao.
    // Se for dúvida/negativa, deixa a IA responder (mesma rota do qualificacao).
    case "checkin_pos_video": {
      const txt = String(messageText || "").trim().toLowerCase();
      const first = ((customer as any).name || "").split(/\s+/)[0];
      const v = first ? `${first}, ` : "";
      const RE_AFFIRM = /^(sim|ss+|s|deu|entendi|entendido|claro|ok|okay|beleza|blz|certo|positivo|isso|🆗|👌|👍|✅|com\s*certeza|perfeito|bacana|massa|legal|joia|tranquilo)\b/i;
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
      const valueMatch = txt.match(/(?:r\$\s*)?(\d{2,5}(?:[\.,]\d{1,2})?)/i);
      if (valueMatch) {
        const billValue = Number(valueMatch[1].replace(".", "").replace(",", "."));
        if (Number.isFinite(billValue) && billValue >= 30) {
          updates.electricity_bill_value = billValue;
          updates.sales_phase = "fechamento";
          reply = `Show! Com R$ ${billValue.toFixed(0)} dá pra calcular sua economia. Me envia uma *foto* (ou PDF) da sua conta de luz pra eu confirmar os dados 📸`;
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
        const first = ((customer as any).name || "").split(/\s+/)[0];
        const v = first ? `${first}, ` : "";
        reply = `Boa! ${v}pra eu travar a sua economia exata, me manda uma *foto* (ou PDF) da sua última conta de luz aqui no chat 📸`;
        updates.conversation_step = "aguardando_conta";
        updates.sales_phase = "fechamento";
      } else if (resp === "falar_humano" || resp?.includes("humano") || resp?.includes("atendente")) {
        reply = `Tranquilo! Já te encaminhei pra *${nomeRepresentante}*, ela te chama aqui mesmo, ok?`;
        updates.conversation_step = "aguardando_humano";
      } else {
        // Qualquer outra coisa → vira conversa livre, IA assume.
        const first = ((customer as any).name || "").split(/\s+/)[0];
        const v = first ? `${first}, ` : "";
        reply = `${v}me conta: quanto vem em média na sua conta de luz? Assim eu já te calculo quanto dá pra economizar 💡`;
        updates.conversation_step = "qualificacao";
      }
      break;
    }

    case "aguardando_humano": {
      const resp = messageText.toLowerCase().trim();
      if (resp?.includes("cadastr") || resp === "2") {
        reply = "📋 Vamos iniciar seu cadastro!\n\n📸 *Envie uma FOTO ou PDF da sua conta de energia* para começarmos!\n\nFormatos aceitos: JPG, PNG ou PDF";
        updates.conversation_step = "aguardando_conta";
      } else {
        reply = `⏳ Sua solicitação já foi registrada! Um consultor da equipe *${nomeRepresentante}* entrará em contato em breve.\n\nSe quiser iniciar o cadastro agora, digite *cadastrar*.`;
      }
      break;
    }

    // ─── 2. AGUARDANDO CONTA ──────────────
    case "aguardando_conta": {
      // 🛡️ Clique de botão (welcome residual) chegando em aguardando_conta:
      // re-emite prompt da conta em vez de tratar título como texto livre.
      // Bug confirmado em sandbox 2026-05-29.
      if (isButton) {
        const _firstName = ((customer as any).name || "").split(/\s+/)[0];
        const _v = _firstName ? `${_firstName}, ` : "";
        reply = `${_v}me manda uma *foto* (ou PDF) da sua conta de luz, por favor 📸\n\nSe estiver sem a conta agora, é só me dizer o valor médio que você paga.`;
        break;
      }
      if (!isFile) {
        const txt = String(messageText || "").trim();
        const first = ((customer as any).name || "").split(/\s+/)[0];
        const v = first ? `${first}, ` : "";

        // Lead recusa mandar a foto → aceita seguir só com o valor.
        if (txt && RE_REFUSE_BILL.test(txt)) {
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
        const valueMatch = txt.match(/(?:r\$\s*)?(\d{2,5}(?:[\.,]\d{1,2})?)/i);
        if (valueMatch && !((customer as any).electricity_bill_value)) {
          const billValue = Number(valueMatch[1].replace(".", "").replace(",", "."));
          if (Number.isFinite(billValue) && billValue >= 30) {
            updates.electricity_bill_value = billValue;
            // Simulação inicial já com base no valor digitado (mem://copy/discount-rate-20 — "até 20%")
            const economiaMin = Math.max(1, Math.round(billValue * 0.08));
            const economiaMax = Math.max(2, Math.round(billValue * 0.20));
            const fmt = (n: number) => n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            reply =
              `Boa, ${first || "anotado"}! Anotei R$ ${fmt(billValue)} 💚\n\n` +
              `💡 Conta atual: *R$ ${fmt(billValue)}*\n` +
              `💚 Economia estimada: *R$ ${economiaMin} a R$ ${economiaMax}* por mês (até 20%)\n\n` +
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
      if (fileBase64) {
        const mime = imageMessage?.mimetype || documentMessage?.mimetype || "application/octet-stream";
        updates.electricity_bill_photo_url = `data:${mime};base64,${fileBase64}`;
        updates.bill_base64 = fileBase64;
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
        // Garante bytes: se não temos base64 mas temos URL HTTP, baixa on-demand
        let ocrBase64 = fileBase64 || undefined;
        if (!ocrBase64 && fileUrl && /^https?:\/\//i.test(fileUrl)) {
          const fetched = await fetchUrlToBase64(fileUrl);
          if (fetched?.base64) {
            ocrBase64 = fetched.base64;
            if (!mediaMsg.mimetype) (mediaMsg as any).mimetype = fetched.mime;
            console.log(`📥 OCR base64 baixado on-demand: ${ocrBase64.length} bytes`);
          }
        }
        // Timeout de 25s para o OCR (evita travar "Analisando...")
        const ocrData: any = await Promise.race([
          ocrContaEnergia(fileUrl, geminiApiKey, ocrBase64, mediaMsg),
          new Promise((_, rej) => setTimeout(() => rej(new Error("OCR_TIMEOUT_25s")), 25_000)),
        ]);
        console.log("📊 OCR Conta resultado:", JSON.stringify(ocrData).substring(0, 400));
        if (ocrData.sucesso && ocrData.dados) {
          const d = ocrData.dados;
          const confianca = typeof d.confianca === "number" ? d.confianca : 100;
          if (confianca < OCR_CONFIDENCE_THRESHOLD) {
            jsonLog("warn", "OCR conta abaixo do threshold", { customer_id: customer.id, confianca, threshold: OCR_CONFIDENCE_THRESHOLD });
            updates.conversation_step = "aguardando_conta";
            reply = `⚠️ Não consegui ler a conta com clareza suficiente (qualidade: ${confianca}%).\n\n📸 Por favor, envie uma *foto mais nítida e bem iluminada* da conta de energia.\n\nDicas:\n• Use boa iluminação\n• Evite reflexos\n• Foco nos dados principais\n• Tire em ambiente claro`;
            break;
          }
          // BLINDAGEM: OCR pode retornar sucesso=true com dados vazios.
          // Exigir ao menos 3 campos críticos preenchidos.
          const criticos = [d.nome, d.endereco, d.cep, d.cidade, d.distribuidora, d.numeroInstalacao, d.valorConta]
            .filter((v) => v && String(v).trim().length > 0);
          if (criticos.length < 3) {
            jsonLog("warn", "OCR conta com poucos campos válidos", { customer_id: customer.id, validos: criticos.length });
            const tries = (customer.ocr_conta_attempts || 0) + 1;
            updates.ocr_conta_attempts = tries;
            if (tries < 2) {
              updates.conversation_step = "aguardando_conta";
              reply = "⚠️ Recebi a conta mas não consegui extrair os dados principais.\n\n📸 Envie uma *foto mais nítida* mostrando claramente:\n• Seu nome\n• Endereço\n• Distribuidora\n• Valor da conta";
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
          const valorParsed = d.valorConta ? parseFloat(d.valorConta) : 0;
          updates.electricity_bill_value = (valorParsed >= 30) ? valorParsed : 0;
          // CEP: só aceita se tiver 8 dígitos
          if (updates.cep) {
            const cepClean = String(updates.cep).replace(/\D/g, "");
            updates.cep = cepClean.length === 8 ? cepClean : "";
          }
          if (!updates.cep && updates.address_city && updates.address_state && updates.address_street) {
            console.log("🔍 CEP não encontrado. Buscando via ViaCEP...");
            const cepBuscado = await buscarCepPorEndereco(updates.address_state, updates.address_city, updates.address_street);
            if (cepBuscado) {
              updates.cep = cepBuscado;
              console.log(`✅ CEP auto-preenchido: ${cepBuscado}`);
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
            reply = `📋 Já peguei seus dados, ${String(finalName).split(" ")[0]}! Só me confirma uma coisa:\n\n💰 Qual o *valor médio* da sua conta de luz? (ex: 350,00)`;
            break;
          }

          updates.conversation_step = "confirmando_dados_conta";

          // Sempre pausa pro card de revisão no painel. Cron de 5 min
          // libera automaticamente se o consultor não decidir.
          console.log(`[ocr-bill] 📥 marcando review pendente (customer=${customer.id})`);
          updates.ocr_review_pending = "bill";
          updates.ocr_review_started_at = new Date().toISOString();
          updates.ocr_review_decided_at = null;
          updates.ocr_review_decided_by = null;
          reply = "";
          break;


        } else {
          console.error("❌ OCR conta falhou:", ocrData.erro);
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
            "⚠️ Não consegui ler a conta. Por favor, envie uma *foto mais nítida e bem iluminada* (sem reflexos).",
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
            reply = ocrFb.retryText;
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
          reply = ocrFb.retryText;
        }
      }
      break;
    }

    // ─── 3. CONFIRMANDO DADOS DA CONTA ──────────
    case "confirmando_dados_conta": {
      const resp = isButton ? buttonId : messageText.toLowerCase().trim();
      console.log(`[post-confirm-conta] ENTER resp="${resp}" customer=${customer.id}`);
      if (resp === "sim_conta" || resp === "sim" || resp === "s" || resp === "1" || resp === "ok" || resp === "correto" || resp === "✅") {
        // 🛡️ SAFETY: dispatch pós-SIM em try/catch — nunca deixa o lead mudo.
        try {
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

        const _valor = Number((customer as any).electricity_bill_value || 0);
        const _fmtBRL = (n: number) => n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const _vars = {
          "{valor}": _fmtBRL(_valor),
          "{{valor}}": _fmtBRL(_valor),
          "{economia_mensal}": _fmtBRL(_valor * 0.20),
          "{{economia_mensal}}": _fmtBRL(_valor * 0.20),
          "{economia_anual}": _fmtBRL(_valor * 0.20 * 12),
          "{{economia_anual}}": _fmtBRL(_valor * 0.20 * 12),
        };

        // FIX: continuar a partir da POSIÇÃO do capture_conta no fluxo custom.
        // Se não conseguir descobrir essa posição, NUNCA usa afterPosition=0,
        // porque isso retorna o primeiro passo ativo (geralmente "Nome do cliente").
        let _captureContaPos = 0;
        try {
          const { data: _flowRow } = await supabase
            .from("bot_flows").select("id")
            .eq("consultant_id", customer.consultant_id).eq("is_active", true).eq("variant", (customer as any)?.flow_variant || "A").maybeSingle();
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
        let nextCustom = _captureContaPos > 0
          ? await findNextActiveFlowStep(supabase, customer.consultant_id, { afterPosition: _captureContaPos })
          : null;
        if (nextCustom && Number(nextCustom.position || 0) <= _captureContaPos) {
          console.warn(`[post-confirm-conta] ignorando regressão next=${nextCustom.step_key} pos=${nextCustom.position} capture_pos=${_captureContaPos}`);
          nextCustom = null;
        }
        if (!nextCustom) {
          nextCustom = await findNextActiveFlowStep(supabase, customer.consultant_id, {
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
            const forwardCapture = await findNextActiveFlowStep(supabase, customer.consultant_id, {
              afterPosition: Number(nextCustom.position) || (_captureContaPos > 0 ? _captureContaPos : undefined),
              stepTypeIn: ["capture_documento", "capture_doc", "finalizar_cadastro"],
            });
            if (forwardCapture) {
              console.warn(`[post-confirm-conta] pulando message vazio "${nextCustom.step_key}" → ${forwardCapture.step_key}`);
              nextCustom = forwardCapture;
            }
          } else {
            console.log(`[post-confirm-conta] mantendo message "${nextCustom.step_key}" (slot=${hasSlot} btns=${hasButtons} econ=${hasEconomyVar} chars=${text.length}) — passo de simulação/conversão`);
          }
        }
        const DOC_FALLBACK = `Show! Pra finalizar seu cadastro, me manda só uma foto da *frente do seu documento* 📄\n\nPode ser RG ou CNH, o que estiver mais à mão.`;
        const FINAL_FALLBACK_TEXT = `✅ *Tudo pronto!*\n\nSeus dados foram preenchidos. Vamos finalizar seu cadastro no portal iGreen?`;
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

          // 🚦 SEPARAÇÃO conta ↔ documento — conta e doc são processos
          // individuais. Após confirmar a conta envia APENAS a simulação e
          // PARA. O capture_documento só dispara quando o cliente clicar
          // "Quero me cadastrar".
          if (nextCustom.step_type === "capture_documento" || nextCustom.step_type === "capture_doc") {
            try {
              const ctaText = "Pra continuar seu cadastro e garantir essa economia, é só tocar no botão abaixo 👇";
              await sendOptions(remoteJid, ctaText, [
                { id: "btn_quero_cadastrar", title: "✅ Quero me cadastrar" },
              ]);
              await supabase.from("conversations").insert({
                customer_id: customer.id, message_direction: "outbound",
                message_text: ctaText, message_type: "text", conversation_step: "ask_quero_cadastrar",
              });
            } catch (e) {
              console.warn(`[post-confirm-conta] envio do CTA quero_cadastrar falhou:`, (e as Error).message);
            }
            updates.conversation_step = "ask_quero_cadastrar";
          } else {
            const ok = nextCustom.step_type === "finalizar_cadastro"
              ? true
              : await dispatchStepFromFlow(nextCustom.step_key, _vars);
            if (nextCustom.step_type === "finalizar_cadastro") {
              try {
                const rawText = (nextCustom.message_text || "").trim();
                const firstName = String(customer.name || "").trim().split(/\s+/)[0] || "";
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
              } catch (e) {
                console.warn(`[post-confirm-conta] envio do botão finalizar falhou:`, (e as Error).message);
                await sendFinalizarButton();
              }
              updates.conversation_step = "ask_finalizar";
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
          console.warn(`[post-confirm-conta] nenhum próximo passo seguro — parando após simulação (sem encadear doc)`);
          try {
            const ctaText = "Pra continuar seu cadastro e garantir essa economia, é só tocar no botão abaixo 👇";
            await sendOptions(remoteJid, ctaText, [
              { id: "btn_quero_cadastrar", title: "✅ Quero me cadastrar" },
            ]);
            await supabase.from("conversations").insert({
              customer_id: customer.id, message_direction: "outbound",
              message_text: ctaText, message_type: "text", conversation_step: "ask_quero_cadastrar",
            });
          } catch (_) { /* segue */ }
          updates.conversation_step = "ask_quero_cadastrar";
        }

        (updates as any).__inline_sent = true;
        reply = "";
        } catch (dispatchErr: any) {
          const msg = String(dispatchErr?.message || dispatchErr).slice(0, 200);
          console.error(`[post-confirm-conta] ❌ DISPATCH FALHOU customer=${customer.id} err=${msg}`, dispatchErr);
          try {
            const fallbackTxt = "✅ Recebido! Já preparo os próximos passos do seu cadastro. Aguarda só um instantinho 🙏";
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
          updates.conversation_step = "ask_quero_cadastrar";
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
      // Pede o documento sem botões — o bot identifica RG/CNH sozinho.
      reply = `Pra finalizar, me manda só uma foto da *frente do seu documento* 📄\n\nPode ser RG ou CNH — o que for mais fácil pra você.`;
      updates.conversation_step = "aguardando_doc_auto";
      break;
    }

    // ─── 3a-bis. DÚVIDAS PÓS-CLUB ─────────
    // O lead recebeu o vídeo + pitch e foi convidado a tirar dúvidas.
    // - Afirmativo / "pode seguir" / "sem dúvida" → dispara botões do doc.
    // - Negativo OU pergunta livre → não fecha aqui; deixa a IA responder
    //   (esse case nem chega a executar nesse caminho, pois conversationalSteps
    //   inclui "duvidas_pos_club" e o ramo da IA roda antes do switch).
    case "duvidas_pos_club": {
      const txt = (messageText || "").trim().toLowerCase();
      const segueAgora =
        isButton ||
        /^(sim|s|ok|pode|pode seguir|bora|vamos|partiu|segue|seguir|tudo certo|sem d[uú]vida|nenhuma|nao tenho|n[ãa]o tenho|n[ãa]o|t[ãa]|fechou|beleza|blz)\b/.test(txt) ||
        /(quero|vamos|bora).*(cadastr|seguir|finaliz)/i.test(messageText || "");
      if (segueAgora) {
        const ctaMsg = `Show! Pra finalizar seu cadastro, me manda só uma foto da *frente do seu documento* 📄\n\nPode ser RG ou CNH, o que estiver mais à mão.`;
        await sendText(remoteJid, ctaMsg);
        await supabase.from("conversations").insert({
          customer_id: customer.id, message_direction: "outbound",
          message_text: ctaMsg, message_type: "text",
          conversation_step: "aguardando_doc_auto",
        });
        updates.conversation_step = "aguardando_doc_auto";
        (updates as any).__inline_sent = true;
        reply = "";
      } else {
        // Resposta de fallback se a IA não tiver pegado a dúvida acima.
        reply = "Pode mandar sua dúvida que eu te explico 😊 ou diga *pode seguir* pra avançar pro cadastro.";
      }
      break;
    }

    // ─── 3a-AUTO. CAPTURA DE DOC COM DETECÇÃO AUTOMÁTICA DE TIPO ─────
    // Usado pelos passos do FluxoCamila com step_type=capture_documento
    // (auto_detect_doc_type=true). A IA olha a foto e classifica RG/CNH
    // sem perguntar. Se não vier foto ainda, pede a foto.
    case "aguardando_doc_auto": {
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
      let detectedType: "cnh" | "rg_novo" | "rg_antigo" = "rg_antigo";
      let detectConfidence = 0;
      let detectSource: string = "fallback";
      try {
        const det = await (await import("../../_shared/detect-doc-type.ts")).detectDocumentTypeDetailed({
          base64: fileBase64 || undefined,
          mimeType: mime,
          imageUrl: fileUrl?.startsWith("http") ? fileUrl : undefined,
          geminiApiKey,
        });
        detectedType = det.tipo;
        detectConfidence = det.confianca;
        detectSource = det.source;
        console.log(`🤖 [doc-auto] tipo=${detectedType} conf=${detectConfidence.toFixed(2)} source=${detectSource}`);
      } catch (e) {
        console.warn(`⚠️ [doc-auto] falha detectando tipo:`, (e as Error).message);
      }

      // Se a detecção realmente falhou (fallback puro), salva a frente e pergunta ao usuário.
      if (detectSource === "fallback" && detectConfidence === 0) {
        console.warn(`⚠️ [doc-auto] detecção falhou — perguntando RG/CNH ao lead`);
        if (fileBase64) {
          updates.document_front_url = `data:${mime};base64,${fileBase64}`;
          updates.document_front_base64 = fileBase64;
          updates.media_message_id = messageId || null;
          updates.media_storage = "inline";
        } else if (fileUrl) {
          updates.document_front_url = fileUrl.startsWith("http") ? fileUrl : "evolution-media:pending";
        }
        updates.conversation_step = "ask_tipo_documento";
        await sendOptions(remoteJid, "✅ Foto recebida! Só pra confirmar — esse documento é:", [
          { id: "rg", title: "🪪 RG" },
          { id: "cnh", title: "🚗 CNH" },
        ]);
        reply = "";
        break;
      }

      updates.document_type = detectedType;
      // Reaproveita o handler clássico: marca o passo como aguardando_doc_frente
      // e encaminha o processamento para o case já existente abaixo.
      // Aqui só salvamos o tipo + step e devolvemos confirmação curta;
      // a próxima mensagem (ou a mesma se for re-entrada) cai em aguardando_doc_frente.
      // PORÉM: o lead JÁ enviou a foto agora — então processamos imediatamente
      // chamando a mesma lógica do aguardando_doc_frente inline.
      updates.conversation_step = "aguardando_doc_frente";
      // Falha controlada: deixa o switch re-executar via fall-through manual
      // setando step e reescrevendo a lógica seria ruim. Em vez disso, devolvemos
      // uma mensagem curta e aguardamos o próximo evento. Para não perder a foto
      // que já chegou, salvamos a frente aqui mesmo:
      if (fileBase64) {
        updates.document_front_url = `data:${mime};base64,${fileBase64}`;
        updates.document_front_base64 = fileBase64;
        updates.media_message_id = messageId || null;
        updates.media_storage = "inline";
      } else if (fileUrl) {
        updates.document_front_url = fileUrl.startsWith("http") ? fileUrl : "evolution-media:pending";
      }
      // Se for CNH, marca verso "não aplicável" para o pipeline pular o passo.
      // IMPORTANTE: nunca dizemos ao cliente "RG Novo" ou "RG Antigo" — essa
      // distinção é só interna pra decidir se precisa pedir o verso.
      if (detectedType === "cnh") {
        updates.document_back_url = "nao_aplicavel";
        await sendText(remoteJid, "✅ Documento recebido! ⏳ Analisando os dados...");
      } else {
        await sendText(remoteJid, `✅ Documento recebido! ⏳ Analisando a frente...\n\nDepois vou te pedir o *verso*.`);
      }
      // Roda OCR da frente já agora (mesma lógica do aguardando_doc_frente)
      try {
        const docFrenteUrl = fileUrl || updates.document_front_url || "evolution-media:pending";
        const ocrData = await ocrDocumentoFrenteVerso(
          docFrenteUrl,
          detectedType === "cnh" ? "nao_aplicavel" : (customer.document_back_url || ""),
          detectedType === "cnh" ? "CNH" : (detectedType === "rg_novo" ? "RG_NOVO" : "RG_ANTIGO"),
          geminiApiKey,
          fileBase64 || undefined,
          documentMessage || imageMessage,
          undefined,
        );
        if (ocrData.sucesso && ocrData.dados) {
          const d = ocrData.dados;
          { if (d.nome) updates.doc_holder_name = String(d.nome).trim(); const _safe = safeAssignName(customer.name, (customer as any).name_source, d.nome); if (_safe) { updates.name = _safe; updates.name_source = "ocr_doc"; } const _bill = customer.bill_holder_name || updates.bill_holder_name; if (_bill && d.nome) { const _chk = checkHolderMatch(_bill, d.nome); if (!_chk.match) { updates.name_mismatch_flag = true; updates.name_mismatch_reason = `bill="${_bill}" doc="${d.nome}" ${_chk.reason}`; } else { updates.name_mismatch_flag = false; updates.name_mismatch_reason = null; } } }
          if (d.cpf) updates.cpf = d.cpf.replace(/\D/g, "");
          if (d.rg) updates.rg = d.rg;
          const dataConf = String(d.dataNascimentoConfianca || "").toLowerCase();
          if (d.dataNascimento && (detectedType !== "cnh" || dataConf === "alta")) {
            updates.data_nascimento = d.dataNascimento;
          }
          if (d.nomePai) updates.nome_pai = d.nomePai;
          if (d.nomeMae) updates.nome_mae = d.nomeMae;
        }
      } catch (e) {
        console.warn(`[doc-auto] OCR falhou:`, (e as Error).message);
      }
      // CNH → vai direto pra confirmação (ou ask_cpf se faltar CPF). RG → pede verso.
      if (detectedType === "cnh") {
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
        const nome = updates.name || customer.name || "—";
        const cpf = updates.cpf || customer.cpf || "—";
        const rg = updates.rg || customer.rg || "—";
        const nasc = updates.data_nascimento || customer.data_nascimento || "_(será preenchido pelo portal via CPF)_";
        await sendOptions(remoteJid, `📋 *Dados extraídos da CNH:*\n\n👤 Nome: *${nome}*\n🆔 CPF: *${cpf}*\n🪪 RG: *${rg}*\n🎂 Nascimento: *${nasc}*\n\nEstá tudo correto?`, [
          { id: "sim_doc", title: "✅ SIM" },
          { id: "nao_doc", title: "❌ NÃO" },
          { id: "editar_doc", title: "✏️ EDITAR" },
        ]);
        reply = "";
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
        // Não dá break — re-emite o evento? Não dá. Mas como acabamos de salvar o step,
        // o próximo evento (a foto chegou junto) cai em aguardando_doc_auto.
        // Como atalho: já avisa que recebeu.
        await sendText(remoteJid, "📄 Recebi a foto, analisando agora...");
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
        updates.document_front_url = `data:${mime};base64,${fileBase64}`;
        updates.document_front_base64 = fileBase64;
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
            if (d.rg) updates.rg = d.rg;
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
        const nome = updates.name || customer.name || "—";
        const cpf = updates.cpf || customer.cpf || "—";
        const rg = updates.rg || customer.rg || "—";
        const nasc = updates.data_nascimento || customer.data_nascimento || "_(será preenchido pelo portal via CPF)_";
        const chnConfirmMsg = `📋 *Dados extraídos da CNH:*\n\n👤 Nome: *${nome}*\n🆔 CPF: *${cpf}*\n🪪 RG: *${rg}*\n🎂 Nascimento: *${nasc}*\n\nEstá tudo correto?`;
        await sendOptions(remoteJid, chnConfirmMsg, [
          { id: "sim_doc", title: "✅ SIM" },
          { id: "nao_doc", title: "❌ NÃO" },
          { id: "editar_doc", title: "✏️ EDITAR" },
        ]);
        reply = "";
        break;
      }
      updates.conversation_step = "aguardando_doc_verso";
      reply = "✅ Frente recebida!\n\n📸 Agora envie o *VERSO do RG*.\n\nFormatos: JPG, PNG ou PDF";
      break;
    }

    // ─── 5. VERSO ────────
    case "aguardando_doc_verso": {
      if (!isFile) { reply = "📸 Envie o *VERSO do documento*.\n\nFormatos: JPG, PNG ou PDF"; break; }
      if (fileBase64) {
        const mime = imageMessage?.mimetype || documentMessage?.mimetype || "application/octet-stream";
        updates.document_back_url = `data:${mime};base64,${fileBase64}`;
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
          if (d.rg) updates.rg = d.rg;
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

          // Sempre pausa pro card de revisão no painel. Cron de 5 min libera.
          console.log(`[ocr-doc] 📥 marcando review pendente (customer=${customer.id})`);
          updates.ocr_review_pending = "doc";
          updates.ocr_review_started_at = new Date().toISOString();
          updates.ocr_review_decided_at = null;
          updates.ocr_review_decided_by = null;
          reply = "";
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
            "⚠️ Não consegui ler o documento. Envie uma foto mais nítida do *VERSO*.",
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
            reply = ocrFb.retryText;
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
          reply = ocrFb.retryText;
        }
      }
      break;
    }

    // ─── 6. CONFIRMANDO DADOS DOC ─────────
    case "confirmando_dados_doc": {
      const resp = isButton ? buttonId : messageText.toLowerCase().trim();
      if (resp === "sim_doc" || resp === "sim" || resp === "s" || resp === "1" || resp === "ok" || resp === "correto" || resp === "✅") {
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
      const resp: string = isButton ? String(buttonId ?? "") : messageText.toLowerCase().trim();
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
        reply = "Entendido — a conta é em nome de outra pessoa. Vou registrar isso pro consultor revisar na hora do cadastro. ✅\n\n" + getReplyForStep(next, merged);
      } else if (resp === "titular_corrigir" || /corrigir|errado|edit/i.test(resp)) {
        updates.conversation_step = "editing_doc_menu";
        reply = "✏️ O que deseja corrigir?\n\n1️⃣ Nome\n2️⃣ CPF\n3️⃣ RG\n4️⃣ Data de Nascimento\n0️⃣ Cancelar";
      } else {
        const sent = await sendOptions(remoteJid, "Me ajuda a confirmar: é a mesma pessoa, outro titular ou quer corrigir?", [
          { id: "titular_mesmo", title: "Mesma pessoa" },
          { id: "titular_outro", title: "Outro titular" },
          { id: "titular_corrigir", title: "Corrigir" },
        ]);
        if (!sent) reply = "Responda: *mesma pessoa*, *outro titular* ou *corrigir*.";
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
      updates.conversation_step = "confirmando_dados_conta";
      const merged = { ...customer, ...updates };
      await sendOptions(remoteJid, `✅ Nome atualizado: *${v}*\n\n` + buildConfirmacaoConta(merged), [
        { id: "sim_conta", title: "✅ SIM" }, { id: "nao_conta", title: "❌ NÃO" }, { id: "editar_conta", title: "✏️ EDITAR" },
      ]);
      reply = "";
      break;
    }

    case "editing_conta_endereco": {
      const v = messageText.trim();
      if (v.length < 3) { reply = "❌ Endereço muito curto. Digite novamente:"; break; }
      updates.address_street = v;
      updates.conversation_step = "confirmando_dados_conta";
      const merged = { ...customer, ...updates };
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
      const val = parseFloat(messageText.replace(/[^\d.,]/g, "").replace(",", "."));
      if (isNaN(val) || val < 30) { reply = "❌ Valor inválido. Digite um número (ex: 350,50):"; break; }
      updates.electricity_bill_value = val;
      updates.conversation_step = "confirmando_dados_conta";
      const merged = { ...customer, ...updates };
      await sendOptions(remoteJid, `✅ Valor: *R$ ${_formatBRL(val)}*\n\n` + buildConfirmacaoConta(merged), [
        { id: "sim_conta", title: "✅ SIM" }, { id: "nao_conta", title: "❌ NÃO" }, { id: "editar_conta", title: "✏️ EDITAR" },
      ]);
      reply = "";
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
      if (messageText.length < 3) { reply = "Por favor, digite seu *nome completo*."; break; }
      updates.name = messageText.trim();
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
      const resp: string = isButton ? String(buttonId ?? "") : messageText.toLowerCase().trim();
      // Sprint D-B11: "1"/"2" só valem se vieram do botão. Texto livre exige palavra explícita.
      const sim = (isButton && (resp === "sim_phone" || resp === "1"))
        || (!isButton && /^(sim|s|isso|isso\s+mesmo|é\s+meu|eh\s+meu|confirmo|pode|certo|correto|positivo)\b/.test(resp));
      const editar = (isButton && (resp === "editar_phone" || resp === "2"))
        || (!isButton && /^(n[aã]o|n|editar|outro|outro\s+n[uú]mero|trocar|mudar|errado)\b/.test(resp));

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
        const p = (customer.phone_whatsapp || phone).replace(/\D/g, "");
        const num = p.length >= 11 ? p.slice(-11) : p;
        updates.phone_landline = num.length === 11
          ? num.replace(/(\d{2})(\d{5})(\d{4})/, "($1) $2-$3")
          : num.replace(/(\d{2})(\d{4})(\d{4})/, "($1) $2-$3");
        // NÃO atualizar phone_whatsapp — é a chave da conversa e tem unique constraint
        // ✅ Cliente CONFIRMOU explicitamente que o número de WhatsApp é o telefone de contato
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
        console.log(`📧 [ask_phone] Cliente enviou email "${messageText.trim()}" ao invés de telefone — salvando e avançando`);
        updates.email = messageText.trim().toLowerCase();
        // Usar telefone do WhatsApp como telefone de contato (NÃO alterar phone_whatsapp — é chave da conversa)
        const p = (customer.phone_whatsapp || phone).replace(/\D/g, "");
        const num = p.startsWith("55") && p.length >= 12 ? p.substring(2) : p;
        if (num.length >= 10) {
          updates.phone_landline = num.length === 11
            ? num.replace(/(\d{2})(\d{5})(\d{4})/, "($1) $2-$3")
            : num.replace(/(\d{2})(\d{4})(\d{4})/, "($1) $2-$3");
          // NÃO atualizar phone_whatsapp — causa duplicate key violation
          updates.phone_contact_confirmed = true;
        }
        const merged = { ...customer, ...updates };
        const next = await autoResolveCepIfNeeded(merged, updates);
        updates.conversation_step = next;
        reply = getReplyForStep(next, merged);
        break;
      }
      let phoneClean = messageText.replace(/\D/g, "");
      // Aceitar formatos: +55 11 94574-4147, 55 11945744147, (11) 94574-4147, 11945744147
      // Remover prefixo 55 se presente (código do país)
      if (phoneClean.startsWith("55") && phoneClean.length >= 12) {
        phoneClean = phoneClean.substring(2);
      }
      if (phoneClean.length < 10 || phoneClean.length > 11) { reply = "❌ Telefone inválido. Digite com DDD (ex: 11999998888):"; break; }
      // Validar DDD
      const ddd = parseInt(phoneClean.substring(0, 2));
      if (ddd < 11 || ddd > 99) { reply = "❌ DDD inválido. Informe um telefone com DDD válido (ex: 11999998888):"; break; }
      // Buscar telefone do consultor + número da instância conectada para evitar auto-cadastro acidental
      try {
        const [{ data: cons }, { data: inst }] = await Promise.all([
          supabase.from("consultants").select("phone").eq("id", consultorId).maybeSingle(),
          supabase.from("whatsapp_instances").select("connected_phone").eq("consultant_id", consultorId).maybeSingle(),
        ]);
        const blockNumbers = [cons?.phone, inst?.connected_phone].filter(Boolean) as string[];
        if (blockNumbers.some((n) => isSameContact(phoneClean, n))) {
          reply = "❌ Esse telefone é o número do consultor. Por favor, informe *seu próprio telefone* de contato:";
          break;
        }
      } catch (_) { /* segue */ }
      const num11 = phoneClean.length >= 11 ? phoneClean.slice(-11) : phoneClean;
      updates.phone_landline = num11.length === 11
        ? num11.replace(/(\d{2})(\d{5})(\d{4})/, "($1) $2-$3")
        : num11.replace(/(\d{2})(\d{4})(\d{4})/, "($1) $2-$3");
      // ⚠️ NÃO atualizar phone_whatsapp aqui — é a chave da conversa (número real do remetente)
      // e tem unique constraint. Só phone_landline (telefone de contato) muda.
      // updates.phone_whatsapp = normalizePhone(num11);  // REMOVIDO — causa duplicate key
      // ✅ Cliente DIGITOU o telefone — confirmado explicitamente
      updates.phone_contact_confirmed = true;
      const merged = { ...customer, ...updates };
      const next = await autoResolveCepIfNeeded(merged, updates);
      updates.conversation_step = next;
      reply = getReplyForStep(next, merged);
      break;
    }

    case "ask_email": {
      const txt = (messageText || "").trim();
      const lower = txt.toLowerCase();
      // ⚠️ Email é OBRIGATÓRIO no portal iGreen. Não aceitar PULAR.
      if (["pular", "skip", "não tenho", "nao tenho", "sem email", "sem e-mail", "n", "não", "nao"].includes(lower)) {
        reply = "📧 Esse aqui é *importante*! É o login do seu app *iGreen Club* 📱\n\nMe passa um e-mail seu — pode criar rapidinho em qualquer provedor (Gmail, Outlook, iCloud…).";
        break;
      }
      if (!isValidEmailFormat(txt)) {
        reply = "❌ E-mail inválido. Confere o *@* e o domínio (ex: *seunome@gmail.com*):";
        break;
      }
      if (isPlaceholderEmail(txt)) {
        reply = "❌ Esse e-mail parece de teste. Me manda o seu *de verdade*:";
        break;
      }
      // Bloquear email do consultor dono
      try {
        const { data: cons } = await supabase
          .from("consultants")
          .select("igreen_portal_email")
          .eq("id", consultorId)
          .maybeSingle();
        if (cons?.igreen_portal_email && isSameContact(txt, cons.igreen_portal_email)) {
          reply = "❌ Esse é o e-mail do consultor. Preciso de um e-mail *seu*:";
          break;
        }
      } catch (_) { /* segue */ }
      updates.email = txt.toLowerCase();
      const merged = { ...customer, ...updates };
      const next = await autoResolveCepIfNeeded(merged, updates);
      updates.conversation_step = next;
      if (next === "ask_email") {
        reply = "❌ E-mail não aceito. Me manda *outro e-mail seu* (qualquer provedor):";
      } else {
        reply = getReplyForStep(next, merged);
      }
      break;
    }

    case "ask_cep": {
      const cepClean = messageText.replace(/\D/g, "");
      if (cepClean.length !== 8) { reply = "❌ CEP inválido. Informe os *8 números*:"; break; }
      try {
        const viaCepRes = await fetchWithTimeout(`https://viacep.com.br/ws/${cepClean}/json/`, { timeout: TIMEOUT_VIA_CEP });
        const viaCep = await viaCepRes.json();
        if (viaCep.erro) { reply = "❌ CEP não encontrado. Verifique e tente novamente:"; break; }
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
      updates.address_number = messageText.trim();
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
        updates.address_complement = messageText.trim();
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
      // 🚀 Atalho: se o complemento foi o último campo, pula ask_finalizar
      // e dispara a finalização automática (bloco abaixo cuida do envio ao portal).
      if (next === "ask_finalizar") {
        updates.conversation_step = "finalizando";
        reply = "✅ Tudo certo! Processando seu cadastro...";
      } else {
        updates.conversation_step = next;
        reply = getReplyForStep(next, merged);
      }
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
      const val = parseFloat(messageText.replace(/[^\d.,]/g, "").replace(",", "."));
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
        try {
          const { data: _flowRow } = await supabase
            .from("bot_flows").select("id")
            .eq("consultant_id", customer.consultant_id).eq("is_active", true)
            .eq("variant", (customer as any)?.flow_variant || "A").maybeSingle();
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
              await sendText(remoteJid, "Show! Pra finalizar seu cadastro, me manda só uma foto da *frente do seu documento* 📄\n\nPode ser RG ou CNH, o que estiver mais à mão.");
            }
          }
        } catch (e) {
          console.warn("[ask_quero_cadastrar] erro:", (e as Error).message);
        }
        updates.conversation_step = "aguardando_doc_auto";
        reply = "";
      } else {
        const ctaText = "Pra continuar seu cadastro e garantir essa economia, é só tocar no botão abaixo 👇";
        const sent = await sendOptions(remoteJid, ctaText, [
          { id: "btn_quero_cadastrar", title: "✅ Quero me cadastrar" },
        ]);
        if (!sent) reply = "Toque no botão *✅ Quero me cadastrar* acima — ou responda *SIM* para continuar.";
        else reply = "";
      }
      break;
    }

    case "ask_finalizar": {

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

    case "portal_submitting": {
      reply = "⏳ Estamos processando seu cadastro no portal...\n\n📱 Em breve você receberá um *código de verificação no WhatsApp*. Quando receber, *digite aqui*!\n\nAguarde alguns instantes...";
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
      if (confirmou && link) {
        updates.facial_confirmed_at = new Date().toISOString();
        updates.conversation_step = "cadastro_em_analise";
        updates.status = "cadastro_concluido";
        const _firstName = String(customer.name || "").trim().split(/\s+/)[0] || "";
        reply = `🎉 *Validação facial confirmada!*\n\nPrimeiro, parabéns ${_firstName ? _firstName + " " : ""}por dar esse passo rumo à economia! 💚\n\nSeu cadastro foi enviado para a equipe da *iGreen Energy* e agora entra na fila de análise.\n\n⏳ A aprovação costuma sair em *24 a 48 horas úteis*.\n\nAssim que estiver aprovado eu te aviso por aqui com os próximos passos. Pode relaxar — daqui em diante é com a gente. ☀️`;
      } else if (link) {
        reply = "📸 *Última etapa: Validação Facial*\n\n👉 Abra este link no seu celular e siga as instruções:\n" + `${link}\n\n` + "Quando terminar a selfie, me responda *PRONTO* aqui que finalizamos seu cadastro! ✅";
      } else {
        reply = "⏳ Estamos preparando o link da validação facial. Você será notificado em instantes!";
      }
      break;
    }

    case "cadastro_em_analise": {
      // Lead já concluiu a selfie. Aguardando aprovação da iGreen (24-48h).
      // Não voltar para aguardando_conta nem reiniciar fluxo. Só responder educadamente.
      const _firstName = String(customer.name || "").trim().split(/\s+/)[0] || "";
      reply = `Oi${_firstName ? " " + _firstName : ""}! 💚 Seu cadastro ainda está em análise pela equipe da *iGreen Energy*.\n\n⏳ O prazo de aprovação é de *24 a 48 horas úteis* — assim que sair, eu te aviso aqui mesmo.\n\nSe precisar de qualquer coisa enquanto isso, é só chamar! ☀️`;
      break;
    }

    case "complete": {
      // Mensagem padrão se a admin não tiver configurado um passo "finalizar_cadastro"
      // no FluxoCamila. Se tiver, usa o message_text do passo dela.
      let parabens = "✅ Seus dados já foram registrados! Se precisar de algo, um consultor entrará em contato. ☀️";
      try {
        const { data: flow } = await supabase
          .from("bot_flows").select("id")
          .eq("consultant_id", customer.consultant_id || consultorId)
          .eq("is_active", true).eq("variant", (customer as any)?.flow_variant || "A").order("created_at", { ascending: true })
          .limit(1).maybeSingle();
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
            parabens = txt
              .replaceAll("{{nome}}", (customer.name || "").split(/\s+/)[0] || "")
              .replaceAll("{{representante}}", nomeRepresentante || "");
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
          const { data: flow } = await supabase
            .from("bot_flows").select("id")
            .eq("consultant_id", customer.consultant_id)
            .eq("is_active", true).eq("variant", (customer as any)?.flow_variant || "A").maybeSingle();
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
            reply = `👋 Olá! Eu sou o assistente de *${nomeRepresentante}* em parceria com a *iGreen Energy*!\n\n📸 *Envie uma FOTO ou PDF da sua conta de energia* para começarmos!\n\nFormatos aceitos: JPG, PNG ou PDF`;
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
    // ── AUTO-CONFIRM: Se o cliente chegou até aqui pelo WhatsApp e tem telefone válido,
    // garantir que phone_contact_confirmed=true e phone_landline está preenchido.
    // Evita o bug do Valdeir onde o campo não existia na época do cadastro.
    if (!customer.phone_contact_confirmed && !updates.phone_contact_confirmed) {
      const p = (customer.phone_whatsapp || phone || "").replace(/\D/g, "");
      const num = p.startsWith("55") && p.length >= 12 ? p.substring(2) : p;
      if (num.length >= 10) {
        updates.phone_contact_confirmed = true;
        updates.phone_landline = num.length === 11
          ? num.replace(/(\d{2})(\d{5})(\d{4})/, "($1) $2-$3")
          : num.replace(/(\d{2})(\d{4})(\d{4})/, "($1) $2-$3");
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
    const validation = validateCustomerForPortal(merged);
    if (!validation.valid) {
      logStructured("warn", "validation_failed", {
        customer_id: customer.id, step: "finalizando", errors: validation.errors,
      });
      
      // ── ANTI-LOOP: Se já redirecionou 1+ vez, forçar finalização (evita ping-pong ask_email⇄ask_finalizar) ──
      // Usa rescue_attempts como contador (coluna já existente) para não depender de coluna nova
      const redirectCount = customer.rescue_attempts || 0;
      if (redirectCount >= 1) {
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
        reply = "Vou te passar pra um consultor humano agora pra gente finalizar com calma, ok? Em instantes alguém te responde por aqui. 👋";
        return { reply, updates };
      } else {
        updates.rescue_attempts = redirectCount + 1;
        
        let redirected = false;
        for (const err of validation.errors) {
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
        if (err.includes("CEP")) { updates.conversation_step = "ask_cep"; reply = `⚠️ ${err}\n\nQual o seu *CEP*? (8 dígitos)`; redirected = true; break; }
        if (err.includes("rua") || err.includes("Endereço")) { updates.conversation_step = "editing_conta_endereco"; reply = `⚠️ ${err}\n\nDigite o *endereço completo*:`; redirected = true; break; }
        if (err.includes("Número")) { updates.conversation_step = "ask_number"; reply = `⚠️ ${err}\n\nQual o *número* da residência?`; redirected = true; break; }
        if (err.includes("Bairro")) { updates.conversation_step = "editing_conta_endereco"; reply = `⚠️ ${err}\n\nDigite o *endereço completo* (rua, número, bairro):`; redirected = true; break; }
        if (err.includes("Cidade")) { updates.conversation_step = "ask_cep"; reply = `⚠️ ${err}\n\nInforme o *CEP* correto para completar a cidade:`; redirected = true; break; }
        if (err.includes("Estado")) { updates.conversation_step = "ask_cep"; reply = `⚠️ ${err}\n\nInforme o *CEP* correto:`; redirected = true; break; }
        if (err.includes("Valor")) { updates.conversation_step = "ask_bill_value"; reply = `⚠️ ${err}\n\nQual o *valor* da sua conta de luz?`; redirected = true; break; }
        if (err.includes("Foto da conta")) { updates.conversation_step = "aguardando_conta"; reply = `⚠️ ${err}\n\n📸 Envie a foto da conta de energia:`; redirected = true; break; }
        if (err.includes("Documento") && err.includes("frente")) { updates.conversation_step = "ask_doc_frente_manual"; reply = `⚠️ ${err}\n\n📸 Envie a frente do documento:`; redirected = true; break; }
        if (err.includes("Documento") && err.includes("verso")) { updates.conversation_step = "ask_doc_verso_manual"; reply = `⚠️ ${err}\n\n📸 Envie o verso do documento:`; redirected = true; break; }
        if (err.includes("Nome")) { updates.conversation_step = "ask_name"; reply = `⚠️ ${err}\n\nQual é o seu *nome completo*?`; redirected = true; break; }
      }
      if (!redirected) {
        const firstError = validation.errors[0] || "Dados incompletos";
        updates.conversation_step = "ask_name";
        reply = `⚠️ ${firstError}\n\nQual é o seu *nome completo*?`;
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

      if (isTestMode()) {
        reply = "✅ *Teste concluído:* todos os dados foram coletados e o lead chegou ao ponto de envio para o portal.";
        return { reply, updates };
      }

      // ✅ Regenerar igreen_link a partir do cadastro_url do consultor dono
      // (impede o bug em que o lead é submetido com o link de outro consultor)
      if (consultantRow?.igreen_id) {
        let partnerCli: string | null = null;
        if ((customer as any).referral_partner_id) {
          try {
            const { data: partner } = await supabase
              .from("referral_partners")
              .select("cli")
              .eq("id", (customer as any).referral_partner_id)
              .maybeSingle();
            partnerCli = (partner as any)?.cli || null;
          } catch (_) { /* segue sem cli */ }
        }
        updates.igreen_link = buildCadastroLink(consultantRow.igreen_id, partnerCli);
        console.log(`🔗 igreen_link regenerado para consultor dono: ${consultantRow.id}${partnerCli ? ` cli=${partnerCli}` : ""}`);
      } else if (consultantRow?.cadastro_url) {
        updates.igreen_link = consultantRow.cadastro_url;
        console.log(`🔗 igreen_link regenerado para consultor dono: ${consultantRow.id}`);
      }

      console.log(`📝 Salvando updates ANTES do portal worker para ${customer.id}:`, JSON.stringify(updates).substring(0, 500));
      const { error: saveError } = await supabase.from("customers").update(updates).eq("id", customer.id).select();
      if (saveError) console.error(`❌ ERRO ao salvar updates antes do portal:`, saveError);

      await sendText(remoteJid,
        "✅ *Todos os dados coletados com sucesso!* 🎉\n\n" +
        "⏳ Estamos processando seu cadastro no portal...\n\n" +
        "📱 Em breve você receberá um *código de verificação no WhatsApp*. Quando receber, *digite aqui*!"
      );

      console.log(`✅ Lead completo: ${merged.name} (${merged.id}) - disparando worker-portal`);

      // Roteamento + retry + payload Portal2 fica no helper compartilhado.
      // Ele lê consultant.portal_kind do customer e escolhe entre worker-portal (digital)
      // ou worker-portal-2 (autoconexao).
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
        if (!dr.ok && dr.mode !== "not_configured") {
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
export const __test = { sleepForMedia, fetchUrlToBase64, trigramSim, resolveOcrFallback };

