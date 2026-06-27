/**
 * Property test do ramo de atribuição por rodízio do `evolution-webhook`
 * (Tarefa 6.5 do spec `rodizio-leads-anuncio`).
 *
 * // Feature: rodizio-leads-anuncio, Property 5
 *
 * **Property 5: Prioridade do rodízio sobre keyword**
 * Para todo lead novo de anúncio cuja campanha tem pool ativa e a atribuição por
 * rodízio foi aplicada, o resultado de `referral_partner_id` é o participante do
 * rodízio, independentemente de a mensagem conter alguma keyword de outro
 * participante (o match por keyword é ignorado para aquele lead).
 *
 * **Validates: Requirements 8.1, 8.2**
 *
 * Abordagem: a decisão do ramo está isolada no helper puro
 * `supabase/functions/evolution-webhook/rodizio-assignment.ts` (criado na
 * Tarefa 6.4). O ponto-chave aqui é o campo `skipKeywordMatch`: quando o rodízio
 * é aplicado (lead elegível + participante válido), `skipKeywordMatch === true`,
 * ou seja, o chamador pula o match por keyword. Geramos mensagens contendo
 * keywords variadas (de OUTROS participantes) e confirmamos que o resultado é
 * SEMPRE o participante do rodízio e que a keyword é ignorada.
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

/** UUID-like simples e não-vazio, para partner/campaign/consultant ids. */
const arbId = fc.uuid();

/** Posição 0-based devolvida pela função SQL (irrelevante para a Property 5). */
const arbPosition = fc.integer({ min: 0, max: 50 });

/** "Forma" do retorno de `rodizio_next` (array de linhas ou objeto único). */
const arbWrapAsArray = fc.boolean();

/**
 * Keyword de um participante (palavra simples, não-vazia). Usada para montar
 * mensagens que CONTÊM keywords de outros participantes — exatamente o cenário
 * que o rodízio deve ignorar.
 */
const arbKeyword = fc
  .string({ minLength: 1, maxLength: 12 })
  .map((s) => s.replace(/\s+/g, "").toLowerCase())
  .filter((s) => s.length > 0);

/**
 * Mensagem inbound do lead, construída para conter uma ou mais keywords de
 * OUTROS participantes. O texto é montado intercalando as keywords com palavras
 * neutras, garantindo que o "match por keyword" teria candidatos — porém o
 * rodízio deve ter prioridade e ignorar tudo isso.
 */
const arbMessageWithForeignKeywords = fc
  .array(arbKeyword, { minLength: 1, maxLength: 5 })
  .map((keywords) => ({
    keywords,
    text: `ola tenho interesse ${keywords.join(" quero ")} obrigado`,
  }));

// ---------------------------------------------------------------------------
// Property 5 — prioridade do rodízio sobre keyword
// ---------------------------------------------------------------------------

describe("Property 5 — prioridade do rodízio sobre keyword", () => {
  test.prop(
    {
      partnerId: arbId,
      poolId: arbId,
      campaignId: arbId,
      consultantId: arbId,
      customerId: arbId,
      position: arbPosition,
      wrapAsArray: arbWrapAsArray,
      message: arbMessageWithForeignKeywords,
    },
    { numRuns: 200 },
  )(
    "rodízio aplicado => skipKeywordMatch e resultado é o participante do rodízio, ignorando keyword",
    ({
      partnerId,
      poolId,
      campaignId,
      consultantId,
      customerId,
      position,
      wrapAsArray,
      message,
    }) => {
      // Lead novo de anúncio: tem campanha de origem, ainda sem participante.
      // A mensagem contém keywords de OUTROS participantes (cenário do match
      // por keyword), mas isso deve ser ignorado pela prioridade do rodízio.
      const customerBefore = {
        id: customerId,
        consultant_id: consultantId, // consultor da instância central
        source_campaign_id: campaignId,
        referral_partner_id: null as string | null,
        // Anexamos a mensagem ao estado só para deixar explícito que o ramo de
        // rodízio NÃO depende dela para decidir (e portanto a ignora).
        inbound_message: message.text,
      };

      // rodizio_next retornou um partner_id válido (pool ativa).
      const row = { partner_id: partnerId, position, pool_id: poolId };
      const rodizioRows = wrapAsArray ? [row] : row;

      const decision = decideRodizioAssignment({ customer: customerBefore, rodizioRows });

      // O rodízio foi aplicado.
      expect(decision.applied).toBe(true);

      // Requisito 8.2: ao aplicar o rodízio, o match por keyword é ignorado.
      expect(decision.skipKeywordMatch).toBe(true);

      // Requisito 8.1: o resultado é o participante do rodízio, e não qualquer
      // participante derivado das keywords presentes na mensagem.
      expect(decision.referralPartnerId).toBe(partnerId);

      const customerAfter = applyRodizioDecisionToCustomer(customerBefore, decision);

      // O participante final é o do rodízio, independentemente das keywords.
      expect(customerAfter.referral_partner_id).toBe(partnerId);

      // O participante do rodízio não coincide acidentalmente com nenhuma das
      // keywords da mensagem (são ids vs palavras) — confirma que a decisão não
      // veio do texto. (sanity check da geração)
      expect(message.keywords).not.toContain(partnerId);

      // consultant_id e vínculo com a campanha permanecem intactos.
      expect(customerAfter.consultant_id).toBe(consultantId);
      expect(customerAfter.source_campaign_id).toBe(campaignId);
    },
  );

  test.prop(
    {
      partnerId: arbId,
      campaignId: arbId,
      message: arbMessageWithForeignKeywords,
    },
    { numRuns: 100 },
  )(
    "a decisão é a mesma para qualquer mensagem com keywords (independência do texto)",
    ({ partnerId, campaignId, message }) => {
      const baseCustomer = {
        id: "c1",
        consultant_id: "central",
        source_campaign_id: campaignId,
        referral_partner_id: null as string | null,
      } as Record<string, unknown>;

      const rodizioRows = [{ partner_id: partnerId, position: 0, pool_id: "p1" }];

      // Decisão SEM olhar a mensagem.
      const decisionNoMessage = decideRodizioAssignment({
        customer: baseCustomer,
        rodizioRows,
      });

      // Decisão COM a mensagem cheia de keywords de outros participantes.
      const decisionWithMessage = decideRodizioAssignment({
        customer: { ...baseCustomer, inbound_message: message.text } as Record<string, unknown>,
        rodizioRows,
      });

      // A presença de keywords não altera o resultado: o rodízio tem prioridade.
      expect(decisionWithMessage).toEqual(decisionNoMessage);
      expect(decisionWithMessage.applied).toBe(true);
      expect(decisionWithMessage.skipKeywordMatch).toBe(true);
      expect(decisionWithMessage.referralPartnerId).toBe(partnerId);
    },
  );
});
