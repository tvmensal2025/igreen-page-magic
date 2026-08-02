// v2 cache-bust
import { useState, useEffect, useRef, lazy, Suspense } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useUserRole } from "@/hooks/useUserRole";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Shield, Users, CheckCircle, XCircle, LogOut, Loader2, UserCheck, UserX,
  KeyRound, Brain, MessageSquare, Wifi, WifiOff, AlertTriangle, Send,
  Search, Eye, TrendingUp, Phone, Calendar, RefreshCw, Sparkles, Activity,
  ChevronRight, BarChart3, Megaphone, Target, Sun, Link2, ArrowLeft, Trash2, RotateCcw,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toUserFacingError } from "@/lib/userFacingError";
// Heavy panels — lazy load on demand to shrink initial bundle
const AIKnowledgePanel = lazy(() => import("@/components/superadmin/AIKnowledgePanel").then(m => ({ default: m.AIKnowledgePanel })));
const AIControlPanel = lazy(() => import("@/components/superadmin/AIControlPanel").then(m => ({ default: m.AIControlPanel })));
const AIAuditPanel = lazy(() => import("@/components/superadmin/AIAuditPanel").then(m => ({ default: m.AIAuditPanel })));
const FaqComparativoPanel = lazy(() => import("@/components/superadmin/FaqComparativoPanel").then(m => ({ default: m.FaqComparativoPanel })));
const ABResultsPanel = lazy(() => import("@/components/superadmin/ABResultsPanel").then(m => ({ default: m.ABResultsPanel })));
const LearnedPatternsPanel = lazy(() => import("@/components/superadmin/LearnedPatternsPanel").then(m => ({ default: m.LearnedPatternsPanel })));
const CrmAnalyticsTab = lazy(() => import("@/components/superadmin/CrmAnalyticsTab").then(m => ({ default: m.CrmAnalyticsTab })));
const AuditLogPanel = lazy(() => import("@/components/superadmin/AuditLogPanel").then(m => ({ default: m.AuditLogPanel })));
const BotFunnelPanel = lazy(() => import("@/components/superadmin/BotFunnelPanel").then(m => ({ default: m.BotFunnelPanel })));
const WorkerPhaseTimeline = lazy(() => import("@/components/superadmin/WorkerPhaseTimeline").then(m => ({ default: m.WorkerPhaseTimeline })));
const SystemHealthPanel = lazy(() => import("@/components/superadmin/SystemHealthPanel").then(m => ({ default: m.SystemHealthPanel })));
const BotGlobalKillSwitch = lazy(() => import("@/components/superadmin/BotGlobalKillSwitch").then(m => ({ default: m.BotGlobalKillSwitch })));
const DevToolsBlockToggle = lazy(() => import("@/components/superadmin/DevToolsBlockToggle").then(m => ({ default: m.DevToolsBlockToggle })));
const ResolverStrictModeToggle = lazy(() => import("@/components/superadmin/ResolverStrictModeToggle").then(m => ({ default: m.ResolverStrictModeToggle })));
const StorageMigrationPanel = lazy(() => import("@/components/superadmin/StorageMigrationPanel").then(m => ({ default: m.StorageMigrationPanel })));
const InfraHealthPanel = lazy(() => import("@/components/superadmin/InfraHealthPanel").then(m => ({ default: m.InfraHealthPanel })));
const WhatsAppInstanceHealthCard = lazy(() => import("@/components/superadmin/WhatsAppInstanceHealthCard").then(m => ({ default: m.WhatsAppInstanceHealthCard })));
const PlatformFacebookCard = lazy(() => import("@/components/admin/super/PlatformFacebookCard").then(m => ({ default: m.PlatformFacebookCard })));
const NetworkHealthPanel = lazy(() => import("@/components/admin/super/NetworkHealthPanel").then(m => ({ default: m.NetworkHealthPanel })));
const AdTemplatesPanel = lazy(() => import("@/components/superadmin/AdTemplatesPanel").then(m => ({ default: m.AdTemplatesPanel })));
const AILearningHealthPanel = lazy(() => import("@/components/admin/super/AILearningHealthPanel").then(m => ({ default: m.AILearningHealthPanel })));
const CaptacaoTab = lazy(() => import("@/components/superadmin/CaptacaoTab").then(m => ({ default: m.CaptacaoTab })));
const AdManagersTab = lazy(() => import("@/components/superadmin/AdManagersTab").then(m => ({ default: m.AdManagersTab })));
const RolloutPanel = lazy(() => import("@/components/superadmin/RolloutPanel").then(m => ({ default: m.RolloutPanel })));
const SolarModulePanel = lazy(() => import("@/components/superadmin/SolarModulePanel").then(m => ({ default: m.SolarModulePanel })));
const FlowTemplateApprovalPanel = lazy(() => import("@/components/superadmin/FlowTemplateApprovalPanel"));
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { logAdminAction } from "@/hooks/useAdminAudit";
import { SuperAdminCashCreditDialog } from "@/components/admin/super/SuperAdminCashCreditDialog";
import { useConfirm } from "@/components/ui/confirm-dialog";

