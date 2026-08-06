/**
 * Recusa de documento por tipo errado precisa contar tentativa.
 *
 * Achado no E2E do Grupo A (2026-08): mandando quatro arquivos que não são
 * RG/CNH, `ocr_doc_attempts` seguia em 0 e `bot_paused` em false. O ramo
 * `detectedType === "outro"` montava a resposta e dava `break` sem tocar no
 * contador, então a escalada para humano — que depende de
 * `attempts >= max_retries` em `resolveOcrFallback` — nunca disparava. O lead
 * reenviava o arquivo errado indefinidamente e ninguém era avisado.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const FN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../supabase/functions");
const CHANNELS = ["whapi-webhook", "evolution-webhook"] as const;

function ramoTipoInvalido(src: string): string {
  const start = src.indexOf('if (detectedType === "outro") {');
  expect(start).toBeGreaterThan(-1);
  return src.slice(start, src.indexOf("\n      }", start));
}

describe.each(CHANNELS)("recusa de documento por tipo errado (%s)", (channel) => {
  const src = readFileSync(path.join(FN, channel, "handlers/bot-flow.ts"), "utf8");
  const ramo = ramoTipoInvalido(src);

  it("conta a tentativa em ocr_doc_attempts", () => {
    expect(ramo).toContain("updates.ocr_doc_attempts");
    expect(ramo).toMatch(/\(customer\.ocr_doc_attempts \|\| 0\) \+ 1/);
  });

  it("consulta o limite configurado do passo antes de decidir", () => {
    expect(ramo).toContain("resolveOcrFallback");
    expect(ramo).toContain('"capture_documento"');
  });

  it("escala para humano ao atingir o limite", () => {
    expect(ramo).toContain("updates.bot_paused = true");
    expect(ramo).toContain("doc_tipo_invalido_max_retries");
    expect(ramo).toContain("nomeRepresentante");
  });

  it("continua sem avançar o passo nem salvar o arquivo recusado", () => {
    expect(ramo).not.toContain("updates.document_front_url");
    expect(ramo).not.toContain("updates.conversation_step");
  });

  it("mantém o motivo detectado na mensagem ao lead", () => {
    expect(ramo).toContain("parece *${detectMotivo}*");
    expect(ramo).toContain("não parece ser um *RG* ou *CNH*");
  });
});
