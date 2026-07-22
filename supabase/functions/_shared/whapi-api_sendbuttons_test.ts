// Testa fallback de sendButtons → texto numerado em whapi-api.ts

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createWhapiSender } from "./whapi-api.ts";
import { _clearWhatsAppChatIdMemoryCacheForTests } from "./resolve-whatsapp-chat-id.ts";

function mockWhapiContactsOk(body: string): Response {
  let phones: string[] = [];
  try {
    const parsed = JSON.parse(body);
    phones = Array.isArray(parsed?.contacts) ? parsed.contacts.map(String) : [];
  } catch { /* ignore */ }
  const rows = (phones.length ? phones : ["5511999999999"]).map((p) => {
    const digits = String(p).replace(/\D/g, "");
    return { input: digits, status: "valid", wa_id: `${digits}@s.whatsapp.net` };
  });
  return new Response(JSON.stringify({ contacts: rows }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.test("whapi sendButtons: fallback usa formato *N.* numerado", async () => {
  _clearWhatsAppChatIdMemoryCacheForTests();
  const calls: Array<{ url: string; body: string }> = [];
  const origFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = String(init?.body ?? "");
    calls.push({ url, body });
    if (url.includes("/contacts")) return mockWhapiContactsOk(body);
    if (url.includes("/messages/interactive")) {
      return new Response("fail", { status: 500 });
    }
    return new Response(JSON.stringify({ message: { id: "wamid.btn" } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const sender = createWhapiSender("fake-token", "https://gate.whapi.cloud");
    const ok = await sender.sendButtons(
      "5511999999999@s.whatsapp.net",
      "Escolha",
      [
        { id: "a", title: "Opção A" },
        { id: "b", title: "Opção B" },
      ],
    );
    assertEquals(ok, true);
    const textCall = calls.find((c) => c.url.includes("/messages/text"));
    assertEquals(!!textCall, true);
    assertEquals(textCall!.body.includes("*1.* Opção A"), true);
    assertEquals(textCall!.body.includes("*2.* Opção B"), true);
    assertEquals(textCall!.body.includes("1️⃣"), false);
  } finally {
    globalThis.fetch = origFetch;
    _clearWhatsAppChatIdMemoryCacheForTests();
  }
});
