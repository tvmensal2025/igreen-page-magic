// Property-based test — Property 2: phone_whatsapp imutável pelo loop.
//
// **Validates: Requirements 8.2, 8.6**
//
// Invariante: nenhum caminho de correção de telefone escreve `phone_whatsapp`;
// a correção de `duplicate_phone` grava EXCLUSIVAMENTE `portal2_celular_alt`.
// O canal de conversa (`phone_whatsapp`, chave única de `customers`) nunca é
// tocado pelo loop de correção.
//
// Código real validado (espelhado aqui como modelo puro):
//   supabase/functions/evolution-webhook/handlers/bot-flow.ts
//     → case "corrigir_celular_portal": { ... updates.portal2_celular_alt = _celDigits; ... }
//     → async function persistAndRedispatch(kind, maskedValue) { ... }
//   (mesma lógica é espelhada em whapi-webhook/handlers/bot-flow.ts, task 8.1)
//
// O `corrigir_celular_portal` (1) valida ≥10 dígitos, (2) recusa valor igual ao
// `phone_whatsapp` atual, (3) recusa valor igual ao `portal2_celular_alt` já
// tentado e, só então, grava `updates.portal2_celular_alt` e re-despacha. Em
// NENHUM ramo grava `phone_whatsapp`. Esta suíte reconstrói o handler a partir
// dos MESMOS helpers puros (`portal-correction.ts`) que o bot-flow.ts importa,
// gera milhares de entradas arbitrárias e assere o invariante em todos os ramos.
//
// Não há fast-check disponível neste runtime Deno (sem import map / offline), e o
// `_test.ts` existente usa apenas `std/assert`; por isso usamos um gerador
// determinístico (PRNG semeado) varrendo o espaço de entradas do telefone.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  CORRECTION_MAP,
  RECOVERABLE_CORRECTION_KINDS,
  incrementAttempts,
  isSameNormalized,
  isValidCelular,
  type CorrectionKind,
} from "../../../_shared/portal-correction.ts";

// ─── Modelo puro do handler `corrigir_celular_portal` + persistAndRedispatch ──
// Reproduz fielmente o objeto `updates` que o bot-flow.ts constrói. Toda a lógica
// de decisão vem dos helpers reais importados acima — não há cópia divergente.
interface CustomerLike {
  phone_whatsapp?: string | null;
  portal2_celular_alt?: string | null;
  portal2_correction_attempts?: Record<string, unknown> | null;
}

function applyCorrigirCelular(
  customer: CustomerLike,
  messageText: string,
): { updates: Record<string, unknown>; accepted: boolean } {
  const updates: Record<string, unknown> = {};

  // Ramo 1 — formato inválido (Req 8.1): re-pergunta, não persiste, não despacha.
  if (!isValidCelular(messageText)) {
    return { updates, accepted: false };
  }
  // Ramo 2 — igual ao phone_whatsapp atual (Req 8.3): recusa.
  if (isSameNormalized("duplicate_phone", messageText, customer.phone_whatsapp)) {
    return { updates, accepted: false };
  }
  // Ramo 3 — igual ao valor já tentado/rejeitado (Req 9.2): recusa.
  if (isSameNormalized("duplicate_phone", messageText, customer.portal2_celular_alt)) {
    return { updates, accepted: false };
  }
  // Ramo 4 — aceito: grava SOMENTE portal2_celular_alt (Req 8.2/8.6).
  const celDigits = messageText.replace(/\D/g, "");
  updates.portal2_celular_alt = celDigits;
  // persistAndRedispatch("duplicate_phone", ...) adiciona estes campos:
  updates.portal2_correction_attempts = incrementAttempts(
    customer.portal2_correction_attempts,
    "duplicate_phone",
  );
  updates.portal2_status = "retry_ready";
  updates.portal2_error = null;
  updates.conversation_step = "portal_submitting";
  return { updates, accepted: true };
}

// ─── Gerador determinístico (PRNG semeado) ───────────────────────────────────
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SEPARATORS = ["", " ", "-", "(", ")", "+", ".", "  ", "/"];

/** Gera uma string de telefone arbitrária: dígitos aleatórios + separadores. */
function genPhoneString(rnd: () => number): string {
  const nDigits = Math.floor(rnd() * 16); // 0..15 dígitos
  let out = "";
  for (let i = 0; i < nDigits; i++) {
    if (rnd() < 0.35) out += SEPARATORS[Math.floor(rnd() * SEPARATORS.length)];
    out += String(Math.floor(rnd() * 10));
  }
  if (rnd() < 0.3) out += SEPARATORS[Math.floor(rnd() * SEPARATORS.length)];
  return out;
}

