/**
 * Testes unitários das normalizações anti-repetição (Req 9.1)
 *
 * Módulo sob teste: ../portal-errors.mjs
 *   - normalizePhone(value)        → somente dígitos
 *   - normalizeInstallation(value) → somente dígitos
 *   - normalizeEmail(value)        → trim + lowercase
 *
 * Runner nativo do Node (ESM): `node --test worker-portal-2/test/normalize.test.mjs`
 *
 * Foco (Req 9.1): a normalização é a base da anti-repetição do loop de correção.
 * Dois valores formatados de forma diferente, porém equivalentes, DEVEM normalizar
 * para a mesma string — é assim que o bot detecta que o cliente reenviou o mesmo
 * dado já rejeitado.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizePhone,
  normalizeInstallation,
  normalizeEmail,
} from '../portal-errors.mjs';

// ─── normalizePhone: reduz a dígitos ─────────────────────────────────────────
test('normalizePhone: strips spaces, parentheses, dashes and plus signs', () => {
  assert.equal(normalizePhone('(11) 99999-8888'), '11999998888');
  assert.equal(normalizePhone('+55 11 99999-8888'), '5511999998888');
  assert.equal(normalizePhone('11 9 9999 8888'), '11999998888');
  assert.equal(normalizePhone('11.99999.8888'), '11999998888');
});

test('normalizePhone: keeps an already-clean digit string unchanged', () => {
  assert.equal(normalizePhone('11999998888'), '11999998888');
});

test('normalizePhone: strips every non-digit character', () => {
  assert.equal(normalizePhone('tel: +55 (11) 99999-8888 ramal 3'), '5511999998888' + '3');
  assert.equal(normalizePhone('abc'), '');
});

// ─── normalizeInstallation: reduz a dígitos ──────────────────────────────────
test('normalizeInstallation: strips spaces, dashes and letters down to digits', () => {
  assert.equal(normalizeInstallation('0012-3456-78'), '001234567' + '8');
  assert.equal(normalizeInstallation(' 123 456 7 '), '1234567');
  assert.equal(normalizeInstallation('INST-7654321'), '7654321');
});

test('normalizeInstallation: keeps an already-clean digit string unchanged', () => {
  assert.equal(normalizeInstallation('1234567'), '1234567');
});

// ─── normalizeEmail: trim + lowercase ────────────────────────────────────────
test('normalizeEmail: trims surrounding whitespace and lowercases', () => {
  assert.equal(normalizeEmail('  User@Example.COM '), 'user@example.com');
  assert.equal(normalizeEmail('FOO@BAR.com'), 'foo@bar.com');
  assert.equal(normalizeEmail('\tCliente@Dominio.com.BR\n'), 'cliente@dominio.com.br');
});

test('normalizeEmail: keeps an already-normalized email unchanged', () => {
  assert.equal(normalizeEmail('user@example.com'), 'user@example.com');
});

test('normalizeEmail: only trims the ends, internal spacing is preserved as-is', () => {
  // não há espaços internos válidos em e-mails reais, mas o contrato é trim apenas
  assert.equal(normalizeEmail('   a@b.co   '), 'a@b.co');
});

// ─── Igualdade após normalização (base da anti-repetição, Req 9.1) ───────────
test('phone equality: two differently-formatted representations normalize equal', () => {
  assert.equal(
    normalizePhone('(11) 99999-8888'),
    normalizePhone('11999998888'),
  );
  assert.equal(
    normalizePhone('+55 11 99999 8888'),
    normalizePhone('55 (11) 99999-8888'),
  );
});

test('installation equality: differently-formatted representations normalize equal', () => {
  assert.equal(
    normalizeInstallation('0012-3456-78'),
    normalizeInstallation('00 1234 5678'),
  );
});

test('email equality: case/whitespace variants normalize equal', () => {
  assert.equal(
    normalizeEmail('  User@Example.COM '),
    normalizeEmail('user@example.com'),
  );
});

test('inequality: genuinely different values do NOT collide after normalization', () => {
  assert.notEqual(normalizePhone('(11) 99999-8888'), normalizePhone('(11) 99999-7777'));
  assert.notEqual(normalizeInstallation('1234567'), normalizeInstallation('7654321'));
  assert.notEqual(normalizeEmail('a@b.com'), normalizeEmail('c@b.com'));
});

// ─── Edge cases: entradas nulas/vazias → string vazia ────────────────────────
test('normalizePhone: null/undefined/empty/whitespace → empty string', () => {
  assert.equal(normalizePhone(null), '');
  assert.equal(normalizePhone(undefined), '');
  assert.equal(normalizePhone(''), '');
  assert.equal(normalizePhone('   '), '');
});

test('normalizeInstallation: null/undefined/empty/whitespace → empty string', () => {
  assert.equal(normalizeInstallation(null), '');
  assert.equal(normalizeInstallation(undefined), '');
  assert.equal(normalizeInstallation(''), '');
  assert.equal(normalizeInstallation('   '), '');
});

test('normalizeEmail: null/undefined/empty/whitespace → empty string', () => {
  assert.equal(normalizeEmail(null), '');
  assert.equal(normalizeEmail(undefined), '');
  assert.equal(normalizeEmail(''), '');
  assert.equal(normalizeEmail('   '), '');
});

test('normalizers coerce non-string inputs via String() before cleaning', () => {
  // números são coeridos para string e então reduzidos a dígitos
  assert.equal(normalizePhone(11999998888), '11999998888');
  assert.equal(normalizeInstallation(1234567), '1234567');
  // email numérico/coercível: lowercase de dígitos é o próprio dígito
  assert.equal(normalizeEmail(123), '123');
});
