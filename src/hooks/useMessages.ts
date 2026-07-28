import { useState, useEffect, useCallback, useRef } from "react";
import {
  findMessages,
  findMessagesForChat,
  markAsRead,
  getBase64FromMediaMessage,
  type EvolutionMessage,
} from "@/services/evolutionApi";
import { whapiListMessages, whapiListMessagesForChat, whapiDownloadMedia } from "@/services/whapiApi";
import { sendWhatsAppMessage, resolveRecipient, normalizeBrazilPhone } from "@/services/messageSender";
import { supabase } from "@/integrations/supabase/client";
import { createLogger } from "@/lib/logger";
import { autoTakeoverByPhone, autoTakeoverByCustomerId } from "@/lib/whatsapp/auto-takeover";
import { applyTemplate } from "@/hooks/useTemplates";

const logger = createLogger("useMessages");

export interface ChatMessage {
  id: string;
  remoteJid: string;
  remoteJidAlt?: string;
  fromMe: boolean;
  text: string;
  timestamp: number;
  status?: number | string;
  deliveryError?: string | null;
  mediaType?: "image" | "audio" | "video" | "document" | "sticker";
  mediaUrl?: string;
  mediaBase64?: string;
  mediaMimetype?: string;
  mediaCaption?: string;
  fileName?: string;
  /** ID de mídia Whapi (GET /media/{id}) quando não há link público */
  whapiMediaId?: string;
  /** Header/footer/botões de mensagem interactive (Whapi/Evolution). */
  interactiveHeader?: string;
  interactiveFooter?: string;
  interactiveButtons?: { id: string; title: string }[];
}

function normalizeDeliveryStatus(status: unknown): number | "failed" | undefined {
  if (typeof status === "number") return status;
  if (typeof status !== "string") return undefined;
  const s = status.toUpperCase();
  if (["ERROR", "FAILED", "FAILURE", "SEND_ERROR", "UNDELIVERED"].includes(s)) return "failed";
  if (s === "READ" || s === "PLAYED") return 4;
  if (s === "DELIVERY_ACK" || s === "DELIVERED") return 3;
  if (s === "SERVER_ACK" || s === "SENT") return 2;
  if (s === "PENDING") return 1;
  return undefined;
}

function normalizeMessageTimestamp(value: unknown): number {
  const n = typeof value === "string" ? Number(value) : typeof value === "number" ? value : 0;
  if (!Number.isFinite(n) || n <= 0) return 0;
  // Algumas APIs retornam segundos, outras milissegundos. A UI trabalha em segundos.
  return n > 10_000_000_000 ? n / 1000 : n;
}

// O WhatsApp (Baileys/Evolution e Whapi) embrulha muitas mensagens dentro de
// contêineres que escondem o conteúdo real um nível abaixo. Sem abrir esses
// contêineres, `mapMessage` não acha texto nem mídia e a bolha renderiza VAZIA
// (aparece só o horário). Aqui descemos recursivamente até o conteúdo real:
//  - ephemeralMessage           → mensagens temporárias ("some depois")
//  - viewOnceMessage(V2/V2Ext)  → "ver uma vez"
//  - documentWithCaptionMessage → documento com legenda
//  - editedMessage              → mensagem editada
const MESSAGE_WRAPPER_KEYS = [
  "ephemeralMessage",
  "viewOnceMessage",
  "viewOnceMessageV2",
  "viewOnceMessageV2Extension",
  "documentWithCaptionMessage",
  "editedMessage",
] as const;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function unwrapMessageContent(m: any, depth = 0): any {
  if (!m || typeof m !== "object" || depth > 6) return m;
  for (const key of MESSAGE_WRAPPER_KEYS) {
    const inner = m[key]?.message;
    if (inner) return unwrapMessageContent(inner, depth + 1);
  }
  return m;
}

