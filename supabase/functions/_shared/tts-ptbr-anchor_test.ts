import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildNameOnlyTtsText,
  buildOlaGreetTtsText,
  buildNomeNaoTemSegredoTtsText,
  buildEntaoNomeTtsText,
  buildCallNameGreetTtsText,
  formatNameGreetForTts,
} from "./tts-ptbr-anchor.ts";

Deno.test("buildOlaGreetTtsText = Olá+nome+tudo bem (igual ligação)", () => {
  assertEquals(buildOlaGreetTtsText("Fernandinho"), "Olá, Fernandinho! Tudo bem?");
});

Deno.test("buildCallNameGreetTtsText — ligação gravada sem pergunta", () => {
  assertEquals(buildCallNameGreetTtsText("Maria"), "Olá, Maria!");
  assertEquals(buildCallNameGreetTtsText(""), "");
  assertEquals(buildOlaGreetTtsText("Maria"), "Olá, Maria! Tudo bem?");
});

Deno.test("buildNameOnlyTtsText mantém só o nome no áudio (callout com vírgula)", () => {
  assertEquals(buildNameOnlyTtsText("Fernandinho"), "Fernandinho,");
});

Deno.test("buildNomeNaoTemSegredoTtsText — frase + nome", () => {
  assertEquals(buildNomeNaoTemSegredoTtsText("Maria"), "Maria, não tem segredo!");
});

Deno.test("buildEntaoNomeTtsText — Então + nome", () => {
  assertEquals(buildEntaoNomeTtsText("Maria"), "Então, Maria!");
});

Deno.test("formatNameGreetForTts aceita Então (contínuo)", () => {
  assertEquals(formatNameGreetForTts("Então, Maria."), "Então, Maria!");
});
