/**
 * Corte de conta baixa no fluxo do construtor.
 *
 * Achado no E2E do Grupo A (2026-08, cenário `valor_baixo`): o lead respondeu
 * "60" no passo do valor e o bot seguiu vendendo — "economia de R$ 4 a R$ 12" —
 * até pedir foto da conta e documento. O corte de R$ 100 existia, mas só nos
 * passos conversacionais legados (`qualificacao`, `pos_video`), e há lock
 * explícito impedindo consultor com fluxo custom de cair neles.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const FN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../supabase/functions");
const CHANNELS = ["whapi-webhook", "evolution-webhook"] as const;

describe.each(CHANNELS)("corte de conta baixa (%s)", (channel) => {
  const src = readFileSync(path.join(FN, channel, "handlers/conversational/index.ts"), "utf8");

  it("usa o helper compartilhado em vez de reimplementar o limite", () => {
    expect(src).toContain("evaluateLowBillCutoff");
    expect(src).toContain("low-bill-reentry.ts");
  });

  it("decide olhando o passo que pede o valor", () => {
    expect(src).toMatch(/_stepPedeValor[\s\S]{0,200}electricity_bill_value/);
    expect(src).toContain("evaluateLowBillCutoff(_stepPedeValor, captureUpdates.electricity_bill_value)");
  });

  it("corta ANTES do avanço pós-captura", () => {
    const corte = src.indexOf("evaluateLowBillCutoff(_stepPedeValor");
    const avanco = src.indexOf("[skip-step] post-capture");
    expect(corte).toBeGreaterThan(-1);
    expect(avanco).toBeGreaterThan(-1);
    // Invertido, o lead já saiu do passo do valor e segue para o cadastro.
    expect(corte).toBeLessThan(avanco);
  });

  it("interrompe o turno quando o lead está fora da esteira", () => {
    const trecho = src.slice(src.indexOf("if (_cutoff.reject)"), src.indexOf("if (_cutoff.reject)") + 260);
    expect(trecho).toContain("return { reply: _cutoff.reply, updates: _cutoff.updates }");
  });
});
