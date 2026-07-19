import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  BILL_RANGE_BUTTONS,
  buttonsForStage,
  resolveStageButtons,
  stageHasButtons,
} from "./cadence-stage-buttons.ts";

Deno.test("buttonsForStage: COLD_1 tem faixas de conta", () => {
  assertEquals(buttonsForStage("COLD_1"), BILL_RANGE_BUTTONS);
  assertEquals(stageHasButtons("COLD_1"), true);
});

Deno.test("buttonsForStage: estágio sem botões (SMS) vazio", () => {
  assertEquals(buttonsForStage("SMS_1"), []);
  assertEquals(stageHasButtons("SMS_1"), false);
});

Deno.test("resolveStageButtons: config null → fallback hardcoded", () => {
  assertEquals(resolveStageButtons(null, "COLD_1"), BILL_RANGE_BUTTONS);
  assertEquals(resolveStageButtons(undefined, "RECALL_60D"), BILL_RANGE_BUTTONS);
});

Deno.test("resolveStageButtons: config válido vence o hardcoded", () => {
  const custom = [
    { id: "bill_low", title: "Até R$250" },
    { id: "bill_mid", title: "R$250 a R$600" },
  ];
  assertEquals(resolveStageButtons(custom, "COLD_1"), custom);
});

Deno.test("resolveStageButtons: config inválido → fallback (fail-safe)", () => {
  // 4 botões: acima do limite Whapi
  const four = [
    { id: "a", title: "1" },
    { id: "b", title: "2" },
    { id: "c", title: "3" },
    { id: "d", title: "4" },
  ];
  assertEquals(resolveStageButtons(four, "COLD_1"), BILL_RANGE_BUTTONS);
  // título estourando 25 chars
  const longTitle = [{ id: "a", title: "Título absurdamente longo demais aqui" }];
  assertEquals(resolveStageButtons(longTitle, "COLD_1"), BILL_RANGE_BUTTONS);
  // lixo
  assertEquals(resolveStageButtons("garbage", "COLD_1"), BILL_RANGE_BUTTONS);
  assertEquals(resolveStageButtons([{}], "COLD_1"), BILL_RANGE_BUTTONS);
});

Deno.test("resolveStageButtons: config em estágio sem hardcoded ainda vale", () => {
  const custom = [{ id: "x", title: "Ok" }];
  assertEquals(resolveStageButtons(custom, "SMS_1"), custom);
  assertEquals(resolveStageButtons(null, "SMS_1"), []);
});
