import { GripVertical, User, Pencil, Trash2, MoreVertical, Footprints, ShieldCheck, Eye } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { KanbanSlaIndicator } from "./KanbanSlaIndicator";
import type { Tables } from "@/integrations/supabase/types";
import type { FlowStepInfo } from "@/lib/flowStepResolver";

type CrmDealRow = Tables<"crm_deals">;

interface KanbanDealCardProps {
  deal: CrmDealRow;
  stepInfo?: FlowStepInfo | null;
  onDragStart: (id: string) => void;
  onEdit: (deal: CrmDealRow) => void;
  onDelete: (id: string) => void;
  onReclassify?: (deal: CrmDealRow) => void;
  onView?: (params: { customerId?: string | null; dealId?: string | null }) => void;
}

export function KanbanDealCard({ deal, stepInfo, onDragStart, onEdit, onDelete, onReclassify, onView }: KanbanDealCardProps) {
  const isTest = (deal as any).is_test_lead || (deal as any).is_sandbox;
  const isSynthetic = (deal as any).__synthetic;
  const lastAdvanced = (deal as any).last_step_advanced_at || deal.updated_at || deal.created_at;
  const hoursStuck = lastAdvanced ? (Date.now() - new Date(lastAdvanced).getTime()) / 36e5 : 0;
  const leadSource = (deal as any).lead_source;
  const sourceKey = typeof leadSource === "string" ? leadSource : leadSource?.source;
  const isMetaAds = sourceKey === "meta_ads";
  const isPartner = sourceKey === "partner";
  const originBadge = isMetaAds
    ? { label: "Meta", title: "Cliente interessado do Meta Ads (Facebook/Instagram)", cls: "bg-info/15 text-info border-info/30" }
    : isPartner
      ? { label: "Parc", title: "Cliente interessado vindo de parceiro", cls: "bg-primary/15 text-primary border-primary/30" }
      : { label: "WPP", title: "Cliente interessado WhatsApp direto", cls: "bg-primary/15 text-primary border-primary/30" };
  const stepTone = !stepInfo
    ? "bg-muted/40 text-muted-foreground border-border/40"
    : hoursStuck > 72
      ? "bg-destructive/15 text-destructive border-destructive/30"
      : hoursStuck > 24
        ? "bg-warning/15 text-warning border-warning/30"
        : "bg-primary/15 text-primary border-primary/30";
  return (
    <div
      draggable
      onDragStart={() => onDragStart(deal.id)}
      className={`p-3 cursor-grab active:cursor-grabbing rounded-xl bg-card border hover:shadow-sm transition-all group ${isTest ? "border-dashed border-muted-foreground/30 opacity-70 grayscale" : "border-border/50 hover:border-primary/25"}`}
    >
      <div className="flex items-start gap-2">
        <GripVertical className="h-3.5 w-3.5 text-muted-foreground/40 mt-0.5 shrink-0 group-hover:text-muted-foreground transition-colors" />
        <div className="flex-1 min-w-0">
          {(deal as any).customer_name && (
            <div className="flex items-center gap-1.5 mb-0.5 min-w-0">
              <div className="w-4 h-4 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                <User className="h-2.5 w-2.5 text-primary" />
              </div>
              <span className="text-xs font-medium text-foreground truncate sensitive-data min-w-0 flex-1">
                {(deal as any).customer_name}
              </span>
            </div>
          )}
          {/* Badges de origem em linha própria — evita comprimir/cortar o nome */}
          <div className="flex items-center gap-1 flex-wrap mb-0.5">
            <span
              className={`text-[8px] px-1 py-0.5 rounded border font-semibold ${originBadge.cls}`}
              title={originBadge.title}
            >
              {originBadge.label}
            </span>
            {isTest && (
              <span className="text-[8px] px-1 py-0.5 rounded bg-muted text-muted-foreground border border-border" title="Cliente interessado marcado como teste/sandbox">
                TESTE
              </span>
            )}
          </div>
          <span className="text-[10px] text-muted-foreground truncate block sensitive-phone">
            {deal.remote_jid?.split("@")[0] || "Sem contato"}
          </span>
          <div className={`mt-1.5 flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-[9px] font-medium min-w-0 max-w-full ${stepTone}`}
            title={stepInfo ? `Parou em: ${stepInfo.label}` : "Sem interação registrada no bot"}
          >
            <Footprints className="h-2.5 w-2.5 shrink-0" />
            {stepInfo
              ? (
                <span className="flex items-baseline gap-1 min-w-0">
                  <span className="shrink-0">{stepInfo.number}{stepInfo.total ? `/${stepInfo.total}` : ""} ·</span>
                  <span className="truncate min-w-0">{stepInfo.label}</span>
                </span>
              )
              : <span className="truncate">Sem interação</span>}
          </div>
          <div className="mt-1">
            <KanbanSlaIndicator enteredAt={lastAdvanced} />
          </div>
          {deal.approved_at && (
            <p className="text-[9px] text-primary/80 mt-1">
              ✓ {new Date(deal.approved_at).toLocaleDateString("pt-BR")}
            </p>
          )}
          {deal.rejected_at && (
            <p className="text-[9px] text-destructive/80 mt-1">
              ✗ {new Date(deal.rejected_at).toLocaleDateString("pt-BR")}
              {deal.rejection_reason && ` · ${deal.rejection_reason.replace(/_/g, " ")}`}
            </p>
          )}
          {deal.notes && (
            <p className="text-[10px] text-muted-foreground/70 truncate mt-1 italic">{deal.notes}</p>
          )}
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          {onView && (
            <button
              className="h-6 w-6 flex items-center justify-center rounded-lg hover:bg-muted opacity-60 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-primary"
              title="Ver detalhes, linha do tempo e próxima mensagem"
              onClick={(e) => { e.stopPropagation(); onView({ customerId: deal.customer_id, dealId: deal.id }); }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <Eye className="h-3.5 w-3.5" />
            </button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="h-6 w-6 flex items-center justify-center rounded-lg hover:bg-muted opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
              >
                <MoreVertical className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              {isTest && onReclassify && (
                <DropdownMenuItem className="text-xs gap-2 cursor-pointer text-primary focus:text-primary" onClick={(e) => { e.stopPropagation(); onReclassify(deal); }}>
                  <ShieldCheck className="h-3 w-3" /> Reclassificar como real
                </DropdownMenuItem>
              )}
              {!isSynthetic && (
                <DropdownMenuItem className="text-xs gap-2 cursor-pointer" onClick={(e) => { e.stopPropagation(); onEdit(deal); }}>
                  <Pencil className="h-3 w-3" /> Editar
                </DropdownMenuItem>
              )}
              <DropdownMenuItem className="text-xs gap-2 cursor-pointer text-destructive focus:text-destructive" onClick={(e) => { e.stopPropagation(); onDelete(deal.id); }}>
                <Trash2 className="h-3 w-3" /> {isSynthetic ? "Ocultar" : "Excluir"}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
}
