import React, { useState, useEffect, lazy, Suspense } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { LogOut, Copy, Download, X } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  canAutoPromptAutomationPrefs,
} from "@/lib/consultantAutomationPrefs";
import { OnboardingGate } from "@/components/admin/OnboardingGate";
import { ConsultantAutomationPrefsModal } from "@/components/admin/ConsultantAutomationPrefsModal";
import { ConsultantAutomationPrefsCard } from "@/components/admin/ConsultantAutomationPrefsCard";
import { PrivacyModeProvider, usePrivacyMode } from "@/contexts/PrivacyModeContext";
import { useQueryClient } from "@tanstack/react-query";
import { WhatsAppErrorBoundary } from "@/components/whatsapp/WhatsAppErrorBoundary";
import { useWhatsApp } from "@/hooks/useWhatsApp";
import { useNotifications } from "@/hooks/useNotifications";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { useConsultantForm } from "@/hooks/useConsultantForm";
import { useConsultantPresence } from "@/hooks/useConsultantPresence";
// OcrReviewBanner removido — confirmação sempre feita pelo cliente no WhatsApp.
import { WhatsAppPhoneStatusBanner } from "@/components/admin/WhatsAppPhoneStatusBanner";

import PageStatus from "@/components/common/PageStatus";
import { AppSidebar, type AdminTabId } from "@/components/layout/AppSidebar";
import { AppTopbar } from "@/components/layout/AppTopbar";
import { useAlertasBoletosCount } from "@/components/admin/financeiro/useAlertasBoletosCount";
import { useUserRole } from "@/hooks/useUserRole";



// Heavy panels — lazy load on demand
const QRCodeSVG = lazy(() => import("qrcode.react").then(m => ({ default: m.QRCodeSVG })));
const DashboardTab = lazy(() => import("@/components/admin/DashboardTab").then(m => {
  if (!m.DashboardTab) throw new Error("DashboardTab export missing");
  return { default: m.DashboardTab };
}));
const DadosTab = lazy(() => import("@/components/admin/DadosTab").then(m => ({ default: m.DadosTab })));
const WhatsAppConnectionSettingsCard = lazy(() =>
  import("@/components/admin/WhatsAppConnectionSettingsCard").then((m) => ({
    default: m.WhatsAppConnectionSettingsCard,
  })),
);
const IGreenConnectionCard = lazy(() => import("@/components/admin/IGreenConnectionCard").then(m => ({ default: m.IGreenConnectionCard })));
const IGreenSyncStatusBar = lazy(() => import("@/components/admin/IGreenSyncStatusBar").then(m => ({ default: m.IGreenSyncStatusBar })));
const ChangePasswordCard = lazy(() => import("@/components/admin/ChangePasswordCard").then(m => ({ default: m.ChangePasswordCard })));
const BonusTiersAdminCard = lazy(() => import("@/components/admin/BonusTiersAdminCard").then(m => ({ default: m.BonusTiersAdminCard })));
const LinksTab = lazy(() => import("@/components/admin/LinksTab").then(m => ({ default: m.LinksTab })));

const NotificationCenter = lazy(() => import("@/components/admin/NotificationCenter").then(m => ({ default: m.NotificationCenter })));
const AIChatPanel = lazy(() => import("@/components/admin/AIChatPanel").then(m => ({ default: m.AIChatPanel })));
const WhatsAppTab = lazy(() => import("@/components/whatsapp/WhatsAppTab").then(m => ({ default: m.WhatsAppTab })));
const CrmTabs = lazy(() => import("@/components/whatsapp/CrmTabs").then(m => ({ default: m.CrmTabs })));
const PosVendaKanban = lazy(() => import("@/components/whatsapp/PosVendaKanban").then(m => ({ default: m.default })));
const CustomerManager = lazy(() => import("@/components/whatsapp/CustomerManager").then(m => ({ default: m.CustomerManager })));
const MaterialsTab = lazy(() => import("@/components/admin/MaterialsTab").then(m => ({ default: m.MaterialsTab })));
const PanfletoModal = lazy(() => import("@/components/admin/PanfletoModal").then(m => ({ default: m.PanfletoModal })));
const AdsCentralTab = lazy(() => import("@/components/admin/ads/AdsCentralTab").then(m => ({ default: m.AdsCentralTab })));
const CaptacaoPanel = lazy(() => import("@/components/captacao/CaptacaoPanel").then(m => ({ default: m.CaptacaoPanel })));
const ParceirosTab = lazy(() => import("@/components/admin/parceiros/ParceirosTab").then(m => ({ default: m.ParceirosTab })));
const ConversaoCockpit = lazy(() => import("@/components/admin/conversao/ConversaoCockpit").then(m => ({ default: m.ConversaoCockpit })));
const AgendamentosHub = lazy(() => import("@/components/whatsapp/AgendamentosHub").then(m => ({ default: m.AgendamentosHub })));
const AudioStudioPanel = lazy(() => import("@/components/admin/AudioStudio").then(m => ({ default: m.AudioStudio })));
const VozTab = lazy(() => import("@/components/admin/voz/VozTab").then(m => {
  if (!m.VozTab) throw new Error("VozTab export missing");
  return { default: m.VozTab };
}));
const AcademyTab = lazy(() => import("@/components/admin/academy/AcademyTab").then(m => ({ default: m.AcademyTab })));
const VendaPlataformaPanel = lazy(() =>
  import("@/components/superadmin/VendaPlataformaPanel").then((m) => ({ default: m.VendaPlataformaPanel })),
);
const ProdutosModule = lazy(() => import("@/features/produtos/ProdutosModule").then(m => ({ default: m.ProdutosModule })));
const FinanceiroPanel = lazy(() => import("@/components/admin/financeiro/FinanceiroPanel").then(m => ({ default: m.FinanceiroPanel })));

