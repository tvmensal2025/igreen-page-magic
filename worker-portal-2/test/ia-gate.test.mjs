/**
 * Testes do gate IA (evaluateIaGate) — só reprovação explícita bloqueia.
 *     node --test worker-portal-2/test/ia-gate.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateIaGate, classifyPortalError } from '../portal-errors.mjs';

test('gate OK quando OCR incompleto (sem is_authentic)', () => {
  const r = evaluateIaGate({
    docResp: { success: true, data: { nome: 'JOAO SILVA' } },
    billResp: { success: true, data: { nome: 'JOAO SILVA' } },
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
