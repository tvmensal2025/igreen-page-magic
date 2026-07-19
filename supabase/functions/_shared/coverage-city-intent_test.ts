import {
  assertEquals,
  assert,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  isCoverageCityIntent,
  coverageCityReply,
} from "./coverage-city-intent.ts";

Deno.test("cobertura: não sou de Uberlândia", () => {
  assert(isCoverageCityIntent("não sou de Uberlândia"));
  assert(isCoverageCityIntent("nao sou de uberlandia"));
});

Deno.test("cobertura: moro em Araguari / sou de Uberaba", () => {
  assert(isCoverageCityIntent("moro em Araguari"));
  assert(isCoverageCityIntent("sou de Uberaba"));
  assert(isCoverageCityIntent("aqui em Patrocínio"));
  assert(isCoverageCityIntent("moro em Ituiutaba"));
});

Deno.test("cobertura: moro em outra cidade / vizinha", () => {
  assert(isCoverageCityIntent("moro em outra cidade"));
  assert(isCoverageCityIntent("aqui é cidade vizinha"));
  assert(isCoverageCityIntent("fora da cidade"));
});

Deno.test("cobertura: pergunta clássica", () => {
  assert(isCoverageCityIntent("atende na minha cidade?"));
  assert(isCoverageCityIntent("tem cobertura aqui"));
});

Deno.test("cobertura: NÃO dispara em falso positivo", () => {
  assertEquals(isCoverageCityIntent("oi"), false);
  assertEquals(isCoverageCityIntent("Maria"), false);
  assertEquals(isCoverageCityIntent("quero ativar"), false);
  assertEquals(isCoverageCityIntent("moro em casa"), false);
  assertEquals(isCoverageCityIntent("estou aqui"), false);
  assertEquals(isCoverageCityIntent("manda aqui"), false);
  assertEquals(isCoverageCityIntent("aqui é simples"), false);
  assertEquals(isCoverageCityIntent("não sou de acordo"), false);
  assertEquals(isCoverageCityIntent("cobertura do plano"), false);
  assertEquals(isCoverageCityIntent("interessado"), false);
  assertEquals(isCoverageCityIntent("ok"), false);
});

Deno.test("cobertura: reply com nome", () => {
  const r = coverageCityReply("Ana");
  assert(r.includes("Ana"));
  assert(r.toLowerCase().includes("cemig") || r.toLowerCase().includes("distribuidora"));
});
