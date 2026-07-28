import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { extractPosVendaBody } from "./pos-venda-audio-stitch.ts";

Deno.test("extractPosVendaBody remove nome e saudacao", () => {
  const raw = `Olá, {{nome}} Tudo bem?

{{saudacao}}

Estamos passando para fazer mais um acompanhamento da sua jornada com a iGreen.`;
  const body = extractPosVendaBody(raw);
  assertEquals(body.includes("{{nome}}"), false);
  assertEquals(body.includes("{{saudacao}}"), false);
  assertEquals(body.includes("Estamos passando"), true);
  assertEquals(body.startsWith("Olá"), false);
});
