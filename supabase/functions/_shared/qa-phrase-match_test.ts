import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { phraseMatchesMessage } from "./qa-phrase-match.ts";

Deno.test("frases compostas de FAQ casam", () => {
  assertEquals(phraseMatchesMessage("é golpe", "Isso não é golpe?"), true);
  assertEquals(phraseMatchesMessage("tem multa", "Tem multa se eu cancelar?"), true);
  assertEquals(phraseMatchesMessage("regulamentado pela aneel", "É regulamentado pela ANEEL?"), true);
  assertEquals(phraseMatchesMessage("qual o cnpj", "Qual o CNPJ de vocês?"), true);
  assertEquals(phraseMatchesMessage("tem fidelidade", "vocês tem fidelidade?"), true);
});

Deno.test("genéricos soltos NÃO disparam (mesmo como gatilho no DB)", () => {
  assertEquals(phraseMatchesMessage("golpe", "Isso não é golpe?"), false);
  assertEquals(phraseMatchesMessage("multa", "Tem multa se eu cancelar?"), false);
  assertEquals(phraseMatchesMessage("fidelidade", "tem fidelidade"), false);
  assertEquals(phraseMatchesMessage("depois", "te mando depois"), false);
  assertEquals(phraseMatchesMessage("ativar", "demora pra ativar"), false);
  assertEquals(phraseMatchesMessage("conta", "manda a conta"), false);
  assertEquals(phraseMatchesMessage("taxa", "taxa de disponibilidade"), false);
  assertEquals(phraseMatchesMessage("aneel", "é da aneel"), false);
});

Deno.test("fragmento curto NÃO casa gatilho longo", () => {
  assertEquals(phraseMatchesMessage("nao sou de uberlandia", "nao sou"), false);
  assertEquals(phraseMatchesMessage("moro em araguari", "moro em"), false);
  assertEquals(phraseMatchesMessage("me fala depois", "depois"), false);
});

Deno.test("atalho legítimo de uma palavra (não genérica)", () => {
  assertEquals(phraseMatchesMessage("quero simular", "simular"), true);
  assertEquals(phraseMatchesMessage("serasa", "vai pro serasa"), true);
});

Deno.test("frase composta exige contiguidade", () => {
  assertEquals(phraseMatchesMessage("trocar empresa", "quero trocar empresa agora"), true);
  assertEquals(phraseMatchesMessage("trocar empresa", "trocar de uma empresa"), false);
});

Deno.test("stopwords nunca disparam", () => {
  assertEquals(phraseMatchesMessage("nao", "nao quero isso"), false);
  assertEquals(phraseMatchesMessage("sim", "sim pode ser"), false);
});
