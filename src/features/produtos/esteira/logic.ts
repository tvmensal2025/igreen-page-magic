// =============================================================================
// Esteira — Funções puras (sem efeitos colaterais)
// =============================================================================

import {
  ALLOWED_ATTACHMENT_MIMES,
  MAX_ATTACHMENT_BYTES,
  type AllowedMime,
  type SaleStage,
  type StageTemplate,
  type UploadValidation,
} from "./types";

export function isValidStageName(name: string): boolean {
  return typeof name === "string" && name.trim().length > 0 && name.trim().length <= 80;
}

/** Acrescenta uma etapa ao final da lista, renormalizando as posições. */
export function appendStage(
  current: StageTemplate[],
  name: string,
  productFamily?: string | null,
): StageTemplate[] {
  const normalized = normalizePositions(current);
  return [
    ...normalized,
    {
      id: `__new_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      position: normalized.length,
      name: name.trim(),
      isActive: true,
      productFamily: productFamily ?? null,
    },
  ];
}

/** Garante positions 0..N-1 sequenciais e estáveis. */
export function normalizePositions(stages: StageTemplate[]): StageTemplate[] {
  return [...stages]
    .sort((a, b) => a.position - b.position)
    .map((s, idx) => ({ ...s, position: idx }));
}

/** Sanitiza o nome do arquivo para evitar caracteres problemáticos no path. */
export function sanitizeFileName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[^\w.\-]+/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 120) || "arquivo";
}

/**
 * Monta o caminho do storage: <sale_id>/<stage_id>/<timestamp>-<filename>
 * As políticas do Storage validam o primeiro segmento como UUID da venda.
 */
export function buildAttachmentPath(
  saleId: string,
  stageId: string,
  fileName: string,
): string {
  const safe = sanitizeFileName(fileName);
  return `${saleId}/${stageId}/${Date.now()}-${safe}`;
}

export function validateUpload(input: {
  sizeBytes: number;
  mime: string;
}): UploadValidation {
  if (input.sizeBytes > MAX_ATTACHMENT_BYTES) {
    return {
      ok: false,
      reason: "size",
      message: "Arquivo excede o limite de 10 MB.",
    };
  }
  if (!ALLOWED_ATTACHMENT_MIMES.includes(input.mime as AllowedMime)) {
    return {
      ok: false,
      reason: "mime",
      message: "Tipo não permitido. Use JPG, PNG, WEBP ou PDF.",
    };
  }
  return { ok: true };
}

export function computeProgress(stages: SaleStage[]): {
  done: number;
  total: number;
  ratio: number;
} {
  const total = stages.length;
  const done = stages.filter((s) => s.status === "concluido").length;
  const ratio = total === 0 ? 0 : done / total;
  return { done, total, ratio };
}
