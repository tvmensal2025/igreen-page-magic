import { useState, useRef, useMemo, useCallback, useEffect } from "react";
import { Megaphone, Send, Loader2, Pause, Play, X, CheckCircle2, XCircle, ArrowRight, ArrowLeft, Download, RotateCw, AlertTriangle, Users, MessageSquare, Settings2, Activity, PlayCircle, Maximize2, Minimize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/components/ui/use-toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { supabase } from "@/integrations/supabase/client";
import { ContactImporter } from "../ContactImporter";
import { sendWhatsAppMessage } from "@/services/messageSender";
import { getConnectionState } from "@/services/evolutionApi";
import type { BulkContact, MessageTemplate } from "@/types/whatsapp";
import { MessageEditor } from "./MessageEditor";
import { ScheduleStep } from "./ScheduleStep";
import { MultichannelStep } from "./MultichannelStep";
import { Sparkles } from "lucide-react";
import { DEFAULT_CONFIG, type SendConfig, type PreparedMedia, type CampaignTarget } from "./types";
import { renderFinal } from "./spintax";
import { createCampaign, updateCampaignStatus, updateTargetStatus, listCampaigns, deleteCampaign, loadCampaignForResume, type PersistedCampaignRow } from "./useCampaignPersistence";

interface Customer {
  id: string; name: string; phone_whatsapp: string; electricity_bill_value?: number;
  city?: string; // Adicionado para suportar variável {cidade}
  status?: string; devolutiva?: string | null; registered_by_name?: string | null;
  last_inbound_at?: string | null;
}

interface Props {
  instanceName: string;
  /** Canal primário. Sem isso o envio cai no caminho Evolution (legado). */
  isWhapi?: boolean;
  customers: Customer[];
  templates: MessageTemplate[];
  consultantId: string;
  // Quando aberto a partir de outra tela (ex.: Leads captados), já entra com
  // estes contatos carregados. Mantém o mesmo wizard/UX do Disparo PRO.
  seedContacts?: BulkContact[];
}

type Step = 1 | 2 | 3 | 4 | 5;

const STEPS: { n: Step; label: string; icon: any }[] = [
  { n: 1, label: "Contatos", icon: Users },
  { n: 2, label: "Mensagem", icon: MessageSquare },
  { n: 3, label: "Multicanal", icon: Sparkles },
  { n: 4, label: "Envio", icon: Settings2 },
  { n: 5, label: "Acompanhar", icon: Activity },
];

function isValidPhone(p: string): boolean {
  if (!p) return false;
  if (/sem_celular/i.test(p)) return false;
  return p.replace(/\D/g, "").length >= 10;
}

function normalizePhone(p: string): string { return p.replace(/\D/g, ""); }

function dedupe(list: BulkContact[]): { unique: BulkContact[]; removed: number } {
  const seen = new Set<string>();
  const out: BulkContact[] = [];
  let removed = 0;
  for (const c of list) {
    const k = normalizePhone(c.phone);
    if (seen.has(k)) { removed++; continue; }
    seen.add(k); out.push(c);
  }
  return { unique: out, removed };
}

function inWindow(cfg: SendConfig, now = new Date()): boolean {
  if (cfg.weekdaysOnly) {
    const d = now.getDay();
    if (d === 0 || d === 6) return false;
  }
  const [sH, sM] = cfg.windowStart.split(":").map(Number);
  const [eH, eM] = cfg.windowEnd.split(":").map(Number);
  const start = sH * 60 + sM;
  const end = eH * 60 + eM;
  const cur = now.getHours() * 60 + now.getMinutes();
  // Overnight window (e.g. 22:00 → 06:00)
  if (end < start) return cur >= start || cur <= end;
  return cur >= start && cur <= end;
}

function downloadCsv(rows: CampaignTarget[]) {
  const head = ["telefone", "nome", "status", "erro", "mensagem", "enviado_em"];
  const esc = (v: any) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const body = rows.map(r => [
    r.phone, r.name, r.status, r.error || "",
    (r.finalMessage || "").replace(/\n/g, " ").slice(0, 500),
    r.sentAt ? new Date(r.sentAt).toISOString() : "",
  ].map(esc).join(",")).join("\n");
  const csv = head.join(",") + "\n" + body;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `disparo-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function BulkProPanel({ instanceName, isWhapi, customers, templates, consultantId, seedContacts }: Props) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const [step, setStep] = useState<Step>(1);
  const [contacts, setContacts] = useState<BulkContact[]>(seedContacts ?? []);

  // Quando recebe contatos de fora (ex.: Leads captados), pré-carrega no passo 1.
  // Só roda quando a lista de seed muda — não atrapalha o uso manual.
  const seedKey = (seedContacts ?? []).map((c) => c.id).join(",");
  useEffect(() => {
    if (seedContacts && seedContacts.length > 0) {
      setContacts(seedContacts);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedKey]);
  const [text, setText] = useState("");
  // Estado legado removido - migrado para config.mediaItems
  const [uploading, setUploading] = useState(false);
  const [media, setMedia] = useState<PreparedMedia | null>(null); // Re-adicionado para compatibilidade com legados no código que não limpei ainda
  const [config, setConfig] = useState<SendConfig>(DEFAULT_CONFIG);

  // Live last-inbound enrichment (kept from original panel for ContactImporter compatibility)
  const [lastInboundMap, setLastInboundMap] = useState<Map<string, string | null>>(new Map());
  useEffect(() => {
    let cancelled = false;
    const ids = customers.map(c => c.id).filter(Boolean);
    if (ids.length === 0) { setLastInboundMap(new Map()); return; }
    (async () => {
      const map = new Map<string, string | null>();
      const CHUNK = 500;
      for (let i = 0; i < ids.length; i += CHUNK) {
        const slice = ids.slice(i, i + CHUNK);
        const { data, error } = await (supabase as any)
          .from("customer_flow_state").select("customer_id,last_inbound_at").in("customer_id", slice);
        if (error) continue;
        for (const row of (data as any[]) || []) map.set(String(row.customer_id), row.last_inbound_at ?? null);
        if (cancelled) return;
      }
      if (!cancelled) setLastInboundMap(map);
    })();
    return () => { cancelled = true; };
  }, [customers]);

  const enrichedCustomers = useMemo<Customer[]>(
    () => customers.map(c => ({ ...c, last_inbound_at: lastInboundMap.get(c.id) ?? null })),
    [customers, lastInboundMap],
  );

  const validContacts = useMemo(() => contacts.filter(c => isValidPhone(c.phone)), [contacts]);
  const { unique: deduped, removed: dupCount } = useMemo(() => dedupe(validContacts), [validContacts]);

  // ── Runtime state ──
  const [targets, setTargets] = useState<CampaignTarget[]>([]);
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [done, setDone] = useState(false);
  const [waitingSchedule, setWaitingSchedule] = useState<string | null>(null);
  const cancelledRef = useRef(false);
  const pausedRef = useRef(false);
  const campaignIdRef = useRef<string | null>(null);
  const [isCleaning, setIsCleaning] = useState(false);
  const [filterStatus, setFilterStatus] = useState<"all" | "sent" | "failed">("all");
  const [history, setHistory] = useState<PersistedCampaignRow[]>([]);
  const [campaignName, setCampaignName] = useState("");
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setExpanded(false); };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [expanded]);

  // Load history
  useEffect(() => {
    listCampaigns(consultantId).then(setHistory);
  }, [consultantId, done]);

  const stats = useMemo(() => {
    const sent = targets.filter(t => t.status === "sent").length;
    const failed = targets.filter(t => t.status === "failed").length;
    const queued = targets.filter(t => t.status === "queued").length;
    return { sent, failed, queued, total: targets.length };
  }, [targets]);

  const sleep = useCallback((ms: number) => new Promise<boolean>(resolve => {
    let elapsed = 0;
    const it = setInterval(() => {
      if (cancelledRef.current) { clearInterval(it); resolve(false); return; }
      if (pausedRef.current) return;
      elapsed += 250;
      if (elapsed >= ms) { clearInterval(it); resolve(true); }
    }, 250);
  }), []);

  const checkConnection = useCallback(async () => {
    // Whapi não tem linha em whatsapp_instances: getConnectionState é Evolution
    // e devolvia "close", pausando o disparo com "WhatsApp desconectado" mesmo
    // com o canal saudável. A saúde do Whapi já é validada antes de abrir o painel.
    if (isWhapi) return true;
    try {
      const r = await getConnectionState(instanceName);
      return (r?.state || "close") === "open";
    } catch { return false; }
  }, [instanceName, isWhapi]);

  const runCampaign = useCallback(async (
    initialTargets: CampaignTarget[],
    existingCampaignId?: string,
    overrides?: { text?: string; mediaItems?: PreparedMedia[]; config?: SendConfig; name?: string },
  ) => {
    const useText = overrides?.text ?? text;
    const useMediaItems = overrides?.mediaItems ?? config.mediaItems ?? [];
    const useConfig = overrides?.config ?? config;
    const useName = overrides?.name ?? campaignName;

    cancelledRef.current = false;
    pausedRef.current = false;
    setPaused(false);
    setRunning(true);
    setDone(false);
    setTargets(initialTargets);
    setStep(5);

    // Persist campaign (skip if resuming)
    if (!existingCampaignId) {
      // Para o banco, se houver múltiplas mídias, guardamos a primeira como referência principal
      // ou guardamos tudo no campo config (que já é persistido).
      const primaryMedia = useMediaItems[0];
      const newId = await createCampaign({
        consultantId,
        name: useName.trim() || `Disparo ${new Date().toLocaleString("pt-BR")}`,
        messageText: useText,
        mediaUrl: primaryMedia?.url ?? null,
        mediaType: primaryMedia?.kind ?? null,
        mediaFilename: primaryMedia?.fileName ?? null,
        config: { ...useConfig, mediaItems: useMediaItems } as any,
        scheduledAt: useConfig.scheduleAt,
        targets: initialTargets,
      });
      campaignIdRef.current = newId;
    } else {
      campaignIdRef.current = existingCampaignId;
    }

    // Se houver agendamento futuro, deixa para o worker server-side (bulk-scheduler)
    // — pode fechar a aba sem perder o disparo.
    if (useConfig.scheduleAt) {
      const target = new Date(useConfig.scheduleAt).getTime();
      if (!isNaN(target) && target > Date.now()) {
        toast({
          title: "Disparo agendado ✓",
          description: `Início: ${new Date(useConfig.scheduleAt).toLocaleString("pt-BR")}. Você pode fechar a aba — o servidor envia sozinho.`,
        });
        setRunning(false);
        setDone(true);
        return;
      }
    }

    let consecutiveFailures = 0;
    const work = [...initialTargets];

    for (let idx = 0; idx < work.length; idx++) {
      if (cancelledRef.current) break;

      // Window check
      while (!inWindow(useConfig) && !cancelledRef.current) {
        await new Promise(r => setTimeout(r, 30_000));
      }
      if (cancelledRef.current) break;

      // Pause check
      while (pausedRef.current && !cancelledRef.current) await new Promise(r => setTimeout(r, 500));
      if (cancelledRef.current) break;

      // Connection check at block boundary
      if (idx % useConfig.blockSize === 0 && idx > 0) {
        const ok = await checkConnection();
        if (!ok) {
          toast({ title: "WhatsApp desconectado", description: "Envio pausado. Reconecte e clique em Retomar.", variant: "destructive" });
          pausedRef.current = true; setPaused(true);
          while (pausedRef.current && !cancelledRef.current) await new Promise(r => setTimeout(r, 1000));
          if (cancelledRef.current) break;
        }
        // Block pause
        const pauseMs = useConfig.blockPauseMin * 60_000;
        const ok2 = await sleep(pauseMs);
        if (!ok2) break;
      }

      const t = work[idx];
      setTargets(prev => prev.map(x => x.id === t.id ? { ...x, status: "sending" } : x));

      const finalMsg = renderFinal(useText, { name: t.name, bill: t.bill, city: t.city });

      // Base comum: `isWhapi` decide o canal real (sem isso cai no Evolution
      // legado) e `customerId` habilita o gate DNC + o registro em `conversations`.
      const sendBase = { instanceName, isWhapi, customerId: t.customerId ?? null, phone: t.phone };

      let ok = true;
      let err: string | undefined;
      const fail = (msg?: string) => { ok = false; err = err || msg || "Falha no envio"; };
      try {
        if (useMediaItems.length > 0) {
          const firstKind = useMediaItems[0].kind;
          const firstAcceptsCaption = firstKind === "image" || firstKind === "video";
          const captionMode = useConfig.mediaOrder === "caption_only" || useConfig.mediaOrder === "media_first";
          // Áudio e documento não aceitam legenda: nesses casos o texto tem que
          // sair como mensagem separada, senão ele simplesmente não é enviado.
          const useCaptionOnFirst = captionMode && firstAcceptsCaption && Boolean(finalMsg.trim());

          if (useConfig.mediaOrder === "text_first" && finalMsg.trim()) {
            const r = await sendWhatsAppMessage({ ...sendBase, mediaCategory: "text", text: finalMsg });
            if (r.status === "failed") fail(r.error);
            await new Promise(r2 => setTimeout(r2, 1000 + Math.random() * 1000));
          }

          for (let mIdx = 0; mIdx < useMediaItems.length; mIdx++) {
            const m = useMediaItems[mIdx];
            const cat = m.kind === "image" ? "image" : m.kind === "video" ? "video" : m.kind === "audio" ? "audio" : "document";
            const caption = mIdx === 0 && useCaptionOnFirst ? finalMsg : undefined;

            const r = await sendWhatsAppMessage({
              ...sendBase, mediaCategory: cat as any,
              mediaUrl: m.url,
              text: caption,
              fileName: m.fileName,
            });
            if (r.status === "failed") fail(r.error);

            // Intervalo entre mídias do mesmo contato
            if (mIdx < useMediaItems.length - 1) {
              await new Promise(r2 => setTimeout(r2, 1200 + Math.random() * 800));
            }
          }

          // Texto depois do anexo sempre que ele não saiu como legenda nem antes.
          const textAlreadySent = useConfig.mediaOrder === "text_first" || useCaptionOnFirst;
          if (finalMsg.trim() && !textAlreadySent) {
            await new Promise(r2 => setTimeout(r2, 1000 + Math.random() * 1000));
            const r2 = await sendWhatsAppMessage({ ...sendBase, mediaCategory: "text", text: finalMsg });
            if (r2.status === "failed") fail(r2.error);
          }
        } else {
          if (!finalMsg.trim()) fail("Mensagem vazia");
          else {
            const r = await sendWhatsAppMessage({ ...sendBase, mediaCategory: "text", text: finalMsg });
            if (r.status === "failed") fail(r.error);
          }
        }
      } catch (e: any) {
        ok = false; err = e?.message || "Erro desconhecido";
      }

      // F12/F16: Sincroniza estado de pausa ou roteamento no banco para disparos via UI.
      // Usa `customerId` (não `t.id`): na retomada o `t.id` é o id do target da
      // campanha, e o update em `customers` não achava nada.
      if (ok && t.customerId) {
        const action = overrides?.config?.afterSendAction ?? config.afterSendAction ?? "handoff";

        if (action === "grupo_a") {
          supabase.from("customers")
            .update({
              bot_paused: false,
              bot_paused_reason: null as any,
              flow_variant: "A",
              conversation_step: "a1_ask_name",
              last_outbound_at: new Date().toISOString(),
            } as any)
            .eq("id", t.customerId)
            .then(() => {});
        } else {
          // Padrão solicitado: Pausa bot, humano responde
          supabase.from("customers")
            .update({
              bot_paused: true,
              bot_paused_reason: "bulk_pro" as any,
              bot_paused_at: new Date().toISOString(),
              assigned_human_id: consultantId,
            })
            .eq("id", t.customerId)
            .then(() => {});
        }
      }

      setTargets(prev => prev.map(x => x.id === t.id ? {
        ...x, status: ok ? "sent" : "failed", error: err, finalMessage: finalMsg, sentAt: Date.now(),
      } : x));

      // --- Reforço SMS / Ligação: NÃO IMPLEMENTADO ---
      // Removidas as invocações de `send-velip-sms` (função inexistente) e
      // `voice-dialer-webhook` (callback da Velip, exige ?auth → 401). Eram
      // fire-and-forget com .catch(), então nada saía e nada era registrado.
      // O aviso ao consultor fica no passo Multicanal.

      // Persist target result (fire-and-forget)
      if (campaignIdRef.current) {
        updateTargetStatus(campaignIdRef.current, t.phone, {
          status: ok ? "sent" : "failed",
          final_message: finalMsg.slice(0, 4000),
          error: err,
          sent_at: new Date().toISOString(),
        }).catch(() => {});
      }

      if (ok) consecutiveFailures = 0;
      else consecutiveFailures++;

      // Circuit breaker
      if (consecutiveFailures >= 5) {
        toast({ title: "5 falhas seguidas", description: "Envio pausado. Verifique a conexão.", variant: "destructive" });
        pausedRef.current = true; setPaused(true);
        while (pausedRef.current && !cancelledRef.current) await new Promise(r => setTimeout(r, 500));
        if (cancelledRef.current) break;
        consecutiveFailures = 0;
      }

      // Random interval before next
      if (idx < work.length - 1) {
        const minS = Math.max(1, useConfig.intervalMinS);
        const maxS = Math.max(minS, useConfig.intervalMaxS);
        const secs = minS + Math.random() * (maxS - minS);
        const ok3 = await sleep(Math.round(secs * 1000));
        if (!ok3) break;
      }
    }

    setRunning(false);
    setDone(true);
    // Use functional setter to read fresh stats
    setTargets(prev => {
      const sent = prev.filter(t => t.status === "sent").length;
      const failed = prev.filter(t => t.status === "failed").length;
      toast({ title: "Disparo finalizado", description: `${sent} enviadas, ${failed} falhas` });
      if (campaignIdRef.current) {
        updateCampaignStatus(campaignIdRef.current, {
          status: cancelledRef.current ? "canceled" : "done",
          sent, failed,
          finished_at: new Date().toISOString(),
        }).catch(() => {});
      }
      return prev;
    });
  }, [config, text, instanceName, isWhapi, checkConnection, sleep, toast, consultantId, campaignName]);

  const sendTest = useCallback(async () => {
    if (!text.trim() && (!config.mediaItems || config.mediaItems.length === 0)) {
      toast({ title: "Adicione uma mensagem ou anexo primeiro", variant: "destructive" });
      return;
    }
    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.phone && !user?.email) {
      toast({ title: "Erro", description: "Seu cadastro não tem telefone para o teste", variant: "destructive" });
      return;
    }
    
    // Tenta usar o telefone do consultor para o teste
    const testPhone = user.phone || ""; 
    if (!testPhone) {
       toast({ title: "Aviso", description: "Enviando teste para um número de exemplo. Configure seu telefone no perfil para receber o teste real." });
    }

    toast({ title: "Enviando teste...", description: "Mensagem de WhatsApp para o seu número" });
    
    const dummyTarget: CampaignTarget = {
      id: "test",
      phone: testPhone || "5534999999999",
      name: "Consultor (Teste)",
      status: "sending"
    };

    // Reutiliza a lógica de envio multicanal (simplificada para o teste)
    const finalMsg = renderFinal(text, { name: dummyTarget.name, city: "Sua Cidade" });
    
    try {
      // WhatsApp
      if (config.mediaItems && config.mediaItems.length > 0) {
        for (const m of config.mediaItems) {
           const cat = m.kind === "image" ? "image" : m.kind === "video" ? "video" : m.kind === "audio" ? "audio" : "document";
           await sendWhatsAppMessage({ instanceName, isWhapi, phone: dummyTarget.phone, mediaCategory: cat as any, mediaUrl: m.url, text: finalMsg });
        }
      } else {
        await sendWhatsAppMessage({ instanceName, isWhapi, phone: dummyTarget.phone, mediaCategory: "text", text: finalMsg });
      }

      // SMS e ligação: as chamadas antigas apontavam para `send-velip-sms`
      // (função que não existe) e `voice-dialer-webhook` (callback da Velip,
      // exige ?auth → 401). Falhavam em silêncio e davam falsa sensação de
      // sucesso. Enquanto não houver implementação, o teste avisa em vez de
      // fingir que enviou.
      const semReforco = (config.sendSms && config.smsText) || config.makeCall || config.callAudioClipId;

      toast({
        title: "Teste de WhatsApp enviado",
        description: semReforco
          ? "Verifique seu celular. SMS e ligação não foram enviados — reforço multicanal ainda não está disponível."
          : "Verifique seu celular.",
      });
    } catch (e: any) {
      toast({ title: "Falha no teste", description: e.message, variant: "destructive" });
    }
  }, [text, config, instanceName, isWhapi, consultantId, toast]);

  const startCampaign = useCallback(async () => {
    if (deduped.length === 0) { toast({ title: "Selecione contatos", variant: "destructive" }); return; }
    // A validação de mensagem agora é mais flexível: se for multicanal puro (ligação/sms), 
    // pode não ter WhatsApp, mas o Disparo PRO é focado em WhatsApp + Reforço.
    if (!text.trim() && (!config.mediaItems || config.mediaItems.length === 0)) { toast({ title: "Adicione mensagem ou anexo de WhatsApp", variant: "destructive" }); return; }
    if (config.intervalMaxS < config.intervalMinS) {
      toast({ title: "Intervalo inválido", description: "Intervalo máximo deve ser maior ou igual ao mínimo", variant: "destructive" });
      return;
    }

    // Confirmação explícita do destino da resposta: é a decisão com mais
    // impacto do disparo e antes ficava só num toggle no passo de envio.
    const isGrupoA = config.afterSendAction === "grupo_a";
    const confirmed = await confirm({
      title: config.scheduleAt ? `Agendar disparo para ${deduped.length} contatos?` : `Disparar para ${deduped.length} contatos?`,
      description: isGrupoA
        ? "Quem responder entra no funil de cadastro automático (Sofia / Grupo A): ela pede nome, conta de luz e documento sozinha."
        : "Quem responder fica aguardando você no chat. O robô e a cadência ficam calados para esses contatos até você reativar o robô na conversa.",
      confirmText: config.scheduleAt ? "Agendar" : "Disparar agora",
    });
    if (!confirmed) return;
    const initial: CampaignTarget[] = deduped.map(c => ({
      id: c.id,
      // Aqui a origem é a lista de leads, então o id É o customers.id.
      customerId: c.id,
      phone: c.phone, name: c.name,
      bill: c.electricity_bill_value,
      city: c.city, // Garante que a cidade vá para o render de variáveis
      status: "queued",
    }));
    runCampaign(initial);
  }, [deduped, text, config, runCampaign, toast, confirm]);

  const handlePause = () => { pausedRef.current = !pausedRef.current; setPaused(pausedRef.current); };
  const handleCancel = () => { cancelledRef.current = true; pausedRef.current = false; setPaused(false); };

  const retryFailed = () => {
    const failed = targets.filter(t => t.status === "failed").map(t => ({ ...t, status: "queued" as const, error: undefined }));
    if (failed.length === 0) return;
    runCampaign(failed);
  };

  const handleResume = useCallback(async (campId: string) => {
    if (running) { toast({ title: "Já existe um disparo em andamento", variant: "destructive" }); return; }
    const payload = await loadCampaignForResume(campId);
    if (!payload) { toast({ title: "Não foi possível carregar a campanha", variant: "destructive" }); return; }
    if (payload.queuedTargets.length === 0) {
      toast({ title: "Nada na fila", description: "Esta campanha não tem contatos pendentes." });
      return;
    }
    // Restaura estado local a partir da campanha persistida
    setText(payload.messageText);
    if (payload.mediaUrl && payload.mediaType && payload.mediaType !== "text") {
      setMedia({ url: payload.mediaUrl, kind: payload.mediaType as any, fileName: payload.mediaFilename || undefined });
    } else {
      setMedia(null);
    }
    const restored: SendConfig = { 
      ...DEFAULT_CONFIG, 
      ...(payload.config || {}), 
      scheduleAt: null,
    };
    
    // Suporte para campanhas antigas (single media) vs novas (mediaItems)
    const mediaItems: PreparedMedia[] = restored.mediaItems || [];
    if (mediaItems.length === 0 && payload.mediaUrl && payload.mediaType && payload.mediaType !== "text") {
      mediaItems.push({
        url: payload.mediaUrl,
        kind: payload.mediaType as any,
        fileName: payload.mediaFilename || undefined
      });
    }
    
    restored.mediaItems = mediaItems;
    setConfig(restored);
    setCampaignName(payload.name);
    toast({ title: "Retomando disparo", description: `${payload.queuedTargets.length} contatos na fila` });

    // Na retomada os targets vêm de `bulk_campaign_targets`, então o `id` NÃO é
    // o customers.id. Resolve pelo telefone na lista de leads já carregada para
    // o gate DNC e o handoff/Grupo A continuarem funcionando.
    const byPhone = new Map<string, string>();
    for (const c of customers) {
      const k = normalizePhone(c.phone_whatsapp || "").slice(-11);
      if (k.length >= 10) byPhone.set(k, c.id);
    }
    const resumeTargets = payload.queuedTargets.map(t => ({
      ...t,
      customerId: t.customerId ?? byPhone.get(normalizePhone(t.phone).slice(-11)),
    }));

    runCampaign(resumeTargets, payload.id, {
      text: payload.messageText,
      mediaItems: mediaItems,
      config: restored,
      name: payload.name,
    });
  }, [running, runCampaign, toast, customers]);

  const resetAll = async () => {
    setIsCleaning(true);
    try {
      setStep(1); setTargets([]); setDone(false); setRunning(false); setPaused(false);
      setText(""); 
      setMedia(null);
      setConfig({ ...DEFAULT_CONFIG, mediaItems: [] });
      setCampaignName("");
      campaignIdRef.current = null;
      cancelledRef.current = false;
      pausedRef.current = false;
    } finally {
      setIsCleaning(false);
    }
  };

  const canGoNext = step === 1 ? deduped.length > 0
    : step === 2 ? (text.trim().length > 0 || (config.mediaItems && config.mediaItems.length > 0))
    : true;

  const filteredTargets = useMemo(() => {
    if (filterStatus === "all") return targets;
    return targets.filter(t => t.status === filterStatus);
  }, [targets, filterStatus]);

  return (
    <div
      className={
        expanded
          ? "fixed inset-2 sm:inset-4 z-[60] overflow-hidden rounded-3xl border border-primary/20 bg-[#f5f0e0] shadow-2xl animate-in fade-in-0 zoom-in-95 duration-200"
          : "relative overflow-hidden rounded-3xl border border-primary/15 bg-[#f5f0e0] shadow-lg"
      }
      style={{ fontFamily: "'Figtree', system-ui, sans-serif" }}
    >
      <div className={`relative flex flex-col ${expanded ? "h-full" : ""}`}>
        {/* Header bar — deep emerald */}
        <div className="bg-[#064e3b] text-white px-5 sm:px-7 py-4 sm:py-5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[color:var(--pe-accent-warm)]/20 border border-[color:var(--pe-accent-warm)]/40 flex items-center justify-center">
                <Megaphone className="w-5 h-5 text-[color:var(--pe-accent-warm)]" />
              </div>
              <div>
                <h3 className="text-lg sm:text-xl font-bold tracking-tight" style={{ fontFamily: "'Outfit', system-ui, sans-serif" }}>
                  <span className="text-[color:var(--pe-accent-warm)]">Disparo</span> PRO
                </h3>
                <p className="text-[11px] text-primary/70 hidden sm:block">Mensagens em massa com mídia, agendamento e anti-bloqueio</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {(running || done) && (
                <div className="text-right pr-2 border-r border-white/15 mr-1">
                  <p className="text-[10px] text-primary/60 uppercase tracking-wide">Progresso</p>
                  <p className="text-sm font-bold">{stats.sent + stats.failed}/{stats.total}</p>
                </div>
              )}
              <button
                type="button"
                onClick={() => setExpanded(v => !v)}
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 transition-colors text-xs font-semibold"
                title={expanded ? "Reduzir (Esc)" : "Expandir tela"}
              >
                {expanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                <span className="hidden lg:inline">{expanded ? "Reduzir" : "Expandir"}</span>
              </button>
            </div>
          </div>

          {/* Stepper */}
          <div className="mt-5 sm:mt-6 flex items-center justify-between max-w-3xl mx-auto relative">
            <div className="absolute top-4 left-0 w-full h-0.5 bg-white/15 -translate-y-1/2" />
            {STEPS.map((s) => {
              const Icon = s.icon;
              const active = step === s.n;
              const past = step > s.n;
              const clickable = !running && s.n <= step;
              return (
                <button
                  key={s.n}
                  type="button"
                  disabled={!clickable}
                  onClick={() => clickable && setStep(s.n)}
                  className={`relative z-10 flex flex-col items-center gap-1.5 group ${clickable ? "cursor-pointer" : "cursor-default"}`}
                >
                  <span
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                      active
                        ? "bg-[color:var(--pe-accent-warm)] text-[#064e3b] ring-4 ring-[color:var(--pe-accent-warm)]/25"
                        : past
                        ? "bg-primary/40 text-white"
                        : "bg-white/15 text-white/60"
                    }`}
                  >
                    {past ? "✓" : s.n}
                  </span>
                  <span className={`text-[10px] sm:text-xs font-semibold uppercase tracking-wider whitespace-nowrap ${active ? "text-white" : "text-white/60"}`}>
                    <Icon className="w-3 h-3 inline mr-1 -mt-0.5" />{s.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Body container */}
        <div className={`relative ${expanded ? "flex-1 overflow-auto" : ""} bg-white px-5 sm:px-7 py-5 sm:py-6 space-y-5 ${expanded ? "min-h-full" : "min-h-[200px]"}`}>


          {step === 1 && (
            <div className="space-y-3">
              <ContactImporter
                customers={enrichedCustomers}
                contacts={contacts}
                onContactsChange={setContacts}
                instanceName={instanceName}
              />
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="rounded-xl bg-[#0d7a5f]/5 border border-[#0d7a5f]/20 p-3 text-center">
                  <p className="text-[10px] text-[#064e3b]/60 uppercase font-semibold tracking-wider">Selecionados</p>
                  <p className="text-2xl font-bold text-[#0d7a5f]" style={{ fontFamily: "'Outfit', sans-serif" }}>{deduped.length}</p>
                </div>
                <div className="rounded-xl bg-[color:var(--pe-accent-warm)]/10 border border-[color:var(--pe-accent-warm)]/30 p-3 text-center">
                  <p className="text-[10px] text-[#064e3b]/60 uppercase font-semibold tracking-wider">Duplicados</p>
                  <p className="text-2xl font-bold text-[#a8862f]" style={{ fontFamily: "'Outfit', sans-serif" }}>{dupCount}</p>
                </div>
                <div className="rounded-xl bg-destructive/10 border border-destructive/30 p-3 text-center">
                  <p className="text-[10px] text-[#064e3b]/60 uppercase font-semibold tracking-wider">Inválidos</p>
                  <p className="text-2xl font-bold text-destructive" style={{ fontFamily: "'Outfit', sans-serif" }}>{contacts.length - validContacts.length}</p>
                </div>
              </div>

              {history.length > 0 && (
                <div className="rounded-xl border border-border/40 bg-secondary/10 p-3">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-bold text-foreground">Histórico de disparos</p>
                    <span className="text-[10px] text-muted-foreground">{history.length} recentes</span>
                  </div>
                  <div className="space-y-1.5 max-h-48 overflow-auto">
                    {history.map(h => {
                      const total = h.total || 1;
                      const pct = Math.round(((h.sent + h.failed) / total) * 100);
                      const statusColor = h.status === "done" ? "text-primary"
                        : h.status === "running" ? "text-info"
                        : h.status === "scheduled" ? "text-warning"
                        : h.status === "canceled" ? "text-destructive" : "text-muted-foreground";
                      return (
                        <div key={h.id} className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-background/40 border border-border/30 text-xs">
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-foreground truncate">{h.name}</p>
                            <p className="text-[10px] text-muted-foreground">
                              {new Date(h.created_at).toLocaleString("pt-BR")} • {h.total} contatos
                            </p>
                          </div>
                          <div className="text-right">
                            <p className={`text-[10px] font-bold uppercase ${statusColor}`}>{h.status}</p>
                            <p className="text-[10px] text-muted-foreground">
                              ✓{h.sent} ✗{h.failed} ({pct}%)
                            </p>
                          </div>
                          {(h.status === "running" || h.status === "scheduled") && (
                            <button
                              onClick={() => handleResume(h.id)}
                              className="text-primary hover:text-primary p-1"
                              title="Retomar fila pendente"
                            >
                              <PlayCircle className="w-4 h-4" />
                            </button>
                          )}
                          <button
                            onClick={async () => {
                              const ok = await confirm({ title: `Apagar "${h.name}"?`, confirmText: "Apagar", tone: "danger" });
                              if (!ok) return;
                              await deleteCampaign(h.id);
                              setHistory(prev => prev.filter(x => x.id !== h.id));
                            }}
                            className="text-destructive hover:text-destructive p-1"
                            title="Apagar"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {step === 2 && (
            <MessageEditor
              consultantId={consultantId}
              text={text}
              onTextChange={setText}
              mediaItems={config.mediaItems || []}
              onMediaItemsChange={(m) => setConfig(prev => ({ ...prev, mediaItems: m }))}
              previewName={deduped[0]?.name}
              previewBill={deduped[0]?.electricity_bill_value}
              templates={templates}
            />
          )}

          {step === 3 && (
            <MultichannelStep
              config={config}
              onChange={setConfig}
              consultantId={consultantId}
            />
          )}

          {step === 4 && (
            <div className="space-y-4">
              <div className="rounded-xl border border-border/40 bg-secondary/10 p-3">
                <label className="text-xs font-bold text-foreground mb-1.5 block">Nome da campanha</label>
                <input
                  type="text"
                  value={campaignName}
                  onChange={(e) => setCampaignName(e.target.value)}
                  placeholder={`Disparo ${new Date().toLocaleDateString("pt-BR")}`}
                  maxLength={120}
                  className="w-full px-3 py-2 rounded-md bg-background border border-border/40 text-sm text-foreground"
                />
                <p className="text-[10px] text-muted-foreground mt-1">Aparece no histórico para você identificar depois.</p>
              </div>
              <ScheduleStep config={config} onChange={setConfig} totalContacts={deduped.length} />
              {/* Templates quick load */}
              {templates.length > 0 && (
                <div className="rounded-xl border border-border/40 bg-secondary/10 p-3">
                  <p className="text-xs font-bold mb-2">Carregar mensagem de um template</p>
                  <div className="flex flex-wrap gap-1.5 max-h-32 overflow-auto">
                    {templates.map(t => (
                      <button
                        key={t.id} type="button"
                        onClick={() => {
                          setText(t.content);
                          if (t.media_url && t.media_type && t.media_type !== "text") {
                            const newMedia: PreparedMedia = { url: t.media_url, kind: t.media_type as any, fileName: t.name };
                            setConfig(prev => ({ 
                              ...prev, 
                              mediaItems: [...(prev.mediaItems || []), newMedia] 
                            }));
                          }
                          toast({ title: "Template carregado", description: t.name });
                        }}
                        className="text-[11px] px-2 py-1 rounded bg-secondary/40 hover:bg-secondary text-foreground border border-border/40"
                      >{t.name}</button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {step === 5 && (
            <div className="space-y-4">
              {waitingSchedule && (
                <div className="rounded-xl bg-info/10 border border-info/30 p-3 text-center">
                  <p className="text-sm font-bold text-info">⏰ Aguardando horário agendado</p>
                  <p className="text-xs text-info/80">Início: {new Date(waitingSchedule).toLocaleString("pt-BR")}</p>
                </div>
              )}

              {/* Stats */}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  { label: "Total", val: stats.total, cls: "text-foreground" },
                  { label: "Enviadas", val: stats.sent, cls: "text-primary" },
                  { label: "Falhas", val: stats.failed, cls: "text-destructive" },
                  { label: "Fila", val: stats.queued, cls: "text-muted-foreground" },
                ].map(s => (
                  <div key={s.label} className="rounded-lg bg-secondary/20 border border-border/40 p-2 text-center">
                    <p className="text-[10px] text-muted-foreground uppercase">{s.label}</p>
                    <p className={`text-lg font-bold ${s.cls}`}>{s.val}</p>
                  </div>
                ))}
              </div>

              <Progress value={stats.total ? ((stats.sent + stats.failed) / stats.total) * 100 : 0} className="h-2.5" />

              {/* Controls */}
              {running && (
                <div className="flex gap-2">
                  <Button variant="outline" onClick={handlePause} className="flex-1 gap-1.5 rounded-xl h-10">
                    {paused ? <><Play className="w-4 h-4" /> Retomar</> : <><Pause className="w-4 h-4" /> Pausar</>}
                  </Button>
                  <Button variant="destructive" onClick={handleCancel} className="flex-1 gap-1.5 rounded-xl h-10">
                    <X className="w-4 h-4" /> Cancelar
                  </Button>
                </div>
              )}

              {/* Botão para iniciar nova campanha após finalizar */}
              {done && (
                <Button 
                  onClick={resetAll} 
                  variant="outline"
                  disabled={isCleaning}
                  className="w-full gap-2 border-primary/20 text-primary hover:bg-primary/5 rounded-xl h-10"
                >
                  {isCleaning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Megaphone className="w-4 h-4" />}
                  Nova Campanha
                </Button>
              )}

              {/* Filter */}
              {targets.length > 0 && (
                <div className="flex items-center gap-2">
                  {(["all", "sent", "failed"] as const).map(f => (
                    <button
                      key={f} onClick={() => setFilterStatus(f)}
                      className={`text-[11px] px-2.5 py-1 rounded-md font-medium ${
                        filterStatus === f ? "bg-primary text-primary-foreground" : "bg-secondary/40 text-muted-foreground"
                      }`}
                    >{f === "all" ? "Todos" : f === "sent" ? "Enviados" : "Falhas"}</button>
                  ))}
                </div>
              )}

              {/* Live list */}
              <div className="rounded-xl border border-border/40 bg-secondary/10 max-h-80 overflow-auto">
                {filteredTargets.slice(0, 200).map(t => (
                  <div key={t.id} className="flex items-center gap-2 px-3 py-1.5 border-b border-border/20 last:border-0 text-xs">
                    <span className="w-5 flex-shrink-0">
                      {t.status === "queued" && <span className="w-2 h-2 rounded-full bg-muted-foreground/40 inline-block" />}
                      {t.status === "sending" && <Loader2 className="w-3 h-3 animate-spin text-info" />}
                      {t.status === "sent" && <CheckCircle2 className="w-3 h-3 text-primary" />}
                      {t.status === "failed" && <XCircle className="w-3 h-3 text-destructive" />}
                    </span>
                    <span className="flex-1 truncate text-foreground">{t.name}</span>
                    <span className="text-muted-foreground font-mono">{t.phone}</span>
                    {t.error && <span className="text-destructive text-[10px] truncate max-w-[120px]" title={t.error}>{t.error}</span>}
                  </div>
                ))}
                {filteredTargets.length === 0 && (
                  <p className="p-4 text-center text-xs text-muted-foreground">Nada para mostrar</p>
                )}
              </div>

              {done && (
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => downloadCsv(targets)} className="flex-1 gap-1.5 rounded-xl h-10">
                    <Download className="w-4 h-4" /> Baixar relatório CSV
                  </Button>
                  {stats.failed > 0 && (
                    <Button variant="outline" onClick={retryFailed} className="flex-1 gap-1.5 rounded-xl h-10">
                      <RotateCw className="w-4 h-4" /> Reenviar falhas ({stats.failed})
                    </Button>
                  )}
                  <Button onClick={resetAll} className="flex-1 rounded-xl h-10">Novo disparo</Button>
                </div>
              )}
            </div>
          )}



        {/* Footer navigation */}
        {step < 5 && !running && (
          <div className="flex items-center justify-between pt-2 border-t border-border/30">
            <Button
              variant="outline" disabled={step === 1}
              onClick={() => setStep((s) => Math.max(1, s - 1) as Step)}
              className="gap-1.5 rounded-xl"
            >
              <ArrowLeft className="w-4 h-4" /> Voltar
            </Button>

            {step < 4 ? (
              <Button
                onClick={() => setStep((s) => Math.min(4, s + 1) as Step)}
                disabled={!canGoNext}
                className="gap-1.5 rounded-xl"
              >
                Avançar <ArrowRight className="w-4 h-4" />
              </Button>
            ) : (
              <div className="flex gap-2">
                <Button 
                  variant="outline" 
                  onClick={sendTest}
                  disabled={running || uploading || (!text.trim() && (!config.mediaItems || config.mediaItems.length === 0))}
                  className="gap-2 border-primary/40 text-primary hover:bg-primary/5 rounded-xl h-11"
                >
                  <RotateCw className="w-4 h-4" /> Testar no meu Zap
                </Button>
                <Button
                  onClick={startCampaign}
                  disabled={deduped.length === 0 || (!text.trim() && (!config.mediaItems || config.mediaItems.length === 0))}
                  className="gap-1.5 rounded-xl h-11 font-bold"
                  style={{ background: "var(--gradient-green)" }}
                >
                  <Send className="w-4 h-4" />
                  {config.scheduleAt ? "Agendar e iniciar" : `Iniciar disparo (${deduped.length})`}
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Warning low */}
        {step === 1 && deduped.length > 200 && (
          <div className="rounded-lg bg-warning/10 border border-warning/30 p-2.5 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
            <p className="text-[11px] text-warning">
              Mais de 200 contatos em um envio aumenta o risco de bloqueio. Considere dividir em dias.
            </p>
          </div>
        )}
        </div>
      </div>
    </div>
  );
}
