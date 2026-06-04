import { useEffect, useState } from "react";
import { CreateCampaignWizard } from "./CreateCampaignWizard";
import { ExpressCampaignDialog } from "./ExpressCampaignDialog";
import { CampaignsList } from "./CampaignsList";
import { WalletChip } from "./WalletChip";
import { AdTemplatesGallery } from "./AdTemplatesGallery";
import { CtwaConnectGuide } from "./CtwaConnectGuide";
import { ReplicateUberlandiaCard } from "./ReplicateUberlandiaCard";
import { SyncMetricsButton } from "./SyncMetricsButton";
import { DragResizer } from "@/components/layout/DragResizer";

import { IntelligenceTab } from "./IntelligenceTab";
import { ResultsDashboard } from "./ResultsDashboard";
import { CommissionPanel } from "./CommissionPanel";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Megaphone, Plus, ListChecks, LayoutGrid, Brain, Sparkles, LayoutDashboard, TrendingUp, BadgeDollarSign } from "lucide-react";
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

interface Props { consultantId: string }

type View = "dashboard" | "gallery" | "campaigns" | "performance" | "intel" | "commissions";

export function AdsCentralTab({ consultantId }: Props) {
  const { toast } = useToast();
  const [wizardOpen, setWizardOpen] = useState(false);
  const [expressOpen, setExpressOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [view, setView] = useState<View>("dashboard");
  const [periodDays, setPeriodDays] = useState<number>(30);
  const [adAccountId, setAdAccountId] = useState<string>(consultantId);
  useEffect(() => { setAdAccountId(consultantId); }, [consultantId]);

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
    { id: "intel", label: "Inteligência", icon: Brain },
    { id: "commissions", label: "Comissões", icon: BadgeDollarSign },
  ];

  return (
    <div className="space-y-5">
      <header className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-xl sm:text-2xl font-heading font-bold text-foreground flex items-center gap-2">
            <Megaphone className="w-5 h-5 sm:w-6 sm:h-6 text-primary shrink-0" />
            Central de Anúncios
          </h2>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1">
            Tudo de anúncios em um só lugar: dashboard, modelos prontos, campanhas, performance e inteligência.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap shrink-0">
          <SyncMetricsButton
            consultantId={consultantId}
            onSynced={() => setRefreshKey((k) => k + 1)}
          />
          <WalletChip consultantId={consultantId} />
          <Button size="sm" variant="outline" onClick={() => setWizardOpen(true)} className="gap-1.5 h-8 hidden sm:inline-flex">
            <Plus className="w-3.5 h-3.5" /> Avançado
          </Button>
          <Button size="sm" onClick={() => setExpressOpen(true)} className="gap-1.5 h-8 shadow-md">
            <Sparkles className="w-3.5 h-3.5" /> Criar campanha
          </Button>
        </div>
      </header>

      <CtwaConnectGuide consultantId={consultantId} />

      <ReplicateUberlandiaCard
        consultantId={consultantId}
        onPublished={() => { setRefreshKey((k) => k + 1); setView("campaigns"); }}
      />





      <div className="flex items-center gap-1 rounded-lg bg-secondary p-1 w-full sm:w-fit overflow-x-auto">
        {navItems.map((n) => {
          const Icon = n.icon;
          return (
            <Button
              key={n.id}
              size="sm"
              variant={view === n.id ? "default" : "ghost"}
              onClick={() => setView(n.id)}
              className="h-8 gap-1.5 shrink-0"
            >
              <Icon className="w-3.5 h-3.5" /> {n.label}
            </Button>
          );
        })}
      </div>

      {view === "dashboard" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-2 flex-wrap p-2 rounded-xl bg-card/40 border border-border/40 backdrop-blur">
            <AdAccountSwitcher userId={consultantId} value={adAccountId} onChange={setAdAccountId} />
            <Select value={String(periodDays)} onValueChange={(v) => setPeriodDays(Number(v))}>
              <SelectTrigger className="h-8 w-[140px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="7">Últimos 7 dias</SelectItem>
                <SelectItem value="15">Últimos 15 dias</SelectItem>
                <SelectItem value="30">Últimos 30 dias</SelectItem>
                <SelectItem value="90">Últimos 90 dias</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <AdMetricsCards consultantId={adAccountId} periodDays={periodDays} />
          <AdMetricsCharts consultantId={adAccountId} periodDays={periodDays} managed={managedConsultants} />
          <MainChart data={(analytics as any)?.dailyMain} />

          <div
            data-resize-scope
            className="flex flex-col lg:flex-row gap-4 items-stretch"
            style={{ "--ads-left-w": "50%" } as React.CSSProperties}
          >
            <div className="lg:w-[var(--ads-left-w)] min-w-0">
              <CpcPanel data={(analytics as any)?.cpcByTarget} totalCtaClicks={(analytics as any)?.totalCtaClicks} />
            </div>
            <DragResizer storageKey="ads-cpc" cssVar="ads-left-w" defaultPx={520} minPx={300} maxPx={900} />
            <div className="flex-1 min-w-0">
              <RecentClicks clicks={(analytics as any)?.recentClicks} />
            </div>
          </div>

          <FunnelStrip funnel={(analytics as any)?.funnel} />
          <LeadSourceCard consultantId={adAccountId} periodDays={periodDays} />
        </div>
      )}

      {view === "gallery" && (
        <AdTemplatesGallery consultantId={consultantId} onPublished={() => { setRefreshKey(k => k + 1); setView("campaigns"); }} />
      )}
      {view === "campaigns" && <CampaignsList consultantId={consultantId} refreshKey={refreshKey} />}
      {view === "performance" && (
        <ResultsDashboard
          key={refreshKey}
          consultantId={consultantId}
          onCreateClick={() => setView("gallery")}
        />
      )}
      {view === "intel" && <IntelligenceTab consultantId={consultantId} />}
      {view === "commissions" && <CommissionPanel consultantId={consultantId} />}

      {view !== "dashboard" && view !== "performance" && view !== "commissions" && (
        <div className="rounded-xl border border-dashed border-border/50 bg-card/30 p-3 flex items-start gap-2 text-xs text-muted-foreground">
          <Sparkles className="w-3.5 h-3.5 text-primary mt-0.5 shrink-0" />
          <div>
            Recarregue sua carteira no botão acima e escolha um modelo pronto na <strong className="text-foreground">Galeria</strong>. A campanha sobe pré-otimizada em seu nome
            e os leads caem no WhatsApp já conectado em <strong className="text-foreground">Dados</strong>.
          </div>
        </div>
      )}

      <CreateCampaignWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        consultantId={consultantId}
        onCreated={() => setRefreshKey(k => k + 1)}
      />
    </div>
  );
}