import type { ProdutosTabId } from "@/features/produtos/ProdutosModule";

import { ADMIN_ACTIVE_TAB_KEY, notifyAdminTabChanged } from "@/lib/adminDashboardSurface";

const ADMIN_TAB_IDS: readonly AdminTabId[] = [
  "dashboard", "crm", "crm-clientes", "conversao", "clientes", "financeiro", "produtos",
  "captacao", "parceiros", "whatsapp", "agendamentos", "central-anuncios", "links",
  "materiais", "audio-studio", "voz", "academy", "venda-plataforma",
];

const AdminContent = () => {
  const { privacyMode, togglePrivacy } = usePrivacyMode();
  const { loading, approved, userId, form, photoPreview, setPhotoPreview, handleFormChange, handleLogout, setForm } = useAdminAuth();
  const { isSuperAdmin } = useUserRole(userId);
  const { saving, photoPreview: localPhotoPreview, handlePhotoChange, handleSave } = useConsultantForm(userId, form, setForm, setPhotoPreview);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("pe:sidebar-collapsed") === "1";
  });
  const toggleSidebarCollapsed = () => {
    setSidebarCollapsed((v) => {
      const next = !v;
      try { window.localStorage.setItem("pe:sidebar-collapsed", next ? "1" : "0"); } catch {}
      return next;
    });
  };
  const collapseSidebar = () => {
    setSidebarCollapsed(true);
    try { window.localStorage.setItem("pe:sidebar-collapsed", "1"); } catch {}
  };
  const AI_SUB_TABS = ["atendimentos", "agente", "decisoes", "desempenho", "conhecimento"] as const;
  const [activeTab, setActiveTab] = useState<AdminTabId>(() => {
    if (typeof window !== "undefined") {
      const tab = new URLSearchParams(window.location.search).get("tab");
      if (tab === "performance" || tab === "anuncios" || tab === "central-anuncios") return "central-anuncios";
      if (tab === "whatsapp" || tab === "historico" || (tab && (AI_SUB_TABS as readonly string[]).includes(tab))) return "whatsapp";
      if (tab === "preview") return "links";
      if (tab === "captacao" || tab === "game" || tab === "modo-game") return "captacao";
      // Aba "rede" removida da UI — dados/sync permanecem; deep-link antigo cai no dashboard
      if (tab === "rede") return "dashboard";
      if (tab === "crm" || tab === "crm-clientes" || tab === "clientes" || tab === "financeiro" || tab === "materiais" || tab === "parceiros" || tab === "conversao" || tab === "audio-studio" || tab === "voz" || tab === "academy" || tab === "produtos" || tab === "agendamentos") return tab as AdminTabId;
      const stored = window.localStorage.getItem(ADMIN_ACTIVE_TAB_KEY) as AdminTabId | null;
      if (stored && ADMIN_TAB_IDS.includes(stored)) return stored;
    }
    return "dashboard";
  });
  useEffect(() => {
    try { window.localStorage.setItem(ADMIN_ACTIVE_TAB_KEY, activeTab); } catch {}
    notifyAdminTabChanged(activeTab);
  }, [activeTab]);

  const [pendingAiSubTab, setPendingAiSubTab] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    const tab = new URLSearchParams(window.location.search).get("tab");
    return tab && (AI_SUB_TABS as readonly string[]).includes(tab) ? tab : null;
  });
  const [produtosSubTab, setProdutosSubTab] = useState<ProdutosTabId>("acompanhamento");
  const [posVendaHighlightId, setPosVendaHighlightId] = useState<string | null>(null);

  const [pendingConversaoView, setPendingConversaoView] = useState<string | null>(null);
  const [pendingWhatsAppSub, setPendingWhatsAppSub] = useState<string | null>(null);
  const [pendingWhatsAppAutoConnect, setPendingWhatsAppAutoConnect] = useState(false);
  const [pendingHubTab, setPendingHubTab] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("hubTab");
  });

  const [pendingChatPhone, setPendingChatPhone] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("phone");
  });
  const [pendingChatMessage, setPendingChatMessage] = useState<string | undefined>(undefined);

  // Deep-link / tour: /admin?tab=… muda a aba mesmo com Admin já montado
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const tab = params.get("tab");
    const phone = params.get("phone");
    const section = params.get("section");
    if (!tab && !phone && !section) return;

    if (tab) {
      let resolved: AdminTabId | null = null;
      if (tab === "performance" || tab === "anuncios" || tab === "central-anuncios") resolved = "central-anuncios";
      else if (tab === "whatsapp" || tab === "historico" || (AI_SUB_TABS as readonly string[]).includes(tab)) resolved = "whatsapp";
      else if (tab === "preview") resolved = "links";
      else if (tab === "captacao" || tab === "game" || tab === "modo-game") resolved = "captacao";
      else if (tab === "rede") resolved = "dashboard";
      else if (tab === "dashboard" || ADMIN_TAB_IDS.includes(tab as AdminTabId)) resolved = tab as AdminTabId;

      if (resolved) setActiveTab(resolved);
      if ((AI_SUB_TABS as readonly string[]).includes(tab)) setPendingAiSubTab(tab);
    }
    if (section === "envio_massa" || section === "agendamentos") setPendingWhatsAppSub(section);
    if (phone) setPendingChatPhone(phone);

    params.delete("tab");
    params.delete("section");
    params.delete("phone");
    const qs = params.toString();
    const nextUrl = `${location.pathname}${qs ? `?${qs}` : ""}`;
    const currentUrl = `${location.pathname}${location.search}`;
    if (nextUrl !== currentUrl) navigate(nextUrl, { replace: true });
  }, [location.pathname, location.search, navigate]);

  const [qrPanfleto, setQrPanfleto] = useState<{ url: string; label: string } | null>(null);
  const [panfletoOpen, setPanfletoOpen] = useState(false);
  const [aiChatOpen, setAiChatOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  useEffect(() => {
    const h = () => setSettingsOpen(true);
    window.addEventListener("open-admin-settings", h);
    window.addEventListener("igreen-admin-open-settings", h);
    return () => {
      window.removeEventListener("open-admin-settings", h);
      window.removeEventListener("igreen-admin-open-settings", h);
    };
  }, []);

  useEffect(() => {
    const openSidebar = () => {
      setSidebarOpen(true);
      setSidebarCollapsed(false);
      try { window.localStorage.setItem("pe:sidebar-collapsed", "0"); } catch {}
    };
    window.addEventListener("igreen-open-sidebar", openSidebar);
    return () => window.removeEventListener("igreen-open-sidebar", openSidebar);
  }, []);

  useEffect(() => {
    const onNav = (e: Event) => {
      const detail = (e as CustomEvent).detail as {
        tab?: string;
        whatsappSub?: string;
        conversaoView?: string;
        hubTab?: string;
      } | undefined;
      if (!detail?.tab) return;
      if (detail.tab === "agendamentos" || ADMIN_TAB_IDS.includes(detail.tab as AdminTabId)) {
        setActiveTab(detail.tab as AdminTabId);
      }
      if (detail.whatsappSub) setPendingWhatsAppSub(detail.whatsappSub);
      if (detail.conversaoView) setPendingConversaoView(detail.conversaoView);
      if (detail.hubTab) setPendingHubTab(detail.hubTab);
    };
    window.addEventListener("igreen-admin-nav", onNav);
    return () => window.removeEventListener("igreen-admin-nav", onNav);
  }, []);
  const [periodDays, setPeriodDays] = useState(30);

  const {
    instanceName,
    isWhapi,
    connectionStatus,
    phoneNumber: waPhoneNumber,
    isLoading: waLoading,
    disconnect: disconnectWhatsApp,
    createAndConnect,
  } = useWhatsApp(userId || "");

  // Ao entrar no painel com Zap já conectado: gera voz da IA (idempotente).
  useEffect(() => {
    if (!userId) return;
    const connected = !!isWhapi || connectionStatus === "connected";
    if (!connected) return;
    let cancelled = false;
    void (async () => {
      try {
        const { maybeBootstrapConsultantIdentity } = await import(
          "@/lib/consultantIdentityBootstrap"
        );
        if (cancelled) return;
        await maybeBootstrapConsultantIdentity({ consultantId: userId });
      } catch {
        /* non-critical */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, isWhapi, connectionStatus]);

  // Presença do consultor: mantém heartbeat na tabela `consultant_presence`
  // a cada 25s. O bot consulta antes de mandar dados de OCR pro cliente —
  // se o consultor está aqui olhando, pausa pra ele decidir no painel.
  useConsultantPresence(userId);
  // Hidrata a partir do sessionStorage para nunca mostrar 0 ao abrir/F5.
  // O refetch acontece em background logo a seguir.
  const [customers, setCustomers] = useState<Record<string, unknown>[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const cached = sessionStorage.getItem(`customers_cache_${userId || "anon"}`);
      if (!cached) return [];
      const parsed = JSON.parse(cached) as Record<string, unknown>[];
      // AUD: cache sem PII sensível (telefone/CPF/e-mail/endereço completo).
      return parsed.map((c) => ({
        id: c.id,
        name: c.name,
        status: c.status,
        created_at: c.created_at,
        address_city: c.address_city,
        address_state: c.address_state,
        customer_origin: c.customer_origin,
        electricity_bill_value: c.electricity_bill_value,
        andamento_igreen: c.andamento_igreen,
        // placeholders até o refetch — evita UI quebrada sem vazar PII
        phone_whatsapp: null,
        email: null,
        cpf: null,
      }));
    } catch { return []; }
  });
  const fetchAbortRef = React.useRef<AbortController | null>(null);
  const { notifications, unreadCount, markAllRead, markRead, clearAll } = useNotifications(userId);

  const fetchCustomers = React.useCallback(async (opts?: { bypassCache?: boolean }) => {
    if (!userId) return;
    // Cancela qualquer fetch em voo (evita race entre trocas de aba).
    fetchAbortRef.current?.abort();
    const controller = new AbortController();
    fetchAbortRef.current = controller;

    if (opts?.bypassCache) {
      try { sessionStorage.removeItem(`customers_cache_${userId}`); } catch { /* ignore */ }
    }

    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const MAX_ATTEMPTS = 3;

    try {
      const selectFields = "id, name, phone_whatsapp, electricity_bill_value, email, cpf, address_city, address_state, address_street, address_neighborhood, address_complement, address_number, cep, numero_instalacao, data_nascimento, status, created_at, distribuidora, registered_by_name, registered_by_igreen_id, media_consumo, desconto_cliente, andamento_igreen, devolutiva, observacao, igreen_code, data_cadastro, data_ativo, data_validado, status_financeiro, cashback, nivel_licenciado, assinatura_cliente, assinatura_igreen, link_assinatura, customer_referred_by_name, customer_referred_by_phone, tipo_produto, customer_origin";
      const allRows: Record<string, unknown>[] = [];
      const pageSize = 1000;
      let page = 0;
      while (true) {
        if (controller.signal.aborted) return;
        // Retry com backoff por página (rede pode falhar transientemente).
        let attempt = 0;
        let pageData: Record<string, unknown>[] | null = null;
        let lastError: unknown = null;
        while (attempt < MAX_ATTEMPTS) {
          const { data, error } = await supabase
            .from("customers")
            .select(selectFields)
            .eq("consultant_id", userId)
            .range(page * pageSize, (page + 1) * pageSize - 1);
          if (controller.signal.aborted) return;
          if (!error) { pageData = (data as Record<string, unknown>[]) || []; break; }
          lastError = error;
          attempt++;
          if (attempt < MAX_ATTEMPTS) await sleep(1000 * 2 ** (attempt - 1));
        }
        if (pageData === null) throw lastError ?? new Error("fetchCustomers failed");
        allRows.push(...pageData);
        if (pageData.length < pageSize) break;
        page++;
      }

      // Sucesso real: só agora substituímos a lista exibida.
      const mapped = allRows.map((c) => ({
        id: c.id, name: (c.name as string) || "Sem nome", phone_whatsapp: c.phone_whatsapp,
        electricity_bill_value: c.electricity_bill_value ?? undefined,
        email: c.email, cpf: c.cpf, address_city: c.address_city, address_state: c.address_state,
        address_street: c.address_street, address_neighborhood: c.address_neighborhood,
        address_complement: c.address_complement, address_number: c.address_number,
        cep: c.cep, numero_instalacao: c.numero_instalacao, data_nascimento: c.data_nascimento,
        status: c.status, created_at: c.created_at, distribuidora: c.distribuidora,
        registered_by_name: c.registered_by_name, registered_by_igreen_id: c.registered_by_igreen_id,
        media_consumo: c.media_consumo, desconto_cliente: c.desconto_cliente,
        andamento_igreen: c.andamento_igreen, devolutiva: c.devolutiva, observacao: c.observacao,
        igreen_code: c.igreen_code, data_cadastro: c.data_cadastro, data_ativo: c.data_ativo,
        data_validado: c.data_validado, status_financeiro: c.status_financeiro,
        cashback: c.cashback, nivel_licenciado: c.nivel_licenciado,
        assinatura_cliente: c.assinatura_cliente, assinatura_igreen: c.assinatura_igreen,
        link_assinatura: c.link_assinatura, customer_origin: c.customer_origin,
      }));
      setCustomers(mapped);
      try {
        // Cache enxuto sem PII (telefone, CPF, e-mail, endereço, links).
        const cacheSafe = mapped.map((c) => ({
          id: c.id,
          name: c.name,
          status: c.status,
          created_at: c.created_at,
          address_city: c.address_city,
          address_state: c.address_state,
          customer_origin: c.customer_origin,
          electricity_bill_value: c.electricity_bill_value,
          andamento_igreen: c.andamento_igreen,
        }));
        sessionStorage.setItem(`customers_cache_${userId}`, JSON.stringify(cacheSafe));
      } catch { /* quota */ }
    } catch (err) {
      // NÃO zeramos a lista em erro — mantemos a última carga visível.
      console.error("[fetchCustomers] falhou após retries — mantendo cache atual", err);
    }
  }, [userId]);

  React.useEffect(() => { fetchCustomers(); }, [fetchCustomers]);

  // Re-fetch ao trocar para clientes/dashboard. AbortController dentro
  // de fetchCustomers já cancela qualquer chamada anterior em voo.
  React.useEffect(() => {
    if (activeTab === "clientes" || activeTab === "dashboard") {
      fetchCustomers();
    }
  }, [activeTab, fetchCustomers]);

  // Realtime: reflete alterações do worker/edge sem exigir novo clique.
  // Debounce + throttle: muitos UPDATEs em sequência não disparam N refetches completos.
  const activeTabRef = React.useRef(activeTab);
  activeTabRef.current = activeTab;
  React.useEffect(() => {
    if (!userId) return;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let analyticsThrottleUntil = 0;
    const channel = supabase
      .channel(`cust-${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "customers", filter: `consultant_id=eq.${userId}` },
        () => {
          if (debounceTimer) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => {
            void fetchCustomers({ bypassCache: true });
            // Analytics só quando o dashboard está visível; throttle de 30s.
            if (activeTabRef.current === "dashboard") {
              const now = Date.now();
              if (now >= analyticsThrottleUntil) {
                analyticsThrottleUntil = now + 30_000;
                void queryClient.invalidateQueries({ queryKey: ["analytics"] });
              }
            }
          }, 1500);
        },
      )
      .subscribe();
    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      void supabase.removeChannel(channel);
    };
  }, [userId, fetchCustomers, queryClient]);

  // Cleanup: cancela fetch pendente ao desmontar.
  React.useEffect(() => () => { fetchAbortRef.current?.abort(); }, []);


  const handleOpenChatFromCustomer = React.useCallback((phone: string, suggestedMessage?: string) => {
    setPendingChatPhone(phone);
    setPendingChatMessage(suggestedMessage);
    setActiveTab("whatsapp");
  }, []);

  const copyLink = (url: string) => { navigator.clipboard.writeText(url); toast({ title: "✅ Link copiado!" }); };

  const baseUrl = "igreen.cloud";
  const slug = form.license || "sua-licenca";

  // Labels e subtítulos por aba — alimenta o AppTopbar
  const TAB_META: Record<AdminTabId, { title: string; subtitle: string }> = {
    "dashboard": { title: "Painel", subtitle: "Resumo do seu dia" },
    "crm": { title: "Clientes interessados", subtitle: "Do WhatsApp até finalizar o cadastro" },
    "crm-clientes": { title: "Clientes ativos", subtitle: "Já cadastrados: aguardando, aprovados, reprovados e acompanhamento mês a mês" },
    "conversao": { title: "Conversão", subtitle: "Quem atender agora para fechar" },
    "clientes": { title: "Clientes", subtitle: "Base ativa e gestão de contas" },
    "financeiro": { title: "Financeiro", subtitle: "Boletos, vencimentos e recebimentos da sua rede iGreen" },
    "produtos": { title: "Produtos & Vendas", subtitle: "Orçamentos, vendas em andamento, ganhos e faturas Green" },
    "captacao": { title: "Captação", subtitle: "Novos interessados que chegaram agora" },
    "parceiros": { title: "Parceiros", subtitle: "Rede de parcerias e indicações" },
    "whatsapp": { title: "WhatsApp", subtitle: "Conversas, mensagens prontas e envios agendados" },
    "agendamentos": { title: "Agendamentos", subtitle: "Envios programados e mensagens automáticas" },
    "central-anuncios": { title: "Central de Anúncios", subtitle: "Resultados das suas campanhas" },
    "links": { title: "Links", subtitle: "Sua página, QR Codes e materiais" },
    "materiais": { title: "Materiais", subtitle: "Arquivos prontos para divulgar" },
    "audio-studio": { title: "Estúdio de Áudio", subtitle: "Grave sua voz ou gere com IA e envie pelo WhatsApp" },
    "voz": { title: "Ligação", subtitle: "Ligações com número da empresa e histórico detalhado" },
    "academy": { title: "iGreen Academy", subtitle: "Treinamentos, provas e seu nível de conhecimento" },
    "venda-plataforma": { title: "Venda da plataforma", subtitle: "Piloto SuperAdmin — WhatsApp, SMS e ligação para consultores" },
  };
  const currentMeta = TAB_META[activeTab];

  if (loading) {
    return <PageStatus title="Carregando painel..." pulse />;
  }

  if (!approved) {
    const publicSlug = form.license || "";
    const publicBase = "https://igreen.cloud";
    return (
      <PageStatus
        title="Aguardando Aprovação"
        description="Sua conta está sendo analisada pelo administrador. Você receberá acesso ao painel assim que for aprovado. Seus links públicos já funcionam."
      >
        {publicSlug ? (
          <div className="w-full max-w-md space-y-2 text-left rounded-xl border border-border bg-card/60 p-4">
            <p className="text-xs font-medium text-muted-foreground">Seus links públicos</p>
            <a className="block text-sm text-primary break-all hover:underline" href={`${publicBase}/${publicSlug}`} target="_blank" rel="noopener noreferrer">
              {publicBase}/{publicSlug}
            </a>
            <a className="block text-sm text-primary break-all hover:underline" href={`${publicBase}/cadastro/${publicSlug}`} target="_blank" rel="noopener noreferrer">
              {publicBase}/cadastro/{publicSlug}
            </a>
            <a className="block text-sm text-primary break-all hover:underline" href={`${publicBase}/licenciado/${publicSlug}`} target="_blank" rel="noopener noreferrer">
              {publicBase}/licenciado/{publicSlug}
            </a>
            {/* Versão premium da landing — também pública, roda em paralelo. */}
            <a className="block text-sm text-primary break-all hover:underline" href={`${publicBase}/premium/${publicSlug}`} target="_blank" rel="noopener noreferrer">
              {publicBase}/premium/{publicSlug}
            </a>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="w-full gap-2"
              onClick={() => copyLink(`${publicBase}/${publicSlug}`)}
            >
              <Copy className="w-4 h-4" /> Copiar link principal
            </Button>
          </div>
        ) : null}
        <Button variant="ghost" size="sm" onClick={handleLogout} className="text-muted-foreground gap-2">
          <LogOut className="w-4 h-4" /> Sair
        </Button>
      </PageStatus>
    );
  }

  const effectivePhotoPreview = localPhotoPreview || photoPreview;

  return (
    <div className="painel-elite h-[100dvh] flex overflow-hidden">
      <AdminSidebarWithBadges
        userId={userId}
        activeTab={activeTab}
        onTabChange={(t) => setActiveTab(t)}
        onNavigate={(href) => navigate(href)}
        consultantName={form.name || "Consultor"}
        consultantLevel={form.igreen_id ? `ID ${form.igreen_id}` : "iGreen Energy"}
        consultantPhoto={effectivePhotoPreview || undefined}
        onLogout={handleLogout}
        open={sidebarOpen}
        onOpenChange={setSidebarOpen}
        collapsed={sidebarCollapsed}
        onCollapse={collapseSidebar}
        onOpenSettings={() => setSettingsOpen(true)}
      />


      <div className="flex-1 flex flex-col min-w-0 lg:ml-0">
        <AppTopbar
          title={currentMeta.title}
          subtitle={form.name ? `${currentMeta.subtitle} • ${form.name}` : currentMeta.subtitle}
          onToggleSidebar={toggleSidebarCollapsed}
          sidebarCollapsed={sidebarCollapsed}
          onOpenSidebar={() => setSidebarOpen(true)}
          privacyMode={privacyMode}
          onTogglePrivacy={togglePrivacy}
          onOpenAi={() => setAiChatOpen(true)}
          notificationSlot={
            <Suspense fallback={<div className="w-9 h-9" />}>
              <NotificationCenter
                notifications={notifications}
                unreadCount={unreadCount}
                onMarkAllRead={markAllRead}
                onMarkRead={markRead}
                onClearAll={clearAll}
                onAction={(n) => {
                  if (n.type === "new_lead" || n.type === "deal_moved") setActiveTab("crm");
                  else if (n.type === "proposal_update") {
                    setActiveTab("produtos");
                    setProdutosSubTab("orcamentos");
                  }
                  else if (n.type === "devolutiva" || n.type === "status_change" || n.type === "new_customer") setActiveTab("crm-clientes");
                }}
              />
            </Suspense>
          }
        />

      <OnboardingGate form={form} saving={saving} onFormChange={handleFormChange} onSave={handleSave}>

      {userId && (
        <ConsultantAutomationPrefsModal
          consultantId={userId}
          autoPrompt={canAutoPromptAutomationPrefs({
            consultantName: form.name,
            assistantName: form.assistant_name,
          })}
        />
      )}

      {/* Content */}
      <main className={activeTab === "captacao" || activeTab === "whatsapp" || activeTab === "crm" || activeTab === "crm-clientes"
        ? "w-full flex-1 min-h-0 px-2 sm:px-3 py-2 overflow-hidden flex flex-col gap-2"
        : activeTab === "academy" || activeTab === "produtos"
          ? "flex-1 min-h-0 overflow-y-auto overflow-x-hidden w-full p-0"
          : "flex-1 min-h-0 overflow-y-auto overflow-x-hidden w-full min-w-0 px-3 sm:px-6 lg:px-10 py-5 sm:py-8 space-y-5 sm:space-y-6"}>

        {/* OCR Review Banner removido (2026-07-18):
            confirmação sempre é feita pelo próprio cliente no WhatsApp
            (botões SIM / NÃO / EDITAR enviados pelo bot logo após o OCR). */}
        <WhatsAppPhoneStatusBanner consultantId={userId} />



        <Suspense fallback={<div className="flex justify-center py-12"><div className="animate-spin h-8 w-8 border-4 border-[var(--pe-emerald)] border-t-transparent rounded-full" /></div>}>
          {activeTab === "dashboard" && userId && (
            <DashboardTab
              userId={userId}
              form={form}
              onFormUpdate={handleFormChange}
              periodDays={periodDays}
              onPeriodChange={setPeriodDays}
              onOpenChat={handleOpenChatFromCustomer}
              instanceName={instanceName}
              isWhapi={isWhapi}
            />
          )}



          {activeTab === "links" && (
            <LinksTab
              slug={slug}
              baseUrl={baseUrl}
              consultantId={userId}
              onCopy={copyLink}
              onQrOpen={(url, label) => setQrPanfleto({ url, label })}
              onPanfletoOpen={() => setPanfletoOpen(true)}
            />
          )}

          {activeTab === "materiais" && (
            <MaterialsTab consultantId={userId} />
          )}

          {userId && activeTab === "crm" && (
            <CrmTabs consultantId={userId} instanceName={instanceName} />
          )}

          {userId && activeTab === "crm-clientes" && (
            <div className="flex-1 min-h-0 overflow-y-auto px-1">
              <PosVendaKanban
                consultantId={userId}
                initialCustomerId={posVendaHighlightId}
                onInitialCustomerConsumed={() => setPosVendaHighlightId(null)}
              />
            </div>
          )}




          {userId && activeTab === "clientes" && (
            <div className="space-y-5">
              <CustomerManager
                customers={customers as never[]}
                consultantId={userId}
                consultantIgreenId={form.igreen_id || undefined}
                consultantName={form.name || undefined}
                onCustomersChange={() => fetchCustomers({ bypassCache: true })}
                instanceName={instanceName}
                onOpenChat={handleOpenChatFromCustomer}
              />
            </div>
          )}

          {userId && activeTab === "financeiro" && (
            <Suspense fallback={<div className="flex justify-center py-12"><div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" /></div>}>
              <FinanceiroPanel userId={userId} onOpenChat={handleOpenChatFromCustomer} />
            </Suspense>
          )}

          {userId && activeTab === "whatsapp" && (
            <WhatsAppErrorBoundary>
              <WhatsAppTab
                key={`whatsapp-tab-${pendingWhatsAppSub ?? "default"}`}
                userId={userId}
                customers={customers as never[]}
                pendingChatPhone={pendingChatPhone}
                pendingChatMessage={pendingChatMessage}
                onPendingChatConsumed={() => { setPendingChatPhone(null); setPendingChatMessage(undefined); }}
                initialSubTab={
                  pendingWhatsAppSub === "envio_massa" ? "envio_massa"
                  : pendingWhatsAppSub === "agendamentos" ? "agendamentos"
                  : pendingAiSubTab ? "agente" : undefined
                }
                initialAgentSubTab={pendingAiSubTab as any}
                onSubTabConsumed={() => setPendingWhatsAppSub(null)}
                autoConnectOnMount={pendingWhatsAppAutoConnect}
                onAutoConnectConsumed={() => setPendingWhatsAppAutoConnect(false)}
              />
            </WhatsAppErrorBoundary>
          )}

          {userId && activeTab === "agendamentos" && (
            <Suspense fallback={<div className="flex justify-center py-12"><div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" /></div>}>
              <AgendamentosHub
                consultantId={userId}
                instanceName={instanceName || ""}
                isWhapi={!!isWhapi}
                isConnected={!!isWhapi || connectionStatus === "connected"}
                defaultTab={(pendingHubTab as import("@/lib/agendamentosHub").AgendamentosHubTab | null) ?? undefined}
                key={pendingHubTab || "agendamentos-default"}
                onOpenChat={handleOpenChatFromCustomer}
              />
            </Suspense>
          )}

          {userId && activeTab === "central-anuncios" && (
            <AdsCentralTab consultantId={userId} />
          )}

          {userId && activeTab === "conversao" && (
              <ConversaoCockpit
                consultantId={userId}
                initialView={pendingConversaoView ?? undefined}
                onViewConsumed={() => setPendingConversaoView(null)}
              />
          )}

          {userId && activeTab === "produtos" && (
            <ProdutosModule
              consultantId={userId}
              initialTab={produtosSubTab}
              instanceName={instanceName}
              isWhapi={isWhapi}
              onTabChange={setProdutosSubTab}
              onOpenPosVenda={(customerId) => {
                setPosVendaHighlightId(customerId);
                setActiveTab("crm-clientes");
              }}
              onOpenSettings={() => setSettingsOpen(true)}
            />
          )}

          {userId && activeTab === "captacao" && (
            <CaptacaoPanel
              consultantId={userId}
              instanceName={instanceName}
              isWhapi={isWhapi}
              onOpenChat={(phone) => { setPendingChatPhone(phone); setActiveTab("whatsapp"); }}
            />
          )}

          {userId && activeTab === "parceiros" && (
            <ParceirosTab
              consultantId={userId}
              consultantPhone={form.phone || ""}
              consultantName={form.name || ""}
              consultantIgreenId={form.igreen_id || ""}
              license={form.license || ""}
              isWhapi={!!isWhapi}
            />
          )}


          {userId && activeTab === "audio-studio" && (
            <div className="max-w-6xl mx-auto w-full">
              <AudioStudioPanel userId={userId} />
            </div>
          )}

          {userId && activeTab === "voz" && (
            <VozTab consultantId={userId} onOpenChat={handleOpenChatFromCustomer} />
          )}

          {activeTab === "academy" && (
            <AcademyTab />
          )}
          {activeTab === "venda-plataforma" && userId && (
            isSuperAdmin ? (
              <VendaPlataformaPanel userId={userId} />
            ) : (
              <PageStatus
                title="Acesso restrito"
                description="Esta área é exclusiva do SuperAdmin."
              />
            )
          )}

        </Suspense>
      </main>

      </OnboardingGate>
      </div>



      {/* Settings Sheet (Dados) */}
      <Sheet open={settingsOpen} onOpenChange={setSettingsOpen}>
        <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Configurações</SheetTitle>
          </SheetHeader>
          <div className="mt-6 space-y-6">
            <DadosTab form={form} photoPreview={effectivePhotoPreview} saving={saving} onFormChange={handleFormChange} onPhotoChange={handlePhotoChange} onSave={handleSave} userId={userId || ""} />
            <Suspense fallback={null}>
              {userId && <ConsultantAutomationPrefsCard consultantId={userId} variant="full" />}
              {userId && <IGreenConnectionCard userId={userId} />}
              {userId && <IGreenSyncStatusBar consultantId={userId} />}
              <BonusTiersAdminCard />
              <ChangePasswordCard />
              {userId && (
                <WhatsAppConnectionSettingsCard
                  isWhapi={!!isWhapi}
                  connectionStatus={connectionStatus}
                  phoneNumber={waPhoneNumber}
                  isLoading={waLoading}
                  healthEnabled={settingsOpen}
                  onDisconnect={disconnectWhatsApp}
                  onGoWhatsApp={() => {
                    // Só abre a aba — NÃO dispara reauth/logout.
                    setSettingsOpen(false);
                    setActiveTab("whatsapp");
                  }}
                  onGoConnectAnother={() => {
                    // Trocar chip: só pede QR depois de desconectar (ou se já estiver fora).
                    setSettingsOpen(false);
                    setPendingWhatsAppAutoConnect(true);
                    setActiveTab("whatsapp");
                  }}
                />
              )}
            </Suspense>
          </div>
        </SheetContent>
      </Sheet>

      {/* QR Code Modal (link pessoal) — usa o mesmo PanfletoModal */}
      <Suspense fallback={null}>
        <PanfletoModal
          open={!!qrPanfleto}
          onClose={() => setQrPanfleto(null)}
          licenca={slug}
          nomeConsultor={form.name || ""}
          telefoneConsultor={form.phone || ""}
          igreenId={form.igreen_id || ""}
          shareUrl={qrPanfleto?.url}
          title={qrPanfleto ? `QR Code — ${qrPanfleto.label}` : undefined}
        />
      </Suspense>

      {/* AI Chat Panel */}
      {aiChatOpen && (
        <Suspense fallback={null}>
          <AIChatPanel open={aiChatOpen} onClose={() => setAiChatOpen(false)} />
        </Suspense>
      )}

      {/* Panfleto Modal */}
      <Suspense fallback={null}>
        <PanfletoModal
          open={panfletoOpen}
          onClose={() => setPanfletoOpen(false)}
          licenca={slug}
          nomeConsultor={form.name || ""}
          telefoneConsultor={form.phone || ""}
          igreenId={form.igreen_id || ""}
        />
      </Suspense>
    </div>
  );
};

/** Sidebar com badge dinâmico de boletos alertando (vence hoje + vencidos).
 *  Mantém isolado para que o hook não force re-render em todos os inputs. */
function AdminSidebarWithBadges({
  userId,
  ...rest
}: {
  userId: string | null;
} & Omit<React.ComponentProps<typeof AppSidebar>, "badges">) {
  const { isSuperAdmin, isAdmin } = useUserRole(userId);
  const scope: "all" | "self" = isSuperAdmin || isAdmin ? "all" : "self";
  const { data: alertas } = useAlertasBoletosCount(userId ?? undefined, scope);
  return (
    <AppSidebar
      {...rest}
      isSuperAdmin={isSuperAdmin}
      badges={{ financeiro: alertas && alertas > 0 ? alertas : undefined }}
    />
  );
}


const Admin = () => (
  <PrivacyModeProvider>
    <AdminContent />
  </PrivacyModeProvider>
);

export default Admin;
