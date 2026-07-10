/**
 * Regressão — caso Osmar (2026-07-10)
 *
 * WA com 12 dígitos (55+DDD+8) NÃO pode virar DDD 53 via slice(-11).
 * Brasil só — DDI 55 fixo.
 *
 *     node --test worker-portal-2/test/phone-br-osmar.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  toNationalPhoneDigits,
  toWhatsappCanonical,
  formatBrLandline,
  isValidBrNationalPhone,
  resolvePortalWhatsapp,
  BR_DDI,
} from '../portal-phone.mjs';

test('BR_DDI é 55 (energia só no Brasil)', () => {
  assert.equal(BR_DDI, '55');
});

test('caso Osmar: WA 12 dígitos → DDD 34 (não 53)', () => {
  const wa = '553496646917'; // 55 + 34 + 96646917
  assert.equal(toNationalPhoneDigits(wa), '3496646917');
  assert.equal(toWhatsappCanonical(wa), '553496646917');
  assert.equal(formatBrLandline(wa), '(34) 9664-6917');
  // O BUG antigo: slice(-11) gerava 53496646917
  assert.notEqual(toNationalPhoneDigits(wa), '53496646917');
  assert.notEqual(formatBrLandline(wa), '(53) 49664-6917');
});

test('caso Osmar: digitou 034 99992-7145 no confirm → aceita como BR', () => {
  const typed = '034 | 999927145';
  assert.equal(toNationalPhoneDigits(typed), '34999927145');
  assert.equal(toWhatsappCanonical(typed), '5534999927145');
  assert.equal(formatBrLandline(typed), '(34) 99992-7145');
  assert.equal(isValidBrNationalPhone(typed), true);
});

test('Regiane (13 dígitos) continua correta', () => {
  const wa = '5511971254913';
  assert.equal(toNationalPhoneDigits(wa), '11971254913');
  assert.equal(toWhatsappCanonical(wa), '5511971254913');
  assert.equal(formatBrLandline(wa), '(11) 97125-4913');
});

test('confirm Sim no Osmar NÃO grava alt com DDD 53', () => {
  const wa = '553496646917';
  const num = toNationalPhoneDigits(wa);
  const alt = toWhatsappCanonical(num);
  const land = formatBrLandline(num);
  const resolved = resolvePortalWhatsapp({
    portal2_celular_alt: alt,
    phone_landline: land,
    phone_contact_confirmed: true,
    phone_whatsapp: wa,
  });
  assert.equal(alt, '553496646917');
  assert.equal(land, '(34) 9664-6917');
  assert.equal(resolved, '553496646917');
  // Nunca o número corrompido que foi pro Portal 2
  assert.notEqual(resolved, '5553496646917');
});

test('DDI duplicado 5555… é normalizado', () => {
  // alt corrompido histórico do Osmar
  const corrupted = '5553496646917';
  // Após strip 55 → 53496646917 (11) — ainda DDD errado no dado antigo,
  // mas a partir de agora o confirm não gera mais esse formato.
  assert.equal(toNationalPhoneDigits(corrupted), '53496646917');
});
