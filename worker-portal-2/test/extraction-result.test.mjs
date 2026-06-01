/**
 * Property-based test — buildExtractionResult (worker-portal-2/portal-errors.mjs)
 *
 * Spec: .kiro/specs/portal2-ocr-feedback-loop/
 * Task 1.3 — Property 1: Não-bloqueio da extração (classificação observacional)
 * **Validates: Requirements 1.6, 3.1, 3.2**
 *
 * Estratégia: o espaço de entrada de `buildExtractionResult` é pequeno e finito
 * (frente do documento × verso × isCnh × conta × billAlreadyExtracted). Em vez
 * de amostragem aleatória, enumeramos EXAUSTIVAMENTE toda a matriz de
 * combinações — uma garantia mais forte que PBT por amostragem para um domínio
 * finito. Não há framework de teste no worker (só `node`); usamos o runner
 * nativo `node:test` (ESM). Executar com:
 *
 *     node --test worker-portal-2/test/extraction-result.test.mjs
 *
 * Property 1 (observacional): a extração nunca produz um estado indefinido — o
 * `mode` do cadastro (e o de cada extractor) é SEMPRE 'auto' ou 'manual',
 * jamais undefined/null, para qualquer combinação de entradas. Isso reflete que
 * a classificação é puramente observacional: ela sempre resolve para um modo e
 * jamais bloqueia/indefine o fluxo de criação do cliente (Req 1.6). O modo do
 * cadastro é 'auto' somente quando documento E conta são 'auto' (Req 3.1/3.2).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildExtractionResult } from '../portal-errors.mjs';

// ─── Geradores de variantes de retorno de extractor ──────────────────────────
// Cobrem: nulo/indefinido, objeto vazio (sem `success`), success false/true,
// `error` preenchido/nulo, `is_authentic` ausente/false/true, e o marcador de
// erro de transporte `__transport_error`.

const DOC_VARIANTS = [
  { label: 'null', value: null },
  { label: 'undefined', value: undefined },
  { label: 'empty-object', value: {} },
  { label: 'success-false', value: { success: false } },
  { label: 'success-true', value: { success: true } },
  { label: 'success-true-error', value: { success: true, error: 'ilegível' } },
  { label: 'success-true-error-null', value: { success: true, error: null } },
  { label: 'success-false-error', value: { success: false, error: 'falhou' } },
  { label: 'transport-error', value: { __transport_error: 'ECONNRESET' } },
  { label: 'success-string', value: { success: 'true' } }, // não é boolean true → manual
];

const BILL_VARIANTS = [
  { label: 'null', value: null },
  { label: 'undefined', value: undefined },
  { label: 'empty-object', value: {} },
  { label: 'success-false', value: { success: false } },
  { label: 'success-true-no-auth', value: { success: true } }, // is_authentic ausente
  { label: 'success-true-auth-true', value: { success: true, is_authentic: true } },
  { label: 'success-true-auth-false', value: { success: true, is_authentic: false } },
  { label: 'success-true-auth-true-error', value: { success: true, is_authentic: true, error: 'x' } },
  { label: 'auth-true-success-missing', value: { is_authentic: true } },
  { label: 'transport-error', value: { __transport_error: 'timeout' } },
];

// ─── Oráculo independente (expressa as cláusulas dos requisitos) ──────────────
// Reescrito a partir dos critérios de aceitação (NÃO copia a implementação),
// servindo de oráculo para o `mode` esperado.

const isObj = v => v != null && typeof v === 'object' && !Array.isArray(v);

// Req 1.2/1.3/1.5: documento é auto quando frente (e verso, se RG) têm
// success===true, sem error preenchido e sem erro de transporte.
function docFrontAuto(resp) {
  return isObj(resp) && !resp.__transport_error && resp.success === true && !resp.error;
}

function expectedDocAuto(docResp, docBackResp, isCnh) {
  const frontAuto = docFrontAuto(docResp);
  const backAuto = isCnh ? true : docFrontAuto(docBackResp); // RG exige verso; CNH não
  return frontAuto && backAuto;
}

// Req 2.2/2.3: conta é auto quando success===true && is_authentic===true && !error.
function expectedBillAuto(billResp) {
  return isObj(billResp)
    && !billResp.__transport_error
    && billResp.success === true
    && billResp.is_authentic === true
    && !billResp.error;
}

// Req 3.1/3.2: cadastro auto somente quando doc E conta são auto.
function expectedCadastroMode(docAuto, billAuto) {
  return (docAuto && billAuto) ? 'auto' : 'manual';
}

const VALID_MODES = new Set(['auto', 'manual']);

// ─── Property 1 (exaustiva): mode sempre ∈ {auto, manual} e bate com o oráculo ─
test('Property 1: toda combinação produz mode auto|manual (nunca indefinido) e bate com o oráculo', () => {
  let combos = 0;

  for (const doc of DOC_VARIANTS) {
    for (const back of DOC_VARIANTS) {
      for (const isCnh of [true, false]) {
        for (const bill of BILL_VARIANTS) {
          for (const billAlreadyExtracted of [false, true]) {
            combos++;

            const result = buildExtractionResult({
              docResp: doc.value,
              docBackResp: back.value,
              billResp: bill.value,
              isCnh,
              billAlreadyExtracted,
            });

            const ctx = `doc=${doc.label} back=${back.label} isCnh=${isCnh} bill=${bill.label} preExtracted=${billAlreadyExtracted}`;

            // — Núcleo da Property 1: nunca indefinido —
            assert.ok(
              VALID_MODES.has(result.mode),
              `cadastro.mode deve ser 'auto'|'manual' (nunca indefinido) | ${ctx} → ${result.mode}`
            );
            assert.ok(
              VALID_MODES.has(result.doc.mode),
              `doc.mode deve ser 'auto'|'manual' (nunca indefinido) | ${ctx} → ${result.doc.mode}`
            );
            assert.ok(
              VALID_MODES.has(result.bill.mode),
              `bill.mode deve ser 'auto'|'manual' (nunca indefinido) | ${ctx} → ${result.bill.mode}`
            );

            // — Concordância com o oráculo de requisitos —
            const docAuto = expectedDocAuto(doc.value, back.value, isCnh);
            const billAuto = expectedBillAuto(bill.value);

            assert.equal(
              result.doc.mode, docAuto ? 'auto' : 'manual',
              `doc.mode esperado | ${ctx}`
            );
            assert.equal(
              result.bill.mode, billAuto ? 'auto' : 'manual',
              `bill.mode esperado | ${ctx}`
            );
            assert.equal(
              result.mode, expectedCadastroMode(docAuto, billAuto),
              `cadastro.mode esperado (auto só se doc E conta auto) | ${ctx}`
            );

            // — billAlreadyExtracted preserva o resultado (Req 2.5) —
            // A conta NÃO é reavaliada por novo OCR: o resultado passado é
            // preservado (flag preserved=true) e o modo continua derivado de
            // billResp (mesmo modo que sem a flag).
            if (billAlreadyExtracted) {
              assert.equal(
                result.bill.preserved, true,
                `bill.preserved deve ser true quando billAlreadyExtracted | ${ctx}`
              );
            } else {
              assert.notEqual(
                result.bill.preserved, true,
                `bill.preserved não deve ser true sem billAlreadyExtracted | ${ctx}`
              );
            }
          }
        }
      }
    }
  }

  // Sanidade: confirma que a matriz exaustiva foi de fato percorrida.
  const expectedCombos = DOC_VARIANTS.length * DOC_VARIANTS.length * 2 * BILL_VARIANTS.length * 2;
  assert.equal(combos, expectedCombos, 'a matriz exaustiva deve cobrir todas as combinações');
});

// ─── billAlreadyExtracted preserva o resultado, auto e manual ─────────────────
test('billAlreadyExtracted=true preserva o resultado passado (auto e manual)', () => {
  // conta autêntica já extraída externamente → preservada como auto
  const autoBill = buildExtractionResult({
    docResp: { success: true },
    isCnh: true,
    billResp: { success: true, is_authentic: true },
    billAlreadyExtracted: true,
  });
  assert.equal(autoBill.bill.preserved, true);
  assert.equal(autoBill.bill.mode, 'auto');
  assert.equal(autoBill.mode, 'auto');

  // conta não-autêntica já extraída externamente → preservada como manual
  const manualBill = buildExtractionResult({
    docResp: { success: true },
    isCnh: true,
    billResp: { success: true, is_authentic: false },
    billAlreadyExtracted: true,
  });
  assert.equal(manualBill.bill.preserved, true);
  assert.equal(manualBill.bill.mode, 'manual');
  assert.equal(manualBill.mode, 'manual');
});

// ─── Casos representativos nomeados (oráculo pontual) ─────────────────────────
test('caminho feliz CNH (frente auto + conta autêntica, sem verso) → auto', () => {
  const r = buildExtractionResult({
    docResp: { success: true, data: { tipo_documento: 'CNH' } },
    isCnh: true,
    billResp: { success: true, is_authentic: true },
  });
  assert.equal(r.doc.mode, 'auto');
  assert.equal(r.bill.mode, 'auto');
  assert.equal(r.mode, 'auto');
});

test('RG sem verso (frente auto, verso ausente) → manual', () => {
  const r = buildExtractionResult({
    docResp: { success: true },
    docBackResp: null,
    isCnh: false,
    billResp: { success: true, is_authentic: true },
  });
  assert.equal(r.doc.mode, 'manual');
  assert.equal(r.mode, 'manual');
});

test('RG com frente e verso auto → auto', () => {
  const r = buildExtractionResult({
    docResp: { success: true },
    docBackResp: { success: true },
    isCnh: false,
    billResp: { success: true, is_authentic: true },
  });
  assert.equal(r.doc.mode, 'auto');
  assert.equal(r.mode, 'auto');
});

test('conta não autêntica → manual', () => {
  const r = buildExtractionResult({
    docResp: { success: true },
    isCnh: true,
    billResp: { success: true, is_authentic: false, rejection_reason: 'documento adulterado' },
  });
  assert.equal(r.bill.mode, 'manual');
  assert.equal(r.bill.rejection_reason, 'documento adulterado');
  assert.equal(r.mode, 'manual');
});

test('conta nula → manual', () => {
  const r = buildExtractionResult({
    docResp: { success: true },
    isCnh: true,
    billResp: null,
  });
  assert.equal(r.bill.mode, 'manual');
  assert.equal(r.mode, 'manual');
});

test('erro de transporte no documento → manual (não bloqueia, apenas classifica)', () => {
  const r = buildExtractionResult({
    docResp: { __transport_error: 'ECONNRESET' },
    isCnh: true,
    billResp: { success: true, is_authentic: true },
  });
  assert.equal(r.doc.mode, 'manual');
  assert.equal(r.mode, 'manual');
  // Property 1: mesmo em erro de transporte o modo é definido (nunca indefinido)
  assert.ok(VALID_MODES.has(r.mode));
});
