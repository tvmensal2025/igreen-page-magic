import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildSofiaDispatchNameVars,
  isSofiaPostBillCadastro,
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

Deno.test("buildSofiaDispatchNameVars — primeiro nome", () => {
  const v = buildSofiaDispatchNameVars({ name: "ROZANA MAZOCK DIAS" });
  assertEquals(v["{{nome}}"], "ROZANA");
});
