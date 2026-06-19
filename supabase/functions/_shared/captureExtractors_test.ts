import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { extractNome } from "./captureExtractors.ts";

// Default = single-word rejected (cenário "toda inbound" do multi-extractor)
Deno.test("extractNome: substantivos do domínio NÃO viram nome (single word)", () => {
  for (const w of ["Apagão", "apagao", "Energia", "energia", "conta", "Conta", "luz", "Fatura", "boleto", "desconto", "instagram"]) {
    assertEquals(extractNome(w), null, `"${w}" deveria ser null`);
  }
});

Deno.test("extractNome: saudações/confirmações nunca viram nome", () => {
  for (const w of ["sim", "Sim", "OK", "oi", "olá", "ainda", "talvez", "humano"]) {
    assertEquals(extractNome(w), null);
  }
});

Deno.test("extractNome: 1 palavra avulsa rejeitada por default", () => {
  assertEquals(extractNome("Joao"), null);
  assertEquals(extractNome("Maria"), null);
});

Deno.test("extractNome: 1 palavra aceita quando allowSingleWord=true (bot pediu nome)", () => {
  assertEquals(extractNome("Joao", { allowSingleWord: true }), "Joao");
  assertEquals(extractNome("MARIA", { allowSingleWord: true }), "Maria");
  // Mesmo com allowSingleWord, substantivo de domínio continua bloqueado
  assertEquals(extractNome("Apagão", { allowSingleWord: true }), null);
  assertEquals(extractNome("energia", { allowSingleWord: true }), null);
});

Deno.test("extractNome: gatilho estruturado aceita single word sem opts", () => {
  assertEquals(extractNome("sou João"), "João");
  assertEquals(extractNome("me chamo Maria"), "Maria");
  assertEquals(extractNome("meu nome é Pedro"), "Pedro");
  assertEquals(extractNome("Aqui é Ana"), "Ana");
});

Deno.test("extractNome: 2-3 palavras aceitas sem gatilho", () => {
  assertEquals(extractNome("Maria Silva"), "Maria Silva");
  assertEquals(extractNome("João Carlos Souza"), "João Carlos Souza");
});

Deno.test("extractNome: erro de digitação de termo de domínio rejeitado via Levenshtein", () => {
  // "apagão" com letras trocadas — ainda deveria rejeitar
  assertEquals(extractNome("apagaoo", { allowSingleWord: true }), null);
  assertEquals(extractNome("energa", { allowSingleWord: true }), null);
  assertEquals(extractNome("fatua", { allowSingleWord: true }), null);
});

Deno.test("extractNome: nomes legítimos ainda passam", () => {
  assertEquals(extractNome("sou Carlos"), "Carlos");
  assertEquals(extractNome("Ana Paula"), "Ana Paula");
});
