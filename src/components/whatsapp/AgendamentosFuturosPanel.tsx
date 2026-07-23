import { useMemo, useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  CalendarClock,
  Clock,
  Flame,
  Loader2,
  Megaphone,
  MessageSquare,
  Phone,
  Smartphone,
  Sparkles,
  Layers,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CADENCE_GROUP_BADGE } from "@/lib/cadenceStageLabels";
import {
  groupTimelineByDay,
  type AgendamentoChannel,
  type AgendamentoTimelineItem,
  type AgendamentoTimelineKind,
  type AgendamentoPizzaGroup,
} from "@/lib/agendamentosHub";
import type { UseAgendamentosHubReturn } from "@/hooks/useAgendamentosHub";
import { cn } from "@/lib/utils";

type ChannelFilter = "all" | AgendamentoChannel;
type PizzaFilter = "all" | "A" | "B" | "C";
type MotorFilter = "all" | AgendamentoTimelineKind;

type Props = {
  loading: boolean;
  timeline: AgendamentoTimelineItem[];
  stats: UseAgendamentosHubReturn["stats"];
  onSelectItem: (item: AgendamentoTimelineItem) => void;
};

function channelIcon(channel: AgendamentoChannel, className = "w-3.5 h-3.5") {
  switch (channel) {
    case "sms":
      return <Smartphone className={cn(className, "text-info")} />;
    case "voice":
      return <Phone className={cn(className, "text-warning")} />;
    case "meta":
      return <Megaphone className={cn(className, "text-muted-foreground")} />;
    case "sofia":
      return <Sparkles className={cn(className, "text-primary")} />;
    case "mixed":
      return <Layers className={cn(className, "text-primary")} />;
    default:
      return <MessageSquare className={cn(className, "text-primary")} />;
  }
}

function kindIcon(kind: AgendamentoTimelineKind) {
  switch (kind) {
    case "pos_venda_auto":
      return <Sparkles className="w-3.5 h-3.5 text-primary" />;
    case "bot_followup":
      return <Flame className="w-3.5 h-3.5 text-info" />;
    case "bulk_campaign":
      return <Megaphone className="w-3.5 h-3.5 text-warning" />;
    case "voice_campaign":
    case "voice_retry":
      return <Phone className="w-3.5 h-3.5 text-info" />;
    case "cadence_send":
    case "daily_reheat":
      return <Flame className="w-3.5 h-3.5 text-primary" />;
    case "pending_media":
      return <MessageSquare className="w-3.5 h-3.5 text-primary" />;
    default:
      return <Clock className="w-3.5 h-3.5 text-primary" />;
  }
}

function statusBadge(status: AgendamentoTimelineItem["status"]) {
  switch (status) {
    case "overdue":
      return <Badge variant="outline" className="text-[9px] border-warning/40 text-warning">Vai sair agora</Badge>;
    case "running":
      return <Badge variant="outline" className="text-[9px] border-primary/40 text-primary">Enviando</Badge>;
    default:
      return <Badge variant="outline" className="text-[9px] border-muted-foreground/30 text-muted-foreground">Agendado</Badge>;
  }
}

function channelLabel(ch: AgendamentoChannel): string {
  switch (ch) {
    case "whatsapp":
      return "WhatsApp";
    case "sms":
      return "SMS";
    case "voice":
      return "Ligação";
    case "meta":
      return "Meta";
    case "sofia":
      return "Sofia";
    case "mixed":
      return "Multi";
  }
}

function pizzaBadge(g: AgendamentoPizzaGroup) {
  if (!g) return null;
  const label = CADENCE_GROUP_BADGE[g] || g;
  const tone =
    g === "A"
      ? "border-primary/40 bg-primary/10 text-primary"
      : g === "B"
        ? "border-warning/40 bg-warning/10 text-warning"
        : "border-info/40 bg-info/10 text-info";
  return (
    <span className={cn("text-[9px] font-semibold px-1.5 py-0.5 rounded-md border", tone)}>
      {g} · {label}
    </span>
  );
}

