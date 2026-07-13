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
  attachment_not_confirmed:{ recoverable: false },
  // IA da iGreen reprovou conta/doc (is_authentic=false, doc error, validade
  // vencida, mismatch titular). Não é retry de payload — precisa humano.
  ia_reprovada:           { recoverable: false },
  validation_error:       { recoverable: false },
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

// ─── Legibilidade da fatura — espelho EXATO do gate oficial ──────────────────
// Bundle oficial (index-CmAOjN-p.js): uz=[nome_cliente,num_instalacao,
// mes_referencia,valor_fatura], dz=2, fz(data) → count(campos preenchidos)>=2.
// Se fz falha, o portal oficial marca "conta ilegível" e BLOQUEIA o avanço.
export const INVOICE_KEY_FIELDS = Object.freeze([
  'nome_cliente', 'num_instalacao', 'mes_referencia', 'valor_fatura',
]);
export const INVOICE_MIN_LEGIBLE_FIELDS = 2;

/** Conta quantos campos-chave da fatura vieram preenchidos no OCR. */
export function countInvoiceLegibleFields(data) {
  if (!isObject(data)) return 0;
  return INVOICE_KEY_FIELDS.filter((k) => data[k] != null && data[k] !== '').length;
}

/**
 * Shape de FATURA (/extractor/extract) vs COMPROVANTE (extract-receipt):
 * o comprovante sempre traz o veredito `is_authentic`; a fatura nunca.
 */
