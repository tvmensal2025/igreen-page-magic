/**
 * Teste de propriedade da regra de idconsultor/indcli do rodízio de leads de
 * anúncio (Tarefa 8 do spec `rodizio-leads-anuncio`) + override da ficha.
 *
 * // Feature: rodizio-leads-anuncio, Property 7
 *
 * **Property 7: Resolução de idconsultor/indcli**
 * Prioridade:
 *   0) portal_idconsultor_override > 0 → sobrescreve tudo
 *   1) cli > 0 → idconsultor = cli (consultor abonador)
 *   2) senão → idconsultor = dono
 * indcli = partner_igreen_id quando é cliente cashback (≠ idconsultor).
 *
 * IMPORTANTE — REUSO (Requisito 12.4): este teste exercita a função JÁ existente
 * `buildPortal2Payload` (`supabase/functions/_shared/portal-worker.ts`).
 */

import { fc, test } from "@fast-check/vitest";
import { describe, expect, it } from "vitest";

import { buildPortal2Payload } from "../../../supabase/functions/_shared/portal-worker";

function makeSupabase(customerRow: Record<string, unknown> | null) {
  const builder = {
    select: () => builder,
    eq: () => builder,
    update: () => ({ eq: async () => ({ data: null, error: null }) }),
    maybeSingle: async () => ({ data: customerRow, error: null }),
  };
  return {
    from: (_table: string) => builder,
  };
}

function makeCustomerRow(params: {
  donoIgreenId: number | string | null;
  partner: { cli: unknown; partner_igreen_id: unknown } | null;
  override?: number | string | null;
}) {
  return {
    id: "cust-1",
    cpf: "12345678900",
    name: "Fulano",
    doc_holder_name: "Fulano de Tal",
    media_consumo: 350,
    electricity_bill_value: 200,
    distribuidora: "Light",
    portal_idconsultor_override: params.override ?? null,
    referral_partner_id: params.partner ? "rp-1" : null,
    consultant_id: "consultor-central",
    consultants: { igreen_id: params.donoIgreenId, name: "Dono", portal_kind: "autoconexao" },
    referral_partners: params.partner,
  };
}

const arbDonoIgreenId = fc.oneof(
  fc.integer({ min: 1, max: 9_999_999 }),
  fc.integer({ min: 1, max: 9_999_999 }).map(String),
);

const arbPartnerIgreenId = fc.oneof(
  fc.constant(null),
  fc.constant(""),
  fc.constant(0),
  fc.constant("0"),
  fc.integer({ min: 1, max: 9_999_999 }),
  fc.integer({ min: 1, max: 9_999_999 }).map(String),
);

const arbCli = fc.oneof(
  fc.constant(null),
  fc.constant(undefined),
  fc.constant(""),
  fc.constant(0),
  fc.constant("0"),
  fc.integer({ min: 1, max: 999_999 }),
  fc.integer({ min: 1, max: 999_999 }).map(String),
);

const arbOverride = fc.oneof(
  fc.constant(null),
  fc.constant(0),
  fc.constant(""),
  fc.integer({ min: 1, max: 9_999_999 }),
);

const arbPartner = fc.oneof(
  fc.constant(null),
  fc.record({ partner_igreen_id: arbPartnerIgreenId, cli: arbCli }),
);

function expectedIdconsultor(
  donoIgreenId: number | string,
  partner: { cli: unknown; partner_igreen_id: unknown } | null,
  override: unknown,
): number {
  const ov = Number(override);
  if (Number.isFinite(ov) && ov > 0) return ov;
  const cli = Number(partner?.cli);
  if (Number.isFinite(cli) && cli > 0) return cli;
  return Number(donoIgreenId);
}

function expectedIndcli(
  idconsultor: number,
  partner: { cli: unknown; partner_igreen_id: unknown } | null,
): number {
  const pid = Number(partner?.partner_igreen_id);
  if (Number.isFinite(pid) && pid > 0 && pid !== idconsultor) return pid;
  return 0;
}

