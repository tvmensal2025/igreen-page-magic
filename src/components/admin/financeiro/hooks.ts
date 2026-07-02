// Hooks React Query para a aba Financeiro.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { BoletoRow } from "@/features/produtos/carteira-green/hooks";

export type BoletoAdminRow = BoletoRow & { consultant_name?: string | null };

/**
 * Busca boletos de todos os consultores (visão admin) ou apenas do próprio
 * consultor, quando `scope="self"`. Enriquece com o nome do consultor via
 * segunda query (join manual, já que a view não expõe).
 */
export function useBoletosAdmin(params: { userId?: string; scope: "all" | "self" }) {
  const { userId, scope } = params;
  return useQuery({
    queryKey: ["financeiro-boletos", scope, userId ?? null],
    enabled: scope === "all" || !!userId,
    staleTime: 60_000,
    queryFn: async (): Promise<BoletoAdminRow[]> => {
      let q = supabase
        .from("v_boletos_carteira" as never)
        .select("*")
        .order("vencimento", { ascending: false })
        .limit(5000);
      if (scope === "self" && userId) q = q.eq("consultant_id", userId);
      const { data, error } = await q;
      if (error) throw error;
      const rows = ((data || []) as unknown) as BoletoAdminRow[];

      const ids = Array.from(new Set(rows.map((r) => r.consultant_id).filter(Boolean)));
      if (ids.length === 0) return rows;
      const { data: consultants } = await supabase
        .from("consultants")
        .select("id, display_name, name")
        .in("id", ids as string[]);
      const nameById = new Map<string, string>();
      for (const c of ((consultants || []) as unknown) as Array<{ id: string; display_name?: string | null; name?: string | null }>) {
        nameById.set(c.id, c.display_name || c.name || "");
      }
      for (const r of rows) {
        r.consultant_name = nameById.get(r.consultant_id) || null;
      }
      return rows;
    },
  });
}

/**
 * Retorna um map { customer_id -> ISO da última cobrança } lendo o log
 * `customer_auto_message_log` filtrando por `stage_key='boleto_cobranca'`.
 * Usado para a coluna "Última cobrança" na tabela de boletos.
 */
export function useUltimaCobrancaMap(customerIds: string[]) {
  const key = customerIds.slice().sort().join(",");
  return useQuery({
    queryKey: ["financeiro-ultima-cobranca", key],
    enabled: customerIds.length > 0,
    staleTime: 60_000,
    queryFn: async (): Promise<Record<string, string>> => {
      const { data, error } = await supabase
        .from("customer_auto_message_log")
        .select("customer_id, created_at")
        .eq("stage_key", "boleto_cobranca")
        .in("customer_id", customerIds)
        .order("created_at", { ascending: false })
        .limit(2000);
      if (error) return {};
      const out: Record<string, string> = {};
      for (const r of (data || []) as Array<{ customer_id: string; created_at: string }>) {
        if (!out[r.customer_id]) out[r.customer_id] = r.created_at;
      }
      return out;
    },
  });
}

/**
 * Busca nomes de consultores em lote. Reutilizado no Extrato para mostrar
 * nome legível em vez do UUID.
 */
export function useConsultantNames(ids: string[]) {
  const key = Array.from(new Set(ids)).sort().join(",");
  return useQuery({
    queryKey: ["consultant-names", key],
    enabled: ids.length > 0,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Record<string, string>> => {
      const unique = Array.from(new Set(ids));
      const { data } = await supabase
        .from("consultants")
        .select("id, display_name, name")
        .in("id", unique);
      const out: Record<string, string> = {};
      for (const c of ((data || []) as unknown) as Array<{ id: string; display_name?: string | null; name?: string | null }>) {
        out[c.id] = c.display_name || c.name || "";
      }
      return out;
    },
  });
}

/**
 * Busca template de cobrança de boleto configurado pelo admin em
 * `message_templates` (via shortcut='boleto_cobranca'). Se não existir,
 * o consumidor deve usar o fallback.
 */
export function useBoletoCobrancaTemplate() {
  return useQuery({
    queryKey: ["boleto-cobranca-template"],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<string | null> => {
      const { data } = await supabase
        .from("message_templates")
        .select("content")
        .eq("shortcut", "boleto_cobranca")
        .limit(1)
        .maybeSingle();
      return (data as { content?: string } | null)?.content || null;
    },
  });
}

export const FALLBACK_COBRANCA_TEMPLATE =
  "Olá {{nome}}! Segue seu boleto de energia ({{mes}}) no valor de {{valor}}, com vencimento em {{vencimento}}. Acesse: {{url_boleto}}";

export function renderCobrancaTemplate(
  tpl: string,
  ctx: { nome?: string | null; mes?: string | null; valor?: number | null; vencimento?: string | null; url_boleto?: string | null },
): string {
  const BRL = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const venc = ctx.vencimento ? new Date(ctx.vencimento).toLocaleDateString("pt-BR") : "";
  const map: Record<string, string> = {
    nome: ctx.nome || "cliente",
    mes: ctx.mes || "",
    valor: ctx.valor != null ? BRL(Number(ctx.valor)) : "",
    vencimento: venc,
    url_boleto: ctx.url_boleto || "",
  };
  return tpl.replace(/\{\{\s*(nome|mes|valor|vencimento|url_boleto)\s*\}\}/g, (_, k) => map[k] ?? "");
}
