import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildNameOnlyTtsText,
  buildOlaGreetTtsText,
  formatNameGreetForTts,
} from "./tts-ptbr-anchor.ts";

Deno.test("buildOlaGreetTtsText ancora PT-BR com Olá", () => {
  assertEquals(buildOlaGreetTtsText("Fernandinho"), "Olá... Fernandinho...");
});

Deno.test("buildNameOnlyTtsText mantém só o nome no áudio", () => {
  assertEquals(buildNameOnlyTtsText("Fernandinho"), "Fernandinho.");
});

Deno.test("formatNameGreetForTts aceita Então", () => {
  assertEquals(formatNameGreetForTts("Então, Maria."), "Então... Maria...");
});
