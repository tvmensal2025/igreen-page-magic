// Engine puro `tick()` (Phase C Task 18 do whatsapp-flow-architecture-v3).
//
// FUNÇÃO PURA. NÃO importa `supabase`, NÃO chama `fetch`, NÃO chama
// `Date.now()` (recebe `minuteBucket` em config). Recebe estado +
// step + capabilities + evento, devolve EngineResult declarativo.
//
// Toda I/O fica no dispatcher (`dispatcher.ts`).
//
// Reusa funções já testadas:
//   - `validateNextStep`       de `_shared/grounding.ts`
//   - `checkPreconditions`     de `_shared/grounding.ts`
//   - `matchTransition`        de `_shared/flow-router.ts`
//
// Ordem de avaliação documentada em design.md §4.

import { matchTransition } from "../flow-router.ts";
import { checkPreconditions } from "../grounding.ts";
import type {
  EngineAction,
  EngineConfig,
  EngineCustomerState,
  EngineLog,
  EngineResult,
  EngineStep,
  InboundEvent,
  OutboundChoice,
} from "./legacy-router-types.ts";

// ─── Helpers determinísticos (puros) ────────────────────────────────────────

function emptyResult(state: EngineCustomerState): EngineResult {
  return {
    nextState: state,
    actions: [],
    capturedFields: {},
    logs: [],
  };
}

function logOf(kind: EngineLog["kind"], payload: Record<string, unknown>): EngineLog {
  return { kind, payload };
}

function makeIdemKey(
  config: EngineConfig,
  stepId: string,
  content: string,
): string {
  return config.idempotencyKeyFn({
    stepId,
    content,
    minuteBucket: config.minuteBucket,
  });
}

function buildOutboundChoice(step: EngineStep): OutboundChoice {
  return {
    preferred: step.preferredChoiceKind ?? "button",
    options: step.choiceOptions ?? [],
  };
}

/**
 * Resolve "1"/"2" em `option_id`. Retorna null se índice inválido.
 */
function resolveNumberReply(step: EngineStep, raw: string | undefined): string | null {
  if (!raw) return null;
  const m = raw.trim().match(/^(\d{1,2})/);
  if (!m) return null;
  const idx = parseInt(m[1], 10) - 1;
  const opts = step.choiceOptions ?? [];
  if (idx < 0 || idx >= opts.length) return null;
  return opts[idx]?.id ?? null;
}

/**
 * Para `ask_choice`: aceita `buttonId` ou `rawNumberReply` resolvido.
 * Retorna a transition que casou, ou null.
 */
function matchAskChoice(step: EngineStep, event: InboundEvent): { transition: ReturnType<typeof matchTransition>; resolvedButtonId: string | null } {
  let resolvedButtonId = event.buttonId ?? null;
  if (!resolvedButtonId && event.rawNumberReply) {
    resolvedButtonId = resolveNumberReply(step, event.rawNumberReply);
  }
  const transition = matchTransition({
    transitions: step.transitions ?? [],
    buttonId: resolvedButtonId,
    messageText: event.text ?? "",
  });
  return { transition, resolvedButtonId };
}

/**
 * Encontra o próximo step na sequência (mesmo flow_id, position+1).
 * `reachableStepIds` está ordenado por position no caller — pegamos o
 * próximo na lista. Retorna null se já é o último.
 */
function findNextSequentialStepId(step: EngineStep): string | null {
  const list = step.reachableStepIds ?? [];
  const idx = list.indexOf(step.id);
  if (idx === -1) return null;
  if (idx + 1 >= list.length) return null;
  return list[idx + 1] ?? null;
}

function applyFallback(
  step: EngineStep,
  state: EngineCustomerState,
): { nextStepId: string | null; logs: EngineLog[] } {
  const fb = step.fallback;
  if (!fb) return { nextStepId: state.currentStepId, logs: [] };
  switch (fb.mode) {
    case "repeat":
      return { nextStepId: state.currentStepId, logs: [logOf("engine_no_match", { reason: "fallback_repeat", step_id: step.id })] };
    case "goto":
      if (fb.goto_step_id && step.reachableStepIds.includes(fb.goto_step_id)) {
        return { nextStepId: fb.goto_step_id, logs: [logOf("engine_step_advance", { reason: "fallback_goto", to: fb.goto_step_id })] };
      }
      return { nextStepId: state.currentStepId, logs: [logOf("engine_no_match", { reason: "fallback_goto_invalid", step_id: step.id })] };
    case "advance":
    case "ai":
    case "ai_limit": {
      const nx = findNextSequentialStepId(step);
      return { nextStepId: nx ?? state.currentStepId, logs: [logOf("engine_step_advance", { reason: `fallback_${fb.mode}`, to: nx })] };
    }
    case "handoff":
      return { nextStepId: state.currentStepId, logs: [logOf("engine_handoff", { reason: fb.handoff_reason ?? "fallback_handoff" })] };
    default:
      return { nextStepId: state.currentStepId, logs: [] };
  }
}

