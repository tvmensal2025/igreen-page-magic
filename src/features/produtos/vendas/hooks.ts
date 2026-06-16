// =============================================================================
// Vendas — Hooks (React Query)
// =============================================================================
// Consumo da entidade `sales` na UI. Mutations invalidam a lista do consultor
// para manter board/painel sincronizados. Padrão idêntico ao resto do projeto.
// =============================================================================

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createSale,
  deleteSale,
  fetchSales,
  updateSale,
  updateSaleStatus,
} from "./api";
import type { CaptureData, CreateSaleInput, Sale, SaleStatus } from "./types";

const SALES_KEY = "sales";

/** Lista vendas de um consultor (filtros opcionais por produto/status). */
export function useSales(options: {
  consultantId: string | undefined;
  productId?: string;
  status?: SaleStatus;
}) {
  return useQuery<Sale[]>({
    queryKey: [SALES_KEY, options.consultantId, options.productId ?? "all", options.status ?? "all"],
    queryFn: () =>
      fetchSales({
        consultantId: options.consultantId as string,
        productId: options.productId,
        status: options.status,
      }),
    enabled: !!options.consultantId,
  });
}

/** Cria uma venda e invalida a lista do consultor. */
export function useCreateSale(consultantId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSaleInput & { pointsKwh?: number }) => createSale(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [SALES_KEY, consultantId] });
    },
  });
}

/**
 * Atualiza o status de uma venda (move no pipeline).
 *
 * Aceita um `note` opcional (motivo) — usado ao mover para `perdido`. Quando
 * informado, o motivo é gravado em `sale_status_history.note` (ver `api.ts`).
 */
export function useUpdateSaleStatus(consultantId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      saleId,
      status,
      note,
    }: {
      saleId: string;
      status: SaleStatus;
      note?: string | null;
    }) => updateSaleStatus(saleId, status, note),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [SALES_KEY, consultantId] });
    },
  });
}

/** Atualiza dados de uma venda (valor, pontos, captura, notas). */
export function useUpdateSale(consultantId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      saleId,
      patch,
    }: {
      saleId: string;
      patch: Partial<{
        amount: number | null;
        pointsKwh: number;
        captureData: CaptureData;
        notes: string | null;
      }>;
    }) => updateSale(saleId, patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [SALES_KEY, consultantId] });
    },
  });
}

/** Remove uma venda. */
export function useDeleteSale(consultantId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (saleId: string) => deleteSale(saleId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [SALES_KEY, consultantId] });
    },
  });
}
