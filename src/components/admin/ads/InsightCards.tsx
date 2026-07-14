import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Lightbulb, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface Recommendation {
  id: string;
  type: string;
  title: string;
  message: string;
  severity: string;
  action_label: string | null;
  action_payload: any;
}

export function InsightCards({ consultantId }: { consultantId: string }) {
  const { toast } = useToast();
  const [recs, setRecs] = useState<Recommendation[]>([]);

  async function load() {
    const { data } = await supabase
      .from("ad_recommendations")
      .select("id,type,title,message,severity,action_label,action_payload")
      .eq("consultant_id", consultantId)
      .is("dismissed_at", null)
      .is("applied_at", null)
      .order("created_at", { ascending: false })
      .limit(3);
    setRecs((data || []) as Recommendation[]);
  }

  useEffect(() => { load(); }, [consultantId]);

  async function dismiss(id: string) {
    await supabase.from("ad_recommendations").update({ dismissed_at: new Date().toISOString() }).eq("id", id);
    setRecs(p => p.filter(r => r.id !== id));
  }

  if (recs.length === 0) return null;

  const tone = (s: string) => ({
    success: "border-primary/40 bg-primary/5",
    warning: "border-warning/40 bg-warning/5",
    info: "border-border bg-secondary/30",
  }[s] || "border-border bg-secondary/30");

  return (
    <div className="space-y-2">
      {recs.map(r => (
        <Card key={r.id} className={`p-3 border ${tone(r.severity)}`}>
          <div className="flex items-start gap-3">
            <Lightbulb className="w-4 h-4 mt-0.5 text-primary shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-foreground">{r.title}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{r.message}</div>
              {r.action_label && (
                <div className="text-[11px] text-muted-foreground mt-2">
                  Sugestão: {r.action_label}
                </div>
              )}
            </div>
            <button onClick={() => dismiss(r.id)} className="text-muted-foreground hover:text-foreground">
              <X className="w-4 h-4" />
            </button>
          </div>
        </Card>
      ))}
    </div>
  );
}
