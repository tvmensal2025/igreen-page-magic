import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Pencil, QrCode, Eye, AlertTriangle, TrendingUp, TrendingDown, QrCode as QrIcon, Tag } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Area, AreaChart, ResponsiveContainer } from "recharts";
import type { ReferralPartner } from "./hooks/useReferralPartners";
import type { PartnerAnalytics } from "./hooks/usePartnerAnalytics";

interface Props {
  partner: ReferralPartner;
  analytics?: PartnerAnalytics;
  onEdit: (p: ReferralPartner) => void;
  onQrCode: (p: ReferralPartner) => void;
  onAfterAction?: () => void;
}

type Health = "ok" | "configured_no_leads" | "not_configured";

function getHealth(p: ReferralPartner, a?: PartnerAnalytics): Health {
  const configured = (p.keywords?.length ?? 0) > 0 || !!p.qr_phrase;
  if (!configured) return "not_configured";
  if ((a?.leads_30d ?? 0) === 0) return "configured_no_leads";
  return "ok";
}

const HEALTH_META: Record<Health, { dot: string; label: string; cls: string; ring: string }> = {
  ok: {
    dot: "bg-primary",
    label: "Atribuindo",
    cls: "border-primary/20 bg-gradient-to-br from-primary/[0.06] to-transparent",
    ring: "ring-primary/20",
  },
  configured_no_leads: {
    dot: "bg-warning",
    label: "Sem clientes 30d",
    cls: "border-warning/20 bg-gradient-to-br from-warning/[0.05] to-transparent",
    ring: "ring-warning/20",
  },
  not_configured: {
    dot: "bg-destructive",
    label: "Sem keyword",
    cls: "border-destructive/30 bg-gradient-to-br from-destructive/[0.05] to-transparent",
    ring: "ring-destructive/20",
  },
};

export function PartnerQuickCard({ partner, analytics, onEdit, onQrCode, onAfterAction }: Props) {
  const navigate = useNavigate();
  const health = getHealth(partner, analytics);
  const meta = HEALTH_META[health];
  const leads30 = analytics?.leads_30d ?? 0;
  const leadsPrev30 = analytics?.leads_prev_30d ?? 0;
  const leadsTotal = analytics?.leads_total ?? 0;
  const aprovados = analytics?.aprovados ?? 0;
  const convRate = leadsTotal > 0 ? Math.round((aprovados / leadsTotal) * 100) : 0;
  const qrCount = analytics?.qr_count ?? 0;
  const keywordCount = analytics?.keyword_count ?? 0;

  // Tendência 30d vs 30d anterior
  const trend =
    leadsPrev30 === 0
      ? leads30 > 0 ? 100 : 0
      : Math.round(((leads30 - leadsPrev30) / leadsPrev30) * 100);
  const trendPositive = trend >= 0;

  // Sparkline a partir da série diária já existente
  const spark = (analytics?.daily_series ?? []).map((d) => ({ v: Number(d.count) || 0 }));
  const hasSpark = spark.some((s) => s.v > 0);

  const initials = partner.nome
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();

  const handleEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    onEdit(partner);
  };
  const handleQr = (e: React.MouseEvent) => {
    e.stopPropagation();
    onQrCode(partner);
  };
  const handleView = (e: React.MouseEvent) => {
    e.stopPropagation();
    onAfterAction?.();
    navigate(`/admin?tab=conversao&partner=${partner.id}`);
  };

  return (
    <Card
      className={`group relative overflow-hidden p-0 cursor-pointer transition-all hover:shadow-md hover:-translate-y-0.5 ${meta.cls}`}
      onClick={() => onEdit(partner)}
    >
      {/* Sparkline de fundo */}
      {hasSpark && (
        <div className="absolute inset-x-0 bottom-0 h-12 opacity-[0.18] pointer-events-none">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={spark} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={`spark-${partner.id}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.9} />
                  <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area type="monotone" dataKey="v" stroke="hsl(var(--primary))" strokeWidth={1.5} fill={`url(#spark-${partner.id})`} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="relative p-3.5">
        {/* Header: avatar + nome + saúde */}
        <div className="flex items-start gap-2.5 mb-3">
          <div className={`h-9 w-9 shrink-0 rounded-xl bg-background/80 text-foreground flex items-center justify-center text-xs font-bold ring-1 ${meta.ring}`}>
            {initials || "?"}
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-sm truncate leading-tight">{partner.nome}</div>
            {partner.cli && (
              <div className="text-[10px] text-muted-foreground font-mono mt-0.5">CLI {partner.cli}</div>
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
            <span className="text-[9px] text-muted-foreground whitespace-nowrap">{meta.label}</span>
          </div>
        </div>

        {/* Métricas */}
        <div className="flex items-end gap-3 mb-3">
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-2xl font-bold leading-none tabular-nums">{leads30}</span>
              {(leads30 > 0 || leadsPrev30 > 0) && (
                <span className={`inline-flex items-center gap-0.5 text-[10px] font-semibold ${trendPositive ? "text-primary" : "text-destructive"}`}>
                  {trendPositive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                  {Math.abs(trend)}%
                </span>
              )}
            </div>
            <div className="text-[9px] uppercase tracking-wide text-muted-foreground mt-1">Clientes 30d</div>
          </div>
          <div className="border-l border-border/40 pl-3">
            <div className="text-2xl font-bold leading-none tabular-nums">{leadsTotal}</div>
            <div className="text-[9px] uppercase tracking-wide text-muted-foreground mt-1">Total</div>
          </div>
          <div className="border-l border-border/40 pl-3 ml-auto text-right">
            <div className="text-2xl font-bold leading-none tabular-nums text-primary">{convRate}%</div>
            <div className="text-[9px] uppercase tracking-wide text-muted-foreground mt-1">Conversão</div>
          </div>
        </div>

        {/* Origem (QR vs keyword) + keywords */}
        <div className="flex items-center gap-1.5 flex-wrap mb-3">
          {qrCount > 0 && (
            <Badge variant="secondary" className="text-[9px] px-1.5 py-0 gap-1">
              <QrIcon className="h-2.5 w-2.5" /> {qrCount} QR
            </Badge>
          )}
          {keywordCount > 0 && (
            <Badge variant="secondary" className="text-[9px] px-1.5 py-0 gap-1">
              <Tag className="h-2.5 w-2.5" /> {keywordCount} palavra
            </Badge>
          )}
          {(partner.keywords ?? []).slice(0, 2).map((k) => (
            <Badge key={k} variant="outline" className="text-[9px] px-1.5 py-0">
              {k}
            </Badge>
          ))}
          {(partner.keywords ?? []).length > 2 && (
            <Badge variant="outline" className="text-[9px] px-1.5 py-0">
              +{(partner.keywords ?? []).length - 2}
            </Badge>
          )}
        </div>

        {health === "not_configured" && (
          <div className="flex items-center gap-1.5 text-[10px] text-destructive mb-2.5">
            <AlertTriangle className="h-3 w-3 shrink-0" />
            Sem keyword nem QR — não consegue atribuir clientes
          </div>
        )}

        {/* Ações */}
        <div className="flex gap-1 pt-2.5 border-t border-border/40">
          <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px] flex-1" onClick={handleEdit}>
            <Pencil className="h-3 w-3 mr-1" /> Editar
          </Button>
          <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px] flex-1" onClick={handleQr}>
            <QrCode className="h-3 w-3 mr-1" /> QR
          </Button>
          <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px] flex-1" onClick={handleView}>
            <Eye className="h-3 w-3 mr-1" /> Clientes
          </Button>
        </div>
      </div>
    </Card>
  );
}
