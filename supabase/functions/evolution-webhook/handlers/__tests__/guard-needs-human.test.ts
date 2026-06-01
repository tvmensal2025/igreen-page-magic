// Property test for the bot-side non-recoverable guard of the Portal 2
// correction loop (task 7.5).
//
// **Property 7: Não-recuperável nunca entra no loop (lado bot)**
// **Validates: Requirements 10.1, 10.4**
//
// Requirement 10.1: a registration rejected with a non-recoverable
// Classe_de_Erro is flagged for human intervention and the correction loop
// is NOT started.
// Requirement 10.4: while flagged as needing human intervention for a
// non-recoverable class, the bot does NOT ask the client to correct any data
// for that class.
//
// The bot decides whether to open a correction step purely through
// `decideCorrection(errorKind, attempts)` (the shared pure helper used by both
// the evolution and whapi handlers). Only `action === "open"` opens a
// correction step and asks the client for a new value. So the bot-side
// guarantee reduces to a property of `decideCorrection`:
//
//   For every non-recoverable kind (`duplicate_document`, `no_coverage`,
//   `unknown`), and for ANY attempts map (counter at 0, 1, 2, 3, large, or
//   absent/dirty), `decideCorrection` NEVER returns `action: "open"` — it
//   returns `{ action: "needs_human", reason: "non_recoverable" }`. Therefore
//   the bot opens no correction step and asks the client nothing.
//
// Contrast (sanity, shows the guard is specific to non-recoverable): a
// recoverable kind below the limit DOES return `action: "open"`. This proves
// the property above is not vacuously true (the function can and does open
// correction for other inputs).

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import fc from "https://esm.sh/fast-check@3.23.2";

import {
  CORRECTION_LIMIT,
  CORRECTION_MAP,
  decideCorrection,
  RECOVERABLE_CORRECTION_KINDS,
} from "../../../_shared/portal-correction.ts";

// Closed set of non-recoverable classes that must always route to
// `needs_human` and never open a correction step (design §5.5, Req 10.1/10.4).
const NON_RECOVERABLE_KINDS = ["duplicate_document", "no_coverage", "unknown"] as const;

// Recoverable kinds that DO open a correction step (used only for the
// contrast assertion). `missing_consumo` is intentionally excluded: it is
// recoverable but auto-corrected inline, so `decideCorrection` returns
// `none` for it, not `open`.
const RECOVERABLE_KINDS = [...RECOVERABLE_CORRECTION_KINDS] as string[];

// ─── Generators ──────────────────────────────────────────────────────────

// An attempts map keyed by arbitrary error kinds with non-negative counters,
// covering the boundary values called out by the task (0, 1, 2, 3, large).
// We also intentionally generate values around and beyond the limit so the
// property holds "regardless of the attempts counter".
const counterArb = fc.oneof(
  fc.constantFrom(0, 1, 2, 3),
  fc.integer({ min: 0, max: 1_000_000 }), // includes "large"
);

const kindKeyArb = fc.constantFrom(
  ...NON_RECOVERABLE_KINDS,
  ...RECOVERABLE_KINDS,
  "missing_consumo",
);

// Maps from kind → counter. May be empty (no prior attempts), partial, or
// include the kind under test with any counter value.
const attemptsMapArb = fc.dictionary(kindKeyArb, counterArb, { maxKeys: 8 });

// Also cover absent / malformed attempts storage (jsonb that is null or not an
// object) — the guard must hold there too.
const attemptsArb = fc.oneof(
  attemptsMapArb,
  fc.constant(null),
  fc.constant(undefined),
);

// ─── Property 7 (bot side): non-recoverable never opens a correction ───────

Deno.test(
  "PBT Property 7: non-recoverable kinds never open a correction step (any attempts) → needs_human/non_recoverable",
  () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...NON_RECOVERABLE_KINDS),
        attemptsArb,
        (kind, attempts) => {
          const decision = decideCorrection(kind, attempts as Record<string, number> | null);

          // Core invariant: the bot never opens a correction step for a
          // non-recoverable class, so it asks the client nothing (Req 10.4).
          assert(
            decision.action !== "open",
            `non-recoverable kind "${kind}" must not open a correction step`,
          );

          // It routes to human intervention with the non_recoverable reason
          // (Req 10.1).
          assertEquals(decision.action, "needs_human");
          if (decision.action === "needs_human") {
            assertEquals(decision.reason, "non_recoverable");
          }
        },
      ),
      { numRuns: 300 },
    );
  },
);

// Boundary sanity (explicit examples for the counters called out in the task):
// the counter value is irrelevant for non-recoverable kinds.
Deno.test("Property 7: non-recoverable guard holds at attempts 0,1,2,3 and large", () => {
  for (const kind of NON_RECOVERABLE_KINDS) {
    for (const n of [0, 1, 2, 3, 9999]) {
      const decision = decideCorrection(kind, { [kind]: n });
      assertEquals(
        decision.action,
        "needs_human",
        `kind=${kind} attempts=${n} should be needs_human`,
      );
      if (decision.action === "needs_human") {
        assertEquals(decision.reason, "non_recoverable");
      }
    }
  }
});

// ─── Contrast: the guard is specific — recoverable kinds below the limit open ─

Deno.test(
  "PBT contrast: recoverable kinds below the limit DO open a correction step",
  () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...RECOVERABLE_KINDS),
        fc.integer({ min: 0, max: CORRECTION_LIMIT - 1 }), // strictly below the limit
        (kind, n) => {
          const decision = decideCorrection(kind, { [kind]: n });

          // Below the limit, a recoverable class opens a correction step and
          // asks the client — proving the non-recoverable guard above is not
          // vacuous.
          assertEquals(decision.action, "open");
          if (decision.action === "open") {
            assertEquals(decision.kind, kind);
            assertEquals(
              decision.spec,
              CORRECTION_MAP[kind as keyof typeof CORRECTION_MAP],
            );
          }
        },
      ),
      { numRuns: 200 },
    );
  },
);
