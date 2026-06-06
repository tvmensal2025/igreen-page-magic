import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Pencil, QrCode, Eye, AlertTriangle } from "lucide-react";
import { useNavigate } from "react-router-dom";
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

const HEALTH_META: Record<Health, { dot: string; label: string; cls: string }> = {
  ok: {
    dot: "bg-emerald-500",
    label: "Atribuindo",
    cls: "border-emerald-500/30 bg-emerald-500/5",
  },
  configured_no_leads: {
    dot: "bg-amber-500",
    label: "Sem leads 30d",
    cls: "border-amber-500/30 bg-amber-500/5",
  },
  not_configured: {
    dot: "bg-red-500",
    label: "Sem keyword",
    cls: "border-red-500/40 bg-red-500/5",
  },
};

export function PartnerQuickCard({ partner, analytics, onEdit, onQrCode, onAfterAction }: Props) {
  const navigate = useNavigate();
  const health = getHealth(partner, analytics);
  const meta = HEALTH_META[health];
  const leads30 = analytics?.leads_30d ?? 0;
  const leadsTotal = analytics?.leads_total ?? 0;

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
      className={`p-3 cursor-pointer hover:border-primary/40 transition group ${meta.cls}`}
      onClick={() => onEdit(partner)}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-sm truncate">{partner.nome}</div>
          <div className="text-[10px] text-muted-foreground font-mono mt-0.5">CLI {partner.cli}</div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className={`h-2 w-2 rounded-full ${meta.dot}`} />
          <span className="text-[10px] text-muted-foreground whitespace-nowrap">{meta.label}</span>
        </div>
      </div>

      <div className="flex items-center gap-3 mb-2">
        <div>
          <div className="text-lg font-semibold leading-none">{leads30}</div>
          <div className="text-[9px] uppercase text-muted-foreground mt-1">Leads 30d</div>
        </div>
        <div className="border-l border-border/40 pl-3">
          <div className="text-lg font-semibold leading-none">{leadsTotal}</div>
          <div className="text-[9px] uppercase text-muted-foreground mt-1">Total</div>
        </div>
        <div className="ml-auto flex flex-wrap gap-1 justify-end max-w-[50%]">
          {(partner.keywords ?? []).slice(0, 2).map((k) => (
            <Badge key={k} variant="secondary" className="text-[9px] px-1.5 py-0">
              {k}
            </Badge>
          ))}
          {(partner.keywords ?? []).length > 2 && (
            <Badge variant="secondary" className="text-[9px] px-1.5 py-0">
              +{(partner.keywords ?? []).length - 2}
            </Badge>
          )}
        </div>
      </div>

      {health === "not_configured" && (
        <div className="flex items-center gap-1.5 text-[10px] text-red-400 mb-2">
          <AlertTriangle className="h-3 w-3" />
          Sem keyword nem QR — não consegue atribuir leads
        </div>
      )}

      <div className="flex gap-1 pt-1 border-t border-border/40">
        <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px] flex-1" onClick={handleEdit}>
          <Pencil className="h-3 w-3 mr-1" /> Editar
        </Button>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px] flex-1" onClick={handleQr}>
          <QrCode className="h-3 w-3 mr-1" /> QR
        </Button>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px] flex-1" onClick={handleView}>
          <Eye className="h-3 w-3 mr-1" /> Leads
        </Button>
      </div>
    </Card>
  );
}