// ─── Branch: avalia condition_expr contra customer ───────────────────────────
//
// Forma mínima: { "field": "customer.electricityBillValue", "op": ">=", "value": 200,
//                  "thenStepId": "uuid", "elseStepId": "uuid" }
// Operadores: >, >=, <, <=, ==, !=, "exists", "missing".
// Forma incompleta → engine retorna `current` + log invalid.

function evalBranch(step: EngineStep, state: EngineCustomerState): { nextStepId: string | null; log: EngineLog | null } {
  const expr = step.conditionExpr ?? null;
  if (!expr) return { nextStepId: state.currentStepId, log: logOf("engine_invalid_step", { step_id: step.id, reason: "branch_missing_expr" }) };
  const field = String(expr.field ?? "");
  const op = String(expr.op ?? "==");
  const value = (expr as any).value;
  const thenId = (expr as any).thenStepId as string | undefined;
  const elseId = (expr as any).elseStepId as string | undefined;
  if (!field || !thenId || !elseId) {
    return { nextStepId: state.currentStepId, log: logOf("engine_invalid_step", { step_id: step.id, reason: "branch_missing_then_else" }) };
  }
  const lhs = readField(state, field);
  let outcome = false;
  switch (op) {
    case "==": outcome = lhs == value; break;
    case "!=": outcome = lhs != value; break;
    case ">":  outcome = Number(lhs) >  Number(value); break;
    case ">=": outcome = Number(lhs) >= Number(value); break;
    case "<":  outcome = Number(lhs) <  Number(value); break;
    case "<=": outcome = Number(lhs) <= Number(value); break;
    case "exists":  outcome = lhs !== null && lhs !== undefined && lhs !== ""; break;
    case "missing": outcome = lhs === null || lhs === undefined || lhs === ""; break;
    default: outcome = false;
  }
  const target = outcome ? thenId : elseId;
  if (!step.reachableStepIds.includes(target)) {
    return { nextStepId: state.currentStepId, log: logOf("engine_invalid_step", { step_id: step.id, reason: "branch_target_unreachable", target }) };
  }
  return { nextStepId: target, log: logOf("engine_step_advance", { reason: `branch_${outcome}`, to: target }) };
}

function readField(state: EngineCustomerState, path: string): unknown {
  const parts = path.split(".");
  let cur: any = { state, customer: state.customer };
  for (const p of parts) {
    if (cur == null) return null;
    cur = cur[p];
  }
  return cur;
}

// ─── Tick principal ─────────────────────────────────────────────────────────

