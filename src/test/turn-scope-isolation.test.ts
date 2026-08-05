/**
 * Etapa 3 — mistura entre clientes (auditoria 2026-08).
 *
 * O handler conversacional guardava pergunta/vars/nome do turno em variáveis
 * de módulo. Dois inbounds concorrentes no mesmo isolate sobrescreviam esse
 * estado e a resposta de um lead podia sair com o contexto de outro.
 */
import { describe, it, expect } from "vitest";
import { AsyncLocalStorage } from "node:async_hooks";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const FN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../supabase/functions");
const CHANNELS = ["whapi-webhook", "evolution-webhook"] as const;

describe("escopo de turno isolado", () => {
  it("dois turnos concorrentes não compartilham contexto", async () => {
    type Scope = { customerId: string; stepQuestion: string };
    const storage = new AsyncLocalStorage<Scope>();

    async function turn(customerId: string, question: string, delayMs: number) {
      storage.enterWith({ customerId, stepQuestion: "" });
      const scope = storage.getStore()!;
      scope.stepQuestion = question;
      await new Promise((r) => setTimeout(r, delayMs));
      return storage.getStore();
    }

    const [a, b] = await Promise.all([
      turn("lead-A", "Qual o valor da sua conta?", 40),
      turn("lead-B", "Me manda a foto do documento", 5),
    ]);

    expect(a).toEqual({ customerId: "lead-A", stepQuestion: "Qual o valor da sua conta?" });
    expect(b).toEqual({ customerId: "lead-B", stepQuestion: "Me manda a foto do documento" });
  });

  it("variável de módulo compartilhada reproduz o defeito original", async () => {
    let shared = { customerId: "", stepQuestion: "" };
    async function turn(customerId: string, question: string, delayMs: number) {
      shared = { customerId, stepQuestion: question };
      await new Promise((r) => setTimeout(r, delayMs));
      return shared;
    }
    const [a] = await Promise.all([
      turn("lead-A", "Qual o valor da sua conta?", 40),
      turn("lead-B", "Me manda a foto do documento", 5),
    ]);
    expect(a.customerId).toBe("lead-B");
  });
});

describe.each(CHANNELS)("guarda estática — handler conversacional %s", (channel) => {
  const src = readFileSync(path.join(FN, channel, "handlers/conversational/index.ts"), "utf8");

  it("usa AsyncLocalStorage para o contexto do turno", () => {
    expect(src).toContain('from "node:async_hooks"');
    expect(src).toContain("_turnStorage.enterWith");
  });

  it("abre o escopo do turno além de declará-lo", () => {
    const calls = src.match(/_beginTurnScope\(/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(2);
  });

  it("não tem mais variáveis de turno em escopo de módulo", () => {
    expect(src).not.toMatch(/^let _currentTurn(StepQuestion|Vars|CustomerId|MessageText)/m);
  });

  it("mantém o fallback compatível quando o runtime não isola", () => {
    expect(src).toContain("_turnFallback");
  });
});