function mapMessage(msg: EvolutionMessage): ChatMessage {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const m = unwrapMessageContent(msg.message) as any;
  let text = "";
  let mediaType: ChatMessage["mediaType"];
  let mediaUrl: string | undefined;
  let mediaBase64: string | undefined;
  let mediaMimetype: string | undefined;
  let mediaCaption: string | undefined;
  let fileName: string | undefined;
  let interactiveHeader: string | undefined;
  let interactiveFooter: string | undefined;
  let interactiveButtons: { id: string; title: string }[] | undefined;
  let whapiMediaId: string | undefined;

  // Interactive/botões ANTES de conversation — o proxy Whapi manda os dois juntos.
  if (m?.buttonsMessage || m?.templateMessage?.hydratedTemplate || m?.interactiveMessage) {
    const bm = m.buttonsMessage || m.interactiveMessage || {};
    const header = String(bm.headerText || bm.header?.title || bm.header?.text || "").trim();
    const body = String(bm.contentText || bm.body?.text || m.conversation || "").trim();
    const footer = String(bm.footerText || bm.footer?.text || "").trim();
    const rawButtons = bm.buttons || bm.nativeFlowMessage?.buttons || [];
    const buttons: { id: string; title: string }[] = (Array.isArray(rawButtons) ? rawButtons : [])
      .map((b: any) => ({
        id: String(b.buttonId || b.id || ""),
        title: String(b.buttonText?.displayText || b.title || b.text || "").trim(),
      }))
      .filter((b: { title: string }) => b.title);
    const hydrated = m.templateMessage?.hydratedTemplate;
    if (hydrated && buttons.length === 0) {
      for (const b of hydrated.hydratedButtons || []) {
        const title = String(b.quickReplyButton?.displayText || "").trim();
        if (title) buttons.push({ id: String(b.quickReplyButton?.id || b.index || ""), title });
      }
    }
    interactiveHeader = header || undefined;
    interactiveFooter = footer || undefined;
    interactiveButtons = buttons.length ? buttons : undefined;
    // Corpo na bolha; header/footer/botões renderizam separados na UI.
    text = body || (!header && !buttons.length ? "Mensagem com botões" : "");
  } else if (m?.conversation) {
    text = m.conversation;
  } else if (m?.extendedTextMessage?.text) {
    text = m.extendedTextMessage.text;
  } else if (m?.imageMessage) {
    mediaType = "image";
    mediaUrl = m.imageMessage.url;
    mediaBase64 = m.imageMessage.base64;
    mediaMimetype = m.imageMessage.mimetype || "image/jpeg";
    mediaCaption = m.imageMessage.caption;
    whapiMediaId = m.imageMessage.mediaId || m.imageMessage.id || undefined;
    text = m.imageMessage.caption || "";
  } else if (m?.videoMessage) {
    mediaType = "video";
    mediaUrl = m.videoMessage.url;
    mediaBase64 = m.videoMessage.base64;
    mediaMimetype = m.videoMessage.mimetype || "video/mp4";
    mediaCaption = m.videoMessage.caption;
    whapiMediaId = m.videoMessage.mediaId || m.videoMessage.id || undefined;
    text = m.videoMessage.caption || "";
  } else if (m?.ptvMessage) {
    mediaType = "video";
    mediaUrl = m.ptvMessage.url;
    mediaBase64 = m.ptvMessage.base64;
    mediaMimetype = m.ptvMessage.mimetype || "video/mp4";
    mediaCaption = m.ptvMessage.caption;
    whapiMediaId = m.ptvMessage.mediaId || m.ptvMessage.id || undefined;
    text = m.ptvMessage.caption || "";
  } else if (m?.audioMessage) {
    mediaType = "audio";
    mediaUrl = m.audioMessage.url;
    mediaBase64 = m.audioMessage.base64;
    mediaMimetype = m.audioMessage.mimetype || "audio/ogg; codecs=opus";
    whapiMediaId = m.audioMessage.mediaId || m.audioMessage.id || undefined;
    text = "";
  } else if (m?.documentMessage) {
    mediaType = "document";
    mediaUrl = m.documentMessage.url;
    mediaBase64 = m.documentMessage.base64;
    mediaMimetype = m.documentMessage.mimetype || "application/pdf";
    fileName = m.documentMessage.fileName;
    whapiMediaId = m.documentMessage.mediaId || m.documentMessage.id || undefined;
    text = m.documentMessage.fileName || "";
  } else if (m?.stickerMessage) {
    mediaType = "sticker";
    mediaUrl = m.stickerMessage.url;
    mediaBase64 = m.stickerMessage.base64;
    mediaMimetype = m.stickerMessage.mimetype || "image/webp";
    whapiMediaId = m.stickerMessage.mediaId || m.stickerMessage.id || undefined;
    text = "";
  } else if (m?.buttonsResponseMessage) {
    text = m.buttonsResponseMessage.selectedDisplayText ||
      m.buttonsResponseMessage.selectedButtonId || "▢ Resposta de botão";
  } else if (m?.templateButtonReplyMessage) {
    text = m.templateButtonReplyMessage.selectedDisplayText ||
      m.templateButtonReplyMessage.selectedId || "▢ Resposta de botão";
  } else if (m?.listResponseMessage) {
    text = m.listResponseMessage.title ||
      m.listResponseMessage.singleSelectReply?.selectedRowId || "▢ Resposta de lista";
  } else if (m?.interactiveResponseMessage) {
    const body = m.interactiveResponseMessage.body?.text;
    text = body || "▢ Resposta interativa";
  } else if (m?.reactionMessage) {
    text = `Reagiu: ${m.reactionMessage.text || "👍"}`;
  } else if (m?.locationMessage) {
    text = "📍 Localização compartilhada";
  } else if (m?.contactMessage || m?.contactsArrayMessage) {
    text = "👤 Contato compartilhado";
  } else if (m?.pollCreationMessage || m?.pollCreationMessageV3) {
    const name = (m.pollCreationMessage || m.pollCreationMessageV3)?.name;
    text = name ? `📊 Enquete: ${name}` : "📊 Enquete";
  } else if (m?.protocolMessage) {
    // Revoke/edit/protocolo do WhatsApp — sem corpo legível; some do chat.
    text = "";
  }
  // Tipos sem mapeamento (ou message: {}): texto fica vazio e a bolha é filtrada.
  // Nunca inventar "📎 Mensagem sem conteúdo legível" — isso polui o chat.

  return {
    id: msg.key.id,
    remoteJid: msg.key.remoteJid,
    remoteJidAlt: msg.key.remoteJidAlt,
    fromMe: msg.key.fromMe,
    text,
    timestamp: normalizeMessageTimestamp(msg.messageTimestamp),
    status: normalizeDeliveryStatus(msg.status),
    mediaType,
    mediaUrl,
    mediaBase64,
    mediaMimetype,
    mediaCaption,
    fileName,
    whapiMediaId,
    interactiveHeader,
    interactiveFooter,
    interactiveButtons,
  };
}

