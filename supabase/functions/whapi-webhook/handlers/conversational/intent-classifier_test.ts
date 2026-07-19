import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { __test } from "./intent-classifier.ts";

const { regexClassify } = __test;

const cases: Array<[string, string]> = [
  ["cadastro", "quer_cadastrar"],
  ["quero me cadastrar", "quer_cadastrar"],
  ["bora", "quer_cadastrar"],
  ["simbora cadastrar", "quer_cadastrar"],
  ["quero falar com um humano", "quer_humano"],
  ["me passa um atendente", "quer_humano"],
  ["oi", "saudacao"],
  ["bom dia", "saudacao"],
  ["já vi o vídeo", "ja_assistiu_video"],
  ["assisti", "ja_assistiu_video"],
  ["sim", "afirmacao"],
  ["1", "afirmacao"],
  ["não", "negacao"],
  ["2", "negacao"],
  ["como funciona?", "tem_duvida"],
  ["é seguro?", "tem_duvida"],
  ["não quero agora", "nao_quer"],
  ["depois eu vejo", "nao_quer"],
];

for (const [input, expected] of cases) {
  Deno.test(`regexClassify("${input}") → ${expected}`, () => {
    assertEquals(regexClassify(input), expected);
  });
}

Deno.test("regexClassify returns null for unknown text", () => {
  assertEquals(regexClassify("blah blah xyz"), null);
});

Deno.test("regexClassify: 'depois' solto NÃO é nao_quer", () => {
  assertEquals(regexClassify("depois"), null);
});

Deno.test("regexClassify: 'bora ver' NÃO é quer_cadastrar", () => {
  assertEquals(regexClassify("bora ver"), null);
});
