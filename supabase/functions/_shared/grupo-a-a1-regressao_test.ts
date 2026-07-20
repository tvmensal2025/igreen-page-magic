/**
 * Regressão 2026-07-20 — Manoel Bento de Oliveira:
 * nome completo de 4 palavras NÃO pode ser rejeitado (causava handoff).
 * "Escrevi errado" NÃO pode virar nome via freeform_multi.
 */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { extractNome } from "./captureExtractors.ts";
import { buildMultiFieldPatch, extractMultiField } from "./multi-field-extractor.ts";
import { isUsableCustomerName } from "./customer-display-name.ts";

Deno.test("regressão A1: Manoel Bento de Oliveira vira nome (askName)", () => {
  const nome = extractNome("Manoel Bento de Oliveira", { allowSingleWord: true });
  assertEquals(nome, "Manoel Bento de Oliveira");
});

Deno.test("regressão A1: Manoel Bento de Oliveira vira nome mesmo sem allowSingleWord", () => {
  // 4 palavras — não depende de allowSingleWord
  assertEquals(extractNome("Manoel Bento de Oliveira"), "Manoel Bento de Oliveira");
});

Deno.test("regressão A1: multi-field grava self path freeform só se vazio", () => {
  const multi = extractMultiField("Manoel Bento de Oliveira", { allowSingleWordName: true });
  assertEquals(multi.nome, "Manoel Bento de Oliveira");
  const patch = buildMultiFieldPatch(
    { id: "x", name: null, name_source: null },
    multi,
  );
  assertEquals(patch.name, "Manoel Bento de Oliveira");
  assertEquals(patch.name_source, "freeform_multi");
});

Deno.test("regressão A1: Escrevi errado NÃO vira nome", () => {
  assertEquals(extractNome("Escrevi errado"), null);
  assertEquals(extractNome("Escrevi errado", { allowSingleWord: true }), null);
  const multi = extractMultiField("Escrevi errado", { allowSingleWordName: true });
  assertEquals(multi.nome, undefined);
  const patch = buildMultiFieldPatch(
    { id: "x", name: "Manoel Bento de Oliveira", name_source: "self_introduced" },
    multi,
  );
  assertEquals(patch.name, undefined);
});

Deno.test("regressão A1: freeform_multi NÃO sobrescreve self_introduced", () => {
  const multi = extractMultiField("Joao Silva", { allowSingleWordName: true });
  const patch = buildMultiFieldPatch(
    { id: "x", name: "Manoel Bento de Oliveira", name_source: "self_introduced" },
    multi,
  );
  assertEquals(patch.name, undefined);
});

Deno.test("regressão A1: prenome único quando bot pediu nome", () => {
  assertEquals(extractNome("Manoel", { allowSingleWord: true }), "Manoel");
  assertEquals(extractNome("Manoel"), null);
});

Deno.test("regressão display: Escrevi Errado não é usável pra chamar", () => {
  assertEquals(isUsableCustomerName("Escrevi Errado"), false);
  assertEquals(isUsableCustomerName("Manoel Bento de Oliveira"), true);
});