/** Bolha só entra no chat se tiver texto, mídia ou botões. */
function hasRenderableContent(m: ChatMessage): boolean {
  if (m.mediaType) return true;
  if (m.interactiveButtons && m.interactiveButtons.length > 0) return true;
  if (m.interactiveHeader?.trim() || m.interactiveFooter?.trim()) return true;
  const t = (m.text || "").trim();
  if (!t) return false;
  // Placeholders legados — nunca mostrar de novo.
  if (
    t === "📎 Mensagem sem conteúdo legível" ||
    t === "📎 Mensagem não suportada neste formato" ||
    t === "Mensagem sem texto legível"
  ) {
    return false;
  }
  return true;
}

const PAGE_SIZE = 200;

/**
 * Ao enviar mensagem a um lead: se ainda não tem parceiro e o consultor tem
 * exatamente 1 campanha com pool ativa, atribui via rodízio + protocolo + aviso.
 * Nunca chuta entre 2+ campanhas. Não bloqueia o envio se falhar.
 */
async function ensureLeadPartnerLink(
  customerId: string,
  consultantId?: string | null,
): Promise<void> {
  try {
    const { data: cust } = await supabase
      .from("customers")
      .select("id, consultant_id, referral_partner_id, tracking_protocol, source_campaign_id")
      .eq("id", customerId)
      .maybeSingle();
    if (!cust) return;

    // Já vinculado a parceiro + protocolo → nada a fazer
    if ((cust as any).referral_partner_id && (cust as any).tracking_protocol) return;

    const ownerId = String((cust as any).consultant_id || consultantId || "");
    if (!ownerId) return;

    // Já tem parceiro, falta protocolo
    if ((cust as any).referral_partner_id && !(cust as any).tracking_protocol) {
      const partnerId = (cust as any).referral_partner_id as string;
      const { data: prow } = await supabase
        .from("referral_partners")
        .select("nome, short_code")
        .eq("id", partnerId)
        .maybeSingle();
      const initials = String((prow as any)?.short_code || (prow as any)?.nome || "IGR").slice(0, 6);
      const { data: protocol } = await supabase.rpc("generate_partner_protocol", {
        _partner_id: partnerId,
        _initials: initials,
      });
      if (protocol) {
        await supabase
          .from("customers")
          .update({ tracking_protocol: String(protocol) })
          .eq("id", customerId)
          .is("tracking_protocol", null);
      }
      return;
    }

    // Sem parceiro: só auto-atribui com 1 campanha/pool ativa (ou campanha já no lead)
    // Se o consultor acabou de editar origem manualmente (campanha / sem origem),
    // NÃO rearmar rodízio+notify — isso quebraria o "sem aviso ao parceiro".
    const { data: manualOriginLogs } = await supabase
      .from("campaign_match_log")
      .select("rodizio_outcome, created_at")
      .eq("customer_id", customerId)
      .eq("method", "manual_origin_edit")
      .order("created_at", { ascending: false })
      .limit(1);
    const lastManual = (manualOriginLogs as { rodizio_outcome?: string | null }[] | null)?.[0];
    if (
      lastManual?.rodizio_outcome === "campaign" ||
      lastManual?.rodizio_outcome === "none"
    ) {
      return;
    }

    let campaignId = (cust as any).source_campaign_id as string | null;
    if (!campaignId) {
      const { data: pools } = await supabase
        .from("rodizio_pools")
        .select("campaign_id, facebook_campaigns!inner(id, status)")
        .eq("consultant_id", ownerId)
        .eq("is_active", true);
      const active = ((pools || []) as any[]).filter((p) => {
        const st = p.facebook_campaigns?.status;
        return st === "active" || st === "pending_review";
      });
      const unique = [...new Set(active.map((p) => String(p.campaign_id)).filter(Boolean))];
      if (unique.length !== 1) return;
      campaignId = unique[0];
    }

    const { data: assignRows, error: assignError } = await supabase.rpc("rodizio_assign_lead", {
      p_customer_id: customerId,
      p_campaign_id: campaignId,
    });
    if (assignError) return;
    const row = Array.isArray(assignRows) ? assignRows[0] : assignRows;
    const outcome = (row as any)?.outcome as string | undefined;
    const partnerId = (row as any)?.partner_id as string | undefined;
    if (outcome !== "assigned" || !partnerId) return;

    // Protocolo + aviso ao parceiro (edge já valida ownership / ativo)
    await supabase.functions.invoke("assign-lead-manual", {
      body: { customer_id: customerId, partner_id: partnerId },
    });
  } catch (e) {
    logger.warn("ensureLeadPartnerLink falhou (não bloqueia envio):", e);
  }
}

