import { useEffect, useState } from "react";
import { CreateCampaignWizard } from "./campaign-wizard";
import CampaignsList from "./CampaignsList";
import { MetaAudiencePanel } from "./MetaAudiencePanel";
import { WalletChip } from "./WalletChip";
import { AdTemplatesGallery } from "./AdTemplatesGallery";
import { CtwaConnectGuide } from "./CtwaConnectGuide";
import { SyncMetricsButton } from "./SyncMetricsButton";
import { DragResizer } from "@/components/layout/DragResizer";

import { IntelligenceTab } from "./IntelligenceTab";
import { ResultsDashboard } from "./ResultsDashboard";
import { CommissionPanel } from "./CommissionPanel";
import { DashboardInsights } from "./DashboardInsights";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Megaphone,
  Plus,
  ListChecks,
  LayoutGrid,
  Brain,
  Sparkles,
  LayoutDashboard,
  TrendingUp,
  BadgeDollarSign,
} from "lucide-react";
import { useManagedConsultants } from "@/hooks/useManagedConsultants";
import { AdMetricsCards } from "../dashboard/AdMetricsCards";
import { AdMetricsCharts } from "../dashboard/AdMetricsCharts";
import { AdAccountSwitcher } from "../dashboard/AdAccountSwitcher";
import { MainChart } from "../dashboard/MainChart";
import { CpcPanel } from "../dashboard/CpcPanel";
import { RecentClicks } from "../dashboard/RecentClicks";
import { FunnelStrip } from "../dashboard/FunnelStrip";
import { LeadSourceCard } from "../LeadSourceCard";
import { useAnalytics } from "@/hooks/useAnalytics";
import { AdsTile } from "./AdsTile";
import { AdsButton } from "./AdsButton";

interface Props {
  consultantId: string;
}

type View = "dashboard" | "gallery" | "campaigns" | "performance" | "intel" | "commissions";

