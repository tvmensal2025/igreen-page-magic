import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { syncDealStageFromStep, __test } from "./crm-stage-sync.ts";

// Fake supabase chainable client.
function makeFakeSupabase(opts: {
  dealStage?: string | null;
  dealId?: string;
  flowStepType?: string | null;
} = {}) {
  const calls: { table: string; op: string; payload?: any }[] = [];
  let lastUpdate: any = null;

  const api = {
    from(table: string) {
      const ctx: any = { _table: table, _filters: {} };
      const selectChain = () => ({
        eq(_c: string, _v: any) { return selectChain(); },
        order() { return selectChain(); },
        limit() { return selectChain(); },
        maybeSingle: async () => {
          calls.push({ table, op: "select" });
          if (table === "crm_deals") {
            if (opts.dealStage === null) return { data: null };
            return { data: { id: opts.dealId || "deal-1", stage: opts.dealStage || "novo_lead" } };
          }
          if (table === "bot_flow_steps") {
            return { data: opts.flowStepType ? { step_type: opts.flowStepType } : null };
          }
          return { data: null };
        },
      });
      ctx.select = () => selectChain();
      ctx.update = (payload: any) => ({
        eq: async () => {
          lastUpdate = { table, payload };
          calls.push({ table, op: "update", payload });
          return { error: null };
        },
      });
      return ctx;
    },
    _calls: calls,
    _lastUpdate: () => lastUpdate,
  };
  return api;
}

Deno.test("legacy step aguardando_valor_conta + deal novo_lead → qualificando", async () => {
  const sb = makeFakeSupabase({ dealStage: "novo_lead" });
  await syncDealStageFromStep(sb as any, "cust-1", "aguardando_valor_conta");
  assertEquals(sb._lastUpdate()?.payload?.stage, "qualificando");
});

Deno.test("legacy step aguardando_doc_auto + deal já aprovado → não mexe", async () => {
  const sb = makeFakeSupabase({ dealStage: "aprovado" });
  await syncDealStageFromStep(sb as any, "cust-1", "aguardando_doc_auto");
  assertEquals(sb._lastUpdate(), null);
});

Deno.test("legacy step welcome + deal qualificando → não rebaixa", async () => {
  const sb = makeFakeSupabase({ dealStage: "qualificando" });
  await syncDealStageFromStep(sb as any, "cust-1", "welcome");
  assertEquals(sb._lastUpdate(), null);
});

Deno.test("custom flow:UUID com step_type capture_conta → valor_conta", async () => {
  const sb = makeFakeSupabase({ dealStage: "novo_lead", flowStepType: "capture_conta" });
  await syncDealStageFromStep(sb as any, "cust-1", "flow:3e7fb4cd-33a7-4854-aec7-4570b04456e9");
  assertEquals(sb._lastUpdate()?.payload?.stage, "valor_conta");
});

Deno.test("custom flow finalizar_cadastro avança para finalizando mesmo partindo de doc_enviado", async () => {
  const sb = makeFakeSupabase({ dealStage: "doc_enviado", flowStepType: "finalizar_cadastro" });
  await syncDealStageFromStep(sb as any, "cust-1", "flow:11111111-1111-1111-1111-111111111111");
  assertEquals(sb._lastUpdate()?.payload?.stage, "finalizando");
});

Deno.test("step desconhecido → noop", async () => {
  const sb = makeFakeSupabase({ dealStage: "novo_lead" });
  await syncDealStageFromStep(sb as any, "cust-1", "passo_desconhecido_xyz");
  assertEquals(sb._lastUpdate(), null);
});

Deno.test("legacy step cadastro_em_analise + deal doc_enviado → finalizando", async () => {
  const sb = makeFakeSupabase({ dealStage: "doc_enviado" });
  await syncDealStageFromStep(sb as any, "cust-1", "cadastro_em_analise");
  assertEquals(sb._lastUpdate()?.payload?.stage, "finalizando");
});

Deno.test("sem customerId → noop", async () => {
  const sb = makeFakeSupabase({ dealStage: "novo_lead" });
  await syncDealStageFromStep(sb as any, null, "aguardando_valor_conta");
  assertEquals(sb._lastUpdate(), null);
});

Deno.test("STAGE_ORDER cobre todos os ACTIVE_FUNNEL_STAGES", () => {
  for (const s of __test.ACTIVE_FUNNEL_STAGES) {
    assertEquals(typeof __test.STAGE_ORDER[s], "number", `missing order for ${s}`);
  }
});
