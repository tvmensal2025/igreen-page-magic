// Testes do adapter WAME (canal piloto). Cobrem o que quebraria o funil em
// produção: id de botão com prefixo de protocolo, `from_me` virando pausa
// fantasma, grupo entrando no funil e limites de botão do WhatsApp.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createWameAdapter, WAME_CAPABILITIES } from "./wame.ts";
import type { SendContext } from "./types.ts";

const SERVER = "https://us.api-wa.me";
const KEY = "test-key";

function adapter() {
  return createWameAdapter({ server: SERVER, apiKey: KEY, instanceName: "wame-piloto" });
}

/** Sem `supabase` no ctx, o adapter não toca em idempotência/banco. */
const ctx: SendContext = {
  customerId: "cust-1",
  consultantId: "cons-1",
  stepId: "step-1",
  idempotencyKey: "idem-1",
};

interface Captured {
  url: string;
  body: Record<string, any>;
}

/** Substitui o fetch global e devolve as chamadas capturadas. */
function stubFetch(
  responder: (url: string) => { status: number; body: string },
): { calls: Captured[]; restore: () => void } {
  const calls: Captured[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    let body: Record<string, any> = {};
    try {
      body = init?.body ? JSON.parse(String(init.body)) : {};
    } catch (_) { /* corpo não-JSON */ }
    calls.push({ url, body });
    const r = responder(url);
    return Promise.resolve(new Response(r.body, { status: r.status }));
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

function okFetch() {
  return stubFetch(() => ({ status: 200, body: JSON.stringify({ messageId: "wamid.1" }) }));
}

// ─── Envelope Meta (formato `webhookFormat: "meta"` da WAME) ──────────────

function envelope(msg: Record<string, unknown>, extra?: Record<string, unknown>) {
  return {
    provider: "whatsapp",
    official: false,
    ...extra,
    entry: [
      {
        id: "inst-1",
        changes: [
          {
            field: "messages",
            value: {
              metadata: { phone_number_id: "111", display_phone_number: "5511999999999" },
              contacts: [{ wa_id: "5534984314317", profile: { name: "Rafael" } }],
              messages: [msg],
            },
          },
        ],
      },
    ],
  };
}

function textMsg(body: string) {
  return { id: "wamid.in.1", from: "5534984314317", timestamp: "1", type: "text", text: { body } };
}

// ─── parseInbound ─────────────────────────────────────────────────────────

Deno.test("parseInbound: texto vira ParsedMessage canônico", () => {
  const p = adapter().parseInbound(envelope(textMsg("Oi, quero saber mais")), "wame-piloto");
  assertEquals(p?.channel, "wame");
  assertEquals(p?.ignored, false);
  assertEquals(p?.phone, "5534984314317");
  assertEquals(p?.remoteJid, "5534984314317@s.whatsapp.net");
  assertEquals(p?.messageText, "Oi, quero saber mais");
  assertEquals(p?.messageId, "wamid.in.1");
  assertEquals(p?.instanceName, "wame-piloto");
  assertEquals(p?.hasMedia, false);
});

Deno.test("parseInbound: telefone sem DDI ganha 55 (normalizePhone)", () => {
  const msg = { ...textMsg("oi"), from: "34984314317" };
  const p = adapter().parseInbound(envelope(msg), "wame-piloto");
  assertEquals(p?.phone, "5534984314317");
});

Deno.test("parseInbound: button_reply strippa o prefixo ButtonsV3", () => {
  const msg = {
    id: "wamid.in.2",
    from: "5534984314317",
    type: "interactive",
    interactive: { button_reply: { id: "ButtonsV3:bill_value", title: "Ver valor" } },
  };
  const p = adapter().parseInbound(envelope(msg), "wame-piloto");
  // Sem o strip, o funil não reconheceria o id e o lead travaria no passo.
  assertEquals(p?.buttonId, "bill_value");
  assertEquals(p?.messageText, "Ver valor");
});

Deno.test("parseInbound: list_reply strippa o prefixo ListV3", () => {
  const msg = {
    id: "wamid.in.3",
    from: "5534984314317",
    type: "interactive",
    interactive: { list_reply: { id: "ListV3:opcao_2", title: "Opção 2" } },
  };
  const p = adapter().parseInbound(envelope(msg), "wame-piloto");
  assertEquals(p?.buttonId, "opcao_2");
});

Deno.test("parseInbound: botão nativo usa o payload", () => {
  const msg = {
    id: "wamid.in.4",
    from: "5534984314317",
    type: "button",
    button: { payload: "quero_sim", text: "Quero sim" },
  };
  const p = adapter().parseInbound(envelope(msg), "wame-piloto");
  assertEquals(p?.buttonId, "quero_sim");
});

Deno.test("parseInbound: from_me é ignorado (não vira takeover humano)", () => {
  // O envelope Meta da WAME não traz `source`, então não dá para separar eco
  // da API de digitação humana. Tratar como takeover pausaria o bot sozinho.
  const msg = { ...textMsg("mensagem que nós enviamos"), from_me: true };
  const p = adapter().parseInbound(envelope(msg), "wame-piloto");
  assertEquals(p?.ignored, true);
  assertEquals(p?.isFromMe, true);
  assertEquals(p?.messageText, "");
});

Deno.test("parseInbound: grupo é ignorado", () => {
  const msg = { ...textMsg("oi grupo"), group_id: "123456@g.us" };
  const p = adapter().parseInbound(envelope(msg), "wame-piloto");
  assertEquals(p?.ignored, true);
});

Deno.test("parseInbound: status/broadcast é ignorado", () => {
  const msg = { ...textMsg("status"), from: "status@broadcast" };
  const p = adapter().parseInbound(envelope(msg), "wame-piloto");
  assertEquals(p?.ignored, true);
});

Deno.test("parseInbound: imagem preenche mediaKind e caption", () => {
  const msg = {
    id: "wamid.in.5",
    from: "5534984314317",
    type: "image",
    image: { id: "media-1", url: "https://cdn/x.jpg", mime_type: "image/jpeg", caption: "minha conta" },
  };
  const p = adapter().parseInbound(envelope(msg), "wame-piloto");
  assertEquals(p?.hasMedia, true);
  assertEquals(p?.mediaKind, "image");
  assertEquals(p?.messageText, "minha conta");
});

Deno.test("parseInbound: resposta numérica pura vira rawNumberReply", () => {
  const p = adapter().parseInbound(envelope(textMsg("2")), "wame-piloto");
  assertEquals(p?.rawNumberReply, "2");
  const p2 = adapter().parseInbound(envelope(textMsg("2 pessoas")), "wame-piloto");
  assertEquals(p2?.rawNumberReply, null);
});

Deno.test("parseInbound: envelope inválido devolve null (endpoint responde 200)", () => {
  const a = adapter();
  assertEquals(a.parseInbound(null, "wame-piloto"), null);
  assertEquals(a.parseInbound({}, "wame-piloto"), null);
  assertEquals(a.parseInbound({ entry: [] }, "wame-piloto"), null);
  assertEquals(a.parseInbound({ entry: [{ id: "x", changes: [] }] }, "wame-piloto"), null);
});

Deno.test("parseInbound: evento de status (ACK) não vira mensagem", () => {
  const body = {
    entry: [{
      id: "inst-1",
      changes: [{ field: "messages", value: { metadata: {}, statuses: [{ id: "w1", status: "read" }] } }],
    }],
  };
  assertEquals(adapter().parseInbound(body, "wame-piloto"), null);
});

// ─── Envio ────────────────────────────────────────────────────────────────

Deno.test("sendText: usa {server}/{key}/message/text com a key no path", async () => {
  const f = okFetch();
  try {
    const r = await adapter().sendText("5534984314317", "Olá", ctx);
    assertEquals(r.ok, true);
    assertEquals(f.calls[0].url, `${SERVER}/${KEY}/message/text`);
    assertEquals(f.calls[0].body.to, "5534984314317");
    assertEquals(f.calls[0].body.text, "Olá");
    assertEquals(f.calls[0].body.provider, "whatsapp");
  } finally {
    f.restore();
  }
});

Deno.test("sendText: aceita JID e envia só os dígitos", async () => {
  const f = okFetch();
  try {
    await adapter().sendText("5534984314317@s.whatsapp.net", "Oi", ctx);
    assertEquals(f.calls[0].body.to, "5534984314317");
  } finally {
    f.restore();
  }
});

Deno.test("sendChoice: até 3 opções usa quick_reply com limites do WhatsApp", async () => {
  const f = okFetch();
  try {
    const r = await adapter().sendChoice(
      "5534984314317",
      "Escolha:",
      {
        preferred: "button",
        options: [
          { id: "a", title: "Sim, quero economizar agora mesmo por favor" },
          { id: "b", title: "Não" },
        ],
      },
      ctx,
    );
    assertEquals(r.ok, true);
    assertEquals(f.calls[0].url, `${SERVER}/${KEY}/message/button_reply`);
    const buttons = f.calls[0].body.buttons;
    assertEquals(buttons.length, 2);
    assertEquals(buttons[0].type, "quick_reply");
    assertEquals(buttons[0].id, "a");
    // Acima de 25 chars o WhatsApp rejeita a mensagem inteira.
    assertEquals(buttons[0].text.length, 25);
  } finally {
    f.restore();
  }
});

Deno.test("sendChoice: acima de 3 opções cai para texto numerado com TODAS", async () => {
  const f = okFetch();
  try {
    const r = await adapter().sendChoice(
      "5534984314317",
      "Escolha:",
      {
        preferred: "button",
        options: [
          { id: "a", title: "Um" },
          { id: "b", title: "Dois" },
          { id: "c", title: "Três" },
          { id: "d", title: "Quatro" },
        ],
      },
      ctx,
    );
    assertEquals(f.calls[0].url, `${SERVER}/${KEY}/message/text`);
    const text = f.calls[0].body.text as string;
    assertEquals(text.includes("*4.* Quatro"), true);
    // `downgraded` avisa o caller de que não houve botão real.
    assertEquals(r.ok, false);
    if (!r.ok) assertEquals(r.reason, "downgraded");
  } finally {
    f.restore();
  }
});

Deno.test("sendMedia: documento manda mimetype e fileName", async () => {
  const f = okFetch();
  try {
    await adapter().sendMedia(
      "5534984314317",
      { kind: "document", url: "https://cdn/a.pdf", filename: "conta.pdf", caption: "sua conta" },
      ctx,
    );
    assertEquals(f.calls[0].url, `${SERVER}/${KEY}/message/document`);
    assertEquals(f.calls[0].body.fileName, "conta.pdf");
    assertEquals(f.calls[0].body.mimetype, "application/pdf");
  } finally {
    f.restore();
  }
});

Deno.test("sendText: HTTP 401 vira reason=unauthorized (sem lançar)", async () => {
  const f = stubFetch(() => ({ status: 401, body: "invalid key" }));
  try {
    const r = await adapter().sendText("5534984314317", "Oi", ctx);
    assertEquals(r.ok, false);
    if (!r.ok) assertEquals(r.reason, "unauthorized");
  } finally {
    f.restore();
  }
});

Deno.test("sendText: HTTP 429 vira reason=rate_limited", async () => {
  const f = stubFetch(() => ({ status: 429, body: "slow down" }));
  try {
    const r = await adapter().sendText("5534984314317", "Oi", ctx);
    assertEquals(r.ok, false);
    if (!r.ok) assertEquals(r.reason, "rate_limited");
  } finally {
    f.restore();
  }
});

Deno.test("sendText: destino vazio não chega a chamar a API", async () => {
  const f = okFetch();
  try {
    const r = await adapter().sendText("", "Oi", ctx);
    assertEquals(r.ok, false);
    assertEquals(f.calls.length, 0);
  } finally {
    f.restore();
  }
});

Deno.test("sendPresence nunca lança, mesmo com a API fora", async () => {
  const f = stubFetch(() => ({ status: 500, body: "boom" }));
  try {
    await adapter().sendPresence("5534984314317", "composing", 1000);
  } finally {
    f.restore();
  }
});

// ─── Capabilities ─────────────────────────────────────────────────────────

Deno.test("capabilities do piloto são conservadoras", () => {
  assertEquals(WAME_CAPABILITIES.channel, "wame");
  assertEquals(WAME_CAPABILITIES.maxButtons, 3);
  assertEquals(WAME_CAPABILITIES.supportsList, false);
  assertEquals(WAME_CAPABILITIES.inboundIdField, "messageId");
});
