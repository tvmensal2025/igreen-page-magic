/**
 * Property-based test — Prioridade do celular do Portal 2
 *
 * Ordem (troca completa no chat):
 *   1) portal2_celular_alt
 *   2) phone_landline (se phone_contact_confirmed)
 *   3) phone_whatsapp
 *
 *     node --test worker-portal-2/test/celular-alt-priority.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import { resolvePortalWhatsapp, toWhatsappCanonical } from '../portal-phone.mjs';

// Só telefones com ≥10 dígitos — a regra de produção exige isso para aceitar alt/landline.
const presentPhone = fc.constantFrom(
  '11999998888',
  '(11) 99999-8888',
  '+55 11 99999-8888',
  '5511988887777',
  '21933334444',
  '11 9 9999 8888',
  '19993745054',
  '(19) 99374-5054',
  '5519993745054',
);

const absentValue = fc.constantFrom(null, undefined, '');

test('Property 3: com portal2_celular_alt preenchido, o celular deriva dele', () => {
  fc.assert(
    fc.property(presentPhone, fc.oneof(presentPhone, absentValue), (alt, whats) => {
      const c = {
        portal2_celular_alt: alt,
        phone_whatsapp: whats,
        phone_landline: '(19) 99374-5054',
        phone_contact_confirmed: true,
      };
      assert.equal(resolvePortalWhatsapp(c), toWhatsappCanonical(alt));
    }),
    { numRuns: 500 },
  );
});

test('Property 3b: sem alt, com landline confirmado → usa landline (não whatsapp)', () => {
  fc.assert(
    fc.property(
      fc.constantFrom('19993745054', '(19) 99374-5054', '5519993745054'),
      presentPhone,
      (land, whats) => {
        const c = {
          portal2_celular_alt: null,
          phone_landline: land,
          phone_contact_confirmed: true,
          phone_whatsapp: whats,
        };
        assert.equal(resolvePortalWhatsapp(c), toWhatsappCanonical(land));
      },
    ),
    { numRuns: 200 },
  );
});

test('Property 3c: sem alt e sem landline confirmado → phone_whatsapp', () => {
  fc.assert(
    fc.property(absentValue, presentPhone, (alt, whats) => {
      const c = {
        portal2_celular_alt: alt,
        phone_landline: '(19) 99374-5054',
        phone_contact_confirmed: false,
        phone_whatsapp: whats,
      };
      assert.equal(resolvePortalWhatsapp(c), whats);
    }),
    { numRuns: 200 },
  );
});

test('exemplo Jefferson: digitou 19993745054 → Portal recebe esse, não o WA da sessão', () => {
  const c = {
    portal2_celular_alt: '5519993745054',
    phone_landline: '(19) 99374-5054',
    phone_contact_confirmed: true,
    phone_whatsapp: '5511971254913',
  };
  assert.equal(resolvePortalWhatsapp(c), '5519993745054');
});

test('exemplo: só landline confirmado (sem alt ainda) → landline', () => {
  const c = {
    portal2_celular_alt: null,
    phone_landline: '(19) 99374-5054',
    phone_contact_confirmed: true,
    phone_whatsapp: '5511971254913',
  };
  assert.equal(resolvePortalWhatsapp(c), '5519993745054');
});

test('exemplo: ambos ausentes → ""', () => {
  assert.equal(resolvePortalWhatsapp({}), '');
  assert.equal(resolvePortalWhatsapp({ portal2_celular_alt: '', phone_whatsapp: '' }), '');
});
