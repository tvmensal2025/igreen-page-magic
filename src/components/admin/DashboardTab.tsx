import { useMemo, useState, useEffect, useRef } from "react";
import { Eye as EyeIcon, EyeOff, Users, Zap, TrendingUp, RefreshCw, Loader2, Filter, KeyRound, FileDown, AlertTriangle, Trash2, DollarSign, PiggyBank, Crown } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useToast } from "@/hooks/use-toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAnalytics } from "@/hooks/useAnalytics";
import { useTeamConsultantIds } from "@/hooks/useTeamConsultantIds";
import { useUserRole } from "@/hooks/useUserRole";
import { adminHardResetPhone, adminHardResetPhoneTraceCounts } from "@/services/resetConversation";
import { StatCard } from "./StatCard";
import { HardResetPhoneCard } from "./HardResetPhoneCard";
import { CustomerCharts } from "./CustomerCharts";
import { TopConsumersCard } from "./TopConsumersCard";
import { GeographyCard } from "./GeographyCard";
import { RetentionCard } from "./RetentionCard";
import { TeamRankingTab } from "./TeamRankingTab";
import { IGreenExtensionCard } from "./IGreenExtensionCard";

// Formata moeda BRL de forma compacta em telas pequenas (R$ 50,4 mil / R$ 1,2 mi)
function formatCompactBRL(value: number): string {
  if (!value) return "R$ 0";
  if (value >= 1_000_000) return `R$ ${(value / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi`;
  if (value >= 10_000) return `R$ ${(value / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`;
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}

interface DashboardTabProps {
  userId: string;
  form: { igreen_portal_email: string; igreen_portal_password: string };
  onFormUpdate: (updates: Record<string, string>) => void;
  periodDays: number;
  onPeriodChange: (days: number) => void;
}

