import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type TeamCustomer = {
  id: string;
  name: string | null;
  status: string | null;
  media_consumo: number | null;
  created_at: string;
  registered_by_igreen_id: number | string | null;
  registered_by_name: string | null;
  customer_origin: string | null;
  address_state: string | null;
  address_city: string | null;
  phone_whatsapp: string | null;
};

export type LicenciadoBucket = {
  igreenId: string | null;
  name: string;
  count: number;
  approved: number;
  totalKwh: number;
  graduacao: string | null;
  uf: string | null;
  cidade: string | null;
};

export type NetworkRow = {
  codigo_igreen: string | null;
  nome: string | null;
  graduacao: string | null;
  cidade: string | null;
  uf: string | null;
  nivel: number | null;
};

export type UseTeamRegistrationsResult = {
  totals: {
    cadastros: number;
    licenciadosAtivos: number;
    aprovados: number;
    kwh: number;
    delta: {
      cadastros: number; // ratio -1..+inf vs período anterior
    };
  };
  porLicenciado: LicenciadoBucket[];
  porDia: Array<{ date: string; label: string; total: number; perTop: Record<string, number> }>;
  topLicenciadoIds: string[];
  porStatus: Array<{ status: string; label: string; count: number }>;
  porOrigem: Array<{ origem: string; count: number }>;
  porUF: Array<{ uf: string; count: number }>;
  customers: TeamCustomer[]; // dentro do período
  networkByCodigo: Map<string, NetworkRow>;
};

const STATUS_LABELS: Record<string, string> = {
  approved: "Aprovado",
  pending: "Pendente",
  rejected: "Reprovado",
  lead: "Lead",
  devolutiva: "Devolutiva",
  awaiting_signature: "Falta assinatura",
  data_complete: "Dados completos",
  registered_igreen: "Cadastrado iGreen",
  contract_sent: "Contrato enviado",
};

function bucketKey(c: TeamCustomer): string {
  const id = c.registered_by_igreen_id;
  if (id !== null && id !== undefined && String(id).trim() !== "") return `id:${String(id)}`;
  if (c.registered_by_name) return `name:${c.registered_by_name.trim().toLowerCase()}`;
  return "unknown";
}

