// Pure engine helpers shared between `v3-runner.ts` and the variant /
// fallback strategies. Every function in this file is synchronous,
// referentially transparent, and free of `Date.now`, `fetch`,
// `Math.random`, `crypto.randomUUID`, `setTimeout`/`setInterval`, and
// Supabase imports — the runner's purity contract (design §2.1, §2.4)
// is enforced statically by `__tests__/purity_lint_test.ts`. Helpers
// are exempt from the lint *file* but obey the same discipline by
// convention so the runner can call them safely.
//
// Time-like values flow through `EngineConfig.now` (an ISO-8601 string
// the caller supplies) and randomness, where it appears, is derived
// deterministically from `EngineConfig.idempotencyKeyFn`.
//
// Exports:
//   matchTransition       — per design §2.7 step 2 / legacy `flow-router.ts`.
//   dedupeAdjacent        — G1 within-turn dedupe (§2.7 step 5).
//   dropDuplicateLeader   — G1 cross-turn dedupe (§2.7 step 5; <2 s window).
//   capLimits             — `engine_outbound_limit_exceeded` truncation (§2.6).
//   hash                  — deterministic djb2 fold (§2.5 idempotency hash).
//   pickVariant           — variant strategy selector (§2.2 + §2.7).
//
// Validates: Requirements 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 2.4, 15.1.

import type {
  CustomerSnapshot,
  InboundEvent,
  OutboundMessage,
  StructuredLog,
  TransitionSpec,
  VariantStrategy,
} from "./types.ts";

// Variant strategies live alongside this file under `./variants/`. After
// the bot-engine-channel-unification rename (Task 3), the canonical path
// is `_shared/engine/variants/*` (was `_shared/flow-engine/variants/*`).
import { variantA } from "./variants/a.ts";
// variantB removido: Fluxo B é exclusivamente IA livre (Vendedora V2) e
// nunca deve cair no step engine V3.
import { variantD } from "./variants/d.ts";

// ─── matchTransition ────────────────────────────────────────────────────

/**
 * Lower-cased trim for case-insensitive comparison. Mirrors the
 * `_norm` helper in legacy `_shared/flow-router.ts` so v3 produces
 * byte-for-byte identical match decisions for carryover scenarios
 * (`A1`–`A4`, `B1`–`B2`, see Task 31).
 */
function norm(s: string | null | undefined): string {
  // Lowercase + trim + strip diacritics (NFD) — espelha o `_norm` em
  // `_shared/flow-router.ts` para que botões com acento (ex.
  // `💡 Simulação rápida`) casem com phrases cadastradas sem acento.
  return typeof s === "string"
    ? s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim()
    : "";
}

/**
 * Returns the first transition whose phrase / intent / special token
 * matches the inbound event, or `null` when nothing matches.
 *
 * Priority order, mirroring `_shared/flow-router.ts` and design §2.7
 * step 2:
 *
 *  - `button_click`:
 *      (a) `buttonId` matches a `goto_special` token
 *          (`cadastro` | `humano` | `menu` | `repeat`),
 *      (b) `buttonId` equals one of `trigger_phrases`,
 *      (c) `rawText` (when present) matches `trigger_phrases`
 *          (substring, case-insensitive).
 *  - `text`:
 *      (a) any `trigger_phrases` substring match,
 *      (b) `captured.intent` matches `trigger_intent`
 *          (excluding the legacy `default` / `palavra_chave` markers).
 *  - `number_reply`: raw equals one of `trigger_phrases`.
 *  - `media`: a transition with `trigger_intent === "media_received"`.
 *  - `timer_expired` / `no_input`: never match (engine falls back).
 */
