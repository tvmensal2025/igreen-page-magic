import { useEffect, useRef, useState, useCallback } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { MessageBubble } from "./MessageBubble";
import { MessageComposer } from "./MessageComposer";
import { AddCustomerDialog } from "./AddCustomerDialog";
import { useMessages } from "@/hooks/useMessages";
import { sendWhatsAppMessage, resolveRecipient, normalizeBrazilPhone } from "@/services/messageSender";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import type { MessageTemplate } from "@/types/whatsapp";
import type { ChatItem } from "@/hooks/useChats";
import { Loader2, MessageSquareText, UserPlus, UserCheck, KanbanSquare, RotateCcw, ClipboardList, Bot, BotOff, MoreVertical, Handshake, ClipboardCheck } from "lucide-react";
import { resetLeadConversation } from "@/services/resetConversation";
import { CaptureSheet } from "@/components/captacao/CaptureSheet";
import { PortalStatusTracker } from "@/components/captacao/PortalStatusTracker";
import { useCaptureSession } from "@/hooks/useCaptureSession";
import { useIsLgDown } from "@/hooks/use-mobile";
import { useViewportWidth } from "@/hooks/useViewportWidth";
import { AttendanceStatusBar } from "./AttendanceStatusBar";

import { useCaptureAttach, type CaptureDocKey } from "@/hooks/useCaptureAttach";
import { CloseCaptureDialog } from "@/components/captacao/CloseCaptureDialog";
import { useCustomerAttendance } from "@/hooks/useCustomerAttendance";

import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { createLogger } from "@/lib/logger";
import { autoTakeoverByPhone, takeoverByPhoneDetailed, undoTakeoverByPhone } from "@/lib/whatsapp/auto-takeover";
import { ToastAction } from "@/components/ui/toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Tables } from "@/integrations/supabase/types";

const logger = createLogger("ChatView");

type PartnerJoin = { nome?: string | null } | { nome?: string | null }[] | null;

function readPartnerName(row: {
  referral_partner_id?: string | null;
  referral_partners?: PartnerJoin;
} | null | undefined): string | null {
  if (!row?.referral_partner_id) return null;
  const rel = row.referral_partners;
  const nome = Array.isArray(rel) ? rel[0]?.nome : rel?.nome;
  return (nome && String(nome).trim()) || "Parceiro";
}

interface ChatViewProps {
  instanceName: string;
  chat: ChatItem | null;
  templates: MessageTemplate[];
  consultantId: string;
  initialMessage?: string | null;
  isWhapi?: boolean;
}

