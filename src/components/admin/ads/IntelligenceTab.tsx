import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Activity, Calendar, Brain, MessageSquare, Sparkles } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CompetitorsPanel } from "./CompetitorsPanel";
import { InsightsPanel } from "./InsightsPanel";
import { AutoLearningTab } from "../ai/AutoLearningTab";
import { CampaignBrainPanel } from "./CampaignBrainPanel";

interface Props {
  consultantId: string;
  onUseCreativeInAd?: (creative: { image_url: string; format: string; headline: string; badge: string }) => void;
}

interface Event { ts: string; label: string; emoji: string }

type IntelView = "campaigns" | "ads" | "conversation";

export function IntelligenceTab({ consultantId }: Props) {
  const [events, setEvents] = useState<Event[]>([]);
  const [intelView, setIntelView] = useState<IntelView>("campaigns");

  useEffect(() => {
    (async () => {
      const [comp, ins] = await Promise.all([
        supabase.from("ad_competitor_creatives").select("ingested_at, advertiser").order("ingested_at", { ascending: false }).limit(20),
        supabase.from("ad_creative_insights").select("updated_at, sample_size").eq("consultant_id", consultantId).order("updated_at", { ascending: false }).limit(5),
      ]);

      const ev: Event[] = [];

      const scrapeBuckets = new Map<string, number>();
      (comp.data || []).forEach((c: any) => {
        const key = c.ingested_at?.slice(0, 16) || "";
        scrapeBuckets.set(key, (scrapeBuckets.get(key) || 0) + 1);
      });
      Array.from(scrapeBuckets.entries()).slice(0, 5).forEach(([ts, n]) => {
        ev.push({ ts: ts + ":00Z", emoji: "🕵️", label: `Scraper de concorrentes — ${n} anúncios coletados` });
      });

      (ins.data || []).forEach((i: any) => {
        ev.push({ ts: i.updated_at, emoji: "🧠", label: `Análise da IA executada — ${i.sample_size} anúncios avaliados` });
      });

      ev.sort((a, b) => +new Date(b.ts) - +new Date(a.ts));
      setEvents(ev.slice(0, 15));
    })();
  }, [consultantId]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1 rounded-lg bg-secondary p-1 w-full sm:w-fit flex-wrap">
        <Button
          size="sm"
          variant={intelView === "campaigns" ? "default" : "ghost"}
          onClick={() => setIntelView("campaigns")}
          className="h-8 gap-1.5"
        >
          <Brain className="w-3.5 h-3.5" />
          Cérebro
        </Button>
        <Button
          size="sm"
          variant={intelView === "ads" ? "default" : "ghost"}
          onClick={() => setIntelView("ads")}
          className="h-8 gap-1.5"
        >
          <Sparkles className="w-3.5 h-3.5" />
          Criativos
        </Button>
        <Button
          size="sm"
          variant={intelView === "conversation" ? "default" : "ghost"}
          onClick={() => setIntelView("conversation")}
          className="h-8 gap-1.5"
        >
          <MessageSquare className="w-3.5 h-3.5" />
          Conversa
        </Button>
      </div>

      {intelView === "campaigns" && (
        <CampaignBrainPanel consultantId={consultantId} />
      )}

      {intelView === "ads" && (
        <>
          <div className="grid lg:grid-cols-2 gap-4">
            <InsightsPanel consultantId={consultantId} />
            <Card className="p-5 bg-card/50 backdrop-blur border-border/60">
              <h3 className="font-bold text-foreground flex items-center gap-2 mb-3">
                <Activity className="w-5 h-5 text-primary" />
                Timeline de atualizações
              </h3>
              <p className="text-xs text-muted-foreground mb-3">
                Últimas execuções registradas. A lista não presume uma agenda automática.
              </p>
              {events.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">Sem eventos ainda.</p>
              ) : (
                <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
                  {events.map((e, i) => (
                    <div key={i} className="flex items-start gap-2 p-2 rounded-md bg-secondary/30 border border-border/30">
                      <span className="text-base leading-tight">{e.emoji}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-foreground">{e.label}</p>
                        <p className="text-[10px] text-muted-foreground flex items-center gap-1 mt-0.5">
                          <Calendar className="w-2.5 h-2.5" />
                          {formatDistanceToNow(new Date(e.ts), { locale: ptBR, addSuffix: true })}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
          <CompetitorsPanel />
        </>
      )}

      {intelView === "conversation" && (
        <AutoLearningTab consultantId={consultantId} />
      )}
    </div>
  );
}
