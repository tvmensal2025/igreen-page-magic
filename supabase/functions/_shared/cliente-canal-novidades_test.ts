import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  DEFAULT_CLIENTE_CANAL_REPLY,
  buildClienteCanalReply,
} from "./cliente-canal-novidades.ts";

Deno.test("buildClienteCanalReply sem nome confiável", () => {
  const t = buildClienteCanalReply({
    name: "Ixi Kkk",
    nameSource: "whatsapp_profile",
  });
  assertStringIncludes(t, "Oi!*");
  assertStringIncludes(t, "canal de novidades");
  assertEquals(t.includes("Ixi"), false);
});

Deno.test("buildClienteCanalReply com nome do portal", () => {
  const t = buildClienteCanalReply({
    name: "Maria Silva",
    nameSource: "igreen_portal",
  });
  assertStringIncludes(t, "Oi, Maria!*");
});

Deno.test("default template tem emojis e estrutura", () => {
  assertStringIncludes(DEFAULT_CLIENTE_CANAL_REPLY, "🌿");
  assertStringIncludes(DEFAULT_CLIENTE_CANAL_REPLY, "estamos juntos");
});
