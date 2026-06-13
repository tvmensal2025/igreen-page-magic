// Testes unitários do adapter Whapi.
// Cobre `parseInbound` para texto, quick_reply (sem ButtonsV3:), list_reply
// (sem ListV3:), mídia, grupo (ignorado).

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createWhapiAdapter } from "./whapi.ts";

const ADAPTER = createWhapiAdapter({ apiToken: "fake" });

Deno.test("whapi adapter: capabilities estáticas estão corretas", () => {
  const c = ADAPTER.capabilities;
  assertEquals(c.channel, "whapi");
  assertEquals(c.supportsButtons, true);
  assertEquals(c.maxButtons, 3);
  assertEquals(c.supportsList, true);
  assertEquals(c.supportsAudio, true);
  assertEquals(c.supportsVideo, true);
  assertEquals(c.supportsTypingPresence, true);
  assertEquals(c.supportsReactions, true);
  assertEquals(c.inboundIdField, "messageId");
});

Deno.test("whapi parseInbound: texto puro", () => {
  const raw = {
    messages: [{
      id: "wamid.001",
      chat_id: "5511999999999@s.whatsapp.net",
      from: "5511999999999",
      from_me: false,
      type: "text",
      text: { body: "tudo bem" },
    }],
  };
  const r = ADAPTER.parseInbound(raw, "whapi-superadmin");
  assertEquals(r?.channel, "whapi");
  assertEquals(r?.messageText, "tudo bem");
  assertEquals(r?.buttonId, null);
});

Deno.test("whapi parseInbound: quick_reply remove prefix ButtonsV3:", () => {
  const raw = {
    messages: [{
      id: "wamid.002",
      chat_id: "5511999999999@s.whatsapp.net",
      from: "5511999999999",
      from_me: false,
      type: "reply",
      reply: { type: "buttons_reply", buttons_reply: { id: "ButtonsV3:sim_phone", title: "Sim" } },
    }],
  };
  const r = ADAPTER.parseInbound(raw, "whapi-superadmin");
  assertEquals(r?.buttonId, "sim_phone");
});

Deno.test("whapi parseInbound: list_reply remove prefix ListV3:", () => {
  const raw = {
    messages: [{
      id: "wamid.003",
      chat_id: "5511999999999@s.whatsapp.net",
      from: "5511999999999",
      from_me: false,
      type: "reply",
      reply: { type: "list_reply", list_reply: { id: "ListV3:option_a", title: "Opção A" } },
    }],
  };
  const r = ADAPTER.parseInbound(raw, "whapi-superadmin");
  assertEquals(r?.buttonId, "option_a");
});

Deno.test("whapi parseInbound: imagem", () => {
  const raw = {
    messages: [{
      id: "wamid.004",
      chat_id: "5511999999999@s.whatsapp.net",
      from: "5511999999999",
      from_me: false,
      type: "image",
      image: { mime_type: "image/jpeg", link: "https://x" },
    }],
  };
  const r = ADAPTER.parseInbound(raw, "whapi-superadmin");
  assertEquals(r?.hasMedia, true);
  assertEquals(r?.mediaKind, "image");
});

Deno.test("whapi parseInbound: voice (PTT) é classificado como áudio", () => {
  const raw = {
    messages: [{
      id: "wamid.005",
      chat_id: "5511999999999@s.whatsapp.net",
      from: "5511999999999",
      from_me: false,
      type: "voice",
      voice: { mime_type: "audio/ogg", link: "https://x" },
    }],
  };
  const r = ADAPTER.parseInbound(raw, "whapi-superadmin");
  assertEquals(r?.hasMedia, true);
  assertEquals(r?.mediaKind, "audio");
});

Deno.test("whapi parseInbound: grupo é ignorado", () => {
  const raw = {
    messages: [{
      id: "wamid.006",
      chat_id: "120363@g.us",
      from: "5511",
      from_me: false,
      type: "text",
      text: { body: "x" },
    }],
  };
  assertEquals(ADAPTER.parseInbound(raw, "whapi-superadmin"), null);
});

Deno.test("whapi parseInbound: takeover humano (from_me com source=app)", () => {
  const raw = {
    messages: [{
      id: "wamid.007",
      chat_id: "5511999999999@s.whatsapp.net",
      from: "5511999999999",
      from_me: true,
      source: "mobile",
      type: "text",
      text: { body: "consultor digitando" },
    }],
  };
  const r = ADAPTER.parseInbound(raw, "whapi-superadmin");
  assertEquals(r?.isFromMe, true);
});

Deno.test("whapi sendChoice: >3 opções usa texto numerado (não interactive)", async () => {
  const calls: Array<{ url: string; body: string }> = [];
  const origFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), body: String(init?.body ?? "") });
    return new Response("ok", { status: 200 });
  }) as typeof fetch;

  try {
    const result = await ADAPTER.sendChoice(
      "5511999999999@s.whatsapp.net",
      "Escolha",
      {
        preferred: "button",
        options: [
          { id: "a", title: "A" },
          { id: "b", title: "B" },
          { id: "c", title: "C" },
          { id: "d", title: "D" },
        ],
      },
      {},
    );
    assertEquals(result.ok, false);
    assertEquals(result.reason, "downgraded");
    assertEquals(calls.some((c) => c.url.includes("/messages/interactive")), false);
    const textCall = calls.find((c) => c.url.includes("/messages/text"));
    assertEquals(!!textCall, true);
    assertEquals(textCall!.body.includes("*4.* D"), true);
  } finally {
    globalThis.fetch = origFetch;
  }
});
