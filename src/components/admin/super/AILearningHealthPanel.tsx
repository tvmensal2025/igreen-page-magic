import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Activity, Brain, RefreshCw, Eye, Zap, Loader2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "@/components/ui/sonner";

interface CronStatus {
  key: string;
  label: string;
  icon: any;
  lastRun: Date | null;
  okWithinHours: number;
  edge: string;
  count?: number;
  detail?: string;
}

function statusColor(s: CronStatus): string {
  if (!s.lastRun) return "bg-destructive/20 text-destructive border-destructive/40";
  const ageH = (Date.now() - s.lastRun.getTime()) / 3_600_000;
  if (ageH <= s.okWithinHours) return "bg-primary/20 text-primary border-primary/40";
  if (ageH <= s.okWithinHours * 2) return "bg-warning/20 text-warning border-warning/40";
  return "bg-destructive/20 text-destructive border-destructive/40";
}

export function AILearningHealthPanel() {
  const [statuses, setStatuses] = useState<CronStatus[]>([]);
  const [winning, setWinning] = useState<{ pattern: string; weight: number }[]>([]);
  const [losing, setLosing] = useState<{ pattern: string; weight: number }[]>([]);
  const [events, setEvents] = useState<{ ts: string; emoji: string; label: string }[]>([]);
  const [running, setRunning] = useState<string | null>(null);

  async function load() {
    const [comp, ins, playbook, capi, recs] = await Promise.all([
      supabase.from("ad_competitor_creatives").select("ingested_at, image_url").order("ingested_at", { ascending: false }).limit(50),
      supabase.from("ad_creative_insights").select("updated_at, sample_size").order("updated_at", { ascending: false }).limit(20),
      supabase.from("ad_playbooks").select("payload, generated_at").eq("scope", "global").eq("source_metric", "learner_daily_aggregate").order("generated_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("facebook_capi_events").select("created_at, event_name").order("created_at", { ascending: false }).limit(50),
      supabase.from("ad_recommendations").select("created_at, title, severity").order("created_at", { ascending: false }).limit(20),
    ]);

    const compRows = comp.data || [];
    const lastScrape = compRows[0]?.ingested_at ? new Date(compRows[0].ingested_at) : null;
    const withImg = compRows.filter((r: any) => r.image_url).length;

    const insRows = ins.data || [];
    const lastLearn = insRows[0]?.updated_at ? new Date(insRows[0].updated_at) : null;

    const capiRows = capi.data || [];
    const lastCapi = capiRows[0]?.created_at ? new Date(capiRows[0].created_at) : null;

    setStatuses([
      { key: "scraper", label: "Scraper concorrentes", icon: Eye, lastRun: lastScrape, okWithinHours: 8 * 24, edge: "ad-competitor-scraper", count: compRows.length, detail: `${withImg}/${compRows.length} com imagem` },
      { key: "learner", label: "Learner de criativos", icon: Brain, lastRun: lastLearn, okWithinHours: 26, edge: "ad-creative-learner", count: insRows.length, detail: `${insRows.length} insights ativos` },
      { key: "rotator", label: "Rotator de criativos", icon: RefreshCw, lastRun: (recs.data || []).find((r: any) => /pausad|rotator/i.test(r.title))?.created_at ? new Date((recs.data || []).find((r: any) => /pausad|rotator/i.test(r.title))!.created_at) : null, okWithinHours: 14, edge: "facebook-creative-rotator", detail: "12h ciclo" },
      { key: "capi", label: "Pixel + CAPI", icon: Zap, lastRun: lastCapi, okWithinHours: 24, edge: "facebook-capi", count: capiRows.length, detail: `${capiRows.length} eventos 7d` },
    ]);

    const pl = playbook.data?.payload as any;
    setWinning(pl?.winning_patterns?.slice(0, 5) || []);
    setLosing(pl?.losing_patterns?.slice(0, 5) || []);

    const ev: { ts: string; emoji: string; label: string }[] = [];
    if (lastScrape) ev.push({ ts: lastScrape.toISOString(), emoji: "🕵️", label: `Scraper coletou ${compRows.length} anúncios concorrentes (${withImg} com imagem)` });
    if (lastLearn) ev.push({ ts: lastLearn.toISOString(), emoji: "🧠", label: `Learner consolidou ${insRows.length} insights por consultor` });
    if (playbook.data?.generated_at) ev.push({ ts: playbook.data.generated_at, emoji: "📚", label: `Playbook global atualizado` });
    (recs.data || []).slice(0, 10).forEach((r: any) => ev.push({ ts: r.created_at, emoji: r.severity === "warning" ? "⚠️" : "✅", label: r.title }));
    ev.sort((a, b) => +new Date(b.ts) - +new Date(a.ts));
    setEvents(ev.slice(0, 20));
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, []);

  async function forceRun(edge: string) {
    setRunning(edge);
    toast.loading(`Executando ${edge}...`, { id: edge });
    try {
      const { error } = await supabase.functions.invoke(edge, { body: {} });
      if (error) throw error;
      toast.success(`${edge} concluído`, { id: edge });
      await load();
    } catch (e: any) {
      toast.error(`Falha em ${edge}`, { id: edge, description: e.message });
    } finally {
      setRunning(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {statuses.map((s) => {
          const Icon = s.icon;
          return (
            <Card key={s.key} className="p-4 bg-card/50 backdrop-blur border-border/60">
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Icon className="w-4 h-4 text-primary" />
                  <span className="font-semibold text-sm text-foreground">{s.label}</span>
                </div>
                <Badge className={statusColor(s)} variant="outline">●</Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                {s.lastRun ? `há ${formatDistanceToNow(s.lastRun, { locale: ptBR })}` : "nunca executou"}
              </p>
              {s.detail && <p className="text-[11px] text-muted-foreground mt-1">{s.detail}</p>}
              <Button size="sm" variant="outline" className="w-full mt-3 h-7 text-xs"
                disabled={running === s.edge}
                onClick={() => forceRun(s.edge)}>
                {running === s.edge ? <Loader2 className="w-3 h-3 animate-spin" /> : "Forçar agora"}
              </Button>
            </Card>
          );
        })}
      </div>

      <div className="grid lg:grid-cols-2 gap-3">
        <Card className="p-4 bg-card/50 backdrop-blur border-border/60">
          <h3 className="font-bold text-sm text-foreground mb-3 flex items-center gap-2">
            <Brain className="w-4 h-4 text-primary" /> Top 5 padrões VENCEDORES (rede)
          </h3>
          {winning.length === 0 ? (
            <p className="text-xs text-muted-foreground">Coletando — learner ainda não rodou pós-deploy.</p>
          ) : (
            <ul className="space-y-1.5">
              {winning.map((w, i) => (
                <li key={i} className="flex items-center justify-between text-xs">
                  <span className="text-foreground truncate flex-1 mr-2">{w.pattern}</span>
                  <Badge variant="outline" className="text-[10px]">peso {w.weight}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="p-4 bg-card/50 backdrop-blur border-border/60">
          <h3 className="font-bold text-sm text-foreground mb-3 flex items-center gap-2">
            <Brain className="w-4 h-4 text-destructive" /> Top 5 padrões a EVITAR (rede)
          </h3>
          {losing.length === 0 ? (
            <p className="text-xs text-muted-foreground">Coletando.</p>
          ) : (
            <ul className="space-y-1.5">
              {losing.map((w, i) => (
                <li key={i} className="flex items-center justify-between text-xs">
                  <span className="text-foreground truncate flex-1 mr-2">{w.pattern}</span>
                  <Badge variant="outline" className="text-[10px]">peso {w.weight}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="p-4 bg-card/50 backdrop-blur border-border/60">
        <h3 className="font-bold text-sm text-foreground flex items-center gap-2 mb-3">
          <Activity className="w-4 h-4 text-primary" /> Timeline de aprendizado
        </h3>
        {events.length === 0 ? (
          <p className="text-xs text-muted-foreground">Sem eventos ainda.</p>
        ) : (
          <div className="space-y-1.5 max-h-[400px] overflow-y-auto">
            {events.map((e, i) => (
              <div key={i} className="flex items-start gap-2 p-2 rounded-md bg-secondary/30 border border-border/30">
                <span className="text-base leading-tight">{e.emoji}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-foreground">{e.label}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {formatDistanceToNow(new Date(e.ts), { locale: ptBR, addSuffix: true })}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
