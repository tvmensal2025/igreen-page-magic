// Unit tests for the pure Portal 2 correction-loop helpers.
// These exercise validation, normalized anti-repetition, attempt counting and
// the central correction decision/guard. The property tests for the bot
// (tasks 7.2–7.5) build on these same exported helpers.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  CORRECTION_LIMIT,
  CORRECTION_MAP,
  attemptsForKind,
  correctionLimitReached,
  decideCorrection,
  incrementAttempts,
  isSameNormalized,
  isValidCelular,
  isValidCorrectionEmail,
  isValidInstallation,
  maskCorrectionValueForLog,
  normalizeEmail,
  normalizeInstallation,
  normalizePhone,
} from "./portal-correction.ts";

// ── Normalization (Req 9.1) ──
Deno.test("normalizePhone strips non-digits", () => {
  assertEquals(normalizePhone("(11) 99999-8888"), "11999998888");
  assertEquals(normalizePhone(null), "");
});
Deno.test("normalizeInstallation strips non-digits", () => {
  assertEquals(normalizeInstallation("INST 123-4567"), "1234567");
});
Deno.test("normalizeEmail trims and lowercases", () => {
  assertEquals(normalizeEmail("  Foo@Bar.COM "), "foo@bar.com");
});

// ── Format validation (Req 7.2, 7.7, 8.1) ──
Deno.test("isValidCelular requires >= 10 digits", () => {
  assertEquals(isValidCelular("1199998888"), true);
  assertEquals(isValidCelular("999998888"), false);
  assertEquals(isValidCelular("(11) 99999-8888"), true);
});
Deno.test("isValidCorrectionEmail requires 1+ char before/after @", () => {
  assertEquals(isValidCorrectionEmail("a@b"), true);
  assertEquals(isValidCorrectionEmail("@b"), false);
  assertEquals(isValidCorrectionEmail("a@"), false);
  assertEquals(isValidCorrectionEmail("ab"), false);
});
Deno.test("isValidInstallation requires >= 7 digits", () => {
  assertEquals(isValidInstallation("1234567"), true);
  assertEquals(isValidInstallation("12345"), false);
});

// ── Anti-repetition (Req 9.2) ──
Deno.test("isSameNormalized phone ignores formatting", () => {
  assertEquals(isSameNormalized("duplicate_phone", "11999998888", "(11) 99999-8888"), true);
  assertEquals(isSameNormalized("duplicate_phone", "11999990000", "11999998888"), false);
});
Deno.test("isSameNormalized email is case/space-insensitive", () => {
  assertEquals(isSameNormalized("duplicate_email", " A@B.com ", "a@b.com"), true);
});
Deno.test("isSameNormalized empty new value never equals", () => {
  assertEquals(isSameNormalized("duplicate_phone", "", ""), false);
  assertEquals(isSameNormalized("duplicate_phone", null, "11999998888"), false);
});

// ── Attempt counting (Req 9.3/9.4/9.6) ──
Deno.test("attemptsForKind tolerates missing/dirty maps", () => {
  assertEquals(attemptsForKind(null, "duplicate_phone"), 0);
  assertEquals(attemptsForKind({ duplicate_phone: 2 }, "duplicate_phone"), 2);
  assertEquals(attemptsForKind({ duplicate_phone: "x" }, "duplicate_phone"), 0);
});
Deno.test("incrementAttempts is immutable and bumps one class", () => {
  const before = { duplicate_phone: 1, duplicate_email: 2 };
  const after = incrementAttempts(before, "duplicate_phone");
  assertEquals(after, { duplicate_phone: 2, duplicate_email: 2 });
  assertEquals(before.duplicate_phone, 1); // not mutated
});
Deno.test("correctionLimitReached at limit", () => {
  assertEquals(CORRECTION_LIMIT, 3);
  assertEquals(correctionLimitReached({ duplicate_phone: 2 }, "duplicate_phone"), false);
  assertEquals(correctionLimitReached({ duplicate_phone: 3 }, "duplicate_phone"), true);
});

// ── Decision/guard (Req 9.5, 10.1/10.4) ──
Deno.test("decideCorrection opens recoverable below limit", () => {
  const d = decideCorrection("duplicate_phone", { duplicate_phone: 1 });
  assertEquals(d.action, "open");
  if (d.action === "open") {
    assertEquals(d.kind, "duplicate_phone");
    assertEquals(d.spec, CORRECTION_MAP.duplicate_phone);
  }
});
Deno.test("decideCorrection limit reached → needs_human", () => {
  const d = decideCorrection("duplicate_email", { duplicate_email: 3 });
  assertEquals(d.action, "needs_human");
  if (d.action === "needs_human") assertEquals(d.reason, "limit_reached");
});
Deno.test("decideCorrection non-recoverable → needs_human (never opens)", () => {
  for (const kind of ["duplicate_document", "no_coverage", "unknown"]) {
    const d = decideCorrection(kind, {});
    assertEquals(d.action, "needs_human");
    if (d.action === "needs_human") assertEquals(d.reason, "non_recoverable");
  }
});
Deno.test("decideCorrection missing_consumo and empty → none", () => {
  assertEquals(decideCorrection("missing_consumo", {}).action, "none");
  assertEquals(decideCorrection(null, {}).action, "none");
  assertEquals(decideCorrection("", {}).action, "none");
});

// ── PII masking for logs (Req 12.4) ──
Deno.test("maskCorrectionValueForLog masks phone/email", () => {
  assertEquals(maskCorrectionValueForLog("duplicate_phone", "11999998888"), "***8888");
  assertEquals(maskCorrectionValueForLog("duplicate_email", "fulano@gmail.com"), "f***@gmail.com");
});
