/**
 * Teste de propriedade da regra de idconsultor/indcli do rodízio de leads de
 * anúncio (Tarefa 8 do spec `rodizio-leads-anuncio`).
 *
 * // Feature: rodizio-leads-anuncio, Property 7
 *
 * **Property 7: Resolução de idconsultor/indcli pelo tipo do participante**
 * Para todo participante da vez, o payload de cadastro produzido pelo pipeline
 * existente tem `idconsultor` igual ao `partner_igreen_id` quando este é maior
 * que 0, e igual ao `igreen_id` do consultor dono caso contrário; e `indcli`
 * igual ao `cli` do participante, ou 0 quando ausente.
 *
 * **Validates: Requirements 12.1, 12.2, 12.3**
 *
 * IMPORTANTE — REUSO (Requisito 12.4): este teste exercita a função JÁ existente
 * `buildPortal2Payload` (`supabase/functions/_shared/portal-worker.ts`), que é a
 * fonte única da regra. A regra NÃO é reimplementada aqui — apenas protegida
 * contra regressões. O cliente Supabase é mockado (a função apenas lê o customer
 * com os joins de `consultants` e `referral_partners`).
 */

import { fc, test } from "@fast-check/vitest";
import { describe, expect, it } from "vitest";

import { buildPortal2Payload } from "../../../supabase/functions/_shared/portal-worker";

// ---------------------------------------------------------------------------
// Mock mínimo do cliente Supabase
// ---------------------------------------------------------------------------

/**
 * Monta um cliente Supabase falso que devolve `customerRow` no `.maybeSingle()`
 * da tabela `customers` e aceita `.update().eq()` como no-op (a função tenta
 * gravar `media_consumo` só quando o consumo está ausente — evitamos esse ramo
 * fornecendo um `media_consumo` válido).
 */
function makeSupabase(customerRow: Record<string, unknown> | null) {
  const chain: Record<string, unknown> = {};
  const builder = {
    select: () => builder,
    eq: () => builder,
    update: () => ({ eq: async () => ({ data: null, error: null }) }),
    maybeSingle: async () => ({ data: customerRow, error: null }),
  };
  chain.builder = builder;
  return {
    from: (_table: string) => builder,
  };
}

/**
 * Monta a linha de `customers` (com os joins) que `buildPortal2Payload` lê.
 * Apenas os campos relevantes para a regra de idconsultor/indcli importam; o
 * resto recebe defaults inertes.
 */
function makeCustomerRow(params: {
  donoIgreenId: number | string | null;
  partner: { cli: unknown; partner_igreen_id: unknown } | null;
}) {
  return {
    id: "cust-1",
    cpf: "12345678900",
    name: "Fulano",
    doc_holder_name: "Fulano de Tal",
    media_consumo: 350, // >= 50 → evita o ramo de estimativa/UPDATE
    electricity_bill_value: 200,
    distribuidora: "Light",
    referral_partner_id: params.partner ? "rp-1" : null,
    consultant_id: "consultor-central",
    consultants: { igreen_id: params.donoIgreenId, name: "Dono", portal_kind: "autoconexao" },
    referral_partners: params.partner,
  };
}

// ---------------------------------------------------------------------------
// Geradores
// ---------------------------------------------------------------------------

// igreen_id do consultor dono: sempre válido (> 0), para a função nunca abortar
// por falta de dono. Variamos número e string (a coluna pode vir como texto).
const arbDonoIgreenId = fc.oneof(
  fc.integer({ min: 1, max: 9_999_999 }),
  fc.integer({ min: 1, max: 9_999_999 }).map(String),
);

// partner_igreen_id do participante: cobre TODOS os casos da regra —
// > 0 (número e string), 0, "0", string vazia e null/ausente.
const arbPartnerIgreenId = fc.oneof(
  fc.constant(null),
  fc.constant(""),
  fc.constant(0),
  fc.constant("0"),
  fc.integer({ min: 1, max: 9_999_999 }),
  fc.integer({ min: 1, max: 9_999_999 }).map(String),
);

// cli do participante: presente (número/string) ou ausente (null/undefined/""/0).
const arbCli = fc.oneof(
  fc.constant(null),
  fc.constant(undefined),
  fc.constant(""),
  fc.constant(0),
  fc.constant("0"),
  fc.integer({ min: 1, max: 999_999 }),
  fc.integer({ min: 1, max: 999_999 }).map(String),
);

// O participante pode existir (consultor/parceiro) ou não (lead direto do dono).
const arbPartner = fc.oneof(
  fc.constant(null),
  fc.record({ partner_igreen_id: arbPartnerIgreenId, cli: arbCli }),
);

