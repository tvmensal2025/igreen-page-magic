/**
 * Testes do gate IA (evaluateIaGate) — só reprovação explícita bloqueia.
 *     node --test worker-portal-2/test/ia-gate.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateIaGate, classifyPortalError } from '../portal-errors.mjs';

test('gate OK fatura legível (shape /extractor/extract, sem is_authentic, ≥2 campos)', () => {
  const r = evaluateIaGate({
    docResp: { success: true, data: { nome: 'JOAO SILVA' } },
    billResp: { success: true, data: { nome_cliente: 'JOAO SILVA', num_instalacao: '13290207' } },
  });
  assert.equal(r.ok, true);
});

test('gate BLOQUEIA fatura ilegível (<2 campos-chave — regra fz do oficial)', () => {
  const r = evaluateIaGate({
    docResp: { success: true, data: { nome: 'JOAO SILVA' } },
    billResp: { success: true, data: { nome_cliente: 'JOAO SILVA' } }, // só 1 campo
  });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'IA_CONTA_ILEGIVEL');
  assert.match(r.reason, /PORTAL_IA_REPROVADA/);
  assert.equal(classifyPortalError(r.reason).kind, 'ia_reprovada');
});

test('gate BLOQUEIA fatura com success=false (arquivo errado/não reconhecido)', () => {
  const r = evaluateIaGate({
    docResp: { success: true, data: { nome: 'JOAO SILVA' } },
    billResp: { success: false, error: 'não foi possível identificar uma fatura de energia' },
  });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'IA_CONTA_ILEGIVEL');
});

test('gate BLOQUEIA fatura success=true mas data vazio', () => {
  const r = evaluateIaGate({
    docResp: { success: true, data: { nome: 'JOAO SILVA' } },
    billResp: { success: true, data: {} },
  });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'IA_CONTA_ILEGIVEL');
});

test('gate OK fatura com exatamente 2 campos (limiar do oficial)', () => {
  const r = evaluateIaGate({
    docResp: { success: true, data: { nome: 'JOAO SILVA' } },
    billResp: { success: true, data: { mes_referencia: '06/2026', valor_fatura: 254.31 } },
  });
  assert.equal(r.ok, true);
});

test('gate OK em erro de transporte', () => {
  const r = evaluateIaGate({
    docResp: { __transport_error: 'timeout' },
    billResp: { __transport_error: 'timeout' },
  });
  assert.equal(r.ok, true);
});

test('gate OK billResp nulo (OCR não rodou — observacional)', () => {
  const r = evaluateIaGate({
    docResp: { success: true, data: { nome: 'JOAO SILVA' } },
    billResp: null,
  });
  assert.equal(r.ok, true);
});

test('gate BLOQUEIA conta is_authentic=false', () => {
  const r = evaluateIaGate({
    docResp: { success: true, data: { nome: 'JOAO DA SILVA' } },
    billResp: { success: true, is_authentic: false, rejection_reason: 'documento adulterado' },
  });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'IA_REPROVADA_CONTA');
  assert.match(r.reason, /PORTAL_IA_REPROVADA/);
});

test('gate BLOQUEIA doc success=false', () => {
  const r = evaluateIaGate({
    docResp: { success: false, error: 'ilegivel' },
    billResp: { success: true, is_authentic: true },
  });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'IA_REPROVADA_DOC');
});

test('gate BLOQUEIA documento vencido', () => {
  const r = evaluateIaGate({
    docResp: { success: true, data: { nome: 'JOAO DA SILVA', validade: '01/01/2020' } },
    billResp: { success: true, is_authentic: true, data: { nome: 'JOAO DA SILVA' } },
  });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'IA_DOC_VENCIDO');
});

test('gate BLOQUEIA titular divergente', () => {
  const r = evaluateIaGate({
    docResp: { success: true, data: { nome: 'VIVIANE APARECIDA DO CARMO' } },
    billResp: { success: true, is_authentic: true, data: { nome: 'BENEDITA DE JESUS GALVAO' } },
  });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'IA_TITULAR_DIVERGENTE');
});

test('gate OK titular com tokens em comum', () => {
  const r = evaluateIaGate({
    docResp: { success: true, data: { nome: 'JEFFERSON SOARES SILVA' } },
    billResp: { success: true, is_authentic: true, data: { nome: 'JEFFERSON SOARES' } },
  });
  assert.equal(r.ok, true);
});

test('classifyPortalError reconhece ia_reprovada', () => {
  const r = classifyPortalError('PORTAL_IA_REPROVADA: Conta reprovada pela IA');
  assert.equal(r.kind, 'ia_reprovada');
  assert.equal(r.recoverable, false);
});

test('F10 classifyPortalError duplicate_document mesmo consultor', () => {
  const r = classifyPortalError('Cliente já cadastrado: mesmo consultor');
  assert.equal(r.kind, 'duplicate_document');
  assert.equal(r.recoverable, false);
});

test('F10 NÃO engole e-mail/celular recuperáveis', () => {
  assert.equal(classifyPortalError('E-mail já cadastrado').kind, 'duplicate_email');
  assert.equal(classifyPortalError('Celular já cadastrado no sistema').kind, 'duplicate_phone');
});
