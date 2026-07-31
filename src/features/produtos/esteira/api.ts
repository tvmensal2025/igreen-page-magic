// =============================================================================
// Esteira — API (Supabase)
// =============================================================================

import { supabase } from "@/integrations/supabase/client";
import { buildAttachmentPath } from "./logic";
import {
  DEFAULT_TEMPLATE_BY_FAMILY,
  SALES_ATTACHMENTS_BUCKET,
  type AttachmentRow,
  type SaleStage,
  type StageAttachment,
  type StageProgressRow,
  type StageStatus,
  type StageTemplate,
  type TemplateRow,
} from "./types";

// ---------- mappers ----------
function mapTemplate(row: TemplateRow): StageTemplate {
  return {
    id: row.id,
    position: row.position,
    name: row.name,
    isActive: row.is_active,
    productFamily: row.product_family,
  };
}
function mapStage(row: StageProgressRow): SaleStage {
  return {
    id: row.id,
    saleId: row.sale_id,
    position: row.template_position,
    name: row.name_snapshot,
    status: row.status,
    note: row.note,
    completedAt: row.completed_at,
    completedBy: row.completed_by,
  };
}
function mapAttachment(row: AttachmentRow): StageAttachment {
  return {
    id: row.id,
    stageId: row.sale_stage_id,
    storagePath: row.storage_path,
    fileName: row.file_name,
    mime: row.mime,
    sizeBytes: Number(row.size_bytes),
    uploadedBy: row.uploaded_by,
    createdAt: row.created_at,
  };
}

// ---------- TEMPLATES ----------
export async function fetchTemplate(): Promise<StageTemplate[]> {
  const { data, error } = await supabase
    .from("sale_stage_templates" as never)
    .select("id, position, name, is_active, product_family, created_at, updated_at")
    .order("product_family", { ascending: true })
    .order("position", { ascending: true });
  if (error) throw error;
  return ((data as unknown as TemplateRow[]) || []).map(mapTemplate);
}

export async function addStage(name: string, position: number, productFamily?: string | null): Promise<StageTemplate> {
  const { data, error } = await supabase
    .from("sale_stage_templates" as never)
    .insert({ name: name.trim(), position, is_active: true, product_family: productFamily ?? null } as never)
    .select("id, position, name, is_active, product_family, created_at, updated_at")
    .single();
  if (error) throw error;
  return mapTemplate(data as unknown as TemplateRow);
}

export async function renameStage(id: string, name: string): Promise<void> {
  const { error } = await supabase
    .from("sale_stage_templates" as never)
    .update({ name: name.trim() } as never)
    .eq("id", id);
  if (error) throw error;
}

export async function removeStage(id: string): Promise<void> {
  const { error } = await supabase
    .from("sale_stage_templates" as never)
    .delete()
    .eq("id", id);
  if (error) throw error;
}

/**
 * Reordena etapas. Faz a renumeração em duas passadas (offset alto + final)
 * para não violar o UNIQUE(position) durante o swap.
 */
export async function reorderStages(items: Array<{ id: string; position: number }>): Promise<void> {
  const OFFSET = 10000;
  for (const item of items) {
    const { error } = await supabase
      .from("sale_stage_templates" as never)
      .update({ position: item.position + OFFSET } as never)
      .eq("id", item.id);
    if (error) throw error;
  }
  for (const item of items) {
    const { error } = await supabase
      .from("sale_stage_templates" as never)
      .update({ position: item.position } as never)
      .eq("id", item.id);
    if (error) throw error;
  }
}

export async function seedDefaultTemplate(): Promise<void> {
  const existing = await fetchTemplate();
  if (existing.length > 0) return;
  const rows = Object.entries(DEFAULT_TEMPLATE_BY_FAMILY).flatMap(([family, stages]) =>
    stages.map((name, position) => ({
      name,
      position,
      is_active: true,
      product_family: family,
    })),
  );
  const { error } = await supabase
    .from("sale_stage_templates" as never)
    .insert(rows as never);
  if (error) throw error;
}

// ---------- PROGRESS ----------
export async function ensureSaleStages(saleId: string): Promise<void> {
  // Idempotente — RPC criada na migration.
  const { error } = await supabase.rpc("ensure_sale_stage_progress" as never, {
    p_sale_id: saleId,
  } as never);
  if (error) throw error;
}

export async function fetchSaleStages(saleId: string): Promise<SaleStage[]> {
  await ensureSaleStages(saleId).catch(() => {
    /* se já existe, segue */
  });
  const { data, error } = await supabase
    .from("sale_stage_progress" as never)
    .select(
      "id, sale_id, template_position, name_snapshot, status, note, completed_at, completed_by, created_at, updated_at",
    )
    .eq("sale_id", saleId)
    .order("template_position", { ascending: true });
  if (error) throw error;
  return ((data as unknown as StageProgressRow[]) || []).map(mapStage);
}

