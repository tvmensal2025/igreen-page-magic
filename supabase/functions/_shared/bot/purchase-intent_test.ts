import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { hasPurchaseIntent } from "./purchase-intent.ts";

Deno.test("hasPurchaseIntent: frases positivas", () => {
  assertEquals(hasPurchaseIntent("quero contratar"), true);
  assertEquals(hasPurchaseIntent("Quero Contratar!"), true);
  assertEquals(hasPurchaseIntent("vamos sim"), true);
  assertEquals(hasPurchaseIntent("aceito a proposta"), true);
  assertEquals(hasPurchaseIntent("como faço para aderir?"), true);
  assertEquals(hasPurchaseIntent("COMO FACO PARA ADERIR"), true);
});

Deno.test("hasPurchaseIntent: negação antes da frase", () => {
  assertEquals(hasPurchaseIntent("não quero contratar"), false);
  assertEquals(hasPurchaseIntent("nao quero contratar"), false);
  assertEquals(hasPurchaseIntent("nem vamos sim"), false);
});

Deno.test("hasPurchaseIntent: perguntas comuns não disparam", () => {
  assertEquals(hasPurchaseIntent("é golpe?"), false);
  assertEquals(hasPurchaseIntent("como funciona?"), false);
  assertEquals(hasPurchaseIntent(""), false);
});
