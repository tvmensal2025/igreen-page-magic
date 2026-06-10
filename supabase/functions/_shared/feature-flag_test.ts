import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import fc from "https://esm.sh/fast-check@3.23.2";
import {
  clearFeatureFlagCache,
  clearFlowEngineV3Cache,
  type FlowEngineV3Flag,
  FEATURE_FLAG_CACHE_TTL_MS,
  type FlowReliabilityV2Flag,
  getFlowEngineV3,
  getFlowReliabilityV2,
  isV2Active,
  isV2Dark,
  isV2Enabled,
} from "./feature-flag.ts";

// ─── Fake Supabase client ────────────────────────────────────────────────
// Minimal builder shaped like the real PostgREST client, scoped just to
// `from("consultants").select("flow_reliability_v2").eq("id", id).single()`.
// The stored value is mutable so tests can simulate remote UPDATEs.

interface FakeStore {
  rows: Map<string, { flow_reliability_v2: unknown } | null>;
  errorOnNext?: { code?: string; message: string } | null;
  selectCalls: number;
}

function makeFakeSupabase(initial: Array<[string, unknown]> = []): {
  client: any;
  store: FakeStore;
  setValue: (id: string, v: unknown) => void;
  remove: (id: string) => void;
  failNext: (err: { code?: string; message: string }) => void;
} {
  const store: FakeStore = {
    rows: new Map(),
    errorOnNext: null,
    selectCalls: 0,
  };
  for (const [id, v] of initial) {
    store.rows.set(id, { flow_reliability_v2: v });
  }

  const client = {
    from(table: string) {
      return {
        select(_cols: string) {
          return {
            eq(_col: string, value: string) {
              return {
                single: async () => {
                  store.selectCalls += 1;
                  if (table !== "consultants") {
                    return { data: null, error: { message: "wrong table" } };
                  }
                  if (store.errorOnNext) {
                    const err = store.errorOnNext;
                    store.errorOnNext = null;
                    return { data: null, error: err };
                  }
                  const row = store.rows.get(value);
                  if (!row) {
                    return { data: null, error: { code: "PGRST116", message: "no row" } };
                  }
                  return { data: row, error: null };
                },
              };
            },
          };
        },
      };
    },
  };

  return {
    client,
    store,
    setValue: (id, v) => {
      store.rows.set(id, { flow_reliability_v2: v });
    },
    remove: (id) => {
      store.rows.delete(id);
    },
    failNext: (err) => {
      store.errorOnNext = err;
    },
  };
}

// ─── Unit tests ─────────────────────────────────────────────────────────

Deno.test("returns the persisted value for each known flag", async () => {
  const flags: FlowReliabilityV2Flag[] = ["off", "dark", "canary", "on"];
  for (const f of flags) {
    clearFeatureFlagCache();
    const fake = makeFakeSupabase([[`c-${f}`, f]]);
    const got = await getFlowReliabilityV2(fake.client, `c-${f}`);
    assertEquals(got, f);
  }
});

Deno.test("defaults to 'off' when the consultant row is missing", async () => {
  clearFeatureFlagCache();
  const fake = makeFakeSupabase();
  const got = await getFlowReliabilityV2(fake.client, "missing-consultant");
  assertEquals(got, "off");
});

Deno.test("defaults to 'off' when the stored value is invalid", async () => {
  clearFeatureFlagCache();
  const fake = makeFakeSupabase([["c1", "totally-bogus"]]);
  const got = await getFlowReliabilityV2(fake.client, "c1");
  assertEquals(got, "off");
});

Deno.test("defaults to 'off' when the supabase call returns an error", async () => {
  clearFeatureFlagCache();
  const fake = makeFakeSupabase([["c1", "on"]]);
  fake.failNext({ message: "boom" });
  const got = await getFlowReliabilityV2(fake.client, "c1");
  assertEquals(got, "off");
});

Deno.test("returns 'off' for empty consultant id without hitting supabase", async () => {
  clearFeatureFlagCache();
  const fake = makeFakeSupabase([["c1", "on"]]);
  const got = await getFlowReliabilityV2(fake.client, "");
  assertEquals(got, "off");
  assertEquals(fake.store.selectCalls, 0);
});

