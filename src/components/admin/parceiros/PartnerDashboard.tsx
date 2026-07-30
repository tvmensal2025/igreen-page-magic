import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Plus,
  Sparkles,
  AlertTriangle,
  Download,
  Pencil,
  QrCode,
  LayoutDashboard,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { PartnerKpiRow } from "./PartnerKpiRow";
import { PartnerLeadsBarChart } from "./PartnerLeadsBarChart";
import { PartnerTrendChart } from "./PartnerTrendChart";
import { PartnerFunnelChart } from "./PartnerFunnelChart";
import { PartnerOriginDonut } from "./PartnerOriginDonut";
import { PartnerRankingTable } from "./PartnerRankingTable";
import { PartnerPodium } from "./PartnerPodium";
import { PartnerBannersPanel } from "./PartnerBannersPanel";
import { usePartnerAnalytics } from "./hooks/usePartnerAnalytics";
import type { ReferralPartner } from "./hooks/useReferralPartners";

type TabId = "overview" | string; // overview | partner.id

interface Props {
  partners: ReferralPartner[];
  isLoading: boolean;
  consultantId: string;
  license?: string | null;
  consultantIgreenId?: string;
  consultantName?: string;
  consultantPhone?: string;
  onNew: () => void;
  onEdit: (p: ReferralPartner) => void;
  onDelete: (id: string) => void;
  onQrCode: (
    p: ReferralPartner,
    ctx?: { keyword?: string; spotCode?: string; phrase?: string | null },
  ) => void;
  onPartnersChanged: () => void;
  /** Abre a Central de Banners (meus + ranking). */
  onDownloadBanner: () => void;
  /** Ao criar parceiro, pai pode pedir foco nesta aba. */
  focusPartnerId?: string | null;
}

function partnerHealth(
  p: ReferralPartner,
  leads30: number,
): "ok" | "warn" | "bad" {
  const configured = (p.keywords?.length ?? 0) > 0 || !!p.qr_phrase;
  if (!configured) return "bad";
  if (leads30 === 0) return "warn";
  return "ok";
}

