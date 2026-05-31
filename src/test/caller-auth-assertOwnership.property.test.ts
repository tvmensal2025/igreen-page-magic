/**
 * Property test para `assertOwnership` (Task 5.10 do spec
 * `evolution-multiconsultor-pronto`).
 *
 * // Feature: evolution-multiconsultor-pronto, Property 6: assertOwnership
 * // autoriza apenas dono, admin ou serviço — retorna ok se e somente se o
 * // chamador está em modo `service`, OU é admin, OU o recurso pertence ao
 * // consultor do chamador; retorna 403 quando o recurso pertence a outro
 * // consultor, 400 quando o identificador está ausente, malformado ou
 * // inexistente, e em nenhum caso de negação lê ou modifica o recurso.
 *
 * **Validates: Requirements 5.2, 5.3, 5.5, 5.6**
 *
 * Estratégia:
 *   - Importamos a função REAL `assertOwnership` de
 *     `supabase/functions/_shared/caller-auth.ts`. O import esm.sh do
 *     supabase-js é redirecionado para o pacote instalado via alias do
 *     `vitest.config.ts` (não altera o código de produção; em Deno a URL é
 *     usada normalmente). `assertOwnership` não referencia `Deno`, então não
 *     há necessidade de shim de runtime.
 *   - Passamos um `admin` FALSO cuja cadeia
 *     `.from("customers").select(...).eq(...).maybeSingle()` retorna um
 *     `{ data, error }` controlável, modelando: cliente existe & é do chamador
 *     / é de outro consultor / inexistente (data null) / erro de lookup.
 *   - O `admin` falso é um GRAVADOR: registra toda leitura e qualquer tentativa
 *     de mutação (insert/update/delete/upsert/rpc). Afirmamos que NENHUMA
 *     mutação ocorre em nenhum ramo (em especial nos ramos de negação) e que
 *     apenas a leitura estritamente necessária acontece.
 *
 * Pares chamador × alvo gerados:
 *   chamador ∈ { service, jwt-admin, jwt (dono/outro emergem do alvo) }
 *   alvo     ∈ { customerId dono | outro | inexistente | erro | malformado,
 *                consultantId igual | divergente | malformado,
 *                sem identificador, ambos (precedência de customerId) }
 */

import { fc, test } from "@fast-check/vitest";
import { describe, expect } from "vitest";

import { assertOwnership, type Caller } from "../../supabase/functions/_shared/caller-auth.ts";

// ---------------------------------------------------------------------------
// Espelho da validação de UUID usada pelo helper (para o modelo de referência)
// ---------------------------------------------------------------------------

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// Admin client FALSO + gravador
// ---------------------------------------------------------------------------

type LookupResult = { data: { consultant_id: string | null } | null; error: unknown };

interface AdminRecorder {
  from: string[];
  selects: unknown[];
  eqs: Array<[string, unknown]>;
  maybeSingle: number;
  mutations: Array<[string, unknown[]]>;
}

