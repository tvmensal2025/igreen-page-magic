/**
 * Property test do ramo de atribuição por rodízio do `evolution-webhook`
 * (Tarefa 6.4 do spec `rodizio-leads-anuncio`).
 *
 * // Feature: rodizio-leads-anuncio, Property 4
 *
 * **Property 4: Atribuição reflete o participante da vez**
 * Para todo lead novo de anúncio cuja campanha tem pool ativa e `rodizio_next`
 * retorna um `partner_id` válido, ao final `customers.referral_partner_id` é
 * igual ao `partner_id` retornado e `customers.consultant_id` permanece o
 * consultor da instância central.
 *
 * **Validates: Requirements 7.2, 7.4**
 *
 * Abordagem: o ramo de atribuição vive dentro do `Deno.serve` do `index.ts` e é
 * difícil de testar diretamente sob Vitest. A DECISÃO foi isolada no helper puro
 * `supabase/functions/evolution-webhook/rodizio-assignment.ts` (mesmo padrão da
 * Tarefa 5.3). Aqui mockamos o retorno de `rodizio_next` (Supabase) e o estado do
 * customer, exercitando a decisão pura + a aplicação ao customer.
 */

import { fc, test } from "@fast-check/vitest";
import { describe, expect } from "vitest";

import {
  applyRodizioDecisionToCustomer,
  decideRodizioAssignment,
} from "../../../supabase/functions/evolution-webhook/rodizio-assignment";

// ---------------------------------------------------------------------------
// Geradores (mocks de Supabase / rodizio_next e do estado do customer)
// ---------------------------------------------------------------------------

/** UUID-like simples e não-vazio, para partner/campaign/consultant ids. */
const arbId = fc.uuid();

/** Posição 0-based devolvida pela função SQL (irrelevante para a Property 4). */
const arbPosition = fc.integer({ min: 0, max: 50 });

/**
 * "Forma" do retorno de `rodizio_next` (Supabase RPC). A função SQL retorna
 * TABLE(partner_id, position, pool_id). O cliente Supabase normalmente devolve
 * um ARRAY de linhas, mas cobrimos também a forma de objeto único, para garantir
 * que a extração é robusta às duas formas. `wrapAsArray` escolhe a forma.
 */
const arbWrapAsArray = fc.boolean();

// ---------------------------------------------------------------------------
// Property 4 — atribuição reflete o participante da vez
// ---------------------------------------------------------------------------

describe("Property 4 — atribuição reflete o participante da vez", () => {
  test.prop(
    {
      partnerId: arbId,
      poolId: arbId,
      campaignId: arbId,
      consultantId: arbId,
      customerId: arbId,
      position: arbPosition,
      wrapAsArray: arbWrapAsArray,
    },
    { numRuns: 200 },
  )(
    "referral_partner_id = partner_id retornado e consultant_id permanece intacto",
    ({ partnerId, poolId, campaignId, consultantId, customerId, position, wrapAsArray }) => {
      // Lead novo de anúncio: tem campanha de origem, ainda sem participante.
      const customerBefore = {
        id: customerId,
        consultant_id: consultantId, // consultor da instância central
        source_campaign_id: campaignId,
        referral_partner_id: null as string | null,
      };

      // rodizio_next retornou um partner_id válido (pool ativa). Mock nas duas
      // formas possíveis (array de linhas ou objeto único).
      const row = { partner_id: partnerId, position, pool_id: poolId };
      const rodizioRows = wrapAsArray ? [row] : row;

      const decision = decideRodizioAssignment({ customer: customerBefore, rodizioRows });

      // A atribuição foi aplicada com o participante da vez.
      expect(decision.applied).toBe(true);
      expect(decision.referralPartnerId).toBe(partnerId);
      expect(decision.customerPatch).toEqual({ referral_partner_id: partnerId });

      const customerAfter = applyRodizioDecisionToCustomer(customerBefore, decision);

      // Requisito 7.2: referral_partner_id = partner_id retornado.
      expect(customerAfter.referral_partner_id).toBe(partnerId);

      // Requisito 7.4: consultant_id permanece o da instância central.
      expect(customerAfter.consultant_id).toBe(consultantId);

      // O vínculo com a campanha é preservado.
      expect(customerAfter.source_campaign_id).toBe(campaignId);
    },
  );

  test.prop({ partnerId: arbId, consultantId: arbId, campaignId: arbId }, { numRuns: 100 })(
    "o patch contém SOMENTE referral_partner_id (não toca consultant_id)",
    ({ partnerId, consultantId, campaignId }) => {
      const decision = decideRodizioAssignment({
        customer: {
          id: "c1",
          consultant_id: consultantId,
          source_campaign_id: campaignId,
          referral_partner_id: null,
        } as Record<string, unknown>,
        rodizioRows: [{ partner_id: partnerId, position: 0, pool_id: "p1" }],
      });

      // A única chave do patch é referral_partner_id — garante que o
      // consultant_id nunca é alterado pelo ramo de rodízio (Requisito 7.4).
      expect(decision.customerPatch).not.toBeNull();
      expect(Object.keys(decision.customerPatch!)).toEqual(["referral_partner_id"]);
    },
  );
});
