// Whapi channel adapter (Phase A da spec whatsapp-flow-architecture-v3,
// Task 6).
//
// Adapter fino sobre `_shared/whapi-api.ts`. Mesma filosofia do adapter
// Evolution: capabilities estáticas, parseInbound canonicaliza para
// `ParsedMessage`, send* devolve `SendResult` rico.
//
// Capabilities deliberadas (bot-engine-channel-unification §Design 2):
//   - `supportsButtons=true`, `maxButtons=3` — Whapi expõe `quick_reply`
//     no endpoint `/messages/interactive` e funciona consistentemente.
//   - `supportsList=true` — Whapi suporta List Messages (`list` action).
//   - `supportsAudio=true`, `supportsVideo=true`.
//   - `supportsTypingPresence=true`, `supportsReactions=true`.
//   - `inboundIdField="messageId"` — Whapi entrega `messages[0].id`.
//
// Detalhe: o sender legado já strip `ButtonsV3:` / `ListV3:` no parse
// (linha 392 de whapi-api.ts), então `buttonId` chega limpo aqui.

import type {
  ChannelAdapter,
  ChannelCapabilities,
  MediaPayload,
  OutboundChoice,
  ParsedMessage,
  SendContext,
  SendResult,
} from "./types.ts";
import { createWhapiSender, parseWhapiMessage } from "../whapi-api.ts";
import { idempotencyFromCtx } from "./idempotency-from-ctx.ts";
import { normalizePhone } from "../utils.ts";

/**
 * Capabilities estáticas do canal Whapi. Exportado como named constant
 * para consumo direto pelo motor (`_shared/engine/`), pelos PBT
 * (`__tests__/arb.ts → arbCapabilities`) e por scripts de E2E
 * (`bot-e2e-runner/v3-scenarios.ts`). Spec:
 * `.kiro/specs/bot-engine-channel-unification/design.md` §2.
 */
export const WHAPI_CAPABILITIES: ChannelCapabilities = {
  channel: "whapi",
  supportsButtons: true,
  maxButtons: 3,
  supportsList: true,
  supportsAudio: true,
  supportsVideo: true,
  supportsTypingPresence: true,
  supportsReactions: true,
  inboundIdField: "messageId",
};

export interface CreateWhapiAdapterInput {
  apiToken: string;
  baseUrl?: string;
  /** Apenas para preencher `instanceName` em ParsedMessage (Whapi não tem instâncias). */
  instanceName?: string;
}

