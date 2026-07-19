import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buttonsFromFlowCaptures,
  parseContractButtons,
  validateContractButtons,
} from "./content-contract.ts";

Deno.test("validateContractButtons: vazio/null ok", () => {
  assertEquals(validateContractButtons(null).ok, true);
  assertEquals(validateContractButtons([]).ok, true);
});

Deno.test("validateContractButtons: 3 válidos ok", () => {
  const r = validateContractButtons([
    { id: "a", title: "Até R$300" },
    { id: "b", title: "R$300 a R$700" },
    { id: "c", title: "Acima de R$700" },
  ]);
  assertEquals(r.ok, true);
});

Deno.test("validateContractButtons: 4 botões falha", () => {
  const r = validateContractButtons([
    { id: "a", title: "1" },
    { id: "b", title: "2" },
    { id: "c", title: "3" },
    { id: "d", title: "4" },
  ]);
  assertEquals(r.ok, false);
});

Deno.test("validateContractButtons: título >25 falha", () => {
  const r = validateContractButtons([
    { id: "a", title: "Um título gigantesco que passa de vinte e cinco" },
  ]);
  assertEquals(r.ok, false);
});

Deno.test("parseContractButtons: jsonb array ok", () => {
  const r = parseContractButtons([
    { id: "analyze", title: "Quero analisar" },
    { id: "call_me", title: "Pode me ligar" },
  ]);
  assertEquals(r?.length, 2);
  assertEquals(r?.[0].id, "analyze");
});

Deno.test("parseContractButtons: string JSON ok", () => {
  const r = parseContractButtons('[{"id":"x","title":"Ok"}]');
  assertEquals(r?.length, 1);
});

Deno.test("parseContractButtons: inválido → null (fallback)", () => {
  assertEquals(parseContractButtons(null), null);
  assertEquals(parseContractButtons("not-json"), null);
  assertEquals(parseContractButtons([{ id: "", title: "x" }]), null);
  assertEquals(parseContractButtons([{ id: "a", title: "" }]), null);
  assertEquals(parseContractButtons([]), null);
  assertEquals(
    parseContractButtons([
      { id: "a", title: "1" },
      { id: "b", title: "2" },
      { id: "c", title: "3" },
      { id: "d", title: "4" },
    ]),
    null,
  );
});

Deno.test("buttonsFromFlowCaptures: shape do Flow Builder", () => {
  const captures = [
    { field: "name", enabled: true },
    {
      field: "_buttons",
      enabled: true,
      value: [{ id: "sim", title: "✅ SIM" }, { id: "nao", title: "❌ NÃO" }],
    },
  ];
  const r = buttonsFromFlowCaptures(captures);
  assertEquals(r?.length, 2);
  assertEquals(r?.[1].id, "nao");
});

Deno.test("buttonsFromFlowCaptures: _buttons desabilitado → null", () => {
  const r = buttonsFromFlowCaptures([
    { field: "_buttons", enabled: false, value: [{ id: "a", title: "x" }] },
  ]);
  assertEquals(r, null);
});
