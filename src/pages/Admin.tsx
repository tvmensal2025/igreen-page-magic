import React, { useState, useEffect, lazy, Suspense } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { LogOut, BarChart3, LinkIcon, Settings, MessageSquare, LayoutGrid, Users, Copy, Download, X, Sparkles, FolderDown, Network, Eye, EyeOff, Megaphone, ClipboardList, Handshake, Flame } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { OnboardingGate } from "@/components/admin/OnboardingGate";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { PrivacyModeProvider, usePrivacyMode } from "@/contexts/PrivacyModeContext";
import { useQueryClient } from "@tanstack/react-query";
import { WhatsAppErrorBoundary } from "@/components/whatsapp/WhatsAppErrorBoundary";
import { useWhatsApp } from "@/hooks/useWhatsApp";
import { useNotifications } from "@/hooks/useNotifications";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { useConsultantForm } from "@/hooks/useConsultantForm";
import { useConsultantPresence } from "@/hooks/useConsultantPresence";
import { OcrReviewBanner } from "@/components/captacao/OcrReviewBanner";
import AppHeader from "@/components/layout/AppHeader";
import AmbientGlow from "@/components/common/AmbientGlow";
import PageStatus from "@/components/common/PageStatus";

// Heavy panels — lazy load on demand
const QRCodeSVG = lazy(() => import("qrcode.react").then(m => ({ default: m.QRCodeSVG })));
const DashboardTab = lazy(() => import("@/components/admin/DashboardTab").then(m => ({ default: m.DashboardTab })));
const DadosTab = lazy(() => import("@/components/admin/DadosTab").then(m => ({ default: m.DadosTab })));
const LinksTab = lazy(() => import("@/components/admin/LinksTab").then(m => ({ default: m.LinksTab })));

const NotificationCenter = lazy(() => import("@/components/admin/NotificationCenter").then(m => ({ default: m.NotificationCenter })));
const AIChatPanel = lazy(() => import("@/components/admin/AIChatPanel").then(m => ({ default: m.AIChatPanel })));
const WhatsAppTab = lazy(() => import("@/components/whatsapp/WhatsAppTab").then(m => ({ default: m.WhatsAppTab })));
const CrmTabs = lazy(() => import("@/components/whatsapp/CrmTabs").then(m => ({ default: m.CrmTabs })));

const CustomerManager = lazy(() => import("@/components/whatsapp/CustomerManager").then(m => ({ default: m.CustomerManager })));

const MaterialsTab = lazy(() => import("@/components/admin/MaterialsTab").then(m => ({ default: m.MaterialsTab })));
const NetworkPanel = lazy(() => import("@/components/admin/NetworkPanel").then(m => ({ default: m.NetworkPanel })));
const PanfletoModal = lazy(() => import("@/components/admin/PanfletoModal").then(m => ({ default: m.PanfletoModal })));

const AdsCentralTab = lazy(() => import("@/components/admin/ads/AdsCentralTab").then(m => ({ default: m.AdsCentralTab })));
const CaptacaoPanel = lazy(() => import("@/components/captacao/CaptacaoPanel").then(m => ({ default: m.CaptacaoPanel })));
const ParceirosTab = lazy(() => import("@/components/admin/parceiros/ParceirosTab").then(m => ({ default: m.ParceirosTab })));
const InstallPwaButton = lazy(() => import("@/components/admin/InstallPwaButton").then(m => ({ default: m.InstallPwaButton })));
import { LayoutLockToggle } from "@/components/layout/LayoutLockToggle";

import { SupportChatButton } from "@/components/support/SupportChatButton";