export function useTeamRegistrations(
  leaderConsultantId: string | null | undefined,
  allCustomers: TeamCustomer[] | undefined,
  periodDays: number,
): UseTeamRegistrationsResult | null {
  const { data: network } = useQuery({
    queryKey: ["consultant-network", leaderConsultantId],
    enabled: !!leaderConsultantId,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<NetworkRow[]> => {
      const { data, error } = await supabase
        .from("consultant_network")
        .select("codigo_igreen, nome, graduacao, cidade, uf, nivel")
        .eq("consultant_id", leaderConsultantId!);
      if (error) throw error;
      return (data as NetworkRow[]) ?? [];
    },
  });

  return useMemo(() => {
    if (!allCustomers) return null;

    const now = Date.now();
    const periodStart = now - periodDays * 86400_000;
    const prevStart = now - 2 * periodDays * 86400_000;

    const inPeriod = allCustomers.filter((c) => {
      const t = new Date(c.created_at).getTime();
      return t >= periodStart && t <= now;
    });
    const inPrev = allCustomers.filter((c) => {
      const t = new Date(c.created_at).getTime();
      return t >= prevStart && t < periodStart;
    });

    // Network index by código iGreen (string)
    const networkByCodigo = new Map<string, NetworkRow>();
    (network ?? []).forEach((n) => {
      if (n.codigo_igreen) networkByCodigo.set(String(n.codigo_igreen), n);
    });

    // Buckets por licenciado
    const bucketMap = new Map<string, LicenciadoBucket>();
    for (const c of inPeriod) {
      const key = bucketKey(c);
      const igreenId = c.registered_by_igreen_id ? String(c.registered_by_igreen_id) : null;
      const netRow = igreenId ? networkByCodigo.get(igreenId) : null;
      const displayName =
        netRow?.nome ||
        c.registered_by_name ||
        (igreenId ? `Licenciado ${igreenId}` : "Sem licenciado");
      const existing = bucketMap.get(key);
      if (existing) {
        existing.count += 1;
        if (c.status === "approved") existing.approved += 1;
        existing.totalKwh += Number(c.media_consumo) || 0;
      } else {
        bucketMap.set(key, {
          igreenId,
          name: displayName,
          count: 1,
          approved: c.status === "approved" ? 1 : 0,
          totalKwh: Number(c.media_consumo) || 0,
          graduacao: netRow?.graduacao ?? null,
          uf: netRow?.uf ?? null,
          cidade: netRow?.cidade ?? null,
        });
      }
    }
    const porLicenciado = Array.from(bucketMap.values()).sort((a, b) => b.count - a.count);
    const topLicenciadoIds = porLicenciado.slice(0, 5).map((b) => b.name);

    // Série temporal por dia
    const dayMap = new Map<string, { total: number; perTop: Record<string, number> }>();
    for (let i = periodDays - 1; i >= 0; i--) {
      const d = new Date(now - i * 86400_000);
      const key = d.toISOString().slice(0, 10);
      dayMap.set(key, { total: 0, perTop: {} });
    }
    for (const c of inPeriod) {
      const key = new Date(c.created_at).toISOString().slice(0, 10);
      const bucket = dayMap.get(key);
      if (!bucket) continue;
      bucket.total += 1;
      const licKey = bucketKey(c);
      const b = bucketMap.get(licKey);
      const name = b?.name ?? "Outros";
      const label = topLicenciadoIds.includes(name) ? name : "Outros";
      bucket.perTop[label] = (bucket.perTop[label] ?? 0) + 1;
    }
    const porDia = Array.from(dayMap.entries()).map(([date, v]) => {
      const d = new Date(date + "T00:00:00");
      return {
        date,
        label: d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }),
        total: v.total,
        perTop: v.perTop,
      };
    });

    // Status
    const statusMap = new Map<string, number>();
    for (const c of inPeriod) {
      const s = c.status ?? "pending";
      statusMap.set(s, (statusMap.get(s) ?? 0) + 1);
    }
    const porStatus = Array.from(statusMap.entries())
      .map(([status, count]) => ({
        status,
        label: STATUS_LABELS[status] ?? status,
        count,
      }))
      .sort((a, b) => b.count - a.count);

    // Origem
    const origMap = new Map<string, number>();
    for (const c of inPeriod) {
      const raw = (c.customer_origin || "").toLowerCase();
      let bucket = "Outros";
      if (raw.includes("whatsapp")) bucket = "WhatsApp";
      else if (raw.includes("igreen") || raw.includes("carteira")) bucket = "Carteira iGreen";
      else if (raw.includes("meta") || raw.includes("facebook") || raw.includes("ctwa")) bucket = "Meta Ads";
      else if (raw.includes("landing")) bucket = "Landing";
      origMap.set(bucket, (origMap.get(bucket) ?? 0) + 1);
    }
    const porOrigem = Array.from(origMap.entries())
      .map(([origem, count]) => ({ origem, count }))
      .sort((a, b) => b.count - a.count);

    // UF
    const ufMap = new Map<string, number>();
    for (const c of inPeriod) {
      const uf = (c.address_state || "").toUpperCase().slice(0, 2) || "??";
      ufMap.set(uf, (ufMap.get(uf) ?? 0) + 1);
    }
    const porUF = Array.from(ufMap.entries())
      .map(([uf, count]) => ({ uf, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

    // Totais
    const cadastros = inPeriod.length;
    const licenciadosAtivos = porLicenciado.length;
    const aprovados = inPeriod.filter((c) => c.status === "approved").length;
    const kwh = inPeriod.reduce((s, c) => s + (Number(c.media_consumo) || 0), 0);
    const prevCount = inPrev.length;
    const delta = { cadastros: prevCount === 0 ? (cadastros > 0 ? 1 : 0) : (cadastros - prevCount) / prevCount };

    return {
      totals: { cadastros, licenciadosAtivos, aprovados, kwh, delta },
      porLicenciado,
      porDia,
      topLicenciadoIds,
      porStatus,
      porOrigem,
      porUF,
      customers: inPeriod,
      networkByCodigo,
    };
  }, [allCustomers, network, periodDays]);
}