export function AdsCentralTab({ consultantId }: Props) {
  const { toast } = useToast();
  const [wizardOpen, setWizardOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [view, setView] = useState<View>("dashboard");
  const [periodDays, setPeriodDays] = useState<number>(30);
  const [adAccountId, setAdAccountId] = useState<string>(consultantId);
  useEffect(() => {
    setAdAccountId(consultantId);
  }, [consultantId]);

  const { data: managedConsultants = [] } = useManagedConsultants(consultantId);
  const { data: analytics } = useAnalytics(adAccountId, periodDays);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const topup = params.get("topup");
    if (topup === "ok") {
      toast({ title: "Recarga concluída!", description: "Seu saldo já foi creditado." });
    } else if (topup === "cancel") {
      toast({ title: "Recarga cancelada", description: "Você pode tentar novamente quando quiser." });
    } else {
      return;
    }
    params.delete("topup");
    const clean = window.location.pathname + (params.toString() ? `?${params}` : "");
    window.history.replaceState({}, "", clean);
  }, [toast]);

  const navItems: { id: View; label: string; icon: any }[] = [
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { id: "gallery", label: "Modelos", icon: LayoutGrid },
    { id: "campaigns", label: "Campanhas", icon: ListChecks },
    { id: "performance", label: "Performance", icon: TrendingUp },
    { id: "intel", label: "Cérebro", icon: Brain },
    { id: "commissions", label: "Comissões", icon: BadgeDollarSign },
  ];

  return (
    <div className="ads-central-2026 w-full max-w-full min-w-0 rounded-2xl overflow-x-clip border border-[hsl(var(--ads-border))]">
      <header className="ads-header">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <Megaphone className="w-4 h-4 text-primary shrink-0" />
          <span className="ads-wordmark truncate">
            iGreen · <span className="text-primary">Anúncios</span>
          </span>
          <span className="hidden xl:inline text-[11px] text-[hsl(var(--ads-muted))] ml-3 truncate">
            Dashboard rico · Cérebro na aba própria.
          </span>
        </div>
        <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap min-w-0 w-full sm:w-auto">
          <SyncMetricsButton consultantId={consultantId} onSynced={() => setRefreshKey((k) => k + 1)} />
          <WalletChip consultantId={consultantId} />
          <AdsButton variant="cta" size="sm" onClick={() => setWizardOpen(true)}>
            <Plus className="w-3.5 h-3.5" />
            <span className="sm:hidden">Criar</span>
            <span className="hidden sm:inline">Criar campanha</span>
          </AdsButton>
        </div>
      </header>

      <div className="p-3 sm:p-4 md:p-5 space-y-4 min-w-0 max-w-full">
        <CtwaConnectGuide consultantId={consultantId} />

        <div className="ads-nav-pill" role="tablist" aria-label="Seções da Central de Anúncios">
          {navItems.map((n) => {
            const Icon = n.icon;
            return (
              <AdsButton
                key={n.id}
                variant="nav"
                size="nav"
                active={view === n.id}
                onClick={() => setView(n.id)}
              >
                <Icon className="w-3.5 h-3.5" />
                {n.label}
              </AdsButton>
            );
          })}
        </div>

        {view === "dashboard" && (
          <div className="space-y-4 min-w-0 max-w-full">
            <div className="flex items-center gap-2 flex-wrap min-w-0">
              <AdAccountSwitcher userId={consultantId} value={adAccountId} onChange={setAdAccountId} />
              <Select value={String(periodDays)} onValueChange={(v) => setPeriodDays(Number(v))}>
                <SelectTrigger className="h-8 w-full max-w-[150px] text-xs bg-[hsl(var(--ads-surface))] border-[hsl(var(--ads-border))] text-[hsl(var(--ads-emerald-2))]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="7">Últimos 7 dias</SelectItem>
                  <SelectItem value="15">Últimos 15 dias</SelectItem>
                  <SelectItem value="30">Últimos 30 dias</SelectItem>
                  <SelectItem value="90">Últimos 90 dias</SelectItem>
                </SelectContent>
              </Select>
              <button
                type="button"
                onClick={() => setView("intel")}
                className="ml-auto inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-primary/30 bg-primary/5 hover:bg-primary/10 text-[11px] font-medium text-primary transition-colors"
              >
                <Brain className="w-3.5 h-3.5" />
                Abrir Cérebro
              </button>
            </div>

            <div className="ads-bento">
              <AdsTile delay={0} className="overflow-hidden">
                <AdMetricsCards consultantId={adAccountId} periodDays={periodDays} />
              </AdsTile>
            </div>

            <AdsTile delay={40} label="Panorama da operação" icon={<Sparkles className="w-3 h-3" />}>
              <DashboardInsights consultantId={adAccountId} periodDays={periodDays} />
            </AdsTile>

            <AdsTile delay={80} label="Visão geral de performance" icon={<TrendingUp className="w-3 h-3" />}>
              <AdMetricsCharts
                consultantId={adAccountId}
                periodDays={periodDays}
                managed={managedConsultants}
              />
            </AdsTile>

            <AdsTile delay={120} label="Tráfego principal" icon={<LayoutDashboard className="w-3 h-3" />}>
              <MainChart data={(analytics as any)?.dailyMain} />
            </AdsTile>

            <div
              data-resize-scope
              className="flex flex-col lg:flex-row gap-3 items-stretch min-w-0 max-w-full"
              style={{ "--ads-left-w": "min(520px, 50%)" } as React.CSSProperties}
            >
              <AdsTile
                delay={160}
                className="w-full lg:w-[var(--ads-left-w)] lg:max-w-[min(55%,var(--ads-left-w))] min-w-0"
                label="CPC por destino"
              >
                <CpcPanel
                  data={(analytics as any)?.cpcByTarget}
                  totalCtaClicks={(analytics as any)?.totalCtaClicks}
                />
              </AdsTile>
              <DragResizer
                storageKey="ads-cpc"
                cssVar="ads-left-w"
                defaultPx={520}
                minPx={280}
                maxPx={720}
                className="!hidden lg:!flex"
              />
              <AdsTile delay={200} className="flex-1 min-w-0 w-full" label="Cliques recentes">
                <RecentClicks clicks={(analytics as any)?.recentClicks} />
              </AdsTile>
            </div>

            <AdsTile delay={240} label="Funil de conversão" icon={<Sparkles className="w-3 h-3" />}>
              <FunnelStrip funnel={(analytics as any)?.funnel} />
            </AdsTile>

            <AdsTile delay={280} label="Fontes de cliente interessado" icon={<Megaphone className="w-3 h-3" />}>
              <LeadSourceCard consultantId={adAccountId} periodDays={periodDays} />
            </AdsTile>
          </div>
        )}

        {view === "gallery" && (
          <AdsTile delay={0} className="min-w-0">
            <AdTemplatesGallery
              consultantId={consultantId}
              onPublished={() => {
                setRefreshKey((k) => k + 1);
                setView("campaigns");
              }}
            />
          </AdsTile>
        )}
        {view === "campaigns" && (
          <div className="space-y-4 min-w-0 max-w-full">
            <AdsTile delay={0}>
              <MetaAudiencePanel consultantId={consultantId} />
            </AdsTile>
            <AdsTile delay={40}>
              <CampaignsList consultantId={consultantId} refreshKey={refreshKey} />
            </AdsTile>
          </div>
        )}
        {view === "performance" && (
          <div className="min-w-0 max-w-full">
            <ResultsDashboard
              key={refreshKey}
              consultantId={consultantId}
              onCreateClick={() => setView("gallery")}
            />
          </div>
        )}
        {view === "intel" && (
          <div className="min-w-0 max-w-full">
            <IntelligenceTab consultantId={consultantId} />
          </div>
        )}
        {view === "commissions" && (
          <div className="min-w-0 max-w-full">
            <CommissionPanel consultantId={consultantId} />
          </div>
        )}

        {view !== "dashboard" && view !== "performance" && view !== "commissions" && view !== "intel" && (
          <div className="rounded-xl border border-dashed border-[hsl(var(--ads-border-strong))] bg-[hsl(var(--ads-surface)/.5)] p-3 flex items-start gap-2 text-xs text-[hsl(var(--ads-muted))]">
            <Sparkles className="w-3.5 h-3.5 text-primary mt-0.5 shrink-0" />
            <div>
              Recarregue sua carteira no botão acima e escolha um modelo pronto na{" "}
              <strong className="text-[hsl(var(--ads-emerald-2))]">Galeria</strong>. A campanha sobe
              pré-otimizada e os leads caem no WhatsApp já conectado.
            </div>
          </div>
        )}
      </div>

      <CreateCampaignWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        consultantId={consultantId}
        onCreated={() => setRefreshKey((k) => k + 1)}
      />
    </div>
  );
}
