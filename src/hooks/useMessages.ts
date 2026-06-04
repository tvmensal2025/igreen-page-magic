import { useState, useEffect, useCallback, useRef } from "react";
import {
  findMessages,
  markAsRead,
  getBase64FromMediaMessage,
  type EvolutionMessage,
} from "@/services/evolutionApi";
import { whapiListMessages } from "@/services/whapiApi";
import { sendWhatsAppMessage, resolveRecipient } from "@/services/messageSender";
import { supabase } from "@/integrations/supabase/client";
import { createLogger } from "@/lib/logger";
import { autoTakeoverByPhone } from "@/lib/whatsapp/auto-takeover";

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

function mapMessage(msg: EvolutionMessage): ChatMessage {
  const m = msg.message;
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
      const phone = remoteJid.split("@")[0];
      const [raw, clearedRow] = await Promise.all([
        isWhapi
          ? whapiListMessages(remoteJid, 50)
          : findMessages(instanceName!, remoteJid, 50),
        supabase
          .from("customers")
          .select("chat_cleared_at")
          .eq("phone_whatsapp", phone)
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
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

      const firstTs = normalizeMessageTimestamp(unique[0]?.messageTimestamp);
      const lastTs = normalizeMessageTimestamp(unique[unique.length - 1]?.messageTimestamp);
      const newestFirst = firstTs >= lastTs;

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
  }, [instanceName, remoteJid, isWhapi]);

  useEffect(() => {
    setMessages([]);
    fetchMessages();
    if (!remoteJid) return;
    if (!isWhapi && !instanceName) return;

    const startPolling = () => {
      if (intervalRef.current) return;
      intervalRef.current = setInterval(fetchMessages, 20000);
    };
    const stopPolling = () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
    startPolling();

    const onVisibility = () => {
      if (document.hidden) stopPolling();
      else { fetchMessages(); startPolling(); }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      stopPolling();
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
    async (text: string) => {
      if (!remoteJid || (!isWhapi && !instanceName)) {
        logger.error("sendMessage: missing instanceName or remoteJid", { instanceName, remoteJid });
        return;
      }

      logger.debug("sendMessage called", { text: text.slice(0, 50), remoteJid, preferredSendTargetJid, resolvedSendTargetJid });

      const targetJid = await resolveSendTargetJid();
      if (!targetJid) {
        logger.error("resolveSendTargetJid returned null");
        throw new Error("Destinatário inválido para envio");
      }

      const recipient = resolveRecipient(targetJid);

      logger.debug("sending to:", recipient, "targetJid:", targetJid, "instance:", instanceName, "text:", text.slice(0, 50));

      try {
        const result = await sendWhatsAppMessage({
          instanceName: instanceName || "",
          phone: recipient,
          mediaCategory: "text",
          text,
          isWhapi,
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
            text,
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
    [instanceName, remoteJid, resolveSendTargetJid, isWhapi]
  );

  return { messages, isLoading, sendMessage, loadMedia, refetch: fetchMessages, resolveSendTargetJid };
}
