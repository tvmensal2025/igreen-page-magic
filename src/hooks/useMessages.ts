import { useState, useEffect, useCallback, useRef } from "react";
import {
  findMessages,
  findMessagesForChat,
  markAsRead,
  getBase64FromMediaMessage,
  type EvolutionMessage,
} from "@/services/evolutionApi";
import { whapiListMessages, whapiListMessagesForChat } from "@/services/whapiApi";
import { sendWhatsAppMessage, resolveRecipient, normalizeBrazilPhone } from "@/services/messageSender";
import { supabase } from "@/integrations/supabase/client";
import { createLogger } from "@/lib/logger";
import { autoTakeoverByPhone } from "@/lib/whatsapp/auto-takeover";
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

  if (m?.conversation) {
    text = m.conversation;
  } else if (m?.extendedTextMessage?.text) {
    text = m.extendedTextMessage.text;
  } else if (m?.imageMessage) {
    mediaType = "image";
    mediaUrl = m.imageMessage.url;
    mediaBase64 = m.imageMessage.base64;
    mediaMimetype = m.imageMessage.mimetype || "image/jpeg";
    mediaCaption = m.imageMessage.caption;
    text = m.imageMessage.caption || "";
  } else if (m?.videoMessage) {
    mediaType = "video";
    mediaUrl = m.videoMessage.url;
    mediaBase64 = m.videoMessage.base64;
    mediaMimetype = m.videoMessage.mimetype || "video/mp4";
    mediaCaption = m.videoMessage.caption;
    text = m.videoMessage.caption || "";
  } else if (m?.ptvMessage) {
    // Vídeo redondo ("video note") — mesma estrutura do videoMessage.
    mediaType = "video";
    mediaUrl = m.ptvMessage.url;
    mediaBase64 = m.ptvMessage.base64;
    mediaMimetype = m.ptvMessage.mimetype || "video/mp4";
    mediaCaption = m.ptvMessage.caption;
    text = m.ptvMessage.caption || "";
  } else if (m?.audioMessage) {
    mediaType = "audio";
    mediaUrl = m.audioMessage.url;
    mediaBase64 = m.audioMessage.base64;
    mediaMimetype = m.audioMessage.mimetype || "audio/ogg; codecs=opus";
    text = "";
  } else if (m?.documentMessage) {
    mediaType = "document";
    mediaUrl = m.documentMessage.url;
    mediaBase64 = m.documentMessage.base64;
    mediaMimetype = m.documentMessage.mimetype || "application/pdf";
    fileName = m.documentMessage.fileName;
    text = m.documentMessage.fileName || "";
  } else if (m?.stickerMessage) {
    mediaType = "sticker";
    mediaUrl = m.stickerMessage.url;
    mediaBase64 = m.stickerMessage.base64;
    mediaMimetype = m.stickerMessage.mimetype || "image/webp";
    text = "";
  } else {
    // Fallback: tipo de mensagem não suportado (localização, contato, enquete,
    // botões, reação etc.). Antes a bolha aparecia totalmente vazia — só o
    // horário —, dando a impressão de que a mensagem "não chegou". Agora ao
    // menos mostramos um rótulo curto pra confirmar que a mensagem existe.
    const inferred = m && typeof m === "object" ? Object.keys(m)[0] : undefined;
    if (inferred && inferred !== "messageContextInfo") {
      text = "📎 Mensagem não suportada neste formato";
    }
  }

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
  };
}