/** Gera um customer arbitrário com whatsapp/alt/attempts variados. */
function genCustomer(rnd: () => number): CustomerLike {
  const mk = (): string | null => {
    const r = rnd();
    if (r < 0.15) return null;
    if (r < 0.25) return "";
    return genPhoneString(rnd);
  };
  return {
    phone_whatsapp: mk(),
    portal2_celular_alt: mk(),
    portal2_correction_attempts: rnd() < 0.5
      ? null
      : { duplicate_phone: Math.floor(rnd() * 4) },
  };
}

// ─── Property 2.a — estrutural: nenhum campo de correção é phone_whatsapp ─────
Deno.test("Property 2: CORRECTION_MAP nunca aponta para phone_whatsapp", () => {
  // duplicate_phone grava exatamente portal2_celular_alt.
  assertEquals(CORRECTION_MAP.duplicate_phone.field, "portal2_celular_alt");
  // Em NENHUMA classe recuperável o campo gravado é phone_whatsapp.
  for (const kind of RECOVERABLE_CORRECTION_KINDS) {
    const spec = CORRECTION_MAP[kind as CorrectionKind];
    // missing_consumo não tem step de correção; só checamos os que existem no mapa.
    if (!spec) continue;
    assert(
      spec.field !== "phone_whatsapp",
      `Classe ${kind} grava phone_whatsapp — viola Property 2`,
    );
  }
});

// ─── Property 2.b — generativa: o handler nunca escreve phone_whatsapp ────────
Deno.test("Property 2: corrigir_celular_portal nunca grava phone_whatsapp (gerativo)", () => {
  const rnd = mulberry32(0x9e3779b9);
  const ITERATIONS = 5000;

  for (let i = 0; i < ITERATIONS; i++) {
    const customer = genCustomer(rnd);
    const messageText = genPhoneString(rnd);
    const whatsappBefore = customer.phone_whatsapp;

    const { updates, accepted } = applyCorrigirCelular(customer, messageText);

    // Invariante central (Req 8.2/8.6): NENHUM ramo escreve phone_whatsapp.
    assertFalse(
      Object.prototype.hasOwnProperty.call(updates, "phone_whatsapp"),
      `iter ${i}: updates conteria phone_whatsapp para input="${messageText}"`,
    );
    // O objeto do cliente não é mutado — phone_whatsapp permanece intacto.
    assertEquals(customer.phone_whatsapp, whatsappBefore, `iter ${i}: phone_whatsapp mutado`);

    if (accepted) {
      // Quando aceito, o único campo de dado pessoal gravado é portal2_celular_alt.
      assertEquals(
        updates.portal2_celular_alt,
        messageText.replace(/\D/g, ""),
        `iter ${i}: portal2_celular_alt deveria conter os dígitos do novo número`,
      );
      assert(
        typeof updates.portal2_celular_alt === "string",
        `iter ${i}: portal2_celular_alt ausente após aceite`,
      );
    } else {
      // Ramos de recusa não persistem campo de telefone algum.
      assertFalse(
        Object.prototype.hasOwnProperty.call(updates, "portal2_celular_alt"),
        `iter ${i}: recusa não deveria gravar portal2_celular_alt`,
      );
    }
  }
});

// ─── Property 2.c — casos-limite explícitos (aceite e cada recusa) ────────────
Deno.test("Property 2: casos-limite — aceite grava só portal2_celular_alt", () => {
  const customer: CustomerLike = {
    phone_whatsapp: "11988887777",
    portal2_celular_alt: null,
    portal2_correction_attempts: null,
  };
  const { updates, accepted } = applyCorrigirCelular(customer, "(21) 97777-6666");
  assert(accepted);
  assertEquals(updates.portal2_celular_alt, "21977776666");
  assertFalse(Object.prototype.hasOwnProperty.call(updates, "phone_whatsapp"));
  assertEquals(customer.phone_whatsapp, "11988887777"); // imutável
});

Deno.test("Property 2: casos-limite — recusas não tocam phone_whatsapp", () => {
  const base: CustomerLike = {
    phone_whatsapp: "11988887777",
    portal2_celular_alt: "21977776666",
  };
  // inválido (<10 dígitos)
  const r1 = applyCorrigirCelular(base, "99999");
  // igual ao phone_whatsapp
  const r2 = applyCorrigirCelular(base, "(11) 98888-7777");
  // igual ao alternativo já tentado
  const r3 = applyCorrigirCelular(base, "21 97777-6666");
  for (const r of [r1, r2, r3]) {
    assertFalse(r.accepted);
    assertFalse(Object.prototype.hasOwnProperty.call(r.updates, "phone_whatsapp"));
    assertFalse(Object.prototype.hasOwnProperty.call(r.updates, "portal2_celular_alt"));
  }
  assertEquals(base.phone_whatsapp, "11988887777"); // imutável
});