describe("Property 7 — resolução de idconsultor/indcli", () => {
  test.prop(
    {
      donoIgreenId: arbDonoIgreenId,
      partner: arbPartner,
      override: arbOverride,
    },
    { numRuns: 200 },
  )(
    "override > cli(abonador) > dono; indcli = partner_igreen_id (cliente)",
    async ({ donoIgreenId, partner, override }) => {
      const supabase = makeSupabase(makeCustomerRow({ donoIgreenId, partner, override }));
      const payload = await buildPortal2Payload(supabase, "cust-1");
      expect(payload).not.toBeNull();
      const idEsperado = expectedIdconsultor(donoIgreenId, partner, override);
      expect(payload!.dados.idconsultor).toBe(idEsperado);
      expect(payload!.dados.indcli).toBe(expectedIndcli(idEsperado, partner));
      expect(typeof payload!.dados.idconsultor).toBe("number");
      expect(payload!.dados.idconsultor as number).toBeGreaterThan(0);
    },
  );
});

describe("Property 7 — casos canônicos", () => {
  it("caso 1: lead direto do dono → idconsultor=dono, indcli=0", async () => {
    const supabase = makeSupabase(makeCustomerRow({ donoIgreenId: 1000, partner: null }));
    const payload = await buildPortal2Payload(supabase, "cust-1");
    expect(payload!.dados.idconsultor).toBe(1000);
    expect(payload!.dados.indcli).toBe(0);
  });

  it("caso 2: só cli ativo (consultor abona) → idconsultor=cli, indcli=0", async () => {
    const supabase = makeSupabase(
      makeCustomerRow({ donoIgreenId: 1000, partner: { partner_igreen_id: null, cli: "55" } }),
    );
    const payload = await buildPortal2Payload(supabase, "cust-1");
    expect(payload!.dados.idconsultor).toBe(55);
    expect(payload!.dados.indcli).toBe(0);
  });

  it("caso 3: só partner_igreen_id (cliente cashback) → idconsultor=dono, indcli=cliente", async () => {
    const supabase = makeSupabase(
      makeCustomerRow({ donoIgreenId: 1000, partner: { partner_igreen_id: "2500", cli: null } }),
    );
    const payload = await buildPortal2Payload(supabase, "cust-1");
    expect(payload!.dados.idconsultor).toBe(1000);
    expect(payload!.dados.indcli).toBe(2500);
  });

  it("caso 4: cli + partner_igreen_id → abonador no id, cliente no indcli", async () => {
    const supabase = makeSupabase(
      makeCustomerRow({ donoIgreenId: 1000, partner: { partner_igreen_id: 2500, cli: 77 } }),
    );
    const payload = await buildPortal2Payload(supabase, "cust-1");
    expect(payload!.dados.idconsultor).toBe(77);
    expect(payload!.dados.indcli).toBe(2500);
  });

  it("override da ficha sobrescreve parceiro e dono", async () => {
    const supabase = makeSupabase(
      makeCustomerRow({
        donoIgreenId: 1000,
        partner: { partner_igreen_id: 2500, cli: 77 },
        override: 9999,
      }),
    );
    const payload = await buildPortal2Payload(supabase, "cust-1");
    expect(payload!.dados.idconsultor).toBe(9999);
    expect(payload!.dados.indcli).toBe(2500);
  });

  it("override vazio/0 não altera a regra", async () => {
    const supabase = makeSupabase(
      makeCustomerRow({
        donoIgreenId: 1000,
        partner: { partner_igreen_id: null, cli: 55 },
        override: 0,
      }),
    );
    const payload = await buildPortal2Payload(supabase, "cust-1");
    expect(payload!.dados.idconsultor).toBe(55);
  });

  it("Abel (consultor): cli=137238, sem cliente → idconsultor=Abel", async () => {
    const supabase = makeSupabase(
      makeCustomerRow({
        donoIgreenId: 124170,
        partner: { partner_igreen_id: null, cli: "137238" },
      }),
    );
    const payload = await buildPortal2Payload(supabase, "cust-1");
    expect(payload!.dados.idconsultor).toBe(137238);
    expect(payload!.dados.indcli).toBe(0);
  });
});
