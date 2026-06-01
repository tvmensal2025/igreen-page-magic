// Property-based test — Portal 2 OCR feedback loop, task 7.3.
//
// **Property 5: Não-repetição do valor rejeitado**
// **Validates: Requirements 9.1, 9.2**
//
// "Um re-despacho só ocorre quando o valor corrigido, normalizado, difere do
//  valor que originou a rejeição daquela classe."
//
// The anti-repetition gate of the correction loop is built on the PURE helper
// `isSameNormalized(kind, newValue, previousValue)` from
// `_shared/portal-correction.ts` (task 7.1). This file validates Property 5 by
// modelling the loop-level decision exactly as design §5.4 prescribes:
//
//   - `duplicate_phone`        → compara com `portal2_celular_alt` corrente
//                                (ou `phone_whatsapp` na 1ª vez).
//   - `duplicate_email`        → compara com `email` corrente.
//   - `duplicate_installation` → compara com `numero_instalacao` corrente.
//
// A comparação é normalizada (telefone/instalação: só dígitos; email:
// trim + lowercase). Quando o valor novo normalizado IGUALA o valor corrente,
// o bot REJEITA + re-pergunta e NÃO re-despacha (Req 9.2); quando DIFERE, o
// loop segue (re-despacho permitido pela guarda de não-repetição, Req 9.1).
//
// Run:
//   deno test supabase/functions/evolution-webhook/handlers/__tests__/no-repeat-value.test.ts

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import fc from "https://esm.sh/fast-check@3.23.2";

import {
  type CorrectionKind,
  isSameNormalized,
  normalizeEmail,
  normalizeForKind,
} from "../../../_shared/portal-correction.ts";

// ─── Loop-level model (design §5.4) ─────────────────────────────────────────
// Faithful, side-effect-free copy of how the bot derives the "current value"
// per Classe_de_Erro before deciding whether to re-dispatch. This is the exact
// mapping documented in design §5.4 and implemented in bot-flow.ts (7.1).

interface CustomerRec {
  phone_whatsapp?: string | null;
  portal2_celular_alt?: string | null;
  email?: string | null;
  numero_instalacao?: string | null;
}

/** Valor corrente (anterior) usado na checagem anti-repetição, por classe. */
function currentValueForKind(
  kind: CorrectionKind,
  c: CustomerRec,
): string | null | undefined {
  switch (kind) {
    case "duplicate_phone":
      // Alternativo tem prioridade; na 1ª vez cai no phone_whatsapp.
      return c.portal2_celular_alt ?? c.phone_whatsapp;
    case "duplicate_email":
      return c.email;
    case "duplicate_installation":
      return c.numero_instalacao;
  }
}

type LoopOutcome = "reask_no_redispatch" | "redispatch";

/**
 * Decisão da guarda de não-repetição (Req 9.1/9.2): re-despacha somente quando
 * o valor novo normalizado difere do valor corrente daquela classe.
 */
function antiRepeatDecision(
  kind: CorrectionKind,
  newValue: string | null | undefined,
  c: CustomerRec,
): LoopOutcome {
  return isSameNormalized(kind, newValue, currentValueForKind(kind, c))
    ? "reask_no_redispatch"
    : "redispatch";
}

// ─── Generators ──────────────────────────────────────────────────────────────

// Non-digit formatting symbols: stripped by normalizePhone/normalizeInstallation
// (which remove everything matching \D), so interleaving them preserves digits.
const phoneSepArb = fc.constantFrom(" ", "-", "(", ")", "+", ".", "/", "  ", "");

/** Interleave digits with arbitrary non-digit separators (same digit sequence). */
function formatDigitsWithSeps(digits: string, seps: string[]): string {
  let out = "";
  for (let i = 0; i < digits.length; i++) {
    out += seps[i % seps.length] ?? "";
    out += digits[i];
  }
  out += seps[digits.length % seps.length] ?? "";
  return out;
}

/** A digit-only string of the given length range. */
function digitsArb(min: number, max: number): fc.Arbitrary<string> {
  return fc
    .array(fc.integer({ min: 0, max: 9 }), { minLength: min, maxLength: max })
    .map((a) => a.join(""));
}

/** { base, equivalent } where `equivalent` formats `base` but normalizes equal. */
function digitsEquivArb(min: number, max: number) {
  return fc
    .record({
      digits: digitsArb(min, max),
      seps: fc.array(phoneSepArb, { minLength: 1, maxLength: 6 }),
    })
    .map(({ digits, seps }) => ({
      base: digits,
      equivalent: formatDigitsWithSeps(digits, seps),
    }));
}