export function tick(
  state: EngineCustomerState,
  step: EngineStep,
  event: InboundEvent,
  config: EngineConfig,
): EngineResult {
  // 0) Estados terminais ou pausa absoluta → no-op.
  if (
    state.status === "paused_manual" ||
    state.status === "paused_system" ||
    state.status === "converted" ||
    state.status === "lost" ||
    state.pauseReason === "opt_out"
  ) {
    return {
      nextState: state,
      actions: [],
      capturedFields: {},
      logs: [logOf("engine_no_match", { reason: "paused_skip", status: state.status, pause_reason: state.pauseReason })],
    };
  }

  // 1) system_capture: delega para runBotFlow legado.
  if (step.stepType === "system_capture") {
    const reason = step.pipelineKind ?? "cadastro_portal";
    return {
      nextState: { ...state, status: "delegated_legacy" as any },
      actions: [{ kind: "delegate_legacy_runBotFlow", reason }],
      capturedFields: {},
      logs: [logOf("engine_delegate_legacy", { step_id: step.id, pipeline: reason })],
    };
  }

  // 2) Timer expirado: aplica fallback.
  if (event.kind === "timer_expired") {
    const fb = applyFallback(step, state);
    return {
      nextState: { ...state, currentStepId: fb.nextStepId },
      actions: [],
      capturedFields: {},
      logs: fb.logs,
    };
  }

  // 3) Switch por tipo canônico.
  switch (step.stepType) {
    case "text_message": {
      const text = step.messageText ?? "";
      const idem = makeIdemKey(config, step.id, text);
      const humanDelayMs = config.humanDelayFn(text.length);
      const next = findNextSequentialStepId(step);
      const actions: EngineAction[] = text
        ? [{ kind: "send_text", text, idempotencyKey: idem, humanDelayMs }]
        : [];
      return {
        nextState: { ...state, currentStepId: next ?? state.currentStepId, status: next ? "running" : "running" },
        actions,
        capturedFields: {},
        logs: [logOf("engine_step_advance", { from: step.id, to: next, kind: "text_message" })],
      };
    }

    case "media_message": {
      // mediaOrder pode ter múltiplos itens — emitimos send_media para cada
      // não-texto e send_text para texto. Idempotency keys diferenciadas
      // por índice + step.
      const actions: EngineAction[] = [];
      const orderArr = Array.isArray(step.mediaOrder) ? step.mediaOrder : [];
      for (let i = 0; i < orderArr.length; i++) {
        const item = orderArr[i];
        if (item.kind === "text" && item.text) {
          const idem = makeIdemKey(config, step.id, `media_text_${i}_${item.text}`);
          actions.push({ kind: "send_text", text: item.text, idempotencyKey: idem, humanDelayMs: config.humanDelayFn(item.text.length) });
        } else if (item.media_id) {
          const idem = makeIdemKey(config, step.id, `media_${i}_${item.media_id}`);
          // O dispatcher resolve URL real a partir do media_id em ai_media_library.
          // Aqui passamos placeholder para ele preencher.
          actions.push({
            kind: "send_media",
            media: { kind: item.kind as any, url: `media:${item.media_id}` } as any,
            idempotencyKey: idem,
          });
        }
      }
      const next = findNextSequentialStepId(step);
      return {
        nextState: { ...state, currentStepId: next ?? state.currentStepId },
        actions,
        capturedFields: {},
        logs: [logOf("engine_step_advance", { from: step.id, to: next, kind: "media_message" })],
      };
    }

    case "audio_slot": {
      const slot = step.slotKey ?? "boas_vindas";
      const idem = makeIdemKey(config, step.id, `slot_${slot}`);
      const next = findNextSequentialStepId(step);
      return {
        nextState: { ...state, currentStepId: next ?? state.currentStepId },
        actions: [{ kind: "send_audio_slot", slotKey: slot, idempotencyKey: idem }],
        capturedFields: {},
        logs: [logOf("engine_step_advance", { from: step.id, to: next, kind: "audio_slot", slot_key: slot })],
      };
    }

    case "ask_text": {
      // Espera resposta do usuário. (timer_expired já foi tratado no passo 2.)
      if (event.kind === "no_input") {
        const fb = applyFallback(step, state);
        return {
          nextState: { ...state, currentStepId: fb.nextStepId, status: "waiting_reply" },
          actions: [],
          capturedFields: {},
          logs: fb.logs,
        };
      }
      if (event.kind !== "text" || !event.text || !event.text.trim()) {
        return {
          nextState: { ...state, status: "waiting_reply" },
          actions: [],
          capturedFields: {},
          logs: [logOf("engine_invalid_input", { step_id: step.id, expected: "text" })],
        };
      }
      // Captura todos os fields declarados em captures (validador é leve aqui).
      const captured: Record<string, unknown> = {};
      for (const c of step.captures ?? []) {
        if (!c.enabled) continue;
        if (c.field === "_buttons") continue;
        captured[c.field] = String(event.text).trim();
      }
      const next = findNextSequentialStepId(step);
      // checkPreconditions no destino — se falha, repeat.
      if (next) {
        const pre = checkPreconditions(next, state.customer as any);
        if (!pre.ok) {
          return {
            nextState: { ...state, status: "waiting_reply" },
            actions: [],
            capturedFields: captured,
            logs: [logOf("engine_precondition_failed", { step_id: next, reason: pre.reason })],
          };
        }
      }
      return {
        nextState: { ...state, currentStepId: next ?? state.currentStepId, status: next ? "running" : "running" },
        actions: [],
        capturedFields: captured,
        logs: [logOf("engine_step_advance", { from: step.id, to: next, kind: "ask_text", captured: Object.keys(captured) })],
      };
    }

    case "ask_choice": {
      // Quando estamos APRESENTANDO a escolha (sem evento de reply ainda),
      // emitimos a ação e ficamos waiting_reply.
      // (timer_expired já foi tratado no passo 2.)
      if (event.kind === "no_input") {
        // Apresenta novamente.
        const idem = makeIdemKey(config, step.id, `choice_${(step.choiceOptions ?? []).map((o) => o.id).join("|")}`);
        return {
          nextState: { ...state, status: "waiting_reply" },
          actions: [{
            kind: "send_choice",
            prompt: step.messageText ?? "👇 Escolha uma opção:",
            choice: buildOutboundChoice(step),
            idempotencyKey: idem,
          }],
          capturedFields: {},
          logs: [logOf("engine_step_advance", { from: step.id, to: step.id, kind: "ask_choice_prompt" })],
        };
      }
      // Resposta do usuário: button_click, text com number reply, ou texto livre.
      const matched = matchAskChoice(step, event);
      if (!matched.transition) {
        // Sem match — fallback.
        const fb = applyFallback(step, state);
        return {
          nextState: { ...state, currentStepId: fb.nextStepId, status: "waiting_reply" },
          actions: [],
          capturedFields: {},
          logs: [logOf("engine_no_match", { step_id: step.id, button_id: matched.resolvedButtonId, text: event.text }), ...fb.logs],
        };
      }
      // Transition encontrada → advance.
      const t = matched.transition;
      let target: string | null = t.goto_step_id ?? null;
      if (!target && t.goto_special) {
        // 'cadastro' / 'humano' / 'menu' / 'repeat' são tratados pelo caller.
        // Aqui sinalizamos via log e mantemos current_step.
        return {
          nextState: { ...state, status: "running" },
          actions: [],
          capturedFields: {},
          logs: [logOf("engine_handoff", { goto_special: t.goto_special, step_id: step.id })],
        };
      }
      if (target && !step.reachableStepIds.includes(target)) {
        return {
          nextState: { ...state, status: "waiting_reply" },
          actions: [],
          capturedFields: {},
          logs: [logOf("engine_invalid_step", { step_id: step.id, target, reason: "transition_target_unreachable" })],
        };
      }
      return {
        nextState: { ...state, currentStepId: target ?? state.currentStepId, status: "running" },
        actions: [],
        capturedFields: { __selected_option: matched.resolvedButtonId },
        logs: [logOf("engine_step_advance", { from: step.id, to: target, kind: "ask_choice", option_id: matched.resolvedButtonId })],
      };
    }

    case "ask_media": {
      if (event.kind === "media") {
        const next = findNextSequentialStepId(step);
        return {
          nextState: { ...state, currentStepId: next ?? state.currentStepId, status: "running" },
          actions: [],
          capturedFields: { __media_received: true, __media_kind: event.mediaKind ?? null },
          logs: [logOf("engine_step_advance", { from: step.id, to: next, kind: "ask_media" })],
        };
      }
      // Texto livre em ask_media → pede de novo.
      if (event.kind === "text" && event.text) {
        const text = "Preciso da foto pra seguir 📸 pode me mandar?";
        const idem = makeIdemKey(config, step.id, text);
        return {
          nextState: { ...state, status: "waiting_media" },
          actions: [{ kind: "send_text", text, idempotencyKey: idem, humanDelayMs: config.humanDelayFn(text.length) }],
          capturedFields: {},
          logs: [logOf("engine_invalid_input", { step_id: step.id, expected: "media", got: "text" })],
        };
      }
      return {
        nextState: { ...state, status: "waiting_media" },
        actions: [],
        capturedFields: {},
        logs: [],
      };
    }

    case "branch": {
      const r = evalBranch(step, state);
      return {
        nextState: { ...state, currentStepId: r.nextStepId },
        actions: [],
        capturedFields: {},
        logs: r.log ? [r.log] : [],
      };
    }

    default: {
      // step_type desconhecido — segura.
      return {
        ...emptyResult(state),
        logs: [logOf("engine_invalid_step", { step_id: step.id, step_type: step.stepType })],
      };
    }
  }
}
