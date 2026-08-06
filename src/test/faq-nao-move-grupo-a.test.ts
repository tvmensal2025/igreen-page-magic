/**
 * Etapa 5 — FAQ/atalhos não podem mexer na etapa do Grupo A.
 *
 * A proteção já existe no handler (NO_QA_STEPS + `keepStep`). Estes testes
 * travam o invariante para não regredir: dentro de cadastro/coleta a FAQ
 * responde e devolve o lead ao mesmo passo.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const FN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../supabase/functions");
const CHANNELS = ["whapi-webhook", "evolution-webhook"] as const;

describe.each(CHANNELS)("FAQ/atalhos × etapa do Grupo A (%s)", (channel) => {
  const src = readFileSync(path.join(FN, channel, "handlers/bot-flow.ts"), "utf8");

  it("keepStep devolve o turno sem tocar em conversation_step", () => {
    const block = src.slice(src.indexOf("if (opts?.keepStep) {"));
    const ret = block.slice(0, block.indexOf("\n    }\n    return"));
    expect(ret).toContain("__inline_sent: true");
    expect(ret).not.toContain("conversation_step");
  });

  it("toda chamada com force usa keepStep (cadastro nunca é movido pela FAQ)", () => {
    const calls = src.match(/trySendConfiguredQa\(\{[^}]*\}\)/g) || [];
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      if (call.includes("force: true")) expect(call).toContain("keepStep: true");
    }
  });

  it("passos de cadastro seguem na lista de bypass da FAQ", () => {
    const idx = src.indexOf("NO_QA_STEPS");
    expect(idx).toBeGreaterThan(-1);
    const decl = src.slice(idx, idx + 1200);
    for (const step of ["aguardando_conta", "ask_email", "confirmando_dados_conta"]) {
      expect(decl).toContain(step);
    }
  });

  it("interceptor off-topic continua reenviando o prompt do mesmo passo", () => {
    expect(src).toContain("resolveStepReentry(supabase, customer, step, nomeRepresentante)");
    expect(src).toContain('trySendConfiguredQa({ force: true, keepStep: true })');
  });
});