/** Two digit strings whose normalized (digit-only) forms genuinely differ. */
function digitsDifferentArb(min: number, max: number) {
  return fc
    .tuple(digitsArb(min, max), digitsArb(min, max))
    .filter(([a, b]) => a !== b)
    .map(([base, other]) => ({ base, other }));
}

// Email pieces from a lowercase, whitespace/`@`-free alphabet.
const emailCharArb = fc.constantFrom(
  ..."abcdefghijklmnopqrstuvwxyz0123456789._-".split(""),
);
const emailPartArb = fc
  .array(emailCharArb, { minLength: 1, maxLength: 12 })
  .map((a) => a.join(""));
const wsArb = fc.constantFrom("", " ", "  ", "\t", " \t ", "\n ");

function toRandomCase(s: string, mask: boolean[]): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    out += mask[i % mask.length] ? s[i].toUpperCase() : s[i];
  }
  return out;
}

/** { base, equivalent } emails: equivalent = random case + surrounding spaces. */
const emailEquivArb = fc
  .record({
    local: emailPartArb,
    domain: emailPartArb,
    mask: fc.array(fc.boolean(), { minLength: 1, maxLength: 8 }),
    lead: wsArb,
    trail: wsArb,
  })
  .map(({ local, domain, mask, lead, trail }) => {
    const base = `${local}@${domain}`; // already trimmed + lowercase
    const equivalent = `${lead}${toRandomCase(base, mask)}${trail}`;
    return { base, equivalent };
  });

/** Two emails whose normalized (trim+lower) forms genuinely differ. */
const emailDifferentArb = fc
  .tuple(
    fc.record({ local: emailPartArb, domain: emailPartArb }),
    fc.record({ local: emailPartArb, domain: emailPartArb }),
  )
  .map(([a, b]) => ({ base: `${a.local}@${a.domain}`, other: `${b.local}@${b.domain}` }))
  .filter(({ base, other }) => normalizeEmail(base) !== normalizeEmail(other));

// ─── Property 5 — equivalents are rejected (no re-dispatch) ──────────────────

Deno.test("PBT — Property 5: phone — equivalent value (≠ formatting) is rejected, no re-dispatch", () => {
  fc.assert(
    fc.property(digitsEquivArb(10, 13), ({ base, equivalent }) => {
      // Current alt phone holds the previously-rejected number.
      const c: CustomerRec = { portal2_celular_alt: base, phone_whatsapp: "0000000000" };
      assert(isSameNormalized("duplicate_phone", equivalent, base));
      assertEquals(antiRepeatDecision("duplicate_phone", equivalent, c), "reask_no_redispatch");
    }),
    { numRuns: 200 },
  );
});

Deno.test("PBT — Property 5: installation — equivalent value (≠ formatting) is rejected, no re-dispatch", () => {
  fc.assert(
    fc.property(digitsEquivArb(7, 12), ({ base, equivalent }) => {
      const c: CustomerRec = { numero_instalacao: base };
      assert(isSameNormalized("duplicate_installation", equivalent, base));
      assertEquals(
        antiRepeatDecision("duplicate_installation", equivalent, c),
        "reask_no_redispatch",
      );
    }),
    { numRuns: 200 },
  );
});

Deno.test("PBT — Property 5: email — equivalent value (case/space) is rejected, no re-dispatch", () => {
  fc.assert(
    fc.property(emailEquivArb, ({ base, equivalent }) => {
      const c: CustomerRec = { email: base };
      assert(isSameNormalized("duplicate_email", equivalent, base));
      assertEquals(antiRepeatDecision("duplicate_email", equivalent, c), "reask_no_redispatch");
    }),
    { numRuns: 200 },
  );
});

// ─── Property 5 — genuinely different values proceed (re-dispatch allowed) ────

Deno.test("PBT — Property 5: phone — genuinely different value proceeds (re-dispatch)", () => {
  fc.assert(
    fc.property(digitsDifferentArb(10, 13), ({ base, other }) => {
      const c: CustomerRec = { portal2_celular_alt: base, phone_whatsapp: "0000000000" };
      assertEquals(isSameNormalized("duplicate_phone", other, base), false);
      assertEquals(antiRepeatDecision("duplicate_phone", other, c), "redispatch");
    }),
    { numRuns: 200 },
  );
});

Deno.test("PBT — Property 5: installation — genuinely different value proceeds (re-dispatch)", () => {
  fc.assert(
    fc.property(digitsDifferentArb(7, 12), ({ base, other }) => {
      const c: CustomerRec = { numero_instalacao: base };
      assertEquals(isSameNormalized("duplicate_installation", other, base), false);
      assertEquals(antiRepeatDecision("duplicate_installation", other, c), "redispatch");
    }),
    { numRuns: 200 },
  );
});

