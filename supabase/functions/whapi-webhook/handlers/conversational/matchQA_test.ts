import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { phraseMatchesMessage } from "./index.ts";

// Helper: normaliza igual ao matcher (minúsculo, sem acento, trim).
const norm = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

function matches(phrase: string, message: string): boolean {
  return phraseMatchesMessage(norm(phrase), norm(message));
}

Deno.test("frase 'é golpe' casa em 'Isso não é golpe?'", () => {
  assertEquals(matches("é golpe", "Isso não é golpe?"), true);
});

Deno.test("frase 'tem multa' casa em pergunta de cancelamento", () => {
  assertEquals(matches("tem multa", "Tem multa se eu cancelar?"), true);
});

Deno.test("frase 'regulamentado pela aneel' casa", () => {
  assertEquals(matches("regulamentado pela aneel", "É regulamentado pela ANEEL?"), true);
});

Deno.test("frase 'qual o cnpj' casa", () => {
  assertEquals(matches("qual o cnpj", "Qual o CNPJ de vocês?"), true);
});

Deno.test("frase 'proteção lgpd' casa", () => {
  assertEquals(matches("proteção lgpd", "e a proteção lgpd, como fica?"), true);
});

Deno.test("gatilho genérico 'golpe' NÃO casa sozinho", () => {
  assertEquals(matches("golpe", "Isso não é golpe?"), false);
});

Deno.test("gatilho genérico 'ap' NÃO casa", () => {
  assertEquals(matches("ap", "moro num ap"), false);
  assertEquals(matches("ap", "comprei um sapato novo"), false);
});

Deno.test("stopword 'não' nunca dispara FAQ", () => {
  assertEquals(matches("não", "não quero isso agora"), false);
});

Deno.test("stopword 'sim' nunca dispara FAQ", () => {
  assertEquals(matches("sim", "sim, pode ser"), false);
});

Deno.test("igualdade exata casa", () => {
  assertEquals(matches("é golpe", "é golpe"), true);
});

Deno.test("frase composta casa como substring contígua", () => {
  assertEquals(matches("trocar empresa", "quero trocar empresa agora"), true);
});

Deno.test("frase composta não casa se palavras separadas", () => {
  assertEquals(matches("trocar empresa", "trocar de uma empresa"), false);
});

Deno.test("mensagem curta 'simular' casa no gatilho 'quero simular'", () => {
  assertEquals(matches("quero simular", "simular"), true);
});

Deno.test("fragmento 'nao sou' NÃO casa gatilho de cobertura", () => {
  assertEquals(matches("nao sou de uberlandia", "nao sou"), false);
});

Deno.test("genérico 'depois' NÃO casa FAQ", () => {
  assertEquals(matches("depois", "te mando depois"), false);
});

Deno.test("phrase vazia não casa", () => {
  assertEquals(matches("", "qualquer coisa"), false);
});

Deno.test("phrase de 1 char não casa", () => {
  assertEquals(matches("x", "x marca o ponto"), false);
});

Deno.test("mensagem vazia não casa", () => {
  assertEquals(matches("golpe", ""), false);
});
