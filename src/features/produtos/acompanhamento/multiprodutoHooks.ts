// Hooks de carteira multiproduto iGreen (Telecom + Seguros).
// Leem as tabelas dedicadas populadas pela edge `sync-igreen-customers`
// (modo sync_all). RLS garante isolamento por consultor.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface TelecomCustomer {
  id: string;
  idcnxtelecom: number;
  nome: string | null;
  cidade: string | null;
  uf: string | null;
  numero: string | null;
  status: string | null;
  status_label: string | null;
  fatura_valor: number | null;
  fatura_status: string | null;
  fatura_mes_referencia: string | null;
}

export interface SegurosCustomer {
  id: string;
  seguro_id: string;
  segurado: string | null;
  modelo: string | null;
  placa: string | null;
  fipe: number | null;
  mensal: number | null;
  status: string | null;
  status_label: string | null;
}

export function useTelecomCustomers(consultantId?: string) {
  return useQuery({
    queryKey: ["igreen-telecom", consultantId],
    enabled: !!consultantId,
    queryFn: async (): Promise<TelecomCustomer[]> => {
      const { data, error } = await supabase
        .from("igreen_telecom_customers" as never)
        .select("id, idcnxtelecom, nome, cidade, uf, numero, status, status_label, fatura_valor, fatura_status, fatura_mes_referencia")
        .eq("consultant_id", consultantId!)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as TelecomCustomer[];
    },
  });
}

export function useSegurosCustomers(consultantId?: string) {
  return useQuery({
    queryKey: ["igreen-seguros", consultantId],
    enabled: !!consultantId,
    queryFn: async (): Promise<SegurosCustomer[]> => {
      const { data, error } = await supabase
        .from("igreen_seguros_customers" as never)
        .select("id, seguro_id, segurado, modelo, placa, fipe, mensal, status, status_label")
        .eq("consultant_id", consultantId!)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as SegurosCustomer[];
    },
  });
}