Deno.test("PBT — Property 5: email — genuinely different value proceeds (re-dispatch)", () => {
  fc.assert(
    fc.property(emailDifferentArb, ({ base, other }) => {
      const c: CustomerRec = { email: base };
      assertEquals(isSameNormalized("duplicate_email", other, base), false);
      assertEquals(antiRepeatDecision("duplicate_email", other, c), "redispatch");
    }),
    { numRuns: 200 },
  );
});

// ─── Property 5 — design §5.4 comparison-source semantics ─────────────────────
// `duplicate_phone` compares against the CURRENT alt phone when present, and
// only falls back to phone_whatsapp on the first attempt (alt empty).

Deno.test("PBT — Property 5: phone — when alt is set, comparison uses alt (not phone_whatsapp)", () => {
  fc.assert(
    fc.property(
      digitsEquivArb(10, 13),
      digitsArb(10, 13),
      ({ base, equivalent }, whats) => {
        // alt holds the rejected value; phone_whatsapp differs. Re-sending the
        // (equivalent) alt must be rejected REGARDLESS of phone_whatsapp.
        fc.pre(whats.replace(/\D/g, "") !== base.replace(/\D/g, ""));
        const c: CustomerRec = { portal2_celular_alt: base, phone_whatsapp: whats };
        assertEquals(antiRepeatDecision("duplicate_phone", equivalent, c), "reask_no_redispatch");
      },
    ),
    { numRuns: 200 },
  );
});

Deno.test("PBT — Property 5: phone — first attempt (no alt) compares against phone_whatsapp", () => {
  fc.assert(
    fc.property(digitsEquivArb(10, 13), ({ base, equivalent }) => {
      // No alt yet → the "previous" value is phone_whatsapp; re-sending the
      // same number (formatted) must be rejected (cannot reuse the WhatsApp #).
      const c: CustomerRec = { portal2_celular_alt: null, phone_whatsapp: base };
      assertEquals(antiRepeatDecision("duplicate_phone", equivalent, c), "reask_no_redispatch");
    }),
    { numRuns: 200 },
  );
});

// ─── Property 5 — boundary: empty new value never matches a previous value ────
// `isSameNormalized` treats empty as "no previous to compare"; the anti-repeat
// gate therefore does not classify it as a repeat (format validation, a
// separate property, is what rejects empties).

Deno.test("Property 5 (boundary): empty/blank new value is not treated as a repeat", () => {
  const phoneCust: CustomerRec = { portal2_celular_alt: "11999998888" };
  assertEquals(isSameNormalized("duplicate_phone", "", "11999998888"), false);
  assertEquals(isSameNormalized("duplicate_phone", "   ", "11999998888"), false);
  assertEquals(antiRepeatDecision("duplicate_phone", "", phoneCust), "redispatch");

  const emailCust: CustomerRec = { email: "a@b.com" };
  assertEquals(isSameNormalized("duplicate_email", "  ", "a@b.com"), false);
  assertEquals(antiRepeatDecision("duplicate_email", "", emailCust), "redispatch");
});

// ─── Property 5 — concrete anchors (regression examples) ──────────────────────

Deno.test("Property 5 (examples): formatting-equivalent rejected, real change proceeds", () => {
  // phone: same number, different formatting → reject.
  assertEquals(
    antiRepeatDecision("duplicate_phone", "(11) 99999-8888", {
      portal2_celular_alt: "11999998888",
    }),
    "reask_no_redispatch",
  );
  // phone: a genuinely different number → proceed.
  assertEquals(
    antiRepeatDecision("duplicate_phone", "11988887777", {
      portal2_celular_alt: "11999998888",
    }),
    "redispatch",
  );
  // email: case/space variant → reject; different mailbox → proceed.
  assertEquals(
    antiRepeatDecision("duplicate_email", " Fulano@Gmail.COM ", { email: "fulano@gmail.com" }),
    "reask_no_redispatch",
  );
  assertEquals(
    antiRepeatDecision("duplicate_email", "outro@gmail.com", { email: "fulano@gmail.com" }),
    "redispatch",
  );
  // installation: spaces/dashes variant → reject; different number → proceed.
  assertEquals(
    antiRepeatDecision("duplicate_installation", "12 34-567", { numero_instalacao: "1234567" }),
    "reask_no_redispatch",
  );
  assertEquals(
    antiRepeatDecision("duplicate_installation", "7654321", { numero_instalacao: "1234567" }),
    "redispatch",
  );

  // Sanity: normalizeForKind agrees with the gate's notion of equality.
  assertEquals(normalizeForKind("duplicate_phone", "(11) 9-9999-8888"), "11999998888");
});
