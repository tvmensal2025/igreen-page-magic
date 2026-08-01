/**
 * useDiagramMetrics — hook de carregamento das métricas de funil exibidas
 * sobre o canvas no Modo_Diagrama (overlay opcional do Toggle "Métricas").
 *
 * Lê a view `v_flow_step_funnel` filtrando por `consultant_id`. A view já
 * aplica a janela de "últimos 30 dias" (`WHERE t.created_at > now() -
 * interval '30 days'`), portanto não passamos filtros temporais aqui.
 *
 * Comportamento:
 *  - Sem polling (R9.10): a busca dispara apenas quando `enabled` muda para
 *    `true` ou quando `refresh()` é chamado.
 *  - Cache por `(consultantId, variant)` em estado React: trocar qualquer um
 *    dos dois invalida o cache e força nova busca enquanto `enabled === true`.
 *  - Em falha (R9.7): `error` é preenchido, exibimos `toast.warning`, mas
 *    `enabled` permanece `true` para permitir retry sem mudar a UI da toolbar.
 *  - As linhas são indexadas por `step_key` em um `Map<string, FunnelRow>`
 *    para que `useDiagramData` faça lookup O(1) ao montar `FlowDiagramNode`.
 *
 * Mapeia para os requisitos R9.2, R9.7, R9.9 e R9.10 do spec
 * `flow-diagram-view`.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "@/components/ui/sonner";

import { supabase } from "@/integrations/supabase/client";
import type { FunnelRow } from "@/hooks/useDiagramData";
import type { Variant } from "@/components/admin/flow-builder/flowTypes";

export interface UseDiagramMetricsArgs {
  /** Quando `false`, o hook não busca dados (overlay desligado). */
  enabled: boolean;
  /** Dono do fluxo. Usado como filtro `consultant_id` da view. */
  consultantId: string;
  /** Variante em edição. Compõe a chave de cache. */
  variant: Variant;
}

export interface UseDiagramMetricsResult {
  /** Linhas indexadas por `step_key`. `null` enquanto não houver carga válida. */
  data: Map<string, FunnelRow> | null;
  /** `true` enquanto uma consulta estiver em voo. */
  loading: boolean;
  /** Mensagem de erro da última falha; `null` em sucesso. */
  error: string | null;
  /** Dispara nova consulta manualmente (R9.10). */
  refresh: () => Promise<void>;
}

/** Linha bruta retornada pela view, antes do mapeamento. */
type RawFunnelRow = {
  step_key: string | null;
  abandonment_rate_pct: number | null;
  avg_duration_ms: number | null;
  avg_confidence: number | null;
};

/** Compõe a chave de cache `(consultantId, variant)`. */
function makeCacheKey(consultantId: string, variant: Variant): string {
  return `${consultantId}::${variant}`;
}

export function useDiagramMetrics({
  enabled,
  consultantId,
  variant,
}: UseDiagramMetricsArgs): UseDiagramMetricsResult {
  const [data, setData] = useState<Map<string, FunnelRow> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Última chave `(consultantId, variant)` para a qual `data` está válido.
  // Permite invalidar quando o Consultor troca de Variante (R9.9) ou quando
  // o hook é remontado com outro consultor.
  const lastFetchedKeyRef = useRef<string | null>(null);
  // Evita race conditions entre fetches concorrentes (ex.: troca rápida de
  // Variante enquanto a anterior ainda está pendente).
  const requestSeqRef = useRef(0);
  const unmountedRef = useRef(false);

  useEffect(() => {
    return () => {
      unmountedRef.current = true;
    };
  }, []);

  const fetchMetrics = useCallback(
    async (
      cacheKey: string,
    ): Promise<void> => {
      if (!consultantId) return;
      const seq = ++requestSeqRef.current;
      setLoading(true);
      setError(null);
      try {
        // Cast para `never`: o tipo gerado em `supabase/types.ts` ainda não
        // expõe a view `v_flow_step_funnel`. Mantemos o mesmo padrão usado em
        // `FlowFunnelPanel.tsx`.
        const { data: rows, error: queryError } = await (
          supabase as unknown as {
            from: (table: string) => {
              select: (columns: string) => {
                eq: (column: string, value: string) => Promise<{
                  data: RawFunnelRow[] | null;
                  error: { message: string } | null;
                }>;
              };
            };
          }
        )
          .from("v_flow_step_funnel")
          .select(
            "step_key, abandonment_rate_pct, avg_duration_ms, avg_confidence",
          )
          .eq("consultant_id", consultantId);

        // Descarta resposta de uma requisição obsoleta (chave mudou).
        if (unmountedRef.current || seq !== requestSeqRef.current) return;

        if (queryError) {
          throw new Error(queryError.message);
        }

        const map = new Map<string, FunnelRow>();
        for (const raw of rows ?? []) {
          // R9.8: linhas sem `step_key` são ignoradas no overlay (o nó
          // simplesmente não recebe métricas; isso não é erro).
          if (!raw.step_key) continue;
          map.set(raw.step_key, {
            step_key: raw.step_key,
            abandonment_rate_pct: raw.abandonment_rate_pct,
            avg_duration_ms: raw.avg_duration_ms,
            avg_confidence: raw.avg_confidence,
          });
        }

        setData(map);
        lastFetchedKeyRef.current = cacheKey;
      } catch (err) {
        if (unmountedRef.current || seq !== requestSeqRef.current) return;
        // R9.7: `error` populado, `toast.warning`, `enabled` preservado pelo
        // chamador (não mexemos no Toggle).
        const message =
          err instanceof Error
            ? err.message
            : "Falha ao carregar métricas do fluxo.";
        setError(message);
        // Não limpamos `data` — a UI mantém a última carga válida (se houver)
        // até a próxima tentativa bem-sucedida. Isso evita flicker em retries.
        toast.warning(
          "Não foi possível atualizar as métricas. Tente novamente.",
        );
      } finally {
        if (!unmountedRef.current && seq === requestSeqRef.current) {
          setLoading(false);
        }
      }
    },
    [consultantId],
  );

  // R9.10: dispara fetch quando `enabled` muda para `true` ou quando a chave
  // `(consultantId, variant)` muda enquanto `enabled` permanece `true`. Sem
  // polling — o efeito só re-executa por mudança nas dependências.
  useEffect(() => {
    if (!enabled || !consultantId) return;
    const cacheKey = makeCacheKey(consultantId, variant);
    if (lastFetchedKeyRef.current === cacheKey && data !== null) {
      // Já temos cache válido para esta chave; não buscamos de novo.
      return;
    }
    void fetchMetrics(cacheKey);
  }, [enabled, consultantId, variant, fetchMetrics, data]);

  // Quando `enabled` volta para `false`, limpamos `error` (a UI da toolbar
  // não precisa exibir erro de uma camada desligada). `data` é mantida em
  // memória para que reabrir o overlay seja instantâneo enquanto a chave
  // de cache permanecer a mesma.
  useEffect(() => {
    if (!enabled) {
      setError(null);
      setLoading(false);
    }
  }, [enabled]);

  const refresh = useCallback(async (): Promise<void> => {
    if (!consultantId) return;
    const cacheKey = makeCacheKey(consultantId, variant);
    // R9.10: refresh força nova consulta independente do cache.
    await fetchMetrics(cacheKey);
  }, [consultantId, variant, fetchMetrics]);

  return { data, loading, error, refresh };
}
