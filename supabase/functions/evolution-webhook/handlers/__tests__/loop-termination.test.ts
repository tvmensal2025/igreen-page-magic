// Property-based test — Portal 2 correction loop TERMINATION.
//
// Feature: portal2-ocr-feedback-loop, Property 6 (Terminação do loop)
// **Validates: Requirements 9.5, 9.6, 10.2**
//
// Property 6 states: for each recoverable Classe_de_Erro
// (duplicate_phone / duplicate_email / duplicate_installation) there are AT
// MOST `CORRECTION_LIMIT` (= 3) re-dispatches; once the limit is reached the
// cadastro goes to `needs_human` and the bot stops asking for corrections.
//
// We exercise the PURE loop helpers from `_shared/portal-correction.ts`
// (`decideCorrection` + `incrementAttempts`), which are the deterministic
// core that the bot-flow handler (evolution + whapi) drives. Simulating the
// loop over those helpers is exactly how the real handler advances:
//   decide → if "open", correct + incrementAttempts + re-dispatch → decide …
//
// Runner: `deno test` (matches the repo's edge-function test convention).

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import fc from "https://esm.sh/fast-check@3.23.2";

import {
  CORRECTION_LIMIT,
  type CorrectionDecision,
  type CorrectionKind,
  decideCorrection,
  incrementAttempts,
} from "../../../_shared/portal-correction.ts";

// The recoverable classes that own a `corrigir_*` step (design §5.1). These are
// exactly the kinds for which `decideCorrection` can return `{action:"open"}`.
const RECOVERABLE_KINDS: readonly CorrectionKind[] = [
  "duplicate_phone",
  "duplicate_email",
  "duplicate_installation",
];

/**
 * Faithfully simulate the correction loop for a single Classe_de_Erro, exactly
 * as the bot drives it: on each iteration consult `decideCorrection`; while it
 * says `open`, that is one re-dispatch opportunity, so we increment the per-class
 * attempt counter (what `persistAndRedispatch` does) and continue; on any other
 * decision we stop. Returns how many "open" decisions (= re-dispatches) happened,
 * the terminating decision, and the resulting attempts map.
 */
function simulateLoop(
  kind: CorrectionKind,
  startAttempts: number,
  maxIterations: number,
): { opens: number; finalDecision: CorrectionDecision; attempts: Record<string, unknown> } {
  let attempts: Record<string, unknown> = { [kind]: startAttempts };
  let opens = 0;
  let decision: CorrectionDecision = decideCorrection(kind, attempts);

  for (let i = 0; i < maxIterations; i++) {
    decision = decideCorrection(kind, attempts);
    if (decision.action !== "open") break;
    opens++;
    attempts = incrementAttempts(attempts, kind); // successful correction → +1
  }

  return { opens, finalDecision: decision, attempts };
}

// ───────────────────────────────────────────────────────────────────────────
// Concrete walk-through (oracle for the property): starting from 0 attempts a
// recoverable class yields EXACTLY 3 "open" decisions, then `needs_human`.
// ───────────────────────────────────────────────────────────────────────────
Deno.test("Property 6 (example): full loop from 0 → exactly 3 opens then needs_human", () => {
  for (const kind of RECOVERABLE_KINDS) {
    // attempts 0,1,2 → open ; attempt 3 → needs_human(limit_reached)
    assertEquals(decideCorrection(kind, { [kind]: 0 }).action, "open");
    assertEquals(decideCorrection(kind, { [kind]: 1 }).action, "open");
    assertEquals(decideCorrection(kind, { [kind]: 2 }).action, "open");

    const atLimit = decideCorrection(kind, { [kind]: 3 });
    assertEquals(atLimit.action, "needs_human");
    if (atLimit.action === "needs_human") assertEquals(atLimit.reason, "limit_reached");

    // Simulating the whole loop with plenty of iterations stops at the limit.
    const { opens, finalDecision } = simulateLoop(kind, 0, 50);
    assertEquals(opens, CORRECTION_LIMIT); // at most (and here exactly) 3 re-dispatches
    assertEquals(finalDecision.action, "needs_human");
    if (finalDecision.action === "needs_human") {
      assertEquals(finalDecision.reason, "limit_reached");
    }
  }
});