export function AgendamentosFuturosPanel({ loading, timeline, stats, onSelectItem }: Props) {
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>("all");
  const [pizzaFilter, setPizzaFilter] = useState<PizzaFilter>("all");
  const [motorFilter, setMotorFilter] = useState<MotorFilter>("all");

  const filtered = useMemo(() => {
    return timeline.filter((i) => {
      if (channelFilter !== "all") {
        if (channelFilter === "mixed") {
          if (i.channel !== "mixed") return false;
        } else if (i.channel !== channelFilter && i.channel !== "mixed") {
          return false;
        }
      }
      if (pizzaFilter !== "all" && i.pizzaGroup !== pizzaFilter) return false;
      if (motorFilter !== "all" && i.kind !== motorFilter) return false;
      return true;
    });
  }, [timeline, channelFilter, pizzaFilter, motorFilter]);

  const groups = useMemo(() => groupTimelineByDay(filtered), [filtered]);

  const channelChips: Array<{ id: ChannelFilter; label: string }> = [
    { id: "all", label: "Todos canais" },
    { id: "whatsapp", label: "WhatsApp" },
    { id: "sms", label: "SMS" },
    { id: "voice", label: "Ligação" },
  ];

  const pizzaChips: Array<{ id: PizzaFilter; label: string }> = [
    { id: "all", label: "Pizza" },
    { id: "A", label: "A" },
    { id: "B", label: "B" },
    { id: "C", label: "C" },
  ];

  const motorChips: Array<{ id: MotorFilter; label: string }> = [
    { id: "all", label: "Todos motores" },
    { id: "cadence_send", label: "Motor A→B→C" },
    { id: "daily_reheat", label: "Reheat" },
    { id: "manual_scheduled", label: "Manual" },
    { id: "pos_venda_auto", label: "Pós-venda" },
    { id: "bot_followup", label: "Follow-up" },
    { id: "bulk_campaign", label: "Campanha WA" },
    { id: "voice_campaign", label: "Campanha voz" },
    { id: "voice_retry", label: "Retry voz" },
    { id: "pending_media", label: "Mídia bot" },
  ];

  const kpis = [
    { label: "Na fila", value: stats.timelineUpcoming, tone: "text-foreground" },
    { label: "Atrasados", value: stats.overdue, tone: "text-warning" },
    { label: "WhatsApp", value: stats.byChannel.whatsapp, tone: "text-primary" },
    { label: "SMS", value: stats.byChannel.sms, tone: "text-info" },
    { label: "Ligações", value: stats.byChannel.voice, tone: "text-warning" },
    { label: "Pizza A", value: stats.byPizza.A, tone: "text-primary" },
    { label: "Pizza B", value: stats.byPizza.B, tone: "text-warning" },
    { label: "Pizza C", value: stats.byPizza.C, tone: "text-info" },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h3 className="font-[Sora,ui-sans-serif] font-semibold text-lg text-foreground flex items-center gap-2">
          <CalendarClock className="w-5 h-5 text-primary" />
          Futuros
        </h3>
        <p className="text-[12px] text-muted-foreground mt-1 max-w-2xl">
          Só o que ainda vai sair — WhatsApp, SMS e ligação — sincronizado com a pizza e os motores.
          O que já foi enviado ou atendido fica no Histórico.
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
        {kpis.map((k) => (
          <div
            key={k.label}
            className="rounded-xl border border-border/50 bg-card/60 px-3 py-2.5 text-center"
          >
            <div className={cn("font-[Sora,ui-sans-serif] font-bold text-xl tabular-nums", k.tone)}>
              {k.value}
            </div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-0.5">
              {k.label}
            </div>
          </div>
        ))}
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap gap-1.5">
          {channelChips.map((c) => (
            <FilterChip
              key={c.id}
              active={channelFilter === c.id}
              label={c.label}
              onClick={() => setChannelFilter(c.id)}
            />
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {pizzaChips.map((c) => (
            <FilterChip
              key={c.id}
              active={pizzaFilter === c.id}
              label={c.label}
              onClick={() => setPizzaFilter(c.id)}
            />
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {motorChips.map((c) => (
            <FilterChip
              key={c.id}
              active={motorFilter === c.id}
              label={c.label}
              onClick={() => setMotorFilter(c.id)}
            />
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-sm text-muted-foreground gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Carregando fila…
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border/60 bg-muted/10 px-6 py-14 text-center flex flex-col items-center gap-3">
          <div className="w-14 h-14 rounded-2xl bg-muted/40 flex items-center justify-center">
            <CalendarClock className="w-7 h-7 text-muted-foreground/50" />
          </div>
          <div>
            <p className="text-sm font-[Sora,ui-sans-serif] font-semibold text-foreground">
              Nada na fila com esses filtros
            </p>
            <p className="text-[11.5px] text-muted-foreground mt-1 max-w-sm mx-auto">
              Assim que o motor, o reheat ou a agenda programarem um envio, ele aparece aqui com horário e canal.
            </p>
          </div>
        </div>
      ) : (
        <ScrollArea className="max-h-[min(70vh,720px)] pr-1">
          <div className="space-y-6">
            {groups.map((g) => (
              <section key={g.key}>
                <div className="flex items-baseline gap-2 mb-2 sticky top-0 bg-card/95 backdrop-blur-sm py-1 z-10">
                  <h4 className="font-[Sora,ui-sans-serif] font-semibold text-sm text-foreground">
                    {g.label}
                  </h4>
                  <span className="text-[11px] text-muted-foreground tabular-nums">
                    {g.items.length}
                  </span>
                </div>
                <div className="relative space-y-1.5">
                  <div className="absolute left-[46px] top-2 bottom-2 w-px bg-gradient-to-b from-border/60 via-border/40 to-transparent" />
                  {g.items.slice(0, 200).map((item) => {
                    const d = item.at;
                    const pad = (n: number) => String(n).padStart(2, "0");
                    const dayLabel = format(d, "dd MMM", { locale: ptBR });
                    const timeLabel = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => onSelectItem(item)}
                        className="group relative w-full text-left rounded-xl border border-transparent hover:border-border/60 hover:bg-secondary/15 px-3 py-2.5 transition-colors flex items-start gap-3"
                      >
                        <div className="w-[52px] shrink-0 text-right leading-tight pt-0.5">
                          <div className="font-[Sora,ui-sans-serif] font-semibold text-xs text-foreground tabular-nums">
                            {timeLabel}
                          </div>
                          <div className="text-[10px] text-muted-foreground uppercase tracking-wide tabular-nums">
                            {dayLabel}
                          </div>
                        </div>
                        <div className="relative z-10 shrink-0 mt-1">
                          <div className="w-2.5 h-2.5 rounded-full bg-primary ring-4 ring-card" />
                        </div>
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="inline-flex items-center justify-center w-5 h-5 rounded-md bg-muted/40">
                              {channelIcon(item.channel)}
                            </span>
                            <span className="inline-flex items-center justify-center w-5 h-5 rounded-md bg-muted/30">
                              {kindIcon(item.kind)}
                            </span>
                            <span className="text-[13px] font-[Sora,ui-sans-serif] font-semibold text-foreground truncate">
                              {item.title}
                            </span>
                            <Badge variant="outline" className="text-[9px] border-border/60 text-muted-foreground">
                              {channelLabel(item.channel)}
                            </Badge>
                            {pizzaBadge(item.pizzaGroup)}
                            {statusBadge(item.status)}
                          </div>
                          <div className="flex items-center gap-2 flex-wrap text-[10px] text-muted-foreground">
                            <span>{item.motorLabel}</span>
                            {item.phone && <span className="tabular-nums">· {item.phone}</span>}
                            {item.badge !== item.motorLabel && (
                              <span className="truncate">· {item.badge}</span>
                            )}
                          </div>
                          {item.actionsPreview && item.actionsPreview.length > 0 && (
                            <div className="flex flex-wrap gap-1 pt-0.5">
                              {item.actionsPreview.map((a) => (
                                <span
                                  key={a}
                                  className="text-[9px] px-1.5 py-0.5 rounded-md border border-border/50 bg-muted/30 text-muted-foreground"
                                >
                                  {a}
                                </span>
                              ))}
                            </div>
                          )}
                          {item.preview && (
                            <p className="text-[11.5px] text-muted-foreground line-clamp-2 italic">
                              “{item.preview}”
                            </p>
                          )}
                          {item.audio_url && (
                            <audio controls preload="none" className="h-7 w-full max-w-xs mt-1" src={item.audio_url} />
                          )}
                        </div>
                        <span className="hidden sm:inline text-[10px] text-muted-foreground/70 opacity-0 group-hover:opacity-100 transition-opacity self-center whitespace-nowrap">
                          abrir →
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}

function FilterChip({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "text-[11px] px-2.5 py-1 rounded-full border transition-colors font-medium",
        active
          ? "bg-primary/15 border-primary/40 text-primary"
          : "bg-transparent border-border/50 text-muted-foreground hover:border-border hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
}

export default AgendamentosFuturosPanel;