export function PartnerDashboard({
  partners,
  isLoading,
  consultantId,
  license = "",
  consultantIgreenId = "",
  consultantName = "",
  consultantPhone = "",
  onNew,
  onEdit,
  onDelete,
  onQrCode,
  onPartnersChanged,
  onDownloadBanner,
  focusPartnerId = null,
}: Props) {
  const { data: analytics = [], isLoading: analyticsLoading } =
    usePartnerAnalytics();
  const [tab, setTab] = useState<TabId>("overview");

  useEffect(() => {
    if (focusPartnerId && partners.some((p) => p.id === focusPartnerId)) {
      setTab(focusPartnerId);
    }
  }, [focusPartnerId, partners]);

  // Se o parceiro da aba sumiu (ex.: removido), volta pra visão geral.
  useEffect(() => {
    if (tab === "overview") return;
    if (!partners.some((p) => p.id === tab)) setTab("overview");
  }, [partners, tab]);

  const selectedPartner = useMemo(
    () => (tab === "overview" ? null : partners.find((p) => p.id === tab) || null),
    [tab, partners],
  );

  const unhealthy = partners.filter((p) => {
    const a = analytics.find((x) => x.partner_id === p.id);
    const configured = (p.keywords?.length ?? 0) > 0 || !!p.qr_phrase;
    return !configured || (a?.leads_30d ?? 0) === 0;
  }).length;

  if (isLoading || analyticsLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-10 w-full max-w-xl" />
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
      <div className="pe-page space-y-6">
        <div className="pe-page-header">
          <div className="min-w-0">
            <h2 className="pe-page-title">Parceiros</h2>
            <p className="pe-page-sub">
              Cadastre indicadores e acompanhe cada um numa aba própria
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
            <Button
              variant="outline"
              onClick={onDownloadBanner}
              className="gap-2 h-8"
            >
              <Download className="h-4 w-4" />
              Meus banners
            </Button>
            <Button onClick={onNew} className="gap-2 h-8">
              <Plus className="h-4 w-4" /> Novo Parceiro
            </Button>
          </div>
        </div>
        <Card className="border-dashed">
          <CardContent className="py-16 flex flex-col items-center text-center gap-4">
            <div className="h-16 w-16 rounded-2xl bg-primary/10 text-primary flex items-center justify-center ring-1 ring-primary/20">
              <Sparkles className="h-8 w-8" />
            </div>
            <div>
              <h3 className="text-lg font-semibold">Nenhum parceiro ainda</h3>
              <p className="text-sm text-muted-foreground max-w-md mt-1">
                Depois de cadastrar, cada parceiro vira uma aba: dados, frase e
                banner no mesmo lugar.
              </p>
            </div>
            <Button onClick={onNew} className="gap-2">
              <Plus className="h-4 w-4" /> Cadastrar primeiro parceiro
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="pe-page space-y-5">
      <div className="pe-page-header">
        <div className="min-w-0">
          <h2 className="pe-page-title">Parceiros</h2>
          <p className="pe-page-sub">
            Clique no nome do parceiro — tudo dele fica nesta aba
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
          <Button
            variant="outline"
            onClick={onDownloadBanner}
            className="gap-2 h-8"
          >
            <Download className="h-4 w-4" />
            Meus banners
          </Button>
          <Button onClick={onNew} className="gap-2 h-8">
            <Plus className="h-4 w-4" /> Novo
          </Button>
        </div>
      </div>

      {/* Abas: Visão geral + um por parceiro */}
      <div className="flex gap-1 bg-muted/50 rounded-lg p-1 w-full overflow-x-auto">
        <button
          type="button"
          onClick={() => setTab("overview")}
          className={`shrink-0 px-3 py-1.5 text-xs font-medium rounded-md transition-colors flex items-center gap-1.5 ${
            tab === "overview"
              ? "bg-card text-primary shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <LayoutDashboard className="h-3.5 w-3.5" />
          Visão geral
          {unhealthy > 0 && (
            <span className="h-4 min-w-4 px-1 rounded-full bg-destructive text-[10px] font-semibold text-white flex items-center justify-center">
              {unhealthy}
            </span>
          )}
        </button>
        {partners.map((p) => {
          const a = analytics.find((x) => x.partner_id === p.id);
          const health = partnerHealth(p, a?.leads_30d ?? 0);
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => setTab(p.id)}
              className={`shrink-0 px-3 py-1.5 text-xs font-medium rounded-md transition-colors flex items-center gap-1.5 max-w-[10rem] ${
                tab === p.id
                  ? "bg-card text-primary shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              title={p.nome}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                  health === "ok"
                    ? "bg-primary"
                    : health === "warn"
                      ? "bg-warning"
                      : "bg-destructive"
                }`}
              />
              <span className="truncate">{p.nome}</span>
            </button>
          );
        })}
      </div>

      {tab === "overview" || !selectedPartner ? (
        <div className="space-y-6">
          {unhealthy > 0 && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-warning/10 border border-warning/30 text-warning text-xs">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <div>
                <strong>{unhealthy}</strong> parceiro(s) precisam de atenção
                (sem keyword/frase ou sem leads em 30 dias). Abra a aba do
                parceiro para corrigir.
              </div>
            </div>
          )}

          <PartnerPodium partners={partners} analytics={analytics} />
          <PartnerKpiRow analytics={analytics} activeCount={partners.length} />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <PartnerLeadsBarChart analytics={analytics} />
            <PartnerTrendChart analytics={analytics} />
            <PartnerFunnelChart analytics={analytics} />
            <PartnerOriginDonut analytics={analytics} />
          </div>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Ranking detalhado</CardTitle>
            </CardHeader>
            <CardContent>
              <PartnerRankingTable
                partners={partners}
                analytics={analytics}
                onEdit={(p) => {
                  setTab(p.id);
                  onEdit(p);
                }}
                onDelete={onDelete}
                onQrCode={(p) => {
                  setTab(p.id);
                  onQrCode(p);
                }}
              />
            </CardContent>
          </Card>
        </div>
      ) : (
        <PartnerWorkspace
          partner={selectedPartner}
          analytics={analytics.find((a) => a.partner_id === selectedPartner.id)}
          consultantId={consultantId}
          license={license}
          consultantIgreenId={consultantIgreenId}
          consultantName={consultantName}
          consultantPhone={consultantPhone}
          onEdit={() => onEdit(selectedPartner)}
          onQrCode={(ctx) => onQrCode(selectedPartner, ctx)}
          onPartnersChanged={onPartnersChanged}
        />
      )}
    </div>
  );
}

type PartnerWorkspaceProps = {
  partner: ReferralPartner;
  analytics?: { leads_30d?: number; leads_total?: number; aprovados?: number };
  consultantId: string;
  license?: string | null;
  consultantIgreenId?: string;
  consultantName?: string;
  consultantPhone?: string;
  onEdit: () => void;
  onQrCode: (ctx?: {
    keyword?: string;
    spotCode?: string;
    phrase?: string | null;
  }) => void;
  onPartnersChanged: () => void;
};

function PartnerWorkspace(props: PartnerWorkspaceProps) {
  const {
    partner,
    analytics,
    consultantId,
    license,
    consultantIgreenId,
    consultantName = "",
    consultantPhone = "",
    onEdit,
    onQrCode,
    onPartnersChanged,
  } = props;
  const configured =
    (partner.keywords?.length ?? 0) > 0 || !!partner.qr_phrase;
  const health = partnerHealth(partner, analytics?.leads_30d ?? 0);

  return (
    <div className="space-y-4">
      <Card className="border-primary/20">
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-lg font-semibold truncate">{partner.nome}</h3>
                <Badge
                  variant="secondary"
                  className={`text-[10px] h-5 ${
                    health === "ok"
                      ? "bg-primary/10 text-primary"
                      : health === "warn"
                        ? "bg-warning/10 text-warning"
                        : "bg-destructive/10 text-destructive"
                  }`}
                >
                  {health === "ok"
                    ? "Atribuindo leads"
                    : health === "warn"
                      ? "Sem leads (30d)"
                      : "Falta keyword/frase"}
                </Badge>
              </div>
              <p className="text-[11px] font-mono text-muted-foreground">
                código {partner.short_code || "—"}
                {partner.cli ? ` · CLI ${partner.cli}` : ""}
              </p>
              <p className="text-xs text-muted-foreground">
                {analytics?.leads_30d ?? 0} lead(s) em 30 dias ·{" "}
                {analytics?.aprovados ?? 0} aprovado(s)
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 gap-1.5"
                onClick={onEdit}
              >
                <Pencil className="h-3.5 w-3.5" />
                Editar dados
              </Button>
              <Button
                type="button"
                size="sm"
                className="h-8 gap-1.5"
                onClick={() => onQrCode()}
              >
                <QrCode className="h-3.5 w-3.5" />
                Baixar QR
              </Button>
            </div>
          </div>

          {!configured && (
            <div className="flex items-start gap-2 p-2.5 rounded-lg bg-destructive/5 border border-destructive/20 text-xs text-destructive">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>
                Sem palavra-chave nem frase QR este parceiro{" "}
                <strong>não atribui leads</strong>. Clique em{" "}
                <strong>Editar dados</strong> e preencha.
              </span>
            </div>
          )}

          <div className="grid gap-2 sm:grid-cols-2 text-xs">
            <div className="rounded-lg border border-border/60 bg-muted/20 p-2.5">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">
                Palavras-chave
              </p>
              <p className="mt-0.5 text-foreground">
                {(partner.keywords || []).filter(Boolean).join(", ") || "—"}
              </p>
            </div>
            <div className="rounded-lg border border-border/60 bg-muted/20 p-2.5">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">
                Frase WhatsApp (geral)
              </p>
              <p className="mt-0.5 text-foreground line-clamp-2">
                {partner.qr_phrase?.trim() || "Padrão do sistema"}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <PartnerBannersPanel
        consultantId={consultantId}
        partner={partner}
        license={license}
        consultantIgreenId={consultantIgreenId}
        consultantName={consultantName}
        consultantPhone={consultantPhone}
        onOpenPartnerQr={(ctx) => onQrCode(ctx)}
        onPartnerUpdated={onPartnersChanged}
      />
    </div>
  );
}
