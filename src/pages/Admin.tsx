import React, { useState, useEffect, lazy, Suspense } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { LogOut, Copy, Download, X } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { OnboardingGate } from "@/components/admin/OnboardingGate";
import { PrivacyModeProvider, usePrivacyMode } from "@/contexts/PrivacyModeContext";
import { useQueryClient } from "@tanstack/react-query";
import { WhatsAppErrorBoundary } from "@/components/whatsapp/WhatsAppErrorBoundary";
import { useWhatsApp } from "@/hooks/useWhatsApp";
import { useNotifications } from "@/hooks/useNotifications";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { useConsultantForm } from "@/hooks/useConsultantForm";
import { useConsultantPresence } from "@/hooks/useConsultantPresence";
import { OcrReviewBanner } from "@/components/captacao/OcrReviewBanner";
import PageStatus from "@/components/common/PageStatus";
import { AppSidebar, type AdminTabId } from "@/components/layout/AppSidebar";
import { AppTopbar } from "@/components/layout/AppTopbar";


// Heavy panels — lazy load on demand
const QRCodeSVG = lazy(() => import("qrcode.react").then(m => ({ default: m.QRCodeSVG })));
const DashboardTab = lazy(() => import("@/components/admin/DashboardTab").then(m => ({ default: m.DashboardTab })));
const DadosTab = lazy(() => import("@/components/admin/DadosTab").then(m => ({ default: m.DadosTab })));
const IGreenExtensionCard = lazy(() => import("@/components/admin/IGreenExtensionCard").then(m => ({ default: m.IGreenExtensionCard })));
const BonusTiersAdminCard = lazy(() => import("@/components/admin/BonusTiersAdminCard").then(m => ({ default: m.BonusTiersAdminCard })));
const LinksTab = lazy(() => import("@/components/admin/LinksTab").then(m => ({ default: m.LinksTab })));

const NotificationCenter = lazy(() => import("@/components/admin/NotificationCenter").then(m => ({ default: m.NotificationCenter })));
const AIChatPanel = lazy(() => import("@/components/admin/AIChatPanel").then(m => ({ default: m.AIChatPanel })));
const WhatsAppTab = lazy(() => import("@/components/whatsapp/WhatsAppTab").then(m => ({ default: m.WhatsAppTab })));
const CrmTabs = lazy(() => import("@/components/whatsapp/CrmTabs").then(m => ({ default: m.CrmTabs })));
const PosVendaKanban = lazy(() => import("@/components/whatsapp/PosVendaKanban"));

const CustomerManager = lazy(() => import("@/components/whatsapp/CustomerManager").then(m => ({ default: m.CustomerManager })));

const MaterialsTab = lazy(() => import("@/components/admin/MaterialsTab").then(m => ({ default: m.MaterialsTab })));
const NetworkPanel = lazy(() => import("@/components/admin/NetworkPanel").then(m => ({ default: m.NetworkPanel })));
const PanfletoModal = lazy(() => import("@/components/admin/PanfletoModal").then(m => ({ default: m.PanfletoModal })));

const AdsCentralTab = lazy(() => import("@/components/admin/ads/AdsCentralTab").then(m => ({ default: m.AdsCentralTab })));
const CaptacaoPanel = lazy(() => import("@/components/captacao/CaptacaoPanel").then(m => ({ default: m.CaptacaoPanel })));
const ParceirosTab = lazy(() => import("@/components/admin/parceiros/ParceirosTab").then(m => ({ default: m.ParceirosTab })));
const ConversaoTab = lazy(() => import("@/components/admin/ConversaoTab").then(m => ({ default: m.ConversaoTab })));
const AudioStudioPanel = lazy(() => import("@/components/admin/AudioStudio").then(m => ({ default: m.AudioStudio })));



import { SupportChatButton } from "@/components/support/SupportChatButton";

