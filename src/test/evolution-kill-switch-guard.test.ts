// Feature: evolution-multiconsultor-pronto
//
// Testes de EXEMPLO + SMOKE ESTÁTICO para REQ 1 (kill switch global no
// Evolution) — Tarefa 1.3.
//
// Semântica atual (jul/2026): OFF = zero outbound automático, MAS o webhook
// continua o pipeline (grava inbound + avisa consultor) e responde
// `{ ok: true, msg: "bot_globally_disabled_inbound_saved" }`.
//
// _Requirements: 1.2, 1.4_

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  evaluateKillSwitchGate,
  BOT_GLOBALLY_DISABLED_RESPONSE,
  type FlagReadResult,
} from "../../supabase/functions/_shared/bot/kill-switch-gate";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../..");
const EVOLUTION_WEBHOOK = path.join(
  REPO_ROOT,
  "supabase/functions/evolution-webhook/index.ts",
);
const WHAPI_WEBHOOK = path.join(
  REPO_ROOT,
  "supabase/functions/whapi-webhook/index.ts",
);

function simulateGuard(flag: FlagReadResult, event: unknown) {
  const decision = evaluateKillSwitchGate(flag);
  if (!decision.outboundAllowed) {
    return {
      decision,
      proceeded: false,
      processedEvent: null as unknown,
      response: BOT_GLOBALLY_DISABLED_RESPONSE,
    };
  }
  return {
    decision,
    proceeded: true,
    processedEvent: event,
    response: { ok: true } as const,
  };
}

function flagEnabled(): FlagReadResult {
  return { kind: "ok", row: { bot_global_enabled: true } };
}

describe("REQ 1 — Exemplo: bot_global_enabled=true segue além da guarda (Critério 1.2)", () => {
  it("evento de mensagem representativo: enabled=true, outboundAllowed=true, prossegue", () => {
    const event = {
      event: "messages.upsert",
      instance: "consultor-novo-01",
      data: { key: { remoteJid: "5511999999999@s.whatsapp.net" }, message: { conversation: "oi" } },
    };

    const result = simulateGuard(flagEnabled(), event);

    expect(result.decision.enabled).toBe(true);
    expect(result.decision.outboundAllowed).toBe(true);
    expect(result.proceeded).toBe(true);
    expect(result.processedEvent).toBe(event);
    expect(result.response).not.toEqual(BOT_GLOBALLY_DISABLED_RESPONSE);
  });

  it("segundo evento representativo (connection.update): também segue além da guarda", () => {
    const event = {
      event: "connection.update",
      instance: "consultor-novo-02",
      data: { state: "open" },
    };

    const result = simulateGuard(flagEnabled(), event);

    expect(result.decision.enabled).toBe(true);
    expect(result.decision.outboundAllowed).toBe(true);
    expect(result.proceeded).toBe(true);
  });
});

describe("REQ 1 — Smoke estático: kill switch no evolution-webhook (Critério 1.4)", () => {
  const evoSrc = readFileSync(EVOLUTION_WEBHOOK, "utf8");

  it("importa e aplica a guarda isBotGloballyEnabled", () => {
    expect(evoSrc).toContain(
      'import { isBotGloballyEnabled } from "../_shared/bot/global-flag.ts";',
    );
    expect(evoSrc).toContain("isBotGloballyEnabled(supabase as any)");
  });

  it("responde bot_globally_disabled_inbound_saved (inbound salvo, outbound bloqueado)", () => {
    expect(evoSrc).toContain('msg: !botGlobalOutboundEnabled ? "bot_globally_disabled_inbound_saved"');
    expect(evoSrc).toContain("const botGlobalOutboundEnabled = await isBotGloballyEnabled(supabase as any)");
    // Não há mais early-return no topo que engolia o inbound.
    expect(evoSrc).not.toContain("if (!(await isBotGloballyEnabled(supabase as any)))");
  });

  it("a leitura do kill switch fica ANTES de isConsultantAIDisabled", () => {
    const idxServe = evoSrc.indexOf("Deno.serve(");
    const idxGuard = evoSrc.indexOf("isBotGloballyEnabled(supabase as any)");
    const idxConsultantGuard = evoSrc.indexOf(
      "isConsultantAIDisabled(supabase as any",
    );

    expect(idxServe).toBeGreaterThanOrEqual(0);
    expect(idxGuard).toBeGreaterThanOrEqual(0);
    expect(idxConsultantGuard).toBeGreaterThanOrEqual(0);
    expect(idxGuard).toBeGreaterThan(idxServe);
    expect(idxGuard).toBeLessThan(idxConsultantGuard);
  });
});

describe("REQ 1 — Paridade de semântica com whapi-webhook (Critério 1.4)", () => {
  const evoSrc = readFileSync(EVOLUTION_WEBHOOK, "utf8");
  const whapiSrc = readFileSync(WHAPI_WEBHOOK, "utf8");

  it("o whapi-webhook aplica a MESMA guarda e a MESMA resposta de inbound salvo", () => {
    expect(whapiSrc).toContain("const botGlobalOutboundEnabled = await isBotGloballyEnabled(supabase as any)");
    expect(whapiSrc).toContain('msg: "bot_globally_disabled_inbound_saved"');
    expect(whapiSrc).not.toContain("if (!(await isBotGloballyEnabled(supabase as any)))");
  });

  it("ambos leem o kill switch cedo e bloqueiam outbound só depois de persistir inbound", () => {
    const evoGuard = evoSrc.indexOf("isBotGloballyEnabled(supabase as any)");
    const evoConsultantGuard = evoSrc.indexOf("isConsultantAIDisabled(supabase as any");
    const evoInboundSaved = evoSrc.indexOf("bot_globally_disabled_inbound_saved");
    const whapiGuard = whapiSrc.indexOf("isBotGloballyEnabled(supabase as any)");
    const whapiInboundSaved = whapiSrc.indexOf("bot_globally_disabled_inbound_saved");

    expect(evoGuard).toBeGreaterThanOrEqual(0);
    expect(whapiGuard).toBeGreaterThanOrEqual(0);
    expect(evoGuard).toBeLessThan(evoConsultantGuard);
    expect(evoGuard).toBeLessThan(evoInboundSaved);
    expect(whapiGuard).toBeLessThan(whapiInboundSaved);
  });

  it("a resposta neutra dos dois webhooks espelha o shape do módulo puro", () => {
    expect(BOT_GLOBALLY_DISABLED_RESPONSE).toEqual({
      ok: true,
      msg: "bot_globally_disabled_inbound_saved",
    });
    expect(evoSrc).toContain("bot_globally_disabled_inbound_saved");
    expect(whapiSrc).toContain("bot_globally_disabled_inbound_saved");
  });
});
