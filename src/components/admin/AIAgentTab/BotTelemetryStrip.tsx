import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { GitBranch, CheckCircle2, XCircle, ArrowRightLeft } from "lucide-react";

type Counts = {
  requested: number;
  confirmed: number;
  rejected: number;
};

export function BotTelemetryStrip({ userId }: { userId: string }) {
  const [counts, setCounts] = useState<Counts>({ requested: 0, confirmed: 0, rejected: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
      const reasons = ["flow_switch_requested", "flow_switch_confirmed", "flow_switch_rejected"];
      const { data, error } = await supabase
        .from("bot_handoff_alerts")
        .select("reason")
        .eq("consultant_id", userId)
        .in("reason", reasons)
        .gte("created_at", since);
      if (!alive) return;
      if (!error && data) {
        const c: Counts = { requested: 0, confirmed: 0, rejected: 0 };
        for (const r of data as any[]) {
          if (r.reason === "flow_switch_requested") c.requested++;
          else if (r.reason === "flow_switch_confirmed") c.confirmed++;
          else if (r.reason === "flow_switch_rejected") c.rejected++;
        }
        setCounts(c);
      }
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [userId]);

  if (loading || (counts.requested + counts.confirmed + counts.rejected === 0)) return null;

  const items = [
    { label: "Trocas pedidas", value: counts.requested, icon: ArrowRightLeft, color: "text-warning" },
    { label: "Confirmadas", value: counts.confirmed, icon: CheckCircle2, color: "text-primary" },
    { label: "Recusadas", value: counts.rejected, icon: XCircle, color: "text-muted-foreground" },
  ];

  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-card/50">
      <GitBranch className="w-3.5 h-3.5 text-primary" />
      <span className="text-xs text-muted-foreground mr-2">Trocas de fluxo (7d):</span>
      {items.map((it) => {
        const Icon = it.icon;
        return (
          <div key={it.label} className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-muted/50">
            <Icon className={`w-3 h-3 ${it.color}`} />
            <span className="text-xs font-semibold text-foreground">{it.value}</span>
            <span className="text-[10px] text-muted-foreground">{it.label}</span>
          </div>
        );
      })}
    </div>
  );
}
