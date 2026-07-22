// Evolution channel adapter (Phase A da spec whatsapp-flow-architecture-v3,
// Task 5).
//
// Adapter fino sobre `_shared/evolution-api.ts`. NÃO duplica lógica do
// sender legado — apenas:
//   1. Declara `capabilities` estaticamente.
//   2. Converte `parseEvolutionMessage` (legado) → `ParsedMessage` canônico.
//   3. Transforma `boolean` retornado pelos `send*` em `SendResult` rico.
//   4. Implementa `sendChoice` decidindo botão real vs lista numerada
//      conforme `capabilities` (Task D do design — channel-aware).
//
// Capabilities deliberadas (bot-engine-channel-unification §Design 2):
//   - `supportsButtons=false`, `maxButtons=0` — política do projeto:
//     renderizamos lista numerada por estabilidade do Baileys/Evolution
//     (sendButtons pode retornar HTTP 200 sem renderizar no aparelho).
//     O helper `sendChoice` abaixo preserva TODAS as opções no texto numerado.
//     Para habilitar botões reais no futuro: mudar para true/3 + validar
//     versão Evolution em staging antes de produção.
//   - `supportsList=true` — `sendList` é estável (reservado para fluxos
//     futuros; o caminho atual usa lista numerada em texto plano).
//   - `supportsAudio=true`: `sendAudio` existe e funciona.
//   - `supportsTypingPresence=true`: `chat/sendPresence` está disponível.
//   - `supportsReactions=false`: emoji-em-mensagem não é confiável.
//   - `inboundIdField="wa_id"` — Evolution entrega `data.key.id` mas o
//     campo canônico do payload Baileys é `wa_id` (vide design §2).

import type {
  ChannelAdapter,
  ChannelCapabilities,
  MediaPayload,
  OutboundChoice,
  ParsedMessage,
  SendContext,
  SendResult,
} from "./types.ts";
import {
  createEvolutionSender,
  parseEvolutionMessage,
  extractMediaUrl,
} from "../evolution-api.ts";
import { idempotencyFromCtx } from "./idempotency-from-ctx.ts";
import { normalizePhone } from "../utils.ts";

/**
 * Capabilities estáticas do canal Evolution. Exportado como named constant
 * para consumo direto pelo motor (`_shared/engine/`), pelos PBT
 * (`__tests__/arb.ts → arbCapabilities`) e por scripts de E2E
 * (`bot-e2e-runner/v3-scenarios.ts`). Spec:
 * `.kiro/specs/bot-engine-channel-unification/design.md` §2.
 */
export const EVOLUTION_CAPABILITIES: ChannelCapabilities = {
  channel: "evolution",
  supportsButtons: false,
  maxButtons: 0,
  supportsList: true,
  supportsAudio: true,
  supportsVideo: true,
  supportsTypingPresence: true,
  supportsReactions: false,
  inboundIdField: "wa_id",
};

export interface CreateEvolutionAdapterInput {
  apiUrl: string;
  apiKey: string;
  instanceName: string;
  /** Telefone conectado da instância (anti self-message). */
  connectedPhone?: string | null;
}

/**
 * Factory do adapter Evolution. Retorna implementação de `ChannelAdapter`.
 * O sender legado (`createEvolutionSender`) é embrulhado mas continua
 * sendo a fonte de verdade da camada HTTP — não há retry/backoff próprio
 * aqui, esse cuidado já está no sender.
 */