export function DashboardTab({ userId, form, onFormUpdate, periodDays, onPeriodChange }: DashboardTabProps) {
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
  const [showCredentialsDialog, setShowCredentialsDialog] = useState(false);
  const [credForm, setCredForm] = useState({ email: "", password: "" });
  const [showCredPassword, setShowCredPassword] = useState(false);
  const dashboardRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState(false);
  const [resettingPerf, setResettingPerf] = useState(false);
  const [sharedAccountCount, setSharedAccountCount] = useState(0);
  const { isAdmin } = useUserRole(userId);
  const [resetPhone, setResetPhone] = useState("");
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("sync_cooldown_until");
    if (stored) { const remaining = Math.ceil((parseInt(stored) - Date.now()) / 1000); if (remaining > 0) setSyncCooldown(remaining); }
  }, []);

  useEffect(() => {
    const email = form.igreen_portal_email?.trim().toLowerCase();
    if (!email) { setSharedAccountCount(0); return; }
    let cancelled = false;
    (async () => {
      try {
        const { count } = await supabase
          .from("consultants")
          .select("id", { count: "exact", head: true })
          .eq("igreen_portal_email", email);
        if (cancelled) return;
        setSharedAccountCount(Math.max(0, (count ?? 1) - 1));
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [form.igreen_portal_email]);

  useEffect(() => {
    if (syncCooldown <= 0) return;
    const timer = setInterval(() => { setSyncCooldown((prev) => { if (prev <= 1) { clearInterval(timer); return 0; } return prev - 1; }); }, 1000);
    return () => clearInterval(timer);
  }, [syncCooldown]);

  const startCooldown = () => { setSyncCooldown(60); localStorage.setItem("sync_cooldown_until", String(Date.now() + 60000)); };

  const licenciadoOptions = useMemo(() => {
    if (!analytics?.allCustomers) return [];
    const names = new Set<string>();
    for (const c of analytics.allCustomers) {
      if (c.customer_origin !== "igreen_sync") continue;
      if (c.registered_by_name) names.add(c.registered_by_name);
    }
    return Array.from(names).sort();
  }, [analytics?.allCustomers]);

  const filteredMetrics = useMemo(() => {
    if (!analytics) return null;
    const walletOnly = analytics.allCustomers.filter((c: any) => c.customer_origin === "igreen_sync");
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
    const statusLabels: Record<string, string> = { approved: "Aprovados", pending: "Pendentes", rejected: "Reprovados", lead: "Leads", devolutiva: "Devolutiva", awaiting_signature: "Falta Assinatura", data_complete: "Dados Completos", registered_igreen: "Cadastrado iGreen", contract_sent: "Contrato Enviado" };
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

  const runSync = async () => {
    setSyncingDashboard(true); startCooldown();
    try {
      // 1) Clientes — edge function carrega credenciais salvas via service_role.
      const { data: cData, error: cErr } = await supabase.functions.invoke("sync-igreen-customers", {
        body: { consultant_id: userId },
      });
      if (cErr) throw cErr;
      if (!cData?.success) {
        toast({ title: "Erro ao sincronizar clientes", description: cData?.error || "Erro desconhecido", variant: "destructive" });
        return;
      }
      // 2) Rede (delay 3s p/ evitar rate-limit do portal)
      await new Promise((r) => setTimeout(r, 3000));
      const { data: nData, error: nErr } = await supabase.functions.invoke("sync-igreen-customers", {
        body: { consultant_id: userId, mode: "sync_network" },
      });
      if (nErr) throw nErr;
      if (!nData?.success) {
        toast({
          title: "Clientes OK, mas falhou a rede",
          description: nData?.error || "Erro desconhecido ao sincronizar a rede.",
          variant: "destructive",
        });
      } else {
        toast({
          title: "✅ Sincronização concluída!",
          description: `${cData.processed ?? cData.updated ?? 0} clientes • ${nData.total_members ?? 0} membros da rede`,
        });
      }
      queryClient.invalidateQueries({ queryKey: ["analytics"] });
    } catch (err: unknown) {
      toast({ title: "Erro na sincronização", description: err instanceof Error ? err.message : "Erro desconhecido", variant: "destructive" });
    } finally { setSyncingDashboard(false); }
  };

  const handleDashboardSync = () => {
    // Senha não é mais lida do banco; basta ter email configurado para acionar.
    if (form.igreen_portal_email) runSync();
    else { setCredForm({ email: "", password: "" }); setShowCredentialsDialog(true); }
  };

  const handleSaveCredentialsAndSync = async () => {
    if (!credForm.email || !credForm.password) return;
    try {
      const { error } = await supabase.from("consultants").update({ igreen_portal_email: credForm.email, igreen_portal_password: credForm.password }).eq("id", userId);
      if (error) throw error;
      onFormUpdate({ igreen_portal_email: credForm.email, igreen_portal_password: credForm.password });
      setShowCredentialsDialog(false);
      toast({ title: "✅ Credenciais salvas!", description: "Baixando clientes e rede do portal iGreen…" });
      runSync();
    } catch (err: unknown) { toast({ title: "Erro ao salvar credenciais", description: err instanceof Error ? err.message : "Erro", variant: "destructive" }); }
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

  const handleHardResetPhone = async () => {
    const phone = resetPhone.trim();
    if (!phone) {
      toast({ title: "Informe um telefone", variant: "destructive" });
      return;
    }
    const ok = await confirm({
      title: `Apagar todos os rastros do telefone ${phone}?`,
      description: "Isto apaga customers, mensagens, fluxo, IA, CRM, logs e eventos relacionados. NÃO pode ser desfeito.",
      confirmText: "Apagar tudo",
      tone: "danger",
    });
    if (!ok) return;
    setResetting(true);
    try {
      const res = await adminHardResetPhone(phone);
      if (res.ok !== true) {
        toast({ title: "Erro no reset", description: res.error, variant: "destructive" });
        return;
      }
      const totals = Object.entries(res.deleted)
        .filter(([, n]) => typeof n === "number" && n > 0)
        .map(([k, n]) => `${k}: ${n}`)
        .join(" · ");
      const trace = await adminHardResetPhoneTraceCounts(phone);
      if (trace.ok && trace.totalRemaining > 0) {
        const remaining = Object.entries(trace.counts)
          .filter(([, n]) => Number(n) > 0)
          .map(([k, n]) => `${k}: ${n}`)
          .join(" · ");
        toast({
          title: "Reset incompleto",
          description: `Ainda restam ${trace.totalRemaining} rastros: ${remaining}`,
          variant: "destructive",
        });
        queryClient.invalidateQueries();
        return;
      }
      toast({
        title: "✅ Telefone zerado confirmado",
        description: `${trace.ok ? trace.phoneNormalized : res.phoneNormalized} — ${totals || "nada a apagar"}`,
      });
      queryClient.invalidateQueries();
    } catch (err: unknown) {
      toast({ title: "Erro no reset", description: err instanceof Error ? err.message : "Erro", variant: "destructive" });
    } finally {
      setResetting(false);
    }
  };

  return (
    <div ref={dashboardRef} className="space-y-6">
      {sharedAccountCount > 0 && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <div className="text-amber-200/90">
            <strong className="text-amber-300">Conta iGreen compartilhada</strong> com {sharedAccountCount} outro{sharedAccountCount > 1 ? "s" : ""} consultor{sharedAccountCount > 1 ? "es" : ""}.
            Cada consultor vê apenas seus próprios clientes no painel — a sincronização não afeta os dados dos outros.
          </div>
        </div>
      )}

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
            <span className="hidden sm:inline">{syncingDashboard ? "Sincronizando..." : syncCooldown > 0 ? `${syncCooldown}s` : "Sincronizar"}</span>
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
            <span className="hidden sm:inline">{exporting ? "Gerando..." : "PDF"}</span>
          </Button>
        </div>
      </div>

      {/* SINCRONIZACAO via extensao do navegador */}
      <IGreenExtensionCard userId={userId} />

      {/* MANUTENÇÃO — Hard reset por telefone (admin only, temporário) */}
      <HardResetPhoneCard userId={userId} />


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


      {/* Credentials Dialog */}
      <Dialog open={showCredentialsDialog} onOpenChange={setShowCredentialsDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><KeyRound className="w-5 h-5 text-primary" />Conectar ao Portal iGreen</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Informe suas credenciais do portal iGreen para sincronizar seus clientes automaticamente.</p>
          <div className="space-y-4 mt-2">
            <div><Label htmlFor="cred-email">Email do Portal</Label><Input id="cred-email" type="email" placeholder="seu@email.com" value={credForm.email} onChange={(e) => setCredForm(prev => ({ ...prev, email: e.target.value }))} /></div>
            <div>
              <Label htmlFor="cred-password">Senha do Portal</Label>
              <div className="relative">
                <Input id="cred-password" type={showCredPassword ? "text" : "password"} placeholder="••••••••" value={credForm.password} onChange={(e) => setCredForm(prev => ({ ...prev, password: e.target.value }))} />
                <button type="button" onClick={() => setShowCredPassword(!showCredPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  {showCredPassword ? <EyeOff className="w-4 h-4" /> : <EyeIcon className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <Button className="w-full" onClick={handleSaveCredentialsAndSync} disabled={!credForm.email || !credForm.password}><RefreshCw className="w-4 h-4 mr-2" />Conectar e Sincronizar</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