/**
 * idconsultor esperado pela REGRA do spec: partner_igreen_id quando seu valor
 * numérico é > 0; caso contrário, o igreen_id do dono.
 */
function expectedIdconsultor(donoIgreenId: number | string, partnerIgreenId: unknown): number {
  const pid = Number(partnerIgreenId); // Number(null/"")=0, Number(undefined)=NaN
  if (Number.isFinite(pid) && pid > 0) return pid;
  return Number(donoIgreenId);
}

/**
 * indcli esperado pela REGRA do spec: o `cli` do participante quando presente;
 * caso contrário, 0.
 */
function expectedIndcli(cli: unknown): number {
  if (cli === null || cli === undefined || cli === "") return 0;
  const n = Number(cli);
  return Number.isFinite(n) ? n : 0;
}

// ---------------------------------------------------------------------------
// Property 7
// ---------------------------------------------------------------------------

describe("Property 7 — resolução de idconsultor/indcli pelo tipo do participante", () => {
  test.prop(
    {
      donoIgreenId: arbDonoIgreenId,
      partner: arbPartner,
    },
    { numRuns: 200 },
  )(
    "idconsultor = partner_igreen_id (>0) ou dono; indcli = cli ou 0",
    async ({ donoIgreenId, partner }) => {
      const supabase = makeSupabase(makeCustomerRow({ donoIgreenId, partner }));

      const payload = await buildPortal2Payload(supabase, "cust-1");

      // Dono sempre tem igreen_id válido → payload nunca é nulo.
      expect(payload).not.toBeNull();

      const idEsperado = expectedIdconsultor(donoIgreenId, partner?.partner_igreen_id ?? null);
      const indcliEsperado = expectedIndcli(partner?.cli ?? null);

      // Requisitos 12.1 e 12.2: idconsultor resolvido pelo tipo do participante.
      expect(payload!.dados.idconsultor).toBe(idEsperado);
      // Requisito 12.3: indcli = cli do participante, ou 0 quando ausente.
      expect(payload!.dados.indcli).toBe(indcliEsperado);

      // idconsultor é sempre um número positivo (cadastro precisa de um dono).
      expect(typeof payload!.dados.idconsultor).toBe("number");
      expect(payload!.dados.idconsultor as number).toBeGreaterThan(0);
    },
  );
});

// ---------------------------------------------------------------------------
// Exemplos — os 4 casos canônicos da regra (documentados no portal-worker.ts)
// ---------------------------------------------------------------------------

describe("Property 7 — exemplos dos 4 casos canônicos", () => {
  it("caso 1: lead direto do dono (sem parceiro) → idconsultor=dono, indcli=0", async () => {
    const supabase = makeSupabase(makeCustomerRow({ donoIgreenId: 1000, partner: null }));
    const payload = await buildPortal2Payload(supabase, "cust-1");
    expect(payload!.dados.idconsultor).toBe(1000);
    expect(payload!.dados.indcli).toBe(0);
  });

  it("caso 2: dono + parceiro indicador (tem cli) → idconsultor=dono, indcli=cli", async () => {
    const supabase = makeSupabase(
      makeCustomerRow({ donoIgreenId: 1000, partner: { partner_igreen_id: null, cli: "55" } }),
    );
    const payload = await buildPortal2Payload(supabase, "cust-1");
    expect(payload!.dados.idconsultor).toBe(1000);
    expect(payload!.dados.indcli).toBe(55);
  });

  it("caso 3: consultor parceiro com id próprio → idconsultor=parceiro, indcli=0", async () => {
    const supabase = makeSupabase(
      makeCustomerRow({ donoIgreenId: 1000, partner: { partner_igreen_id: "2500", cli: null } }),
    );
    const payload = await buildPortal2Payload(supabase, "cust-1");
    expect(payload!.dados.idconsultor).toBe(2500);
    expect(payload!.dados.indcli).toBe(0);
  });

  it("caso 4: consultor parceiro + indicação (id + cli) → idconsultor=parceiro, indcli=cli", async () => {
    const supabase = makeSupabase(
      makeCustomerRow({ donoIgreenId: 1000, partner: { partner_igreen_id: 2500, cli: 77 } }),
    );
    const payload = await buildPortal2Payload(supabase, "cust-1");
    expect(payload!.dados.idconsultor).toBe(2500);
    expect(payload!.dados.indcli).toBe(77);
  });

  it("partner_igreen_id = '0' (string) cai no dono (não é > 0)", async () => {
    const supabase = makeSupabase(
      makeCustomerRow({ donoIgreenId: 1000, partner: { partner_igreen_id: "0", cli: null } }),
    );
    const payload = await buildPortal2Payload(supabase, "cust-1");
    expect(payload!.dados.idconsultor).toBe(1000);
  });
});
