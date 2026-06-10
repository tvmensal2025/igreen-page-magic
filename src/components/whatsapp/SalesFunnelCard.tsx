import { Badge } from "@/components/ui/badge";
import { Pause, Phone, MapPin, Zap } from "lucide-react";
import { formatDistanceToNowStrict } from "date-fns";

import { ptBR } from "date-fns/locale";
import { leadHeat, type FunnelLead } from "@/hooks/useSalesFunnel";

interface SalesFunnelCardProps {
  lead: FunnelLead;
  onDragStart: (id: string) => void;
  onClick?: (lead: FunnelLead) => void;
}

function originLabel(src: any): string | null {
  if (!src) return null;
  if (typeof src === "string") return src;
  if (src.utm_source) return src.utm_source;
  if (src.source) return src.source;
  return null;
}

export function SalesFunnelCard({ lead, onDragStart, onClick }: SalesFunnelCardProps) {
  const heat = leadHeat(lead.qualification_score);
  const phone = lead.phone_whatsapp?.replace(/\D/g, "") || "";
  const lastReply = lead.last_bot_reply_at || lead.updated_at;
  const origin = originLabel(lead.lead_source);
  const billValue = Number(lead.electricity_bill_value || 0);

  return (
    <div
      draggable
      onDragStart={() => onDragStart(lead.id)}
      onClick={() => onClick?.(lead)}
      className="group bg-card hover:bg-card/80 border border-border hover:border-primary/40 rounded-xl p-3 cursor-grab active:cursor-grabbing transition-all shadow-sm hover:shadow-md"
    >
      {/* Header: nome + heat */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground truncate">
            {lead.name || "Sem nome"}
          </p>
          <div className="flex items-center gap-1 text-[11px] text-muted-foreground mt-0.5">
            <Phone className="w-3 h-3" />
            <span className="truncate">{phone}</span>
          </div>
        </div>
        <div className={`flex items-center gap-1 text-xs ${heat.color} shrink-0`} title={`${heat.label} (${lead.qualification_score ?? 0}/100)`}>
          <span className="text-base leading-none">{heat.emoji}</span>
        </div>
      </div>

      {/* Conta de luz */}
      {billValue > 0 && (
        <div className="flex items-center gap-1.5 mb-1.5 text-xs">
          <Zap className="w-3 h-3 text-warning" />
          <span className="text-foreground font-medium">
            R$ {billValue.toFixed(0)}
          </span>
          <span className="text-muted-foreground">
            · economia ~R$ {(billValue * 0.12).toFixed(0)}/mês
          </span>
        </div>
      )}

      {/* Cidade / distribuidora */}
      {(lead.address_city || lead.distribuidora) && (
        <div className="flex items-center gap-1 mb-2 text-[11px] text-muted-foreground">
          <MapPin className="w-3 h-3" />
          <span className="truncate">
            {[lead.address_city, lead.distribuidora].filter(Boolean).join(" · ")}
          </span>
        </div>
      )}

      {/* Pain point */}
      {lead.pain_point && (
        <p className="text-[11px] text-muted-foreground italic mb-2 line-clamp-2">
          "{lead.pain_point}"
        </p>
      )}

      {/* Footer: badges */}
      <div className="flex items-center justify-between gap-1 mt-2 pt-2 border-t border-border/50">
        <div className="flex items-center gap-1 flex-wrap min-w-0">
          {origin && (
            <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 border-primary/30 text-primary">
              {origin}
            </Badge>
          )}
          {lead.bot_paused && (
            <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 border-warning/40 text-warning">
              <Pause className="w-2.5 h-2.5 mr-0.5" />pausado
            </Badge>
          )}
        </div>
        <span className="text-[10px] text-muted-foreground shrink-0 whitespace-nowrap tabular-nums">
          {formatDistanceToNowStrict(new Date(lastReply), { locale: ptBR })}
        </span>
      </div>

    </div>
  );
}