function isInvoiceShape(resp) {
  return isObject(resp) && !('is_authentic' in resp);
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
  // F10: "Cliente já cadastrado: mesmo consultor" caía em unknown.
  // NÃO usar "já cadastrado" sozinho — isso engolia e-mail/celular recuperáveis.
  if (
    has('duplicatedocument') ||
    (hasAny('cpf', 'documento') && dup()) ||
    (has('cliente já cadastrado') || has('cliente ja cadastrado')) ||
    (dup() && hasAny('mesmo consultor', 'mesmo_consultor'))
  ) {
    kind = 'duplicate_document';
  // no_coverage — sem cobertura ativa / UF/região não atendida. Req 6.6
  } else if (hasAny('nenhuma cobertura ativa', 'sem cobertura', 'não atendid', 'nao atendid', 'sem regra ativa', 'cobertura ativa')) {
    kind = 'no_coverage';
  // attachment_not_confirmed — OCR leu, mas o Portal não confirmou anexo físico.
  } else if (hasAny('portal_attachments_not_confirmed', 'attachment_not_confirmed', 'anexos obrigatórios não confirmados', 'anexos obrigatorios nao confirmados')) {
    kind = 'attachment_not_confirmed';
  // ia_reprovada — veredito explícito da IA (conta/doc) antes do POST /customers.
  } else if (hasAny('ia_reprovada', 'portal_ia_reprovada', 'conta reprovada pela ia', 'documento reprovado pela ia', 'titular divergente', 'documento vencido')) {
    kind = 'ia_reprovada';

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

  // ── 3) Erro de validação de payload (400/422) — não-recuperável, sem retry.
  // Qualquer mismatch de schema (Too small / expected string / etc) cai aqui
  // pra evitar loop infinito do BullMQ no mesmo lead.
  } else if (
    hasAny('erro de validação', 'erro de validacao', 'too small', 'too big',
           'expected string', 'expected number', 'unprocessable', 'invalid input',
           'validation failed')
  ) {
    kind = 'validation_error';

  // ── 4) Desconhecido → não-recuperável (Req 6.7) ──
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
 * Avalia o retorno do OCR da CONTA (Req 2.2 revisado 2026-07-13).
 *
 * Dois shapes possíveis:
 *   - FATURA (/extractor/extract, shape oficial, sem `is_authentic`):
 *     auto quando `success===true && !error` E legível em ≥2 campos-chave
 *     (regra fz do portal oficial — mesma régua do gate IA_CONTA_ILEGIVEL).
 *   - COMPROVANTE (extract-receipt, traz `is_authentic`): auto exige
 *     `success===true && is_authentic===true && !error` (regra original).
 * Nulo/vazio/transporte → manual.
 */
function evaluateBill(resp) {
  const base = isObject(resp)
    && !resp.__transport_error
    && resp.success === true
    && !resp.error;
  const auto = base && (isInvoiceShape(resp)
    ? countInvoiceLegibleFields(resp.data) >= INVOICE_MIN_LEGIBLE_FIELDS
    : resp.is_authentic === true);
  return {
    success: isObject(resp) && resp.success === true,
    mode: auto ? 'auto' : 'manual',
    error: extractError(resp),
    corrections: extractCorrections(resp),
    is_authentic: isObject(resp) ? (resp.is_authentic ?? null) : null,
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

/**
 * Gate da IA iGreen — só bloqueia reprovação EXPLÍCITA (não OCR incompleto).
 *
 * Bloqueia POST /customers quando:
 *   1)  comprovante com `is_authentic === false` (reprovado)
 *   1b) fatura (/extractor/extract) com `success===false`/`error`, ou legível
 *       em menos de 2 campos-chave — espelho do gate fz() do portal oficial
 *       (conta ilegível/arquivo errado NÃO pode passar)
 *   2)  documento com `success === false` ou `error` (sem ser só transporte)
 *   3)  validade do documento vencida
 *   4)  titular doc × conta claramente divergente (ambos nomes presentes)
 *
 * NÃO bloqueia quando OCR falhou por timeout/transporte (observacional).
 *
 * @returns {{ ok: true } | { ok: false, reason: string, code: string, details?: object }}
 */
export function evaluateIaGate({ docResp, billResp, dados } = {}) {
  const details = {};

  // 1) Conta explicitamente reprovada pela IA
  if (isObject(billResp) && !billResp.__transport_error && billResp.is_authentic === false) {
    const reason = billResp.rejection_reason
      ? `Conta reprovada pela IA: ${billResp.rejection_reason}`
      : 'Conta reprovada pela IA (is_authentic=false)';
    return {
      ok: false,
      code: 'IA_REPROVADA_CONTA',
      reason: `PORTAL_IA_REPROVADA: ${reason}`,
      details: { rejection_reason: billResp.rejection_reason ?? null },
    };
  }

  // 1b) Fatura (/extractor/extract) reprovada ou ilegível — espelho do gate
  // oficial fz(): sem `success` ou com menos de 2 campos-chave legíveis
  // (nome_cliente/num_instalacao/mes_referencia/valor_fatura), o portal
  // oficial BLOQUEIA e pede nova foto. Sem isso, conta ilegível/arquivo
  // errado no slot da conta passaria direto pro POST /customers.
  // Erro de transporte continua NÃO bloqueando (observacional).
  if (isInvoiceShape(billResp) && !billResp.__transport_error) {
    if (billResp.success === false || (billResp.error && billResp.success !== true)) {
      return {
        ok: false,
        code: 'IA_CONTA_ILEGIVEL',
        reason: `PORTAL_IA_REPROVADA: Conta reprovada pela IA: ${extractError(billResp) || 'success=false'}`,
        details: { error: extractError(billResp) },
      };
    }
    if (billResp.success === true) {
      const legible = countInvoiceLegibleFields(billResp.data);
      if (legible < INVOICE_MIN_LEGIBLE_FIELDS) {
        return {
          ok: false,
          code: 'IA_CONTA_ILEGIVEL',
          reason: `PORTAL_IA_REPROVADA: Conta reprovada pela IA: fatura ilegível — só ${legible}/${INVOICE_KEY_FIELDS.length} campos-chave legíveis (mínimo ${INVOICE_MIN_LEGIBLE_FIELDS}; regra fz do portal oficial)`,
          details: { legible_fields: legible, data_keys: isObject(billResp.data) ? Object.keys(billResp.data) : [] },
        };
      }
    }
  }

  // 2) Documento explicitamente falhou (não transporte)
  if (isObject(docResp) && !docResp.__transport_error) {
    if (docResp.success === false || (docResp.error && docResp.success !== true)) {
      return {
        ok: false,
        code: 'IA_REPROVADA_DOC',
        reason: `PORTAL_IA_REPROVADA: Documento reprovado pela IA: ${extractError(docResp) || 'success=false'}`,
        details: { error: extractError(docResp) },
      };
    }

    // 3) Validade vencida
    const validade = docResp?.data?.validade || docResp?.validade;
    if (validade) {
      const m = String(validade).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      if (m) {
        const exp = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), 23, 59, 59);
        if (Number.isFinite(exp.getTime()) && exp.getTime() < Date.now()) {
          return {
            ok: false,
            code: 'IA_DOC_VENCIDO',
            reason: `PORTAL_IA_REPROVADA: Documento vencido (${validade})`,
            details: { validade },
          };
        }
      }
    }
  }

  // 4) Mismatch titular — só quando os dois nomes existem e divergem de verdade
  const normName = (s) => String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const tokens = (s) => normName(s).split(' ').filter((t) => t.length >= 3);
  // `nome` = shape do extract-receipt (comprovante); `nome_cliente` = shape do
  // /extractor/extract (fatura oficial).
  const docName = docResp?.data?.nome || docResp?.nome || dados?.nome || '';
  const billName = billResp?.data?.nome || billResp?.data?.nome_cliente || billResp?.nome || '';
  const docTok = tokens(docName);
  const billTok = tokens(billName);
  if (docTok.length >= 2 && billTok.length >= 2) {
    const docSet = new Set(docTok);
    const shared = billTok.filter((t) => docSet.has(t));
    // Exige pelo menos 2 tokens em comum (nome+sobrenome) — senão divergente
    if (shared.length < 2) {
      details.docName = docName;
      details.billName = billName;
      details.shared = shared;
      return {
        ok: false,
        code: 'IA_TITULAR_DIVERGENTE',
        reason: `PORTAL_IA_REPROVADA: Titular divergente (doc="${docName}" × conta="${billName}")`,
        details,
      };
    }
  }

  return { ok: true };
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
