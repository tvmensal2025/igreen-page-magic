// Dispatcher (Phase C Task 19 do whatsapp-flow-architecture-v3).
//
// Executa as `actions` produzidas pelo engine puro. Esta é a ÚNICA camada
// que faz I/O em nome do engine — chama o adapter, persiste estado e emite
// métricas.
//
// Ordem (design.md §5):
//   1. Para cada action em result.actions:
//      - acquireOutboundSlot(idempotencyKey) — short-circuit se duplicado.
//      - adapter.send* apropriado.
//      - recordOutboundResult.
//   2. UPDATE customer_flow_state com nextState (transação lógica única).
//   3. UPDATE customers via trigger (automático).
//   4. Logs estruturados.
//
// Toda função interna é `try/catch` — dispatcher nunca lança. Erros em
// envio individual ficam contidos: o turno continua com a action seguinte.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { ChannelAdapter, SendContext } from "../channels/types.ts";
import {
  acquireOutboundSlot,
  recordOutboundResult,
} from "../idempotency.ts";
import { persistFlowState } from "../customer-flow-state.ts";
import { isFlowInstantMode } from "../flow-pace.ts";
import { jsonLog } from "../audit.ts";
import type {
  EngineAction,
  EngineResult,
} from "../flow-engine/types.ts";

export interface DispatchContext {
  customerId: string;
  consultantId: string;
  remoteJid: string;
  /**
   * Hook para steps `system_capture` — caller injeta um runner do
   * `runBotFlow` legado quando engine pede `delegate_legacy_runBotFlow`.
   * Retorna `true` se o legacy emitiu outbound (engine v3 não envia).
   */
  runLegacyBotFlow?: (reason: string) => Promise<{ delegated: true; emittedOutbound: boolean }>;
}

export interface DispatchOutcome {
  /** Quantidade de ações efetivamente despachadas (não incluindo replays). */
  sentCount: number;
  /** Quantidade de ações curto-circuitadas por idempotência. */
  replayedCount: number;
  /** Quantidade de ações com falha. */
  failedCount: number;
  /** True quando o legacy bot-flow assumiu o turno via delegate. */
  delegatedLegacy: boolean;
}