const AdminContent = () => {
  const { privacyMode, togglePrivacy } = usePrivacyMode();
  const { loading, approved, userId, form, photoPreview, setPhotoPreview, handleFormChange, handleLogout, setForm } = useAdminAuth();
  const { saving, photoPreview: localPhotoPreview, handlePhotoChange, handleSave } = useConsultantForm(userId, form, setForm, setPhotoPreview);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

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
  const [activeTab, setActiveTab] = useState<AdminTabId>(() => {
    if (typeof window !== "undefined") {
      const tab = new URLSearchParams(window.location.search).get("tab");
      if (tab === "performance" || tab === "anuncios" || tab === "central-anuncios") return "central-anuncios";
      if (tab === "whatsapp" || tab === "agente" || tab === "historico") return "whatsapp";
      if (tab === "preview") return "links";
      if (tab === "captacao" || tab === "game" || tab === "modo-game") return "captacao";
      if (tab === "crm" || tab === "crm-clientes" || tab === "clientes" || tab === "rede" || tab === "materiais" || tab === "parceiros" || tab === "conversao" || tab === "audio-studio") return tab as AdminTabId;
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
  const [qrPanfleto, setQrPanfleto] = useState<{ url: string; label: string } | null>(null);
  const [panfletoOpen, setPanfletoOpen] = useState(false);
  const [aiChatOpen, setAiChatOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  useEffect(() => {
    const h = () => setSettingsOpen(true);
    window.addEventListener("open-admin-settings", h);
    return () => window.removeEventListener("open-admin-settings", h);
  }, []);
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

  const baseUrl = "igreen.cloud";
  const slug = form.license || "sua-licenca";

  // Labels e subtítulos por aba — alimenta o AppTopbar
  const TAB_META: Record<AdminTabId, { title: string; subtitle: string }> = {
    "dashboard": { title: "Dashboard", subtitle: "Resumo operacional do dia" },
    "crm": { title: "CRM Leads", subtitle: "Funil de leads do WhatsApp até finalizar cadastro" },
    "crm-clientes": { title: "CRM Clientes", subtitle: "Pós-venda iGreen — Em Espera, Aprovado, Reprovado e progressão 30/60/90/120 dias" },
    "conversao": { title: "Conversão", subtitle: "Análise de funil e gargalos" },
    "clientes": { title: "Clientes", subtitle: "Base ativa e gestão de contas" },
    "captacao": { title: "Captação", subtitle: "Novos leads e originação" },
    "parceiros": { title: "Parceiros", subtitle: "Rede de parcerias e indicações" },
    "rede": { title: "Rede", subtitle: "Sua estrutura e hierarquia" },
    "whatsapp": { title: "WhatsApp", subtitle: "Atendimento, automação e disparo" },
    "central-anuncios": { title: "Central de Anúncios", subtitle: "Performance de campanhas" },
    "links": { title: "Links", subtitle: "Sua landing, QR Codes e materiais" },
    "materiais": { title: "Materiais", subtitle: "Biblioteca de assets de divulgação" },
    "audio-studio": { title: "Estúdio de Áudio", subtitle: "Grave sua voz ou gere com IA e envie pelo WhatsApp" },
  };
  const currentMeta = TAB_META[activeTab];

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
    <div className="painel-elite h-[100dvh] flex overflow-hidden">
      <AppSidebar
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
          onOpenSettings={() => setSettingsOpen(true)}
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
                  else if (n.type === "devolutiva" || n.type === "status_change" || n.type === "new_customer") setActiveTab("crm-clientes");
                }}
              />
            </Suspense>
          }
        />

      <OnboardingGate form={form} saving={saving} onFormChange={handleFormChange} onSave={handleSave}>

      {/* Content */}
      <main className={activeTab === "captacao" || activeTab === "whatsapp" || activeTab === "crm" || activeTab === "crm-clientes"
        ? "w-full flex-1 min-h-0 px-2 sm:px-3 py-2 overflow-hidden flex flex-col gap-2"
        : "flex-1 min-h-0 overflow-y-auto w-full px-4 sm:px-6 lg:px-10 py-6 sm:py-8 space-y-6 overflow-x-hidden"}>
        {/* OCR Review Banner */}
        <OcrReviewBanner consultantId={userId} />

        <Suspense fallback={<div className="flex justify-center py-12"><div className="animate-spin h-8 w-8 border-4 border-[var(--pe-emerald)] border-t-transparent rounded-full" /></div>}>
          {activeTab === "dashboard" && userId && (
            <DashboardTab userId={userId} form={form} onFormUpdate={handleFormChange} periodDays={periodDays} onPeriodChange={setPeriodDays} />
          )}



          {activeTab === "links" && (
            <LinksTab
              slug={slug}
              baseUrl={baseUrl}
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
              <PosVendaKanban consultantId={userId} />
            </div>
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

          {userId && activeTab === "conversao" && (
            <ConversaoTab consultantId={userId} />
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

          {userId && activeTab === "audio-studio" && (
            <div className="max-w-2xl mx-auto w-full">
              <AudioStudioPanel userId={userId} />
            </div>
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
              {userId && <IGreenExtensionCard userId={userId} />}
              <BonusTiersAdminCard />
            </Suspense>
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
