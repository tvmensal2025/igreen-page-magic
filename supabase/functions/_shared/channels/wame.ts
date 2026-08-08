// WAME channel adapter (canal piloto paralelo — api-wa.me).
//
// Implementa o MESMO contrato `ChannelAdapter` do Whapi/Evolution, então o
// motor, o dispatcher e o `channel-sender` consomem WAME sem saber do
// provedor. Não altera nada do caminho Whapi: só é instanciado quando
// `origin_channel = "wame"` ou a instância do consultor começa com `wame`.
//
// Capabilities do piloto (conservadoras — só o que já foi validado no QR):
//   - `supportsButtons=true`, `maxButtons=3` — `message/button_reply`.
//   - `supportsList=false` — piloto renderiza lista como texto numerado
//     (a WAME tem `message/list`, mas só liberamos após validar no piloto).
//   - `supportsAudio/Video=true` via URL pública.
//   - `supportsTypingPresence=true` (`message/presence`).
//   - `supportsReactions=false` no piloto (não usado pelo funil).
//
// Multicanal: `provider` fica no cliente (default `whatsapp`). Instagram e
// Messenger entram depois trocando só esse campo — o adapter não muda.

import type {
  ChannelAdapter,
  ChannelCapabilities,
  ParsedMessage,
  SendResult,
} from "./types.ts";
import {
  createWameSender,
  parseWameMessage,
  type WameProvider,
  type WameSendOutcome,
} from "../wame-api.ts";
import { idempotencyFromCtx } from "./idempotency-from-ctx.ts";

export const WAME_CAPABILITIES: ChannelCapabilities = {
  channel: "wame",
  supportsButtons: true,
  maxButtons: 3,
  supportsList: false,
  supportsAudio: true,
  supportsVideo: true,
  supportsTypingPresence: true,
  supportsReactions: false,
  inboundIdField: "messageId",
};

export interface CreateWameAdapterInput {
  /** Ex.: `https://us.api-wa.me` (settings.wame_server). */
  server: string;
  /** settings.wame_api_key — vai no path da URL, não em header. */
  apiKey: string;
  /** Nome da instância em `whatsapp_instances` (sempre prefixo `wame`). */
  instanceName?: string;
  /** Piloto usa `whatsapp`; IG/Messenger ficam para depois. */
  provider?: WameProvider;
}

function toResult(outcome: WameSendOutcome): SendResult {
  if (outcome.ok) return { ok: true, messageId: outcome.messageId };
  return {
    ok: false,
    reason: outcome.failureKind ?? "unknown",
    detail: outcome.detail ?? "wame_send_failed",
  };
}

export function createWameAdapter(input: CreateWameAdapterInput): ChannelAdapter {
  const sender = createWameSender(input.server, input.apiKey, {
    provider: input.provider || "whatsapp",
  });
  const instanceName = input.instanceName || "wame-piloto";

  return {
    capabilities: WAME_CAPABILITIES,

    async sendText(jid, text, ctx) {
      const idem = idempotencyFromCtx(ctx, text.slice(0, 200));
      return toResult(await sender.sendText(jid, text, idem));
    },

    async sendChoice(jid, prompt, choice, ctx) {
      const options = choice.options || [];
      const canUseButtons = choice.preferred === "button" &&
        WAME_CAPABILITIES.supportsButtons &&
        options.length > 0 &&
        options.length <= WAME_CAPABILITIES.maxButtons;

      if (canUseButtons) {
        const idem = idempotencyFromCtx(
          ctx,
          `${prompt}|${options.map((o) => o.id).join(",")}`,
        );
        return toResult(await sender.sendButtons(jid, prompt, options, idem));
      }

      // Lista, texto numerado, sem opções ou acima do limite: texto numerado
      // preserva TODAS as opções (mesma escolha do adapter Whapi).
      const numbered = renderNumberedList(prompt, options);
      const idem = idempotencyFromCtx(ctx, numbered.slice(0, 200));
      const outcome = await sender.sendText(jid, numbered, idem);
      if (choice.preferred === "button" && outcome.ok) {
        return { ok: false, reason: "downgraded", detail: "rendered_as_numbered_list" };
      }
      return toResult(outcome);
    },

    async sendMedia(jid, media, ctx) {
      const caption = (media as { caption?: string }).caption ?? "";
      const idem = idempotencyFromCtx(
        ctx,
        `${media.kind}|${media.url}|${caption}`.slice(0, 200),
      );
      const extra = media.kind === "document"
        ? { filename: media.filename }
        : undefined;
      return toResult(
        await sender.sendMedia(jid, media.url, caption, media.kind, extra, idem),
      );
    },

    async sendPresence(jid, kind, _durationMs) {
      await sender.sendPresence(jid, kind);
    },

    parseInbound(raw, forInstanceName) {
      const parsed = parseWameMessage(raw);
      if (!parsed) return null;

      const resolvedInstance = forInstanceName || instanceName;

      // Fora do funil (paridade `parseWhapiMessage`):
      //  - grupo / newsletter / broadcast / status;
      //  - TUDO que é `from_me`.
      //
      // O Whapi distingue eco da API (`source="api"`) de digitação humana no
      // celular (`source="app"`) e usa isso para o takeover. O envelope Meta
      // da WAME não traz `source`, então não dá para separar os dois: tratar
      // como takeover pausaria o bot sozinho a cada mensagem que ele mesmo
      // envia. No piloto todo `from_me` é ignorado — takeover se faz pelo CRM.
      const nonUserChat = parsed.isGroup ||
        /@(g\.us|newsletter|broadcast)|^status@/i.test(parsed.from);
      if (nonUserChat || parsed.fromMe) {
        return {
          channel: "wame",
          instanceName: resolvedInstance,
          remoteJid: parsed.from,
          phone: parsed.phone,
          messageId: parsed.messageId,
          ignored: true,
          isFromMe: parsed.fromMe,
          messageText: "",
          buttonId: null,
          rawNumberReply: null,
          hasMedia: false,
          mediaKind: null,
          raw,
        };
      }

      const remoteJid = parsed.phone
        ? `${parsed.phone}@s.whatsapp.net`
        : parsed.from;

      return {
        channel: "wame",
        instanceName: resolvedInstance,
        remoteJid,
        phone: parsed.phone,
        messageId: parsed.messageId,
        ignored: false,
        isFromMe: false,
        messageText: parsed.messageText,
        buttonId: parsed.buttonId,
        rawNumberReply: isPureNumberReply(parsed.messageText)
          ? parsed.messageText.trim()
          : null,
        hasMedia: parsed.mediaKind !== null,
        mediaKind: parsed.mediaKind,
        raw,
      };
    },

    async downloadMedia(parsed: ParsedMessage) {
      if (!parsed.messageId) return null;
      return await sender.downloadMedia(parsed.messageId);
    },
  };
}

function isPureNumberReply(text: string): boolean {
  const t = String(text || "").trim();
  if (!t) return false;
  return /^\d{1,2}[.)]?$/.test(t);
}

function renderNumberedList(
  prompt: string,
  options: Array<{ id: string; title: string }>,
): string {
  if (!options.length) return prompt;
  const lines = options.map((o, i) => `*${i + 1}.* ${o.title}`);
  return `${prompt}\n\n${lines.join("\n")}\n\n_Digite o número da opção desejada._`;
}
