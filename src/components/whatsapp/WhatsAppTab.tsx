import { useState, useEffect, useCallback, useMemo, lazy, Suspense } from "react";
import { useIsLgDown } from "@/hooks/use-mobile";
import { useWhatsApp } from "@/hooks/useWhatsApp";
import { useTemplates } from "@/hooks/useTemplates";
import { useChats } from "@/hooks/useChats";
import { ConnectionPanel } from "./ConnectionPanel";
import { ChatSidebar } from "./ChatSidebar";
import { ChatView } from "./ChatView";
import { DragResizer } from "@/components/layout/DragResizer";
import { WhapiConnectionPanel } from "./WhapiConnectionPanel";
import { WhapiBillingBanner } from "./WhapiBillingBanner";
import { useWhapiHealth } from "@/hooks/useWhapiHealth";

import { BarChart3, MessageSquare, Send, FileText, Clock, Bot, History, Workflow, MoreHorizontal } from "lucide-react";
import { Link } from "react-router-dom";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// Heavy panels — load only when their sub-tab is opened
const BulkProPanel = lazy(() => import("./bulk-pro/BulkProPanel").then(m => ({ default: m.BulkProPanel })));
const TemplateManager = lazy(() => import("./TemplateManager").then(m => ({ default: m.TemplateManager })));
const SchedulePanel = lazy(() => import("./AgendamentosHub").then(m => ({
  default: (props: { consultantId: string; instanceName: string }) => (
    <m.AgendamentosHub {...props} showAdminShortcut />
  ),
})));
const WhatsAppDashboard = lazy(() => import("./WhatsAppDashboard").then(m => ({ default: m.WhatsAppDashboard })));
const AIAgentTab = lazy(() => import("@/components/admin/AIAgentTab").then(m => ({ default: m.AIAgentTab })));
const AutoMessageLog = lazy(() => import("./AutoMessageLog").then(m => ({ default: m.AutoMessageLog })));

const LazyFallback = () => (
  <div className="flex items-center justify-center py-12">
    <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
  </div>
);

interface WhatsAppTabProps {
  userId: string;
  pendingChatPhone?: string | null;
  pendingChatMessage?: string;
  onPendingChatConsumed?: () => void;
  customers?: any[];
  initialSubTab?: SubTab;
  initialAgentSubTab?: string | null;
  onSubTabConsumed?: () => void;
}

type SubTab = "dashboard" | "conversas" | "agente" | "envio_massa" | "templates" | "agendamentos" | "historico";

const SUB_TABS: { key: SubTab; label: string; shortLabel: string; icon: React.ElementType }[] = [
  { key: "dashboard", label: "Dashboard", shortLabel: "Início", icon: BarChart3 },
  { key: "conversas", label: "Conversas", shortLabel: "Chats", icon: MessageSquare },
  { key: "agente", label: "Atendente IA", shortLabel: "IA", icon: Bot },
  { key: "envio_massa", label: "Envio em Massa", shortLabel: "Massa", icon: Send },
  { key: "templates", label: "Templates", shortLabel: "Modelos", icon: FileText },
  { key: "agendamentos", label: "Agendamentos", shortLabel: "Agenda", icon: Clock },
  { key: "historico", label: "Histórico", shortLabel: "Hist.", icon: History },
];

const MOBILE_PRIMARY_TABS: SubTab[] = ["dashboard", "conversas", "agente", "envio_massa"];
const MOBILE_MORE_TABS: SubTab[] = ["templates", "agendamentos", "historico"];

