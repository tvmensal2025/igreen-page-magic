/**
 * Testes de EXEMPLO da criação da pool de rodízio na edge function
 * `facebook-create-campaign` (Tarefa 5.3 do spec `rodizio-leads-anuncio`).
 *
 * A lógica de "criar ou não a pool" e o FORMATO dos payloads de `rodizio_pools`
 * e `rodizio_pool_members` foi isolada no helper puro
 * `supabase/functions/facebook-create-campaign/rodizio-pool.ts`, justamente para
 * poder ser testada aqui sob Vitest (Node), sem mockar a Meta/carteira/token.
 * O `index.ts` da edge function consome esse mesmo helper e só faz os `insert`.
 *
 * Cobertura (Requisitos 6.1, 6.2, 6.3):
 * - Com `rodizio_enabled` e >= 2 participantes: cria 1 pool ligada à campanha,
 *   com os membros na ordem certa e `lead_count = 0`.
 * - Sem `rodizio_enabled`: nenhuma pool é criada (plano nulo).
 */

import { describe, it, expect } from "vitest";

import {
  buildRodizioPoolPlan,
  buildRodizioPoolMembers,
  shouldCreateRodizioPool,
  normalizeRodizioPartnerIds,
} from "../../../supabase/functions/facebook-create-campaign/rodizio-pool";

const CAMPAIGN_ID = "11111111-1111-1111-1111-111111111111";
const CONSULTANT_ID = "22222222-2222-2222-2222-222222222222";
const LABEL = "[CONS-AB12] Light · Campanha de teste · 2026-01-01";
const PARTNER_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const PARTNER_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const PARTNER_C = "cccccccc-cccc-cccc-cccc-cccccccccccc";

describe("Tarefa 5.3 — com rodizio_enabled, cria pool ligada à campanha", () => {
  it("cria 1 pool ligada à campanha e ao consultor dono, ativa", () => {
    const plan = buildRodizioPoolPlan({
      input: { rodizio_enabled: true, rodizio_partner_ids: [PARTNER_A, PARTNER_B] },
      campaignId: CAMPAIGN_ID,
      consultantId: CONSULTANT_ID,
      label: LABEL,
    });

    // Plano não nulo = uma pool será criada (Requisito 6.1).
    expect(plan).not.toBeNull();
    expect(plan!.pool).toEqual({
      campaign_id: CAMPAIGN_ID,
      consultant_id: CONSULTANT_ID,
      label: LABEL,
      is_active: true,
    });
  });

  it("monta os membros na ordem recebida com position 0..n e lead_count=0 (Req 6.2)", () => {
    const partnerIds = [PARTNER_A, PARTNER_B, PARTNER_C];
    const plan = buildRodizioPoolPlan({
      input: { rodizio_enabled: true, rodizio_partner_ids: partnerIds },
      campaignId: CAMPAIGN_ID,
      consultantId: CONSULTANT_ID,
      label: LABEL,
    });

    // O id da pool só existe após o insert; o construtor recebe esse id.
    const poolId = "99999999-9999-9999-9999-999999999999";
    const members = plan!.buildMembers(poolId);

    expect(members).toEqual([
      { pool_id: poolId, partner_id: PARTNER_A, position: 0, lead_count: 0 },
      { pool_id: poolId, partner_id: PARTNER_B, position: 1, lead_count: 0 },
      { pool_id: poolId, partner_id: PARTNER_C, position: 2, lead_count: 0 },
    ]);

    // Reforço explícito: ordem preservada, posições sequenciais sem buracos e
    // todos os contadores zerados (Requisito 6.2).
    expect(members.map((m) => m.partner_id)).toEqual(partnerIds);
    expect(members.map((m) => m.position)).toEqual([0, 1, 2]);
    expect(members.every((m) => m.lead_count === 0)).toBe(true);
  });

  it("preserva a ordem exata mesmo quando os ids não estão ordenados", () => {
    const partnerIds = [PARTNER_C, PARTNER_A, PARTNER_B];
    const members = buildRodizioPoolMembers("pool-xyz", partnerIds);
    // A posição na fila circular = ordem de chegada, não ordem alfabética.
    expect(members.map((m) => m.partner_id)).toEqual([PARTNER_C, PARTNER_A, PARTNER_B]);
    expect(members.map((m) => m.position)).toEqual([0, 1, 2]);
  });
});

describe("Tarefa 5.3 — sem rodizio_enabled, nenhuma pool é criada (Req 6.3)", () => {
  it("retorna null quando o toggle de rodízio vem desligado", () => {
    const plan = buildRodizioPoolPlan({
      input: { rodizio_enabled: false, rodizio_partner_ids: [PARTNER_A, PARTNER_B] },
      campaignId: CAMPAIGN_ID,
      consultantId: CONSULTANT_ID,
      label: LABEL,
    });
    expect(plan).toBeNull();
  });

  it("retorna null quando o campo rodizio_enabled está ausente", () => {
    const plan = buildRodizioPoolPlan({
      input: { rodizio_partner_ids: [PARTNER_A, PARTNER_B] },
      campaignId: CAMPAIGN_ID,
      consultantId: CONSULTANT_ID,
      label: LABEL,
    });
    expect(plan).toBeNull();
  });
});

describe("Tarefa 5.3 — guarda do mínimo de 2 participantes (Req 5/6.1)", () => {
  it("não cria pool com apenas 1 participante, mesmo com o toggle ligado", () => {
    const plan = buildRodizioPoolPlan({
      input: { rodizio_enabled: true, rodizio_partner_ids: [PARTNER_A] },
      campaignId: CAMPAIGN_ID,
      consultantId: CONSULTANT_ID,
      label: LABEL,
    });
    expect(plan).toBeNull();
    expect(shouldCreateRodizioPool({ rodizio_enabled: true, rodizio_partner_ids: [PARTNER_A] })).toBe(false);
  });

  it("não cria pool com lista vazia ou ausente, mesmo com o toggle ligado", () => {
    expect(
      buildRodizioPoolPlan({
        input: { rodizio_enabled: true, rodizio_partner_ids: [] },
        campaignId: CAMPAIGN_ID,
        consultantId: CONSULTANT_ID,
        label: LABEL,
      }),
    ).toBeNull();
    expect(
      buildRodizioPoolPlan({
        input: { rodizio_enabled: true },
        campaignId: CAMPAIGN_ID,
        consultantId: CONSULTANT_ID,
        label: LABEL,
      }),
    ).toBeNull();
  });

  it("cria pool a partir de exatamente 2 participantes (limite mínimo)", () => {
    const plan = buildRodizioPoolPlan({
      input: { rodizio_enabled: true, rodizio_partner_ids: [PARTNER_A, PARTNER_B] },
      campaignId: CAMPAIGN_ID,
      consultantId: CONSULTANT_ID,
      label: LABEL,
    });
    expect(plan).not.toBeNull();
    expect(plan!.buildMembers("p").length).toBe(2);
  });
});

describe("Tarefa 5.3 — normalização defensiva da lista de participantes", () => {
  it("trata rodizio_partner_ids ausente como lista vazia", () => {
    expect(normalizeRodizioPartnerIds({ rodizio_enabled: true })).toEqual([]);
  });

  it("trata valor inválido (não-array) como lista vazia", () => {
    // Simula corpo malformado vindo da requisição.
    const malformed = { rodizio_enabled: true, rodizio_partner_ids: "x" as unknown as string[] };
    expect(normalizeRodizioPartnerIds(malformed)).toEqual([]);
  });
});