function makeFakeAdmin(lookup: LookupResult): {
  admin: unknown;
  calls: AdminRecorder;
} {
  const calls: AdminRecorder = {
    from: [],
    selects: [],
    eqs: [],
    maybeSingle: 0,
    mutations: [],
  };

  const builder: Record<string, unknown> = {
    select(cols: unknown) {
      calls.selects.push(cols);
      return builder;
    },
    eq(col: string, val: unknown) {
      calls.eqs.push([col, val]);
      return builder;
    },
    maybeSingle() {
      calls.maybeSingle += 1;
      return Promise.resolve(lookup);
    },
    // Qualquer mutação é registrada — não deve ocorrer NUNCA em assertOwnership.
    insert(...a: unknown[]) {
      calls.mutations.push(["insert", a]);
      return builder;
    },
    update(...a: unknown[]) {
      calls.mutations.push(["update", a]);
      return builder;
    },
    delete(...a: unknown[]) {
      calls.mutations.push(["delete", a]);
      return builder;
    },
    upsert(...a: unknown[]) {
      calls.mutations.push(["upsert", a]);
      return builder;
    },
  };

  const admin = {
    from(table: string) {
      calls.from.push(table);
      return builder;
    },
    rpc(...a: unknown[]) {
      calls.mutations.push(["rpc", a]);
      return Promise.resolve({ data: null, error: null });
    },
  };

  return { admin, calls };
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const CALLER_KINDS = ["service", "admin", "jwt"] as const;
type CallerKind = (typeof CALLER_KINDS)[number];

/** Strings que NÃO são UUIDs válidos. */
const arbMalformed = fc.oneof(
  fc.constant(""),
  fc.constant("not-a-uuid"),
  fc.constant("12345"),
  fc.constant("0c2711ad-4836-41e6-afba"), // truncado
  fc.constant("zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz"), // chars inválidos
  fc.constant("0c2711ad4836-41e6-afba-edd94f698ae3"), // hífen faltando
  fc.string({ minLength: 0, maxLength: 40 }).filter((s) => !UUID_RE.test(s)),
);

interface TargetScenario {
  label: string;
  target: { consultantId?: string; customerId?: string };
  lookup: LookupResult;
}

/** Gera o alvo + o resultado do lookup de `customers.consultant_id`, coerentes
 *  com o `callerId`/`otherId` correntes. */
function arbTargetScenario(
  callerId: string,
  otherId: string,
): fc.Arbitrary<TargetScenario> {
  return fc.oneof(
    // customerId válido, pertence ao chamador → ok (modo jwt não-admin)
    fc.uuid().map((cid) => ({
      label: "cust-owned",
      target: { customerId: cid },
      lookup: { data: { consultant_id: callerId }, error: null },
    })),
    // customerId válido, pertence a OUTRO consultor → 403
    fc.uuid().map((cid) => ({
      label: "cust-other",
      target: { customerId: cid },
      lookup: { data: { consultant_id: otherId }, error: null },
    })),
    // customerId válido, inexistente (data null) → 400
    fc.uuid().map((cid) => ({
      label: "cust-nonexistent",
      target: { customerId: cid },
      lookup: { data: null, error: null },
    })),
    // customerId válido, erro de lookup → 400
    fc.uuid().map((cid) => ({
      label: "cust-error",
      target: { customerId: cid },
      lookup: { data: null, error: { message: "boom" } },
    })),
    // customerId malformado → 400 (sem lookup)
    arbMalformed.map((cid) => ({
      label: "cust-malformed",
      target: { customerId: cid },
      lookup: { data: null, error: null },
    })),
    // consultantId igual ao chamador → ok
    fc.constant({
      label: "cons-match",
      target: { consultantId: callerId },
      lookup: { data: null, error: null },
    }),
    // consultantId divergente → 403
    fc.constant({
      label: "cons-diverge",
      target: { consultantId: otherId },
      lookup: { data: null, error: null },
    }),
    // consultantId malformado → 400
    arbMalformed.map((id) => ({
      label: "cons-malformed",
      target: { consultantId: id },
      lookup: { data: null, error: null },
    })),
    // nenhum identificador → 400
    fc.constant({
      label: "none",
      target: {},
      lookup: { data: null, error: null },
    }),
    // ambos presentes → customerId tem PRECEDÊNCIA (aqui: dono → ok)
    fc.uuid().map((cid) => ({
      label: "both-cust-precedence",
      target: { customerId: cid, consultantId: otherId },
      lookup: { data: { consultant_id: callerId }, error: null },
    })),
  );
}

const arbScenario = fc
  .record({
    callerKind: fc.constantFrom<CallerKind>(...CALLER_KINDS),
    callerId: fc.uuid(),
    otherId: fc.uuid(),
  })
  .chain(({ callerKind, callerId, otherId }) =>
    arbTargetScenario(callerId, otherId).map((ts) => ({
      callerKind,
      callerId,
      otherId,
      ...ts,
    })),
  );

// ---------------------------------------------------------------------------
// Modelo de referência (regra do design, Property 6)
// ---------------------------------------------------------------------------

type Outcome = "ok" | "400" | "403";

function expectedOutcome(
  callerKind: CallerKind,
  callerId: string,
  target: { consultantId?: string; customerId?: string },
  lookup: LookupResult,
): Outcome {
  if (callerKind === "service") return "ok";
  if (callerKind === "admin") return "ok";
  // jwt não-admin
  if (target.customerId !== undefined) {
    if (!UUID_RE.test(target.customerId)) return "400";
    if (lookup.error || !lookup.data) return "400";
    return lookup.data.consultant_id === callerId ? "ok" : "403";
  }
  if (target.consultantId !== undefined) {
    if (!UUID_RE.test(target.consultantId)) return "400";
    return target.consultantId === callerId ? "ok" : "403";
  }
  return "400";
}

function makeCaller(kind: CallerKind, callerId: string): Caller {
  if (kind === "service") return { mode: "service" };
  return { mode: "jwt", consultantId: callerId, isAdmin: kind === "admin" };
}

function statusOf(result: null | Response): Outcome {
  if (result === null) return "ok";
  return String(result.status) as Outcome;
}

// ---------------------------------------------------------------------------
// Property 6
// ---------------------------------------------------------------------------

describe("Property 6 — assertOwnership autoriza apenas dono, admin ou serviço (R5.2, R5.3, R5.5, R5.6)", () => {
  test.prop([arbScenario], { numRuns: 300 })(
    "retorna ok/403/400 conforme a regra e nunca muta o recurso",
    async ({ callerKind, callerId, target, lookup }) => {
      const { admin, calls } = makeFakeAdmin(lookup);
      const caller = makeCaller(callerKind, callerId);

      const result = await assertOwnership(
        caller,
        target,
        admin as never,
      );

      // 1) Resultado bate com o modelo de referência.
      const expected = expectedOutcome(callerKind, callerId, target, lookup);
      expect(statusOf(result)).toBe(expected);

      // 2) Tipo do retorno: null em ok, Response em negação.
      if (expected === "ok") {
        expect(result).toBeNull();
      } else {
        expect(result).toBeInstanceOf(Response);
      }

      // 3) NENHUMA mutação em qualquer ramo (especialmente nos de negação).
      expect(calls.mutations).toHaveLength(0);

      // 4) Apenas a leitura estritamente necessária aconteceu.
      const lookupExpected =
        callerKind === "jwt" &&
        target.customerId !== undefined &&
        UUID_RE.test(target.customerId);

      if (lookupExpected) {
        // Exatamente um read de customers.consultant_id por id.
        expect(calls.from).toEqual(["customers"]);
        expect(calls.selects).toEqual(["consultant_id"]);
        expect(calls.eqs).toEqual([["id", target.customerId]]);
        expect(calls.maybeSingle).toBe(1);
      } else {
        // Service/admin, malformado, caminho consultantId, sem id → sem lookup.
        expect(calls.from).toHaveLength(0);
        expect(calls.maybeSingle).toBe(0);
      }
    },
  );
});

// ---------------------------------------------------------------------------
// Exemplos concretos (sanidade dos ramos principais)
// ---------------------------------------------------------------------------

describe("assertOwnership — exemplos concretos", () => {
  const CALLER = "11111111-1111-4111-8111-111111111111";
  const OTHER = "22222222-2222-4222-8222-222222222222";
  const CUSTOMER = "33333333-3333-4333-8333-333333333333";

  test("service dispensa posse → ok, sem leitura", async () => {
    const { admin, calls } = makeFakeAdmin({ data: null, error: null });
    const result = await assertOwnership(
      { mode: "service" },
      { customerId: CUSTOMER },
      admin as never,
    );
    expect(result).toBeNull();
    expect(calls.from).toHaveLength(0);
    expect(calls.mutations).toHaveLength(0);
  });

  test("admin → ok, sem leitura", async () => {
    const { admin, calls } = makeFakeAdmin({ data: null, error: null });
    const result = await assertOwnership(
      { mode: "jwt", consultantId: CALLER, isAdmin: true },
      { customerId: CUSTOMER },
      admin as never,
    );
    expect(result).toBeNull();
    expect(calls.from).toHaveLength(0);
  });

  test("dono do customer → ok", async () => {
    const { admin } = makeFakeAdmin({
      data: { consultant_id: CALLER },
      error: null,
    });
    const result = await assertOwnership(
      { mode: "jwt", consultantId: CALLER, isAdmin: false },
      { customerId: CUSTOMER },
      admin as never,
    );
    expect(result).toBeNull();
  });

  test("customer de outro consultor → 403, sem mutação", async () => {
    const { admin, calls } = makeFakeAdmin({
      data: { consultant_id: OTHER },
      error: null,
    });
    const result = await assertOwnership(
      { mode: "jwt", consultantId: CALLER, isAdmin: false },
      { customerId: CUSTOMER },
      admin as never,
    );
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(403);
    expect(calls.mutations).toHaveLength(0);
  });

  test("customer inexistente → 400", async () => {
    const { admin } = makeFakeAdmin({ data: null, error: null });
    const result = await assertOwnership(
      { mode: "jwt", consultantId: CALLER, isAdmin: false },
      { customerId: CUSTOMER },
      admin as never,
    );
    expect((result as Response).status).toBe(400);
  });

  test("customerId malformado → 400 sem lookup", async () => {
    const { admin, calls } = makeFakeAdmin({ data: null, error: null });
    const result = await assertOwnership(
      { mode: "jwt", consultantId: CALLER, isAdmin: false },
      { customerId: "not-a-uuid" },
      admin as never,
    );
    expect((result as Response).status).toBe(400);
    expect(calls.from).toHaveLength(0);
  });

  test("consultantId igual → ok; divergente → 403; ausente → 400", async () => {
    const ok = await assertOwnership(
      { mode: "jwt", consultantId: CALLER, isAdmin: false },
      { consultantId: CALLER },
      makeFakeAdmin({ data: null, error: null }).admin as never,
    );
    expect(ok).toBeNull();

    const forbidden = await assertOwnership(
      { mode: "jwt", consultantId: CALLER, isAdmin: false },
      { consultantId: OTHER },
      makeFakeAdmin({ data: null, error: null }).admin as never,
    );
    expect((forbidden as Response).status).toBe(403);

    const bad = await assertOwnership(
      { mode: "jwt", consultantId: CALLER, isAdmin: false },
      {},
      makeFakeAdmin({ data: null, error: null }).admin as never,
    );
    expect((bad as Response).status).toBe(400);
  });
});