export function createWhapiAdapter(input: CreateWhapiAdapterInput): ChannelAdapter {
  const sender = createWhapiSender(input.apiToken, input.baseUrl);
  const instanceName = input.instanceName || "whapi-superadmin";

  function toResult(ok: boolean): SendResult {
    if (ok) return { ok: true, messageId: null };
    return { ok: false, reason: "unknown", detail: "whapi_send_returned_false" };
  }

  return {
    capabilities: WHAPI_CAPABILITIES,

    async sendText(jid, text, ctx) {
      const idem = idempotencyFromCtx(ctx, text.slice(0, 200));
      try {
        const ok = await sender.sendText(jid, text, { idempotency: idem });
        return toResult(ok);
      } catch (e: any) {
        return { ok: false, reason: "network", detail: e?.message ?? String(e) };
      }
    },

    async sendChoice(jid, prompt, choice, ctx) {
      const allOptions = choice.options || [];
      // Só usa botões reais quando cabem no limite (≤3). Acima disso, texto
      // numerado preserva TODAS as opções (paridade com Evolution).
      const canUseButtons = choice.preferred === "button" &&
        WHAPI_CAPABILITIES.supportsButtons &&
        allOptions.length > 0 &&
        allOptions.length <= WHAPI_CAPABILITIES.maxButtons;
      if (canUseButtons) {
        try {
          const idem = idempotencyFromCtx(ctx, `${prompt}|${allOptions.map((o) => o.id).join(",")}`);
          const ok = await sender.sendButtons(jid, prompt, allOptions, idem);
          return toResult(ok);
        } catch (e: any) {
          return { ok: false, reason: "network", detail: e?.message ?? String(e) };
        }
      }
      // Para `list`, `number`, opções vazias ou >maxButtons: texto numerado.
      const numbered = renderNumberedList(prompt, allOptions);
      try {
        const idem = idempotencyFromCtx(ctx, numbered.slice(0, 200));
        const ok = await sender.sendText(jid, numbered, { idempotency: idem });
        if (choice.preferred === "button" && ok) {
          return { ok: false, reason: "downgraded", detail: "rendered_as_numbered_list" };
        }
        return toResult(ok);
      } catch (e: any) {
        return { ok: false, reason: "network", detail: e?.message ?? String(e) };
      }
    },

    async sendMedia(jid, media, _ctx) {
      try {
        const caption = (media as any).caption ?? "";
        const ok = await sender.sendMedia(jid, media.url, caption, media.kind);
        return toResult(ok);
      } catch (e: any) {
        return { ok: false, reason: "network", detail: e?.message ?? String(e) };
      }
    },

    async sendPresence(jid, kind, durationMs) {
      try {
        await sender.sendPresence(jid, kind as any, durationMs);
      } catch (_) {
        /* presence é cosmética */
      }
    },

    parseInbound(raw, _instanceName) {
      const parsed = parseWhapiMessage(raw);
      if (!parsed) return null;
      // Caso especial: takeover humano (consultor digitou no app oficial).
      // Sinalizamos via `ignored=false` + `isFromMe=true` para o webhook
      // tratar separadamente (pausa o bot).
      if ((parsed as any).outboundHuman) {
        return {
          channel: "whapi",
          instanceName,
          remoteJid: String((parsed as any).chatId || ""),
          phone: "",
          messageId: String((parsed as any).messageId || ""),
          ignored: false,
          isFromMe: true,
          messageText: "",
          buttonId: null,
          rawNumberReply: null,
          hasMedia: false,
          mediaKind: null,
          raw,
        };
      }
      const remoteJid = String((parsed as any).remoteJid || "");
      const phone = normalizePhone(remoteJid.replace("@s.whatsapp.net", ""));
      const text = String((parsed as any).messageText || "");
      const buttonId = (parsed as any).buttonId ? String((parsed as any).buttonId) : null;
      const rawNumberReply = isPureNumberReply(text) ? text.trim() : null;
      const hasImage = !!(parsed as any).hasImage;
      const hasDocument = !!(parsed as any).hasDocument;
      const hasAudio = !!(parsed as any).hasAudio;
      const hasVideo = !!(parsed as any).hasVideo;
      let mediaKind: ParsedMessage["mediaKind"] = null;
      if (hasImage) mediaKind = "image";
      else if (hasDocument) mediaKind = "document";
      else if (hasAudio) mediaKind = "audio";
      else if (hasVideo) mediaKind = "video";
      // Whapi pode entregar messageId via `msg.id` no payload original.
      const messageId = String(((raw as any)?.messages?.[0]?.id) || "");
      return {
        channel: "whapi",
        instanceName,
        remoteJid,
        phone,
        messageId,
        ignored: false,
        isFromMe: false,
        messageText: text,
        buttonId,
        rawNumberReply,
        hasMedia: hasImage || hasDocument || hasAudio || hasVideo,
        mediaKind,
        raw,
      };
    },

    async downloadMedia(parsed) {
      // Whapi entrega `data` (base64) e/ou `link` no payload — usamos o que
      // já veio. Caso só haja `link`, o caller (webhook) é quem faz o
      // fetch http; o adapter retorna null para sinalizar que o payload
      // direto não tem base64.
      const raw = parsed.raw as any;
      const msg = raw?.messages?.[0];
      if (!msg) return null;
      const candidate = msg.image || msg.document || msg.voice || msg.audio || msg.video;
      if (!candidate) return null;
      if (candidate.data) {
        return {
          base64: String(candidate.data),
          mime: String(candidate.mime_type || "application/octet-stream"),
        };
      }
      return null;
    },
  };
}

function isPureNumberReply(text: string): boolean {
  if (!text) return false;
  const t = text.trim();
  if (!t) return false;
  return /^\d{1,2}[.)]?$/.test(t);
}

function renderNumberedList(prompt: string, options: Array<{ id: string; title: string }>): string {
  if (!options.length) return prompt;
  const lines = options.map((o, i) => `*${i + 1}.* ${o.title}`);
  return `${prompt}\n\n${lines.join("\n")}\n\n_Digite o número da opção desejada._`;
}
