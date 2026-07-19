import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildNameOnlyTtsText,
  buildOlaGreetTtsText,
  formatNameGreetForTts,
} from "./tts-ptbr-anchor.ts";

Deno.test("buildOlaGreetTtsText ancora PT-BR com Olá contínuo (vírgula)", () => {
  // “Olá... Nome!” (reticências) soava como corte entre Olá e o nome — 19/07/2026.
  assertEquals(buildOlaGreetTtsText("Fernandinho"), "Olá, Fernandinho!");
});

Deno.test("buildNameOnlyTtsText mantém só o nome no áudio (callout com vírgula)", () => {
  assertEquals(buildNameOnlyTtsText("Fernandinho"), "Fernandinho,");
});

Deno.test("formatNameGreetForTts aceita Então (contínuo)", () => {
  assertEquals(formatNameGreetForTts("Então, Maria."), "Então, Maria!");
});

