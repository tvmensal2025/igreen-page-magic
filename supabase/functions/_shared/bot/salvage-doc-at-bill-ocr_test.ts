import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  resolveEarlyDocumentStepAfterBill,
  buildEarlyDocConfirmMessage,
} from "./salvage-doc-at-bill-ocr.ts";

Deno.test("resolveEarlyDocumentStepAfterBill: sem doc → null", () => {
  assertEquals(resolveEarlyDocumentStepAfterBill({}), null);
  assertEquals(resolveEarlyDocumentStepAfterBill({ document_front_url: "" }), null);
});

Deno.test("resolveEarlyDocumentStepAfterBill: CNH já salva → confirmando_dados_doc", () => {
  const step = resolveEarlyDocumentStepAfterBill({
    document_front_url: "https://cdn.example/doc.jpg",
    document_type: "cnh",
    document_back_url: "nao_aplicavel",
  });
  assertEquals(step, "confirmando_dados_doc");
});

Deno.test("resolveEarlyDocumentStepAfterBill: RG sem verso → aguardando_doc_verso", () => {
  const step = resolveEarlyDocumentStepAfterBill({
    document_front_url: "https://cdn.example/frente.jpg",
    document_type: "rg_antigo",
  });
  assertEquals(step, "aguardando_doc_verso");
});

Deno.test("resolveEarlyDocumentStepAfterBill: RG com verso → confirmando_dados_doc", () => {
  const step = resolveEarlyDocumentStepAfterBill({
    document_front_url: "https://cdn.example/frente.jpg",
    document_back_url: "https://cdn.example/verso.jpg",
    document_type: "rg_antigo",
  });
  assertEquals(step, "confirmando_dados_doc");
});

Deno.test("resolveEarlyDocumentStepAfterBill: doc já confirmado → null", () => {
  const step = resolveEarlyDocumentStepAfterBill({
    document_front_url: "https://cdn.example/doc.jpg",
    document_type: "cnh",
    document_back_url: "nao_aplicavel",
    doc_data_confirmed_at: "2026-07-19T00:00:00Z",
  });
  assertEquals(step, null);
});

Deno.test("buildEarlyDocConfirmMessage inclui campos", () => {
  const msg = buildEarlyDocConfirmMessage({
    document_type: "cnh",
    doc_holder_name: "João Silva",
    cpf: "12345678901",
    rg: "1234567",
    data_nascimento: "01/01/1990",
  });
  assertEquals(msg.includes("João Silva"), true);
  assertEquals(msg.includes("12345678901"), true);
  assertEquals(msg.includes("CNH"), true);
});
