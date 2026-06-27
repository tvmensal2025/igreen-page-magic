/**
 * Property test do ramo de atribuição por rodízio do `evolution-webhook`
 * (Tarefa 6.6 do spec `rodizio-leads-anuncio`).
 *
 * // Feature: rodizio-leads-anuncio, Property 6
 *
 * **Property 6: Fallback seguro nunca perde o lead**
 * Para todo lead novo de anúncio em que a pool está vazia, inativa, inexistente,
 * ou `rodizio_next` retorna vazio/inválido, o lead é registrado normalmente com
 * `referral_partner_id` nulo (cai no consultor dono) e o vínculo com a campanha
 * (`source_campaign_id`) é preservado.
 *
 * **Validates: Requirements 11.1, 11.2, 11.3, 11.4**
 *
 * Abordagem: reusa o helper puro
 * `supabase/functions/evolution-webhook/rodizio-assignment.ts` (criado na
 * Tarefa 6.4). Geramos retornos de `rodizio_next` representando TODOS os casos
 * de fallback — pool vazia (array `[]`), pool inativa/inexistente (0 linhas),
 * e linhas com `partner_id` nulo/undefined/vazio/forma inválida. Em todos eles,
 * a decisão deve ser fallback: `applied === false`, `customerPatch === null`, e
 * após aplicar ao customer o lead mantém `referral_partner_id` nulo e preserva
 * `source_campaign_id`.
 */

import { fc, test } from "@fast-check/vitest";
import { describe, expect } from "vitest";

import {
  applyRodizioDecisionToCustomer,
  decideRodizioAssignment,
} from "../../../supabase/functions/evolution-webhook/rodizio-assignment";

// ---------------------------------------------------------------------------
// Geradores
// ---------------------------------------------------------------------------

/** UUID-like simples e não-vazio, para campaign/consultant/customer ids. */
const arbId = fc.uuid();

/** Posição 0-based devolvida pela função SQL (irrelevante para o fallback). */
const arbPosition = fc.integer({ min: 0, max: 50 });

/**
 * Valores de `partner_id` que devem ser tratados como INVÁLIDOS pelo helper
 * (sinal de fallback): nulo, undefined, string vazia/só espaços, e formas que
 * não são string não-vazia (número, boolean, objeto, array).
 */
const arbInvalidPartnerId = fc.oneof(
  fc.constant(null),
  fc.constant(undefined),
  fc.constant(""),
  fc.constantFrom("   ", "\t", "\n", "  \t "),
  fc.integer(),
  fc.boolean(),
  fc.constant({}),
  fc.constant([]),
);

/**
 * "Forma" de uma linha inválida de `rodizio_next`. Cobre:
 *  - linha com `partner_id` inválido (nulo/undefined/vazio/não-string)
 *  - objeto sem a chave `partner_id` (forma inesperada)
 */
const arbInvalidRow = fc.oneof(
  fc.record({
    partner_id: arbInvalidPartnerId,
    position: arbPosition,
    pool_id: fc.oneof(arbId, fc.constant(null)),
  }),
  // Objeto sem partner_id algum (forma inesperada vinda do banco).
  fc.record({ position: arbPosition }),
  fc.constant({}),
);

/**
 * Estados de pool que produzem fallback, representando os cenários do
 * Requisito 11:
 *  - pool vazia / inativa / inexistente => `rodizio_next` retorna 0 linhas
 *    (array vazio `[]`), ou o cliente devolve `null`/`undefined`.
 *  - retorno inválido => array/objeto com `partner_id` nulo/vazio/forma errada.
 */
const arbFallbackRodizioRows = fc.oneof(
  // Pool vazia/inativa/inexistente: 0 linhas.
  fc.constant([]),
  fc.constant(null),
  fc.constant(undefined),
  // Retorno inválido como array de uma linha.
  arbInvalidRow.map((row) => [row]),
  // Retorno inválido como objeto único (forma alternativa do cliente).
  arbInvalidRow,
  // Array cuja primeira linha é inválida.
  arbInvalidRow.map((row) => [row, { partner_id: "ignorado-2a-linha" }]),
);

// ---------------------------------------------------------------------------
// Property 6 — fallback seguro nunca perde o lead
// ---------------------------------------------------------------------------

describe("Property 6 — fallback seguro nunca perde o lead", () => {
  test.prop(
    {
      campaignId: arbId,
      consultantId: arbId,
      customerId: arbId,
      rodizioRows: arbFallbackRodizioRows,
    },
    { numRuns: 200 },
  )(
    "pool vazia/inativa/inexistente ou retorno inválido => lead mantém referral_partner_id nulo e preserva a campanha",
    ({ campaignId, consultantId, customerId, rodizioRows }) => {
      // Lead novo de anúncio: ELEGÍVEL ao rodízio (tem campanha de origem e
      // ainda sem participante). O fallback aqui vem do ESTADO DA POOL, não da
      // inelegibilidade do lead.
      const customerBefore = {
        id: customerId,
        consultant_id: consultantId, // consultor da instância central (dono)
        source_campaign_id: campaignId,
        referral_partner_id: null as string | null,
      };

      const decision = decideRodizioAssignment({
        customer: customerBefore,
        rodizioRows,
      });

      // Requisitos 11.1/11.2/11.3: nenhuma atribuição por rodízio foi aplicada.
      expect(decision.applied).toBe(false);
      expect(decision.referralPartnerId).toBeNull();
      // O fallback NÃO mexe no customer (sem patch).
      expect(decision.customerPatch).toBeNull();
      // Sem rodízio, o match por keyword segue normalmente (não é pulado).
      expect(decision.skipKeywordMatch).toBe(false);
      // Ninguém a avisar.
      expect(decision.notifyPartnerId).toBeNull();

      const customerAfter = applyRodizioDecisionToCustomer(customerBefore, decision);

      // Requisito 11.4: o lead é registrado normalmente — referral_partner_id
      // permanece nulo (cai no consultor dono)...
      expect(customerAfter.referral_partner_id).toBeNull();
      // ...o consultor dono permanece intacto...
      expect(customerAfter.consultant_id).toBe(consultantId);
      // ...e o vínculo com a campanha é preservado (lead nunca se perde).
      expect(customerAfter.source_campaign_id).toBe(campaignId);
    },
  );
});
