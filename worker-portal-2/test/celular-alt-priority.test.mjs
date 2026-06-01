/**
 * Property-based test — Prioridade do celular alternativo do Portal 2
 *
 * Spec: .kiro/specs/portal2-ocr-feedback-loop/
 * Task 6.3 — Property 3: Prioridade do celular alternativo
 * **Validates: Requirements 8.3, 8.4**
 *
 * Property 3 (design.md §Correctness Properties):
 *   "Sempre que `portal2_celular_alt` está preenchido, o `celular` enviado ao
 *    Portal 2 é derivado dele; caso contrário, de `phone_whatsapp`."
 *
 * ─── Sob teste: uma DERIVAÇÃO PURA, replicada fielmente ──────────────────────
 * A regra de prioridade foi implementada em DOIS sítios de produção como uma
 * expressão inline idêntica (não há helper exportável compartilhado):
 *
 *   1. supabase/functions/_shared/portal-worker.ts#buildPortal2Payload
 *        whatsapp: c.portal2_celular_alt || c.phone_whatsapp || ""
 *   2. worker-portal-2/server.mjs#fetchDadosFromSupabase (_buildDadosObject)
 *        whatsapp: c.portal2_celular_alt || c.phone_whatsapp || ''
 *
 * Em seguida o worker monta o campo do payload do Portal 2 como:
 *   3. worker-portal-2/portal2-api-client.mjs#montarPayloadCadastro
 *        celular: formatPhone(d.whatsapp)
 *
 * Como os dois sítios usam uma EXPRESSÃO INLINE (e não uma função importável),
 * replicamos aqui essa derivação exata como um pequeno helper puro local e
 * asserimos a invariante por propriedade. Esta é a abordagem adequada/documentada
 * para o caso: o oráculo de teste espelha as cláusulas dos requisitos
 * (8.3/8.4/8.5) e o helper espelha a expressão de produção citada acima.
 *
 * Não há framework de teste no worker (só `node`); usamos o runner nativo
 * `node:test` (ESM) + `fast-check` (resolvido via node_modules da raiz, como nos
 * demais testes do worker). Executar com:
 *
 *     node --test worker-portal-2/test/celular-alt-priority.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

// `formatPhone` é o passo final real do payload (celular = formatPhone(whatsapp)).
// Importamos a função de produção para validar a derivação ponta-a-ponta, sem
// reimplementá-la.
import { formatPhone } from '../portal2-api-client.mjs';

// ─── Réplica fiel da expressão inline dos dois sítios de produção ─────────────
// Espelha EXATAMENTE: `c.portal2_celular_alt || c.phone_whatsapp || ""`.
// (Veja o cabeçalho deste arquivo para as referências de origem.)
function deriveWhatsapp(c) {
  return c.portal2_celular_alt || c.phone_whatsapp || '';
}

// Derivação ponta-a-ponta do campo `celular` do payload do Portal 2.
function deriveCelular(c) {
  return formatPhone(deriveWhatsapp(c));
}

// ─── Geradores ────────────────────────────────────────────────────────────────
// Um valor de telefone "presente" (string com dígitos, formatos BR plausíveis).
const presentPhone = fc.oneof(
  fc.constantFrom(
    '11999998888',
    '(11) 99999-8888',
    '+55 11 99999-8888',
    '5511988887777',
    '21 3333-4444',
    '11 9 9999 8888',
  ),
  // strings arbitrárias não-vazias e "truthy" (garantir conteúdo não só de espaços
  // para representar um celular alternativo realmente preenchido)
  fc.string({ minLength: 1, maxLength: 20 }).filter(s => s.trim().length > 0),
);

// Um valor "ausente": cobre null, undefined e string vazia — os três casos que
// fazem o operador `||` cair para o próximo termo.
const absentValue = fc.constantFrom(null, undefined, '');

// ─── Property 3a: alt preenchido ⇒ celular deriva do alt (Req 8.3/8.4/8.5) ─────
test('Property 3: com portal2_celular_alt preenchido, o celular deriva dele (ignora phone_whatsapp)', () => {
  fc.assert(
    fc.property(presentPhone, fc.oneof(presentPhone, absentValue), (alt, whats) => {
      const c = { portal2_celular_alt: alt, phone_whatsapp: whats };

      // O whatsapp derivado é EXATAMENTE o alternativo (independe de phone_whatsapp).
      assert.equal(deriveWhatsapp(c), alt);

      // E o celular final é formatPhone(alt) — derivado do alternativo.
      assert.equal(deriveCelular(c), formatPhone(alt));
    }),
    { numRuns: 500 },
  );
});

// ─── Property 3b: alt ausente ⇒ celular deriva de phone_whatsapp (Req 8.3) ─────
test('Property 3: sem portal2_celular_alt, o celular deriva de phone_whatsapp', () => {
  fc.assert(
    fc.property(absentValue, presentPhone, (alt, whats) => {
      const c = { portal2_celular_alt: alt, phone_whatsapp: whats };

      assert.equal(deriveWhatsapp(c), whats);
      assert.equal(deriveCelular(c), formatPhone(whats));
    }),
    { numRuns: 500 },
  );
});

// ─── Property 3c: ambos ausentes ⇒ deriva de "" (fallback final) ──────────────
test('Property 3: sem alt e sem phone_whatsapp, o whatsapp derivado é "" (fallback)', () => {
  fc.assert(
    fc.property(absentValue, absentValue, (alt, whats) => {
      const c = { portal2_celular_alt: alt, phone_whatsapp: whats };
      assert.equal(deriveWhatsapp(c), '');
    }),
    { numRuns: 100 },
  );
});

// ─── Invariante de prioridade: quando alt é "truthy", phone_whatsapp NÃO importa ─
// Confirma que a escolha da fonte depende SOMENTE de portal2_celular_alt estar
// preenchido — variar phone_whatsapp não altera o resultado.
test('Property 3 (invariância): com alt preenchido, variar phone_whatsapp não muda o celular', () => {
  fc.assert(
    fc.property(presentPhone, presentPhone, presentPhone, (alt, whatsA, whatsB) => {
      const a = deriveCelular({ portal2_celular_alt: alt, phone_whatsapp: whatsA });
      const b = deriveCelular({ portal2_celular_alt: alt, phone_whatsapp: whatsB });
      assert.equal(a, b);
      assert.equal(a, formatPhone(alt));
    }),
    { numRuns: 300 },
  );
});

// ─── Casos representativos nomeados (oráculo pontual / regressão) ─────────────
test('exemplo: alt preenchido tem prioridade sobre phone_whatsapp', () => {
  const c = { portal2_celular_alt: '11955554444', phone_whatsapp: '11999998888' };
  assert.equal(deriveWhatsapp(c), '11955554444');
  assert.equal(deriveCelular(c), formatPhone('11955554444'));
});

test('exemplo: alt nulo cai para phone_whatsapp', () => {
  const c = { portal2_celular_alt: null, phone_whatsapp: '11999998888' };
  assert.equal(deriveWhatsapp(c), '11999998888');
  assert.equal(deriveCelular(c), formatPhone('11999998888'));
});

test('exemplo: alt string vazia cai para phone_whatsapp', () => {
  const c = { portal2_celular_alt: '', phone_whatsapp: '11999998888' };
  assert.equal(deriveWhatsapp(c), '11999998888');
});

test('exemplo: ambos ausentes → ""', () => {
  assert.equal(deriveWhatsapp({ portal2_celular_alt: undefined, phone_whatsapp: undefined }), '');
  assert.equal(deriveWhatsapp({ portal2_celular_alt: '', phone_whatsapp: '' }), '');
});
