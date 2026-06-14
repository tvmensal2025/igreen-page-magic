// =============================================================================
// Vendas — API
// =============================================================================
// Acesso à tabela `sales`. Mapeia o shape cru (snake_case) para o modelo da
// aplicação (camelCase). Toda leitura/escrita de venda passa por aqui.
// =============================================================================

import { supabase } from "@/integrations/supabase/client";
import type { CaptureData, CreateSaleInput, Sale, SaleRow, SaleStatus } from "./types";

const SELECT_COLUMNS =
  "id, consultant_id, product_id, customer_id, status, amount, points_kwh, capture_data, notes, submitted_at, activated_at, closed_at, created_at, updated_at";

function asCaptureData(value: unknown): CaptureData {
  if (value && typeof value === "object") {
    return value as CaptureData;
  }
  return {};
}

/** Normaliza a linha do banco para o modelo da aplicação. */
export function mapSaleRow(row: SaleRow): Sale {
  return {
    id: row.id,
    consultantId: row.consultant_id,
    productId: row.product_id,
    customerId: row.customer_id,
    status: row.status,
    amount: row.amount === null ? null : Number(row.amount),
    pointsKwh: Number(row.points_kwh ?? 0),
    captureData: asCaptureData(row.capture_data),
    notes: row.notes,
    submittedAt: row.submitted_at,
    activatedAt: row.activated_at,
    closedAt: row.closed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Lista vendas de um consultor, opcionalmente filtradas por produto/status. */
export async function fetchSales(options: {
  consultantId: string;
  productId?: string;
  status?: SaleStatus;
}): Promise<Sale[]> {
  let query = supabase
    .from("sales" as never)
    .select(SELECT_COLUMNS)
    .eq("consultant_id", options.consultantId)
    .order("created_at", { ascending: false });

  if (options.productId) {
    query = query.eq("product_id", options.productId);
  }
  if (options.status) {
    query = query.eq("status", options.status);
  }

  const { data, error } = await query;
  if (error) throw error;
  return ((data as unknown as SaleRow[]) || []).map(mapSaleRow);
}

/** Cria uma venda. points_kwh é gravado separadamente após o cálculo. */
export async function createSale(
  input: CreateSaleInput & { pointsKwh?: number },
): Promise<Sale> {
  const { data, error } = await supabase
    .from("sales" as never)
    .insert({
      consultant_id: input.consultantId,
      product_id: input.productId,
      customer_id: input.customerId ?? null,
      status: input.status ?? "lead",
      amount: input.amount ?? null,
      points_kwh: input.pointsKwh ?? 0,
      capture_data: input.captureData ?? {},
      notes: input.notes ?? null,
    } as never)
    .select(SELECT_COLUMNS)
    .single();

  if (error) throw error;
  return mapSaleRow(data as unknown as SaleRow);
}

/** Atualiza o status de uma venda (o trigger registra o histórico). */
export async function updateSaleStatus(saleId: string, status: SaleStatus): Promise<Sale> {
  const { data, error } = await supabase
    .from("sales" as never)
    .update({ status } as never)
    .eq("id", saleId)
    .select(SELECT_COLUMNS)
    .single();

  if (error) throw error;
  return mapSaleRow(data as unknown as SaleRow);
}

/** Atualiza pontos/valor/dados de captura de uma venda. */
export async function updateSale(
  saleId: string,
  patch: Partial<{
    amount: number | null;
    pointsKwh: number;
    captureData: CaptureData;
    notes: string | null;
  }>,
): Promise<Sale> {
  const dbPatch: Record<string, unknown> = {};
  if (patch.amount !== undefined) dbPatch.amount = patch.amount;
  if (patch.pointsKwh !== undefined) dbPatch.points_kwh = patch.pointsKwh;
  if (patch.captureData !== undefined) dbPatch.capture_data = patch.captureData;
  if (patch.notes !== undefined) dbPatch.notes = patch.notes;

  const { data, error } = await supabase
    .from("sales" as never)
    .update(dbPatch as never)
    .eq("id", saleId)
    .select(SELECT_COLUMNS)
    .single();

  if (error) throw error;
  return mapSaleRow(data as unknown as SaleRow);
}

/** Remove uma venda. */
export async function deleteSale(saleId: string): Promise<void> {
  const { error } = await supabase.from("sales" as never).delete().eq("id", saleId);
  if (error) throw error;
}
