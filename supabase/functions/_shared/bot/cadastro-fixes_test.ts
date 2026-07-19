import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  looksLikeEmail,
  looksLikeCepOnly,
  sanitizeComplement,
  collapseDoubleCurrency,
  isNonNameReply,
  resumeAfterAddressEdit,
  looksLikeSpamBlast,
  nextSeparatedCadastroStep,
  isPrePortalCadastroStep,
  isSofiaMulticanalCustomer,
  isPlausibleAddressNumber,
  addressValidationRedirect,
  extractCepFromText,
} from "./cadastro-fixes.ts";
import { getNextMissingStep } from "../conversation-helpers.ts";

Deno.test("looksLikeEmail", () => {
  assertEquals(looksLikeEmail("Jujugatinha2910@gmail.com"), true);
  assertEquals(looksLikeEmail("32601540"), false);
});

Deno.test("looksLikeCepOnly — Julia bug", () => {
  assertEquals(looksLikeCepOnly("32601540"), true);
  assertEquals(looksLikeCepOnly("105"), false);
  assertEquals(looksLikeCepOnly("apto 105"), false);
});

Deno.test("sanitizeComplement — JOSE bug", () => {
  assertEquals(sanitizeComplement("tecservice.atendimento@gmail.com"), null);
  assertEquals(sanitizeComplement("Casa fundos"), "Casa fundos");
});

Deno.test("collapseDoubleCurrency F08", () => {
  assertEquals(collapseDoubleCurrency("R$ R$ 100,00"), "R$ 100,00");
});

Deno.test("isNonNameReply", () => {
  assertEquals(isNonNameReply("ok"), true);
  assertEquals(isNonNameReply("Maria Silva"), false);
});

Deno.test("resumeAfterAddressEdit F04", () => {
  assertEquals(resumeAfterAddressEdit({ rescue_attempts: 2 }), "ask_finalizar");
  assertEquals(resumeAfterAddressEdit({ previous_conversation_step: "finalizando" }), "ask_finalizar");
  assertEquals(resumeAfterAddressEdit({ rescue_attempts: 0 }), "confirmando_dados_conta");
});

Deno.test("nextSeparatedCadastroStep — boleto separado de finalizar", () => {
  assertEquals(nextSeparatedCadastroStep({}), "ask_contaunica");
  assertEquals(nextSeparatedCadastroStep({ contaunica_answered: true }), "ask_finalizar");
});

Deno.test("nextSeparatedCadastroStep — Sofia a10 pula boleto → finalizando", () => {
  assertEquals(
    nextSeparatedCadastroStep({}, { fromStepKey: "a10_portal_otp_facial" }),
    "finalizando",
  );
  assertEquals(
    nextSeparatedCadastroStep(
      { contaunica_answered: false },
      { fromStepKey: "a10_portal_otp_facial" },
    ),
    "finalizando",
  );
});

Deno.test("nextSeparatedCadastroStep — variant C legado pula boleto → finalizando", () => {
  assertEquals(nextSeparatedCadastroStep({ flow_variant: "C" }), "finalizando");
  assertEquals(nextSeparatedCadastroStep({ flow_variant: "c", contaunica_answered: false }), "finalizando");
});

Deno.test("nextSeparatedCadastroStep — Grupo A (passo a*) pula boleto → finalizando", () => {
  assertEquals(
    nextSeparatedCadastroStep({ flow_variant: "A", conversation_step: "a10_portal_otp_facial" }),
    "finalizando",
  );
});

Deno.test("getNextMissingStep — Sofia A (Grupo A) após a9 vai direto a finalizando", () => {
  assertEquals(
    getNextMissingStep({
      flow_variant: "A",
      conversation_step: "a10_portal_otp_facial",
      name: "Maria Silva",
      cpf: "52998224725",
      rg: "123456789",
      data_nascimento: "01/01/1990",
      phone_landline: "(11) 99999-8888",
      phone_contact_confirmed: true,
      email: "maria@test.com",
      address_number: "123",
      address_complement: null,
      distribuidora: "ENEL SP",
      numero_instalacao: "9876543210",
      electricity_bill_value: 350,
      document_front_url: "https://example.com/doc.jpg",
      document_type: "CNH",
      document_back_url: "nao_aplicavel",
      contaunica_answered: false,
    }),
    "finalizando",
  );
});

Deno.test("isPrePortalCadastroStep", () => {
  assertEquals(isPrePortalCadastroStep("ask_contaunica"), true);
  assertEquals(isPrePortalCadastroStep("ask_finalizar"), true);
  assertEquals(isPrePortalCadastroStep("finalizando"), false);
});

Deno.test("isSofiaMulticanalCustomer — variante A é Sofia (Grupo A)", () => {
  assertEquals(isSofiaMulticanalCustomer({ flow_variant: "A" }), true);
  assertEquals(isSofiaMulticanalCustomer({ flow_variant: "C" }), true);
  assertEquals(isSofiaMulticanalCustomer({ flow_variant: "D" }), false);
});

Deno.test("looksLikeSpamBlast", () => {
  assertEquals(looksLikeSpamBlast("oi"), false);
  assertEquals(
    looksLikeSpamBlast("https://zoom.us/j/123 meet.google.com/abc bit.ly/x " + "x".repeat(80)),
    true,
  );
});

Deno.test("isPlausibleAddressNumber — rejeita e-mail/CEP (caso Salto)", () => {
  assertEquals(isPlausibleAddressNumber("119"), true);
  assertEquals(isPlausibleAddressNumber("S/N"), true);
  assertEquals(isPlausibleAddressNumber("rafael.idsss@icloud.com"), false);
  assertEquals(isPlausibleAddressNumber("13323072"), false);
  assertEquals(isPlausibleAddressNumber(""), false);
});

Deno.test("addressValidationRedirect — CEP/cidade nunca vira ask_name", () => {
  const r = addressValidationRedirect(["CEP inválido (deve ter 8 dígitos)", "Cidade inválida"]);
  assertEquals(r?.step, "editing_conta_endereco");
  assertEquals(!!r?.reply && !/nome completo/i.test(r.reply), true);
  const n = addressValidationRedirect(["Número do endereço inválido"]);
  assertEquals(n?.step, "ask_number");
});

Deno.test("extractCepFromText", () => {
  assertEquals(extractCepFromText("Rua Cabreúva, 119, Salto - SP, 13323072"), "13323072");
  assertEquals(extractCepFromText("CEP 13323-072"), "13323072");
  assertEquals(extractCepFromText("sem cep aqui"), null);
});

Deno.test("getNextMissingStep — address_number e-mail pede ask_number", () => {
  assertEquals(
    getNextMissingStep({
      name: "Vinicius Silva",
      cpf: "52998224725",
      rg: "123456789",
      data_nascimento: "01/01/1990",
      phone_landline: "(11) 99999-8888",
      phone_contact_confirmed: true,
      email: "maria@test.com",
      address_number: "rafael.idsss@icloud.com",
      address_complement: "",
      flow_variant: "A",
    }),
    "ask_number",
  );
});
