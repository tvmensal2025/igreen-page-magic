// =============================================================================
// Cross-sell iGreen — oportunidades manuais (sem disparo automático)
// =============================================================================
// Lista clientes de energia (customers) do consultor que NÃO aparecem na
// carteira Telecom nem Seguros (via `igreen_telecom_customers` / `igreen_seguros_customers`).
// O consultor decide se envia — nada é disparado automático.
// =============================================================================

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Smartphone, ShieldCheck, MessageCircle, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTelecomCustomers, useSegurosCustomers } from "./multiprodutoHooks";

interface EnergyLead {
  id: string;
  full_name: string | null;
  phone: string | null;
  city: string | null;
  state: string | null;
}

function useEnergyCustomers(consultantId?: string) {
  return useQuery({
    queryKey: ["cross-sell-energy", consultantId],
    enabled: !!consultantId,
    queryFn: async (): Promise<EnergyLead[]> => {
      const { data, error } = await supabase
        .from("customers")
        .select("id, full_name, phone, city, state, sale_stage")
        .eq("consultant_id", consultantId!)
        .in("sale_stage", ["aprovado", "d30_pos_venda", "d60_pos_venda", "d90_pos_venda", "d120_pos_venda"])
        .not("phone", "is", null)
        .limit(500);
      if (error) throw error;
      return (data || []) as EnergyLead[];
    },
    staleTime: 60_000,
  });
}

function normPhone(p?: string | null): string {
  return String(p || "").replace(/\D/g, "");
}

function normName(n?: string | null): string {
  return String(n || "").toLowerCase().trim();
}

export function CrossSellCard({ consultantId }: { consultantId?: string }) {
  const { data: energy = [], isLoading: loadingE } = useEnergyCustomers(consultantId);
  const { data: telecom = [] } = useTelecomCustomers(consultantId);
  const { data: seguros = [] } = useSegurosCustomers(consultantId);
  const [copied, setCopied] = useState<string | null>(null);

  // Cross-check: quem já tem telecom ou seguros (por nome, best-effort).
  const telecomNames = useMemo(() => new Set(telecom.map((t) => normName(t.nome))), [telecom]);
  const segurosNames = useMemo(() => new Set(seguros.map((s) => normName(s.segurado))), [seguros]);

  const opportunities = useMemo(() => {
    return energy
      .map((c) => {
        const key = normName(c.full_name);
        const hasTelecom = key && telecomNames.has(key);
        const hasSeguro = key && segurosNames.has(key);
        return { lead: c, hasTelecom, hasSeguro };
      })
      .filter((o) => !o.hasTelecom || !o.hasSeguro)
      .slice(0, 30);
  }, [energy, telecomNames, segurosNames]);

  if (loadingE) return null;
  if (opportunities.length === 0) return null;

  const copy = (phone: string) => {
    navigator.clipboard.writeText(phone).catch(() => {});
    setCopied(phone);
    setTimeout(() => setCopied(null), 1500);
  };

  const waLink = (phone: string, name?: string | null) => {
    const digits = normPhone(phone);
    const first = (name || "").split(" ")[0];
    const text = encodeURIComponent(
      `Oi${first ? " " + first : ""}! Além da economia de energia, temos também Telecom e Seguros com valores exclusivos para clientes iGreen. Quer que eu te mostre?`,
    );
    return `https://wa.me/${digits}?text=${text}`;
  };

  return (
    <div className="rounded-2xl border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="font-semibold text-sm">Oportunidades de venda cruzada</h3>
        <span className="text-[10px] text-muted-foreground">{opportunities.length} cliente(s) sem Telecom/Seguros</span>
      </div>
      <p className="text-xs text-muted-foreground">
        Clientes de energia que ainda não têm Telecom ou Seguros na sua carteira. Você decide se envia — nada é
        disparado automático.
      </p>
      <ul className="divide-y divide-border/60 rounded-xl border overflow-hidden">
        {opportunities.map(({ lead, hasTelecom, hasSeguro }) => (
          <li key={lead.id} className="flex items-center justify-between gap-3 px-3 py-2 bg-background hover:bg-muted/30">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium truncate">{lead.full_name || "Sem nome"}</p>
              <p className="text-[11px] text-muted-foreground truncate">
                {lead.phone} · {lead.city || "?"}/{lead.state || "?"}
              </p>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {!hasTelecom && (
                <span title="Sem Telecom" className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary px-2 py-0.5 text-[10px]">
                  <Smartphone className="h-3 w-3" /> Telecom
                </span>
              )}
              {!hasSeguro && (
                <span title="Sem Seguros" className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary px-2 py-0.5 text-[10px]">
                  <ShieldCheck className="h-3 w-3" /> Seguros
                </span>
              )}
              <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => copy(lead.phone || "")} title="Copiar número">
                {copied === lead.phone ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              </Button>
              <a
                href={waLink(lead.phone || "", lead.full_name)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded-md bg-primary text-primary-foreground px-2 py-1 text-[11px] font-medium"
                title="Abrir WhatsApp com sugestão"
              >
                <MessageCircle className="h-3.5 w-3.5" /> Enviar
              </a>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
