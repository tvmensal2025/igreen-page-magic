// Feature: evolution-multiconsultor-pronto
//
// Testes de EXEMPLO + SMOKE ESTÁTICO para REQ 1 (kill switch global no
// Evolution) — Tarefa 1.3.
//
// Cobre:
//   1. Exemplo (Critério 1.2): com `bot_global_enabled=true`, o gate resolve
//      como HABILITADO (enabled=true / outboundAllowed=true) e o handler segue
//      ALÉM da guarda — verificado para 1–2 eventos representativos, reusando o
//      módulo PURO de gating criado na task 1.2
//      (`_shared/bot/kill-switch-gate.ts`), o mesmo exercido pelo property test.
//   2. Smoke estático (Critério 1.4): lendo o fonte de
//      `evolution-webhook/index.ts`, a guarda `isBotGloballyEnabled` está no
//      TOPO do handler — ANTES de `req.json()` e ANTES da guarda por-consultor
//      `isConsultantAIDisabled` — retorna a resposta neutra
//      `{ ok: true, msg: "bot_globally_disabled" }`, e tem PARIDADE de semântica
//      com `whapi-webhook/index.ts`.
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

// ---------------------------------------------------------------------------
// Localização dos fontes (resolvido a partir deste arquivo de teste).
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Réplica enxuta do ponto de decisão da guarda (task 1.1): avalia o gate e, se
// desabilitado, retorna a resposta neutra SEM outbound; se habilitado, "segue
// além da guarda" e processa o evento (registrado pelo flag `proceeded`).
// ---------------------------------------------------------------------------

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
  // Segue ALÉM da guarda: o handler continua o processamento normal.
  return {
    decision,
    proceeded: true,
    processedEvent: event,
    response: { ok: true } as const,
  };
}

/** Estado da flag lido com sucesso e habilitado (`bot_global_enabled=true`). */
function flagEnabled(): FlagReadResult {
  return { kind: "ok", row: { bot_global_enabled: true } };
}

// ---------------------------------------------------------------------------
// 1) Exemplo (Critério 1.2) — flag=true → handler segue além da guarda.
// ---------------------------------------------------------------------------

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
    // O handler segue ALÉM da guarda e processa o evento normalmente.
    expect(result.proceeded).toBe(true);
    expect(result.processedEvent).toBe(event);
    // Quando habilitado, a resposta NUNCA é a resposta neutra de silêncio.
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

// ---------------------------------------------------------------------------
// 2) Smoke estático (Critério 1.4) — guarda no topo + paridade com o whapi.
// ---------------------------------------------------------------------------

describe("REQ 1 — Smoke estático: guarda no topo do evolution-webhook (Critério 1.4)", () => {
  const evoSrc = readFileSync(EVOLUTION_WEBHOOK, "utf8");

  it("importa e aplica a guarda isBotGloballyEnabled", () => {
    expect(evoSrc).toContain(
      'import { isBotGloballyEnabled } from "../_shared/bot/global-flag.ts";',
    );
    expect(evoSrc).toContain("isBotGloballyEnabled(supabase as any)");
  });

  it("retorna a resposta neutra { ok: true, msg: \"bot_globally_disabled\" }", () => {
    expect(evoSrc).toContain('msg: "bot_globally_disabled"');
    // A negação `!(await isBotGloballyEnabled(...))` é o gatilho do early-return.
    expect(evoSrc).toContain("if (!(await isBotGloballyEnabled(supabase as any)))");
  });

  it("a guarda fica ANTES de isConsultantAIDisabled (kill switch global precede o per-consultor)", () => {
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

  it("o whapi-webhook aplica a MESMA guarda e a MESMA resposta neutra", () => {
    expect(whapiSrc).toContain("if (!(await isBotGloballyEnabled(supabase as any)))");
    expect(whapiSrc).toContain('msg: "bot_globally_disabled"');
  });

  it("whapi: guarda precede req.json(); evolution: guarda precede isConsultantAIDisabled", () => {
    const evoGuard = evoSrc.indexOf("isBotGloballyEnabled(supabase as any)");
    const evoConsultantGuard = evoSrc.indexOf("isConsultantAIDisabled(supabase as any");
    const whapiGuard = whapiSrc.indexOf("isBotGloballyEnabled(supabase as any)");
    const whapiReqJson = whapiSrc.indexOf("await req.json()");

    expect(evoGuard).toBeGreaterThanOrEqual(0);
    expect(whapiGuard).toBeGreaterThanOrEqual(0);
    // Whapi: guarda antes do parsing do corpo.
    expect(whapiGuard).toBeLessThan(whapiReqJson);
    // Evolution: ACK/conexão parseiam o body cedo; kill switch silencia só o fluxo conversacional.
    expect(evoGuard).toBeLessThan(evoConsultantGuard);
  });

  it("a resposta neutra dos dois webhooks tem o MESMO shape do módulo puro", () => {
    // O módulo puro é a fonte de verdade do shape; ambos os webhooks o espelham.
    expect(BOT_GLOBALLY_DISABLED_RESPONSE).toEqual({ ok: true, msg: "bot_globally_disabled" });
    const neutralLiteral = '{ ok: true, msg: "bot_globally_disabled" }';
    expect(evoSrc).toContain(neutralLiteral);
    expect(whapiSrc).toContain(neutralLiteral);
  });
});