Deno.test("caches the value for 30s: subsequent reads do not re-query supabase", async () => {
  clearFeatureFlagCache();
  const fake = makeFakeSupabase([["c1", "canary"]]);
  const a = await getFlowReliabilityV2(fake.client, "c1");
  const b = await getFlowReliabilityV2(fake.client, "c1");
  const c = await getFlowReliabilityV2(fake.client, "c1");
  assertEquals(a, "canary");
  assertEquals(b, "canary");
  assertEquals(c, "canary");
  assertEquals(fake.store.selectCalls, 1);
});

Deno.test("cache is per-consultant: two ids produce two queries", async () => {
  clearFeatureFlagCache();
  const fake = makeFakeSupabase([["c1", "on"], ["c2", "dark"]]);
  await getFlowReliabilityV2(fake.client, "c1");
  await getFlowReliabilityV2(fake.client, "c2");
  await getFlowReliabilityV2(fake.client, "c1");
  await getFlowReliabilityV2(fake.client, "c2");
  assertEquals(fake.store.selectCalls, 2);
});

Deno.test("cache invariant: remote UPDATE within 30s does not change the read value", async () => {
  clearFeatureFlagCache();
  const fake = makeFakeSupabase([["c1", "off"]]);
  const first = await getFlowReliabilityV2(fake.client, "c1");
  // Simulate a remote UPDATE.
  fake.setValue("c1", "on");
  const second = await getFlowReliabilityV2(fake.client, "c1");
  assertEquals(first, "off");
  assertEquals(second, "off");
  // After clearing the cache (TTL expiry equivalent), the new value is read.
  clearFeatureFlagCache();
  const third = await getFlowReliabilityV2(fake.client, "c1");
  assertEquals(third, "on");
});

Deno.test("isV2Active / isV2Dark / isV2Enabled flag classification", () => {
  assertEquals(isV2Active("off"), false);
  assertEquals(isV2Active("dark"), false);
  assertEquals(isV2Active("canary"), true);
  assertEquals(isV2Active("on"), true);

  assertEquals(isV2Dark("off"), false);
  assertEquals(isV2Dark("dark"), true);
  assertEquals(isV2Dark("canary"), false);
  assertEquals(isV2Dark("on"), false);

  assertEquals(isV2Enabled("off"), false);
  assertEquals(isV2Enabled("dark"), true);
  assertEquals(isV2Enabled("canary"), true);
  assertEquals(isV2Enabled("on"), true);
});

// ─── Property-based test ───────────────────────────────────────────────
// Property: For any sequence of GET / UPDATE operations performed within
// the 30s cache window, every getFlowReliabilityV2 read returns the value
// that was persisted at the time of the first GET, regardless of any
// intervening UPDATEs to the underlying row.
//
// **Validates: §8 do design (rollout)**
Deno.test("PBT: cache freezes flag for 30s across remote UPDATEs", async () => {
  const flagArb: fc.Arbitrary<FlowReliabilityV2Flag> = fc.constantFrom(
    "off",
    "dark",
    "canary",
    "on",
  );

  type Op =
    | { kind: "get" }
    | { kind: "update"; value: FlowReliabilityV2Flag };

  const opArb: fc.Arbitrary<Op> = fc.oneof(
    fc.record({ kind: fc.constant("get" as const) }),
    fc.record({
      kind: fc.constant("update" as const),
      value: flagArb,
    }),
  );

  await fc.assert(
    fc.asyncProperty(
      flagArb,
      fc.array(opArb, { minLength: 1, maxLength: 50 }),
      async (initial, ops) => {
        clearFeatureFlagCache();
        const fake = makeFakeSupabase([["consultant-x", initial]]);

        // First read establishes the frozen value.
        const baseline = await getFlowReliabilityV2(fake.client, "consultant-x");
        if (baseline !== initial) return false;

        for (const op of ops) {
          if (op.kind === "update") {
            fake.setValue("consultant-x", op.value);
          } else {
            const seen = await getFlowReliabilityV2(fake.client, "consultant-x");
            if (seen !== baseline) return false;
          }
        }
        // Only one supabase round-trip should have occurred regardless of
        // how many gets were performed within the cache window.
        if (fake.store.selectCalls !== 1) return false;
        return true;
      },
    ),
    { numRuns: 75 },
  );
});

