import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { phraseMatchesMessage } from "./index.ts";

// Helper: normaliza igual ao _norm interno (minúsculo, sem acento, trim).
const norm = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

function matches(phrase: string, message: string): boolean {
  return phraseMatchesMessage(norm(phrase), norm(message));
}

// ─── Bug original: gatilhos curtos (4-5 chars) dentro de uma frase ──────
Deno.test("gatilho 'golpe' casa em 'Isso não é golpe?'", () => {
  assertEquals(matches("golpe", "Isso não é golpe?"), true);
});

Deno.test("gatilho 'multa' casa em 'Tem multa se eu cancelar?'", () => {
  assertEquals(matches("multa", "Tem multa se eu cancelar?"), true);
});

Deno.test("gatilho 'aneel' casa em 'É regulamentado pela ANEEL?'", () => {
  assertEquals(matches("aneel", "É regulamentado pela ANEEL?"), true);
});

Deno.test("gatilho 'cnpj' casa em 'Qual o CNPJ de vocês?'", () => {
  assertEquals(matches("cnpj", "Qual o CNPJ de vocês?"), true);
});

Deno.test("gatilho 'lgpd' casa em 'e a LGPD, como fica?'", () => {
  assertEquals(matches("lgpd", "e a LGPD, como fica?"), true);
});

// ─── Não pode reintroduzir falsos positivos de substring ────────────────
Deno.test("gatilho 'ap' NÃO casa dentro de 'sapato'", () => {
  assertEquals(matches("ap", "comprei um sapato novo"), false);
});

Deno.test("gatilho 'ap' casa como palavra isolada 'moro num ap'", () => {
  assertEquals(matches("ap", "moro num ap"), true);
});

Deno.test("stopword 'não' nunca dispara FAQ", () => {
  assertEquals(matches("não", "não quero isso agora"), false);
});

Deno.test("stopword 'sim' nunca dispara FAQ", () => {
  assertEquals(matches("sim", "sim, pode ser"), false);
});

// ─── Igualdade exata e frases compostas ─────────────────────────────────
Deno.test("igualdade exata casa", () => {
  assertEquals(matches("golpe", "golpe"), true);
});

Deno.test("frase composta casa como substring contígua", () => {
  assertEquals(matches("trocar empresa", "quero trocar empresa agora"), true);
});

Deno.test("frase composta não casa se palavras separadas", () => {
  assertEquals(matches("trocar empresa", "trocar de uma empresa"), false);
});

// ─── Mensagem curta contida no gatilho (lead digita atalho) ─────────────
Deno.test("mensagem curta 'simular' casa no gatilho 'quero simular'", () => {
  assertEquals(matches("quero simular", "simular"), true);
});

Deno.test("fragmento 'nao sou' NÃO casa gatilho de cobertura", () => {
  assertEquals(matches("nao sou de uberlandia", "nao sou"), false);
});

Deno.test("genérico 'depois' NÃO casa FAQ", () => {
  assertEquals(matches("depois", "te mando depois"), false);
});

// ─── Word boundary respeita acento removido ─────────────────────────────
Deno.test("gatilho 'fraude' casa em 'isso é fraude né'", () => {
  assertEquals(matches("fraude", "isso é fraude né"), true);
});

Deno.test("gatilho curto não casa em palavra maior (golpe vs golpeado)", () => {
  // "golpe" não deve casar dentro de "golpeado" (limite de palavra à direita).
  assertEquals(matches("golpe", "fui golpeado"), false);
});

// ─── Guardas básicas ────────────────────────────────────────────────────
Deno.test("phrase vazia não casa", () => {
  assertEquals(matches("", "qualquer coisa"), false);
});

Deno.test("phrase de 1 char não casa", () => {
  assertEquals(matches("x", "x marca o ponto"), false);
});

Deno.test("mensagem vazia não casa", () => {
  assertEquals(matches("golpe", ""), false);
});
