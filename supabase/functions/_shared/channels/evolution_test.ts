// Testes unitários do adapter Evolution.
// Cobre `parseInbound` para texto, botão, mídia, grupo (ignorado) e self.
// Não testamos `send*` aqui porque dependem de HTTP — adapter é fino, o
// comportamento de send é coberto pelos testes do `evolution-api.ts`.

import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createEvolutionAdapter } from "./evolution.ts";

const ADAPTER = createEvolutionAdapter({
  apiUrl: "https://example.com",
  apiKey: "fake",
  instanceName: "test-instance",
});

Deno.test("evolution adapter: capabilities estáticas estão corretas", () => {
  const c = ADAPTER.capabilities;
  assertEquals(c.channel, "evolution");
  assertEquals(c.supportsButtons, false);
  assertEquals(c.maxButtons, 0);
  assertEquals(c.supportsList, true);
  assertEquals(c.supportsAudio, true);
  assertEquals(c.supportsVideo, true);
  assertEquals(c.supportsTypingPresence, true);
  assertEquals(c.supportsReactions, false);
  assertEquals(c.inboundIdField, "wa_id");
});

Deno.test("evolution parseInbound: texto puro", () => {
  const raw = {
    instance: "test-instance",
    data: {
      key: { remoteJid: "5511999999999@s.whatsapp.net", fromMe: false, id: "MID-001" },
      message: { conversation: "olá tudo bem" },
    },
  };
  const r = ADAPTER.parseInbound(raw, "test-instance");
  assertEquals(r?.channel, "evolution");
  assertEquals(r?.messageText, "olá tudo bem");
  assertEquals(r?.buttonId, null);
  assertEquals(r?.hasMedia, false);
  assertEquals(r?.rawNumberReply, null);
  assertEquals(r?.messageId, "MID-001");
});

Deno.test("evolution parseInbound: botão clicado retorna buttonId puro", () => {
  const raw = {
    instance: "test-instance",
    data: {
      key: { remoteJid: "5511999999999@s.whatsapp.net", fromMe: false, id: "MID-002" },
      message: {
        buttonsResponseMessage: { selectedButtonId: "sim_phone", selectedDisplayText: "Sim" },
      },
    },
  };
  const r = ADAPTER.parseInbound(raw, "test-instance");
  assertEquals(r?.buttonId, "sim_phone");
});

Deno.test("evolution parseInbound: imagem", () => {
  const raw = {
    instance: "test-instance",
    data: {
      key: { remoteJid: "5511999999999@s.whatsapp.net", fromMe: false, id: "MID-003" },
      message: { imageMessage: { mimetype: "image/jpeg", url: "https://x" } },
    },
  };
  const r = ADAPTER.parseInbound(raw, "test-instance");
  assertEquals(r?.hasMedia, true);
  assertEquals(r?.mediaKind, "image");
});

Deno.test("evolution parseInbound: áudio inclui em hasMedia", () => {
  const raw = {
    instance: "test-instance",
    data: {
      key: { remoteJid: "5511999999999@s.whatsapp.net", fromMe: false, id: "MID-004" },
      message: { audioMessage: { mimetype: "audio/ogg", url: "https://x" } },
    },
  };
  const r = ADAPTER.parseInbound(raw, "test-instance");
  assertEquals(r?.hasMedia, true);
  assertEquals(r?.mediaKind, "audio");
});

Deno.test("evolution parseInbound: grupo é ignorado (retorna null)", () => {
  const raw = {
    instance: "test-instance",
    data: {
      key: { remoteJid: "120363@g.us", fromMe: false, id: "MID-005" },
      message: { conversation: "msg de grupo" },
    },
  };
  assertEquals(ADAPTER.parseInbound(raw, "test-instance"), null);
});

Deno.test("evolution parseInbound: fromMe é ignorado", () => {
  const raw = {
    instance: "test-instance",
    data: {
      key: { remoteJid: "5511999999999@s.whatsapp.net", fromMe: true, id: "MID-006" },
      message: { conversation: "eu mesmo" },
    },
  };
  assertEquals(ADAPTER.parseInbound(raw, "test-instance"), null);
});

Deno.test("evolution parseInbound: '1' digitado vira rawNumberReply", () => {
  const raw = {
    instance: "test-instance",
    data: {
      key: { remoteJid: "5511999999999@s.whatsapp.net", fromMe: false, id: "MID-007" },
      message: { conversation: "1" },
    },
  };
  const r = ADAPTER.parseInbound(raw, "test-instance");
  assertEquals(r?.rawNumberReply, "1");
});

Deno.test("evolution parseInbound: '2.' vira rawNumberReply", () => {
  const raw = {
    instance: "test-instance",
    data: {
      key: { remoteJid: "5511999999999@s.whatsapp.net", fromMe: false, id: "MID-008" },
      message: { conversation: "2." },
    },
  };
  const r = ADAPTER.parseInbound(raw, "test-instance");
  assertEquals(r?.rawNumberReply, "2.");
});

Deno.test("evolution parseInbound: '1 minuto' NÃO vira rawNumberReply", () => {
  const raw = {
    instance: "test-instance",
    data: {
      key: { remoteJid: "5511999999999@s.whatsapp.net", fromMe: false, id: "MID-009" },
      message: { conversation: "1 minuto" },
    },
  };
  const r = ADAPTER.parseInbound(raw, "test-instance");
  assertEquals(r?.rawNumberReply, null);
});

Deno.test("evolution parseInbound: vídeo inclui hasMedia", () => {
  const raw = {
    instance: "test-instance",
    data: {
      key: { remoteJid: "5511999999999@s.whatsapp.net", fromMe: false, id: "MID-VID" },
      message: { videoMessage: { mimetype: "video/mp4", url: "https://x" } },
    },
  };
  const r = ADAPTER.parseInbound(raw, "test-instance");
  assertEquals(r?.hasMedia, true);
  assertEquals(r?.mediaKind, "video");
});
