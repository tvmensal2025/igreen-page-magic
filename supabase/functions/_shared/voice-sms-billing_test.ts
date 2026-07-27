import {
  voiceBillableBlocks,
  voiceBillableCents,
  PLATFORM_SMS_CENTS,
  PLATFORM_VOICE_BLOCK_CENTS,
} from "./voice-sms-billing.ts";

Deno.test("voiceBillableBlocks — faixas de 30s (ceil)", () => {
  if (voiceBillableBlocks(0) !== 1) throw new Error("0s → 1 bloco");
  if (voiceBillableBlocks(1) !== 1) throw new Error("1s → 1");
  if (voiceBillableBlocks(30) !== 1) throw new Error("30s → 1");
  if (voiceBillableBlocks(31) !== 2) throw new Error("31s → 2");
  if (voiceBillableBlocks(60) !== 2) throw new Error("60s → 2");
  if (voiceBillableBlocks(61) !== 3) throw new Error("61s → 3");
  if (voiceBillableBlocks(90) !== 3) throw new Error("90s → 3");
});

Deno.test("voiceBillableCents — R$ 0,10 por bloco", () => {
  if (voiceBillableCents(15) !== 10) throw new Error("15s = 10c");
  if (voiceBillableCents(31) !== 20) throw new Error("31s = 20c");
  if (PLATFORM_SMS_CENTS !== 10) throw new Error("SMS 10c");
  if (PLATFORM_VOICE_BLOCK_CENTS !== 10) throw new Error("bloco 10c");
});
