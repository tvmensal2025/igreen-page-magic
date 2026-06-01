/**
 * Portal 2 (autoconexao) — Classificação de erro + resultado de extração
 *
 * Módulo PURO (sem I/O, sem dependências externas). Isolado para ser testável
 * e reaproveitado por `portal2-api-client.mjs` (cadastrarCliente) e
 * `server.mjs` (processLead).
 *
 * Responsabilidades:
 *   - classifyPortalError(message) → classifica a rejeição do POST /customers
 *     numa Classe_de_Erro estável do conjunto fechado ERROR_KINDS, com
 *     precedência determinística das não-recuperáveis (Req 6).
 *   - buildExtractionResult(...) → deriva o Modo_Extração (auto/manual) a partir
 *     dos retornos dos extractors de documento e conta (Req 1, 2, 3).
 *   - normalizePhone/normalizeInstallation/normalizeEmail → normalização
 *     anti-repetição do loop de correção (Req 9.1).
 *
 * Filosofia: a classificação da extração é OBSERVACIONAL — nunca decide se o
 * cadastro prossegue; só informa o modo e alimenta histórico/loop.
 *
 * Documentação: .kiro/specs/portal2-ocr-feedback-loop/design.md (seção 1).
 */

// ─── Conjunto fechado de Classes de Erro (glossário, Req 6) ──────────────────
// recoverable=true → pode ser resolvido pelo loop de correção via WhatsApp.
// recoverable=false → encaminha direto para intervenção humana (needs_human).
export const ERROR_KINDS = Object.freeze({
  duplicate_phone:        { recoverable: true,  field: 'celular' },
  duplicate_email:        { recoverable: true,  field: 'email' },
  duplicate_installation: { recoverable: true,  field: 'numero_instalacao' },
  missing_consumo:        { recoverable: true,  field: 'media_consumo' },
  duplicate_document:     { recoverable: false },
  no_coverage:            { recoverable: false },
  unknown:                { recoverable: false },
});

// ─── Loop de correção: step + mensagem proativa por classe (Req 7.1) ─────────
// Espelha o CORRECTION_MAP de `_shared/portal-correction.ts` (bot). O worker usa
// isto para, ao rotear `awaiting_correction`, abrir o `conversation_step` certo
// e ENVIAR a pergunta proativamente ao cliente (antes era só reativo — o lead
// ficava parado esperando um OTP que nunca chegava). `missing_consumo` é
// auto-corrigido inline pelo bot (step portal_submitting), não tem step próprio.
export const CORRECTION_PROMPTS = Object.freeze({
  duplicate_phone: {
    step: 'corrigir_celular_portal',
    prompt: 'Esse celular já consta no sistema. Me envia outro número de celular (com DDD) pra concluir.',
  },
  duplicate_email: {
    step: 'corrigir_email_portal',
    prompt: 'Esse e-mail já está cadastrado. Me envia um e-mail diferente.',
  },
  duplicate_installation: {
    step: 'corrigir_instalacao_portal',
    prompt: 'O número de instalação não foi aceito. Confere na conta e me envia de novo (7+ dígitos).',
  },
});

// ─── Utilitários internos ────────────────────────────────────────────────────
const isObject = v => v != null && typeof v === 'object' && !Array.isArray(v);

/**
 * Extrai a mensagem de erro de um retorno de extractor.
 * `__transport_error` (erro de transporte/HTTP/timeout) tem prioridade.
 */
function extractError(resp) {
  if (!isObject(resp)) return null;
  if (resp.__transport_error) return String(resp.__transport_error);
  if (resp.error) return String(resp.error);
  return null;
}

/** Normaliza `corrections` para sempre ser um array. */
function extractCorrections(resp) {
  if (!isObject(resp)) return [];
  const c = resp.corrections;
  if (Array.isArray(c)) return c;
  return c ? [c] : [];
}

// ─── Classificação de erro (Req 6) ───────────────────────────────────────────
/**
 * Classifica a mensagem de detalhe de uma rejeição do Portal 2 em EXATAMENTE
 * UMA Classe_de_Erro do conjunto fechado ERROR_KINDS.
 *
 * A correspondência é textual case-insensitive. A ordem de avaliação coloca as
 * classes NÃO-recuperáveis (duplicate_document, no_coverage) ANTES das
 * recuperáveis, garantindo precedência determinística quando a mensagem casa
 * com mais de uma classe (Req 6.10).
 *
 * @param {string} message
 * @returns {{ kind: string, recoverable: boolean }}
 */
