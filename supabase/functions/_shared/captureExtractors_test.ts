import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { extractNome, extractTelefone } from "./captureExtractors.ts";

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

Deno.test("extractNome: nome completo BR com 4 palavras (de/da) é aceito", () => {
  // bug real 2026-07-20: "Manoel Bento de Oliveira" rejeitado (max 3) → handoff
  assertEquals(extractNome("Manoel Bento de Oliveira"), "Manoel Bento de Oliveira");
  assertEquals(extractNome("Ana Paula da Silva"), "Ana Paula da Silva");
  assertEquals(extractNome("sou Manoel Bento de Oliveira"), "Manoel Bento de Oliveira");
});

Deno.test("extractNome: hífen, Filho e Jr. aceitos", () => {
  assertEquals(extractNome("Maria-Clara Silva"), "Maria-Clara Silva");
  assertEquals(extractNome("José Silva Filho"), "José Silva Filho");
  assertEquals(extractNome("Carlos Souza Jr", { allowSingleWord: false }), "Carlos Souza Jr.");
});

Deno.test("extractNome: frase de correção NÃO vira nome", () => {
  assertEquals(extractNome("Escrevi errado"), null);
  assertEquals(extractNome("Digitei errado"), null);
  assertEquals(extractNome("escrevi errado", { allowSingleWord: true }), null);
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
  // Prenomes comuns (ex.: consultor Rafael) NÃO podem bloquear o lead
  assertEquals(extractNome("Rafael Ferreira"), "Rafael Ferreira");
  assertEquals(extractNome("Rafael", { allowSingleWord: true }), "Rafael");
});

Deno.test("extractNome: frases de indicação do QR do Horacio NÃO vira nome", () => {
  // bug real: "limpa nome te recomendou" virava nome "Te Recomendou"
  assertEquals(extractNome("Olá o horacio do limpa nome te recomendou, para eu economizar."), null);
  assertEquals(extractNome("o horacio te recomendou"), null);
  assertEquals(extractNome("a nilma me indicou"), null);
  assertEquals(extractNome("o joão nos recomendou pra economizar"), null);
  assertEquals(extractNome("fulano me mandou aqui"), null);
});

Deno.test("extractTelefone: zero à esquerda 0XX (caso Isa)", () => {
  assertEquals(extractTelefone("03481914644"), "3481914644");
  assertEquals(extractTelefone("(34) 8191-4644"), "3481914644");
  assertEquals(extractTelefone("34 98191-4644"), "34981914644");
});

Deno.test("extractNome: gatilho 'nome' sem dois-pontos não captura mais (regressão Horacio)", () => {
  assertEquals(extractNome("limpa nome te recomendou pra economizar"), null);
  assertEquals(extractNome("Nome: João Silva"), "João Silva");
});

