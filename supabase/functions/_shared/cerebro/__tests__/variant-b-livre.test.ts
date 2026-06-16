// Testes do BYPASS "Fluxo B IA Livre" no Cérebro (pt-BR).
//
// CONTEXTO (causa-raiz do bug de produção 2026-06-15):
// Fluxo B historicamente é "IA 100% livre" (zero `bot_flow_steps`). Quem
// responde é a `processarTurnoFluxoB` (chamada direto pelo whapi-webhook).
// O Cérebro, ao rodar em sombra para esses clientes, chamava `runEngine` →
// motor detectava `empty_flow` → marcava `customer_flow_state.paused_system`,
// corrompendo o estado e fazendo o bot-stuck-recovery abandonar o lead.
//
// O QUE PROVAMOS:
//   (1) `variantBLivreSemPassos` retorna `true` quando customer.flow_variant='B'
//       e o flow B do consultor (ou o público) tem 0 passos ativos → Cérebro
//       deve fazer bypass.
//   (2) Retorna `false` quando o flow B tem ao menos 1 passo ativo → Cérebro
//       roteiriza normalmente.
//   (3) Retorna `false` para variant A (não deve bypassar).
//   (4) Fail-open: erro de leitura → `false` (segue caminho normal).
//   (5) Cache 60s: 2ª chamada não bate no DB.
//
// Rodar:
//   deno test supabase/functions/_shared/cerebro/__tests__/variant-b-livre.test.ts --no-check

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  _limparCacheVariantBLivre,
  variantBLivreSemPassos,
} from "../index.ts";

// ─── Mock minimalista de SupabaseClient ─────────────────────────────────────
// Só implementamos o que o helper realmente chama: `.from(...).select(...).eq(...)
// ...maybeSingle()` e a forma `select("id",{count:"exact",head:true})...`.

interface CallLog {
  table: string;
  filters: Record<string, unknown>;
  countMode?: boolean;
}

function mockSupabase(opts: {
  customer?: { flow_variant?: string; consultant_id?: string | null } | null;
  ownFlow?: { id: string; sync_mode?: string } | null;
  publicFlow?: { id: string } | null;
  stepCount?: number;
  throwOn?: "customers" | "bot_flows" | "bot_flow_steps";
}): { client: any; calls: CallLog[] } {
  const calls: CallLog[] = [];

  function builder(table: string) {
    const filters: Record<string, unknown> = {};
    let countMode = false;
    // deno-lint-ignore no-explicit-any
    const api: any = {
      select(_cols?: string, options?: { count?: string; head?: boolean }) {
        if (options?.count === "exact") countMode = true;
        return api;
      },
      eq(col: string, val: unknown) {
        filters[col] = val;
        return api;
      },
      limit(_n: number) {
        return api;
      },
      maybeSingle() {
        calls.push({ table, filters: { ...filters } });
        if (opts.throwOn === table) {
          return Promise.reject(new Error(`mock throw on ${table}`));
        }
        if (table === "customers") {
          return Promise.resolve({ data: opts.customer ?? null, error: null });
        }
        if (table === "bot_flows") {
          if (filters["is_public"] === true) {
            return Promise.resolve({ data: opts.publicFlow ?? null, error: null });
          }
          return Promise.resolve({ data: opts.ownFlow ?? null, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      },
      then(resolve: (r: { data: unknown; count: number | null; error: null }) => void) {
        // chamada terminal sem maybeSingle (caso do count: head=true)
        calls.push({ table, filters: { ...filters }, countMode });
        if (opts.throwOn === table) {
          return Promise.reject(new Error(`mock throw on ${table}`));
        }
        if (table === "bot_flow_steps" && countMode) {
          return Promise.resolve({ data: null, count: opts.stepCount ?? 0, error: null }).then(resolve);
        }
        return Promise.resolve({ data: null, count: null, error: null }).then(resolve);
      },
    };
    return api;
  }

  return {
    client: { from: (t: string) => builder(t) },
    calls,
  };
}

Deno.test("variant B + flow vazio → bypass (true)", async () => {
  _limparCacheVariantBLivre();
  const { client } = mockSupabase({
    customer: { flow_variant: "B", consultant_id: "c1" },
    ownFlow: { id: "flow-b-1", sync_mode: "own" },
    stepCount: 0,
  });
  const res = await variantBLivreSemPassos(client, "cust-1");
  assertEquals(res, true);
});

Deno.test("variant B + flow com passos → NÃO bypassa (false)", async () => {
  _limparCacheVariantBLivre();
  const { client } = mockSupabase({
    customer: { flow_variant: "B", consultant_id: "c2" },
    ownFlow: { id: "flow-b-2", sync_mode: "own" },
    stepCount: 3,
  });
  const res = await variantBLivreSemPassos(client, "cust-2");
  assertEquals(res, false);
});

Deno.test("variant A → nunca bypassa (false), mesmo sem passos", async () => {
  _limparCacheVariantBLivre();
  const { client, calls } = mockSupabase({
    customer: { flow_variant: "A", consultant_id: "c3" },
  });
  const res = await variantBLivreSemPassos(client, "cust-3");
  assertEquals(res, false);
  // Só consultou customers — não foi buscar bot_flows pois variant != B.
  assertEquals(calls.filter((c) => c.table === "bot_flows").length, 0);
});

Deno.test("sem flow B nenhum (próprio nem público) → bypass (true)", async () => {
  _limparCacheVariantBLivre();
  const { client } = mockSupabase({
    customer: { flow_variant: "B", consultant_id: "c4" },
    ownFlow: null,
    publicFlow: null,
  });
  const res = await variantBLivreSemPassos(client, "cust-4");
  assertEquals(res, true);
});

Deno.test("fail-open: erro ao ler customers → retorna false", async () => {
  _limparCacheVariantBLivre();
  const { client } = mockSupabase({
    customer: { flow_variant: "B", consultant_id: "c5" },
    throwOn: "customers",
  });
  const res = await variantBLivreSemPassos(client, "cust-5");
  assertEquals(res, false);
});

Deno.test("cache: 2ª chamada para o MESMO consultor não bate em bot_flows", async () => {
  _limparCacheVariantBLivre();
  const { client, calls } = mockSupabase({
    customer: { flow_variant: "B", consultant_id: "c-cached" },
    ownFlow: { id: "flow-x", sync_mode: "own" },
    stepCount: 0,
  });
  const r1 = await variantBLivreSemPassos(client, "cust-a");
  const flowsCallsAfter1 = calls.filter((c) => c.table === "bot_flows").length;
  const r2 = await variantBLivreSemPassos(client, "cust-b");
  const flowsCallsAfter2 = calls.filter((c) => c.table === "bot_flows").length;
  assertEquals(r1, true);
  assertEquals(r2, true);
  // Cache hit: nenhum NOVO acesso a bot_flows entre as duas chamadas.
  assertEquals(flowsCallsAfter1, flowsCallsAfter2, "cache 60s evita 2ª query de bot_flows");
  assert(flowsCallsAfter1 >= 1, "1ª chamada precisa ter ido ao DB");
});
