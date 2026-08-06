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

  it("corta também na porta da simulação, não só no turno da captura", () => {
    // O corte da fase de captura só vê `captureUpdates` — ele pega o turno em
    // que o lead digita o valor. Quando a captura vem de fora (OCR da conta,
    // motor legado) o lead de R$ 60 chegava ao passo da simulação, ouvia
    // "economia de R$ 4 a R$ 12" e seguia até o pedido de documento.
    const goto = src.slice(src.indexOf("const _needsBill"), src.indexOf("const first = await emitStep"));
    expect(goto).toContain("evaluateLowBillCutoff(true, _billNow)");
    expect(goto).toMatch(/if \(_cutGoto\.reject\)[\s\S]{0,320}return \{/);
    // Precisa devolver os updates do corte (rejected + bot_paused + motivo).
    expect(goto).toContain("..._cutGoto.updates");
  });

  it("não confunde passo do valor com passo do nome por causa do título", () => {
    // O passo do valor tem título "Áudio (nome) + texto pedir valor da conta" e
    // slot "a2_audio_activate_name" — os dois citam o nome porque o ÁUDIO é
    // personalizado. Com a heurística de texto vencendo, `stepIsAskName` ficava
    // true e o bloco `!stepIsAskName` nunca capturava o valor: lead de R$ 60
    // ouvia "economia de R$ 4 a R$ 12" e seguia até o documento.
    expect(src).toContain("const _stepCapturaValor = Array.isArray(currentStep.captures)");
    // Título e slot só decidem quando o passo NÃO declara captura de valor.
    expect(src).toMatch(/!_stepCapturaValor && \([\s\S]{0,320}?slot_key/);
    const decisao = src.slice(src.indexOf("const stepIsAskName ="), src.indexOf("const extracted = extractCaptures"));
    // Sinais estruturados continuam valendo sempre.
    expect(decisao).toContain("_stepCapturaNome ||");
    expect(decisao).toContain('=== "capture_name"');
    // A heurística de título não pode ficar solta no topo do OU.
    expect(decisao).not.toMatch(/stepIsAskName =\s*\n\s*lastOutboundWasNameQuestion/);
  });

  it("interrompe o turno quando o lead está fora da esteira", () => {
    const trecho = src.slice(src.indexOf("if (_cutoff.reject)"), src.indexOf("if (_cutoff.reject)") + 260);
    expect(trecho).toContain("return { reply: _cutoff.reply, updates: _cutoff.updates }");
  });
});
