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
import { HardResetPhoneCard } from "@/components/admin/HardResetPhoneCard";
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
    <div className="pe-page space-y-6">
      <HardResetPhoneCard userId={consultantId} />

      <header className="pe-page-header">
        <div className="min-w-0 flex-1">
          <h2 className="pe-page-title flex items-center gap-2">
            <Megaphone className="w-5 h-5 text-[--pe-accent] shrink-0" />
            Central de Anúncios
          </h2>
          <p className="pe-page-sub">
            Dashboard, modelos prontos, campanhas, performance e inteligência num só lugar.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap shrink-0">
          <SyncMetricsButton consultantId={consultantId} onSynced={() => setRefreshKey((k) => k + 1)} />
          <WalletChip consultantId={consultantId} />
          <button type="button" onClick={() => setWizardOpen(true)} className="pe-chip hidden sm:inline-flex">
            <Plus className="w-3.5 h-3.5" /> Avançado
          </button>
          <Button size="sm" onClick={() => setExpressOpen(true)} className="gap-1.5 h-8">
            <Sparkles className="w-3.5 h-3.5" /> Criar campanha
          </Button>
        </div>
      </header>

      <CtwaConnectGuide consultantId={consultantId} />

      <ReplicateUberlandiaCard
        consultantId={consultantId}
        onPublished={() => { setRefreshKey((k) => k + 1); setView("campaigns"); }}
      />

      <div className="pe-toolbar overflow-x-auto">
        {navItems.map((n) => {
          const Icon = n.icon;
          return (
            <button
              key={n.id}
              type="button"
              onClick={() => setView(n.id)}
              className={`pe-chip ${view === n.id ? "is-active" : ""}`}
            >
              <Icon className="w-3.5 h-3.5" /> {n.label}
            </button>
          );
        })}
      </div>

      {view === "dashboard" && (
        <div className="space-y-4">
          <div className="pe-toolbar">
            <AdAccountSwitcher userId={consultantId} value={adAccountId} onChange={setAdAccountId} />
            <Select value={String(periodDays)} onValueChange={(v) => setPeriodDays(Number(v))}>
              <SelectTrigger className="h-8 w-[150px] text-xs"><SelectValue /></SelectTrigger>
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
      <ExpressCampaignDialog
        open={expressOpen}
        onClose={() => setExpressOpen(false)}
        consultantId={consultantId}
        onCreated={() => { setRefreshKey(k => k + 1); setView("campaigns"); }}
        onOpenAdvanced={() => setWizardOpen(true)}
      />
    </div>
  );
}
