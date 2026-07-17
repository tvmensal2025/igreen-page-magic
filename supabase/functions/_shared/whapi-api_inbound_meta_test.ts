import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { resolveInboundConversationMeta } from "./whapi-api.ts";

Deno.test("resolveInboundConversationMeta: image + mediaId Whapi", () => {
  const meta = resolveInboundConversationMeta({
    hasImage: true,
    messageText: "",
    mediaId: "abc123media",
  });
  assertEquals(meta.message_type, "image");
  assertEquals(meta.message_text, "[imagem]");
  assertEquals(meta.media_id, "abc123media");
});

Deno.test("resolveInboundConversationMeta: document preserva caption", () => {
  const meta = resolveInboundConversationMeta({
    hasDocument: true,
    messageText: "conta de luz",
    mediaId: "doc-1",
  });
  assertEquals(meta.message_type, "document");
  assertEquals(meta.message_text, "conta de luz");
  assertEquals(meta.media_id, "doc-1");
});

Deno.test("resolveInboundConversationMeta: Evolution sem mediaId (null)", () => {
  const meta = resolveInboundConversationMeta({
    hasImage: true,
    hasVideo: false,
    mediaId: null,
  });
  assertEquals(meta.message_type, "image");
  assertEquals(meta.media_id, null);
});

Deno.test("resolveInboundConversationMeta: vídeo tem precedência sobre imagem", () => {
  const meta = resolveInboundConversationMeta({
    hasVideo: true,
    hasImage: true,
    mediaId: "vid-9",
  });
  assertEquals(meta.message_type, "video");
  assertEquals(meta.message_text, "[vídeo]");
});

Deno.test("resolveInboundConversationMeta: texto puro", () => {
  const meta = resolveInboundConversationMeta({
    messageText: "oi",
  });
  assertEquals(meta.message_type, "text");
  assertEquals(meta.message_text, "oi");
  assertEquals(meta.media_id, null);
});