// ─── Cérebro IA — rollback em segundos via chave (Req 2.6 / Tarefa 14.3) ──────
//
// Fake do Supabase para a coluna `flow_engine_v3` (a chave que gateia a resposta
// real do Cérebro). Mesmo formato do anterior, mas grava na coluna certa.

function makeFakeEngineV3(initial: Array<[string, unknown]> = []): {
  client: any;
  setValue: (id: string, v: unknown) => void;
  selectCalls: () => number;
} {
  const rows = new Map<string, { flow_engine_v3: unknown }>();
  let selectCalls = 0;
  for (const [id, v] of initial) rows.set(id, { flow_engine_v3: v });
  const client = {
    from(_table: string) {
      return {
        select(_cols: string) {
          return {
            eq(_col: string, value: string) {
              return {
                single: async () => {
                  selectCalls += 1;
                  const row = rows.get(value);
                  if (!row) {
                    return { data: null, error: { code: "PGRST116", message: "no row" } };
                  }
                  return { data: row, error: null };
                },
              };
            },
          };
        },
      };
    },
  };
  return {
    client,
    setValue: (id, v) => rows.set(id, { flow_engine_v3: v }),
    selectCalls: () => selectCalls,
  };
}

Deno.test("TTL do cache da flag é de 30s (limite de propagação do rollback)", () => {
  // O design (§8) aceita até 30s de propagação como "segundos". Documentado e
  // não encurtado para não adicionar um round-trip por turno no caminho normal.
  assertEquals(FEATURE_FLAG_CACHE_TTL_MS, 30_000);
});

Deno.test("2.6: clearFlowEngineV3Cache força releitura imediata da flag (rollback sem esperar o TTL)", async () => {
  clearFeatureFlagCache();
  const fake = makeFakeEngineV3([["c1", "canary"]]);

  // Consultor em canary → Cérebro é fonte de verdade (isV2Active = true).
  const ligado = await getFlowEngineV3(fake.client, "c1");
  assertEquals(ligado, "canary");
  assertEquals(isV2Active(ligado), true);

  // Operador faz o rollback baixando a chave do consultor (sem deploy).
  fake.setValue("c1", "off");

  // Dentro do TTL, o cache ainda devolveria o valor antigo (canary).
  const aindaCacheado = await getFlowEngineV3(fake.client, "c1");
  assertEquals(aindaCacheado, "canary");

  // Forçar invalidação → a próxima leitura já reflete o rollback (off) e o gate
  // deixa de considerar o Cérebro fonte de verdade.
  clearFlowEngineV3Cache();
  const desligado = await getFlowEngineV3(fake.client, "c1");
  assertEquals(desligado, "off");
  assertEquals(isV2Active(desligado), false);
});

Deno.test("clearFlowEngineV3Cache NÃO derruba o cache do caminho normal (flow_reliability_v2)", async () => {
  clearFeatureFlagCache();
  const v2 = makeFakeSupabase([["c1", "on"]]);
  const engine = makeFakeEngineV3([["c1", "canary"]]);

  // Aquece os dois caches.
  await getFlowReliabilityV2(v2.client, "c1");
  await getFlowEngineV3(engine.client, "c1");

  // Invalida SÓ o cache do engineV3.
  clearFlowEngineV3Cache();

  // O caminho normal (flow_reliability_v2) segue cacheado: nenhuma nova query.
  await getFlowReliabilityV2(v2.client, "c1");
  assertEquals(v2.store.selectCalls, 1, "o cache do caminho normal deve permanecer intacto");

  // Já o engineV3 relê (uma nova query após a invalidação).
  await getFlowEngineV3(engine.client, "c1");
  assertEquals(engine.selectCalls(), 2, "o engineV3 deve reler após a invalidação");
});
