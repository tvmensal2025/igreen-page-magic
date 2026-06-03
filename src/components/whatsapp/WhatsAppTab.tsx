import { useState, useEffect, useCallback, useMemo, lazy, Suspense } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { useWhatsApp } from "@/hooks/useWhatsApp";
import { useTemplates } from "@/hooks/useTemplates";
import { useChats } from "@/hooks/useChats";
import { ConnectionPanel } from "./ConnectionPanel";
import { ChatSidebar } from "./ChatSidebar";
import { ChatView } from "./ChatView";
import { DragResizer } from "@/components/layout/DragResizer";

import { BarChart3, MessageSquare, Send, FileText, Clock, Bot, History } from "lucide-react";

// Heavy panels — load only when their sub-tab is opened
const BulkProPanel = lazy(() => import("./bulk-pro/BulkProPanel").then(m => ({ default: m.BulkProPanel })));
const TemplateManager = lazy(() => import("./TemplateManager").then(m => ({ default: m.TemplateManager })));
const SchedulePanel = lazy(() => import("./SchedulePanel").then(m => ({ default: m.SchedulePanel })));
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
}

type SubTab = "dashboard" | "conversas" | "agente" | "envio_massa" | "templates" | "agendamentos" | "historico";

const SUB_TABS: { key: SubTab; label: string; icon: React.ElementType }[] = [
  { key: "dashboard", label: "Dashboard", icon: BarChart3 },
  { key: "conversas", label: "Conversas", icon: MessageSquare },
  { key: "agente", label: "Atendente IA", icon: Bot },
  { key: "envio_massa", label: "Envio em Massa", icon: Send },
  { key: "templates", label: "Templates", icon: FileText },
  { key: "agendamentos", label: "Agendamentos", icon: Clock },
  { key: "historico", label: "Histórico", icon: History },
];

export function WhatsAppTab({ userId, pendingChatPhone, pendingChatMessage, onPendingChatConsumed, customers = [] }: WhatsAppTabProps) {
  const isMobile = useIsMobile();
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

  const [activeSubTab, setActiveSubTab] = useState<SubTab>("dashboard");
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

  return (
    <div className="flex flex-col gap-0 flex-1 min-h-0 min-w-0 overflow-hidden">
      {/* Compact connection status — h-7 */}
      <div className="flex items-center justify-between px-3 py-1 bg-card border border-border rounded-t-lg shrink-0 h-7">
        {isConnected ? (
          <div className="flex items-center gap-2 min-w-0">
            <div className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse shrink-0" />
            <span className="text-[11px] text-foreground font-medium">WhatsApp Conectado</span>
            {instanceName && (
              <span className="text-[10px] text-muted-foreground truncate">({instanceName})</span>
            )}
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 min-w-0">
              <div className="h-1.5 w-1.5 rounded-full bg-destructive shrink-0" />
              <span className="text-[11px] text-foreground font-medium truncate">
                {connectionStatus === "connecting" ? "WhatsApp Conectando..." : "WhatsApp Desconectado"}
              </span>
            </div>
            <button
              onClick={() => {
                setActiveSubTab("conversas");
                if (hasInstance && connectionStatus === "disconnected") createAndConnect();
              }}
              disabled={isLoading}
              className="text-[10px] text-primary hover:underline font-medium shrink-0"
            >
              {isLoading || connectionStatus === "connecting" ? "Conectando..." : "Conectar"}
            </button>
          </>
        )}
      </div>

      {/* Sub-tab navigation — compacta, h-9 */}
      <div className="flex border-x border-border bg-card overflow-x-auto shrink-0 h-9">
        {SUB_TABS.map((tab) => {
          const Icon = tab.icon;
          const showBadge = tab.key === "conversas" && totalUnread > 0;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveSubTab(tab.key)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium whitespace-nowrap transition-colors border-b-2 min-h-[32px] ${
                activeSubTab === tab.key
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="h-3 w-3" />
              <span className="hidden sm:inline">{tab.label}</span>
              {showBadge && (
                <span className="bg-primary text-primary-foreground text-[9px] rounded-full h-4 min-w-[16px] flex items-center justify-center px-1 font-bold">
                  {totalUnread > 99 ? "99+" : totalUnread}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Content area */}
      <div className="flex-1 min-h-0 min-w-0 border border-t-0 border-border rounded-b-lg overflow-hidden bg-background flex flex-col">
        {activeSubTab === "dashboard" && (
          <Suspense fallback={<LazyFallback />}>
            <WhatsAppDashboard consultantId={userId} />
          </Suspense>
        )}

        {activeSubTab === "conversas" && (
          // 🟢 Sempre exibir o histórico quando há `instanceName`, mesmo se
          // o `connectionStatus` ainda estiver `"connecting"` ou `"disconnected"`
          // (Evolution API lenta / instabilidade). O painel de QR Code só aparece
          // quando NÃO existe instância configurada (consultor novo).
          (isWhapi || (hasInstance && isConnected)) ? (
            <div className="flex flex-col h-full min-h-0">
              {!isConnected && (
                <div className="px-3 py-1 bg-amber-500/10 border-b border-amber-500/20 text-[11px] text-amber-200 flex items-center gap-2 shrink-0">
                  <div className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse shrink-0" />
                  <span className="truncate">
                    {connectionStatus === "connecting"
                      ? "Reconectando — você ainda pode ver o histórico"
                      : "Desconectado — histórico disponível, envios podem falhar"}
                  </span>
                  <button
                    onClick={() => createAndConnect()}
                    disabled={isLoading}
                    className="ml-auto text-amber-100 hover:underline font-medium shrink-0"
                  >
                    {isLoading ? "..." : "Reconectar"}
                  </button>
                </div>
              )}
              <div data-resize-scope className="flex flex-1 min-h-0 min-w-0" style={{ "--wa-side-w": "280px" } as React.CSSProperties}>
              {/* Mobile: show sidebar OR chat, not both */}
              {isMobile ? (
                selectedChatJid ? (
                  <div className="flex flex-col h-full w-full">
                    <button
                      onClick={() => setSelectedChatJid(null)}
                      className="flex items-center gap-2 px-3 py-2 text-xs font-medium text-primary bg-card border-b border-border shrink-0"
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
                  <DragResizer storageKey="whatsapp-side" cssVar="wa-side-w" defaultPx={280} minPx={240} maxPx={420} />
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
                onCreateTemplate={(name, content, mediaType, mediaUrl, imageUrl) => createTemplate(name, content, mediaType, mediaUrl, imageUrl)}
                onUpdateTemplate={updateTemplate}
                onDeleteTemplate={deleteTemplate}
                onRefetch={refetchTemplates}
              />
            </Suspense>
          </div>
        )}

        {activeSubTab === "agendamentos" && (
          <div className="p-3 overflow-auto h-full min-w-0">
            {isConnected && instanceName ? (
              <Suspense fallback={<LazyFallback />}>
                <SchedulePanel
                  consultantId={userId}
                  instanceName={instanceName}
                />
              </Suspense>
            ) : (
              <div className="flex items-center justify-center h-40 text-sm text-muted-foreground">
                Conecte o WhatsApp para gerenciar agendamentos.
              </div>
            )}
          </div>
        )}

        {activeSubTab === "agente" && (
          <div className="p-3 overflow-auto h-full min-w-0">
            <Suspense fallback={<LazyFallback />}>
              <AIAgentTab userId={userId} />
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
