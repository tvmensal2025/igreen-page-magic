// Feature: evolution-multiconsultor-pronto, Property 1: Kill switch desliga todo outbound no Evolution
//
// Property-based test (Task 1.2) para o gating do kill switch global no
// evolution-webhook.
//
// **Property 1: Kill switch desliga todo outbound no Evolution**
// **Validates: Requirements 1.1, 1.3**
//
// Para qualquer evento de entrada do evolution-webhook, quando o gate global
// resolve como desabilitado (`bot_global_enabled=false`), o número de envios
// outbound é exatamente zero e a resposta é um sucesso neutro; e quando a
// leitura da flag falha (ramo de erro), o gate resolve como HABILITADO
// (fail-open).
//
// A decisão de gating vive em um módulo PURO separado
// (`supabase/functions/_shared/bot/kill-switch-gate.ts`), espelhando a
// semântica de `isBotGloballyEnabled` + a guarda inserida na task 1.1 — sem
// reeditar `evolution-webhook/index.ts`.

import { fc, test } from "@fast-check/vitest";
import { describe, expect } from "vitest";

import {
  evaluateKillSwitchGate,
  BOT_GLOBALLY_DISABLED_RESPONSE,
  type FlagReadResult,
} from "../../supabase/functions/_shared/bot/kill-switch-gate";

// ---------------------------------------------------------------------------
// Sender mockado — conta envios outbound. O webhook real só dispara outbound
// quando o gate permite; aqui simulamos esse acoplamento de forma fiel.
// ---------------------------------------------------------------------------

function makeMockSender() {
  let calls = 0;
  return {
    send(_event: unknown) {
      calls += 1;
    },
    get callCount() {
      return calls;
    },
  };
}

/**
 * Réplica enxuta do ponto de decisão do `evolution-webhook` (guarda da task 1.1):
 * avalia o gate e, se desabilitado, retorna a resposta neutra SEM nenhum
 * outbound. Se habilitado (inclusive fail-open), "processa" o evento e dispara
 * exatamente um outbound através do sender mockado.
 */
function simulateWebhookTurn(flag: FlagReadResult, event: unknown, sender: ReturnType<typeof makeMockSender>) {
  const decision = evaluateKillSwitchGate(flag);
  if (!decision.outboundAllowed) {
    return { decision, response: BOT_GLOBALLY_DISABLED_RESPONSE, status: 200 as const };
  }
  // Caminho-feliz: processamento normal produz outbound.
  sender.send(event);
  return { decision, response: { ok: true } as const, status: 200 as const };
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** Evento de entrada arbitrário (payload Evolution simplificado/genérico). */
const arbEvent = fc.oneof(
  fc.record({
    event: fc.constantFrom("messages.upsert", "connection.update", "messages.update"),
    instance: fc.string(),
    data: fc.object(),
  }),
  fc.object(),
  fc.constant(null),
);

/**
 * Estado bruto da leitura da flag, cobrindo TODOS os ramos relevantes:
 *  - ok + row com bot_global_enabled (boolean ou valores truthy/falsy variados)
 *  - ok + row null (linha ausente → fail-open true)
 *  - error (leitura falhou → fail-open true)
 */
const arbFlagDisabled: fc.Arbitrary<FlagReadResult> = fc
  .constantFrom<unknown>(false, 0, "", null, undefined, NaN)
  .map((v) => ({ kind: "ok", row: { bot_global_enabled: v } }));

const arbFlagEnabled: fc.Arbitrary<FlagReadResult> = fc
  .constantFrom<unknown>(true, 1, "true", "yes", {}, [])
  .map((v) => ({ kind: "ok", row: { bot_global_enabled: v } }));

const arbFlagRowMissing: fc.Arbitrary<FlagReadResult> = fc.constant({ kind: "ok", row: null });

const arbFlagError: fc.Arbitrary<FlagReadResult> = fc.constant({ kind: "error" });

const arbAnyFlag: fc.Arbitrary<FlagReadResult> = fc.oneof(
  arbFlagDisabled,
  arbFlagEnabled,
  arbFlagRowMissing,
  arbFlagError,
);

const RUNS = { numRuns: 200 };

// ---------------------------------------------------------------------------
// Property 1
// ---------------------------------------------------------------------------

describe("Property 1 — Kill switch desliga todo outbound no Evolution (R1.1, R1.3)", () => {
  // R1.1: flag falsy → zero outbound + resposta neutra de sucesso.
  test.prop([arbEvent, arbFlagDisabled], RUNS)(
    "quando bot_global_enabled é falsy, outbound = 0 e resposta neutra de sucesso",
    (event, flag) => {
      const sender = makeMockSender();
      const result = simulateWebhookTurn(flag, event, sender);

      expect(result.decision.enabled).toBe(false);
      expect(result.decision.outboundAllowed).toBe(false);
      // ZERO envios outbound quando desabilitado.
      expect(sender.callCount).toBe(0);
      // Resposta neutra de sucesso (nunca 5xx).
      expect(result.status).toBe(200);
      expect(result.response).toEqual(BOT_GLOBALLY_DISABLED_RESPONSE);
    },
  );

  // R1.3: erro de leitura → fail-open (enabled=true) e processamento normal.
  test.prop([arbEvent, arbFlagError], RUNS)(
    "quando a leitura da flag falha, fail-open: enabled=true e outbound permitido",
    (event, flag) => {
      const sender = makeMockSender();
      const result = simulateWebhookTurn(flag, event, sender);

      expect(result.decision.enabled).toBe(true);
      expect(result.decision.outboundAllowed).toBe(true);
      // Caminho-feliz processa → exatamente um outbound.
      expect(sender.callCount).toBe(1);
      expect(result.status).toBe(200);
    },
  );

  // R1.3 (linha ausente também é fail-open, espelhando o helper).
  test.prop([arbEvent, arbFlagRowMissing], RUNS)(
    "quando a linha da flag está ausente, fail-open: enabled=true e outbound permitido",
    (event, flag) => {
      const sender = makeMockSender();
      const result = simulateWebhookTurn(flag, event, sender);

      expect(result.decision.enabled).toBe(true);
      expect(sender.callCount).toBe(1);
    },
  );

  // Caminho-feliz: flag truthy → processamento normal com outbound.
  test.prop([arbEvent, arbFlagEnabled], RUNS)(
    "quando bot_global_enabled é truthy, processa normalmente e permite outbound",
    (event, flag) => {
      const sender = makeMockSender();
      const result = simulateWebhookTurn(flag, event, sender);

      expect(result.decision.enabled).toBe(true);
      expect(result.decision.outboundAllowed).toBe(true);
      expect(sender.callCount).toBe(1);
    },
  );

  // Invariante geral: outbound só acontece quando enabled === true.
  test.prop([arbEvent, arbAnyFlag], RUNS)(
    "para qualquer estado de flag, outbound ocorre se e somente se enabled=true",
    (event, flag) => {
      const sender = makeMockSender();
      const result = simulateWebhookTurn(flag, event, sender);

      // enabled e outboundAllowed andam juntos.
      expect(result.decision.outboundAllowed).toBe(result.decision.enabled);
      // Contador de outbound reflete exatamente a decisão.
      expect(sender.callCount).toBe(result.decision.enabled ? 1 : 0);
      // Desabilitado ⇒ resposta neutra; habilitado ⇒ nunca a resposta neutra.
      if (!result.decision.enabled) {
        expect(result.response).toEqual(BOT_GLOBALLY_DISABLED_RESPONSE);
      }
    },
  );
});
