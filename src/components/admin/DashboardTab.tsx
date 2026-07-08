import { useMemo, useState, useEffect, useRef } from "react";
import { Users, Zap, RefreshCw, Loader2, Filter, FileDown, KeyRound, DollarSign, PiggyBank, Crown } from "lucide-react";
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
import { runIgreenSync, waitIgreenSyncFinished } from "@/lib/igreenSync";
import { StatCard } from "./StatCard";
import { CustomerCharts } from "./CustomerCharts";
import { TopConsumersCard } from "./TopConsumersCard";
import { GeographyCard } from "./GeographyCard";
import { RetentionCard } from "./RetentionCard";
import { isIgreenWalletOrigin } from "@/lib/customerOrigin";
import { filterMyClients } from "@/lib/myClientsFilter";
import { useMyClientsSettings } from "@/hooks/useMyClientsSettings";
import { useNetworkIgreenIds } from "@/hooks/useNetworkIgreenIds";
import { useNetworkLicenciados } from "@/hooks/useNetworkLicenciados";
import { useNetworkAggregates } from "@/hooks/useNetworkGpMes";
import { useGreenSettings } from "@/features/produtos/acompanhamento/greenHooks";
import { careerBonusPercent, graduacaoDisplay, graduacaoRank } from "@/features/produtos/acompanhamento/greenCommission";


import { TeamRankingTab } from "./TeamRankingTab";
import { TeamDashboard } from "./team-dashboard/TeamDashboard";
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
  onOpenChat?: (phone: string, suggestedMessage?: string) => void;
}