interface WhatsAppMetrics {
  hasInstance: boolean;
  instanceName: string | null;
  totalMsgsSent: number;
  totalMsgsReceived: number;
  scheduledSent: number;
  scheduledFailed: number;
}

interface ConsultantRow {
  id: string;
  name: string;
  license: string;
  phone: string;
  created_at: string | null;
  approved: boolean;
  total_customers?: number;
  customers_7d?: number;
  total_deals?: number;
  views_7d?: number;
  last_activity?: string | null;
  wa?: WhatsAppMetrics;
}

const SuperAdmin = () => {
  const [userId, setUserId] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [consultants, setConsultants] = useState<ConsultantRow[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [resettingId, setResettingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [resettingConsultantId, setResettingConsultantId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"consultores" | "captacao" | "gestores_ads" | "ia" | "ia_aprendendo" | "crm" | "auditoria" | "funil" | "worker" | "plataforma_fb" | "templates_ads" | "templates_fluxo" | "saude_rede" | "rollout" | "solar">("consultores");
  const [searchTerm, setSearchTerm] = useState("");
  const accessDeniedToastShownRef = useRef(false);
  // Gate alinhado a SuperAdminRemoteSupport: só is_super_admin (não role "admin").
  const { isSuperAdmin, loading: roleLoading } = useUserRole(userId);
  const navigate = useNavigate();
  const { toast } = useToast();
  const confirm = useConfirm();

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      if (!session) { setUserId(null); setAuthLoading(false); navigate("/auth", { replace: true }); return; }
      setUserId(session.user.id);
      setAuthLoading(false);
    });
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { setUserId(null); setAuthLoading(false); navigate("/auth", { replace: true }); return; }
      setUserId(session.user.id);
      setAuthLoading(false);
    });
    return () => subscription.unsubscribe();
  }, [navigate]);

  useEffect(() => {
    if (authLoading || roleLoading || !userId) return;
    if (!isSuperAdmin) {
      if (!accessDeniedToastShownRef.current) {
        accessDeniedToastShownRef.current = true;
        toast({ title: "Acesso negado", description: "Você não tem permissão de super administrador.", variant: "destructive" });
      }
      navigate("/admin", { replace: true });
      return;
    }
    accessDeniedToastShownRef.current = false;
    loadConsultants();
  }, [authLoading, isSuperAdmin, roleLoading, userId, navigate, toast]);

  const loadConsultants = async () => {
    setLoadingData(true);
    const { data, error } = await supabase
      .from("consultants")
      .select("id, name, license, phone, created_at, approved")
      .order("created_at", { ascending: false });

    if (error) {
      toast({ title: "Erro ao carregar consultores", description: error.message, variant: "destructive" });
      setLoadingData(false);
      return;
    }

    const rows: ConsultantRow[] = (data as any[])?.map(c => ({ ...c, approved: c.approved ?? false })) || [];

    const [waInstancesRes, scheduledRes] = await Promise.all([
      supabase.from("whatsapp_instances").select("consultant_id, instance_name"),
      supabase.from("scheduled_messages").select("consultant_id, status"),
    ]);

    const waMap = new Map<string, string>();
    (waInstancesRes.data || []).forEach((w: any) => waMap.set(w.consultant_id, w.instance_name));

    const schedMap = new Map<string, { sent: number; failed: number }>();
    (scheduledRes.data || []).forEach((s: any) => {
      const entry = schedMap.get(s.consultant_id) || { sent: 0, failed: 0 };
      if (s.status === "sent") entry.sent++;
      else if (s.status === "failed") entry.failed++;
      schedMap.set(s.consultant_id, entry);
    });

    const enriched = await Promise.all(rows.map(async (c) => {
      const [custRes, cust7dRes, dealsRes, viewsRes, lastCustRes, lastViewRes, customerIdsRes] = await Promise.all([
        supabase.from("customers").select("id", { count: "exact", head: true }).eq("consultant_id", c.id),
        supabase.from("customers").select("id", { count: "exact", head: true }).eq("consultant_id", c.id).gte("created_at", new Date(Date.now() - 7 * 86400000).toISOString()),
        supabase.from("crm_deals").select("id", { count: "exact", head: true }).eq("consultant_id", c.id),
        supabase.from("page_views").select("id", { count: "exact", head: true }).eq("consultant_id", c.id).gte("created_at", new Date(Date.now() - 7 * 86400000).toISOString()),
        supabase.from("customers").select("created_at").eq("consultant_id", c.id).order("created_at", { ascending: false }).limit(1),
        supabase.from("page_views").select("created_at").eq("consultant_id", c.id).order("created_at", { ascending: false }).limit(1),
        supabase.from("customers").select("id").eq("consultant_id", c.id),
      ]);

      const customerIds = (customerIdsRes.data || []).map((cu: { id: string }) => cu.id);
      let outbound = 0;
      let inbound = 0;
      // PostgREST estoura 400 se `in.(uuid…)` passar de ~8–16KB na URL.
      for (let i = 0; i < customerIds.length; i += 80) {
        const batch = customerIds.slice(i, i + 80);
        const { data: convData } = await supabase
          .from("conversations")
          .select("message_direction")
          .in("customer_id", batch);
        for (const m of (convData || []) as Array<{ message_direction: string }>) {
          if (m.message_direction === "outbound") outbound++;
          else if (m.message_direction === "inbound") inbound++;
        }
      }

      const lastCust = (lastCustRes.data as any)?.[0]?.created_at;
      const lastView = (lastViewRes.data as any)?.[0]?.created_at;
      const dates = [lastCust, lastView].filter(Boolean).sort().reverse();
      const sched = schedMap.get(c.id) || { sent: 0, failed: 0 };

      return {
        ...c,
        total_customers: custRes.count || 0,
        customers_7d: cust7dRes.count || 0,
        total_deals: dealsRes.count || 0,
        views_7d: viewsRes.count || 0,
        last_activity: dates[0] || null,
        wa: {
          hasInstance: waMap.has(c.id),
          instanceName: waMap.get(c.id) || null,
          totalMsgsSent: outbound + sched.sent,
          totalMsgsReceived: inbound,
          scheduledSent: sched.sent,
          scheduledFailed: sched.failed,
        },
      };
    }));

    setConsultants(enriched);
    setLoadingData(false);
  };

  const toggleApproval = async (consultantId: string, currentApproved: boolean) => {
    setTogglingId(consultantId);
    const { error } = await supabase.from("consultants").update({ approved: !currentApproved } as any).eq("id", consultantId);
    if (error) {
      toast({ title: "Erro", description: error.message, variant: "destructive" });
    } else {
      setConsultants(prev => prev.map(c => c.id === consultantId ? { ...c, approved: !currentApproved } : c));
      toast({ title: !currentApproved ? "✅ Consultor aprovado!" : "❌ Acesso revogado" });
      logAdminAction(
        !currentApproved ? "approve_consultant" : "reject_consultant",
        "consultant",
        consultantId,
        { previous_approved: currentApproved },
      );
    }
    setTogglingId(null);
  };

  const handleResetPassword = async (consultantId: string, consultantName: string) => {
    const ok = await confirm({
      title: `Gerar nova senha para ${consultantName}?`,
      description: "A senha atual deixará de funcionar imediatamente.",
      confirmText: "Gerar nova senha",
      cancelText: "Cancelar",
      tone: "danger",
    });
    if (!ok) return;
    setResettingId(consultantId);
    try {
      const { data, error } = await supabase.functions.invoke("admin-reset-password", {
        body: { consultant_id: consultantId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      const newPwd: string = data?.password || "";
      const email: string = data?.email || consultantName;

      try { await navigator.clipboard.writeText(newPwd); } catch { /* ignore */ }

      toast({
        title: "🔑 Nova senha gerada (copiada)",
        description: `${email} — Senha: ${newPwd}`,
        duration: 30000,
      });
      window.prompt(
        `Nova senha de ${email}\n\nCopie e envie ao consultor. Esta tela não será mostrada de novo.`,
        newPwd,
      );
      logAdminAction("reset_password", "consultant", consultantId, { email });
    } catch (err: any) {
      toast({ title: "Erro ao resetar senha", description: err.message || "Erro desconhecido", variant: "destructive" });
    }
    setResettingId(null);
  };

  const handleResetConsultant = async (
    consultantId: string,
    consultantName: string,
    totalCustomers = 0,
  ) => {
    if (userId && consultantId === userId) {
      toast({
        title: "Não permitido",
        description: "Você não pode resetar a própria conta por aqui.",
        variant: "destructive",
      });
      return;
    }

    const ok = await confirm({
      title: `Resetar ${consultantName} para o zero?`,
      description:
        `O consultor recomeça do zero: nome da IA, persona, foto, textos de voz/SMS, ` +
        `automações, temas de cadência e base de conhecimento são apagados, e a instância ` +
        `de WhatsApp é desconectada (novo QR).\n` +
        `NADA é perdido: ${totalCustomers} cliente(s), leads captados, vendas e histórico continuam com ele.\n` +
        `O login e a senha continuam funcionando.`,
      confirmText: "Resetar consultor",
      cancelText: "Cancelar",
      tone: "danger",
    });
    if (!ok) return;

    setResettingConsultantId(consultantId);
    try {
      const { data, error } = await supabase.functions.invoke("admin-reset-consultant", {
        body: { consultant_id: consultantId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      toast({
        title: "Consultor resetado",
        description:
          `${consultantName} vai refazer o onboarding. Mantidos: ` +
          `${data?.summary?.kept_customers ?? 0} cliente(s) e ` +
          `${data?.summary?.kept_captured_leads ?? 0} lead(s).`,
      });
      logAdminAction("reset_consultant", "consultant", consultantId, { name: consultantName });
      void loadConsultants();
    } catch (err: unknown) {
      toast({
        title: "Erro ao resetar consultor",
        description: toUserFacingError(err),
        variant: "destructive",
      });
    }
    setResettingConsultantId(null);
  };

  const handleDeleteConsultant = async (

    consultantId: string,
    consultantName: string,
    totalCustomers = 0,
  ) => {
    if (userId && consultantId === userId) {
      toast({
        title: "Não permitido",
        description: "Você não pode excluir a própria conta por aqui.",
        variant: "destructive",
      });
      return;
    }

    const ok = await confirm({
      title: `Excluir permanentemente ${consultantName}?`,
      description:
        `Isso apaga o login e o perfil do consultor.\n` +
        `Antes de apagar, TODO o histórico é transferido para a SUA conta: ` +
        (totalCustomers > 0 ? `${totalCustomers} cliente(s), ` : "") +
        `leads captados, vendas, propostas e dados iGreen.\n` +
        `Nada de histórico é perdido, mas a exclusão do usuário não tem volta.`,

      confirmText: "Excluir usuário",
      cancelText: "Cancelar",
      tone: "danger",
    });
    if (!ok) return;

    setDeletingId(consultantId);
    try {
      const { data, error } = await supabase.functions.invoke("admin-delete-consultant", {
        body: { consultant_id: consultantId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      setConsultants((prev) => prev.filter((c) => c.id !== consultantId));
      toast({ title: "Usuário excluído", description: `${consultantName} foi removido.` });
      logAdminAction("delete_consultant", "consultant", consultantId, {
        name: consultantName,
        email: data?.deleted?.email ?? null,
      });
    } catch (err: unknown) {
      toast({
        title: "Erro ao excluir usuário",
        description: toUserFacingError(err),
        variant: "destructive",
      });
    }
    setDeletingId(null);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/auth");
  };

  if (authLoading || roleLoading || (!isSuperAdmin && userId)) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-background">
        <div className="relative">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center animate-pulse">
            <Shield className="w-8 h-8 text-primary" />
          </div>
          <Loader2 className="w-5 h-5 animate-spin text-primary absolute -bottom-1 -right-1" />
        </div>
        <p className="text-sm text-muted-foreground font-medium">Verificando permissões...</p>
      </div>
    );
  }

  const approvedCount = consultants.filter(c => c.approved).length;
  const pendingCount = consultants.filter(c => !c.approved).length;
  const totalCustomers = consultants.reduce((s, c) => s + (c.total_customers || 0), 0);
  const totalDeals = consultants.reduce((s, c) => s + (c.total_deals || 0), 0);
  const connectedWA = consultants.filter(c => c.wa?.hasInstance).length;

  const filtered = consultants.filter(c => {
    if (!searchTerm) return true;
    const q = searchTerm.toLowerCase();
    return c.name.toLowerCase().includes(q) || c.license.toLowerCase().includes(q) || c.phone.includes(q);
  });

  const tabs = [
    { id: "consultores" as const, label: "Consultores", icon: Users, count: consultants.length },
    { id: "captacao" as const, label: "Captação", icon: Target },
    { id: "gestores_ads" as const, label: "Gestores Ads", icon: UserCheck },
    { id: "saude_rede" as const, label: "Saúde da Rede", icon: Activity },
    { id: "crm" as const, label: "Análise de clientes", icon: BarChart3 },
    { id: "funil" as const, label: "Funil do Bot", icon: Activity },
    { id: "worker" as const, label: "Worker Phases", icon: Activity },
    { id: "auditoria" as const, label: "Auditoria", icon: Shield },
    { id: "ia" as const, label: "IA / Conhecimento", icon: Brain },
    { id: "ia_aprendendo" as const, label: "IA Aprendendo", icon: Sparkles },
    { id: "plataforma_fb" as const, label: "Plataforma FB", icon: Megaphone },
    { id: "templates_ads" as const, label: "Templates de Anúncio", icon: Sparkles },
    { id: "templates_fluxo" as const, label: "Templates de Fluxo", icon: Sparkles },
    { id: "rollout" as const, label: "Rollout V3", icon: Activity },
    { id: "solar" as const, label: "Solar 3D", icon: Sun },
  ];

  const formatActivity = (lastAct: string | null) => {
    if (!lastAct) return { text: "Sem atividade", color: "text-muted-foreground", dot: "bg-muted-foreground/50", ring: "" };
    const d = new Date(lastAct);
    const days = Math.floor((Date.now() - d.getTime()) / 86400000);
    if (days === 0) return { text: "Hoje", color: "text-primary", dot: "bg-primary/100", ring: "ring-2 ring-primary/30" };
    if (days === 1) return { text: "Ontem", color: "text-primary", dot: "bg-primary", ring: "" };
    if (days <= 7) return { text: `${days}d atrás`, color: "text-warning", dot: "bg-warning", ring: "" };
    return { text: `${days}d atrás`, color: "text-destructive", dot: "bg-destructive", ring: "" };
  };

  const statCards = [
    { label: "Consultores", value: consultants.length, icon: Users, gradient: "from-primary/10 to-primary/5", iconColor: "text-primary", border: "border-primary/10" },
    { label: "Aprovados", value: approvedCount, icon: CheckCircle, gradient: "from-primary/10 to-primary/5", iconColor: "text-primary", border: "border-primary/10" },
    { label: "Pendentes", value: pendingCount, icon: XCircle, gradient: "from-warning/10 to-warning/5", iconColor: "text-warning", border: "border-warning/10" },
    { label: "Clientes Total", value: totalCustomers.toLocaleString(), icon: TrendingUp, gradient: "from-info/10 to-info/5", iconColor: "text-info", border: "border-info/10" },
    { label: "WhatsApp Ativo", value: connectedWA, icon: Phone, gradient: "from-primary/10 to-primary/5", iconColor: "text-primary", border: "border-primary/10" },
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* Ambient background */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-[40%] -right-[20%] w-[60%] h-[60%] rounded-full bg-primary/[0.02] blur-3xl" />
        <div className="absolute -bottom-[30%] -left-[15%] w-[50%] h-[50%] rounded-full bg-primary/100/[0.02] blur-3xl" />
      </div>

      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-2xl backdrop-saturate-150">
        <div className="max-w-[1760px] mx-auto px-4 sm:px-6 lg:px-8 min-h-16 py-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 shrink-0 rounded-xl bg-gradient-to-br from-primary to-primary/80 flex items-center justify-center shadow-lg shadow-primary/20">
              <Shield className="w-5 h-5 text-primary-foreground" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-lg font-bold font-heading text-foreground truncate">Super Admin</h1>
                <Badge className="bg-primary/10 text-primary border-primary/20 text-[10px] font-medium">v2</Badge>
              </div>
              <p className="text-xs text-muted-foreground hidden sm:block">Gerenciamento da plataforma</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
            <Button variant="outline" size="sm" onClick={() => navigate("/admin")} className="gap-2">
              <ArrowLeft className="w-4 h-4" /> <span className="hidden sm:inline">Voltar ao Admin</span>
            </Button>
            <Button variant="outline" size="sm" onClick={() => navigate("/super-admin/portais")} className="gap-2">
              <Link2 className="w-4 h-4" /> <span className="hidden sm:inline">Portais</span>
            </Button>
            <Button variant="outline" size="sm" onClick={() => navigate("/super-admin/venda-plataforma")} className="gap-2">
              <Megaphone className="w-4 h-4" /> <span className="hidden sm:inline">Venda plataforma</span>
            </Button>
            <Button variant="outline" size="sm" onClick={() => window.location.assign("/super-admin/suporte")} className="gap-2">
              <Shield className="w-4 h-4" /> <span className="hidden sm:inline">Suporte Remoto</span>
            </Button>
            <ThemeToggle />
            <Button variant="ghost" size="icon" onClick={loadConsultants} disabled={loadingData} className="text-muted-foreground hover:text-foreground">
              <RefreshCw className={`w-4 h-4 ${loadingData ? "animate-spin" : ""}`} />
            </Button>
            <Button variant="ghost" size="icon" onClick={handleLogout} className="text-muted-foreground hover:text-foreground">
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </header>

      {/* Tab Navigation */}
      <nav className="border-b border-border/50 bg-background/60 backdrop-blur-xl">
        <div className="max-w-[1760px] mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex gap-1 overflow-x-auto scrollbar-thin">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                  className={`relative flex items-center gap-2 px-3 sm:px-4 py-3.5 text-sm font-medium whitespace-nowrap transition-all rounded-t-lg shrink-0 ${
                    isActive 
                      ? "text-primary" 
                      : "text-muted-foreground hover:text-foreground"
                  }`}>
                  <Icon className="w-4 h-4 shrink-0" />
                  {tab.label}
                  {tab.count !== undefined && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${isActive ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}`}>
                      {tab.count}
                    </span>
                  )}
                  {isActive && <div className="absolute bottom-0 left-2 right-2 h-0.5 bg-primary rounded-full" />}
                </button>
              );
            })}
          </div>
        </div>
      </nav>

      <main className="relative max-w-[1760px] mx-auto px-4 sm:px-6 lg:px-8 xl:px-12 py-6 space-y-6">
        <Suspense fallback={<div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>}>
        {activeTab === "consultores" && (
          <>
            {/* Stats Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
              {statCards.map((stat) => (
                <div key={stat.label} className={`premium-card !p-4 group border min-w-0 ${stat.border} hover:scale-[1.02] transition-transform`}>
                  <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${stat.gradient} flex items-center justify-center mb-3`}>
                    <stat.icon className={`w-4.5 h-4.5 ${stat.iconColor}`} />
                  </div>
                  <p className="text-2xl font-bold text-foreground tracking-tight truncate">{stat.value}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5 font-medium truncate">{stat.label}</p>
                </div>
              ))}
            </div>

            {/* Kill switch global — Fase 0 auditoria de lançamento */}
            <BotGlobalKillSwitch />

            {/* Bloqueio de DevTools / F12 para usuários finais */}
            <DevToolsBlockToggle />

            {/* F2 — Resolver strict mode (atrás de flag, default OFF) */}
            <ResolverStrictModeToggle />

            {/* Lote 3 — Infra: MinIO + alertas super_admin */}
            <InfraHealthPanel />
            <StorageMigrationPanel />

            {/* Saúde das instâncias WhatsApp — marcar banida / destravar */}
            <WhatsAppInstanceHealthCard />

            {/* Health Panel — saúde geral + religar bot global */}
            <SystemHealthPanel />

            {/* Search */}
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative flex-1 min-w-0 max-w-md">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar por nome, licença ou telefone..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10 h-10 bg-card/50 border-border/50 rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary/30"
                />
              </div>
              <Badge variant="outline" className="text-xs py-1.5 px-3 border-border/50 shrink-0">
                {filtered.length} consultor(es)
              </Badge>
            </div>

            {/* Consultant Cards */}
            {loadingData ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3">
                <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center animate-pulse">
                  <Loader2 className="w-6 h-6 animate-spin text-primary" />
                </div>
                <p className="text-sm text-muted-foreground">Carregando consultores...</p>
              </div>
            ) : filtered.length === 0 ? (
              <div className="premium-card text-center py-16">
                <Search className="w-8 h-8 text-muted-foreground/40 mx-auto mb-3" />
                <p className="text-muted-foreground font-medium">Nenhum consultor encontrado</p>
              </div>
            ) : (
              <TooltipProvider>
                <div className="grid gap-3">
                  {filtered.map((c) => {
                    const activity = formatActivity(c.last_activity || null);
                    const wa = c.wa;
                    const totalMsgs = (wa?.totalMsgsSent || 0) + (wa?.totalMsgsReceived || 0);

                    return (
                      <div key={c.id} className="premium-card !p-0 overflow-hidden group">
                        <div className="p-5">
                          {/* Top: Avatar + Name + Actions */}
                          <div className="flex flex-wrap items-start justify-between gap-3 sm:gap-4 mb-5">
                            <div className="flex items-center gap-3.5 min-w-0">
                              <div className={`relative w-11 h-11 rounded-xl bg-gradient-to-br ${c.approved ? "from-primary/20 to-primary/10" : "from-warning/20 to-warning/10"} flex items-center justify-center shrink-0 ${activity.ring}`}>
                                <span className={`text-sm font-bold ${c.approved ? "text-primary" : "text-warning"}`}>
                                  {c.name.charAt(0).toUpperCase()}
                                </span>
                                {wa?.hasInstance && (
                                  <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-primary/100 border-2 border-card flex items-center justify-center">
                                    <Wifi className="w-2 h-2 text-white" />
                                  </div>
                                )}
                              </div>
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2 mb-0.5">
                                  <h3 className="font-semibold text-foreground truncate">{c.name}</h3>
                                  <Badge className={`text-[10px] px-2 py-0 h-5 font-medium border shrink-0 ${
                                    c.approved
                                      ? "bg-primary/10 text-primary border-primary/20"
                                      : "bg-warning/10 text-warning border-warning/20"
                                  }`}>
                                    {c.approved ? "Aprovado" : "Pendente"}
                                  </Badge>
                                </div>
                                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                                  <span className="truncate">{c.license}</span>
                                  <span className="w-1 h-1 rounded-full bg-border hidden sm:inline-block" />
                                  <span className="truncate">{c.phone}</span>
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center gap-1 shrink-0 flex-wrap opacity-70 group-hover:opacity-100 transition-opacity">
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg"
                                    onClick={() => handleResetPassword(c.id, c.name)} disabled={resettingId === c.id}>
                                    {resettingId === c.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <KeyRound className="w-3.5 h-3.5" />}
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Resetar Senha</TooltipContent>
                              </Tooltip>
                              <Button
                                variant={c.approved ? "ghost" : "default"}
                                size="sm"
                                onClick={() => toggleApproval(c.id, c.approved)}
                                disabled={togglingId === c.id}
                                className={`h-8 gap-1.5 text-xs rounded-lg ${c.approved ? "" : "shadow-lg shadow-primary/20"}`}
                              >
                                {togglingId === c.id ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : c.approved ? (
                                  <UserX className="w-3.5 h-3.5" />
                                ) : (
                                  <UserCheck className="w-3.5 h-3.5" />
                                )}
                                {c.approved ? "Revogar" : "Aprovar"}
                              </Button>
                              <SuperAdminCashCreditDialog consultantId={c.id} consultantName={c.name} />
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 rounded-lg text-amber-600 hover:text-amber-600 hover:bg-amber-500/10"
                                    onClick={() => handleResetConsultant(c.id, c.name, c.total_customers || 0)}
                                    disabled={resettingConsultantId === c.id || Boolean(userId && c.id === userId)}
                                    aria-label={`Resetar ${c.name}`}
                                  >
                                    {resettingConsultantId === c.id ? (
                                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                    ) : (
                                      <RotateCcw className="w-3.5 h-3.5" />
                                    )}
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Resetar (recomeçar do zero, mantém os dados)</TooltipContent>
                              </Tooltip>

                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 rounded-lg text-destructive hover:text-destructive hover:bg-destructive/10"
                                    onClick={() => handleDeleteConsultant(c.id, c.name, c.total_customers || 0)}
                                    disabled={deletingId === c.id || Boolean(userId && c.id === userId)}
                                    aria-label={`Excluir ${c.name}`}
                                  >
                                    {deletingId === c.id ? (
                                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                    ) : (
                                      <Trash2 className="w-3.5 h-3.5" />
                                    )}
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                  {userId && c.id === userId ? "Não dá para excluir a própria conta" : "Excluir usuário"}
                                </TooltipContent>
                              </Tooltip>
                            </div>

                          </div>

                          {/* Metrics Grid */}
                          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                            <MetricPill icon={<Users className="w-3.5 h-3.5" />} iconColor="text-info" bgColor="bg-info/8" value={c.total_customers || 0} label="Clientes" badge={c.customers_7d ? `+${c.customers_7d}` : undefined} badgeColor="text-primary" />
                            <MetricPill icon={<TrendingUp className="w-3.5 h-3.5" />} iconColor="text-primary" bgColor="bg-primary/8" value={c.total_deals || 0} label="Negócios" />
                            <MetricPill icon={<Eye className="w-3.5 h-3.5" />} iconColor="text-warning" bgColor="bg-warning/8" value={c.views_7d || 0} label="Views 7d" />
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <div className={`flex items-center gap-2.5 rounded-xl px-3 py-2.5 ${wa?.hasInstance ? "bg-primary/8" : "bg-muted/40"} transition-colors cursor-default`}>
                                  {wa?.hasInstance ? <Wifi className="w-3.5 h-3.5 text-primary shrink-0" /> : <WifiOff className="w-3.5 h-3.5 text-muted-foreground shrink-0" />}
                                  <div>
                                    <div className="flex items-center gap-1.5">
                                      <span className="text-sm font-semibold text-foreground leading-none">{totalMsgs}</span>
                                      {(wa?.scheduledFailed || 0) > 0 && <AlertTriangle className="w-3 h-3 text-destructive" />}
                                    </div>
                                    <p className="text-[10px] text-muted-foreground mt-0.5">{wa?.hasInstance ? "WhatsApp" : "Sem conexão"}</p>
                                  </div>
                                </div>
                              </TooltipTrigger>
                              <TooltipContent side="top" className="text-xs space-y-1.5 max-w-xs">
                                <p className="font-semibold">{wa?.hasInstance ? "✅ Conectado" : "❌ Desconectado"}</p>
                                {wa?.instanceName && <p className="text-muted-foreground">{wa.instanceName}</p>}
                                <div className="flex items-center gap-3">
                                  <span className="flex items-center gap-1 text-primary"><Send className="w-3 h-3" />{wa?.totalMsgsSent || 0}</span>
                                  <span className="flex items-center gap-1 text-info"><MessageSquare className="w-3 h-3" />{wa?.totalMsgsReceived || 0}</span>
                                </div>
                                {(wa?.scheduledFailed || 0) > 0 && <p className="text-destructive">⚠️ {wa?.scheduledFailed} falha(s)</p>}
                              </TooltipContent>
                            </Tooltip>
                            <div className="flex items-center gap-2.5 rounded-xl bg-muted/30 px-3 py-2.5">
                              <div className={`w-2 h-2 rounded-full ${activity.dot} shrink-0`} />
                              <div>
                                <p className={`text-sm font-semibold leading-none ${activity.color}`}>{activity.text}</p>
                                <p className="text-[10px] text-muted-foreground mt-0.5">Atividade</p>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </TooltipProvider>
            )}
          </>
        )}

        {activeTab === "captacao" && <CaptacaoTab />}
        {activeTab === "gestores_ads" && <AdManagersTab />}
        {activeTab === "crm" && <CrmAnalyticsTab />}
        {activeTab === "funil" && (
          <div className="space-y-4">
            <BotFunnelPanel />
          </div>
        )}
        {activeTab === "worker" && <WorkerPhaseTimeline />}
        {activeTab === "auditoria" && <AuditLogPanel />}
        {activeTab === "ia" && (
          <div className="space-y-6">
            <AIControlPanel />
            <ABResultsPanel />
            <LearnedPatternsPanel />
            <FaqComparativoPanel />
            <AIAuditPanel />

            <AIKnowledgePanel />
          </div>
        )}
        {activeTab === "plataforma_fb" && <PlatformFacebookCard />}
       {activeTab === "templates_ads" && <AdTemplatesPanel />}
        {activeTab === "templates_fluxo" && <FlowTemplateApprovalPanel />}
        {activeTab === "saude_rede" && <NetworkHealthPanel />}
        {activeTab === "ia_aprendendo" && <AILearningHealthPanel />}
        {activeTab === "rollout" && <RolloutPanel />}
        {activeTab === "solar" && <SolarModulePanel />}
        </Suspense>
      </main>
    </div>
  );
};

function MetricPill({ icon, iconColor, bgColor, value, label, badge, badgeColor }: {
  icon: React.ReactNode; iconColor: string; bgColor: string; value: number | string; label: string; badge?: string; badgeColor?: string;
}) {
  return (
    <div className={`flex items-center gap-2.5 rounded-xl ${bgColor} px-3 py-2.5 transition-colors`}>
      <span className={`shrink-0 ${iconColor}`}>{icon}</span>
      <div>
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-semibold text-foreground leading-none">{value}</span>
          {badge && <span className={`text-[10px] font-medium ${badgeColor}`}>{badge}</span>}
        </div>
        <p className="text-[10px] text-muted-foreground mt-0.5">{label}</p>
      </div>
    </div>
  );
}

export default SuperAdmin;

// cache-bust
