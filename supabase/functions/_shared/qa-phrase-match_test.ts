import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { phraseMatchesMessage } from "./qa-phrase-match.ts";

Deno.test("golpe / multa / aneel com word-boundary", () => {
  assertEquals(phraseMatchesMessage("golpe", "Isso não é golpe?"), true);
  assertEquals(phraseMatchesMessage("multa", "Tem multa se eu cancelar?"), true);
  assertEquals(phraseMatchesMessage("aneel", "É regulamentado pela ANEEL?"), true);
  assertEquals(phraseMatchesMessage("golpe", "fui golpeado"), false);
});

Deno.test("genéricos soltos NÃO disparam", () => {
  assertEquals(phraseMatchesMessage("depois", "te mando depois"), false);
  assertEquals(phraseMatchesMessage("ativar", "demora pra ativar"), false);
  assertEquals(phraseMatchesMessage("conta", "manda a conta"), false);
  assertEquals(phraseMatchesMessage("link", "tem link?"), false);
  assertEquals(phraseMatchesMessage("taxa", "taxa de disponibilidade"), false);
  assertEquals(phraseMatchesMessage("solar", "energia solar"), false);
});

Deno.test("fragmento curto NÃO casa gatilho longo (falso positivo cobertura)", () => {
  assertEquals(phraseMatchesMessage("nao sou de uberlandia", "nao sou"), false);
  assertEquals(phraseMatchesMessage("moro em araguari", "moro em"), false);
  assertEquals(phraseMatchesMessage("me fala depois", "depois"), false);
});

Deno.test("atalho legítimo de uma palavra", () => {
  assertEquals(phraseMatchesMessage("quero simular", "simular"), true);
  assertEquals(phraseMatchesMessage("é golpe", "golpe"), true);
});

Deno.test("frase composta exige contiguidade", () => {
  assertEquals(phraseMatchesMessage("trocar empresa", "quero trocar empresa agora"), true);
  assertEquals(phraseMatchesMessage("trocar empresa", "trocar de uma empresa"), false);
});

Deno.test("stopwords nunca disparam", () => {
  assertEquals(phraseMatchesMessage("nao", "nao quero isso"), false);
  assertEquals(phraseMatchesMessage("sim", "sim pode ser"), false);
});
