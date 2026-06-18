import { describe, expect, it } from "vitest";
import {
  appendStage,
  buildAttachmentPath,
  computeProgress,
  isValidStageName,
  normalizePositions,
  validateUpload,
} from "../logic";
import type { SaleStage, StageTemplate } from "../types";

describe("esteira/logic", () => {
  it("isValidStageName rejeita vazio e aceita nome válido", () => {
    expect(isValidStageName("")).toBe(false);
    expect(isValidStageName("   ")).toBe(false);
    expect(isValidStageName("Visita técnica")).toBe(true);
  });

  it("appendStage coloca nova etapa no fim com position sequencial", () => {
    const base: StageTemplate[] = [
      { id: "a", position: 0, name: "A", isActive: true, productFamily: "placas" },
    ];
    const next = appendStage(base, "B", "placas");
    expect(next).toHaveLength(2);
    expect(next[1].position).toBe(1);
    expect(next[1].name).toBe("B");
  });

  it("normalizePositions renumera 0..n-1", () => {
    const messy: StageTemplate[] = [
      { id: "b", position: 5, name: "B", isActive: true, productFamily: null },
      { id: "a", position: 2, name: "A", isActive: true, productFamily: null },
    ];
    const norm = normalizePositions(messy);
    expect(norm.map((s) => s.position)).toEqual([0, 1]);
  });

  it("buildAttachmentPath organiza por venda e etapa", () => {
    const saleId = "11111111-1111-1111-1111-111111111111";
    const stageId = "22222222-2222-2222-2222-222222222222";
    const path = buildAttachmentPath(saleId, stageId, "foto casa.jpg");
    expect(path.startsWith(`${saleId}/${stageId}/`)).toBe(true);
    expect(path).toContain("foto_casa.jpg");
  });

  it("validateUpload bloqueia mime e tamanho inválidos", () => {
    expect(validateUpload({ sizeBytes: 11 * 1024 * 1024, mime: "image/jpeg" }).ok).toBe(false);
    expect(validateUpload({ sizeBytes: 100, mime: "application/zip" }).ok).toBe(false);
    expect(validateUpload({ sizeBytes: 100, mime: "image/png" }).ok).toBe(true);
  });

  it("computeProgress conta concluídos sobre o total", () => {
    const stages: SaleStage[] = [
      { id: "1", saleId: "s", position: 0, name: "A", status: "concluido", note: null, completedAt: null, completedBy: null },
      { id: "2", saleId: "s", position: 1, name: "B", status: "pendente", note: null, completedAt: null, completedBy: null },
      { id: "3", saleId: "s", position: 2, name: "C", status: "concluido", note: null, completedAt: null, completedBy: null },
    ];
    expect(computeProgress(stages)).toEqual({ done: 2, total: 3, ratio: 2 / 3 });
  });
});