export async function setStageStatus(
  stageId: string,
  status: StageStatus,
): Promise<void> {
  const { data: current, error: curErr } = await supabase
    .from("sale_stage_progress" as never)
    .select("id, sale_id, template_position, status")
    .eq("id", stageId)
    .single();
  if (curErr || !current) {
    throw curErr ?? new Error("Etapa não encontrada");
  }
  const row = current as unknown as {
    id: string;
    sale_id: string;
    template_position: number;
    status: StageStatus;
  };

  // Ordem da esteira: não concluir etapa se houver anterior pendente.
  if (status === "concluido") {
    const { data: siblings, error: sibErr } = await supabase
      .from("sale_stage_progress" as never)
      .select("id, template_position, status")
      .eq("sale_id", row.sale_id)
      .lt("template_position", row.template_position);
    if (sibErr) throw sibErr;
    const blocked = ((siblings as unknown as Array<{ status: StageStatus }>) || []).filter(
      (s) => s.status !== "concluido",
    );
    if (blocked.length > 0) {
      throw new Error("Conclua as etapas anteriores antes de avançar.");
    }
  }

  const userRes = await supabase.auth.getUser();
  const uid = userRes.data.user?.id ?? null;
  const patch: Record<string, unknown> = { status };
  if (status === "concluido") {
    patch.completed_at = new Date().toISOString();
    patch.completed_by = uid;
  } else {
    patch.completed_at = null;
    patch.completed_by = null;
  }
  const { error } = await supabase
    .from("sale_stage_progress" as never)
    .update(patch as never)
    .eq("id", stageId);
  if (error) throw error;
}

export async function setStageNote(stageId: string, note: string | null): Promise<void> {
  const { error } = await supabase
    .from("sale_stage_progress" as never)
    .update({ note: note && note.trim() ? note.trim() : null } as never)
    .eq("id", stageId);
  if (error) throw error;
}

// ---------- ATTACHMENTS ----------
export async function listAttachments(stageId: string): Promise<StageAttachment[]> {
  const { data, error } = await supabase
    .from("sale_stage_attachments" as never)
    .select("id, sale_stage_id, storage_path, file_name, mime, size_bytes, uploaded_by, created_at")
    .eq("sale_stage_id", stageId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return ((data as unknown as AttachmentRow[]) || []).map(mapAttachment);
}

export async function uploadAttachment(input: {
  saleId: string;
  stageId: string;
  file: File;
}): Promise<StageAttachment> {
  const path = buildAttachmentPath(input.saleId, input.stageId, input.file.name);
  const up = await supabase.storage
    .from(SALES_ATTACHMENTS_BUCKET)
    .upload(path, input.file, {
      cacheControl: "3600",
      upsert: false,
      contentType: input.file.type,
    });
  if (up.error) throw up.error;

  const userRes = await supabase.auth.getUser();
  const uid = userRes.data.user?.id ?? null;

  const { data, error } = await supabase
    .from("sale_stage_attachments" as never)
    .insert({
      sale_stage_id: input.stageId,
      storage_path: path,
      file_name: input.file.name,
      mime: input.file.type,
      size_bytes: input.file.size,
      uploaded_by: uid,
    } as never)
    .select("id, sale_stage_id, storage_path, file_name, mime, size_bytes, uploaded_by, created_at")
    .single();
  if (error) {
    // rollback best-effort
    await supabase.storage.from(SALES_ATTACHMENTS_BUCKET).remove([path]).catch(() => {});
    throw error;
  }
  return mapAttachment(data as unknown as AttachmentRow);
}

export async function removeAttachment(attachment: StageAttachment): Promise<void> {
  // Remove a linha primeiro; depois apaga do storage (best-effort).
  const { error } = await supabase
    .from("sale_stage_attachments" as never)
    .delete()
    .eq("id", attachment.id);
  if (error) throw error;
  await supabase.storage
    .from(SALES_ATTACHMENTS_BUCKET)
    .remove([attachment.storagePath])
    .catch(() => {});
}

export async function getAttachmentSignedUrl(
  attachment: StageAttachment,
  expiresInSeconds = 300,
): Promise<string> {
  const { data, error } = await supabase.storage
    .from(SALES_ATTACHMENTS_BUCKET)
    .createSignedUrl(attachment.storagePath, expiresInSeconds);
  if (error) throw error;
  return data.signedUrl;
}