export function ChatView({ instanceName, chat, templates, consultantId, initialMessage, isWhapi = false }: ChatViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();
  const [isCustomer, setIsCustomer] = useState(false);
  const [customerId, setCustomerId] = useState<string | null>(null);
  /** Nome do parceiro indicador (referral) — null = lead próprio / sem parceiro. */
  const [partnerName, setPartnerName] = useState<string | null>(null);
  const {
    messages,
    isLoading,
    isLoadingOlder,
    hasMoreOlder,
    loadOlderMessages,
    sendMessage,
    loadMedia,
    resolveSendTargetJid,
    refetch,
  } = useMessages(
    instanceName,
    chat?.remoteJid || null,
    chat?.sendTargetJid || null,
    isWhapi,
    customerId,
    consultantId,
  );
  // Telefone real do cliente (customers.phone_whatsapp), MESMA fonte de verdade
  // que o bot (manual-step-send) usa para enviar. Quando o `remoteJid` da
  // conversa é `@lid` (ID criptografado, não telefone), enviar o JID cru falha
  // na Evolution — por isso priorizamos este número real no envio do painel.
  const [customerPhone, setCustomerPhone] = useState<string | null>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [kanbanStages, setKanbanStages] = useState<Tables<"kanban_stages">[]>([]);
  const [sendingToCrm, setSendingToCrm] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [botPaused, setBotPaused] = useState<boolean>(false);
  const [botForceEnabled, setBotForceEnabled] = useState<boolean>(false);
  const [globalAiEnabled, setGlobalAiEnabled] = useState<boolean>(true);
  const [togglingBot, setTogglingBot] = useState(false);
  const [endAttendanceDialogOpen, setEndAttendanceDialogOpen] = useState(false);
  const [closeCaptureOpen, setCloseCaptureOpen] = useState(false);
  const [closingCapture, setClosingCapture] = useState(false);
  const [captureClosedAt, setCaptureClosedAt] = useState<string | null>(null);
  const isCompactLayout = useIsLgDown();
  const { width: vw } = useViewportWidth();
  const isXl = vw >= 1280;

  // Restaura largura do painel lateral de Captação salva pelo consultor.
  useEffect(() => {
    try {
      const saved = localStorage.getItem("whatsapp_capture_side_w");
      if (saved) document.documentElement.style.setProperty("--cap-side-w", saved);
    } catch {}
  }, []);
  const { customer: captureCustomer, filledCount, totalFields } = useCaptureSession(customerId);

  const attendance = useCustomerAttendance(customerId, consultantId);
  const { attachMediaToCapture } = useCaptureAttach();
  // Captação é SEMPRE manual (default global) — incompleto = pendente.
  const captureIncomplete = !!captureCustomer && !(captureCustomer.name && captureCustomer.cpf && captureCustomer.email && Number(captureCustomer.electricity_bill_value || 0) > 0);
  const captureActive = captureOpen || captureIncomplete;

  // Sync capture_closed_at do cliente atual pra esconder o botão quando já encerrado.
  useEffect(() => {
    const closed = (captureCustomer as any)?.capture_closed_at ?? null;
    setCaptureClosedAt(closed);
  }, [captureCustomer]);

  const handleCaptureClosed = useCallback(() => {
    setCaptureClosedAt(new Date().toISOString());
    setCloseCaptureOpen(false);
  }, []);

  // Ao trocar de conversa, fecha a ficha para não bloquear o composer do novo chat.
  useEffect(() => {
    setCaptureOpen(false);
  }, [chat?.remoteJid]);

  // Auto-abre captação só no desktop (painel lateral). No mobile/tablet o consultor
  // precisa escrever a mensagem primeiro — abre manualmente pelo botão Captação.
  useEffect(() => {
    if (!customerId || !captureCustomer) return;
    if (isCompactLayout) return;
    if (captureCustomer.name && captureCustomer.cpf) return;
    const key = `cap-auto-open-${customerId}`;
    if (typeof window !== "undefined" && window.sessionStorage.getItem(key)) return;
    window.sessionStorage.setItem(key, "1");
    setCaptureOpen(true);
  }, [customerId, captureCustomer, isCompactLayout]);

  const toggleCapture = useCallback(() => {
    if (!customerId) {
      toast({ title: "Aguarde", description: "Estamos preparando o cliente interessado...", variant: "destructive" });
      return;
    }
    setCaptureOpen(true);
    void supabase.from("customers")
      .update({ capture_mode: "manual", capture_started_at: new Date().toISOString() })
      .eq("id", customerId);
  }, [customerId, toast]);


  const handleReset = useCallback(async () => {
    if (!chat) return;
    setResetting(true);
    // IMPORTANTE: Evolution usa remoteJid no formato `<lid>@lid` (ID criptografado,
    // não telefone). Se passarmos só remoteJid, a RPC não encontra o customer e
    // o reset não limpa handoff/pause/step. Quando temos customerId em estado,
    // passamos ele direto — a RPC deriva o telefone real da tabela customers.
    const r = await resetLeadConversation({
      consultantId,
      customerId: customerId ?? null,
      remoteJid: customerId ? null : chat.remoteJid,
    });
    setResetting(false);
    if (r.ok) {
      setResetDialogOpen(false);
      await refetch();
      toast({
        title: "Conversa zerada",
        description: globalAiEnabled
          ? "Histórico oculto no painel e dados do lead resetados. O bot vai começar do zero."
          : "Cliente interessado zerado. O bot vai responder só para este número (IA global continua desligada).",
      });
    } else {
      toast({ title: "Erro ao zerar", description: (r as { error: string }).error, variant: "destructive" });
    }
  }, [chat, consultantId, customerId, refetch, toast, globalAiEnabled]);

  // Carrega estado do bot (paused, force_enabled) + flag global do consultor.
  useEffect(() => {
    if (!customerId) return;
    let cancelled = false;
    (async () => {
      const [{ data: cust }, { data: cfg }] = await Promise.all([
        supabase.from("customers")
          .select("bot_paused, bot_force_enabled")
          .eq("id", customerId).maybeSingle(),
        supabase.from("ai_agent_config")
          .select("enabled")
          .eq("consultant_id", consultantId).maybeSingle(),
      ]);
      if (cancelled) return;
      setBotPaused(!!(cust as any)?.bot_paused);
      setBotForceEnabled(!!(cust as any)?.bot_force_enabled);
      setGlobalAiEnabled((cfg as any)?.enabled !== false);
    })();
    return () => { cancelled = true; };
  }, [customerId, consultantId]);

  // Resultado efetivo: bot responde quando NÃO está pausado E (global ligado OU force ligado).
  const botActive = !botPaused && (globalAiEnabled || botForceEnabled);

  const toggleBot = useCallback(async () => {
    if (!customerId || togglingBot) return;
    setTogglingBot(true);
    try {
      if (botActive) {
        // Desligar: pausa esse lead. Não toca no force.
        const { error } = await supabase.from("customers")
          .update({ bot_paused: true })
          .eq("id", customerId);
        if (error) throw error;
        setBotPaused(true);
        toast({ title: "🤖 Bot desligado neste cliente interessado", description: "A IA não vai responder mais este número." });
      } else {
        // Ligar: tira pause. Se global está off, força para este lead.
        const patch: Record<string, unknown> = { bot_paused: false, assigned_human_id: null };
        if (!globalAiEnabled) patch.bot_force_enabled = true;
        const { error } = await supabase.from("customers")
          .update(patch as never)
          .eq("id", customerId);
        if (error) throw error;
        setBotPaused(false);
        if (!globalAiEnabled) setBotForceEnabled(true);
        toast({
          title: "🤖 Bot ligado neste cliente interessado",
          description: globalAiEnabled
            ? "A IA volta a responder este número."
            : "Bot ativo só para este número (IA global continua desligada).",
        });
      }
    } catch (e) {
      toast({ title: "Erro", description: (e as Error)?.message || "Falha ao alternar bot", variant: "destructive" });
    } finally {
      setTogglingBot(false);
    }
  }, [customerId, togglingBot, botActive, globalAiEnabled, toast]);

  // Fetch kanban stages
  useEffect(() => {
    supabase
      .from("kanban_stages")
      .select("*")
      .eq("consultant_id", consultantId)
      .order("position")
      .then(({ data }) => {
        if (data && data.length > 0) setKanbanStages(data);
      });
  }, [consultantId]);

  // B10 — takeover com Desfazer (10s). Só notifica quando foi NOVO (não em mídias subsequentes).
  const takeoverWithUndo = useCallback(async (phone: string, reason: "humano_assumiu_audio" | "humano_assumiu_midia" | "humano_assumiu") => {
    const r = await takeoverByPhoneDetailed(phone, reason);
    if (r === "new") {
      toast({
        title: "🤖 Bot pausado — você assumiu",
        description: "A IA não vai responder neste cliente interessado enquanto você estiver na conversa.",
        action: (
          <ToastAction altText="Desfazer" onClick={async () => {
            const ok = await undoTakeoverByPhone(phone);
            toast({ title: ok ? "Bot reativado" : "Não consegui reativar", variant: ok ? "default" : "destructive" });
          }}>Desfazer</ToastAction>
        ),
      });
    }
  }, [toast]);



  const handleSendToCrm = useCallback(async (stageKey: string) => {
    if (!chat) return;
    setSendingToCrm(true);
    try {
      const { data: existing } = await supabase
        .from("crm_deals")
        .select("id")
        .eq("consultant_id", consultantId)
        .eq("remote_jid", chat.remoteJid)
        .maybeSingle();

      if (existing) {
        await supabase
          .from("crm_deals")
          .update({ stage: stageKey, updated_at: new Date().toISOString() })
          .eq("id", existing.id);
        toast({ title: "Cliente atualizado", description: `Movido para ${kanbanStages.find(s => s.stage_key === stageKey)?.label || stageKey}` });
      } else {
        await supabase
          .from("crm_deals")
          .insert({ consultant_id: consultantId, remote_jid: chat.remoteJid, stage: stageKey });
        toast({ title: "Adicionado aos clientes", description: `Enviado para ${kanbanStages.find(s => s.stage_key === stageKey)?.label || stageKey}` });
      }
    } catch (err) {
      logger.error("Erro ao enviar ao CRM:", err);
      toast({ title: "Não foi possível adicionar aos clientes", variant: "destructive" });
    } finally {
      setSendingToCrm(false);
    }
  }, [chat, consultantId, kanbanStages, toast]);

  // Check if this contact is already a customer; auto-create a minimal
  // whatsapp_lead row so flow shortcuts (⚡) always have a customerId.
  // IMPORTANTE: conversas com remoteJid `@lid` (ID criptografado do WhatsApp)
  // NÃO carregam telefone real. Extrair "phone" do LID gera lixo tipo
  // "217145610871031", que quebra envio e polui a tabela customers. Só
  // criamos/vinculamos cliente quando temos telefone real — via `sendTargetJid`
  // (@s.whatsapp.net) ou remoteJid já não-lid.
  useEffect(() => {
    if (!chat) {
      setIsCustomer(false);
      setCustomerId(null);
      setCustomerPhone(null);
      setPartnerName(null);
      return;
    }

    const realJid =
      (chat.sendTargetJid && chat.sendTargetJid.endsWith("@s.whatsapp.net"))
        ? chat.sendTargetJid
        : (!chat.remoteJid.endsWith("@lid") ? chat.remoteJid : null);

    if (!realJid) {
      // Sem telefone real (só LID): não cria customer nem tenta vincular.
      // O envio manual ficará bloqueado (getResolvedPhone → null) e o composer
      // avisa. Evita salvar LID como phone_whatsapp e nome "Contato XXXX".
      setIsCustomer(false);
      setCustomerId(null);
      setCustomerPhone(null);
      setPartnerName(null);
      return;
    }

    const rawPhone = realJid.split("@")[0].replace(/\D/g, "");
    if (!rawPhone || rawPhone.length < 10) {
      setIsCustomer(false);
      setCustomerId(null);
      setCustomerPhone(null);
      setPartnerName(null);
      return;
    }
    // BR phone pode estar gravado com ou sem DDI 55 — gera candidatos
    // pra garantir que o lookup ache o cliente existente e o botão ⚡
    // não fique cinza por falta de match.
    const candidates = new Set<string>();
    candidates.add(rawPhone);
    if (rawPhone.startsWith("55") && rawPhone.length >= 12) {
      candidates.add(rawPhone.slice(2));
    } else if (!rawPhone.startsWith("55")) {
      candidates.add(`55${rawPhone}`);
    }
    const candidatesArr = Array.from(candidates);
    const insertPhone = rawPhone.startsWith("55") ? rawPhone : `55${rawPhone}`;
    let cancelled = false;
    (async () => {
      // Sempre pega o registro MAIS RECENTE — havia bug onde, com 2 customers
      // mesmo phone (lead antigo + novo do mesmo consultor por algum motivo),
      // .maybeSingle() falhava ou trazia o shell antigo vazio → ficha 2/18.
      const { data: existingRows } = await supabase
        .from("customers")
        .select("id, phone_whatsapp, created_at, referral_partner_id, referral_partners(nome)")
        .eq("consultant_id", consultantId)
        .in("phone_whatsapp", candidatesArr)
        .order("created_at", { ascending: false })
        .limit(1);
      if (cancelled) return;
      const existing = (existingRows as Array<{
        id: string;
        phone_whatsapp?: string | null;
        referral_partner_id?: string | null;
        referral_partners?: { nome?: string | null } | { nome?: string | null }[] | null;
      }> | null)?.[0];
      if (existing?.id) {
        setIsCustomer(true);
        setCustomerId(existing.id);
        // Telefone real do cliente é a fonte de verdade do destinatário (mesma
        // do bot). Sem isso, conversas com remoteJid `@lid` mandavam o JID cru
        // pra Evolution e o envio manual falhava.
        setCustomerPhone(existing.phone_whatsapp ?? insertPhone);
        setPartnerName(readPartnerName(existing));
        return;
      }
      // Fallback fuzzy: últimos 9 dígitos (DDD + número), evita duplicar
      // quando o phone foi salvo com formatação esquisita.
      const tail = rawPhone.slice(-9);
      if (tail.length === 9) {
        const { data: fuzzy } = await supabase
          .from("customers")
          .select("id, phone_whatsapp, created_at, referral_partner_id, referral_partners(nome)")
          .eq("consultant_id", consultantId)
          .like("phone_whatsapp", `%${tail}`)
          .order("created_at", { ascending: false })
          .limit(1);
        if (cancelled) return;
        const found = (fuzzy as Array<{
          id: string;
          phone_whatsapp?: string | null;
          referral_partner_id?: string | null;
          referral_partners?: { nome?: string | null } | { nome?: string | null }[] | null;
        }> | null)?.[0];
        if (found?.id) {
          setIsCustomer(true);
          setCustomerId(found.id);
          setCustomerPhone(found.phone_whatsapp ?? insertPhone);
          setPartnerName(readPartnerName(found));
          return;
        }
      }

      const pushName = (chat as { pushName?: string | null }).pushName;
      const chatName = (chat as { name?: string | null }).name;
      // Só usa `chat.name` como nome do lead se NÃO for o fallback "Contato XXXX"
      // nem o próprio número — evita salvar "Contato 8950" como nome.
      const isPlaceholderName =
        !chatName ||
        chatName.startsWith("Contato ") ||
        chatName.replace(/\D/g, "") === rawPhone;
      const fallbackName = pushName || (!isPlaceholderName ? chatName! : insertPhone);
      const { data: created, error } = await supabase
        .from("customers")
        .insert({
          consultant_id: consultantId,
          phone_whatsapp: insertPhone,
          name: fallbackName,
          customer_origin: "whatsapp_lead",
          conversation_step: "welcome",
        })
        .select("id")
        .maybeSingle();
      if (cancelled) return;
      if (created?.id) {
        setIsCustomer(true);
        setCustomerId(created.id);
        setCustomerPhone(insertPhone);
        setPartnerName(null);
      } else if (error) {
        logger.error("Falha ao auto-criar cliente para chat:", error);
        setIsCustomer(false);
        setCustomerId(null);
        setPartnerName(null);
      }
    })();
    return () => { cancelled = true; };
  }, [chat, consultantId]);

  const handleCustomerAdded = useCallback((newCustomerId?: string) => {
    setIsCustomer(true);
    if (newCustomerId) setCustomerId(newCustomerId);
  }, []);

  // Auto-scroll robusto: usa sentinel + ResizeObserver pra acompanhar mídias
  // que carregam depois (áudio/imagem/vídeo). Só rola se o usuário já estiver
  // perto do fim — assim quem rolou pra cima lendo histórico não é puxado.
  const bottomRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);

  const forceScrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, []);

  const scheduleScrollToBottom = useCallback((force = false) => {
    if (!force && !stickToBottomRef.current) return;
    const run = () => {
      const el = scrollRef.current;
      if (!el) return;
      el.scrollTop = el.scrollHeight;
    };
    run();
    requestAnimationFrame(() => {
      run();
      requestAnimationFrame(run);
    });
    window.setTimeout(run, 80);
    window.setTimeout(run, 240);
  }, []);

  useEffect(() => {
    stickToBottomRef.current = true;
    forceScrollToBottom();
    scheduleScrollToBottom(true);
  }, [chat?.remoteJid, forceScrollToBottom, scheduleScrollToBottom]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let loadingGate = false;
    const onScroll = async () => {
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      stickToBottomRef.current = distance < 120;

      // Ao chegar perto do topo, carrega histórico antigo (ordem cronológica preservada).
      if (el.scrollTop < 80 && hasMoreOlder && !isLoadingOlder && !loadingGate && isWhapi) {
        loadingGate = true;
        const prevHeight = el.scrollHeight;
        const prevTop = el.scrollTop;
        try {
          const added = await loadOlderMessages();
          if (added > 0) {
            // Mantém o ponto de leitura: não “pula” a tela ao prepend.
            requestAnimationFrame(() => {
              const nextHeight = el.scrollHeight;
              el.scrollTop = prevTop + (nextHeight - prevHeight);
            });
          }
        } finally {
          loadingGate = false;
        }
      }
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [hasMoreOlder, isLoadingOlder, loadOlderMessages, isWhapi]);

  useEffect(() => {
    const scroller = scrollRef.current;
    const sentinel = bottomRef.current;
    if (!scroller || !sentinel) return;

    const scrollToBottom = () => scheduleScrollToBottom();

    scrollToBottom();

    const ro = new ResizeObserver(scrollToBottom);
    ro.observe(scroller);
    // Observa também todas as bolhas (mídia carregando muda altura)
    const children = scroller.querySelectorAll<HTMLElement>("[data-msg-bubble]");
    children.forEach((c) => ro.observe(c));
    return () => ro.disconnect();
  }, [messages, scheduleScrollToBottom]);

  // Unified helper to resolve JID for media/audio/document sends.
  // Prioridade: telefone real do cliente (mesma fonte do bot) → fallback p/ JID
  // resolvido. Conversas com remoteJid `@lid` (ID criptografado) não têm telefone
  // no JID; mandar o `@lid` cru pra Evolution fazia o envio manual falhar enquanto
  // o fluxo (que usa phone_whatsapp) funcionava.
  const getResolvedPhone = useCallback(async (): Promise<string | null> => {
    const realPhone = normalizeBrazilPhone(customerPhone);
    if (realPhone) return realPhone;
    const targetJid = await resolveSendTargetJid();
    if (!targetJid) return null;
    return resolveRecipient(targetJid);
  }, [resolveSendTargetJid, customerPhone]);

  if (!chat) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-background/50 text-muted-foreground">
        <MessageSquareText className="h-16 w-16 mb-4 opacity-30" />
        <p className="text-sm">Selecione uma conversa para começar</p>
        <p className="text-xs mt-1">Use "/" para respostas rápidas no campo de mensagem</p>
      </div>
    );
  }

  const phoneNumber = chat.remoteJid.split("@")[0];

  // Desktop (≥1024px): ficha lateral fixa. Compacto: Sheet sob demanda (nunca inline).
  const showInlineCapture = !isCompactLayout && !!customerId;
  const showSheetCapture = isCompactLayout && !!customerId;


  return (
    <div className="flex-1 flex min-h-0 min-w-0">
      <div className="flex flex-col min-h-0 min-w-0 flex-1">


      {/* Chat header — mobile: nome + captação + menu ⋯; desktop: barra completa */}
      <div className="flex items-center gap-2 px-3 lg:px-3.5 min-h-12 lg:min-h-14 py-1.5 border-b border-border/60 bg-gradient-to-r from-card via-card to-primary/[0.03] shrink-0">
        <Avatar className="h-9 w-9 shrink-0 ring-1 ring-primary/20">
          <AvatarImage
            src={chat.profilePicUrl}
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = "none";
            }}
          />
          <AvatarFallback className="bg-gradient-to-br from-primary/25 to-primary/5 text-primary text-[11px] font-bold">
            {chat.name.slice(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground truncate sensitive-name leading-tight flex items-center gap-1.5">
            <span className="truncate">{chat.name}</span>
            {partnerName && (
              <span
                className="inline-flex items-center gap-0.5 shrink-0 px-1.5 py-0.5 rounded-md bg-amber-100 text-amber-950 border border-amber-600/35"
                title={`Indicação de ${partnerName} — acompanha as etapas do cadastro`}
              >
                <Handshake className="h-3 w-3 text-amber-800" />
                <span className="text-[9px] font-bold uppercase tracking-wide hidden sm:inline">Indicação</span>
              </span>
            )}
          </p>
          <p className="text-[10px] text-muted-foreground sensitive-phone leading-tight flex items-center gap-1 truncate">
            <span className="inline-block h-1 w-1 rounded-full bg-primary/60 shrink-0" />
            {phoneNumber}
            {partnerName && (
              <span className="text-amber-900 font-semibold truncate">· {partnerName}</span>
            )}
          </p>
        </div>

        {isCustomer && customerId && (
          <AttendanceStatusBar
            state={attendance.uiState}
            protocol={attendance.protocol}
            rating={attendance.rating}
            starting={attendance.starting}
            ending={attendance.ending}
            onStart={() => void attendance.startAttendance()}
            onRequestEnd={() => setEndAttendanceDialogOpen(true)}
            compact={isCompactLayout}
          />
        )}

        {isCustomer && customerId && !captureClosedAt && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setCloseCaptureOpen(true)}
            disabled={closingCapture}
            className="h-8 gap-1.5 px-3 rounded-full border-emerald-600/40 text-emerald-700 hover:bg-emerald-600/10 shrink-0"
            title="Remove da lista de Captação e vincula em Vendas/CRM/Comissão (o chat continua ativo)"
          >
            {closingCapture ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ClipboardCheck className="h-3.5 w-3.5" />}
            <span className="text-[11px] font-semibold hidden md:inline">Encerrar captação</span>
            <span className="text-[11px] font-semibold md:hidden">Encerrar</span>
          </Button>
        )}



        {isCompactLayout ? (
          <>
            {isCustomer && customerId && (
              <Button
                size="icon"
                variant={captureActive ? "default" : "outline"}
                className={`h-10 w-10 shrink-0 rounded-full ${
                  captureActive
                    ? "bg-gradient-to-r from-primary to-primary/85 text-primary-foreground shadow-md shadow-primary/30"
                    : "border-primary/30 text-primary"
                }`}
                onClick={toggleCapture}
                title="Captação"
                aria-label="Abrir captação"
              >
                <ClipboardList className="h-4 w-4" />
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon" variant="outline" className="h-10 w-10 shrink-0 rounded-full" aria-label="Mais ações do chat">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                {isCustomer ? (
                  <DropdownMenuItem disabled className="text-xs opacity-100">
                    <UserCheck className="h-4 w-4 mr-2 text-primary" /> Cliente cadastrado
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem onClick={() => setShowAddDialog(true)}>
                    <UserPlus className="h-4 w-4 mr-2" /> Adicionar cliente
                  </DropdownMenuItem>
                )}
                {partnerName && (
                  <DropdownMenuItem disabled className="text-xs opacity-100 text-amber-900">
                    <Handshake className="h-4 w-4 mr-2" /> Indicação: {partnerName}
                  </DropdownMenuItem>
                )}
                {kanbanStages.length > 0 && (
                  <>
                    <DropdownMenuSeparator />
                    {kanbanStages.map((stage) => (
                      <DropdownMenuItem key={stage.id} disabled={sendingToCrm} onClick={() => handleSendToCrm(stage.stage_key)}>
                        <KanbanSquare className="h-4 w-4 mr-2" /> Enviar p/ {stage.label}
                      </DropdownMenuItem>
                    ))}
                  </>
                )}
                {customerId && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={toggleBot} disabled={togglingBot}>
                      {botActive ? <Bot className="h-4 w-4 mr-2 text-primary" /> : <BotOff className="h-4 w-4 mr-2" />}
                      IA {botActive ? "ligada" : "desligada"} (só este lead)
                    </DropdownMenuItem>
                  </>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  disabled={resetting}
                  onClick={() => setResetDialogOpen(true)}
                >
                  <RotateCcw className="h-4 w-4 mr-2" /> Zerar conversa do bot
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        ) : (
          <>
        {isCustomer ? (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 shrink-0">
            <UserCheck className="h-3 w-3" />
            <span className="text-[10px] font-semibold hidden xl:inline">Cliente</span>
          </span>
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="h-8 min-w-[32px] text-[10px] gap-1 px-2.5 rounded-full border-primary/30 text-primary hover:bg-primary/10 hover:border-primary/50 shrink-0 transition-all"
            onClick={() => setShowAddDialog(true)}
            title="Adicionar Cliente"
          >
            <UserPlus className="h-3.5 w-3.5" />
            <span className="hidden lg:inline font-semibold">Adicionar</span>
          </Button>
        )}
        {kanbanStages.length > 0 && (
          <Select onValueChange={handleSendToCrm} disabled={sendingToCrm}>
            <SelectTrigger className="h-8 w-auto gap-1 text-[10px] rounded-full border-accent/30 text-accent-foreground px-2.5 shrink-0 hover:bg-accent/10 transition-colors">
              {sendingToCrm ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <KanbanSquare className="h-3.5 w-3.5" />}
              <span className="hidden lg:inline font-semibold">CRM</span>
            </SelectTrigger>
            <SelectContent>
              {kanbanStages.map((stage) => (
                <SelectItem key={stage.id} value={stage.stage_key}>{stage.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {isCustomer && customerId && (
          <Button
            size="sm"
            variant={captureActive ? "default" : "outline"}
            className={`h-8 min-w-[32px] text-[10px] gap-1 px-2.5 rounded-full shrink-0 transition-all ${
              captureActive
                ? "bg-gradient-to-r from-primary to-primary/85 text-primary-foreground shadow-md shadow-primary/30 hover:shadow-lg hover:shadow-primary/40 ring-1 ring-primary/40"
                : "border-primary/30 text-primary hover:bg-primary/10 hover:border-primary/50"
            }`}
            onClick={toggleCapture}
            title="Abrir painel de captação"
          >
            <ClipboardList className="h-3.5 w-3.5" />
            <span className="hidden lg:inline font-semibold">Captação{filledCount > 0 ? ` ${filledCount}/${totalFields}` : ""}</span>
          </Button>
        )}

        {customerId && (
          <Button
            size="sm"
            variant="outline"
            onClick={toggleBot}
            disabled={togglingBot}
            title={botActive ? "Desligar bot só para este lead" : "Ligar bot para este lead"}
            className={`h-8 min-w-[32px] text-[10px] gap-1 px-2.5 rounded-full shrink-0 transition-all ${
              botActive
                ? "border-primary/40 bg-primary/8 text-primary hover:bg-primary/15"
                : "border-muted-foreground/30 text-muted-foreground hover:bg-muted/40"
            }`}
          >
            {togglingBot ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : botActive ? (
              <Bot className="h-3.5 w-3.5" />
            ) : (
              <BotOff className="h-3.5 w-3.5" />
            )}
            <span className="hidden lg:inline font-semibold">IA {botActive ? "ON" : "OFF"}</span>
            {botActive && <span className="hidden lg:inline-block h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />}
          </Button>
        )}

        <Button
          size="sm"
          variant="ghost"
          className="h-8 min-w-[32px] text-[10px] gap-1 px-2.5 rounded-full text-muted-foreground hover:text-destructive hover:bg-destructive/10 shrink-0 transition-colors"
          disabled={resetting}
          title="Apaga histórico do bot e reinicia o fluxo do zero"
          onClick={() => setResetDialogOpen(true)}
        >
          {resetting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
          <span className="hidden lg:inline font-medium">Zerar</span>
        </Button>
          </>
        )}
      </div>

      {partnerName && (
        <div
          className="flex items-center gap-1.5 px-3 lg:px-3.5 py-1.5 border-b border-amber-600/30 bg-amber-100 text-amber-950 shrink-0"
          title={`${partnerName} acompanha as etapas do cadastro deste lead (não recebe o chat completo)`}
          role="status"
        >
          <Handshake className="h-3.5 w-3.5 shrink-0 text-amber-800" />
          <span className="text-[12px] font-semibold truncate text-amber-950">
            Indicação de {partnerName}
          </span>
          <span className="text-[11px] font-medium text-amber-900/80 hidden sm:inline shrink-0">
            · acompanha as etapas do cadastro
          </span>
        </div>
      )}

      <AlertDialog open={endAttendanceDialogOpen} onOpenChange={setEndAttendanceDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Finalizar atendimento?</AlertDialogTitle>
            <AlertDialogDescription>
              Vamos enviar a mensagem de encerramento e a pesquisa de satisfação (responda com um número de 1 a 5).
              O cliente não receberá botões interativos — só texto, para funcionar em todos os canais.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={attendance.ending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void (async () => {
                  await attendance.endAttendance();
                  setEndAttendanceDialogOpen(false);
                })();
              }}
              disabled={attendance.ending}
              className="bg-amber-600 hover:bg-amber-500"
            >
              {attendance.ending ? "Enviando…" : "Finalizar e pedir nota"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={closeCaptureOpen} onOpenChange={(v) => !closingCapture && setCloseCaptureOpen(v)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Encerrar captação deste cliente?</AlertDialogTitle>
            <AlertDialogDescription>
              O lead sai da lista de <b>Captação</b> e é vinculado automaticamente em <b>Vendas</b>, <b>CRM</b> e <b>Comissão</b>.
              O <b>chat do WhatsApp continua ativo</b> — nada é apagado.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={closingCapture}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); void runCloseCapture(); }}
              disabled={closingCapture}
              className="bg-emerald-600 hover:bg-emerald-500 text-white"
            >
              {closingCapture ? "Encerrando…" : "Encerrar captação"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>



      <AlertDialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Zerar conversa deste cliente interessado?</AlertDialogTitle>
              <AlertDialogDescription>
                Vai apagar o histórico de mensagens do bot, decisões da IA, áudios disparados e
                resetar a etapa do funil. O cliente continua cadastrado, mas o bot vai começar do zero
                na próxima mensagem que ele mandar. Útil pra você testar o fluxo.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={handleReset} className="bg-destructive hover:bg-destructive/90">
                Sim, zerar
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

      {customerId && (
        <PortalStatusTracker customerId={customerId} consultantId={consultantId} defaultCollapsed={isCompactLayout} />
      )}

      {/* Messages area — flex-1 min-h-0 garante composer sempre visível */}
      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-y-auto px-3 py-3 bg-gradient-to-b from-muted/20 via-background to-muted/10"
        style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%2300a032' fill-opacity='0.025'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E\")" }}
      >
        {isLoading && messages.length === 0 && (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}
        {!isLoading && messages.length === 0 && (
          <div className="text-center text-xs text-muted-foreground py-8">
            Nenhuma mensagem encontrada
          </div>
        )}
        {isLoadingOlder && (
          <div className="flex justify-center py-2 sticky top-0 z-10">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-card/95 border border-border/60 px-3 py-1 text-[11px] text-muted-foreground shadow-sm">
              <Loader2 className="h-3 w-3 animate-spin" />
              Carregando mensagens anteriores…
            </span>
          </div>
        )}
        {!hasMoreOlder && messages.length > 0 && isWhapi && (
          <p className="text-center text-[10px] text-muted-foreground py-2">
            Início da conversa
          </p>
        )}
        {messages.map((msg) => (
          <div key={msg.id} data-msg-bubble>
            <MessageBubble
              message={msg}
              onLoadMedia={loadMedia}
              consultantId={consultantId}
              customerId={customerId}
              onAttachToCapture={customerId ? async (m, key, loaded) => {
                await attachMediaToCapture({
                  customerId,
                  key,
                  sourceUrl: loaded,
                  fileName: m.fileName,
                });
              } : undefined}
            />
          </div>
        ))}
        <div ref={bottomRef} aria-hidden className="h-2" />
      </div>

      {/* Composer — shell reserva espaço quando a barra minimizada de captação está ativa */}
      <div className="shrink-0 wa-message-composer-shell relative z-20 bg-card">
      <MessageComposer
        onSend={async (text) => {
          stickToBottomRef.current = true;
          try {
            // Destinatário: telefone real do cliente (mesma fonte do bot) quando
            // disponível — cobre conversas `@lid` onde o JID não tem telefone.
            const override = normalizeBrazilPhone(customerPhone);
            if (!override && chat?.remoteJid.endsWith("@lid") && !chat?.sendTargetJid?.endsWith("@s.whatsapp.net")) {
              // Conversa só com LID (ID criptografado) — não temos telefone real.
              // Enviar o LID cru quebra na Evolution. Peça pro cliente mandar msg
              // ou cadastre manualmente.
              throw new Error(
                "Este contato ainda não expôs o telefone real (só ID criptografado). Peça uma mensagem do cliente ou cadastre o número manualmente para conseguir responder.",
              );
            }
            await sendMessage(text, override);
            scheduleScrollToBottom(true);
          } catch (err) {
            // Falha de envio de TEXTO antes não tinha feedback nenhum: o erro
            // subia até o composer e era engolido por um `catch {}` vazio, então
            // o consultor mandava "oi" e nada acontecia (sem toast, sem motivo).
            // Agora avisamos o motivo e re-lançamos para o composer PRESERVAR o
            // texto digitado (não limpa o campo), permitindo reenviar.
            logger.error("Falha ao enviar mensagem de texto:", err);
            toast({
              title: "Não consegui enviar a mensagem",
              description: err instanceof Error ? err.message : "Falha no envio. Verifique a conexão do WhatsApp e tente de novo.",
              variant: "destructive",
            });
            throw err;
          }
        }}
        initialMessage={initialMessage}
        consultantId={consultantId}
        customerId={customerId || undefined}
        customerJid={chat?.remoteJid}
        customerName={chat?.name}
        onSendAudio={async (base64) => {
          const phone = await getResolvedPhone();
          if (!phone) return;
          void takeoverWithUndo(phone, "humano_assumiu_audio");
          try {
            // useAudioRecorder já gera OGG/Opus real, formato aceito pelo WhatsApp/Whapi.
            const audioDataUrl = `data:audio/ogg;base64,${base64}`;
            const result = await sendWhatsAppMessage({
              instanceName, phone, mediaCategory: "audio", mediaUrl: audioDataUrl, isWhapi,
              customerId: customerId ?? undefined,
              conversationStep: "consultor_manual",
            });
            if (result.status === "timeout") {
              toast({ title: "Áudio enviado (aguardando confirmação)", description: "O servidor está processando", variant: "default" });
            } else if (result.status === "failed") {
              toast({ title: "Erro ao enviar áudio", description: result.error, variant: "destructive" });
            }
          } catch (err: unknown) {
            logger.error("Erro ao enviar áudio:", err);
            toast({ title: "Erro ao enviar áudio", description: err instanceof Error ? err.message : "Falha no envio", variant: "destructive" });
          }
        }}
        onSendAudioUrl={async (audioUrl) => {
          const phone = await getResolvedPhone();
          if (!phone) return;
          void takeoverWithUndo(phone, "humano_assumiu_audio");
          try {
            const result = await sendWhatsAppMessage({
              instanceName, phone, mediaCategory: "audio", mediaUrl: audioUrl, isWhapi,
              customerId: customerId ?? undefined,
              conversationStep: "consultor_manual",
            });
            if (result.status === "timeout") {
              toast({ title: "Áudio enviado (aguardando confirmação)", variant: "default" });
            } else if (result.status === "failed") {
              toast({ title: "Erro ao enviar áudio", description: result.error, variant: "destructive" });
            }
          } catch (err: unknown) {
            logger.error("Erro ao enviar áudio:", err);
            toast({ title: "Erro ao enviar áudio", description: err instanceof Error ? err.message : "Falha no envio", variant: "destructive" });
          }
        }}
        onSendMedia={async (mediaUrl, caption, mediaType) => {
          const phone = await getResolvedPhone();
          if (!phone) return;
          void takeoverWithUndo(phone, "humano_assumiu_midia");
          try {
            const category = mediaType as "image" | "video" | "document" | "sticker";
            const fileName = mediaType === "document"
              ? (mediaUrl.split("/").pop()?.split("?")[0] || "documento")
              : undefined;

            const result = await sendWhatsAppMessage({
              instanceName, phone, mediaCategory: category, mediaUrl, text: caption, fileName, isWhapi,
              customerId: customerId ?? undefined,
              conversationStep: "consultor_manual",
            });
            if (result.status === "timeout") {
              toast({ title: "Mídia enviada (aguardando confirmação)", description: "O servidor está processando", variant: "default" });
            } else if (result.status === "failed") {
              toast({ title: "Erro ao enviar mídia", description: result.error, variant: "destructive" });
            }
          } catch (err: unknown) {
            logger.error("Erro ao enviar mídia:", err);
            toast({ title: "Erro ao enviar mídia", description: err instanceof Error ? err.message : "Falha no envio", variant: "destructive" });
          }
        }}
        templates={templates}
      />
      </div>

      {/* Add Customer Dialog */}
      {chat && (
        <AddCustomerDialog
          open={showAddDialog}
          onOpenChange={setShowAddDialog}
          phone={phoneNumber}
          name={chat.name !== phoneNumber ? chat.name : null}
          consultantId={consultantId}
          onAdded={handleCustomerAdded}
        />
      )}
      </div>

      {/* Painel de Captação — coluna lateral inline em desktop/tablet (≥768px).
          Abaixo disso vira Sheet por baixo. */}
      {showInlineCapture && (
        <>
          <div
            role="separator"
            aria-orientation="vertical"
            className="w-1 cursor-col-resize bg-border/60 hover:bg-primary/40 transition-colors shrink-0"
            onMouseDown={(e) => {
              e.preventDefault();
              const startX = e.clientX;
              const startW = parseInt(getComputedStyle(document.documentElement).getPropertyValue("--cap-side-w") || "300", 10);
              const onMove = (ev: MouseEvent) => {
                const w = Math.min(480, Math.max(260, startW - (ev.clientX - startX)));
                document.documentElement.style.setProperty("--cap-side-w", `${w}px`);
              };
              const onUp = () => {
                document.removeEventListener("mousemove", onMove);
                document.removeEventListener("mouseup", onUp);
                const w = getComputedStyle(document.documentElement).getPropertyValue("--cap-side-w");
                try { localStorage.setItem("whatsapp_capture_side_w", w); } catch {}
              };
              document.addEventListener("mousemove", onMove);
              document.addEventListener("mouseup", onUp);
            }}
            title="Arraste pra redimensionar"
          />
          <div className="flex shrink-0" style={{ width: "var(--cap-side-w, 320px)" }}>
            <CaptureSheet
              open
              onOpenChange={() => { /* painel persistente — não fecha */ }}
              consultantId={consultantId}
              customerId={customerId!}
              customerName={chat?.name}
              phoneNumber={phoneNumber}
              inline
            />
          </div>
        </>
      )}


      {/* Capture Sheet (overlay) — mobile/tablet compacto (<lg) */}
      {showSheetCapture && (
        <CaptureSheet
          open={captureOpen}
          onOpenChange={setCaptureOpen}
          consultantId={consultantId}
          customerId={customerId}
          customerName={chat?.name}
          phoneNumber={phoneNumber}
        />
      )}

    </div>

  );
}

