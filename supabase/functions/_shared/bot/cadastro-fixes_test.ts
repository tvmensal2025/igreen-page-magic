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
} from "./cadastro-fixes.ts";

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

Deno.test("isPrePortalCadastroStep", () => {
  assertEquals(isPrePortalCadastroStep("ask_contaunica"), true);
  assertEquals(isPrePortalCadastroStep("ask_finalizar"), true);
  assertEquals(isPrePortalCadastroStep("finalizando"), false);
});

Deno.test("looksLikeSpamBlast", () => {
  assertEquals(looksLikeSpamBlast("oi"), false);
  assertEquals(
    looksLikeSpamBlast("https://zoom.us/j/123 meet.google.com/abc bit.ly/x " + "x".repeat(80)),
    true,
  );
});