export function useMessages(
  instanceName: string | null,
  remoteJid: string | null,
  preferredSendTargetJid: string | null = null,
  isWhapi: boolean = false,
  customerId: string | null = null,
  consultantId: string | null = null,
) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [hasMoreOlder, setHasMoreOlder] = useState(true);
  const [resolvedSendTargetJid, setResolvedSendTargetJid] = useState<string | null>(
    preferredSendTargetJid
  );
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fetchingRef = useRef(false);
  const loadingOlderRef = useRef(false);
  const offsetRef = useRef(0);
  const lastReadIdRef = useRef<string | null>(null);
  const clearedAtRef = useRef<number>(0);

  useEffect(() => {
    setResolvedSendTargetJid(preferredSendTargetJid || null);
  }, [preferredSendTargetJid, remoteJid]);

  // Reset when chat changes
  useEffect(() => {
    lastReadIdRef.current = null;
    clearedAtRef.current = 0;
    offsetRef.current = 0;
    setHasMoreOlder(true);
    setIsLoadingOlder(false);
  }, [remoteJid]);

  /** Ordenação canônica do chat: antigo → recente. Nunca depende da ordem da API. */
  const sortMapped = useCallback((unique: EvolutionMessage[]) => {
    const clearedAtMs = clearedAtRef.current;
    return unique
      .map((msg) => mapMessage(msg))
      .filter((m) => hasRenderableContent(m))
      .filter((m) => clearedAtMs === 0 || m.timestamp * 1000 >= clearedAtMs)
      .sort((a, b) => {
        if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
        // Empate de segundo: id estável (evita inverter ao mesclar JIDs / páginas).
        return String(a.id || "").localeCompare(String(b.id || ""));
      });
  }, []);

  const fetchMessages = useCallback(async (opts?: { force?: boolean }) => {
    if (!remoteJid) return;
    if (!isWhapi && !instanceName) return;
    // Aba oculta: não gasta CPU/rede; visibilitychange força ao voltar.
    if (typeof document !== "undefined" && document.hidden && !opts?.force) return;
    if (fetchingRef.current) return;
    fetchingRef.current = true;

    try {
      setIsLoading((prev) => (!prev ? true : prev));
      const altJid = preferredSendTargetJid || resolvedSendTargetJid;
      const phoneCandidates = new Set<string>();
      const rawFromJid = remoteJid.split("@")[0].replace(/\D/g, "");
      const rawFromAlt = altJid?.split("@")[0].replace(/\D/g, "") || "";
      if (rawFromJid) phoneCandidates.add(rawFromJid);
      if (rawFromAlt) phoneCandidates.add(rawFromAlt);
      const normalized = normalizeBrazilPhone(rawFromAlt || rawFromJid);
      if (normalized) phoneCandidates.add(normalized);

      // Página 0 (mais recentes). Histórico antigo vem via loadOlderMessages.
      const [raw, clearedRow] = await Promise.all([
        isWhapi
          ? whapiListMessagesForChat(remoteJid, altJid, PAGE_SIZE, 0)
          : findMessagesForChat(instanceName!, remoteJid, altJid, PAGE_SIZE),
        phoneCandidates.size > 0
          ? supabase
              .from("customers")
              .select("chat_cleared_at")
              .in("phone_whatsapp", Array.from(phoneCandidates))
              .order("updated_at", { ascending: false })
              .limit(1)
              .maybeSingle()
          : Promise.resolve({ data: null }),
      ]);

      const clearedAtMs = clearedRow.data?.chat_cleared_at
        ? new Date(clearedRow.data.chat_cleared_at).getTime()
        : 0;
      clearedAtRef.current = clearedAtMs;

      const seen = new Set<string>();
      const unique = (Array.isArray(raw) ? raw : []).filter((msg) => {
        const id = msg.key?.id;
        if (!id || seen.has(id)) return false;
        seen.add(id);
        return true;
      });

      const mapped = sortMapped(unique);

      // Se a 1ª página veio cheia, ainda pode haver histórico antigo.
      if (offsetRef.current === 0) {
        setHasMoreOlder(unique.length >= PAGE_SIZE);
        offsetRef.current = unique.length;
      }

      setMessages((prev) => {
        const byId = new Map<string, ChatMessage>();
        // Mantém histórico antigo já carregado (offset > 0) + otimistas
        for (const m of prev) {
          if (m.id.startsWith("temp-")) {
            byId.set(m.id, m);
            continue;
          }
          // Mensagens mais antigas que a janela atual (já paginadas)
          const inFresh = mapped.some((x) => x.id === m.id);
          if (!inFresh) byId.set(m.id, m);
        }
        for (const m of mapped) {
          const prevMsg = byId.get(m.id) || prev.find((p) => p.id === m.id);
          // Preserva data: / base64 já baixados — o poll Whapi devolve URL Wasabi
          // de novo e apagava o cache, gerando loop "Carregando imagem...".
          if (prevMsg && (prevMsg.mediaUrl?.startsWith("data:") || prevMsg.mediaBase64)) {
            byId.set(m.id, {
              ...m,
              mediaUrl: prevMsg.mediaUrl?.startsWith("data:") ? prevMsg.mediaUrl : m.mediaUrl,
              mediaBase64: prevMsg.mediaBase64 || m.mediaBase64,
              mediaMimetype: prevMsg.mediaMimetype || m.mediaMimetype,
            });
          } else {
            byId.set(m.id, m);
          }
        }
        // Limpa otimistas expirados / cleared / bolhas sem conteúdo
        const merged = Array.from(byId.values()).filter((m) => {
          if (clearedAtMs > 0 && m.timestamp * 1000 < clearedAtMs) return false;
          if (m.id.startsWith("temp-")) {
            return Date.now() - m.timestamp * 1000 < 60_000;
          }
          return hasRenderableContent(m);
        });
        const next = merged.sort((a, b) => {
          if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
          return String(a.id || "").localeCompare(String(b.id || ""));
        });
        // Evita novo array a cada poll de 6s quando nada mudou — isso rearmava
        // virtualizer/ResizeObserver e fazia o chat “pular” sem mensagem nova.
        if (
          prev.length === next.length &&
          prev.every((m, i) => {
            const n = next[i]!;
            return (
              m.id === n.id &&
              m.text === n.text &&
              m.status === n.status &&
              m.mediaUrl === n.mediaUrl &&
              m.mediaBase64 === n.mediaBase64 &&
              m.deliveryError === n.deliveryError
            );
          })
        ) {
          return prev;
        }
        return next;
      });

      const fallbackSendTarget = raw.find((msg) => msg.key.remoteJidAlt)?.key.remoteJidAlt;
      if (fallbackSendTarget) {
        setResolvedSendTargetJid((prev) => prev || fallbackSendTarget);
      }

      const lastIncoming = [...mapped].reverse().find((m) => !m.fromMe);
      if (!isWhapi && lastIncoming && lastIncoming.id !== lastReadIdRef.current && instanceName) {
        lastReadIdRef.current = lastIncoming.id;
        try {
          await markAsRead(instanceName, remoteJid, lastIncoming.id, false);
        } catch {
          // ignore
        }
      }
    } catch {
      // ignore polling errors
    } finally {
      fetchingRef.current = false;
      setIsLoading(false);
    }
  }, [instanceName, remoteJid, preferredSendTargetJid, resolvedSendTargetJid, isWhapi, sortMapped]);

  /** Carrega mensagens mais antigas (scroll pra cima). Preserva posição do scroll. */
  const loadOlderMessages = useCallback(async (): Promise<number> => {
    if (!remoteJid || !isWhapi) return 0;
    if (!hasMoreOlder || loadingOlderRef.current) return 0;
    loadingOlderRef.current = true;
    setIsLoadingOlder(true);
    try {
      const altJid = preferredSendTargetJid || resolvedSendTargetJid;
      const offset = offsetRef.current;
      const raw = await whapiListMessagesForChat(remoteJid, altJid, PAGE_SIZE, offset);
      const seen = new Set<string>();
      const unique = (Array.isArray(raw) ? raw : []).filter((msg) => {
        const id = msg.key?.id;
        if (!id || seen.has(id)) return false;
        seen.add(id);
        return true;
      });

      if (unique.length < PAGE_SIZE) setHasMoreOlder(false);
      offsetRef.current = offset + unique.length;

      const mapped = sortMapped(unique);
      let added = 0;
      setMessages((prev) => {
        const byId = new Map(prev.map((m) => [m.id, m]));
        for (const m of mapped) {
          if (!byId.has(m.id)) {
            byId.set(m.id, m);
            added += 1;
          }
        }
        return Array.from(byId.values()).sort((a, b) => {
          if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
          return String(a.id || "").localeCompare(String(b.id || ""));
        });
      });
      return added;
    } catch (e) {
      logger.warn("loadOlderMessages falhou:", e);
      return 0;
    } finally {
      loadingOlderRef.current = false;
      setIsLoadingOlder(false);
    }
  }, [remoteJid, isWhapi, hasMoreOlder, preferredSendTargetJid, resolvedSendTargetJid, sortMapped]);

  useEffect(() => {
    setMessages([]);
    offsetRef.current = 0;
    setHasMoreOlder(true);
    fetchMessages({ force: true });
    if (!remoteJid) return;
    if (!isWhapi && !instanceName) return;

    const startPolling = () => {
      if (intervalRef.current) return;
      // Polling de segurança a cada 6s (antes 20s). O realtime abaixo cobre o
      // caso comum (mensagem nova chega na hora); o polling garante consistencia
      // se o realtime falhar/cair.
      intervalRef.current = setInterval(() => {
        if (typeof document !== "undefined" && document.hidden) return;
        void fetchMessages();
      }, 6000);
    };
    const stopPolling = () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
    startPolling();

    // Realtime: assina a tabela `conversations`. Filtra pelo customer do chat
    // aberto quando conhecido; senão aceita qualquer INSERT (comportamento antigo).
    // Debounce de 700ms evita rajada de refetches. Skip se aba oculta.
    const phoneKey = remoteJid.split("@")[0];
    let debounceId: ReturnType<typeof setTimeout> | null = null;
    const channel = supabase
      .channel(`chat-conv-${phoneKey}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "conversations" },
        (payload) => {
          if (typeof document !== "undefined" && document.hidden) return;
          const row = payload.new as { customer_id?: string };
          if (customerId && row?.customer_id && row.customer_id !== customerId) return;
          if (debounceId) clearTimeout(debounceId);
          debounceId = setTimeout(() => { void fetchMessages(); }, 700);
        },
      )
      .subscribe();

    const onVisibility = () => {
      if (document.hidden) stopPolling();
      else { void fetchMessages({ force: true }); startPolling(); }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      stopPolling();
      if (debounceId) clearTimeout(debounceId);
      supabase.removeChannel(channel);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [fetchMessages, instanceName, remoteJid, isWhapi, customerId]);

  const resolveSendTargetJid = useCallback(async () => {
    const initialTarget = resolvedSendTargetJid || preferredSendTargetJid || remoteJid;
    if (!initialTarget) return null;

    if (!initialTarget.endsWith("@lid")) {
      return initialTarget;
    }

    const altFromState = messages.find((m) => m.remoteJidAlt?.endsWith("@s.whatsapp.net"))?.remoteJidAlt;
    if (altFromState) {
      setResolvedSendTargetJid(altFromState);
      return altFromState;
    }

    if (!isWhapi && instanceName && remoteJid) {
      try {
        const latest = await findMessages(instanceName, remoteJid, 20);
        const altFromLatest = latest.find((m) => m.key.remoteJidAlt?.endsWith("@s.whatsapp.net"))?.key.remoteJidAlt;
        if (altFromLatest) {
          setResolvedSendTargetJid(altFromLatest);
          return altFromLatest;
        }
      } catch {
        // ignore
      }
    }

    return initialTarget;
  }, [instanceName, messages, preferredSendTargetJid, remoteJid, resolvedSendTargetJid, isWhapi]);

  const loadMedia = useCallback(
    async (messageId: string) => {
      const msg = messages.find((m) => m.id === messageId);
      if (!msg) return null;
      // Skip if already loaded
      if (msg.mediaUrl?.startsWith("data:")) return msg.mediaUrl;

      if (isWhapi) {
        // Sempre proxy: URLs Wasabi/CDN WhatsApp quebram no <img> (403) e no
        // fetch do browser (CORS) — nunca devolver http cru como "pronto".
        const dl = await whapiDownloadMedia({
          url: msg.mediaUrl && /^https?:\/\//i.test(msg.mediaUrl) ? msg.mediaUrl : "",
          mediaId: msg.whapiMediaId,
        });
        if (dl?.base64) {
          const mimetype = dl.mimetype || msg.mediaMimetype || "image/webp";
          const dataUrl = `data:${mimetype};base64,${dl.base64}`;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === messageId
                ? { ...m, mediaBase64: dl.base64, mediaMimetype: mimetype, mediaUrl: dataUrl }
                : m
            )
          );
          return dataUrl;
        }
        // data: já tratado acima; http cru sem proxy = inutilizável no attach
        if (msg.mediaUrl?.startsWith("data:")) return msg.mediaUrl;
        return null;
      }

      if (!instanceName) return null;

      const result = await getBase64FromMediaMessage(
        instanceName,
        messageId,
        msg.remoteJid,
        msg.fromMe
      );
      if (result?.base64) {
        const mimetype = result.mimetype || msg.mediaMimetype || "application/octet-stream";
        const dataUrl = `data:${mimetype};base64,${result.base64}`;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === messageId
              ? { ...m, mediaBase64: result.base64, mediaMimetype: mimetype, mediaUrl: dataUrl }
              : m
          )
        );
        return dataUrl;
      }
      return null;
    },
    [instanceName, messages, isWhapi]
  );

  const sendMessage = useCallback(
    async (text: string, phoneOverride?: string | null) => {
      if (!remoteJid || (!isWhapi && !instanceName)) {
        logger.error("sendMessage: missing instanceName or remoteJid", { instanceName, remoteJid });
        // Antes retornava mudo aqui: o consultor mandava "oi" e nada acontecia,
        // sem toast nem motivo. Agora lançamos para que o ChatView mostre o
        // toast de erro e o composer preserve o texto digitado.
        throw new Error(
          !remoteJid
            ? "Conversa sem destinatário válido. Reabra a conversa e tente de novo."
            : "WhatsApp não está conectado. Conecte o número e tente de novo.",
        );
      }

      logger.debug("sendMessage called", { text: text.slice(0, 50), remoteJid, preferredSendTargetJid, resolvedSendTargetJid, phoneOverride });

      // Destinatário: prioriza o telefone real do cliente (mesma fonte do bot,
      // `customers.phone_whatsapp`). Sem ele, cai no JID resolvido. Conversas com
      // remoteJid `@lid` (ID criptografado) não carregam telefone no JID; mandar
      // o `@lid` cru pra Evolution fazia o envio manual de texto falhar enquanto
      // o fluxo (que usa phone_whatsapp) funcionava.
      let recipient: string;
      if (phoneOverride) {
        recipient = phoneOverride;
      } else {
        const targetJid = await resolveSendTargetJid();
        if (!targetJid) {
          logger.error("resolveSendTargetJid returned null");
          throw new Error("Destinatário inválido para envio");
        }
        recipient = resolveRecipient(targetJid);
      }

      // Renderiza variáveis de template ({{nome}}, {{first_name}}, {{valor_conta}}…)
      // no envio manual. Antes, uma "resposta rápida" com {{first_name}} ia LITERAL
      // para o cliente ("Oi {{first_name}}"), pois este caminho não passava pelo
      // render (só os painéis de disparo em massa renderizavam). Só busca o cliente
      // quando há placeholder, para não pesar o envio comum.
      let outgoingText = text;
      if (customerId && /\{/.test(text)) {
        try {
          const { data: cust } = await supabase
            .from("customers")
            .select("name, electricity_bill_value")
            .eq("id", customerId)
            .maybeSingle();
          if (cust) {
            outgoingText = applyTemplate(
              { id: "", consultant_id: "", name: "", content: text, media_type: "text", media_url: null, image_url: null, created_at: "" },
              { name: (cust as { name?: string }).name || "", electricity_bill_value: (cust as { electricity_bill_value?: number }).electricity_bill_value },
            );
          }
        } catch (e) {
          logger.warn("render template vars falhou (enviando texto cru):", e);
        }
      }

      logger.debug("sending to:", recipient, "instance:", instanceName, "text:", outgoingText.slice(0, 50));

      // Auto-takeover ANTES do envio: silencia o bot e corta reply atrasado.
      try {
        if (customerId) {
          await autoTakeoverByCustomerId(customerId, "humano_assumiu");
        } else {
          await autoTakeoverByPhone(recipient, "humano_assumiu");
        }
      } catch (e) {
        logger.warn("auto-takeover error (não bloqueia envio):", e);
      }

      try {
        const result = await sendWhatsAppMessage({
          instanceName: instanceName || "",
          phone: recipient,
          mediaCategory: "text",
          text: outgoingText,
          isWhapi,
          customerId,
          conversationStep: "consultor_manual",
          intent: isWhapi ? "reply" : undefined,
        });

        if (result.status === "failed") {
          throw new Error(result.error || "Falha no envio");
        }

        const isPending = result.status === "pending" || result.status === "timeout";
        if (isPending) {
          logger.warn("message send pending confirmation", { recipient, remoteJid, status: result.status });
        } else {
          logger.debug("message sent successfully", { messageId: result.messageId });
        }

        // Vínculo consultor + parceiro do rodízio (quando seguro) + protocolo
        if (customerId) {
          ensureLeadPartnerLink(customerId, consultantId).catch(() => null);
        }

        // Status WhatsApp: 1 = pendente (✓), 2 = entregue ao servidor (✓✓).
        // Quando Evolution devolve PENDING, mantemos status=1 (um check) até
        // o webhook real confirmar entrega.
        const optimisticId = result.messageId || `temp-${Date.now()}`;
        setMessages((prev) => [
          ...prev,
          {
            id: optimisticId,
            remoteJid,
            fromMe: true,
            text: outgoingText,
            timestamp: Date.now() / 1000,
            status: 1,
          },
        ]);

        // Confirmação assíncrona: após 6s, busca histórico da Evolution e
        // atualiza o status da bolha se a mensagem foi de fato confirmada
        // (status >= 2) ou se sumiu (provavelmente não entregue).
        if (result.messageId && !isWhapi && instanceName) {
          const mid = result.messageId;
          setTimeout(async () => {
            try {
              const latest = await findMessages(instanceName, remoteJid, 30);
              const found = latest.find((m) => m.key?.id === mid);
              if (found && typeof found.status === "number" && found.status >= 2) {
                setMessages((prev) =>
                  prev.map((m) => (m.id === mid ? { ...m, status: found.status } : m))
                );
              }
            } catch {
              // best-effort
            }
          }, 6000);
        }

      } catch (err) {
        logger.error("sendMessage error:", err);
        throw err;
      }
    },
    [instanceName, remoteJid, resolveSendTargetJid, isWhapi, customerId, consultantId]
  );

  return {
    messages,
    isLoading,
    isLoadingOlder,
    hasMoreOlder,
    loadOlderMessages,
    sendMessage,
    loadMedia,
    refetch: fetchMessages,
    resolveSendTargetJid,
  };
}
