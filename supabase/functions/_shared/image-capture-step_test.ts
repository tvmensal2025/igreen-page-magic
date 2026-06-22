// Testes da blindagem B: resolveCaptureRedirectStep distingue conta x
// documento e devolve a chave canônica do pipeline de OCR. resolveImageCaptureStep
// devolve a canônica quando há passo capture_conta/image_capture no fluxo.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  resolveCaptureRedirectStep,
  resolveImageCaptureStep,
  _clearImageCaptureCache,
} from "./image-capture-step.ts";

// Fake Supabase mínimo: encadeia os métodos usados pelos resolvers e
// devolve `result` no maybeSingle().
function makeFakeSupabase(opts: {
  stepByRef?: Record<string, { step_type: string }>;
  activeFlowId?: string | null;
  flowStepType?: string | null;
}) {
  return {
    from(table: string) {
      const q: any = {
        _table: table,
        _filters: {} as Record<string, unknown>,
        select() { return q; },
        eq(col: string, val: unknown) { q._filters[col] = val; return q; },
        in(col: string, vals: unknown[]) { q._filters[`${col}__in`] = vals; return q; },
        order() { return q; },
        limit() { return q; },
        async maybeSingle() {
          if (table === "bot_flows") {
            return { data: opts.activeFlowId ? { id: opts.activeFlowId } : null };
          }
          if (table === "bot_flow_steps") {
            // resolveImageCaptureStep: busca por step_type in [...]
            if (q._filters["step_type__in"]) {
              return { data: opts.flowStepType ? { step_type: opts.flowStepType } : null };
            }
            // resolveCaptureRedirectStep: busca por id OU step_key
            const ref = (q._filters["id"] ?? q._filters["step_key"]) as string | undefined;
            const hit = ref ? opts.stepByRef?.[ref] : undefined;
            return { data: hit ?? null };
          }
          return { data: null };
        },
      };
      return q;
    },
  };
}

const UUID = "3d69389d-92bb-4e85-a8f6-e66fe16906e9";

Deno.test("resolveCaptureRedirectStep: capture_conta (UUID) → aguardando_conta", async () => {
  const sb = makeFakeSupabase({ stepByRef: { [UUID]: { step_type: "capture_conta" } } });
  const r = await resolveCaptureRedirectStep(sb, "consultor-1", UUID);
  assertEquals(r, "aguardando_conta");
});

Deno.test("resolveCaptureRedirectStep: capture_documento (step_key) → aguardando_doc_auto", async () => {
  const sb = makeFakeSupabase({ stepByRef: { passo_doc: { step_type: "capture_documento" } } });
  const r = await resolveCaptureRedirectStep(sb, "consultor-1", "passo_doc");
  assertEquals(r, "aguardando_doc_auto");
});

Deno.test("resolveCaptureRedirectStep: passo conversacional (message) → null", async () => {
  const sb = makeFakeSupabase({ stepByRef: { passo_msg: { step_type: "message" } } });
  const r = await resolveCaptureRedirectStep(sb, "consultor-1", "passo_msg");
  assertEquals(r, null);
});

Deno.test("resolveCaptureRedirectStep: chave canônica não é interceptada → null", async () => {
  const sb = makeFakeSupabase({});
  assertEquals(await resolveCaptureRedirectStep(sb, "consultor-1", "aguardando_conta"), null);
  assertEquals(await resolveCaptureRedirectStep(sb, "consultor-1", "aguardando_doc_auto"), null);
});

Deno.test("resolveCaptureRedirectStep: prefixo flow: é normalizado", async () => {
  const sb = makeFakeSupabase({ stepByRef: { [UUID]: { step_type: "capture_conta" } } });
  const r = await resolveCaptureRedirectStep(sb, "consultor-1", `flow:${UUID}`);
  assertEquals(r, "aguardando_conta");
});

Deno.test("resolveCaptureRedirectStep: sem consultor ou sem step → null", async () => {
  const sb = makeFakeSupabase({});
  assertEquals(await resolveCaptureRedirectStep(sb, null, UUID), null);
  assertEquals(await resolveCaptureRedirectStep(sb, "consultor-1", ""), null);
});

Deno.test("resolveImageCaptureStep: fluxo com capture_conta → aguardando_conta", async () => {
  _clearImageCaptureCache();
  const sb = makeFakeSupabase({ activeFlowId: "flow-1", flowStepType: "capture_conta" });
  const r = await resolveImageCaptureStep(sb, "consultor-img-1");
  assertEquals(r, "aguardando_conta");
});

Deno.test("resolveImageCaptureStep: fluxo sem passo de captura → fallback aguardando_conta", async () => {
  _clearImageCaptureCache();
  const sb = makeFakeSupabase({ activeFlowId: "flow-1", flowStepType: null });
  const r = await resolveImageCaptureStep(sb, "consultor-img-2");
  assertEquals(r, "aguardando_conta");
});

Deno.test("resolveImageCaptureStep: sem consultor → fallback", async () => {
  _clearImageCaptureCache();
  const sb = makeFakeSupabase({});
  assertEquals(await resolveImageCaptureStep(sb, null), "aguardando_conta");
});
