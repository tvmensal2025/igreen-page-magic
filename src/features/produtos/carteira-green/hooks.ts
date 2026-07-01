// Hooks React Query para o painel Carteira Green.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface BoletoRow {
  id: string;
  consultant_id: string;
  customer_id: string | null;
  idcliente: number | null;
  nome: string | null;
  cidade: string | null;
  uf: string | null;
  mes_referencia: string | null;
  total: number | null;
  vencimento: string | null;
  pagamento: string | null;
  status: string | null;
  dias_atraso: number | null;
  injecao: boolean | null;
  kwh_compensado: number | null;
  conta_unica: boolean | null;
  fornecedora: string | null;
  url_invoice: string | null;
  url_boleto: string | null;
  synced_at: string | null;
  phone_whatsapp: string | null;
  customer_name: string | null;
}

export interface DevolutivaRow {
  id: string;
  iddevolutiva: number | null;
  nome: string | null;
  cidade: string | null;
  uf: string | null;
  licenciado: string | null;
  categoria: string | null;
  campo: string | null;
  motivo: string | null;
  impeditiva: boolean | null;
  propria: boolean | null;
  data_devolutiva: string | null;
  resolvida_em: string | null;
}

export function useBoletosCarteira(consultantId?: string) {
  return useQuery({
    queryKey: ["carteira-green-boletos", consultantId],
    enabled: !!consultantId,
    staleTime: 60_000,
    queryFn: async (): Promise<BoletoRow[]> => {
      const { data, error } = await supabase
        .from("v_boletos_carteira" as never)
        .select("*")
        .eq("consultant_id", consultantId!)
        .order("vencimento", { ascending: false })
        .limit(2000);
      if (error) throw error;
      return (data || []) as unknown as BoletoRow[];
    },
  });
}

export function useDevolutivasCarteira(consultantId?: string) {
  return useQuery({
    queryKey: ["carteira-green-devolutivas", consultantId],
    enabled: !!consultantId,
    staleTime: 60_000,
    queryFn: async (): Promise<DevolutivaRow[]> => {
      const { data, error } = await supabase
        .from("igreen_customer_devolutivas" as never)
        .select(
          "id, iddevolutiva, nome, cidade, uf, licenciado, categoria, campo, motivo, impeditiva, propria, data_devolutiva, resolvida_em",
        )
        .eq("consultant_id", consultantId!)
        .order("data_devolutiva", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data || []) as unknown as DevolutivaRow[];
    },
  });
}

export interface CarteiraStats {
  totalComBoleto: number;
  pagos: number;
  disponiveis: number;
  vencidos: number;
  comInjecao: number;
  semInjecao: number;
  kwhCompensados: number;
  adimplenciaPct: number;
  inadimplenciaPct: number;
}

export function computeCarteiraStats(boletos: BoletoRow[]): CarteiraStats {
  const clientesUnicos = new Set(boletos.map((b) => b.idcliente ?? b.id));
  let pagos = 0;
  let vencidos = 0;
  let disponiveis = 0;
  let comInjecao = 0;
  let semInjecao = 0;
  let kwh = 0;
  const injecaoByCliente = new Map<number | string, boolean>();

  for (const b of boletos) {
    const status = String(b.status || "").toLowerCase();
    if (b.pagamento || status.includes("pago")) pagos++;
    else if ((b.dias_atraso ?? 0) > 0 || status.includes("vencid")) vencidos++;
    else disponiveis++;

    kwh += Number(b.kwh_compensado || 0);
    const key = b.idcliente ?? b.id;
    const prev = injecaoByCliente.get(key);
    injecaoByCliente.set(key, prev || !!b.injecao);
  }
  for (const v of injecaoByCliente.values()) v ? comInjecao++ : semInjecao++;

  const total = pagos + vencidos + disponiveis;
  return {
    totalComBoleto: clientesUnicos.size,
    pagos,
    disponiveis,
    vencidos,
    comInjecao,
    semInjecao,
    kwhCompensados: Math.round(kwh),
    adimplenciaPct: total ? Math.round((pagos / total) * 100) : 0,
    inadimplenciaPct: total ? Math.round((vencidos / total) * 100) : 0,
  };
}