export function useMessages(
  instanceName: string | null,
  remoteJid: string | null,
  preferredSendTargetJid: string | null = null,
  isWhapi: boolean = false,
  customerId: string | null = null,
) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [resolvedSendTargetJid, setResolvedSendTargetJid] = useState<string | null>(
    preferredSendTargetJid
  );
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fetchingRef = useRef(false);
  const lastReadIdRef = useRef<string | null>(null);
  const clearedAtRef = useRef<number>(0);

  useEffect(() => {
    setResolvedSendTargetJid(preferredSendTargetJid || null);
  }, [preferredSendTargetJid, remoteJid]);

  // Reset lastReadId when chat changes
  useEffect(() => {
    lastReadIdRef.current = null;
    clearedAtRef.current = 0;
  }, [remoteJid]);

  const fetchMessages = useCallback(async () => {
    if (!remoteJid) return;
    if (!isWhapi && !instanceName) return;
    // Prevent overlapping fetches
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

      const [raw, clearedRow] = await Promise.all([
        isWhapi
          ? whapiListMessagesForChat(remoteJid, altJid, 50)
          : findMessagesForChat(instanceName!, remoteJid, altJid, 50),
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

      // Deduplicate by message id
      const seen = new Set<string>();
      const unique = (Array.isArray(raw) ? raw : []).filter((msg) => {
        const id = msg.key?.id;
        if (!id || seen.has(id)) return false;
        seen.add(id);
        return true;
      });

      // Detecta a direção do feed bruto comparando o PRIMEIRO PAR de timestamps
      // DIFERENTES (não só os extremos). Comparar apenas first/last falha quando
      // o lead manda várias mensagens no mesmo segundo: nesse caso firstTs===lastTs
      // e o desempate ficava imprevisível, fazendo uma msg nova aparecer acima de
      // uma anterior. Varrendo o primeiro par distinto, a direção é confiável mesmo
      // com blocos de mensagens no mesmo segundo. Default newest-first (padrão
      // Evolution/Whapi) quando todos os timestamps são iguais.
      let newestFirst = true;
      for (let i = 0; i < unique.length - 1; i++) {
        const a = normalizeMessageTimestamp(unique[i]?.messageTimestamp);
        const b = normalizeMessageTimestamp(unique[i + 1]?.messageTimestamp);
        if (a !== b) { newestFirst = a > b; break; }
      }

      const mapped = unique
        .map((msg, sourceIndex) => ({ ...mapMessage(msg), sourceIndex }))
        .filter((m) => clearedAtMs === 0 || m.timestamp * 1000 >= clearedAtMs)
        .sort((a, b) => {
          if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
          // Mesmo segundo: render final é oldest-first, então o desempate respeita
          // a direção em que o provedor entregou o feed bruto.
          return newestFirst ? b.sourceIndex - a.sourceIndex : a.sourceIndex - b.sourceIndex;
        })
        .map(({ sourceIndex: _sourceIndex, ...m }) => m);
      setMessages(mapped);


      const fallbackSendTarget = raw.find((msg) => msg.key.remoteJidAlt)?.key.remoteJidAlt;
      if (fallbackSendTarget) {
        setResolvedSendTargetJid((prev) => prev || fallbackSendTarget);
      }

      // Only markAsRead if there's a NEW inbound message we haven't marked yet
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
  }, [instanceName, remoteJid, preferredSendTargetJid, resolvedSendTargetJid, isWhapi]);

  useEffect(() => {
    setMessages([]);
    fetchMessages();
    if (!remoteJid) return;
    if (!isWhapi && !instanceName) return;

    const startPolling = () => {
      if (intervalRef.current) return;
      // Polling de segurança a cada 6s (antes 20s). O realtime abaixo cobre o
      // caso comum (mensagem nova chega na hora); o polling garante consistencia
      // se o realtime falhar/cair.
      intervalRef.current = setInterval(fetchMessages, 6000);
    };
    const stopPolling = () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
    startPolling();

    // Realtime: assina a tabela `conversations`. Qualquer mensagem gravada
    // (inbound do cliente OU outbound do painel/bot) agenda um refetch do chat
    // aberto — as mensagens aparecem quase na hora, sem esperar os 6s.
    // Debounce de 700ms evita rajada de refetches quando chegam varias linhas
    // juntas. Nome de canal estavel por telefone + cleanup (boa pratica Supabase).
    const phoneKey = remoteJid.split("@")[0];
    let debounceId: ReturnType<typeof setTimeout> | null = null;
    const channel = supabase
      .channel(`chat-conv-${phoneKey}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "conversations" },
        () => {
          if (debounceId) clearTimeout(debounceId);
          debounceId = setTimeout(() => { fetchMessages(); }, 700);
        },
      )
      .subscribe();

    const onVisibility = () => {
      if (document.hidden) stopPolling();
      else { fetchMessages(); startPolling(); }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      stopPolling();
      if (debounceId) clearTimeout(debounceId);
      supabase.removeChannel(channel);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [fetchMessages, instanceName, remoteJid, isWhapi]);

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
      // Whapi já entrega a URL pública diretamente — não há getBase64
      if (isWhapi) return msg.mediaUrl || null;
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

      try {
        const result = await sendWhatsAppMessage({
          instanceName: instanceName || "",
          phone: recipient,
          mediaCategory: "text",
          text: outgoingText,
          isWhapi,
          customerId,
          conversationStep: "consultor_manual",
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

        // Auto-takeover: ao consultor enviar manualmente, assume o controle
        // e silencia o bot até "Devolver para o passo" via UI.
        try {
          await autoTakeoverByPhone(recipient, "humano_assumiu");
        } catch (e) {
          logger.warn("auto-takeover error (não bloqueia envio):", e);
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
    [instanceName, remoteJid, resolveSendTargetJid, isWhapi, customerId]
  );

  return { messages, isLoading, sendMessage, loadMedia, refetch: fetchMessages, resolveSendTargetJid };
}
