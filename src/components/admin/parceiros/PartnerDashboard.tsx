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
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h2 className="text-xl sm:text-2xl font-heading font-bold tracking-tight">
            Dashboard de Parceiros
          </h2>
          <p className="text-sm text-muted-foreground">
            Performance de indicação, conversão e cashback em tempo real
          </p>
        </div>
        <Button onClick={onNew} className="gap-2 self-start sm:self-auto">
          <Plus className="h-4 w-4" /> Novo Parceiro
        </Button>
      </div>

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
