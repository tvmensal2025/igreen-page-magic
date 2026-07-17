import { lazy, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ConfirmDialogProvider } from "@/components/ui/confirm-dialog";
import { PromptDialogProvider } from "@/components/ui/prompt-dialog";
import { ThemeProvider } from "@/contexts/ThemeContext";

const CRMLandingPage = lazy(() => import("./pages/CRMLandingPage"));
const ConsultantPage = lazy(() => import("./pages/ConsultantPage"));
const CadastroPage = lazy(() => import("./pages/CadastroPage"));
const WhatsAppClientsPage = lazy(() => import("./pages/WhatsAppClientsPage"));
const LicenciadaPage = lazy(() => import("./pages/LicenciadaPage"));
const LicenciadaPreview = lazy(() => import("./pages/LicenciadaPreview"));
const AssistentePage = lazy(() => import("./pages/AssistentePage"));
const Auth = lazy(() => import("./pages/Auth"));
const Admin = lazy(() => import("./pages/Admin"));

const FluxoBuilder = lazy(() => import("./pages/FluxoBuilder"));
const AdminFluxoB = lazy(() => import("./pages/AdminFluxoB"));
const SaudeBot = lazy(() => import("./pages/SaudeBot"));
const AdminKnowledge = lazy(() => import("./pages/AdminKnowledge"));
const AdminReaquecimento = lazy(() => import("./pages/AdminReaquecimento"));
const AdminVoz = lazy(() => import("./pages/AdminVoz"));
const AdminReconIgreen = lazy(() => import("./pages/AdminReconIgreen"));
const AdminConversao = lazy(() => import("./pages/AdminConversao"));
const AdminMetaAds = lazy(() => import("./pages/AdminMetaAds"));
const SuperAdmin = lazy(() => import("./pages/SuperAdmin"));
const SaudeProducao = lazy(() => import("./pages/SaudeProducao"));
const AdminPortalMonitor = lazy(() => import("./pages/AdminPortalMonitor"));
const AdminProtocolsPage = lazy(() => import("./pages/AdminProtocolsPage"));
const AdminMotorCadencia = lazy(() => import("./pages/AdminMotorCadencia"));
const AdminAgendamentosCentral = lazy(() => import("./pages/AdminAgendamentosCentral"));
const AdminSofiaNameAudios = lazy(() => import("./pages/AdminSofiaNameAudios"));
const ConsultantMessages = lazy(() => import("./pages/ConsultantMessages"));
const AjudaPage = lazy(() => import("./pages/AjudaPage"));
const AdminTourEditor = lazy(() => import("./pages/AdminTourEditor"));

const NotFound = lazy(() => import("./pages/NotFound"));

const ConexaoProductPage = lazy(() => import("./pages/ConexaoProductPage"));
const RedirectConexaoGreen = lazy(() =>
  import("./pages/ConexaoCanonicalRedirects").then((m) => ({ default: m.RedirectConexaoGreen })),
);
const RedirectConexaoExpansao = lazy(() =>
  import("./pages/ConexaoCanonicalRedirects").then((m) => ({ default: m.RedirectConexaoExpansao })),
);
const ProposalPublicPage = lazy(() => import("./pages/ProposalPublicPage"));
const SolarDesignPage = lazy(() => import("./features/solar-3d/pages/SolarDesignPage"));
const SolarDesignDetailPage = lazy(() => import("./features/solar-3d/pages/SolarDesignDetailPage"));
const InstallPage = lazy(() => import("./pages/InstallPage"));
const PoliticaPrivacidade = lazy(() => import("./pages/PoliticaPrivacidade"));
const ResetApp = lazy(() => import("./pages/ResetApp"));
const PartnerRedirectPage = lazy(() => import("./pages/PartnerRedirectPage"));
const Tutorial = lazy(() => import("./pages/Tutorial"));
import { CookieBanner } from "@/components/CookieBanner";
import ProtectedRoute from "@/components/auth/ProtectedRoute";
import { RechargeRequiredDialog } from "@/components/wallet/RechargeRequiredDialog";
import { RemoteSupportProvider } from "@/features/remote-support/RemoteSupportProvider";
import { UpdateAvailableToast } from "@/components/UpdateAvailableToast";
import { TourProvider } from "@/features/onboarding/TourProvider";
import { TourStateProvider } from "@/features/onboarding/useTour";
import { SupportChatButton } from "@/components/support/SupportChatButton";

