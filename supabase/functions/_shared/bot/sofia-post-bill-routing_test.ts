import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  advanceGenericToDocumentAfterBill,
  advanceSofiaToDocumentAfterBill,
  buildSofiaDispatchNameVars,
  isSofiaPostBillCadastro,
  markBillAutoConfirmed,
  markDocAutoConfirmed,
  OCR_RETRY_CONTA_SHORT,
  OCR_RETRY_DOC_SHORT,
  pickSofiaDocumentCaptureStep,
} from "./sofia-post-bill-routing.ts";

Deno.test("isSofiaPostBillCadastro — variante A", () => {
  assertEquals(isSofiaPostBillCadastro({ flow_variant: "A" }), true);
});

Deno.test("pickSofiaDocumentCaptureStep — prefere a7", () => {
  const step = pickSofiaDocumentCaptureStep([
    { id: "1", step_key: "a6_ask_bill_photo", step_type: "capture_conta", is_active: true },
    { id: "2", step_key: "a7_ask_document", step_type: "capture_documento", is_active: true },
  ]);
  assertEquals(step?.step_key, "a7_ask_document");
});

Deno.test("buildSofiaDispatchNameVars — primeiro nome com fonte confiável", () => {
  const v = buildSofiaDispatchNameVars({ name: "ROZANA MAZOCK DIAS", name_source: "ocr_conta" });
  assertEquals(v["{{nome}}"], "Rozana");
});

Deno.test("buildSofiaDispatchNameVars — rejeita Ixi Kkk", () => {
  const v = buildSofiaDispatchNameVars({ name: "Ixi Kkk", name_source: "self_introduced" });
  assertEquals(v["{{nome}}"], "");
});

Deno.test("buildSofiaDispatchNameVars — push Zap não chama mesmo com nome bonito", () => {
  const v = buildSofiaDispatchNameVars({ name: "Marcus Medau", name_source: "whatsapp_profile" });
  assertEquals(v["{{nome}}"], "");
});

Deno.test("markBillAutoConfirmed — grava timestamp e auto_ocr", () => {
  const updates: Record<string, unknown> = {};
  markBillAutoConfirmed(updates);
  assertEquals(typeof updates.bill_data_confirmed_at, "string");
  assertEquals(updates.bill_data_confirmation_by, "auto_ocr");
});

Deno.test("markDocAutoConfirmed — grava timestamp e auto_ocr", () => {
  const updates: Record<string, unknown> = {};
  markDocAutoConfirmed(updates);
  assertEquals(typeof updates.doc_data_confirmed_at, "string");
  assertEquals(updates.doc_data_confirmation_by, "auto_ocr");
});

Deno.test("advanceGenericToDocumentAfterBill — pede doc sem SIM", () => {
  const updates: Record<string, unknown> = {};
  const reply = advanceGenericToDocumentAfterBill(updates);
  assertEquals(updates.conversation_step, "aguardando_doc_auto");
  assertEquals(updates.bill_data_confirmation_by, "auto_ocr");
  assertEquals(typeof updates.bill_data_confirmed_at, "string");
  assertEquals(reply.includes("documento"), true);
  assertEquals(reply.includes("SIM"), false);
});

Deno.test("advanceSofiaToDocumentAfterBill — não-Sofia retorna false", async () => {
  const updates: Record<string, unknown> = {};
  let called = false;
  const ok = await advanceSofiaToDocumentAfterBill({
    customer: { flow_variant: "B" },
    updates,
    dispatchStep: async () => {
      called = true;
    },
  });
  assertEquals(ok, false);
  assertEquals(called, false);
});

Deno.test("advanceSofiaToDocumentAfterBill — Sofia despacha a7 e marca confirmado", async () => {
  const updates: Record<string, unknown> = {};
  const keys: string[] = [];
  const ok = await advanceSofiaToDocumentAfterBill({
    customer: { flow_variant: "A", name: "Jhenn Brandao", name_source: "ocr_conta" },
    updates,
    dispatchStep: async (k) => {
      keys.push(k);
    },
    logPrefix: "test",
  });
  assertEquals(ok, true);
  assertEquals(keys, ["a7_ask_document"]);
  assertEquals(updates.conversation_step, "aguardando_doc_auto");
  assertEquals(updates.bill_data_confirmation_by, "auto_ocr");
  assertEquals(updates.__inline_sent, true);
});

Deno.test("OCR_RETRY_*_SHORT — sem menu SIM/EDITAR", () => {
  assertEquals(OCR_RETRY_CONTA_SHORT.includes("SIM"), false);
  assertEquals(OCR_RETRY_CONTA_SHORT.includes("EDITAR"), false);
  assertEquals(OCR_RETRY_DOC_SHORT.includes("SIM"), false);
  assertEquals(OCR_RETRY_DOC_SHORT.includes("EDITAR"), false);
  assertEquals(OCR_RETRY_CONTA_SHORT.includes("conta"), true);
  assertEquals(OCR_RETRY_DOC_SHORT.includes("documento"), true);
});
