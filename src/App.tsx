import { lazy, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ConfirmDialogProvider } from "@/components/ui/confirm-dialog";
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
const AdminConversao = lazy(() => import("./pages/AdminConversao"));
const AdminMetaAds = lazy(() => import("./pages/AdminMetaAds"));
const SuperAdmin = lazy(() => import("./pages/SuperAdmin"));
const SaudeProducao = lazy(() => import("./pages/SaudeProducao"));
const NotFound = lazy(() => import("./pages/NotFound"));
const InstallPage = lazy(() => import("./pages/InstallPage"));
const PoliticaPrivacidade = lazy(() => import("./pages/PoliticaPrivacidade"));
const ResetApp = lazy(() => import("./pages/ResetApp"));
import { CookieBanner } from "@/components/CookieBanner";


const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider>
      <TooltipProvider>
        <ConfirmDialogProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
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
              <Route path="/admin" element={<Admin />} />
              <Route path="/admin/whatsapp-clients" element={<WhatsAppClientsPage />} />
              <Route path="/admin/fluxos" element={<FluxoBuilder />} />
              <Route path="/admin/fluxo-b" element={<AdminFluxoB />} />
              <Route path="/admin/saude-bot" element={<SaudeBot />} />
              <Route path="/admin/saude-producao" element={<SaudeProducao />} />
              <Route path="/admin/conhecimento" element={<AdminKnowledge />} />
              <Route path="/admin/reaquecimento" element={<AdminReaquecimento />} />
              <Route path="/admin/conversao" element={<AdminConversao />} />
              <Route path="/admin/meta-ads" element={<AdminMetaAds />} />
              <Route path="/admin/faq" element={<Navigate to="/admin/conhecimento?tab=ia" replace />} />
              <Route path="/admin/fluxos-legado" element={<Navigate to="/admin/fluxos" replace />} />
              <Route path="/admin/fluxos-antigo" element={<Navigate to="/admin/fluxos" replace />} />
              <Route path="/admin/bot-tools" element={<Navigate to="/admin/whatsapp-clients" replace />} />
              <Route path="/admin/bot-audit" element={<Navigate to="/admin/whatsapp-clients" replace />} />

              <Route path="/super-admin" element={<SuperAdmin />} />
              <Route path="/assistente" element={<AssistentePage />} />
              <Route path="/crm" element={<CRMLandingPage />} />
              <Route path="/licenciado/preview" element={<LicenciadaPreview />} />
              <Route path="/licenciado/:licenca" element={<LicenciadaPage />} />
              <Route path="/cadastro/:licenca" element={<CadastroPage />} />
              <Route path="/politica-privacidade" element={<PoliticaPrivacidade />} />
              <Route path="/install" element={<InstallPage />} />
              {/* ⚠️ Catch-all de 1º nível: captura o slug público do consultor.
                  Mantenha QUALQUER rota nova ACIMA desta linha, senão ela será
                  interpretada como uma licença e cairá na ConsultantPage. */}
              <Route path="/:licenca" element={<ConsultantPage />} />
              <Route path="/" element={<Navigate to="/auth" replace />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
            <CookieBanner />
          </Suspense>
        </BrowserRouter>
        </ConfirmDialogProvider>
      </TooltipProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
