// Testa fallback de sendButtons → texto numerado em whapi-api.ts

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createWhapiSender } from "./whapi-api.ts";

Deno.test("whapi sendButtons: fallback usa formato *N.* numerado", async () => {
  const calls: Array<{ url: string; body: string }> = [];
  const origFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = String(init?.body ?? "");
    calls.push({ url, body });
    if (url.includes("/messages/interactive")) {
      return new Response("fail", { status: 500 });
    }
    return new Response("ok", { status: 200 });
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
  }
});