export function createEvolutionAdapter(input: CreateEvolutionAdapterInput): ChannelAdapter {
  const sender = createEvolutionSender(input.apiUrl, input.apiKey, input.instanceName);

  function toResult(ok: boolean, messageId: string | null = null, pending = false): SendResult {
    if (ok) return { ok: true, messageId, pending: pending || undefined };
    return { ok: false, reason: "unknown", detail: "evolution_send_returned_false" };
  }

  return {
    capabilities: EVOLUTION_CAPABILITIES,

    async sendText(jid, text, ctx) {
      const idem = idempotencyFromCtx(ctx, text.slice(0, 200));
      try {
        const r = await sender.sendTextDetailed(jid, text, idem);
        if (!r.ok) {
          return {
            ok: false,
            reason: "unknown",
            detail: r.error || "evolution_send_failed",
          };
        }
        return toResult(true, r.messageId, !!r.pending);
      } catch (e: any) {
        return { ok: false, reason: "network", detail: e?.message ?? String(e) };
      }
    },

    async sendChoice(jid, prompt, choice, ctx) {
      // Renderização channel-aware (Task D do design):
      //   button → tenta botão real; sender legado já cai para texto numerado
      //            interno se a Evolution falhar — comportamento preservado.
      //   list   → não suportado: fallback para texto numerado.
      //   number → texto numerado direto.
      const allOptions = choice.options || [];
      // Só usa botões reais quando o nº de opções cabe no limite do canal.
      // Acima disso, cair para texto numerado preservando TODAS as opções
      // (slice cego perderia as opções 4+).
      const canUseButtons = choice.preferred === "button" &&
        EVOLUTION_CAPABILITIES.supportsButtons &&
        allOptions.length > 0 &&
        allOptions.length <= EVOLUTION_CAPABILITIES.maxButtons;
      if (canUseButtons) {
        try {
          const idem = idempotencyFromCtx(ctx, `${prompt}|${allOptions.map((o) => o.id).join(",")}`);
          const ok = await sender.sendButtons(jid, prompt, allOptions, idem);
          return toResult(ok);
        } catch (e: any) {
          return { ok: false, reason: "network", detail: e?.message ?? String(e) };
        }
      }
      const numbered = renderNumberedList(prompt, allOptions);
      try {
        const idem = idempotencyFromCtx(ctx, numbered.slice(0, 200));
        const ok = await sender.sendText(jid, numbered, idem);
        // Quando o caller pediu "button" mas caímos em texto, sinalizamos
        // downgrade para o dispatcher logar `channel_choice_downgrade`.
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
        let ok = false;
        if (media.kind === "audio") {
          // Evolution `sendAudio` distinto de `sendMedia` — usa narrowing.
          ok = await (sender as any).sendAudio(jid, media.url, "");
        } else {
          const caption = (media as any).caption ?? "";
          ok = await sender.sendMedia(jid, media.url, caption, media.kind);
        }
        return toResult(ok);
      } catch (e: any) {
        return { ok: false, reason: "network", detail: e?.message ?? String(e) };
      }
    },

    async sendPresence(jid, kind, durationMs) {
      try {
        await sender.sendPresence(jid, kind as any, durationMs);
      } catch (_) {
        /* presence é cosmética — nunca trava o turno */
      }
    },

    parseInbound(raw, instanceName) {
      const parsed = parseEvolutionMessage(raw, input.connectedPhone);
      if (!parsed) {
        // Mensagem ignorada (grupo/self/status). Retornamos uma forma
        // mínima com `ignored=true` para o caller saber distinguir
        // "payload inválido" de "ignorar".
        return null;
      }
      const remoteJid = String(parsed.remoteJid || "");
      const phone = normalizePhone(remoteJid.replace("@s.whatsapp.net", ""));
      const messageId = String((raw as any)?.data?.key?.id ?? "") || "";
      const buttonId = parsed.buttonId ? String(parsed.buttonId) : null;
      const text = parsed.messageText || "";
      // rawNumberReply: "1"/"2"/... digitado em resposta a uma lista numerada.
      // O engine no handler de ask_choice resolve para option_id.
      const rawNumberReply = isPureNumberReply(text) ? text.trim() : null;
      const result: ParsedMessage = {
        channel: "evolution",
        instanceName,
        remoteJid,
        phone,
        messageId,
        ignored: false,
        isFromMe: false,
        messageText: text,
        buttonId,
        rawNumberReply,
        hasMedia: !!parsed.isFile || parsed.mediaKind === "video",
        mediaKind: parsed.mediaKind ?? null,
        raw,
      };
      return result;
    },

    async downloadMedia(parsed) {
      try {
        const raw = parsed.raw as any;
        const key = raw?.data?.key ?? raw?.key;
        const message = raw?.data?.message ?? raw?.message;
        const base64 = await sender.downloadMedia(key, message);
        if (!base64) {
          // Fallback: URL direta — caller pode tentar `fetch` separado
          // se quiser; aqui só retornamos null para sinalizar falha.
          const url = extractMediaUrl(message);
          if (!url) return null;
          // Evolution pode entregar URL direta sem base64; o caller
          // (webhook) já tem path para baixar URL → base64 quando precisar.
          return null;
        }
        const mime =
          message?.imageMessage?.mimetype ||
          message?.documentMessage?.mimetype ||
          message?.audioMessage?.mimetype ||
          message?.videoMessage?.mimetype ||
          "application/octet-stream";
        return { base64, mime };
      } catch (_) {
        return null;
      }
    },
  };
}

/**
 * "1", "2 ", "3.", "4)" etc. — resposta numérica pura. Evita confundir
 * "1 minuto" com seleção. Limitamos a 1 ou 2 dígitos no início.
 */
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
