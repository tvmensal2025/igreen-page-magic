import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isCadastroStepForMidflowQa } from "./kb-answer.ts";

Deno.test("isCadastroStepForMidflowQa: passos clássicos", () => {
  assertEquals(isCadastroStepForMidflowQa("ask_email"), true);
  assertEquals(isCadastroStepForMidflowQa("aguardando_conta"), true);
  assertEquals(isCadastroStepForMidflowQa("confirm_phone"), true);
});

Deno.test("isCadastroStepForMidflowQa: Sofia Multicanal a*", () => {
  assertEquals(isCadastroStepForMidflowQa("a1_ask_name"), true);
  assertEquals(isCadastroStepForMidflowQa("a6_ask_bill_photo"), true);
  assertEquals(isCadastroStepForMidflowQa("a7_ask_document"), true);
});

Deno.test("isCadastroStepForMidflowQa: flow UUID e fora", () => {
  assertEquals(isCadastroStepForMidflowQa("flow:abc-123"), true);
  assertEquals(isCadastroStepForMidflowQa("NEW"), false);
  assertEquals(isCadastroStepForMidflowQa(""), false);
});