export function WhatsAppTab({ userId, pendingChatPhone, pendingChatMessage, onPendingChatConsumed, customers = [], initialSubTab, initialAgentSubTab, onSubTabConsumed }: WhatsAppTabProps) {
  const isCompactLayout = useIsLgDown();
  const {
    connectionStatus,
    instanceName,
    qrCode,
    qrGeneratedAt,
    phoneNumber,
    isLoading,
    error,
    connectionLog,
    operationalHealth,
    consecutiveTimeouts,
    isWhapi,
    hasInstance,
    fatalLocked,
    fatalReason,
    createAndConnect,
    disconnect,
    reconnect,
    refreshQr,
    safeReset,
  } = useWhatsApp(userId);

  const {
    templates,
    isLoading: templatesLoading,
    refetchTemplates,
    createTemplate,
    updateTemplate,
    deleteTemplate,
    applyTemplate,
  } = useTemplates(userId);

  const { chats, isLoading: chatsLoading } = useChats(
    // Mostra o histórico sempre que houver `instanceName` carregado, mesmo
    // durante reconexão. Antes só passávamos quando `connectionStatus === "connected"`,
    // o que fazia a aba "Conversas" abrir o QR Code em vez do histórico
    // sempre que a Evolution API estivesse lenta/intermitente.
    instanceName || null,
    isWhapi,
  );

  const [activeSubTab, setActiveSubTab] = useState<SubTab>(initialSubTab ?? "dashboard");

  useEffect(() => {
    if (!initialSubTab) return;
    setActiveSubTab(initialSubTab);
    onSubTabConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSubTab]);
  const [selectedChatJid, setSelectedChatJid] = useState<string | null>(null);
  const [pendingMessage, setPendingMessage] = useState<string | null>(null);
  const [pendingMessageKey, setPendingMessageKey] = useState(0);

  // Build selectedChat: either from existing chats or a synthetic entry for new conversations
  const selectedChat = (() => {
    const found = chats.find((c) => c.remoteJid === selectedChatJid);
    if (found) return found;
    // If we have a JID but no chat (new conversation from customer list), create synthetic entry
    if (selectedChatJid) {
      const phone = selectedChatJid.split("@")[0];
      return {
        remoteJid: selectedChatJid,
        sendTargetJid: selectedChatJid,
        name: phone,
        lastMessage: "",
        lastMessageTimestamp: 0,
        unreadCount: 0,
        isGroup: false,
      } as import("@/hooks/useChats").ChatItem;
    }
    return null;
  })();

  const handleSelectChat = useCallback((jid: string | null) => {
    setSelectedChatJid(jid);
    setPendingMessage(null); // Clear pending message when manually selecting a chat
  }, []);

  const handleOpenChatFromCustomer = useCallback((phone: string, suggestedMessage?: string) => {
    setActiveSubTab("conversas");
    const cleanPhone = phone.replace(/\D/g, "");

    // Try exact match first
    let match = chats.find((c) => c.remoteJid.includes(cleanPhone));

    // Try Brazilian 9th digit variations (add or remove the 9 after area code)
    if (!match && cleanPhone.startsWith("55") && cleanPhone.length >= 12) {
      const ddd = cleanPhone.substring(2, 4);
      const rest = cleanPhone.substring(4);
      // If has 9 digits after DDD (with 9th digit), try without
      if (rest.length === 9 && rest.startsWith("9")) {
        const without9 = `55${ddd}${rest.substring(1)}`;
        match = chats.find((c) => c.remoteJid.includes(without9));
      }
      // If has 8 digits after DDD (without 9th digit), try with
      if (!match && rest.length === 8) {
        const with9 = `55${ddd}9${rest}`;
        match = chats.find((c) => c.remoteJid.includes(with9));
      }
    }

    // Also try matching by chat name containing the phone
    if (!match) {
      match = chats.find((c) => c.name?.includes(cleanPhone.slice(-8)));
    }

    if (match) {
      setSelectedChatJid(match.remoteJid);
    } else {
      // No existing chat — create a synthetic JID so user can start a new conversation
      const syntheticJid = `${cleanPhone}@s.whatsapp.net`;
      setSelectedChatJid(syntheticJid);
    }
    setPendingMessage(suggestedMessage || null);
    setPendingMessageKey((k) => k + 1);
  }, [chats]);

  // Handle incoming pending chat from Admin (Clientes tab)
  useEffect(() => {
    if (pendingChatPhone) {
      handleOpenChatFromCustomer(pendingChatPhone, pendingChatMessage);
      onPendingChatConsumed?.();
    }
  }, [pendingChatPhone, pendingChatMessage]);

  const totalUnread = useMemo(() => chats.reduce((sum, c) => sum + c.unreadCount, 0), [chats]);
  const isConnected = connectionStatus === "connected";
  /** Mobile com chat aberto: esconde chrome do módulo para dar espaço ao composer. */
  const immersiveChat = isCompactLayout && activeSubTab === "conversas" && !!selectedChatJid;

  // Whapi: só exibir painel de reconexão no Dashboard quando o canal cair (não está AUTH).
  const whapiHealth = useWhapiHealth(!!isWhapi);
  const whapiDown = !!isWhapi && whapiHealth.lastCheckedAt !== null && whapiHealth.status !== "AUTH";

  return (
    <div className="flex flex-col gap-0 flex-1 min-h-0 min-w-0 overflow-hidden">
      {/* Status + sub-abas — ocultos no mobile enquanto uma conversa está aberta */}
      {!immersiveChat && (
      <>
      <div className="flex items-center justify-between px-3 py-1.5 bg-gradient-to-r from-primary/5 via-card to-card border border-border/60 rounded-t-xl shrink-0 h-8">
        {isConnected ? (
          <div className="flex items-center gap-2 min-w-0">
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-primary/10 border border-primary/20">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inset-0 rounded-full bg-primary animate-ping opacity-60" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
              </span>
              <span className="text-[10px] font-semibold text-primary tracking-wide uppercase">Conectado</span>
            </span>
            {instanceName && (
              <span className="text-[10px] text-muted-foreground truncate font-mono">{instanceName}</span>
            )}
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 min-w-0">
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-destructive/10 border border-destructive/25">
                <span className="h-1.5 w-1.5 rounded-full bg-destructive animate-pulse" />
                <span className="text-[10px] font-semibold text-destructive tracking-wide uppercase truncate">
                  {connectionStatus === "connecting" ? "Conectando" : "Desconectado"}
                </span>
              </span>
            </div>
            <button
              onClick={() => {
                setActiveSubTab("conversas");
                if (!fatalLocked && hasInstance && connectionStatus === "disconnected") createAndConnect();
              }}
              disabled={isLoading || fatalLocked}
              title={fatalLocked ? "Número em revisão manual — não reconecte aqui" : undefined}
              className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold text-primary bg-primary/10 hover:bg-primary/20 border border-primary/20 transition-colors shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {fatalLocked
                ? "Em revisão"
                : isLoading || connectionStatus === "connecting" ? "Conectando…" : "Conectar →"}
            </button>
          </>
        )}
      </div>

      {/* Sub-abas: mobile (<lg) condensadas + "Mais"; desktop todas visíveis */}
      {(() => {
        const tabBtnClass = (isActive: boolean) =>
          `relative flex items-center gap-1 px-2 lg:px-3 py-1.5 text-[10px] lg:text-[11px] font-medium whitespace-nowrap transition-all duration-200 rounded-lg my-1 min-h-[44px] lg:min-h-0 ${
            isActive
              ? "text-primary bg-primary/8"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
          }`;

        const renderTabBtn = (tab: (typeof SUB_TABS)[number], displayLabel: string) => {
          const Icon = tab.icon;
          const isActive = activeSubTab === tab.key;
          const showBadge = tab.key === "conversas" && totalUnread > 0;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveSubTab(tab.key)}
              aria-label={tab.label}
              aria-current={isActive ? "page" : undefined}
              className={tabBtnClass(isActive)}
            >
              <Icon className={`h-3.5 w-3.5 shrink-0 transition-transform ${isActive ? "scale-110" : ""}`} />
              <span>{displayLabel}</span>
              {showBadge && (
                <span className="bg-primary text-primary-foreground text-[9px] rounded-full h-4 min-w-[16px] flex items-center justify-center px-1 font-bold shadow-sm shadow-primary/30">
                  {totalUnread > 99 ? "99+" : totalUnread}
                </span>
              )}
              {isActive && (
                <span className="absolute -bottom-1 left-2 right-2 h-0.5 bg-primary rounded-full" />
              )}
            </button>
          );
        };

        const navShell = "flex border-x border-border/60 bg-card/80 backdrop-blur-sm overflow-x-auto shrink-0 min-h-10 px-1 pr-3 gap-0.5 scrollbar-thin items-center snap-x snap-mandatory";

        return (
          <>
            <div className={`${navShell} lg:hidden`}>
              {SUB_TABS.filter((t) => MOBILE_PRIMARY_TABS.includes(t.key)).map((tab) =>
                renderTabBtn(tab, tab.shortLabel),
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label="Mais opções do WhatsApp"
                    className={tabBtnClass(MOBILE_MORE_TABS.includes(activeSubTab))}
                  >
                    <MoreHorizontal className="h-3.5 w-3.5 shrink-0" />
                    <span>Mais</span>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-48">
                  {SUB_TABS.filter((t) => MOBILE_MORE_TABS.includes(t.key)).map((tab) => {
                    const Icon = tab.icon;
                    return (
                      <DropdownMenuItem
                        key={tab.key}
                        onClick={() => setActiveSubTab(tab.key)}
                        className={activeSubTab === tab.key ? "bg-primary/10 text-primary" : ""}
                      >
                        <Icon className="h-4 w-4 mr-2" />
                        {tab.label}
                      </DropdownMenuItem>
                    );
                  })}
                  <DropdownMenuItem asChild>
                    <Link to="/admin/fluxos" className="flex items-center cursor-pointer">
                      <Workflow className="h-4 w-4 mr-2" />
                      Construtor de Fluxos
                    </Link>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <div className={`${navShell} hidden lg:flex`}>
              {SUB_TABS.map((tab) => renderTabBtn(tab, tab.label))}
              <Link
                to="/admin/fluxos"
                aria-label="Construtor de Fluxos"
                className={`${tabBtnClass(false)} text-muted-foreground hover:text-foreground hover:bg-muted/40`}
              >
                <Workflow className="h-3.5 w-3.5 shrink-0" />
                <span>Construtor de Fluxos</span>
              </Link>
            </div>
          </>
        );
      })()}
      </>
      )}

      {/* Content area */}
      <div className="flex-1 min-h-0 min-w-0 border border-t-0 border-border rounded-b-lg overflow-hidden bg-background flex flex-col">
        {/* Banner global de billing Whapi — aparece em qualquer sub-aba quando o canal está bloqueado por pagamento */}
        <WhapiBillingBanner enabled={!!isWhapi} />
        {activeSubTab === "dashboard" && (
          <div className="p-3 space-y-3 overflow-y-auto h-full min-h-0 min-w-0">
            {isWhapi && whapiDown && <WhapiConnectionPanel visible={true} />}
            <Suspense fallback={<LazyFallback />}>
              <WhatsAppDashboard consultantId={userId} />
            </Suspense>
          </div>
        )}

        {activeSubTab === "conversas" && (
          // 🟢 Sempre exibir o histórico quando há `instanceName`, mesmo se
          // o `connectionStatus` ainda estiver `"connecting"` ou `"disconnected"`
          // (Evolution API lenta / instabilidade). O painel de QR Code só aparece
          // quando NÃO existe instância configurada (consultor novo).
          (isWhapi || (hasInstance && isConnected)) ? (
            <div className="flex flex-col h-full min-h-0">
              {!isConnected && (
                <div className={`px-3 py-1 border-b text-[11px] flex items-center gap-2 shrink-0 ${fatalLocked ? "bg-destructive/10 border-destructive/20 text-destructive" : "bg-warning/10 border-warning/20 text-warning"}`}>
                  <div className={`h-1.5 w-1.5 rounded-full animate-pulse shrink-0 ${fatalLocked ? "bg-destructive" : "bg-warning"}`} />
                  <span className="truncate">
                    {fatalLocked
                      ? "Número em revisão manual — não reconecte aqui. Use 'Desconectar / trocar chip'."
                      : connectionStatus === "connecting"
                        ? "Reconectando — você ainda pode ver o histórico"
                        : "Desconectado — histórico disponível, envios podem falhar"}
                  </span>
                  {!fatalLocked && (
                    <button
                      onClick={() => createAndConnect()}
                      disabled={isLoading}
                      className="ml-auto text-warning hover:underline font-medium shrink-0"
                    >
                      {isLoading ? "..." : "Reconectar"}
                    </button>
                  )}
                </div>
              )}
              <div data-resize-scope className="flex flex-1 min-h-0 min-w-0" style={{ "--wa-side-w": "240px" } as React.CSSProperties}>
              {/* Layout compacto (<lg): lista OU chat; desktop: lado a lado */}
              {isCompactLayout ? (
                selectedChatJid ? (
                  <div className="flex flex-col h-full w-full">
                    <button
                      onClick={() => setSelectedChatJid(null)}
                      className="flex items-center gap-2 px-3 py-2.5 min-h-[44px] text-xs font-medium text-primary bg-card border-b border-border shrink-0"
                    >
                      ← Voltar às conversas
                    </button>
                    <div className="flex-1 min-h-0 flex flex-col">
                      <ChatView
                        instanceName={instanceName}
                        chat={selectedChat}
                        templates={templates}
                        consultantId={userId}
                        initialMessage={pendingMessage}
                        isWhapi={isWhapi}
                        key={`chat-${selectedChatJid}-${pendingMessageKey}`}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="w-full h-full">
                    <ChatSidebar
                      chats={chats}
                      isLoading={chatsLoading}
                      selectedJid={selectedChatJid}
                      onSelectChat={handleSelectChat}
                      consultantId={userId}
                    />
                  </div>
                )
              ) : (
                <>
                  <div className="w-[var(--wa-side-w)] shrink-0">
                    <ChatSidebar
                      chats={chats}
                      isLoading={chatsLoading}
                      selectedJid={selectedChatJid}
                      onSelectChat={handleSelectChat}
                      consultantId={userId}
                    />
                  </div>
                  <DragResizer storageKey="whatsapp-side" cssVar="wa-side-w" defaultPx={240} minPx={200} maxPx={360} />
                  <div className="flex-1 min-w-0 min-h-0 flex flex-col">
                    <ChatView
                      instanceName={instanceName}
                      chat={selectedChat}
                      templates={templates}
                      consultantId={userId}
                      initialMessage={pendingMessage}
                      isWhapi={isWhapi}
                      key={`chat-${selectedChatJid}-${pendingMessageKey}`}
                    />
                  </div>
                </>

              )}
              </div>
            </div>
          ) : (
            <div className="p-4 overflow-auto h-full">
              <ConnectionPanel
                connectionStatus={connectionStatus}
                qrCode={qrCode}
                qrGeneratedAt={qrGeneratedAt}
                instanceName={instanceName}
                phoneNumber={phoneNumber}
                isLoading={isLoading}
                error={error}
                connectionLog={connectionLog}
                operationalHealth={operationalHealth}
                consecutiveTimeouts={consecutiveTimeouts}
                isWhapi={isWhapi}
                fatalLocked={fatalLocked}
                fatalReason={fatalReason}
                onConnect={createAndConnect}
                onDisconnect={disconnect}
                onReconnect={reconnect}
                onRefreshQr={refreshQr}
                onSafeReset={safeReset}
              />
            </div>
          )
        )}


        {activeSubTab === "envio_massa" && (
          <div className="p-3 overflow-auto h-full min-w-0">
            {isConnected && instanceName ? (
              <Suspense fallback={<LazyFallback />}>
                <BulkProPanel
                  instanceName={instanceName}
                  customers={customers}
                  templates={templates}
                  consultantId={userId}
                />
              </Suspense>
            ) : (
              <div className="flex items-center justify-center h-40 text-sm text-muted-foreground">
                Conecte o WhatsApp para enviar mensagens em massa.
              </div>
            )}
          </div>
        )}

        {activeSubTab === "templates" && (
          <div className="p-3 overflow-auto h-full min-w-0">
            <Suspense fallback={<LazyFallback />}>
              <TemplateManager
                templates={templates}
                isLoading={templatesLoading}
                consultantId={userId}
                onCreateTemplate={createTemplate}
                onUpdateTemplate={updateTemplate}
                onDeleteTemplate={deleteTemplate}
                onRefetch={refetchTemplates}
              />
            </Suspense>
          </div>
        )}

        {activeSubTab === "agendamentos" && (
          <div className="p-3 overflow-auto h-full min-w-0">
            <Suspense fallback={<LazyFallback />}>
              <SchedulePanel
                consultantId={userId}
                instanceName={instanceName || ""}
              />
            </Suspense>
          </div>
        )}

        {activeSubTab === "agente" && (
          <div className="p-3 overflow-auto h-full min-w-0">
            <Suspense fallback={<LazyFallback />}>
              <AIAgentTab userId={userId} initialSubTab={initialAgentSubTab as any} />
            </Suspense>
          </div>
        )}

        {activeSubTab === "historico" && (
          <div className="p-3 overflow-auto h-full min-w-0">
            <Suspense fallback={<LazyFallback />}>
              <AutoMessageLog consultantId={userId} />
            </Suspense>
          </div>
        )}

      </div>
    </div>
  );
}
