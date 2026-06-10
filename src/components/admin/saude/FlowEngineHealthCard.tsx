// FlowEngineHealthCard — Phase F Task 34 do whatsapp-flow-architecture-v3.
// Consome `v_flow_engine_health` e mostra saúde do motor v3 por consultor.
//
// Plugável ao lado do AIBrainPanel em /admin/saude-bot. Não substitui
// nenhum componente existente.

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Activity, CheckCircle2, AlertTriangle, UserMinus } from "lucide-react";

type HealthRow = {
  consultant_id: string;
  turns_last_hour: number;
  paused_manual: number;
  paused_system: number;
  converted_today: number;
  lost_today: number;
  active: number;
  conversion_rate_24h_pct: number | null;
  last_activity_at: string | null;
};

export default function FlowEngineHealthCard({ consultantId }: { consultantId: string }) {
  const [row, setRow] = useState<HealthRow | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancel = false;
    (async () => {
      setLoading(true);
      const { data, error } = await (supabase as unknown as {
        from: (t: string) => {
          select: (s: string) => {
            eq: (k: string, v: string) => {
              maybeSingle: () => Promise<{ data: HealthRow | null; error: unknown }>;
            };
          };
        };
      })
        .from("v_flow_engine_health")
        .select("*")
        .eq("consultant_id", consultantId)
        .maybeSingle();
      if (!cancel) {
        if (!error && data) setRow(data as HealthRow);
        setLoading(false);
      }
    })();
    return () => { cancel = true; };
  }, [consultantId]);

  if (loading) {
    return (
      <Card className="p-4">
        <div className="text-sm text-muted-foreground">Carregando saúde do motor…</div>
      </Card>
    );
  }

  if (!row) {
    return (
      <Card className="p-4">
        <div className="flex items-center gap-2 mb-2">
          <Activity className="w-4 h-4 text-muted-foreground" />
          <h3 className="font-medium">Motor de Fluxo v3</h3>
        </div>
        <div className="text-sm text-muted-foreground">
          Sem atividade nos últimos 7 dias.
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-primary" />
          <h3 className="font-medium">Motor de Fluxo v3</h3>
        </div>
        {row.last_activity_at && (
          <span className="text-xs text-muted-foreground">
            última: {new Date(row.last_activity_at).toLocaleString("pt-BR")}
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Turnos/h" value={row.turns_last_hour} />
        <Stat label="Ativos" value={row.active} />
        <Stat
          label="Conversão 24h"
          value={row.conversion_rate_24h_pct != null ? `${row.conversion_rate_24h_pct}%` : "—"}
          icon={<CheckCircle2 className="w-3 h-3 text-primary" />}
        />
        <Stat
          label="Convertidos hoje"
          value={row.converted_today}
          icon={<CheckCircle2 className="w-3 h-3 text-primary" />}
        />
        <Stat
          label="Pausados (humano)"
          value={row.paused_manual}
          icon={<UserMinus className="w-3 h-3 text-info" />}
        />
        <Stat
          label="Pausados (sistema)"
          value={row.paused_system}
          icon={<AlertTriangle className="w-3 h-3 text-warning" />}
        />
        <Stat label="Perdidos hoje" value={row.lost_today} />
      </div>
    </Card>
  );
}

function Stat({ label, value, icon }: { label: string; value: number | string; icon?: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <div className="font-semibold text-lg">{value}</div>
    </div>
  );
}
