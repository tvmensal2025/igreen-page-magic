/**
 * Nome pra CHAMAR o cliente — nunca "Oi Ixi" / telefone / push do Zap.
 */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  isAddressableNameSource,
  isUsableCustomerName,
  safeFirstNameForAddress,
  safeFullNameForAddress,
  scrubEmptyNameGreeting,
} from "./customer-display-name.ts";
import { renderTemplateVars } from "./render-vars.ts";

Deno.test("isUsableCustomerName — aceita nomes reais", () => {
  assertEquals(isUsableCustomerName("Maria Silva"), true);
  assertEquals(isUsableCustomerName("José"), true);
  assertEquals(isUsableCustomerName("Ana"), true);
  assertEquals(isUsableCustomerName("João Pedro"), true);
});

Deno.test("isUsableCustomerName — rejeita meme / lixo / telefone / status Zap", () => {
  assertEquals(isUsableCustomerName("Ixi Kkk"), false);
  assertEquals(isUsableCustomerName("kkk"), false);
  assertEquals(isUsableCustomerName("Haha"), false);
  assertEquals(isUsableCustomerName("oi"), false);
  assertEquals(isUsableCustomerName("Cliente"), false);
  assertEquals(isUsableCustomerName("(11) 99588-1234"), false);
  assertEquals(isUsableCustomerName("5511995881234"), false);
  assertEquals(isUsableCustomerName("Meus Netos Meu Tudo"), false);
  assertEquals(isUsableCustomerName(""), false);
  assertEquals(isUsableCustomerName(null), false);
});

Deno.test("isAddressableNameSource — Zap/unknown NÃO; digitado/OCR/portal SIM", () => {
  assertEquals(isAddressableNameSource("whatsapp_profile"), false);
  assertEquals(isAddressableNameSource("unknown"), false);
  assertEquals(isAddressableNameSource(""), false);
  assertEquals(isAddressableNameSource(null), false);
  assertEquals(isAddressableNameSource("freeform_multi"), false);
  assertEquals(isAddressableNameSource("self_introduced"), true);
  assertEquals(isAddressableNameSource("user_confirmed"), true);
  assertEquals(isAddressableNameSource("ocr_conta"), true);
  assertEquals(isAddressableNameSource("igreen_portal"), true);
  assertEquals(isAddressableNameSource("manual"), true);
});

Deno.test("safeFirstNameForAddress — exige fonte confiável", () => {
  // Parece nome, mas veio do Zap → NÃO chama
  assertEquals(safeFirstNameForAddress("Marcus Medau", "whatsapp_profile"), "");
  assertEquals(safeFirstNameForAddress("Silvania", "unknown"), "");
  assertEquals(safeFirstNameForAddress("Maria Silva", undefined), "");
  // Digitou / OCR / portal → chama
  assertEquals(safeFirstNameForAddress("maria silva", "self_introduced"), "Maria");
  assertEquals(safeFirstNameForAddress("ROZANA MAZOCK", "ocr_conta"), "Rozana");
  assertEquals(safeFirstNameForAddress("IXI KKK", "self_introduced"), "");
});

Deno.test("safeFullNameForAddress — até 3 partes com fonte", () => {
  assertEquals(
    safeFullNameForAddress("bruno de oliveira costa lim", "user_confirmed"),
    "Bruno de Oliveira",
  );
  assertEquals(safeFullNameForAddress("Ixi Kkk", "self_introduced"), "");
});

Deno.test("renderTemplateVars — push Zap não chama; limpa vírgula", () => {
  const bad = renderTemplateVars("Oi {{nome}}, tudo bem?", {
    name: "Marcus Medau",
    name_source: "whatsapp_profile",
  });
  assertEquals(bad.includes("Marcus"), false);
  assertEquals(/Oi\s*,/.test(bad), false);

  const good = renderTemplateVars("Oi {{nome}}, tudo bem?", {
    name: "Maria Santos",
    name_source: "self_introduced",
  });
  assertEquals(good, "Oi Maria, tudo bem?");
});

Deno.test("scrubEmptyNameGreeting — tema cadência sem nome = só corpo", () => {
  const theme = `Olá, {{nome}}.

Boa notícia: agora dá para começar sua análise.`;
  const out = scrubEmptyNameGreeting(theme);
  assertEquals(out.includes("Olá"), false);
  assertEquals(out.includes("{{nome}}"), false);
  assertEquals(out.startsWith("Boa notícia"), true);
});

Deno.test("scrubEmptyNameGreeting — COLD/RECALL com bold e emoji", () => {
  const cold = `💡 Oi *{{nome}}*! Tudo bem? 😊

Aqui é *{{consultor}}*, da *iGreen*.`;
  const out = scrubEmptyNameGreeting(cold);
  assertEquals(out.includes("{{nome}}"), false);
  assertEquals(out.includes("Oi"), false);
  assertEquals(out.includes("Aqui é"), true);

  const recall = `Olá, *{{nome}}*! 👋

Aqui é *{{consultor}}*, da *iGreen*.`;
  const out2 = scrubEmptyNameGreeting(recall);
  assertEquals(out2.includes("{{nome}}"), false);
  assertEquals(out2.startsWith("Aqui é"), true);
});

Deno.test("scrubEmptyNameGreeting — SMS sem nome não cola palavras", () => {
  const sms1 = scrubEmptyNameGreeting(
    "Ola {{nome}}, aqui e Rafael da iGreen Energy. Ainda quer economizar?",
  );
  assertEquals(sms1.includes("{{nome}}"), false);
  assertEquals(/Olaaqui|Ola\s*aqui/i.test(sms1) && sms1.startsWith("Ola"), false);
  assertEquals(sms1.toLowerCase().includes("aqui e rafael"), true);

  const smsC = scrubEmptyNameGreeting(
    "Rafael | iGreen: Oi {{nome}}! Sua analise segue disponivel. Abra: https://wa.me/5511999",
  );
  assertEquals(smsC.includes("{{nome}}"), false);
  assertEquals(smsC.includes(":!"), false);
  assertEquals(smsC.includes("Oi"), false);
  assertEquals(smsC.startsWith("Rafael | iGreen: Sua"), true);

  const mid = scrubEmptyNameGreeting(
    "Sofia | iGreen: Oi {{nome}}! Ative seu beneficio no WhatsApp",
  );
  assertEquals(mid.includes("oiative"), false);
  assertEquals(mid.toLowerCase().includes("ative seu beneficio"), true);
});

Deno.test("renderTemplateVars — Olá {{nome}}. sem fonte = corpo puro", () => {
  const out = renderTemplateVars(
    `Olá, {{nome}}.

Boa notícia: análise sem foto.`,
    { name: "Zanza", name_source: "whatsapp_profile" },
  );
  assertEquals(out.includes("Zanza"), false);
  assertEquals(out.includes("Olá"), false);
  assertEquals(out.includes("Boa notícia"), true);
});
