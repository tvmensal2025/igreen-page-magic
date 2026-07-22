// Channel adapter — interfaces canônicas (Phase A da spec
// whatsapp-flow-architecture-v3, Task 4).
//
// Cada provedor (Evolution, Whapi) implementa `ChannelAdapter`. O motor
// (`flow-engine/`) e o dispatcher consomem essa interface — não conhecem
// os internals do provedor. Capabilities são **estáticas e declaradas** —
// nada de "tenta e cai" em runtime espalhado pelo código de negócio. Se
// um provedor quiser fallback automático em runtime (ex: botão → texto
// numerado quando a Evolution falha), isso fica **dentro do adapter** e
// emite log `kind="channel_choice_downgrade"`.
//
// Toda função do adapter retorna `Result` ou nunca lança. Adapter é a
// borda externa — protege o core de erros de rede e formatos de payload.

export type ChannelKind = "whapi" | "evolution";

export interface ChannelCapabilities {
  channel: ChannelKind;
  /** Provedor suporta botões interativos (quick reply) confiavelmente. */
  supportsButtons: boolean;
  /** Quantidade máxima de botões em uma única mensagem. */
  maxButtons: number;
  /** Provedor suporta List Messages (lista interativa do WhatsApp). */
  supportsList: boolean;
  /** Provedor envia áudios (PTT/voice notes). */
  supportsAudio: boolean;
  /** Provedor envia vídeos. */
  supportsVideo: boolean;
  /** Provedor expõe presence "digitando…" / "gravando…". */
  supportsTypingPresence: boolean;
  /** Provedor envia reações (emoji em mensagens). */
  supportsReactions: boolean;
  /** Campo do payload inbound que contém o ID da mensagem. */
  inboundIdField: "messageId" | "wa_id";
}

/**
 * Mensagem inbound já normalizada por `parseInbound`. Forma única
 * independente do canal — webhook/router/engine consomem só isso.
 */
export interface ParsedMessage {
  channel: ChannelKind;
  instanceName: string;
  /** Sempre "5511...@s.whatsapp.net" no formato canônico. */
  remoteJid: string;
  phone: string;
  messageId: string;
  /** True quando vem de mensagem fora do escopo (grupo, self, status). */
  ignored: boolean;
  isFromMe: boolean;
  messageText: string;
  /** ID puro do botão clicado pelo cliente — sem prefixo de protocolo. */
  buttonId: string | null;
  /** Texto cru "1"/"2" digitado em resposta a uma lista numerada. */
  rawNumberReply: string | null;
  hasMedia: boolean;
  mediaKind: "image" | "audio" | "video" | "document" | null;
  /** Payload original do provedor — handlers especiais (OCR, OTP) podem precisar. */
  raw: unknown;
}

export interface SendContext {
  customerId: string;
  consultantId: string;
  stepId: string;
  /** Idempotency key derivada de _shared/idempotency.ts. */
  idempotencyKey: string;
  /**
   * Quando presente, adapters aplicam dedup em `outbound_message_log`
   * (cron/nudge, channel-sender). Omitir no caminho V3 dispatcher.
   */
  supabase?: import("https://esm.sh/@supabase/supabase-js@2").SupabaseClient;
  /**
   * true quando o dispatcher V3 já chamou `acquireOutboundSlot` — evita
   * double-acquire no adapter com a mesma chave.
   */
  idempotencySlotAcquired?: boolean;
}

/** Resultado canônico de qualquer envio. Adapter nunca lança. */
export type SendResult =
  | {
      ok: true;
      messageId: string | null;
      /** Evolution/Baileys: HTTP ok mas ainda PENDING — cadência NÃO deve avançar. */
      pending?: boolean;
    }
  | {
      ok: false;
      reason:
        | "network"
        | "rate_limited"
        | "unauthorized"
        | "invalid_payload"
        | "downgraded"
        | "timeout"
        | "unknown";
      detail?: string;
    };

/**
 * Escolha que será apresentada ao cliente. Caller declara `preferred` e
 * o adapter renderiza conforme `capabilities`. Quando o canal não suporta,
 * o adapter cai para texto numerado e loga `channel_choice_downgrade`.
 */
export interface OutboundChoice {
  preferred: "button" | "list" | "number";
  options: Array<{ id: string; title: string; description?: string }>;
}

export type MediaPayload =
  | { kind: "image"; url: string; caption?: string }
  | { kind: "audio"; url: string; durationSec?: number; ptt?: boolean }
  | { kind: "video"; url: string; caption?: string; durationSec?: number }
  | { kind: "document"; url: string; filename: string; caption?: string };

/**
 * Contrato comum para Evolution e Whapi.
 *
 * `parseInbound` recebe o payload bruto do webhook do provedor e devolve
 * `ParsedMessage` ou `null` (quando deve ser ignorado: grupo, self, status).
 *
 * `downloadMedia` recebe `ParsedMessage.raw` (interno do provedor) e devolve
 * `{ base64, mime }` — ou `null` em falha. Idempotente é responsabilidade
 * do provedor; nunca lança.
 */
export interface ChannelAdapter {
  capabilities: ChannelCapabilities;
  sendText(jid: string, text: string, ctx: SendContext): Promise<SendResult>;
  sendChoice(
    jid: string,
    prompt: string,
    choice: OutboundChoice,
    ctx: SendContext,
  ): Promise<SendResult>;
  sendMedia(
    jid: string,
    media: MediaPayload,
    ctx: SendContext,
  ): Promise<SendResult>;
  sendPresence(
    jid: string,
    kind: "composing" | "recording" | "paused" | "available",
    durationMs: number,
  ): Promise<void>;
  parseInbound(raw: unknown, instanceName: string): ParsedMessage | null;
  /** Retorna base64 + mime, ou null em falha. Nunca lança. */
  downloadMedia(parsed: ParsedMessage): Promise<{ base64: string; mime: string } | null>;
}