const SuperAdminRemoteSupport = lazy(() => import("./pages/SuperAdminRemoteSupport"));


const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider>
      <TooltipProvider>
        <ConfirmDialogProvider>
        <PromptDialogProvider>
        <Toaster />
        <Sonner />
        <UpdateAvailableToast />
        <BrowserRouter>
          <TourStateProvider>
          <Suspense fallback={
            <div className="flex h-screen items-center justify-center bg-background">
              <div className="flex flex-col items-center gap-4">
                <div className="relative">
                  <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center">
                    <div className="animate-spin h-6 w-6 border-3 border-primary border-t-transparent rounded-full" />
                  </div>
                  <div className="absolute inset-0 rounded-2xl bg-primary/5 animate-ping" />
                </div>
              </div>
            </div>
          }>
            <Routes>
              <Route path="/auth" element={<Auth />} />
              <Route path="/tutorial" element={<Tutorial />} />
              <Route path="/admin" element={<ProtectedRoute><Admin /></ProtectedRoute>} />
              <Route path="/admin/whatsapp-clients" element={<ProtectedRoute><WhatsAppClientsPage /></ProtectedRoute>} />
              <Route path="/admin/clientes-igreen" element={<Navigate to="/admin/whatsapp-clients?tab=igreen" replace />} />
              <Route path="/clientes-igreen" element={<Navigate to="/admin/whatsapp-clients?tab=igreen" replace />} />
              <Route path="/admin/fluxos" element={<ProtectedRoute><FluxoBuilder /></ProtectedRoute>} />
              <Route path="/admin/sofia-audios" element={<ProtectedRoute><AdminSofiaNameAudios /></ProtectedRoute>} />
              <Route path="/admin/fluxo-b" element={<ProtectedRoute><AdminFluxoB /></ProtectedRoute>} />
              <Route path="/admin/saude-bot" element={<ProtectedRoute><SaudeBot /></ProtectedRoute>} />
              <Route path="/admin/saude-producao" element={<ProtectedRoute><SaudeProducao /></ProtectedRoute>} />
              <Route path="/admin/portal-monitor" element={<ProtectedRoute><AdminPortalMonitor /></ProtectedRoute>} />
              <Route path="/admin/conhecimento" element={<ProtectedRoute><AdminKnowledge /></ProtectedRoute>} />
              <Route path="/admin/reaquecimento" element={<ProtectedRoute><AdminReaquecimento /></ProtectedRoute>} />
              <Route path="/admin/voz" element={<ProtectedRoute><AdminVoz /></ProtectedRoute>} />
              <Route path="/admin/recon" element={<ProtectedRoute><AdminReconIgreen /></ProtectedRoute>} />
              <Route path="/admin/conversao" element={<ProtectedRoute><AdminConversao /></ProtectedRoute>} />
              <Route path="/admin/agendamentos" element={<Navigate to="/admin?tab=agendamentos" replace />} />
              <Route path="/admin/meta-ads" element={<ProtectedRoute><AdminMetaAds /></ProtectedRoute>} />
              <Route path="/admin/protocolos" element={<ProtectedRoute><AdminProtocolsPage /></ProtectedRoute>} />
              <Route path="/admin/motor" element={<ProtectedRoute><AdminMotorCadencia /></ProtectedRoute>} />
              <Route path="/admin/agendamentos-central" element={<ProtectedRoute><AdminAgendamentosCentral /></ProtectedRoute>} />
              <Route path="/consultor/mensagens" element={<ProtectedRoute><ConsultantMessages /></ProtectedRoute>} />
              <Route path="/ajuda" element={<ProtectedRoute><AjudaPage /></ProtectedRoute>} />
              <Route path="/admin/ajuda/editor" element={<ProtectedRoute><AdminTourEditor /></ProtectedRoute>} />

              
              <Route path="/admin/solar-design" element={<ProtectedRoute><SolarDesignPage /></ProtectedRoute>} />
              <Route path="/admin/solar-design/:snapshotId" element={<ProtectedRoute><SolarDesignDetailPage /></ProtectedRoute>} />
              <Route path="/experiments/solar-3d" element={<ProtectedRoute><SolarDesignPage /></ProtectedRoute>} />
              
              <Route path="/admin/faq" element={<Navigate to="/admin/conhecimento?tab=ia" replace />} />
              <Route path="/admin/fluxos-legado" element={<Navigate to="/admin/fluxos" replace />} />
              <Route path="/admin/fluxos-antigo" element={<Navigate to="/admin/fluxos" replace />} />
              <Route path="/admin/bot-tools" element={<Navigate to="/admin/whatsapp-clients" replace />} />
              <Route path="/admin/bot-audit" element={<Navigate to="/admin/whatsapp-clients" replace />} />

              <Route path="/super-admin" element={<ProtectedRoute><SuperAdmin /></ProtectedRoute>} />
              <Route path="/super-admin/suporte" element={<ProtectedRoute><SuperAdminRemoteSupport /></ProtectedRoute>} />
              <Route path="/assistente" element={<AssistentePage />} />
              <Route path="/crm" element={<CRMLandingPage />} />
              <Route path="/licenciado/preview" element={<LicenciadaPreview />} />
              <Route path="/licenciado/:licenca" element={<LicenciadaPage />} />
              <Route path="/cadastro/:licenca" element={<CadastroPage />} />
              <Route path="/politica-privacidade" element={<PoliticaPrivacidade />} />
              <Route path="/install" element={<InstallPage />} />
              <Route path="/reset" element={<ResetApp />} />
              {/* Landing pages Conexão (9 produtos) */}
              <Route path="/conexao-telecom/:licenca" element={<ConexaoProductPage />} />
              <Route path="/conexao-seguros/:licenca" element={<ConexaoProductPage />} />
              <Route path="/conexao-solar/:licenca" element={<ConexaoProductPage />} />
              <Route path="/conexao-placas/:licenca" element={<ConexaoProductPage />} />
              <Route path="/conexao-livre/:licenca" element={<ConexaoProductPage />} />
              <Route path="/conexao-club/:licenca" element={<ConexaoProductPage />} />
              <Route path="/conexao-club-pj/:licenca" element={<ConexaoProductPage />} />
              {/* Green/Expansão canônicos no menu: /:licenca e /licenciado/:licenca */}
              <Route path="/conexao-green/:licenca" element={<RedirectConexaoGreen />} />
              <Route path="/conexao-expansao/:licenca" element={<RedirectConexaoExpansao />} />

              {/* Página pública de orçamento/proposta */}
              <Route path="/proposta/:token" element={<ProposalPublicPage />} />

              {/* Link curto de parceiro: /r/{licenca}/{short_code?} → qr-redirect */}
              <Route path="/r/:licenca/:code?" element={<PartnerRedirectPage />} />

              {/* ⚠️ Catch-all de 1º nível: captura o slug público do consultor.
                  Mantenha QUALQUER rota nova ACIMA desta linha, senão ela será
                  interpretada como uma licença e cairá na ConsultantPage. */}
              <Route path="/:licenca" element={<ConsultantPage />} />
              <Route path="/" element={<Navigate to="/auth" replace />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
            <CookieBanner />
            <RechargeRequiredDialog />
            <RemoteSupportProvider />
            <TourProvider />
            <SupportChatButton className="hidden" />
          </Suspense>
          </TourStateProvider>
        </BrowserRouter>
        </PromptDialogProvider>
        </ConfirmDialogProvider>
      </TooltipProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
