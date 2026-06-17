import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, Sparkles, Handshake, AlertTriangle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { PartnerKpiRow } from "./PartnerKpiRow";
import { PartnerLeadsBarChart } from "./PartnerLeadsBarChart";
import { PartnerTrendChart } from "./PartnerTrendChart";
import { PartnerFunnelChart } from "./PartnerFunnelChart";
import { PartnerOriginDonut } from "./PartnerOriginDonut";
import { PartnerRankingTable } from "./PartnerRankingTable";
import { PartnerQuickCard } from "./PartnerQuickCard";
import { PartnerPodium } from "./PartnerPodium";
import { usePartnerAnalytics } from "./hooks/usePartnerAnalytics";
import type { ReferralPartner } from "./hooks/useReferralPartners";


interface Props {
  partners: ReferralPartner[];
  isLoading: boolean;
  onNew: () => void;
  onEdit: (p: ReferralPartner) => void;
  onDelete: (id: string) => void;
  onQrCode: (p: ReferralPartner) => void;
}

export function PartnerDashboard({
  partners,
  isLoading,
  onNew,
  onEdit,
  onDelete,
  onQrCode,
}: Props) {
  const { data: analytics = [], isLoading: analyticsLoading } =
    usePartnerAnalytics();
  const [openList, setOpenList] = useState(false);

  const unhealthy = partners.filter((p) => {
    const a = analytics.find((x) => x.partner_id === p.id);
    const configured = (p.keywords?.length ?? 0) > 0 || !!p.qr_phrase;
    return !configured || (a?.leads_30d ?? 0) === 0;
  }).length;

  if (isLoading || analyticsLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-20 w-full" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }

  if (partners.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-16 flex flex-col items-center text-center gap-4">
          <div className="h-16 w-16 rounded-2xl bg-primary/10 text-primary flex items-center justify-center ring-1 ring-primary/20">
            <Sparkles className="h-8 w-8" />
          </div>
          <div>
            <h3 className="text-lg font-semibold">Nenhum parceiro ainda</h3>
            <p className="text-sm text-muted-foreground max-w-md mt-1">
              Cadastre indicadores e acompanhe captação, conversão e cashback de
              cada um em tempo real.
            </p>
          </div>
          <Button onClick={onNew} className="gap-2">
            <Plus className="h-4 w-4" /> Cadastrar primeiro parceiro
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="pe-page space-y-6">
      {/* Topo — botão Parceiros (abre popup) + Novo */}
      <div className="pe-page-header">
        <div className="min-w-0">
          <h2 className="pe-page-title">Dashboard de Parceiros</h2>
          <p className="pe-page-sub">
            Performance de indicação, conversão e cashback em tempo real
          </p>
        </div>
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <Button
            variant="outline"
            onClick={() => setOpenList(true)}
            className="gap-2 relative h-8"
          >
            <Handshake className="h-4 w-4" />
            Parceiros ({partners.length})
            {unhealthy > 0 && (
              <span className="absolute -top-1.5 -right-1.5 h-4 min-w-4 px-1 rounded-full bg-destructive/100 text-[10px] font-semibold text-white flex items-center justify-center">
                {unhealthy}
              </span>
            )}
          </Button>
          <Button onClick={onNew} className="gap-2 h-8">
            <Plus className="h-4 w-4" /> Novo Parceiro
          </Button>
        </div>
      </div>

      {/* Popup com cards dos parceiros */}
      <Dialog open={openList} onOpenChange={setOpenList}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Handshake className="h-5 w-5" /> Meus Parceiros
            </DialogTitle>
            <DialogDescription>
              Clique no card para editar. O selo colorido mostra a saúde da atribuição de clientes interessados.
            </DialogDescription>
          </DialogHeader>

          {unhealthy > 0 && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-warning/10 border border-warning/30 text-warning text-xs">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <div>
                <strong>{unhealthy}</strong> parceiro(s) precisam de atenção. Os marcados em vermelho não têm keyword nem frase de QR — então o sistema não consegue atribuir nenhum cliente interessado a eles.
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-2">
            {partners.map((p) => (
              <PartnerQuickCard
                key={p.id}
                partner={p}
                analytics={analytics.find((a) => a.partner_id === p.id)}
                onEdit={(partner) => {
                  setOpenList(false);
                  onEdit(partner);
                }}
                onQrCode={(partner) => {
                  setOpenList(false);
                  onQrCode(partner);
                }}
                onAfterAction={() => setOpenList(false)}
              />
            ))}
          </div>

          <div className="pt-3 border-t border-border/40">
            <Button onClick={() => { setOpenList(false); onNew(); }} className="w-full gap-2">
              <Plus className="h-4 w-4" /> Novo Parceiro
            </Button>
          </div>
        </DialogContent>
      </Dialog>


      {/* Pódio Top 3 — quem mais indicou nos últimos 30 dias */}
      <PartnerPodium partners={partners} analytics={analytics} />

      {/* KPIs */}
      <PartnerKpiRow analytics={analytics} activeCount={partners.length} />


      {/* Charts grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <PartnerLeadsBarChart analytics={analytics} />
        <PartnerTrendChart analytics={analytics} />
        <PartnerFunnelChart analytics={analytics} />
        <PartnerOriginDonut analytics={analytics} />
      </div>

      {/* Ranking */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Ranking detalhado</CardTitle>
        </CardHeader>
        <CardContent>
          <PartnerRankingTable
            partners={partners}
            analytics={analytics}
            onEdit={onEdit}
            onDelete={onDelete}
            onQrCode={onQrCode}
          />
        </CardContent>
      </Card>
    </div>
  );
}
