import { useMemo, useState, useEffect, useRef } from "react";
import { Users, Zap, RefreshCw, Loader2, Filter, FileDown, Chrome, ExternalLink, KeyRound, DollarSign, PiggyBank, Crown } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useToast } from "@/hooks/use-toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAnalytics } from "@/hooks/useAnalytics";
import { useTeamConsultantIds } from "@/hooks/useTeamConsultantIds";
import { requestSync as requestExtSync, type SyncResult } from "@/lib/igreenExtensionBridge";
import { StatCard } from "./StatCard";
import { CustomerCharts } from "./CustomerCharts";
import { TopConsumersCard } from "./TopConsumersCard";
import { GeographyCard } from "./GeographyCard";
import { RetentionCard } from "./RetentionCard";
import { isIgreenWalletOrigin } from "@/lib/customerOrigin";
import { TeamRankingTab } from "./TeamRankingTab";
import { PhoneResetButton } from "@/components/superadmin/PhoneResetButton";


// Formata moeda BRL de forma compacta em telas pequenas (R$ 50,4 mil / R$ 1,2 mi)
function formatCompactBRL(value: number): string {
  if (!value) return "R$ 0";
  if (value >= 1_000_000) return `R$ ${(value / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi`;
  if (value >= 10_000) return `R$ ${(value / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`;
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}

interface DashboardTabProps {
  userId: string;
  form?: Record<string, unknown>;
  onFormUpdate?: (updates: Record<string, string>) => void;
  periodDays: number;
  onPeriodChange: (days: number) => void;
}