export function matchTransition(
  transitions: TransitionSpec[] | null | undefined,
  inbound: InboundEvent,
  captured: Record<string, unknown>,
): TransitionSpec | null {
  const list = Array.isArray(transitions) ? transitions : [];
  if (list.length === 0) return null;

  switch (inbound.kind) {
    case "button_click": {
      const id = norm(inbound.buttonId);
      if (!id) return null;

      // (a) goto_special special tokens.
      for (const t of list) {
        const sp = norm(t.goto_special);
        if (sp && sp === id) return t;
      }
      // (b) buttonId equals one of trigger_phrases.
      for (const t of list) {
        const phrases = Array.isArray(t.trigger_phrases) ? t.trigger_phrases : [];
        for (const p of phrases) {
          if (norm(p) === id) return t;
        }
      }
      // (c) rawText substring match.
      const rawText = norm(inbound.rawText);
      if (rawText) {
        for (const t of list) {
          const phrases = Array.isArray(t.trigger_phrases) ? t.trigger_phrases : [];
          for (const p of phrases) {
            const needle = norm(p);
            if (needle && (needle === rawText || rawText.includes(needle))) return t;
          }
        }
      }
      return null;
    }

    case "text": {
      const text = norm(inbound.text);
      if (!text) return null;

      // (a) phrase substring match.
      for (const t of list) {
        const phrases = Array.isArray(t.trigger_phrases) ? t.trigger_phrases : [];
        for (const p of phrases) {
          const needle = norm(p);
          if (needle && (needle === text || text.includes(needle))) return t;
        }
      }

      // (b) intent match (carried over from `captured.intent`, set by
      //     upstream NLU — empty when not configured).
      const intentRaw = captured && typeof captured.intent === "string"
        ? captured.intent
        : "";
      const intent = norm(intentRaw);
      if (intent && intent !== "default" && intent !== "palavra_chave") {
        for (const t of list) {
          if (norm(t.trigger_intent) === intent) return t;
        }
      }
      return null;
    }

    case "number_reply": {
      const raw = norm(inbound.raw);
      if (!raw) return null;
      for (const t of list) {
        const phrases = Array.isArray(t.trigger_phrases) ? t.trigger_phrases : [];
        for (const p of phrases) {
          if (norm(p) === raw) return t;
        }
      }
      return null;
    }

    case "media": {
      for (const t of list) {
        if (norm(t.trigger_intent) === "media_received") return t;
      }
      return null;
    }

    case "timer_expired":
    case "no_input":
      return null;
  }
}

// ─── dedupeAdjacent ─────────────────────────────────────────────────────

/**
 * G1 (within-turn): drops the second of any two adjacent outbounds that
 * share the same `idempotencyContent`. Stable — preserves the relative
 * order of all kept items. Pure: no clock, no DB.
 *
 * Used by the runner after every variant build (design §2.7 step 5).
 */
export function dedupeAdjacent(outbound: OutboundMessage[]): OutboundMessage[] {
  if (!Array.isArray(outbound) || outbound.length < 2) {
    return Array.isArray(outbound) ? outbound : [];
  }
  const out: OutboundMessage[] = [outbound[0]];
  for (let i = 1; i < outbound.length; i++) {
    const prev = out[out.length - 1];
    if (outbound[i].idempotencyContent === prev.idempotencyContent) continue;
    out.push(outbound[i]);
  }
  return out;
}

// ─── dropDuplicateLeader ────────────────────────────────────────────────

/**
 * G1 (cross-turn): drops `outbound[0]` when its `idempotencyContent`
 * hashes to `state.lastOutboundContentHash` AND `state.lastOutboundAt`
 * is within 2 s of `configNow`. Returns the (possibly trimmed) array
 * plus a `dropped` flag the runner uses to emit
 * `engine_dedupe_blocked` (design §2.6).
 *
 * Both timestamps are parsed via `Date.parse` — that is **not** a system
 * clock read, it is pure string→ms parsing and is deterministic. The
 * 2 s threshold is hard-coded per design §2.7 step 5.
 *
 * When either timestamp is missing or unparseable, the function bails
 * out with `dropped: false` (no false positives — better to risk a
 * duplicate than to silently swallow a legitimate outbound).
 */