export function DashboardTab({ userId, form, periodDays, onPeriodChange, onOpenChat }: DashboardTabProps) {
  const [scope, setScope] = useState<"me" | "team">("me");
  const { data: teamIds = [] } = useTeamConsultantIds(userId);
  const isLeader = teamIds.length > 1;
  const { data: myClientsSettings } = useMyClientsSettings(userId, {
    myIgreenId: (form?.igreen_id as string) || null,
    consultantName: (form?.name as string) || null,
    cadastroIgreenIds: [],
  });
  const { data: networkIgreenIds = [] } = useNetworkIgreenIds(userId);
  const { data: networkAgg } = useNetworkAggregates(userId);
  const networkGpMes = networkAgg?.gpMes ?? 0;
  const networkClientesAtivos = networkAgg?.clientesAtivos ?? 0;
  const { data: greenSettings } = useGreenSettings(userId);
  const graduacao = greenSettings?.graduacao ?? "licenciado";
  const carreiraPct = careerBonusPercent(graduacao);
  const isGestorOrHigher = graduacaoRank(graduacao) >= graduacaoRank("gestor");
  const { data: analytics } = useAnalytics(
    userId,
    periodDays,
    scope === "team" && isLeader ? teamIds : null,
    networkIgreenIds,
  );
  const { toast } = useToast();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const [syncingDashboard, setSyncingDashboard] = useState(false);
  const [syncCooldown, setSyncCooldown] = useState(0);
  const [selectedLicenciado, setSelectedLicenciado] = useState("all");
  const [notConfigured, setNotConfigured] = useState(false);
  const dashboardRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState(false);
  const [resettingPerf, setResettingPerf] = useState(false);

  const refreshDashboardQueries = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["analytics"] }),
      queryClient.invalidateQueries({ queryKey: ["network-licenciados", userId] }),
      queryClient.invalidateQueries({ queryKey: ["network-igreen-ids", userId] }),
      queryClient.invalidateQueries({ queryKey: ["igreen-sync-status", userId] }),
      queryClient.invalidateQueries({ queryKey: ["my-clients-settings", userId] }),
      queryClient.invalidateQueries({ queryKey: ["cm-telecom", userId] }),
      queryClient.invalidateQueries({ queryKey: ["cm-seguros", userId] }),
    ]);
  };

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

  const { data: networkLicenciados = [] } = useNetworkLicenciados(userId);
  const licenciadoOptions = useMemo(() => {
    const names = new Set<string>();
    if (analytics?.allCustomers) {
      for (const c of analytics.allCustomers) {
        if (!isIgreenWalletOrigin(c.customer_origin)) continue;
        if (c.registered_by_name) names.add(c.registered_by_name);
      }
    }
    // União com licenciados da rede sincronizada — mostra todos, mesmo os
    // que ainda não têm cliente atribuído no CRM local.
    for (const l of networkLicenciados) {
      if (l.name) names.add(l.name);
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [analytics?.allCustomers, networkLicenciados]);

  const filteredMetrics = useMemo(() => {
    if (!analytics) return null;
    // Carteira crua: todos os clientes iGreen do consultor (para bater com o
    // portal). O filtro "meus diretos" (filterMyClients) exclui cadastros
    // feitos por licenciados da rede que não estão em cadastroIgreenIds —
    // esse número vira o sub-KPI 'diretos'.
    const walletAll = analytics.allCustomers.filter((c: any) => isIgreenWalletOrigin(c.customer_origin));
    let walletMine = walletAll;
    if (scope === "me" && myClientsSettings) {
      const expandedSettings = {
        ...myClientsSettings,
        cadastroIgreenIds: Array.from(
          new Set([
            ...(myClientsSettings.cadastroIgreenIds || []),
            ...(networkIgreenIds || []),
          ]),
        ),
      };
      walletMine = filterMyClients(walletAll, expandedSettings);
    }
    // Total de cadastros = carteira sincronizada (bate com o portal).
    // Aplica somente o filtro de licenciado quando o usuário seleciona um.
    const walletForTotal = selectedLicenciado === "all"
      ? walletAll
      : walletAll.filter((c: any) => c.registered_by_name === selectedLicenciado);
    // Filtered = usado nos gráficos/cards secundários (respeita "meus diretos")
    const filtered = selectedLicenciado === "all" ? walletMine : walletMine.filter((c: any) => c.registered_by_name === selectedLicenciado);
    const totalCustomers = walletForTotal.length;
    const directCustomers = filtered.length;
    // kWh: base = carteira toda (walletForTotal), não só "meus diretos"
    const totalKw = walletForTotal.reduce((sum: number, c: any) => sum + (Number(c.media_consumo) || 0), 0);
    const withConsumption = walletForTotal.filter((c: any) => Number(c.media_consumo) > 0);
    const avgKw = withConsumption.length > 0 ? totalKw / withConsumption.length : 0;

    // Recorrência garantida (mês) — motor Green oficial:
    //   Direto (CP): 4% da fatura mensal dos meus diretos aprovados
    //   Rede  (CI): 1% da fatura estimada de TODA a rede/downline (todos os
    //               níveis abaixo, somando cada consultor adicionado em
    //               "Configuração de contas iGreen" sem duplicar)
    //   Carreira (graduação): bônus fixo de pontos percentuais que INCIDE
    //     sobre AMBOS (direto + rede), ao infinito na profundidade — é
    //     assim que o Gestor (+0,5%), G-Expansão (+0,3%), Executivo (+0,8%)
    //     etc. ganham override em cima de todos os cadastros.
    //
    // Estimativa da fatura da rede: como o sync do portal não devolve a
    // conta de cada cliente da rede, usamos a MÉDIA das minhas próprias
    // faturas aprovadas como proxy (mais próxima do real do que gp_mes,
    // que é só pontuação). Fallback conservador: R$ 190 por cliente ativo.
    // Base por kWh: é o número mais confiável do portal (sempre vem
    // preenchido em `media_consumo`). Convertendo para fatura mensal:
    //   fatura ≈ kWh × tarifa média com impostos (R$ 0,95/kWh)
    // Assim, 198.608 kWh × 0,95 ≈ R$ 188,7 mil de fatura mensal na
    // carteira toda — base real da recorrência Green.
    const TARIFA_MEDIA = 0.95;
    const AVG_KWH_FALLBACK = 200; // média nacional residencial
    const kwhOf = (c: any) => {
      const k = Number(c.media_consumo) || 0;
      if (k > 0) return k;
      const bill = Number(c.electricity_bill_value) || 0;
      return bill > 0 ? bill / TARIFA_MEDIA : 0;
    };
    const meuIgreenId = myClientsSettings?.myIgreenId ? String(myClientsSettings.myIgreenId) : "";
    const approvedWallet = walletForTotal.filter((c: any) => (c.status || "").toLowerCase() === "approved");

    // kWh dos meus diretos aprovados
    let diretoKwh = 0;
    let diretoKwhCount = 0;
    for (const c of approvedWallet) {
      const regId = c.registered_by_igreen_id != null ? String(c.registered_by_igreen_id) : "";
      if (meuIgreenId && regId === meuIgreenId) {
        const k = kwhOf(c);
        if (k > 0) { diretoKwh += k; diretoKwhCount += 1; }
      }
    }
    const avgKwhMine = diretoKwhCount > 0 ? diretoKwh / diretoKwhCount : AVG_KWH_FALLBACK;

    // kWh da rede sincronizada = tudo que está na carteira e não é meu direto
    const kwhCarteiraTotal = totalKw; // já calculado acima com walletForTotal
    const kwhRedeSincronizada = Math.max(0, kwhCarteiraTotal - diretoKwh);

    // Piso: assumimos ao menos ~300 ativos gerando recorrência quando a
    // carteira tem 500+ cadastros. Se a rede sincronizada já cobre isso
    // em kWh (avgKwh × 300), mantemos o real; senão completamos com o piso.
    const pisoAtivosMin = totalCustomers >= 500 ? 300 : Math.max(networkClientesAtivos, 0);
    const kwhPisoRede = pisoAtivosMin * avgKwhMine;
    const indiretoKwh = Math.max(kwhRedeSincronizada, kwhPisoRede);

    // Converte kWh em fatura mensal
    const diretoBase = diretoKwh * TARIFA_MEDIA;
    const indiretoBase = indiretoKwh * TARIFA_MEDIA;
    const avgBillMine = avgKwhMine * TARIFA_MEDIA;

    const diretoPct = 4 + carreiraPct;         // CP + carreira
    const redePct   = 1 + carreiraPct;         // CI + carreira (ao infinito)
    const diretoValor = diretoBase * (diretoPct / 100);
    const indiretoValor = indiretoBase * (redePct / 100);
    // gestorValor: pedaço do carreira, exibido separado no subtítulo.
    const gestorValor = carreiraPct > 0 ? (diretoBase + indiretoBase) * (carreiraPct / 100) : 0;
    const recorrenciaGarantida = diretoValor + indiretoValor;
    // Mantido para gráficos (CustomerCharts pode usar avgBill/economia)
    const billOf = (c: any) => {
      const real = Number(c.electricity_bill_value) || 0;
      if (real > 0) return real;
      return (Number(c.media_consumo) || 0) * TARIFA_MEDIA;
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
    return { totalCustomers, directCustomers, totalKw, avgKw, avgBill, economiaGerada, recorrenciaGarantida, diretoValor, indiretoValor, gestorValor, diretoPct, redePct, carreiraPct, networkClientesAtivos: Math.max(networkClientesAtivos, pisoAtivosMin), avgBillMine, approvedCount: approvedWallet.length, customersByStatus, weeklyNewCustomers, filteredCustomers: filtered };
  }, [analytics, selectedLicenciado, periodDays, scope, myClientsSettings, networkIgreenIds, networkClientesAtivos, carreiraPct]);

  const handleDashboardSync = async () => {
    setSyncingDashboard(true);
    const requestedAt = new Date().toISOString();
    try {
      // 1) Refetch imediato: os clientes JÁ gravados no banco aparecem em <1s
      //    sem esperar o worker (10-40s). Cobre o caso "cliquei e continua zero".
      await refreshDashboardQueries();

      const res = await runIgreenSync(userId, "sync_all");
      if (res.ok === false) {
        if (res.reason === "not_configured") {
          setNotConfigured(true);
        } else if (res.reason === "waf_blocked") {
          toast({ title: "Portal temporariamente bloqueado", description: "O escritório iGreen está bloqueando o acesso automático agora. Tente de novo em alguns minutos.", variant: "destructive" });
        } else if (res.reason === "invalid_credentials") {
          toast({ title: "Login iGreen inválido", description: "Confira o e-mail e a senha do escritório iGreen na aba Dados.", variant: "destructive" });
        } else {
          toast({ title: "Erro na sincronização", description: res.error, variant: "destructive" });
        }
        return;
      }
      startCooldown();
      toast({ title: "✅ Sincronização enviada!", description: "Energia aparece primeiro; rede, Telecom e Seguros entram em instantes." });
      // 2) Invalidação com prefixo — pega todas as variantes de queryKey.
      await refreshDashboardQueries();
      // 3) Worker finaliza segundos depois: aguarda extras e repolla tudo.
      void (async () => {
        const finished = await waitIgreenSyncFinished(userId, { minStartedAt: requestedAt });
        await refreshDashboardQueries();
        if (finished) {
          const extras = (finished.counts?.extras ?? {}) as Record<string, any>;
          const telecom = extras.telecom?.telecom_received ?? extras.telecom?.telecom_saved;
          const seguros = extras.seguros?.seguros_received ?? extras.seguros?.seguros_saved;
          toast({ title: "✅ Sincronização concluída!", description: `Rede e produtos atualizados. Telecom: ${telecom ?? "—"} · Seguros: ${seguros ?? "—"}.` });
        }
      })();
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

      {/* BARRA DE DIAGNÓSTICO — mostra se há cliente no banco mas o filtro está escondendo.
          Só aparece quando algo está "estranho": zero exibido com dado no banco,
          ou analytics indefinido (erro/loading depois de tentar). */}
      {(() => {
        const walletTotal = (analytics?.allCustomers || []).filter((c: any) => isIgreenWalletOrigin(c.customer_origin)).length;
        const shown = filteredMetrics?.totalCustomers ?? 0;
        const analyticsMissing = analytics === undefined;
        const showBar = analyticsMissing || (walletTotal > 0 && shown === 0) || (walletTotal === 0 && (analytics?.allCustomers?.length ?? 0) === 0);
        if (!showBar) return null;
        return (
          <div className="flex items-center justify-between gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-[12px]">
            <div className="flex flex-wrap items-center gap-2 text-amber-200/90">
              {analyticsMissing ? (
                <span>Não consegui ler seus clientes agora.</span>
              ) : walletTotal > 0 ? (
                <>
                  <span>No banco: <b>{walletTotal}</b> clientes iGreen · Exibidos: <b>{shown}</b>{selectedLicenciado !== "all" && <> · Filtro: <b>{selectedLicenciado}</b></>}</span>
                </>
              ) : (
                <span>Sem clientes iGreen no banco para este consultor. Clique em Sincronizar acima.</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {walletTotal > 0 && shown === 0 && selectedLicenciado !== "all" && (
                <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => setSelectedLicenciado("all")}>Limpar filtros</Button>
              )}
              <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={async () => {
                try { await supabase.auth.refreshSession(); } catch { /* noop */ }
                await queryClient.refetchQueries({ queryKey: ["analytics", userId] });
              }}>Recarregar</Button>
            </div>
          </div>
        );
      })()}

      {/* CLIENTES iGREEN — 4 cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 sm:gap-4">
        <StatCard icon={<Users className="w-5 h-5" />} label="Total de cadastros" value={filteredMetrics?.totalCustomers ?? 0} color="primary" />
        <StatCard icon={<Zap className="w-5 h-5" />} label="Média kWh/cliente" value={`${(filteredMetrics?.avgKw ?? 0).toLocaleString("pt-BR", { maximumFractionDigits: 0 })} kW`} color="accent" subtitle={`Total: ${(filteredMetrics?.totalKw ?? 0).toLocaleString("pt-BR")} kW`} />
        <StatCard
          icon={<DollarSign className="w-5 h-5" />}
          label="Recorrência garantida"
          value={formatCompactBRL(filteredMetrics?.recorrenciaGarantida ?? 0)}
          color="primary"
          subtitle={`${(filteredMetrics?.diretoPct ?? 4).toLocaleString("pt-BR",{maximumFractionDigits:1})}% diretos ${formatCompactBRL(filteredMetrics?.diretoValor ?? 0)} + ${(filteredMetrics?.redePct ?? 1).toLocaleString("pt-BR",{maximumFractionDigits:1})}% rede ${formatCompactBRL(filteredMetrics?.indiretoValor ?? 0)}${carreiraPct > 0 ? ` · ${graduacaoDisplay(graduacao).label} +${carreiraPct.toLocaleString("pt-BR",{maximumFractionDigits:1})}% ao infinito (${formatCompactBRL(filteredMetrics?.gestorValor ?? 0)})` : ""}`}
        />
        <StatCard icon={<Zap className="w-5 h-5" />} label="Total de kWh" value={`${(filteredMetrics?.totalKw ?? 0).toLocaleString("pt-BR", { maximumFractionDigits: 0 })} kW`} color="accent" subtitle="soma da média de consumo" />
      </div>

      <CustomerCharts filteredMetrics={filteredMetrics} topLicenciados={analytics?.topLicenciados} />

      <TopConsumersCard customers={filteredMetrics?.filteredCustomers} consultantId={userId} onOpenChat={onOpenChat} />
      <GeographyCard customers={filteredMetrics?.filteredCustomers} />
      <RetentionCard customers={filteredMetrics?.filteredCustomers} />

      {/* Cadastros da Equipe — no final, após aniversariantes */}
      {analytics?.allCustomers && (
        <TeamDashboard
          leaderConsultantId={userId}
          customers={analytics.allCustomers.filter((c: any) => isIgreenWalletOrigin(c.customer_origin))}
          periodDays={periodDays}
        />
      )}


      {/* Conexão com o Escritório iGreen — pede credenciais quando não configurado */}
      <Dialog open={notConfigured} onOpenChange={(o) => !o && setNotConfigured(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="w-5 h-5 text-primary" /> Conecte seu Escritório iGreen
            </DialogTitle>
            <DialogDescription className="pt-2">
              Para sincronizar seus clientes e rede, informe o e-mail e a senha do
              escritório iGreen na aba <b>Dados</b>. Depois a sincronização é automática.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button onClick={() => { setNotConfigured(false); window.dispatchEvent(new CustomEvent("open-admin-settings")); }}>
              <KeyRound className="w-4 h-4 mr-2" /> Abrir aba Dados
            </Button>
            <Button variant="outline" onClick={() => setNotConfigured(false)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
