import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildNameOnlyTtsText,
  buildOlaGreetTtsText,
  buildOlaTudoBemTtsText,
  buildNomeNaoTemSegredoTtsText,
  buildEntaoNomeTtsText,
  buildCallNameGreetTtsText,
  formatNameGreetForTts,
  spokenNameForPtBrTts,
} from "./tts-ptbr-anchor.ts";

Deno.test("spokenNameForPtBrTts Valdeir → grafia TTS", () => {
  assertEquals(spokenNameForPtBrTts("Valdeir"), "Val-dêir");
  assertEquals(spokenNameForPtBrTts("VALDEIR"), "Val-dêir");
  assertEquals(spokenNameForPtBrTts("Maria"), "Maria");
});

Deno.test("buildOlaTudoBemTtsText Valdeir usa grafia falada", () => {
  assertEquals(buildOlaTudoBemTtsText("Valdeir"), "Olá, Val-dêir! Tudo bem?");
});

Deno.test("buildOlaGreetTtsText = Olá+nome+tudo bem (igual ligação)", () => {
  assertEquals(buildOlaGreetTtsText("Fernandinho"), "Olá, Fernandinho! Tudo bem?");
});

Deno.test("buildCallNameGreetTtsText = Olá+nome+tudo bem (igual Zap/PV)", () => {
  assertEquals(buildCallNameGreetTtsText("Maria"), "Olá, Maria! Tudo bem?");
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