export function DashboardTab({ userId, periodDays, onPeriodChange }: DashboardTabProps) {
  const [scope, setScope] = useState<"me" | "team">("me");
  const { data: teamIds = [] } = useTeamConsultantIds(userId);
  const isLeader = teamIds.length > 1;
  const { data: analytics } = useAnalytics(
    userId,
    periodDays,
    scope === "team" && isLeader ? teamIds : null,
  );
  const { toast } = useToast();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const [syncingDashboard, setSyncingDashboard] = useState(false);
  const [syncCooldown, setSyncCooldown] = useState(0);
  const [selectedLicenciado, setSelectedLicenciado] = useState("all");
  const [extDialog, setExtDialog] = useState<null | "no_extension" | "no_token" | "not_logged_in" | "failed">(null);
  const [extDialogMsg, setExtDialogMsg] = useState<string>("");
  const dashboardRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState(false);
  const [resettingPerf, setResettingPerf] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("sync_cooldown_until");
    if (stored) { const remaining = Math.ceil((parseInt(stored) - Date.now()) / 1000); if (remaining > 0) setSyncCooldown(remaining); }
  }, []);

  useEffect(() => {
    if (syncCooldown <= 0) return;
    const timer = setInterval(() => { setSyncCooldown((prev) => { if (prev <= 1) { clearInterval(timer); return 0; } return prev - 1; }); }, 1000);
    return () => clearInterval(timer);
  }, [syncCooldown]);

  const startCooldown = () => { setSyncCooldown(30); localStorage.setItem("sync_cooldown_until", String(Date.now() + 30000)); };

  const licenciadoOptions = useMemo(() => {
    if (!analytics?.allCustomers) return [];
    const names = new Set<string>();
    for (const c of analytics.allCustomers) {
      if (!isIgreenWalletOrigin(c.customer_origin)) continue;
      if (c.registered_by_name) names.add(c.registered_by_name);
    }
    return Array.from(names).sort();
  }, [analytics?.allCustomers]);

  const filteredMetrics = useMemo(() => {
    if (!analytics) return null;
    const walletOnly = analytics.allCustomers.filter((c: any) => isIgreenWalletOrigin(c.customer_origin));
    const filtered = selectedLicenciado === "all" ? walletOnly : walletOnly.filter((c: any) => c.registered_by_name === selectedLicenciado);
    const totalCustomers = filtered.length;
    const totalKw = filtered.reduce((sum: number, c: any) => sum + (Number(c.media_consumo) || 0), 0);
    const withConsumption = filtered.filter((c: any) => Number(c.media_consumo) > 0);
    const avgKw = withConsumption.length > 0 ? totalKw / withConsumption.length : 0;

    // Estimativa: clientes iGreen não trazem electricity_bill_value, usamos media_consumo (kWh) × tarifa média (R$ 0,95)
    const TARIFA_MEDIA = 0.95;
    const billOf = (c: any) => {
      const real = Number(c.electricity_bill_value) || 0;
      if (real > 0) return real;
      const kwh = Number(c.media_consumo) || 0;
      return kwh * TARIFA_MEDIA;
    };
    const withBill = filtered.filter((c: any) => billOf(c) > 0);
    const totalBill = withBill.reduce((s: number, c: any) => s + billOf(c), 0);
    const avgBill = withBill.length > 0 ? totalBill / withBill.length : 0;
    const economiaGerada = totalBill * 0.20;

    const statusMap = new Map<string, number>();
    for (const c of filtered) { const s = (c as any).status || "pending"; statusMap.set(s, (statusMap.get(s) || 0) + 1); }
    const statusLabels: Record<string, string> = { approved: "Aprovados", pending: "Pendentes", rejected: "Reprovados", lead: "Clientes interessados", devolutiva: "Devolutiva", awaiting_signature: "Falta Assinatura", data_complete: "Dados Completos", registered_igreen: "Cadastrado iGreen", contract_sent: "Contrato Enviado" };
    const chartOnlyStatuses = ["approved", "devolutiva", "rejected"];
    for (const s of chartOnlyStatuses) { if (!statusMap.has(s)) statusMap.set(s, 0); }
    const customersByStatus = Array.from(statusMap.entries()).filter(([status]) => chartOnlyStatuses.includes(status)).map(([status, count]) => ({ status, count, label: statusLabels[status] || status.charAt(0).toUpperCase() + status.slice(1) })).sort((a, b) => b.count - a.count);

    const daysAgoDate = new Date(); daysAgoDate.setDate(daysAgoDate.getDate() - periodDays);
    const weeks = Math.ceil(periodDays / 7);
    const weekMap = new Map<string, number>();
    for (let i = weeks - 1; i >= 0; i--) {
      const start = new Date(); start.setDate(start.getDate() - (i + 1) * 7);
      const end = new Date(); end.setDate(end.getDate() - i * 7);
      weekMap.set(`${start.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} - ${end.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}`, 0);
    }
    for (const c of filtered) {
      const created = new Date((c as any).created_at);
      if (created >= daysAgoDate) {
        const daysAgo = Math.floor((Date.now() - created.getTime()) / (1000 * 60 * 60 * 24));
        const weekIdx = Math.min(weeks - 1, Math.floor(daysAgo / 7));
        const keys = Array.from(weekMap.keys());
        const key = keys[keys.length - 1 - weekIdx];
        if (key) weekMap.set(key, (weekMap.get(key) || 0) + 1);
      }
    }
    const weeklyNewCustomers = Array.from(weekMap.entries()).map(([week, count]) => ({ week, count }));
    return { totalCustomers, totalKw, avgKw, avgBill, economiaGerada, customersByStatus, weeklyNewCustomers, filteredCustomers: filtered };
  }, [analytics, selectedLicenciado, periodDays]);

  const handleDashboardSync = async () => {
    setSyncingDashboard(true);
    try {
      const res: SyncResult = await requestExtSync();
      if (res.ok === false) {
        if (res.reason === "no_extension") {
          setExtDialogMsg("Não detectamos a extensão iGreen Sync neste navegador. Instale a extensão para sincronizar seus clientes e rede com 1 clique.");
          setExtDialog("no_extension");
        } else if (res.reason === "no_token") {
          setExtDialogMsg("A extensão está instalada mas ainda não foi pareada. Gere um token no painel e cole na extensão.");
          setExtDialog("no_token");
        } else if (res.reason === "not_logged_in") {
          setExtDialogMsg("Você precisa estar logado no escritório iGreen em outra aba deste mesmo navegador para a extensão conseguir baixar seus dados.");
          setExtDialog("not_logged_in");
        } else {
          setExtDialogMsg(res.error || "Falha ao sincronizar. Tente novamente em alguns segundos.");
          setExtDialog("failed");
        }
        return;
      }
      startCooldown();
      toast({ title: "✅ Sincronização concluída!", description: "Clientes e rede atualizados a partir do portal iGreen." });
      queryClient.invalidateQueries({ queryKey: ["analytics"] });
    } catch (err: unknown) {
      toast({ title: "Erro na sincronização", description: err instanceof Error ? err.message : "Erro desconhecido", variant: "destructive" });
    } finally {
      setSyncingDashboard(false);
    }
  };

  const handleExportPdf = async () => {
    if (!dashboardRef.current) return;
    setExporting(true);
    try {
      const html2canvas = (await import("html2canvas")).default;
      const { jsPDF } = await import("jspdf");
      const canvas = await html2canvas(dashboardRef.current, { scale: 1.5, useCORS: true, backgroundColor: "#0a0a0a" });
      const imgData = canvas.toDataURL("image/jpeg", 0.85);
      const pdf = new jsPDF("p", "mm", "a4");
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
      let heightLeft = pdfHeight; let position = 0;
      pdf.addImage(imgData, "JPEG", 0, position, pdfWidth, pdfHeight);
      heightLeft -= pdf.internal.pageSize.getHeight();
      while (heightLeft > 0) { position -= pdf.internal.pageSize.getHeight(); pdf.addPage(); pdf.addImage(imgData, "JPEG", 0, position, pdfWidth, pdfHeight); heightLeft -= pdf.internal.pageSize.getHeight(); }
      pdf.save(`relatorio-${new Date().toISOString().split("T")[0]}.pdf`);
      toast({ title: "✅ PDF exportado!" });
    } catch { toast({ title: "Erro ao exportar PDF", variant: "destructive" }); }
    finally { setExporting(false); }
  };

  const handleResetPerformance = async () => {
    const ok = await confirm({
      title: "Apagar todo o histórico de performance?",
      description: "Apaga visitas, cliques e eventos das suas landing pages. Clientes e mensagens NÃO serão apagados. Esta ação não pode ser desfeita.",
      confirmText: "Apagar histórico",
      tone: "danger",
    });
    if (!ok) return;
    setResettingPerf(true);
    try {
      const { data, error } = await supabase.rpc("reset_consultant_analytics" as any, { _consultant_id: userId });
      if (error) throw error;
      const d = (data as any)?.deleted ?? {};
      toast({
        title: "✅ Performance resetada",
        description: `Apagados: ${d.page_views ?? 0} visitas, ${d.page_events ?? 0} cliques, ${d.crm_page_events ?? 0} eventos CRM, ${d.facebook_capi_events ?? 0} eventos Facebook.`,
      });
      queryClient.invalidateQueries({ queryKey: ["analytics"] });
    } catch (err: unknown) {
      toast({ title: "Erro ao resetar", description: err instanceof Error ? err.message : "Erro desconhecido", variant: "destructive" });
    } finally {
      setResettingPerf(false);
    }
  };

  return (
    <div ref={dashboardRef} className="space-y-6">

      {/* TOOLBAR */}
      <div className="flex items-center justify-between gap-1.5 flex-wrap p-1.5 rounded-xl bg-card/40 border border-border/40 backdrop-blur">
        <div className="flex items-center gap-1.5 flex-wrap min-w-0">
          <Select value={selectedLicenciado} onValueChange={setSelectedLicenciado}>
            <SelectTrigger className="h-7 w-[150px] sm:w-[180px] text-[11px] px-2"><Filter className="w-3 h-3 mr-1 shrink-0" /><SelectValue placeholder="Licenciado" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os Licenciados</SelectItem>
              {licenciadoOptions.map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={handleDashboardSync} disabled={syncingDashboard || syncCooldown > 0} className="h-7 text-[11px] px-2 gap-1" title="Sincronizar iGreen">
            {syncingDashboard ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            <span className="hidden lg:inline">{syncingDashboard ? "Sincronizando..." : syncCooldown > 0 ? `${syncCooldown}s` : "Sincronizar"}</span>
          </Button>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <Select value={String(periodDays)} onValueChange={(v) => onPeriodChange(Number(v))}>
            <SelectTrigger className="h-7 w-[110px] text-[11px] px-2"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Últimos 7 dias</SelectItem>
              <SelectItem value="15">Últimos 15 dias</SelectItem>
              <SelectItem value="30">Últimos 30 dias</SelectItem>
              <SelectItem value="90">Últimos 90 dias</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={handleExportPdf} disabled={exporting} className="h-7 text-[11px] px-2 gap-1" title="Exportar PDF">
            {exporting ? <Loader2 className="w-3 h-3 animate-spin" /> : <FileDown className="w-3 h-3" />}
            <span className="hidden lg:inline">{exporting ? "Gerando..." : "PDF"}</span>
          </Button>
          {/* Manutenção — reset do número de teste (apenas super admin) */}
          <PhoneResetButton userId={userId} />
        </div>
      </div>



      {/* Toggle Líder */}
      {isLeader && (
        <div className="flex items-center gap-2">
          <Crown className="w-4 h-4 text-primary" />
          <ToggleGroup type="single" value={scope} onValueChange={(v) => v && setScope(v as "me" | "team")} className="bg-card/40 border border-border/40 rounded-lg p-1">
            <ToggleGroupItem value="me" className="h-7 px-3 text-xs">Meus clientes</ToggleGroupItem>
            <ToggleGroupItem value="team" className="h-7 px-3 text-xs">Minha equipe ({teamIds.length})</ToggleGroupItem>
          </ToggleGroup>
        </div>
      )}

      {/* CLIENTES iGREEN — 5 cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 sm:gap-4">
        <StatCard icon={<Users className="w-5 h-5" />} label="Total de Clientes" value={filteredMetrics?.totalCustomers ?? 0} color="primary" />
        <StatCard icon={<Zap className="w-5 h-5" />} label="Média kWh/cliente" value={`${(filteredMetrics?.avgKw ?? 0).toLocaleString("pt-BR", { maximumFractionDigits: 0 })} kW`} color="accent" subtitle={`Total: ${(filteredMetrics?.totalKw ?? 0).toLocaleString("pt-BR")} kW`} />
        <StatCard icon={<DollarSign className="w-5 h-5" />} label="Ticket médio (conta)" value={formatCompactBRL(filteredMetrics?.avgBill ?? 0)} color="primary" subtitle="estimado pela tarifa média" />
        <StatCard icon={<PiggyBank className="w-5 h-5" />} label="Economia gerada" value={formatCompactBRL(filteredMetrics?.economiaGerada ?? 0)} color="accent" subtitle="20% sobre a conta estimada" />
      </div>

      <CustomerCharts filteredMetrics={filteredMetrics} topLicenciados={analytics?.topLicenciados} />

      <TopConsumersCard customers={filteredMetrics?.filteredCustomers} />
      <GeographyCard customers={filteredMetrics?.filteredCustomers} />
      <RetentionCard customers={filteredMetrics?.filteredCustomers} />


      {/* Extensão iGreen Sync — diálogos de status */}
      <Dialog open={extDialog !== null} onOpenChange={(o) => !o && setExtDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {extDialog === "not_logged_in" ? <KeyRound className="w-5 h-5 text-primary" /> : <Chrome className="w-5 h-5 text-primary" />}
              {extDialog === "no_extension" && "Instale a extensão iGreen Sync"}
              {extDialog === "no_token" && "Extensão sem pareamento"}
              {extDialog === "not_logged_in" && "Faça login no escritório iGreen"}
              {extDialog === "failed" && "Falha na sincronização"}
            </DialogTitle>
            <DialogDescription className="pt-2">{extDialogMsg}</DialogDescription>
          </DialogHeader>
          {extDialog === "not_logged_in" && (
            <div className="text-xs text-muted-foreground rounded-lg border border-border bg-muted/40 p-3">
              <strong>Como resolver:</strong> abra <code>escritorio.igreenenergy.com.br</code> em outra aba, faça login (resolva o captcha se aparecer) e volte aqui para clicar em <b>Sincronizar</b> novamente.
            </div>
          )}
          <DialogFooter className="gap-2 sm:gap-2">
            {extDialog === "not_logged_in" && (
              <Button asChild>
                <a href="https://escritorio.igreenenergy.com.br/" target="_blank" rel="noreferrer">
                  <ExternalLink className="w-4 h-4 mr-2" /> Abrir escritório iGreen
                </a>
              </Button>
            )}
            {(extDialog === "no_extension" || extDialog === "no_token") && (
              <Button onClick={() => { setExtDialog(null); window.dispatchEvent(new CustomEvent("open-admin-settings")); }}>
                <Chrome className="w-4 h-4 mr-2" /> Abrir extensão no painel
              </Button>
            )}
            <Button variant="outline" onClick={() => setExtDialog(null)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
