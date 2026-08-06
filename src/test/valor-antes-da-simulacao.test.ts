/**
 * Uma mensagem do lead avança UM passo, não dois.
 *
 * Achado no E2E do Grupo A (2026-08): o lead respondeu só o nome em `a1_ask_name`
 * e recebeu, no mesmo turno, a pergunta do valor (`a2_text_ask_bill_value`) E a
 * simulação (`a3_explain_with_buttons`) — esta última renderizada como
 * "Com base no valor de *R$ *, hoje você consegue economizar cerca de todos os
 * meses". O `a1` tem transição `default` para o `a2` e o `a2` para o `a3`, então
 * `emitCurrentBeforeGoto` emitia a pergunta do valor e a mesma mensagem ("Joao
 * Silva") era usada para avançar de novo — o lead nunca disse quanto paga.
 *
 * Custo comercial: some a âncora numérica do pitch e a mensagem quebrada chega
 * justo quando o lead está decidindo se confia.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const FN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../supabase/functions");
const CHANNELS = ["whapi-webhook", "evolution-webhook"] as const;

describe.each(CHANNELS)("valor da conta antes da simulação (%s)", (channel) => {
  const src = readFileSync(path.join(FN, channel, "handlers/conversational/index.ts"), "utf8");

  it("emitCurrentBeforeGoto sinaliza que o passo ainda espera resposta", () => {
    expect(src).toContain("const emitCurrentBeforeGoto = async (cur: DbStep, next: DbStep): Promise<boolean>");
    const corpo = src.slice(
      src.indexOf("const emitCurrentBeforeGoto"),
      src.indexOf("const stayOnCurrentStep"),
    );
    // Só para quando sobrou campo hard sem captura neste turno.
    expect(corpo).toContain("const pendentes = asked.filter((f) => !justCaptured.includes(f))");
    expect(corpo).toMatch(/if \(pendentes\.length > 0\)[\s\S]{0,220}return true;/);
  });

  it("todo ponto que emite antes de pular respeita o sinal de parada", () => {
    const chamadas = src.match(/^.*emitCurrentBeforeGoto\(currentStep, \w+\).*$/gm) || [];
    // Três caminhos de avanço: fallback configurado, transition default e posição.
    expect(chamadas.length).toBe(3);
    for (const linha of chamadas) {
      expect(linha).toContain("if (await emitCurrentBeforeGoto");
      expect(linha).toContain("return _finalize(stepKey, stayOnCurrentStep())");
    }
  });

  it("parar no passo preserva o que foi capturado no turno", () => {
    const bloco = src.slice(src.indexOf("const stayOnCurrentStep"), src.indexOf("const stayOnCurrentStep") + 400);
    // Sem isto o nome recém-capturado se perderia e o bot perguntaria de novo.
    expect(bloco).toContain("...captureUpdates");
    expect(bloco).toContain("conversation_step: currentStep.id");
    // A pergunta já saiu por emitStep — o chamador não deve mandar reply de novo.
    expect(bloco).toContain("__inline_sent: true");
  });

  it("nenhum passo que cita valor/economia é emitido sem a captura", () => {
    expect(src).toContain("[goto-guard]");
    const guarda = src.slice(src.indexOf("const _needsBill"), src.indexOf("const first = await emitStep"));
    expect(guarda).toMatch(/valor_conta\|economia_range/);
    // Vale o valor capturado AGORA — senão bloquearia o turno que traz o valor.
    expect(guarda).toContain("captureUpdates.electricity_bill_value ??");
    expect(guarda).toMatch(/if \(_needsBill && !\(_billNow >= 30\)\)/);
  });

  it("a guarda roda ANTES de emitir o passo", () => {
    const guarda = src.indexOf("const _needsBill");
    const emissao = src.indexOf("const first = await emitStep");
    expect(guarda).toBeGreaterThan(-1);
    expect(guarda).toBeLessThan(emissao);
  });
});
