// Regressão: bug 5511971254913 — Simulação rápida não deve contar como
// "conta enviada". Só evidência REAL de fatura (foto/base64/OCR/numero
// instalação) deve passar em hasBillData.
import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  hasBillData,
  hasBillEstimateOnly,
  resolveResumeStep,
} from "../conversation-helpers.ts";

Deno.test("hasBillData: só estimativa da rápida → false", () => {
  assertEquals(hasBillData({ electricity_bill_value: 800 }), false);
  assertEquals(hasBillData({ media_consumo: 350 }), false);
  assertEquals(
    hasBillData({ electricity_bill_value: 800, media_consumo: 350 }),
    false,
  );
});

Deno.test("hasBillData: photo url presente → true", () => {
  assertEquals(
    hasBillData({ electricity_bill_photo_url: "https://x/y.jpg" }),
    true,
  );
});

Deno.test("hasBillData: sentinel pending → false", () => {
  assertEquals(
    hasBillData({ electricity_bill_photo_url: "evolution-media:pending" }),
    false,
  );
});

Deno.test("hasBillData: bill_base64 → true", () => {
  assertEquals(hasBillData({ bill_base64: "data:image/jpeg;base64,AAA" }), true);
});

Deno.test("hasBillData: ocr_done true → true", () => {
  assertEquals(hasBillData({ ocr_done: true }), true);
});

Deno.test("hasBillData: numero_instalacao 7+ dígitos → true", () => {
  assertEquals(hasBillData({ numero_instalacao: "1234567" }), true);
  assertEquals(hasBillData({ numero_instalacao: "12345" }), false);
});

Deno.test("hasBillEstimateOnly: só rápida → true", () => {
  assertEquals(hasBillEstimateOnly({ electricity_bill_value: 800 }), true);
});

Deno.test("hasBillEstimateOnly: com foto → false (não é só estimativa)", () => {
  assertEquals(
    hasBillEstimateOnly({
      electricity_bill_value: 800,
      electricity_bill_photo_url: "https://x/y.jpg",
    }),
    false,
  );
});

Deno.test("resolveResumeStep: pós-rápida sem foto → aguardando_conta", () => {
  // Regressão exata do lead 5511971254913: estimativa 800, sem foto/OCR.
  // ANTES do fix retornava confirmando_dados_conta (pulava o OCR).
  const next = resolveResumeStep({
    name: "Jonatas",
    electricity_bill_value: 800,
  });
  assertEquals(next, "aguardando_conta");
});

Deno.test("resolveResumeStep: com foto, sem confirmação → confirmando_dados_conta", () => {
  const next = resolveResumeStep({
    name: "Jonatas",
    electricity_bill_photo_url: "https://x/y.jpg",
    ocr_done: true,
  });
  assertEquals(next, "confirmando_dados_conta");
});