export function classifyPortalError(message) {
  const text = String(message ?? '').toLowerCase();
  const has = needle => text.includes(needle);
  const hasAny = (...needles) => needles.some(n => text.includes(n));

  // Sinal genérico de "já cadastrado / duplicado / existe".
  const dup = () => hasAny('já', 'existe', 'duplicad', 'cadastrad', 'duplicat');

  let kind;

  // ── 1) Não-recuperáveis (precedência, Req 6.10) ──
  // duplicate_document — CPF/documento já cadastrado (não se troca CPF). Req 6.5
  if (has('duplicatedocument') || (hasAny('cpf', 'documento') && dup())) {
    kind = 'duplicate_document';
  // no_coverage — sem cobertura ativa / UF/região não atendida. Req 6.6
  } else if (hasAny('nenhuma cobertura ativa', 'sem cobertura', 'não atendid', 'nao atendid', 'sem regra ativa', 'cobertura ativa')) {
    kind = 'no_coverage';

  // ── 2) Recuperáveis ──
  // duplicate_phone — celular/telefone já cadastrado. Req 6.2
  } else if (has('duplicatephone') || (hasAny('celular', 'telefone') && dup())) {
    kind = 'duplicate_phone';
  // duplicate_email — email já cadastrado. Req 6.3
  } else if (has('duplicateemail') || (hasAny('email', 'e-mail') && dup())) {
    kind = 'duplicate_email';
  // duplicate_installation — instalação duplicada/inválida. Req 6.4
  } else if (
    has('check-installation') ||
    (hasAny('instala', 'installation') && (dup() || hasAny('inválid', 'invalid')))
  ) {
    kind = 'duplicate_installation';
  // missing_consumo — consumo médio não informado. Req 6.9
  } else if (has('consumo') && hasAny('não informado', 'nao informado')) {
    kind = 'missing_consumo';

  // ── 3) Desconhecido → não-recuperável (Req 6.7) ──
  } else {
    kind = 'unknown';
  }

  return { kind, recoverable: ERROR_KINDS[kind].recoverable };
}

// ─── Resultado da extração / Modo_Extração (Req 1, 2, 3) ─────────────────────
/**
 * Um retorno de extractor de DOCUMENTO é Extração_Aceita_Automática quando é um
 * objeto com `success===true`, sem `error` preenchido e sem erro de transporte.
 * Objeto nulo/vazio/sem `success` → manual (Req 1.2, 1.3).
 */
function isDocAuto(resp) {
  return isObject(resp)
    && !resp.__transport_error
    && resp.success === true
    && !resp.error;
}

/**
 * Avalia o retorno do extractor de CONTA. Auto somente quando
 * `success===true && is_authentic===true && !error` (Req 2.2); qualquer outra
 * combinação (success/is_authentic ausente, error preenchido, nulo/vazio,
 * erro de transporte) → manual (Req 2.3).
 */
function evaluateBill(resp) {
  const auto = isObject(resp)
    && !resp.__transport_error
    && resp.success === true
    && resp.is_authentic === true
    && !resp.error;
  return {
    success: isObject(resp) && resp.success === true,
    mode: auto ? 'auto' : 'manual',
    error: extractError(resp),
    corrections: extractCorrections(resp),
    is_authentic: isObject(resp) && resp.is_authentic === true,
    rejection_reason: isObject(resp) ? (resp.rejection_reason ?? null) : null,
  };
}

/**
 * Deriva o resultado consolidado da extração de um cadastro.
 *
 * Regras (Req 1.2/1.3/1.5, 2.2/2.3/2.5, 3.1/3.2):
 *   - documento `auto` quando a frente (e o verso, se RG) têm `success===true`
 *     sem `error`; CNH (isCnh) não exige verso.
 *   - conta `auto` quando `success===true && is_authentic===true && !error`.
 *   - objeto nulo/vazio/sem `success` ou `__transport_error` → `manual`.
 *   - `mode` do cadastro é `auto` apenas quando documento E conta são `auto`.
 *   - `billAlreadyExtracted=true`: a conta NÃO é reavaliada por uma nova chamada;
 *     o resultado já registrado (passado em `billResp`) é preservado e marcado
 *     com `preserved:true`.
 *
 * @param {object}  params
 * @param {object=} params.docResp      retorno do extractor da frente do documento
 * @param {object=} params.docBackResp  retorno do extractor do verso (RG)
 * @param {object=} params.billResp     retorno do extractor da conta (ou resultado já registrado)
 * @param {boolean=} params.isCnh       documento é CNH (não tem verso)
 * @param {boolean=} params.billAlreadyExtracted  conta já extraída externamente (server.mjs)
 * @returns {{ mode: 'auto'|'manual', doc: object, bill: object }}
 */
export function buildExtractionResult({ docResp, docBackResp, billResp, isCnh, billAlreadyExtracted } = {}) {
  // ── Documento (frente + verso quando RG) ──
  const frontAuto = isDocAuto(docResp);
  const requiresBack = !isCnh;
  const backAuto = requiresBack ? isDocAuto(docBackResp) : true;
  const docAuto = frontAuto && backAuto;

  const doc = {
    success: docAuto,
    mode: docAuto ? 'auto' : 'manual',
    error: extractError(docResp) ?? (requiresBack ? extractError(docBackResp) : null),
    corrections: [
      ...extractCorrections(docResp),
      ...(requiresBack ? extractCorrections(docBackResp) : []),
    ],
  };

  // ── Conta de energia ──
  const bill = evaluateBill(billResp);
  if (billAlreadyExtracted) {
    // Req 2.5 — preserva o resultado já registrado; não reavalia via novo OCR.
    bill.preserved = true;
  }

  // ── Modo do cadastro (Req 3.1/3.2) ──
  const mode = (doc.mode === 'auto' && bill.mode === 'auto') ? 'auto' : 'manual';

  return { mode, doc, bill };
}

// ─── Normalização anti-repetição (Req 9.1) ───────────────────────────────────
/** Telefone/celular → somente dígitos (desconsidera espaços e símbolos). */
export function normalizePhone(value) {
  return String(value ?? '').replace(/\D/g, '');
}

/** Número de instalação → somente dígitos. */
export function normalizeInstallation(value) {
  return String(value ?? '').replace(/\D/g, '');
}

/** Email → trim + lowercase. */
export function normalizeEmail(value) {
  return String(value ?? '').trim().toLowerCase();
}