// ───────────────────────────────────────────────────────────────────────────
// Property 6a — Bounded re-dispatches + termination (Req 9.5, 9.6, 10.2).
// For an arbitrary recoverable kind and an arbitrary number of loop iterations,
// the number of "open" decisions (re-dispatches) NEVER exceeds CORRECTION_LIMIT,
// and once enough iterations elapse the loop terminates in needs_human and stays
// there (the bot never asks for another correction).
// ───────────────────────────────────────────────────────────────────────────
Deno.test("Property 6a: re-dispatches bounded by CORRECTION_LIMIT and loop terminates", () => {
  fc.assert(
    fc.property(
      fc.constantFrom(...RECOVERABLE_KINDS),
      fc.integer({ min: 0, max: 25 }), // arbitrary safety cap on loop iterations
      (kind, iterations) => {
        const { opens, finalDecision, attempts } = simulateLoop(kind, 0, iterations);

        // Never more than 3 re-dispatches for the class, no matter how long we loop.
        assert(opens <= CORRECTION_LIMIT, `opens=${opens} exceeded limit`);
        // Opens also cannot exceed the iterations actually performed.
        assert(opens <= iterations);

        if (opens === CORRECTION_LIMIT) {
          // Once the limit is reached, re-consulting the guard with the resulting
          // attempts map ALWAYS yields needs_human → the bot never opens a
          // correction again (the real termination guarantee, Req 9.5/10.2).
          const next = decideCorrection(kind, attempts);
          assertEquals(next.action, "needs_human");
          if (next.action === "needs_human") assertEquals(next.reason, "limit_reached");
        }

        // With strictly more iterations than the limit, the loop body itself had a
        // chance to compute the terminating decision → it must be needs_human.
        if (iterations > CORRECTION_LIMIT) {
          assertEquals(opens, CORRECTION_LIMIT);
          assertEquals(finalDecision.action, "needs_human");
          if (finalDecision.action === "needs_human") {
            assertEquals(finalDecision.reason, "limit_reached");
          }
        }
      },
    ),
    { numRuns: 300 },
  );
});

// ───────────────────────────────────────────────────────────────────────────
// Property 6b — Threshold guard (Req 9.5/9.6): open EXACTLY while attempts < 3,
// needs_human (limit_reached) at attempts >= 3, for any starting count.
// ───────────────────────────────────────────────────────────────────────────
Deno.test("Property 6b: open iff attempts<limit, needs_human iff attempts>=limit", () => {
  fc.assert(
    fc.property(
      fc.constantFrom(...RECOVERABLE_KINDS),
      fc.integer({ min: 0, max: 12 }),
      (kind, attempts) => {
        const decision = decideCorrection(kind, { [kind]: attempts });
        if (attempts < CORRECTION_LIMIT) {
          assertEquals(decision.action, "open");
          if (decision.action === "open") assertEquals(decision.kind, kind);
        } else {
          assertEquals(decision.action, "needs_human");
          if (decision.action === "needs_human") {
            assertEquals(decision.reason, "limit_reached");
          }
        }
      },
    ),
    { numRuns: 300 },
  );
});

// ───────────────────────────────────────────────────────────────────────────
// Property 6c — Per-class isolation + arbitrary starting maps (Req 10.2).
// Starting from an ARBITRARY attempts map, the total number of re-dispatches for
// the chosen class is bounded by the remaining budget (limit - already-used),
// and reaching the limit for one class never prevents termination/correctness.
// ───────────────────────────────────────────────────────────────────────────
Deno.test("Property 6c: arbitrary starting attempts respect the per-class budget", () => {
  const attemptsMapArb = fc.dictionary(
    fc.constantFrom(...RECOVERABLE_KINDS, "missing_consumo", "unknown"),
    fc.integer({ min: 0, max: 6 }),
  );

  fc.assert(
    fc.property(
      fc.constantFrom(...RECOVERABLE_KINDS),
      attemptsMapArb,
      (kind, startMap) => {
        const startForKind = Number(startMap[kind] ?? 0);
        // Run with enough iterations to guarantee we hit the limit if reachable.
        const { opens, finalDecision } = (() => {
          let attempts: Record<string, unknown> = { ...startMap };
          let opens = 0;
          let decision: CorrectionDecision = decideCorrection(kind, attempts);
          for (let i = 0; i < CORRECTION_LIMIT + 5; i++) {
            decision = decideCorrection(kind, attempts);
            if (decision.action !== "open") break;
            opens++;
            attempts = incrementAttempts(attempts, kind);
          }
          return { opens, finalDecision: decision };
        })();

        const remainingBudget = Math.max(0, CORRECTION_LIMIT - startForKind);
        // Re-dispatches for this class can never exceed the remaining budget.
        assertEquals(opens, remainingBudget);
        // Regardless of where we started, the loop ends in needs_human(limit_reached).
        assertEquals(finalDecision.action, "needs_human");
        if (finalDecision.action === "needs_human") {
          assertEquals(finalDecision.reason, "limit_reached");
        }
      },
    ),
    { numRuns: 300 },
  );
});
