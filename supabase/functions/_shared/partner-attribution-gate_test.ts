// Testes do gate de atribuição de parceiro (keyword / `#R{short_code}`).
//
// Cada caso aqui corresponde a uma forma real de o parceiro perder o lead.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  evaluatePartnerKeywordGate,
  orderPartnersByScope,
  pickPartnerByScope,
  resolvePartnerScopeConsultantIds,
} from "./partner-attribution-gate.ts";
import { buildDefaultQrPhrase } from "./qr-phrase.ts";

// ─── evaluatePartnerKeywordGate ──────────────────────────────────────────────

Deno.test("gate: frase do QR do parceiro NÃO bloqueia (regressão José)", () => {
  // A frase antiga casava âncora CTWA e bloqueava. Mesmo que uma frase
  // custom do parceiro volte a casar, sinal fraco não pode vetar.
  const g = evaluatePartnerKeywordGate({
    messageText: "Oi! Vim pelo jose e quero saber mais sobre o desconto na energia.",
  });
  assertEquals(g.blocked, false);
  assertEquals(g.strongMetaSignal, false);
  assertEquals(g.weakCtwaPhraseOnly, true);
  assertEquals(g.reason, "allowed_weak_ctwa_phrase_only");
});

Deno.test("gate: frase padrão nova não é nem sinal fraco", () => {
  const g = evaluatePartnerKeywordGate({ messageText: buildDefaultQrPhrase("jose") });
  assertEquals(g.blocked, false);
  assertEquals(g.weakCtwaPhraseOnly, false);
  assertEquals(g.reason, "allowed");
});

Deno.test("gate: sinal FORTE do Meta continua bloqueando", () => {
  const fortes: Array<Record<string, unknown>> = [
    { sourceCampaignId: "11111111-1111-1111-1111-111111111111" },
    { sourceAdId: "120210000000000" },
    { sourceCtwaClid: "ARaBcD" },
    { ctwaClid: "ARaBcD" },
    { leadSource: "meta_ads" },
    { leadSource: { source: "META_ADS" } },
  ];
  for (const f of fortes) {
    const g = evaluatePartnerKeywordGate({ ...f, messageText: "vim pelo jose" });
    assertEquals(g.blocked, true, JSON.stringify(f));
    assertEquals(g.strongMetaSignal, true, JSON.stringify(f));
    assertEquals(g.reason, "strong_meta_signal");
  }
});

Deno.test("gate: campo forte vazio/whitespace não conta como sinal", () => {
  const g = evaluatePartnerKeywordGate({
    sourceCampaignId: "",
    sourceAdId: "   ",
    ctwaClid: null,
    leadSource: null,
    messageText: "vim pelo jose",
  });
  assertEquals(g.blocked, false);
  assertEquals(g.reason, "allowed");
});

Deno.test("gate: lead_source sem 'meta' não bloqueia", () => {
  const g = evaluatePartnerKeywordGate({
    leadSource: { source: "qr_code" },
    messageText: "vim pelo jose",
  });
  assertEquals(g.blocked, false);
});

Deno.test("gate: mensagem vazia não explode", () => {
  const g = evaluatePartnerKeywordGate({ messageText: null });
  assertEquals(g.blocked, false);
  assertEquals(g.weakCtwaPhraseOnly, false);
});

// ─── resolvePartnerScopeConsultantIds ────────────────────────────────────────

const OWNER = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const SUPER = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

Deno.test("escopo: dono do lead vem antes do hub superadmin", () => {
  assertEquals(resolvePartnerScopeConsultantIds(OWNER, SUPER), [OWNER, SUPER]);
});

Deno.test("escopo: mesmo id não duplica", () => {
  assertEquals(resolvePartnerScopeConsultantIds(SUPER, SUPER), [SUPER]);
});

Deno.test("escopo: sem dono cai só no superadmin", () => {
  assertEquals(resolvePartnerScopeConsultantIds(null, SUPER), [SUPER]);
  assertEquals(resolvePartnerScopeConsultantIds("  ", SUPER), [SUPER]);
});

Deno.test("escopo: sem nada devolve lista vazia", () => {
  assertEquals(resolvePartnerScopeConsultantIds(null, null), []);
});

// ─── orderPartnersByScope / pickPartnerByScope ───────────────────────────────

Deno.test("ordem: parceiro do dono ganha do parceiro do hub", () => {
  const rows = [
    { id: "p-super", consultant_id: SUPER },
    { id: "p-owner", consultant_id: OWNER },
  ];
  const ordered = orderPartnersByScope(rows, [OWNER, SUPER]);
  assertEquals(ordered.map((r) => r.id), ["p-owner", "p-super"]);
  assertEquals(pickPartnerByScope(rows, [OWNER, SUPER])?.id, "p-owner");
});

Deno.test("ordem: parceiro de outro tenant é descartado", () => {
  const rows = [
    { id: "p-outro", consultant_id: "cccccccc-cccc-cccc-cccc-cccccccccccc" },
    { id: "p-owner", consultant_id: OWNER },
  ];
  const ordered = orderPartnersByScope(rows, [OWNER, SUPER]);
  assertEquals(ordered.map((r) => r.id), ["p-owner"]);
});

Deno.test("ordem: lista vazia/nula não quebra", () => {
  assertEquals(orderPartnersByScope(null, [OWNER]), []);
  assertEquals(orderPartnersByScope([], [OWNER]), []);
  assertEquals(pickPartnerByScope([], [OWNER]), null);
});
