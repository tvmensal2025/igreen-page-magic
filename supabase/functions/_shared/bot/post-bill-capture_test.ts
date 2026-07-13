/**
 * Testes do seletor de capture_conta no pós-OCR.
 */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  normalizeFlowStepRef,
  pickCaptureContaForPostBill,
} from "./post-bill-capture.ts";

const SIM = {
  id: "sim-id",
  step_key: "d_pedir_conta",
  step_type: "capture_conta",
  position: 2,
  is_active: true,
  fallback: { mode: "goto", goto_step_id: "resultado-id", success_goto_step_id: "resultado-id" },
};
const RESULTADO = {
  id: "resultado-id",
  step_key: "d_resultado",
  step_type: "message",
  is_active: true,
};
const CAD = {
  id: "cad-id",
  step_key: "passo_mqzoj1uf",
  step_type: "capture_conta",
  position: 21,
  is_active: true,
  fallback: { mode: "goto", goto_step_id: "doc-id" },
};
const DOC = {
  id: "doc-id",
  step_key: "d_pedir_documento",
  step_type: "capture_documento",
  is_active: true,
};
const ALL = [SIM, RESULTADO, CAD, DOC];

Deno.test("normalizeFlowStepRef remove prefixo flow:", () => {
  assertEquals(normalizeFlowStepRef("flow:68e9afb2-e0d3-40a5-96a5-d58ec5fdebb4"), "68e9afb2-e0d3-40a5-96a5-d58ec5fdebb4");
  assertEquals(normalizeFlowStepRef("d_resultado"), "d_resultado");
});

Deno.test("pickCapture: preferred UUID de cadastro vence position", () => {
  const chosen = pickCaptureContaForPostBill(ALL as any, { preferredStepId: "cad-id" });
  assertEquals(chosen?.id, "cad-id");
});

Deno.test("pickCapture: Ativar no inbound → conta de CADASTRO (não sim)", () => {
  const chosen = pickCaptureContaForPostBill(ALL as any, {
    recentInbound: "⚡ Ativar o beneficio",
  });
  assertEquals(chosen?.id, "cad-id");
});

Deno.test("pickCapture: Simular no inbound → conta de SIMULAÇÃO", () => {
  const chosen = pickCaptureContaForPostBill(ALL as any, {
    recentInbound: "quero simular economia",
  });
  assertEquals(chosen?.id, "sim-id");
});

Deno.test("pickCapture: sem sinal → primeira por position (legado)", () => {
  const chosen = pickCaptureContaForPostBill(ALL as any, {});
  assertEquals(chosen?.id, "sim-id");
});