const AdminContent = () => {
  const { privacyMode, togglePrivacy } = usePrivacyMode();
  const { loading, approved, userId, form, photoPreview, setPhotoPreview, handleFormChange, handleLogout, setForm } = useAdminAuth();
  const { saving, photoPreview: localPhotoPreview, handlePhotoChange, handleSave } = useConsultantForm(userId, form, setForm, setPhotoPreview);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState<"materiais" | "dashboard" | "links" | "whatsapp" | "crm" | "clientes" | "rede" | "central-anuncios" | "captacao" | "parceiros">(() => {
    if (typeof window !== "undefined") {
      const tab = new URLSearchParams(window.location.search).get("tab");
      if (tab === "performance" || tab === "anuncios" || tab === "central-anuncios") return "central-anuncios";
      if (tab === "whatsapp" || tab === "agente" || tab === "historico") return "whatsapp";
      if (tab === "preview") return "links";
      if (tab === "captacao" || tab === "game" || tab === "modo-game") return "captacao";
      if (tab === "crm" || tab === "clientes" || tab === "rede" || tab === "materiais" || tab === "parceiros") return tab as any;
    }
    return "dashboard";
  });
  const [pendingChatPhone, setPendingChatPhone] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("phone");
  });
  const [pendingChatMessage, setPendingChatMessage] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("phone")) {
      params.delete("phone");
      const qs = params.toString();
      window.history.replaceState({}, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
    }
  }, []);
  const [qrModal, setQrModal] = useState<{ url: string; label: string } | null>(null);
  const [panfletoOpen, setPanfletoOpen] = useState(false);
  const [aiChatOpen, setAiChatOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [periodDays, setPeriodDays] = useState(30);

  const { instanceName, isWhapi } = useWhatsApp(userId || "");

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
      return cached ? (JSON.parse(cached) as Record<string, unknown>[]) : [];
    } catch { return []; }
  });
  const fetchAbortRef = React.useRef<AbortController | null>(null);
  const { notifications, unreadCount, markAllRead, markRead, clearAll } = useNotifications(userId);

  const fetchCustomers = React.useCallback(async () => {
    if (!userId) return;
    // Cancela qualquer fetch em voo (evita race entre trocas de aba).
    fetchAbortRef.current?.abort();
    const controller = new AbortController();
    fetchAbortRef.current = controller;

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
      try { sessionStorage.setItem(`customers_cache_${userId}`, JSON.stringify(mapped)); } catch { /* quota */ }
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

  // Cleanup: cancela fetch pendente ao desmontar.
  React.useEffect(() => () => { fetchAbortRef.current?.abort(); }, []);

  const handleOpenChatFromCustomer = React.useCallback((phone: string, suggestedMessage?: string) => {
    setPendingChatPhone(phone);
    setPendingChatMessage(suggestedMessage);
    setActiveTab("whatsapp");
  }, []);

  const copyLink = (url: string) => { navigator.clipboard.writeText(url); toast({ title: "✅ Link copiado!" }); };

  const baseUrl = "igreen.institutodossonhos.com.br";
  const slug = form.license || "sua-licenca";

  const tabs: Array<{ id: string; label: string; icon: any; href?: string; external?: boolean }> = [
    { id: "dashboard", label: "Dashboard", icon: BarChart3 },
    { id: "crm", label: "CRM", icon: LayoutGrid },
    { id: "conversao", label: "Conversão", icon: Flame, href: "/admin/conversao" },
    { id: "clientes", label: "Clientes", icon: Users },
    { id: "captacao", label: "Captação", icon: ClipboardList },
    { id: "parceiros", label: "Parceiros", icon: Handshake },
    { id: "rede", label: "Rede", icon: Network },
    { id: "whatsapp", label: "WhatsApp", icon: MessageSquare },
    { id: "central-anuncios", label: "Central de Anúncios", icon: Megaphone },
    { id: "links", label: "Links", icon: LinkIcon },
    { id: "materiais", label: "Materiais", icon: FolderDown, external: true },
  ];


  if (loading) {
    return <PageStatus title="Carregando painel..." pulse />;
  }

  if (!approved) {
    return (
      <PageStatus
        title="Aguardando Aprovação"
        description="Sua conta está sendo analisada pelo administrador. Você receberá acesso assim que for aprovado."
      >
        <Button variant="ghost" size="sm" onClick={handleLogout} className="text-muted-foreground gap-2">
          <LogOut className="w-4 h-4" /> Sair
        </Button>
      </PageStatus>
    );
  }

  const effectivePhotoPreview = localPhotoPreview || photoPreview;

  return (
    <div className="h-[100dvh] bg-background relative overflow-hidden flex flex-col">
      {/* Ambient gradient for ultrawide screens — evita fundo preto vazio nas laterais */}
      <AmbientGlow variant="panel" className="fixed" />
      {/* Header */}
      <AppHeader
        title="Painel do Consultor"
        subtitle={form.name || "Bem-vindo"}
        subtitleSensitive
        actions={
          <>
            <button
              onClick={togglePrivacy}
              className={`relative p-1.5 sm:p-2 rounded-xl transition-all duration-200 ${privacyMode ? 'text-primary bg-primary/15' : 'text-muted-foreground hover:text-foreground hover:bg-secondary'}`}
              aria-label={privacyMode ? "Mostrar dados sensíveis" : "Ocultar dados sensíveis"}
              title={privacyMode ? "Modo privacidade ATIVO — clique para desativar" : "Ocultar dados sensíveis para gravação"}
            >
              {privacyMode ? <EyeOff className="h-4 w-4 sm:h-5 sm:w-5" /> : <Eye className="h-4 w-4 sm:h-5 sm:w-5" />}
            </button>
            <div className="hidden sm:block"><ThemeToggle /></div>
            <button
              onClick={() => setAiChatOpen(true)}
              className="hidden sm:inline-flex relative p-2 rounded-xl text-muted-foreground hover:text-foreground hover:bg-secondary transition-all duration-200"
              aria-label="Assistente iGreen IA"
              title="Assistente iGreen IA"
            >
              <Sparkles className="h-5 w-5" />
            </button>
            <Suspense fallback={null}><InstallPwaButton /></Suspense>
            <LayoutLockToggle />

            <Suspense fallback={<div className="w-9 h-9" />}>
              <NotificationCenter
                notifications={notifications}
                unreadCount={unreadCount}
                onMarkAllRead={markAllRead}
                onMarkRead={markRead}
                onClearAll={clearAll}
                onAction={(n) => {
                  if (n.type === "new_lead" || n.type === "deal_moved") setActiveTab("crm");
                  else if (n.type === "devolutiva" || n.type === "status_change" || n.type === "new_customer") setActiveTab("clientes");
                }}
              />
            </Suspense>
            <button
              onClick={() => setSettingsOpen(true)}
              className="relative p-1.5 sm:p-2 rounded-xl text-muted-foreground hover:text-foreground hover:bg-secondary transition-all duration-200"
              aria-label="Configurações"
              title="Configurações"
            >
              <Settings className="h-4 w-4 sm:h-5 sm:w-5" />
            </button>
            <Button variant="ghost" size="sm" onClick={handleLogout} className="text-muted-foreground hover:text-foreground gap-2 rounded-xl px-2 sm:px-3">
              <LogOut className="w-4 h-4" />
              <span className="hidden sm:inline">Sair</span>
            </Button>
          </>
        }
      />

      <OnboardingGate form={form} saving={saving} onFormChange={handleFormChange} onSave={handleSave}>

      {/* Tab Navigation */}
      <nav className="shrink-0 border-b border-border bg-card/50 backdrop-blur-sm">
        <div className="max-w-[1920px] mx-auto px-2 sm:px-5 lg:px-8">
          <div className="flex overflow-x-auto no-scrollbar -mx-2 sm:mx-0" style={{ WebkitOverflowScrolling: 'touch' }}>
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button key={tab.id} onClick={() => {
                  if (tab.external && tab.id === "materiais") {
                    window.open("https://drive.google.com/drive/folders/1KupNLRpZaJwHfgRUgbWV-cGYQenreSfu", "_blank", "noopener,noreferrer");
                    return;
                  }
                  if (tab.href) { navigate(tab.href); return; }
                  setActiveTab(tab.id as any);
                }}
                  className={`flex flex-col sm:flex-row items-center justify-center gap-0.5 sm:gap-2 px-2.5 sm:px-3 py-1.5 sm:py-2 text-[10px] sm:text-sm font-medium whitespace-nowrap border-b-2 transition-all duration-200 shrink-0 min-w-[56px] sm:min-w-0 ${
                    isActive 
                      ? "border-primary text-primary" 
                      : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
                  }`}
                  title={tab.label}
                  aria-label={tab.label}>
                  <Icon className={`w-5 h-5 sm:w-4 sm:h-4 ${isActive ? "text-primary" : ""}`} />
                  <span className="leading-tight">{tab.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </nav>

      {/* Content */}
      <main className={activeTab === "captacao" || activeTab === "whatsapp" || activeTab === "crm"
        ? "w-full flex-1 min-h-0 px-1 sm:px-1.5 lg:px-2 py-1 overflow-hidden flex flex-col gap-1"
        : "flex-1 min-h-0 overflow-y-auto max-w-[1920px] mx-auto w-full px-4 sm:px-6 lg:px-10 xl:px-14 py-6 sm:py-8 space-y-6 overflow-x-hidden"}>
        {/* OCR Review Banner — aparece quando há leads aguardando o consultor
            decidir entre "Eu confirmo" / "Pedir ao cliente" os dados extraídos
            da conta de luz ou do documento. Sempre no topo, em qualquer aba. */}
        <OcrReviewBanner consultantId={userId} />

        <Suspense fallback={<div className="flex justify-center py-12"><div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" /></div>}>
          {activeTab === "dashboard" && userId && (
            <DashboardTab userId={userId} form={form} onFormUpdate={handleFormChange} periodDays={periodDays} onPeriodChange={setPeriodDays} />
          )}

          {activeTab === "links" && (
            <LinksTab
              slug={slug}
              baseUrl={baseUrl}
              onCopy={copyLink}
              onQrOpen={(url, label) => setQrModal({ url, label })}
              onPanfletoOpen={() => setPanfletoOpen(true)}
            />
          )}

          {activeTab === "materiais" && (
            <MaterialsTab consultantId={userId} />
          )}

          {userId && activeTab === "crm" && (
            <CrmTabs consultantId={userId} instanceName={instanceName} />
          )}




          {userId && activeTab === "clientes" && (
            <CustomerManager
              customers={customers as never[]}
              consultantId={userId}
              onCustomersChange={fetchCustomers}
              instanceName={instanceName}
              onOpenChat={handleOpenChatFromCustomer}
            />
          )}

          {userId && activeTab === "rede" && (
            <NetworkPanel consultantId={userId} />
          )}

          {userId && activeTab === "whatsapp" && (
            <WhatsAppErrorBoundary>
              <WhatsAppTab
                key="whatsapp-tab"
                userId={userId}
                customers={customers as never[]}
                pendingChatPhone={pendingChatPhone}
                pendingChatMessage={pendingChatMessage}
                onPendingChatConsumed={() => { setPendingChatPhone(null); setPendingChatMessage(undefined); }}
              />
            </WhatsAppErrorBoundary>
          )}

          {userId && activeTab === "central-anuncios" && (
            <AdsCentralTab consultantId={userId} />
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
              consultantPhone={form.phone || ""}
              consultantName={form.name || ""}
              consultantIgreenId={form.igreen_id || ""}
            />
          )}

        </Suspense>
      </main>

      </OnboardingGate>

      {/* Settings Sheet (Dados) */}
      <Sheet open={settingsOpen} onOpenChange={setSettingsOpen}>
        <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Configurações</SheetTitle>
          </SheetHeader>
          <div className="mt-6">
            <DadosTab form={form} photoPreview={effectivePhotoPreview} saving={saving} onFormChange={handleFormChange} onPhotoChange={handlePhotoChange} onSave={handleSave} userId={userId || ""} />
          </div>
        </SheetContent>
      </Sheet>

      {/* QR Code Modal */}
      {qrModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setQrModal(null)}>
          <div className="bg-card rounded-2xl border border-border p-6 sm:p-8 max-w-sm w-full mx-4 space-y-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-heading font-bold text-foreground text-lg">QR Code</h3>
              <button onClick={() => setQrModal(null)} className="text-muted-foreground hover:text-foreground transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-muted-foreground">{qrModal.label}</p>
            <div className="flex justify-center bg-white rounded-xl p-6">
              <Suspense fallback={<div className="w-[200px] h-[200px] flex items-center justify-center"><div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" /></div>}>
                <QRCodeSVG id="qr-canvas" value={qrModal.url} size={200} level="H" includeMargin={false} />
              </Suspense>
            </div>
            <p className="text-xs text-muted-foreground text-center break-all">{qrModal.url}</p>
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1 gap-2 rounded-xl" onClick={() => copyLink(qrModal.url)}>
                <Copy className="w-4 h-4" /> Copiar link
              </Button>
              <Button className="flex-1 gap-2 rounded-xl" style={{ background: "var(--gradient-green)" }} onClick={() => {
                const svg = document.getElementById("qr-canvas");
                if (!svg) return;
                const svgData = new XMLSerializer().serializeToString(svg);
                const canvas = document.createElement("canvas");
                canvas.width = 600; canvas.height = 600;
                const ctx = canvas.getContext("2d")!;
                ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, 600, 600);
                const img = new Image();
                img.onload = () => {
                  ctx.drawImage(img, 50, 50, 500, 500);
                  const a = document.createElement("a");
                  a.download = `qrcode-${qrModal.label.toLowerCase().replace(/[^a-z0-9]/g, "-")}.png`;
                  a.href = canvas.toDataURL("image/png"); a.click();
                };
                img.src = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svgData)));
              }}>
                <Download className="w-4 h-4" /> Baixar PNG
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* AI Chat Panel */}
      {aiChatOpen && (
        <Suspense fallback={null}>
          <AIChatPanel open={aiChatOpen} onClose={() => setAiChatOpen(false)} />
        </Suspense>
      )}

      {/* Panfleto Modal */}
      {panfletoOpen && (
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
      )}

      
    </div>
  );
};

const Admin = () => (
  <PrivacyModeProvider>
    <AdminContent />
  </PrivacyModeProvider>
);

export default Admin;
