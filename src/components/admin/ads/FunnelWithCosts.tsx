import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Loader2, Filter as FilterIcon } from "lucide-react";
import { META_CAMPAIGN_PROOF_OR } from "@/lib/metaCampaignProof";

interface Props {
  consultantId: string;
  spendCents: number;
  periodDays: number;
}

interface StageRow {
  stage_key: string;
  label: string;
  position: number;
}

// Estágios que fazem parte do funil de aquisição (excluem retenção 30/60/90/120d e reprovado)
const FUNNEL_STAGE_KEYS = [
  "novo_lead",
  "qualificando",
  "valor_conta",
  "conta_enviada",
  "doc_enviado",
  "finalizando",
  "aprovado",
];

const STAGE_COLORS: Record<string, string> = {
  novo_lead: "from-slate-500 to-slate-400",
  qualificando: "from-info to-info",
  valor_conta: "from-primary to-primary",
  conta_enviada: "from-info to-info",
  doc_enviado: "from-info to-info",
  finalizando: "from-primary to-primary",
  aprovado: "from-primary to-primary",
};

/**
 * Funil visual: deals CRM com prova Meta (AD id / CTWA) + custo por etapa
 * (gasto Ads ÷ quantidade naquela etapa). Não mistura lead orgânico/indicação.
 */
export function FunnelWithCosts({ consultantId, spendCents, periodDays }: Props) {
  const [loading, setLoading] = useState(true);
  const [stages, setStages] = useState<StageRow[]>([]);
  const [countsByStage, setCountsByStage] = useState<Record<string, number>>({});

  useEffect(() => {
    (async () => {
      setLoading(true);
      const since = new Date(Date.now() - periodDays * 86_400_000).toISOString();

      const { data: stagesData } = await supabase
        .from("kanban_stages")
        .select("stage_key, label, position")
        .eq("consultant_id", consultantId)
        .in("stage_key", FUNNEL_STAGE_KEYS)
        .order("position", { ascending: true });

      const stagesList: StageRow[] =
        stagesData && stagesData.length > 0
          ? (stagesData as StageRow[])
          : FUNNEL_STAGE_KEYS.map((k, i) => ({
              stage_key: k,
              label: defaultLabel(k),
              position: i,
            }));
      setStages(stagesList);

      // Só deals cujo customer tem prova Meta (AD id / ctwa).
      const { data: provenCustomers } = await supabase
        .from("customers")
        .select("id")
        .eq("consultant_id", consultantId)
        .or(META_CAMPAIGN_PROOF_OR)
        .gte("created_at", since);

      const provenIds = (provenCustomers || []).map((c: any) => c.id as string);
      const counts: Record<string, number> = {};
      if (provenIds.length) {
        const { data: dealsData } = await supabase
          .from("crm_deals")
          .select("stage, customer_id")
          .eq("consultant_id", consultantId)
          .in("customer_id", provenIds)
          .gte("created_at", since);
        (dealsData || []).forEach((d: any) => {
          if (d.stage) counts[d.stage] = (counts[d.stage] || 0) + 1;
        });
      }
      setCountsByStage(counts);
      setLoading(false);
    })();
  }, [consultantId, periodDays]);

  const totalLeads = useMemo(
    () => Object.values(countsByStage).reduce((s, n) => s + n, 0),
    [countsByStage]
  );
  const maxCount = Math.max(1, ...Object.values(countsByStage));
  const spend = spendCents / 100;

  if (loading) {
    return (
      <Card className="p-6 flex justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-primary" />
      </Card>
    );
  }

  return (
    <Card className="p-5 sm:p-6">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div>
          <h3 className="ads-heading font-bold text-base text-foreground flex items-center gap-2">
            <FilterIcon className="w-4 h-4 text-primary" />
            Funil Meta com custos
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Só contatos com prova de anúncio (AD/CTWA). {totalLeads} no funil · últimos{" "}
            {periodDays} dias
          </p>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase text-muted-foreground">Gasto Ads no período</div>
          <div className="text-sm font-bold font-mono text-foreground">
            R$ {spend.toFixed(2)}
          </div>
        </div>
      </div>

      {totalLeads === 0 ? (
        <div className="text-center py-10 text-sm text-muted-foreground">
          Nenhum contato com prova Meta no período. Quando o AD ID / CTWA chegar junto com a
          conversa, o funil aparece aqui.
        </div>
      ) : (
        <div className="space-y-2">
          {stages.map((s) => {
            const count = countsByStage[s.stage_key] || 0;
            const pct = (count / maxCount) * 100;
            const costPerLead = count > 0 ? spend / count : 0;
            const gradient =
              STAGE_COLORS[s.stage_key] || "from-muted-foreground to-muted";

            return (
              <div key={s.stage_key} className="group">
                <div className="flex items-center gap-3">
                  <div className="w-28 sm:w-36 shrink-0">
                    <div className="text-xs font-semibold text-foreground truncate">
                      {s.label}
                    </div>
                  </div>

                  <div className="flex-1 relative h-9 bg-secondary/40 rounded-lg overflow-hidden">
                    <div
                      className={`h-full bg-gradient-to-r ${gradient} rounded-lg transition-all flex items-center px-3`}
                      style={{ width: `${Math.max(pct, count > 0 ? 8 : 0)}%` }}
                    >
                      <span className="text-xs font-bold text-white drop-shadow">
                        {count}
                      </span>
                    </div>
                  </div>

                  <div className="w-24 sm:w-28 shrink-0 text-right">
                    <div className="text-[10px] text-muted-foreground">
                      {s.stage_key === "aprovado" ? "CPA" : "custo/contato"}
                    </div>
                    <div className="text-xs font-mono font-bold text-foreground">
                      {costPerLead > 0 ? `R$ ${costPerLead.toFixed(2)}` : "—"}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-4 pt-4 border-t border-border/40 text-[11px] text-muted-foreground">
        <strong className="text-foreground">Custo/contato</strong> = gasto Ads ÷ contatos Meta
        na etapa · <strong className="text-foreground">CPA</strong> = custo por aprovado.
        Indicação e orgânico ficam de fora deste funil.
      </div>
    </Card>
  );
}

function defaultLabel(key: string): string {
  const map: Record<string, string> = {
    novo_lead: "Novo Cliente interessado",
    qualificando: "Qualificando",
    valor_conta: "Valor da Conta",
    conta_enviada: "Conta Enviada",
    doc_enviado: "Doc Enviado",
    finalizando: "Finalizando",
    aprovado: "Aprovado",
  };
  return map[key] || key;
}