export function dropDuplicateLeader(
  outbound: OutboundMessage[],
  state: CustomerSnapshot,
  configNow: string,
): { outbound: OutboundMessage[]; dropped: boolean } {
  if (!Array.isArray(outbound) || outbound.length === 0) {
    return { outbound: outbound ?? [], dropped: false };
  }
  if (!state.lastOutboundAt || !state.lastOutboundContentHash) {
    return { outbound, dropped: false };
  }

  const lastTs = Date.parse(state.lastOutboundAt);
  const nowTs = Date.parse(configNow);
  if (Number.isNaN(lastTs) || Number.isNaN(nowTs)) {
    return { outbound, dropped: false };
  }

  const elapsed = nowTs - lastTs;
  if (elapsed < 0 || elapsed >= 2000) {
    return { outbound, dropped: false };
  }

  const leaderHash = hash(outbound[0].idempotencyContent);
  if (leaderHash !== state.lastOutboundContentHash) {
    return { outbound, dropped: false };
  }

  return { outbound: outbound.slice(1), dropped: true };
}

// ─── capLimits ──────────────────────────────────────────────────────────

/**
 * Truncates `outbound` to at most `max` items. When truncation occurs,
 * also returns a fully-formed `engine_outbound_limit_exceeded` log row
 * (design §2.6) the runner can splice into its log array. When no
 * truncation is needed, `log` is `null`.
 *
 * `max` values < 0 are treated as 0 (defensive — the engine's config
 * validator rejects negative limits, but the helper is still robust).
 */
export function capLimits(
  outbound: OutboundMessage[],
  max: number,
  customerId: string,
  flowId: string,
  stepId: string | null,
  now: string,
): { outbound: OutboundMessage[]; log: StructuredLog | null } {
  const safeMax = Number.isFinite(max) && max > 0 ? Math.floor(max) : 0;
  const list = Array.isArray(outbound) ? outbound : [];

  if (list.length <= safeMax) {
    return { outbound: list, log: null };
  }

  const kept = list.slice(0, safeMax);
  const dropped = list.length - safeMax;
  const log: StructuredLog = {
    kind: "engine_outbound_limit_exceeded",
    at: now,
    customerId,
    flowId,
    stepId,
    payload: { total: list.length, kept: safeMax, dropped },
  };
  return { outbound: kept, log };
}

// ─── hash ───────────────────────────────────────────────────────────────

/**
 * Deterministic, synchronous, pure content hash. Uses the djb2 fold
 * (`h = h * 33 + char`) — fast, dependency-free, and a tight fit for
 * dedupe / idempotency-key derivation. Output is base-36 of the
 * unsigned 32-bit fold so collisions are vanishingly rare for the size
 * of our content corpus (one outbound per turn, ~hundreds of bytes).
 *
 * NOT a cryptographic hash. Do not use for auth or signature
 * verification — that's exactly why we avoid `crypto.subtle.digest`
 * (it's async, and the engine is synchronous by contract).
 *
 * Mirrors the design §2.5 / §2.7 sketch.
 */
export function hash(content: string): string {
  // djb2 — Bernstein's classic. `h = ((h << 5) + h) + c` ≡ `h * 33 + c`.
  let h = 5381;
  const s = typeof content === "string" ? content : String(content ?? "");
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) + s.charCodeAt(i);
    h = h | 0; // coerce to 32-bit int every iteration to bound growth
  }
  return (h >>> 0).toString(36);
}

// ─── pickVariant ────────────────────────────────────────────────────────

/**
 * Maps a flow's variant character to its `VariantStrategy` impl.
 *
 * As variantes A e C compartilham exatamente a mesma estratégia operacional
 * (`variantD`), preservando mídias, textos, botões e transições.
 */
export function pickVariant(variant: "A" | "B" | "C" | "D" | "M"): VariantStrategy {
  switch (variant) {
    case "A":
      // Alias: variante A (rótulo "CEMIG" na UI) roda EXATAMENTE como D —
      // mesmos passos, mesmas mídias, mesmos botões interativos. Sem
      // duplicação de dados: `resolveFlowId` também redireciona A → D público
      // quando não há template A. Ver .lovable/plan.md.
      return variantD;
    case "B":
      return variantA;
    case "C":
      return variantD;
    case "D":
      return variantD;
    case "M":
      // Fluxo MG: clone lógico do Fluxo D. Reutiliza a mesma estratégia
      // (botões interativos, mesma máquina), com seu próprio bot_flow.
      return variantD;
  }
}

