import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  brazilWhatsAppPhoneVariants,
  digitsOnlyPhone,
  pickWaDigitsFromCheck,
  pickWaDigitsFromEvolutionCheck,
  toWhatsAppChatId,
  _clearWhatsAppChatIdMemoryCacheForTests,
} from "./resolve-whatsapp-chat-id.ts";

Deno.test("digitsOnlyPhone strips JID and punctuation", () => {
  assertEquals(digitsOnlyPhone("5534999772215@s.whatsapp.net"), "5534999772215");
  assertEquals(digitsOnlyPhone("+55 34 99977-2215"), "5534999772215");
});

Deno.test("brazilWhatsAppPhoneVariants covers with/without ninth digit", () => {
  const withNine = brazilWhatsAppPhoneVariants("5534999772215");
  assertEquals(withNine.includes("5534999772215"), true);
  assertEquals(withNine.includes("553499772215"), true);

  const withoutNine = brazilWhatsAppPhoneVariants("553499772215");
  assertEquals(withoutNine.includes("553499772215"), true);
  assertEquals(withoutNine.includes("5534999772215"), true);
});

Deno.test("pickWaDigitsFromCheck prefers wa_id over CRM phone with extra 9", () => {
  _clearWhatsAppChatIdMemoryCacheForTests();
  const picked = pickWaDigitsFromCheck(
    [
      { input: "5534999772215", status: "valid", wa_id: "553499772215@s.whatsapp.net" },
      { input: "553499772215", status: "invalid" },
    ],
    "5534999772215",
  );
  assertEquals(picked?.status, "valid");
  assertEquals(picked?.digits, "553499772215");
});

Deno.test("pickWaDigitsFromCheck marks all-invalid", () => {
  const picked = pickWaDigitsFromCheck(
    [
      { input: "5511999999999", status: "invalid" },
      { input: "551199999999", status: "invalid" },
    ],
    "5511999999999",
  );
  assertEquals(picked?.status, "invalid");
});

Deno.test("pickWaDigitsFromEvolutionCheck uses jid without ninth digit", () => {
  const picked = pickWaDigitsFromEvolutionCheck(
    [
      { exists: true, jid: "553499772215@s.whatsapp.net", number: "553499772215" },
      { exists: false, jid: "5534999772215@s.whatsapp.net", number: "5534999772215" },
    ],
    "5534999772215",
  );
  assertEquals(picked?.status, "valid");
  assertEquals(picked?.digits, "553499772215");
});

Deno.test("pickWaDigitsFromEvolutionCheck all missing → invalid", () => {
  const picked = pickWaDigitsFromEvolutionCheck(
    [
      { exists: false, number: "5511999999999" },
      { exists: false, number: "551199999999" },
    ],
    "5511999999999",
  );
  assertEquals(picked?.status, "invalid");
});

Deno.test("toWhatsAppChatId builds JID", () => {
  assertEquals(toWhatsAppChatId("553499772215"), "553499772215@s.whatsapp.net");
  assertEquals(
    toWhatsAppChatId("553499772215@s.whatsapp.net"),
    "553499772215@s.whatsapp.net",
  );
});

Deno.test("resolveWhatsAppChatId fail-closed on no provider", async () => {
  _clearWhatsAppChatIdMemoryCacheForTests();
  const { resolveWhatsAppChatId } = await import("./resolve-whatsapp-chat-id.ts");
  const r = await resolveWhatsAppChatId({ phoneOrJid: "5534999772215" });
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.reason, "no_provider");
});

Deno.test("resolveWhatsAppChatId fail-closed when all providers fail", async () => {
  _clearWhatsAppChatIdMemoryCacheForTests();
  const { resolveWhatsAppChatId } = await import("./resolve-whatsapp-chat-id.ts");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response("upstream down", { status: 503 }) as Response;
  try {
    const r = await resolveWhatsAppChatId({
      phoneOrJid: "5534999772215",
      provider: { kind: "whapi", apiToken: "tok", baseUrl: "https://example.invalid" },
    });
    assertEquals(r.ok, false);
    if (!r.ok) assertEquals(r.reason, "check_failed");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("resolveWhatsAppChatId rewrites ninth digit via whapi check", async () => {
  _clearWhatsAppChatIdMemoryCacheForTests();
  const { resolveWhatsAppChatId } = await import("./resolve-whatsapp-chat-id.ts");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        contacts: [
          { input: "5534999772215", status: "valid", wa_id: "553499772215@s.whatsapp.net" },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ) as Response;
  try {
    const r = await resolveWhatsAppChatId({
      phoneOrJid: "5534999772215",
      provider: { kind: "whapi", apiToken: "tok", baseUrl: "https://gate.whapi.cloud" },
    });
    assertEquals(r.ok, true);
    if (r.ok) {
      assertEquals(r.digits, "553499772215");
      assertEquals(r.changed, true);
      assertEquals(r.source, "whapi_check");
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});
