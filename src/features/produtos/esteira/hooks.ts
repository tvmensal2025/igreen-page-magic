// =============================================================================
// Esteira — Hooks (React Query)
// =============================================================================

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addStage,
  fetchSaleStages,
  fetchTemplate,
  listAttachments,
  removeAttachment,
  removeStage,
  renameStage,
  reorderStages,
  seedDefaultTemplate,
  setStageNote,
  setStageStatus,
  uploadAttachment,
} from "./api";
import type { StageAttachment, StageStatus } from "./types";

const TEMPLATE_KEY = ["esteira", "template"] as const;
const stagesKey = (saleId: string) => ["esteira", "stages", saleId] as const;
const attachmentsKey = (stageId: string) => ["esteira", "attachments", stageId] as const;

export function useStageTemplate() {
  return useQuery({ queryKey: TEMPLATE_KEY, queryFn: fetchTemplate });
}

export function useSaleStages(saleId: string | undefined) {
  return useQuery({
    queryKey: stagesKey(saleId ?? ""),
    queryFn: () => fetchSaleStages(saleId as string),
    enabled: !!saleId,
  });
}

export function useStageAttachments(stageId: string | undefined) {
  return useQuery({
    queryKey: attachmentsKey(stageId ?? ""),
    queryFn: () => listAttachments(stageId as string),
    enabled: !!stageId,
  });
}

// Mutations -------------------------------------------------------------------
export function useAddStage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name, position }: { name: string; position: number }) =>
      addStage(name, position),
    onSuccess: () => qc.invalidateQueries({ queryKey: TEMPLATE_KEY }),
  });
}

export function useRenameStage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => renameStage(id, name),
    onSuccess: () => qc.invalidateQueries({ queryKey: TEMPLATE_KEY }),
  });
}

export function useRemoveStage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => removeStage(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: TEMPLATE_KEY }),
  });
}

export function useReorderStages() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (items: Array<{ id: string; position: number }>) => reorderStages(items),
    onSuccess: () => qc.invalidateQueries({ queryKey: TEMPLATE_KEY }),
  });
}

export function useSeedDefaultTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => seedDefaultTemplate(),
    onSuccess: () => qc.invalidateQueries({ queryKey: TEMPLATE_KEY }),
  });
}

export function useSetStageStatus(saleId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ stageId, status }: { stageId: string; status: StageStatus }) =>
      setStageStatus(stageId, status),
    onSuccess: () => qc.invalidateQueries({ queryKey: stagesKey(saleId) }),
  });
}

export function useSetStageNote(saleId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ stageId, note }: { stageId: string; note: string | null }) =>
      setStageNote(stageId, note),
    onSuccess: () => qc.invalidateQueries({ queryKey: stagesKey(saleId) }),
  });
}

export function useUploadAttachment(stageId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ saleId, file }: { saleId: string; file: File }) =>
      uploadAttachment({ saleId, stageId, file }),
    onSuccess: () => qc.invalidateQueries({ queryKey: attachmentsKey(stageId) }),
  });
}

export function useRemoveAttachment(stageId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (attachment: StageAttachment) => removeAttachment(attachment),
    onSuccess: () => qc.invalidateQueries({ queryKey: attachmentsKey(stageId) }),
  });
}