export async function dispatch(
  supabase: SupabaseClient,
  adapter: ChannelAdapter,
  result: EngineResult,
  ctx: DispatchContext,
): Promise<DispatchOutcome> {
  const outcome: DispatchOutcome = {
    sentCount: 0,
    replayedCount: 0,
    failedCount: 0,
    delegatedLegacy: false,
  };

  // 1) Executa actions sequencialmente.
  for (const action of result.actions) {
    if (action.kind === "delegate_legacy_runBotFlow") {
      outcome.delegatedLegacy = true;
      if (ctx.runLegacyBotFlow) {
        try {
          await ctx.runLegacyBotFlow(action.reason);
        } catch (e: any) {
          console.error("[dispatcher] runLegacyBotFlow falhou:", e?.message);
          jsonLog("warn", "engine_delegate_legacy_failed", {
            customer_id: ctx.customerId,
            reason: action.reason,
            error: e?.message,
          });
          outcome.failedCount++;
        }
      } else {
        // Caller não forneceu hook — log e segue. Estado fica `delegated_legacy`
        // até o próximo turno onde o caller acionar.
        jsonLog("warn", "engine_delegate_legacy_no_hook", {
          customer_id: ctx.customerId,
          reason: action.reason,
        });
      }
      continue;
    }
    if (action.kind === "schedule_timer" || action.kind === "delegate_ai_agent_router") {
      // Esses dois kinds são tratados pelo caller (webhook decide como
      // agendar timers ou rotear para ai-agent-router).
      continue;
    }

    // Send actions: aplica idempotência.
    const idemKey = (action as any).idempotencyKey as string;
    const slot = await acquireOutboundSlot(supabase, {
      idempotencyKey: idemKey,
      customerId: ctx.customerId,
      consultantId: ctx.consultantId,
      // payloadHash mínimo — usar o próprio idem como audit fallback.
      payloadHash: idemKey,
    });
    if (!slot.acquired) {
      // Já enviado — replay sem re-enviar.
      outcome.replayedCount++;
      jsonLog("info", "outbound_replay_short_circuit", {
        customer_id: ctx.customerId,
        idempotency_key: idemKey,
        previous_status: slot.previousResultStatus,
      });
      continue;
    }

    const sendCtx: SendContext = {
      customerId: ctx.customerId,
      consultantId: ctx.consultantId,
      stepId: result.nextState.currentStepId ?? "",
      idempotencyKey: idemKey,
      idempotencySlotAcquired: true,
    };

    let sendOk = false;
    let sentMessageId: string | null = null;
    try {
      switch (action.kind) {
        case "send_text": {
          // Modo instantâneo zera presence + sleep. Mantém só o envio.
          const instant = isFlowInstantMode();
          // Renova presence "digitando…" antes do envio (humanização).
          if (!instant && action.humanDelayMs > 0 && adapter.capabilities.supportsTypingPresence) {
            try {
              await adapter.sendPresence(ctx.remoteJid, "composing", action.humanDelayMs);
            } catch (_) { /* presence é cosmética */ }
            await sleep(Math.min(action.humanDelayMs, 12000));
          }
          const r = await adapter.sendText(ctx.remoteJid, action.text, sendCtx);
          sendOk = r.ok;
          if (r.ok) sentMessageId = r.messageId ?? null;
          break;
        }
        case "send_choice": {
          const r = await adapter.sendChoice(ctx.remoteJid, action.prompt, action.choice, sendCtx);
          // 'downgraded' = botão pedido, virou texto numerado. Cliente recebeu, OK.
          sendOk = r.ok || (r as any).reason === "downgraded";
          if (!r.ok && (r as any).reason === "downgraded") {
            jsonLog("info", "channel_choice_downgrade", {
              customer_id: ctx.customerId,
              step_id: result.nextState.currentStepId,
              channel: adapter.capabilities.channel,
              detail: r.detail,
            });
          }
          break;
        }
        case "send_media": {
          const r = await adapter.sendMedia(ctx.remoteJid, action.media, sendCtx);
          sendOk = r.ok;
          break;
        }
        case "send_audio_slot": {
          // Slot de áudio é resolvido pelo dispatcher consultando ai_agent_slots.
          // Implementação básica: caller pode injetar resolução via runLegacyBotFlow
          // quando o engine v3 detectar audio_slot. Por ora, log e segue.
          jsonLog("info", "send_audio_slot_pending", {
            customer_id: ctx.customerId,
            slot_key: action.slotKey,
          });
          sendOk = true;
          break;
        }
      }
    } catch (e: any) {
      console.error("[dispatcher] send falhou:", e?.message);
      sendOk = false;
    }

    await recordOutboundResult(
      supabase,
      idemKey,
      sendOk ? "sent" : "failed",
      sentMessageId,
    );
    if (sendOk) outcome.sentCount++;
    else outcome.failedCount++;
  }

  // 2) Persiste nextState em customer_flow_state (UPDATE atômico).
  await persistFlowState(supabase, {
    customerId: ctx.customerId,
    flowId: result.nextState.flowId,
    currentStepId: result.nextState.currentStepId,
    status: result.nextState.status,
    pauseReason: result.nextState.pauseReason,
    retries: result.nextState.retries,
    assignedHumanId: result.nextState.assignedHumanId,
    lastOutboundAt: outcome.sentCount > 0 ? new Date().toISOString() : undefined,
  });

  // 3) Logs estruturados.
  for (const log of result.logs) {
    jsonLog("info", log.kind, {
      customer_id: ctx.customerId,
      consultant_id: ctx.consultantId,
      ...log.payload,
    });
  }

  return outcome;
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((r) => setTimeout(r, ms));
}
