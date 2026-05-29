// Conversational flow entrypoint — Part 3 of the dynamic flow migration.
// Loads steps + transitions from `bot_flow_steps` (the table the FluxoCamila UI edits)
// and decides the next step from there. Falls back to the legacy hardcoded
// state machine if the consultant has no flow configured.

import type { BotContext, BotResult } from "../types.ts";
import { CONVERSATIONAL_STEPS, decideTransition, type ConversationalStep } from "./state-machine.ts";
import { classifyIntent } from "./intent-classifier.ts";
import { getTemplate, renderTemplate } from "./templates.ts";
import {
  extractValor, extractValorPermissivo, extractTelefone, extractCPF, extractNome, detectRegexIntents,
} from "../../../_shared/captureExtractors.ts";
import { getStepMediaOrder, makeKindComparator } from "../../../_shared/step-media-order.ts";
import { isMockMode, shouldBypassQuietHours } from "../../../_shared/test-mode.ts";
import { isFlowInstantMode } from "../../../_shared/flow-pace.ts";
// rules-engine removido em Sprint 2.5 (bot_flow_rules = 0 linhas, código morto)
import { answerFaqWithAI } from "../../../_shared/ai-faq-answerer.ts";
import { ensureAudioTranscript } from "../../../_shared/audio-transcript.ts";
import { isQuietHourBRT, logQuietSkip } from "../../../_shared/quiet-hours.ts";
import { isStrictScriptMode } from "../../../_shared/ai-decisions.ts";
import { validateAiFallbackChoice } from "../../../_shared/grounding.ts";
// Sprint 2.6 — helpers compartilhados (cooldown e dedupe)
import { aiInCooldown, setAiCooldown, aiInCooldownPersistent, setAiCooldownPersistent } from "../../../_shared/bot/ai-cooldown.ts";
import { checkAndMarkWebhookDedupe } from "../../../_shared/bot/dedupe.ts";
import { matchTransition as matchTransitionShared, CADASTRO_STEPS as CADASTRO_STEPS_SHARED } from "../../../_shared/flow-router.ts";
import { matchButtonIntent, extractStepButtons } from "../../../_shared/ai-button-intent.ts";
import { notifyHandoff } from "../../../_shared/notify-consultant.ts";

export { CONVERSATIONAL_STEPS };

interface DbTransition {
  trigger_intent?: string | null;
  trigger_phrases?: string[] | null;
  goto_step_id?: string | null;
  goto_special?: string | null; // 'cadastro' | 'humano' | 'repeat' | null
}

interface DbCapture {
  field: "name" | "electricity_bill_value" | "phone_whatsapp" | "cpf";
  enabled?: boolean;
}

interface DbFallback {
  mode?: "repeat" | "goto" | "ai" | "ai_answer" | "retry" | "handoff";
  goto_step_id?: string | null;
  ai_prompt?: string | null;
  /** Para mode='ai_answer': comportamento após responder. 'stay' (default) mantém no passo. */
  after_ai?: "stay" | "advance";
  /** Outros campos toleráveis (retry, handoff). */
  max_retries?: number;
  retry_text?: string | null;
  on_fail?: string | null;
  handoff_reason?: string | null;
  then?: string | null;
}

interface DbStep {
  id: string;
  step_key: string;
  step_type: string | null;
  message_text: string | null;
  wait_for: string | null;
  text_delay_ms: number | null;
  slot_key: string | null;
  is_active: boolean;
  position: number;
  transitions: DbTransition[] | null;
  captures: DbCapture[] | null;
  fallback: DbFallback | null;
  auto_detect_doc_type: boolean | null;
  media_order?: string[] | null;
  /** Título legível do step. Usado como fallback anti-pulo-silencioso. */
  title?: string | null;
}

// Re-exporta CADASTRO_STEPS do _shared para que whapi-webhook/index.ts
// continue importando daqui sem quebrar. Fonte única de verdade: flow-router.ts.
export { CADASTRO_STEPS } from "../../../_shared/flow-router.ts";

// Alias local para uso interno neste arquivo
const CADASTRO_STEPS = CADASTRO_STEPS_SHARED;

interface LoadedFlow { flowId: string; steps: DbStep[]; strictMode: boolean; }

async function loadFlow(supabase: any, consultantId: string, variant: string = "A"): Promise<LoadedFlow | null> {
  try {
    const { data: flow } = await supabase
      .from("bot_flows")
      .select("id, strict_mode")
      .eq("consultant_id", consultantId)
      .eq("is_active", true)
      .eq("variant", variant)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (!flow?.id) {
      console.log(`[conversational] loadFlow: no active flow for consultant=${consultantId} variant=${variant}`);
      return null;
    }

    const { data: steps, error: stepsErr } = await supabase
      .from("bot_flow_steps")
      .select("id, step_key, step_type, message_text, wait_for, text_delay_ms, slot_key, is_active, position, transitions, captures, fallback, auto_detect_doc_type, media_order")
      .eq("flow_id", flow.id)
      .order("position", { ascending: true });
    if (stepsErr) {
      console.error("[conversational] loadFlow: steps query failed", stepsErr);
      return null;
    }
    const normalized = ((steps || []) as DbStep[]).map((step) => ({
      ...step,
      // Fluxos antigos podem ter step_key nulo; usa o id como chave estável
      // para o motor dinâmico não cair no fluxo legado.
      step_key: step.step_key || step.id,
    }));
    console.log(`[conversational] loadFlow: flow=${flow.id} steps=${normalized.length} strict=${!!(flow as any).strict_mode}`);
    return { flowId: flow.id as string, steps: normalized, strictMode: !!(flow as any).strict_mode };
  } catch (e) {
    console.error("[conversational] loadFlow failed", e);
    return null;
  }
}

// ─── Q&A matching (FAQ) ────────────────────────────────────────────────
// Procura uma pergunta cadastrada em bot_flow_qa que case com a mensagem do
// lead. Quando casa, manda mídia + texto e MANTÉM o passo atual (repete),
// igual ao comportamento de FAQ do bot-flow legado.
const _norm = (s: string) =>
  String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

export async function matchQA(
  supabase: any,
  flowId: string,
  consultantId: string,
  messageText: string,
): Promise<{ text: string; mediaUrls: { url: string; kind: string; mediaId: string | null }[] } | null> {
  const normalized = _norm(messageText);
  if (!normalized || normalized.length < 2) return null;
  try {
    const { data: qaRows } = await supabase
      .from("bot_flow_qa")
      .select("id, text_response, is_closing")
      .eq("flow_id", flowId)
      .eq("is_opening", false);
    const qaIds = ((qaRows as any[]) || []).map((q) => q.id);
    if (!qaIds.length) return null;

    const { data: triggers } = await supabase
      .from("bot_flow_qa_triggers")
      .select("qa_id, phrase")
      .in("qa_id", qaIds);
    const hit = ((triggers as any[]) || []).find((t) => {
      const phrase = _norm(t.phrase);
      if (!phrase || phrase.length < 2) return false;
      // Matching preciso: evita que frases curtas como "não" ou "sim" disparem
      // FAQ em qualquer mensagem que as contenha. Regras:
      //   1. Igualdade exata (mais confiável)
      //   2. Frase longa (≥ 6 chars): verifica se a mensagem contém a frase
      //   3. Mensagem curta (≤ 8 chars): verifica se a frase contém a mensagem
      //      (ex: lead manda "simular" e a phrase é "quero simular")
      // A condição `phrase.includes(normalized)` foi removida pois causava
      // falsos positivos com frases curtas como "não", "sim", "ok".
      if (normalized === phrase) return true;
      if (phrase.length >= 6 && normalized.includes(phrase)) return true;
      if (normalized.length <= 8 && phrase.includes(normalized)) return true;
      return false;
    });
    if (!hit) return null;

    const qa = ((qaRows as any[]) || []).find((q) => q.id === hit.qa_id);
    if (!qa) return null;

    const { data: mediaRows } = await supabase
      .from("bot_flow_qa_media")
      .select("media_kind, slot_key, media_id, position")
      .eq("qa_id", qa.id)
      .order("position");

    const mediaUrls: { url: string; kind: string; mediaId: string | null }[] = [];
    for (const m of ((mediaRows as any[]) || [])) {
      let url: string | null = null;
      let mediaId: string | null = m.media_id || null;
      let kind = ["audio", "video", "image"].includes(m.media_kind) ? m.media_kind : "document";
      if (m.media_id) {
        const { data: mr } = await supabase
          .from("ai_media_library").select("url, kind").eq("id", m.media_id).maybeSingle();
        if (mr?.url) { url = mr.url; if (mr.kind) kind = mr.kind; }
      }
      if (!url && m.slot_key) {
        const { data: personal } = await supabase
          .from("ai_media_library").select("id, url")
          .eq("consultant_id", consultantId).eq("slot_key", m.slot_key)
          .eq("active", true).limit(1).maybeSingle();
        if (personal?.url) { url = personal.url; mediaId = personal.id || mediaId; }
      }
      if (url) mediaUrls.push({ url, kind, mediaId });
    }

    return { text: String(qa.text_response || "").trim(), mediaUrls };
  } catch (e) {
    console.error("[conversational] matchQA failed", e);
    return null;
  }
}

async function sleepForMedia(kind: string, _durationSec?: number | null, delayBeforeMs?: number | null): Promise<void> {
  if (isMockMode()) return; // 🧪 modo teste: zero espera
  // ⚠️ ANTES esperávamos a duração inteira do áudio/vídeo antes da próxima mídia.
  // Isso fazia a Edge Function estourar 60-120s, dar timeout no Whapi e o passo
  // nunca avançava. Agora usamos pausa curta: o Whapi já entrega na ordem.
  const configuredDelay = Number(delayBeforeMs || 0);
  if (configuredDelay > 0) {
    await new Promise((r) => setTimeout(r, Math.min(configuredDelay, 5_000)));
    return;
  }
  // Sincronia rápida entre mídias soltas (fora do cascade); 600ms padrão.
  const pause = kind === "audio" || kind === "video" ? 800 : 600;
  await new Promise((r) => setTimeout(r, pause));
}// ---------------------------------------------------------------------------
// Capture phase — usa extractors compartilhados (regex + extenso + validação)
// ---------------------------------------------------------------------------
interface ExtractedCaptures {
  electricity_bill_value?: number;
  phone_whatsapp?: string;
  cpf?: string;
  name?: string;
}

function extractCaptures(messageText: string, configured: DbCapture[]): ExtractedCaptures {
  const out: ExtractedCaptures = {};
  if (!messageText) return out;
  const enabled = new Set((configured || []).filter(c => c.enabled !== false).map(c => c.field));
  if (enabled.has("electricity_bill_value")) {
    const v = extractValor(messageText);
    if (v != null) out.electricity_bill_value = v;
  }
  if (enabled.has("phone_whatsapp")) {
    const p = extractTelefone(messageText);
    if (p) out.phone_whatsapp = p;
  }
  if (enabled.has("cpf")) {
    const c = extractCPF(messageText);
    if (c) out.cpf = c;
  }
  // Nome: sempre tenta extrair (cliente pode se apresentar em qualquer step).
  // Guard real (lock por OCR/user_confirmed) fica no consumer (~linha 754).
  {
    const n = extractNome(messageText);
    if (n) out.name = n;
  }
  return out;
}

async function aiDecideFallback(
  prompt: string,
  messageText: string,
  candidates: { id: string; step_key: string; title?: string }[],
  geminiApiKey: string | undefined,
  cooldownKey: string,
  supabase?: any,
): Promise<string | null> {
  if (!geminiApiKey || !prompt) return null;
  // 🧪 modo teste/sandbox: pula LLM (gasta 4-7s por turno).
  if (isMockMode()) return null;
  // Verifica cooldown: persistente (banco, multi-container) se supabase disponível,
  // senão usa apenas o cache local.
  const inCooldown = supabase
    ? await aiInCooldownPersistent(supabase, cooldownKey)
    : aiInCooldown(cooldownKey);
  if (inCooldown) {
    console.warn("[conversational] AI fallback skipped (cooldown active)");
    return null;
  }
  const validKeys = candidates.map(c => c.step_key);
  const enumKeys = [...validKeys, "REPEAT", "HUMANO", "CADASTRO"];

  const sys = `Você decide o próximo passo de um fluxo de WhatsApp.
Instrução do consultor: ${prompt}

Mensagem do cliente: "${messageText}"

Passos válidos: ${enumKeys.join(", ")}

Responda em JSON: {"next_step_key": "<um_dos_passos_válidos>", "reason": "breve"}.`;

  const callOnce = async (timeoutMs: number): Promise<string | null> => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiApiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: sys }] }],
            generationConfig: {
              temperature: 0.1,
              maxOutputTokens: 80,
              responseMimeType: "application/json",
              responseSchema: {
                type: "OBJECT",
                properties: {
                  next_step_key: { type: "STRING", enum: enumKeys },
                  reason: { type: "STRING" },
                },
                required: ["next_step_key"],
              },
            },
          }),
          signal: ctrl.signal,
        },
      );
      if (res.status === 429) {
        // 429 → seta cooldown persistente para todos os containers
        if (supabase) {
          await setAiCooldownPersistent(supabase, cooldownKey, "gemini_429");
        } else {
          setAiCooldown(cooldownKey);
        }
        return null;
      }
      if (!res.ok) return null;
      const json: any = await res.json();
      const txt = (json?.candidates?.[0]?.content?.parts?.[0]?.text || "").trim();
      if (!txt) return null;
      try {
        const parsed = JSON.parse(txt);
        const choice = String(parsed?.next_step_key || "").trim();
        return enumKeys.includes(choice) ? choice : null;
      } catch {
        // fallback: extrai primeira palavra que casa com enum
        const first = txt.split(/[\s,"]+/).find((w: string) => enumKeys.includes(w));
        return first || null;
      }
    } catch (e) {
      console.error("[conversational] aiDecideFallback failed", (e as Error).message);
      return null;
    } finally {
      clearTimeout(timer);
    }
  };

  // Tentativa 1 (4s) → se falhar, retry curto (3s)
  const first = await callOnce(4000);
  if (first) return first;
  return await callOnce(3000);
}

// Envia mídias + (opcionalmente) o texto do passo respeitando a ordem
// configurada em consultants.flow_step_media_order[slotKey] (ex.: text→audio→video→image).
// Retorna:
//   - mediaSent: true se ao menos uma mídia foi enviada, false se não havia mídia,
//                null se tentou e falhou em TODAS.
//   - textSentInline: true quando o texto já foi enviado dentro daqui (na posição certa).
async function sendStepMedia(
  ctx: BotContext,
  step: DbStep,
  consultantId: string,
  _waitForSend = true,
  textPayload?: { text: string; delayMs: number } | null,
): Promise<{ mediaSent: boolean | null; textSentInline: boolean }> {
  const slotKey = step.slot_key || step.step_key || step.id;
  if (!slotKey) return { mediaSent: false, textSentInline: false };

  const { data: mediaRows } = await ctx.supabase
    .from("ai_media_library")
    .select("id, kind, label, url, slot_key, send_order, duration_sec, delay_before_ms, transcript")
    .eq("consultant_id", consultantId)
    .eq("slot_key", slotKey)
    .eq("active", true)
    .order("send_order", { ascending: true });

  const variant = (ctx.customer as any)?.flow_variant || "A";
  let medias = ((mediaRows as any[]) || []).filter((m) => !!m?.url);
  // Variante B: cada áudio vira um item de texto (transcript) na mesma posição.
  // Mantemos `kind: 'audio'` no item para que o slot "audio" do media_order
  // continue casando; o flag `_asText` faz a sequência empurrar como text item.
  if (variant === "B") {
    const transformed: any[] = [];
    for (const m of medias) {
      if (String(m.kind).toLowerCase() !== "audio") { transformed.push(m); continue; }
      const transcript = await ensureAudioTranscript(ctx.supabase, m);
      if (transcript && transcript.trim()) {
        transformed.push({ ...m, _asText: true, _transcript: transcript.trim() });
        console.log(`[sendStepMedia] variant=B: audio "${m.label || m.id}" → text (${transcript.length} chars)`);
      } else {
        console.warn(`[sendStepMedia] variant=B: audio "${m.label || m.id}" sem transcript → pulado`);
      }
    }
    medias = transformed;
  }


  // Precedência: UI (consultants.flow_step_media_order) → step.media_order → default.
  const uiOrder = await getStepMediaOrder(ctx.supabase, consultantId, slotKey);
  const stepOrder = Array.isArray(step.media_order) && step.media_order.length > 0
    ? step.media_order.map((k) => String(k).toLowerCase())
    : null;
  const configuredOrder = uiOrder || stepOrder; // pode conter "text"

  // Constrói sequência unificada (texto + mídias) na ordem configurada.
  type Item =
    | { kind: "text"; text: string; delayMs: number }
    | { kind: "audio" | "video" | "image" | "document"; media: any };
  const sequence: Item[] = [];

  const textItem: Item | null = (textPayload && textPayload.text.trim().length > 0)
    ? { kind: "text", text: textPayload.text, delayMs: Math.max(0, textPayload.delayMs || 0) }
    : null;

  if (configuredOrder && configuredOrder.length > 0) {
    const remaining = [...medias];
    let textInjected = false;
    for (const slot of configuredOrder) {
      const s = String(slot).toLowerCase();
      if (s === "text") {
        if (textItem && !textInjected) { sequence.push(textItem); textInjected = true; }
        continue;
      }
      const taken: any[] = [];
      for (const m of remaining) {
        if (String(m.kind).toLowerCase() === s) taken.push(m);
      }
      for (const m of taken) {
        const idx = remaining.indexOf(m);
        if (idx >= 0) remaining.splice(idx, 1);
        if ((m as any)._asText) {
          sequence.push({ kind: "text", text: String((m as any)._transcript || ""), delayMs: Number(m.delay_before_ms || 0) });
        } else {
          const k = ["audio", "video", "image"].includes(String(m.kind)) ? String(m.kind) as any : "document";
          sequence.push({ kind: k, media: m });
        }
      }
    }
    // Mídias com kind não listado vão para o fim (preserva send_order)
    for (const m of remaining) {
      if ((m as any)._asText) {
        sequence.push({ kind: "text", text: String((m as any)._transcript || ""), delayMs: Number(m.delay_before_ms || 0) });
      } else {
        const k = ["audio", "video", "image"].includes(String(m.kind)) ? String(m.kind) as any : "document";
        sequence.push({ kind: k, media: m });
      }
    }
    // Se a ordem não menciona "text" mas existe texto, manda no fim
    if (textItem && !textInjected) sequence.push(textItem);
  } else {
    // Sem ordem configurada: mantém comportamento legado (mídias antes, texto depois).
    for (const m of medias) {
      if ((m as any)._asText) {
        sequence.push({ kind: "text", text: String((m as any)._transcript || ""), delayMs: Number(m.delay_before_ms || 0) });
      } else {
        const k = ["audio", "video", "image"].includes(String(m.kind)) ? String(m.kind) as any : "document";
        sequence.push({ kind: k, media: m });
      }
    }
    if (textItem) sequence.push(textItem);
  }

  if (sequence.length === 0) return { mediaSent: false, textSentInline: false };

  let mediaSent = false;
  let mediaAttempted = false;
  let mediaFailed = false;
  let textSentInline = false;
  let prevForPause: { kind: string; duration_sec?: number | null } | null = null;

  for (let i = 0; i < sequence.length; i++) {
    const item = sequence[i];

    if (item.kind === "text") {
      // ⏱️ Respeita text_delay_ms antes do texto.
      // Teto duro de 12s para não estourar o limite de 60s da Edge Function
      // quando uma sequência tem 4+ itens. Consultor que precisa de pausa
      // maior deve quebrar em dois passos.
      if (!isMockMode() && !isFlowInstantMode()) {
        const wait = Math.max(0, Math.min(item.delayMs, 12_000));
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      }
      try {
        await ctx.sender.sendText(ctx.remoteJid, item.text);
        textSentInline = true;
        prevForPause = { kind: "text" };
        // A1: log every inline text in conversations so CRM shows the real step trail
        try {
          if (ctx.customer?.id) {
            await ctx.supabase.from("conversations").insert({
              customer_id: ctx.customer.id,
              message_direction: "outbound",
              message_text: item.text,
              message_type: "text",
              conversation_step: step.step_key,
            });
          }
        } catch (_) { /* noop */ }
      } catch (e) {
        console.error(`[conversational] sendText inline falhou step=${step.step_key}:`, (e as Error)?.message || e);
        try {
          if (ctx.customer?.id) {
            await ctx.supabase.from("conversations").insert({
              customer_id: ctx.customer.id,
              message_direction: "outbound",
              message_text: `[failed:text] ${(e as Error)?.message || e}`,
              message_type: "text_failed",
              conversation_step: step.step_key,
            });
          }
        } catch (_) { /* noop */ }
      }
      continue;
    }

    const m = item.media;
    const kind = item.kind;

    // 🚫 ANTI-DUPLICAÇÃO: reserva no dispatch_log antes de enviar
    if ((kind === "audio" || kind === "video" || kind === "image") && m.id && ctx.customer?.id) {
      const { data: canSend } = await ctx.supabase.rpc("try_log_media_send", {
        _consultant_id: consultantId,
        _customer_id: ctx.customer.id,
        _media_id: m.id,
        _slot_key: slotKey,
        _kind: kind,
      });
      if (canSend === false) {
        console.log(`[conversational] ⏭️ pulando ${kind} já reservado/entregue (media_id=${m.id}) customer=${ctx.customer.id}`);
        continue;
      }
    }

    // ⏱️ Pausa antes da mídia.
    //
    // Regra (ordem de precedência):
    //   1. `delay_before_ms` configurado pelo consultor (teto 12s para não
    //      estourar Edge Function timeout).
    //   2. Pausa derivada do item anterior:
    //      - texto → 800ms (humanização mínima);
    //      - áudio/vídeo com duration_sec → 90% da duração + 600ms de buffer
    //        (teto 12s). Isso garante que o cliente termina de escutar/ver
    //        antes do próximo item chegar — sem essa folga, o WhatsApp
    //        entregava 3-4 mensagens em rajada e a "sensação" era de bot.
    //   3. Item anterior desconhecido → 800ms.
    //
    // O teto duro de 12s evita estourar o limite de 60s da Edge Function
    // mesmo com 5+ mídias na sequência.
    const configuredDelay = Number(m.delay_before_ms || 0);
    if (!isMockMode() && !isFlowInstantMode()) {
      if (configuredDelay > 0) {
        const wait = Math.min(configuredDelay, 12_000);
        await new Promise((r) => setTimeout(r, wait));
      } else if (prevForPause) {
        let pause = 800;
        if ((prevForPause.kind === "audio" || prevForPause.kind === "video") && Number(prevForPause.duration_sec || 0) > 0) {
          pause = Math.min(
            Math.round(Number(prevForPause.duration_sec) * 1000 * 0.9) + 600,
            12_000,
          );
        }
        await new Promise((r) => setTimeout(r, pause));
      }
    }

    mediaAttempted = true;
    // B1: retry media up to 2x with 1500ms gap to ride out Whapi/network blips
    let ok: any = false;
    for (let attempt = 0; attempt < 2; attempt++) {
      ok = await ctx.sender.sendMedia(ctx.remoteJid, m.url, "", kind, Number((m as any).duration_sec || 0) || undefined);
      if (ok !== false) break;
      if (attempt === 0) {
        console.warn(`[conversational] mídia ${kind} falhou (media_id=${m.id}) — retry em 1500ms`);
        if (!isMockMode()) await new Promise((r) => setTimeout(r, 1500));
      }
    }
    if (ok !== false) {
      mediaSent = true;
      await ctx.supabase.from("conversations").insert({
        customer_id: ctx.customer.id,
        message_direction: "outbound",
        message_text: `[flow-step:${step.step_key}:${kind}]`,
        message_type: kind,
        conversation_step: step.step_key,
        media_id: m.id || null,
        slot_key: slotKey || null,
      });
      prevForPause = { kind, duration_sec: m.duration_sec };
    } else {
      mediaFailed = true;
      console.warn(`[conversational] mídia ${kind} falhou após retry (media_id=${m.id}); LIBERANDO reserva para retry futuro`);
      // 🔓 LIBERA a reserva quando o send falhou após retry. Sem isso, a
      // linha em `ai_slot_dispatch_log` com `dispatch_status='sent'` ficava
      // marcada como entregue mesmo sem o cliente ter recebido nada,
      // bloqueando qualquer tentativa futura. A regra: o RPC
      // `try_log_media_send` SÓ representa "entregue de fato" se o sender
      // retornou ok. Falha → delete da reserva → próxima tentativa OK.
      try {
        await ctx.supabase
          .from("ai_slot_dispatch_log")
          .delete()
          .eq("customer_id", ctx.customer.id)
          .eq("media_id", m.id);
      } catch (e) {
        console.warn(`[conversational] falha ao liberar reserva ${m.id}:`, (e as Error)?.message);
      }
      try {
        await ctx.supabase.from("conversations").insert({
          customer_id: ctx.customer.id,
          message_direction: "outbound",
          message_text: `[failed:${kind}] media_id=${m.id}`,
          message_type: `${kind}_failed`,
          conversation_step: step.step_key,
          media_id: m.id || null,
          slot_key: slotKey || null,
        });
      } catch (_) { /* noop */ }
    }
  }

  const mediaResult: boolean | null = medias.length === 0
    ? false
    : (mediaAttempted && mediaFailed && !mediaSent) ? null : mediaSent;
  return { mediaSent: mediaResult, textSentInline };
}

// 🚫 REMOVIDO: fallbackTextForStep — inventava texto fora do /admin/fluxos.
// Regra de ouro: o bot só envia o que o consultor configurou. Se não há
// message_text nem mídia válida, cascateia pelo fallback.goto_step_id.

// Registro do passo atual por turno, populado pelo runConversationalFlow.
// _finalize usa isso para compor uma reentrada quando o reply ficaria vazio,
// evitando silêncio total quando o lead manda algo fora do esperado.
// IMPORTANTE: guardamos também as `vars` p/ renderizar {{nome}}, {{valor_conta}},
// etc. antes de enviar ao lead. Sem isso, o lead recebia placeholder cru.
let _currentTurnStepQuestion: string = "";
// deno-lint-ignore no-explicit-any
let _currentTurnVars: any = {};
let _currentTurnCustomerId: string | null = null;
let _currentTurnMessageText: string = "";
// deno-lint-ignore no-explicit-any
function _setTurnStepQuestion(q: string, vars?: any) {
  _currentTurnStepQuestion = (q || "").trim();
  _currentTurnVars = vars || {};
}

// Detecta saudação no texto do lead e devolve o prefixo correspondente
// no mesmo tom ("Bom dia!", "Boa tarde!", "Boa noite!", "Oi!"). Retorna ""
// quando não há saudação — assim o fluxo segue sem alterações.
function greetingPrefix(text: string): string {
  const t = (text || "").toLowerCase();
  if (!t) return "";
  if (/\bbom\s*dia\b/.test(t)) return "Bom dia!";
  if (/\bboa\s*tarde\b/.test(t)) return "Boa tarde!";
  if (/\bboa\s*noite\b/.test(t)) return "Boa noite!";
  if (/\b(oi+|ol[áa]|opa|e a[íi]|eai|hello|hi)\b/.test(t)) return "Oi!";
  return "";
}
function _extractTail(t: string): string {
  if (!t) return "";
  const cleaned = String(t).replace(/^📋\s*\*?Voltando ao seu cadastro:\*?\s*/i, "").trim();
  const qMatches = cleaned.match(/[^.!?\n]*\?+/g);
  if (qMatches && qMatches.length > 0) return qMatches[qMatches.length - 1].trim();
  const sents = cleaned.split(/(?<=[.!?])\s+/).filter(Boolean);
  return (sents[sents.length - 1] || cleaned).trim();
}

// Guarda em memória da última reentrada por customer, p/ evitar repetir
// a mesma muleta 2x em menos de 60s.
const _lastReentryByCustomer = new Map<string, { tail: string; at: number }>();

// Wrapper de segurança — NUNCA silencia. Se não há reply nem mídia inline,
// devolve a própria pergunta do passo atual (sem prefixo "Boa!"), e suprime
// repetição em menos de 60s pro mesmo cliente.
function _finalize(stepKey: string, r: BotResult): BotResult {
  const reply = (r.reply || "").trim();
  const hasMedia = r.updates?.__inline_sent === true;

  // Saudação contextual: se o lead cumprimentou ("bom dia", "boa noite", etc.),
  // prefixa a resposta no mesmo tom. Não altera o fluxo — só cortesia.
  const greet = greetingPrefix(_currentTurnMessageText);
  const applyGreet = (text: string): string => {
    if (!greet) return text;
    const t = (text || "").trim();
    if (!t) return greet;
    // Evita duplicar se a própria resposta já começa com a mesma saudação.
    if (new RegExp(`^${greet.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i").test(t)) return t;
    return `${greet} ${t}`;
  };

  if (!reply && !hasMedia) {
    const rawTail = _extractTail(_currentTurnStepQuestion);
    // ✅ Renderiza variáveis ({{nome}}, {{valor_conta}}, etc.) e remove
    // qualquer {{...}} residual pra não vazar placeholder cru pro lead.
    let tail = rawTail ? renderTemplate(rawTail, _currentTurnVars || {}) : "";
    tail = tail.replace(/\{\{\s*[^}]+\s*\}\}/g, "").replace(/\s{2,}/g, " ").trim();
    tail = tail.replace(/^[,;:\-\s]+/, "").trim();

    // Sem pergunta no passo atual → não mandar muleta "Tô aqui 👀…".
    // Esse caso acontece em passos ambient (boas vindas, mídia já entregue) e
    // resultava em respostas fora de contexto ("me conta um pouquinho mais…"
    // depois do lead apenas cumprimentar/confirmar).
    if (!tail) {
      console.warn(`[conversational] 🤫 reply vazio em passo sem pergunta → silencioso step=${stepKey}`);
      return { reply: greet || "", updates: { ...r.updates, __suppressed_reentry: true } as any };
    }

    // Suprime repetição da mesma reentrada em curto intervalo.
    const cid = _currentTurnCustomerId;
    if (cid) {
      const prev = _lastReentryByCustomer.get(cid);
      const now = Date.now();
      if (prev && prev.tail === tail && now - prev.at < 60_000) {
        console.warn(`[conversational] 🤫 reentry suprimida (repetida <60s) step=${stepKey}`);
        return { reply: "", updates: { ...r.updates, __suppressed_reentry: true } as any };
      }
      _lastReentryByCustomer.set(cid, { tail, at: now });
    }

    console.warn(`[conversational] ⚠️ reply vazio → reentry com pergunta do passo step=${stepKey}`);
    return { reply: applyGreet(tail), updates: { ...r.updates } };
  }

  // Caso comum: prefixa saudação se aplicável.
  if (reply) return { reply: applyGreet(reply), updates: r.updates };
  // Sem reply mas com mídia: se houve saudação, envia ao menos o "Bom dia!".
  if (greet) return { reply: greet, updates: r.updates };
  return { reply, updates: r.updates };
}

export async function runConversationalFlow(ctx: BotContext): Promise<BotResult> {
  // LGPD opt-out (Fase 3 auditoria): palavra-chave SAIR/PARAR encerra contato.
  const optOut = String(ctx.messageText || "").trim().toUpperCase();
  if (optOut === "SAIR" || optOut === "PARAR" || optOut === "STOP" || optOut === "CANCELAR") {
    try {
      await ctx.supabase.from("customers").update({
        bot_paused: true,
        bot_paused_reason: "opt_out",
        bot_paused_at: new Date().toISOString(),
        do_not_contact: true,
        updated_at: new Date().toISOString(),
      }).eq("id", ctx.customer.id);
    } catch (e) { console.warn("[opt-out] update falhou:", (e as Error).message); }
    return {
      reply: "Tudo bem! Você foi removido da nossa lista de contato e não receberá mais mensagens automáticas. Se mudar de ideia, é só responder aqui. 🙏",
      updates: { bot_paused: true, bot_paused_reason: "opt_out", do_not_contact: true },
    };
  }

  // ⚠️ Quiet hours NÃO se aplica em webhook reativo: o lead mandou
  // mensagem agora e espera resposta. Silêncio noturno só vale para
  // crons proativos (ai-followup-cron, bot-followup-checker, etc.).
  // Removido em 2026-05-28 após customer travar no welcome quando inbound
  // chegou às 22:32 BRT (dentro da janela 21:30-08:00).
  if (isQuietHourBRT() && !shouldBypassQuietHours()) {
    logQuietSkip("conversational_reactive_bypass", {
      customer_id: ctx.customer?.id,
      note: "quiet hours não bloqueia resposta a inbound",
    });
  }
  let stepKey = (ctx.customer.conversation_step || "welcome") as string;
  _currentTurnCustomerId = (ctx.customer?.id as string) || null;
  _currentTurnMessageText = (ctx.messageText as string) || "";


  // Cadastro steps are NEVER handled here — defensive guard
  if (CADASTRO_STEPS.has(stepKey)) {
    return { reply: "", updates: {} };
  }

  // 📸 FIX: foto/documento recebido enquanto o lead ainda está em step
  // conversacional (welcome, qualificacao, flow:*) deve ser tratado como
  // conta de luz IMEDIATAMENTE — vai para o pipeline determinístico de OCR
  // no próximo turno. Sem isso, o lead manda a foto e o bot continua
  // disparando áudios/explicações antigas.
  if (
    (ctx.isFile || ctx.hasImage || ctx.hasDocument) &&
    !(ctx.customer as any).electricity_bill_photo_url &&
    !CADASTRO_STEPS.has(stepKey)
  ) {
    // Task 21: resolve step image_capture configurável do flow do consultor;
    // fallback hardcoded "aguardando_conta" preservado (regressão 3.13/3.23).
    const { resolveImageCaptureStep } = await import("../../../_shared/image-capture-step.ts");
    const targetStep = await resolveImageCaptureStep(ctx.supabase, (ctx.customer as any).consultant_id);
    console.log(`[conversational] 📸 arquivo recebido em step="${stepKey}" → redirecionando para ${targetStep}`);
    try {
      const { runBotFlow } = await import("../bot-flow.ts");
      (ctx.customer as any).conversation_step = targetStep;
      const result = await runBotFlow(ctx);
      return {
        reply: result.reply,
        updates: { ...(result.updates || {}), conversation_step: result.updates?.conversation_step || targetStep, __inline_sent: true },
      };
    } catch (e) {
      console.error("[conversational] falha ao redirecionar p/ bot-flow:", (e as Error)?.message || e);
      return {
        reply: "",
        updates: { conversation_step: targetStep, __inline_sent: true },
      };
    }
  }

  // ─── Dedupe de mensagem: REMOVIDO daqui.
  // O whapi-webhook/index.ts já chama checkAndMarkProcessed() bem antes
  // (instance_name="whapi-superadmin"). Repetir aqui fazia o engine ver
  // a própria gravação anterior como "duplicada" e abortar silenciosamente
  // (reply="", __inline_sent=true), travando 100% dos leads do super admin
  // no welcome. Bug confirmado em 2026-05-19 com leads Michele/Rafael.

  // ─── Detour return: se o lead foi desviado por uma regra goto_step no turno
  // anterior, restaura o passo original ANTES de processar a nova mensagem.
  // Isso garante que ele volte exatamente onde estava no funil.
  const prevStep = (ctx.customer as any).previous_conversation_step as string | null;
  const lastRuleId = (ctx.customer as any).last_rule_id as string | null;
  let restoreDetourUpdates: Record<string, any> = {};
  if (prevStep && lastRuleId && prevStep !== stepKey) {
    console.log(`[conversational] ↩️  restaurando detour: ${stepKey} → ${prevStep}`);
    stepKey = prevStep;
    restoreDetourUpdates = { previous_conversation_step: null, last_rule_id: null };
  }

  // bot_flows / bot_flow_steps / bot_flow_qa use the consultant UUID (customer.consultant_id),
  // NOT the iGreen numeric id (consultorId). Prefer the UUID; fall back to consultorId only as last resort.
  const consultantId = ctx.customer?.consultant_id || (ctx as any).consultorId;
  const flowVariant = (ctx.customer as any)?.flow_variant || "A";
  const loaded = consultantId ? await loadFlow(ctx.supabase, consultantId, flowVariant) : null;
  console.log(`[conversational] entry stepKey="${stepKey}" consultantId=${consultantId} dbSteps=${loaded?.steps?.length ?? 0}`);

  // Fallback to legacy hardcoded machine if no flow seeded
  if (!loaded || loaded.steps.length === 0) {
    console.log(`[conversational] → falling back to LEGACY (no dynamic flow)`);
    return runLegacyConversational(ctx);
  }
  const dbSteps = loaded.steps;
  const flowId = loaded.flowId;
  // Sprint 1.5: OR com kill switch global (settings.strict_script_mode).
  const globalStrict = await isStrictScriptMode().catch(() => false);
  const strictMode = loaded.strictMode || globalStrict;
  if (globalStrict) console.log(`[conversational] 🛑 strict_script_mode=ON (kill switch global)`);

  // ─── Delay inicial configurável (bot_flows.initial_delay_seconds) ────────
  // Só aplica na PRIMEIRA mensagem do lead (step == null ou "welcome") para
  // evitar que o bot responda instantaneamente, o que parece robótico.
  const isFirstMessage =
    !ctx.customer.conversation_step ||
    ctx.customer.conversation_step === "welcome" ||
    ctx.customer.conversation_step === "menu_inicial";
  if (isFirstMessage && !isMockMode() && !isFlowInstantMode()) {
    try {
      const { data: flowRow } = await ctx.supabase
        .from("bot_flows")
        .select("initial_delay_seconds")
        .eq("id", flowId)
        .maybeSingle();
      const delaySec = Math.min(Number((flowRow as any)?.initial_delay_seconds || 0), 300);
      if (delaySec > 0) {
        console.log(JSON.stringify({ level: "info", kind: "flow_initial_delay", customer_id: ctx.customer?.id, flow_id: flowId, delay_seconds: delaySec }));
        // Envia "digitando..." durante o delay para parecer humano
        try { await ctx.sender.sendPresence(ctx.remoteJid, "composing"); } catch (_) { /* ignora */ }
        const renewInterval = 4_000;
        const totalMs = delaySec * 1000;
        let elapsed = 0;
        while (elapsed < totalMs) {
          const chunk = Math.min(renewInterval, totalMs - elapsed);
          await new Promise((r) => setTimeout(r, chunk));
          elapsed += chunk;
          if (elapsed < totalMs) {
            try { await ctx.sender.sendPresence(ctx.remoteJid, "composing"); } catch (_) { /* ignora */ }
          }
        }
        try { await ctx.sender.sendPresence(ctx.remoteJid, "paused"); } catch (_) { /* ignora */ }
      }
    } catch (e) {
      console.warn("[conversational] initial_delay falhou (segue sem delay):", (e as Error).message);
    }
  }

  // Helper: encontra o primeiro step ativo de um determinado step_type
  // (usado para resolver goto_special='cadastro' — preferimos ir para o
  // passo configurado de captura de documento, em vez de pular pra conta).
  const findActiveByType = (t: string) => dbSteps.find((s) => s.is_active && s.step_type === t);

  const firstActiveRaw = dbSteps.find((s) => s.is_active) || dbSteps[0];
  // Lookup robusto: tenta por id (preferido — estável) e por step_key (compat reversa).
  // O orchestrator passa stepKey já com prefixo strippado; pode ser UUID, "passo_xxx" ou nome canônico.
  const currentStepRaw =
    dbSteps.find((s) => s.id === stepKey) ||
    dbSteps.find((s) => s.step_key === stepKey);

  // ─── resolveLandingStep ────────────────────────────────────────────────
  // Se o passo atual existe SÓ pra capturar um dado que já temos (ex: Passo 1
  // pergunta o nome, mas o cliente já se apresentou no welcome), pula pro
  // próximo passo ativo por position. Loop limitado a 5 saltos com visited
  // set pra nunca ciclar. Falha silenciosa: se algo der errado, mantém o
  // passo original (comportamento atual).
  const TRUSTED_NAME_SKIP = new Set([
    "ocr", "ocr_conta", "ocr_doc", "user_confirmed", "self_introduced", "manual",
  ]);
  const stepCapturesField = (s: DbStep, field: string): boolean => {
    if (!Array.isArray(s.captures)) return false;
    return s.captures.some((c: any) => c?.field === field && c?.enabled !== false);
  };
  const isAskOnlyStep = (s: DbStep, field: string): boolean => {
    // O passo é considerado "pergunta este dado" se tem capture habilitada
    // pro field OU se título/slot menciona algo relacionado (heurístico já
    // usado na captura de nome — linhas 665-669).
    if (stepCapturesField(s, field)) return true;
    if (field === "name") {
      return /\bnome\b|\bchama\b/i.test(String((s as any).title || "")) ||
             /\bnome\b/i.test(String((s as any).slot_key || ""));
    }
    return false;
  };
  const isFieldAlreadyCaptured = (field: string, c: any): boolean => {
    if (!c) return false;
    if (field === "name") {
      const v = String(c.name || "").trim();
      if (v.length < 2) return false;
      return TRUSTED_NAME_SKIP.has(String(c.name_source || ""));
    }
    if (field === "electricity_bill_value") {
      const v = Number(c.electricity_bill_value || 0);
      return v > 0;
    }
    if (field === "cpf") {
      const v = String(c.cpf || "").replace(/\D/g, "");
      return v.length === 11;
    }
    if (field === "phone_whatsapp") {
      return !!String(c.phone_whatsapp || "").replace(/\D/g, "");
    }
    return false;
  };
  const resolveLandingStep = (start: DbStep | undefined): DbStep | undefined => {
    if (!start) return start;
    const fields = ["name", "electricity_bill_value", "cpf", "phone_whatsapp"];
    const visited = new Set<string>();
    let cur: DbStep | undefined = start;
    let hops = 0;
    while (cur && !visited.has(cur.id) && hops < 5) {
      visited.add(cur.id);
      // Só pula se TODOS os fields capturados pelo step já estão preenchidos.
      const captured = fields.filter((f) => isAskOnlyStep(cur!, f));
      if (captured.length === 0) return cur;
      const allFilled = captured.every((f) => isFieldAlreadyCaptured(f, ctx.customer));
      if (!allFilled) return cur;
      // Regra de pulo: o passo de NOME pode ser pulado quando o nome já
      // estiver capturado, MAS apenas se o passo não tiver mídia configurada
      // (slot_key). Passos com áudio/vídeo de boas-vindas que também capturam
      // nome devem ser exibidos mesmo assim — o áudio é o conteúdo principal.
      const onlyAsksName = captured.length === 1 && captured[0] === "name";
      const hasMediaSlot = !!(cur.slot_key && String(cur.slot_key).trim());
      const hasText = !!(cur.message_text && String(cur.message_text).trim());
      if (!onlyAsksName || hasMediaSlot) {
        if (hasMediaSlot || hasText) {
          console.log(`[skip-step] mantendo ${cur.step_key} (tem slot_key/texto) mesmo com captura preenchida`);
          return cur;
        }
      }
      const next = dbSteps.find((s) => s.is_active && s.position > cur!.position);
      if (!next) return cur;
      console.log(`[skip-step] from=${cur.step_key} → to=${next.step_key} reason=${captured.join(",")}_already_captured`);
      cur = next;
      hops++;
    }
    return cur;
  };

  let firstActive: DbStep;
  let currentStep: DbStep | undefined;
  try {
    firstActive = resolveLandingStep(firstActiveRaw) || firstActiveRaw;
    currentStep = resolveLandingStep(currentStepRaw) || currentStepRaw;
  } catch (e) {
    console.error("[skip-step] failed, falling back to raw steps", e);
    firstActive = firstActiveRaw;
    currentStep = currentStepRaw;
  }
  // Se resolveLandingStep avançou o passo, sincroniza stepKey para que
  // _finalize salve conversation_step no passo novo (e não no antigo).
  if (currentStep && currentStepRaw && currentStep.id !== currentStepRaw.id) {
    stepKey = currentStep.id;
  }
  // Registra a pergunta do passo atual + vars para o fallback de _finalize.
  const _turnVars = {
    nome: ctx.customer.name,
    representante: ctx.nomeRepresentante,
    valor_conta: (ctx.customer as any).electricity_bill_value,
    telefone: ctx.customer.phone_whatsapp,
    cpf: (ctx.customer as any).cpf,
  };
  _setTurnStepQuestion(currentStep?.message_text || "", _turnVars);
  if (!currentStep) {
    // Unknown/legacy step → restart no primeiro step ativo.
    // REGRA DE OURO: SEMPRE seguir o /admin/fluxos. NUNCA inventar texto.
    // - Se o step tem message_text → usa.
    // - Se está vazio → tenta mídia; se também vazio/falhou, cascateia pelo
    //   fallback.goto_step_id até achar um step com conteúdo real OU um
    //   step que precise esperar resposta (wait_for=reply).
    //
    // 🛡️ ANTI-WELCOME-DUPLICADO (2026-05-28): se já mandamos uma outbound
    // de qualquer passo deste flow nos últimos 30min, NÃO reentra com o
    // welcome inteiro. O lead já recebeu o conteúdo; deve ter sido só
    // demora pra responder. Em vez disso, deixa o motor processar o input
    // contra o passo atual (ou cair no QA/IA se for pergunta livre).
    try {
      if (ctx.customer?.id && firstActive?.step_key) {
        const sinceIso = new Date(Date.now() - 30 * 60 * 1000).toISOString();
        const { data: recentOut } = await ctx.supabase
          .from("conversations")
          .select("conversation_step, created_at")
          .eq("customer_id", ctx.customer.id)
          .eq("message_direction", "outbound")
          .gte("created_at", sinceIso)
          .order("created_at", { ascending: false })
          .limit(5);
        const recentSteps = new Set(((recentOut as any[]) || [])
          .map(r => String((r as any).conversation_step || ""))
          .filter(Boolean));
        if (recentSteps.has(firstActive.step_key)) {
          console.log(`[conversational] 🛡️ anti-welcome-duplicado: outbound do firstActive=${firstActive.step_key} já enviada nos últimos 30min — pulando restart e tratando msg como input do passo atual`);
          // Aponta currentStep para firstActive em memória (sem persistir)
          // pra que o restante do motor processe o input contra ele
          // (transitions, captures, fallback ai_answer).
          currentStep = firstActive;
          stepKey = firstActive.id;
          _setTurnStepQuestion(firstActive.message_text || "", _turnVars);
        }
      }
    } catch (e) {
      console.warn(`[conversational] anti-welcome-duplicado check falhou: ${(e as Error)?.message}`);
    }
  }
  if (!currentStep) {
    console.log(`[conversational] unknown step="${stepKey}" → restart at firstActive=${firstActive?.id} (steps=${dbSteps.length})`);
    const vars = {
      nome: ctx.customer.name,
      representante: ctx.nomeRepresentante,
      valor_conta: (ctx.customer as any).electricity_bill_value,
      telefone: ctx.customer.phone_whatsapp,
      cpf: (ctx.customer as any).cpf,
    };

    let anyMediaSent = false;
    let cursor: DbStep | undefined = firstActive;
    const visited = new Set<string>();
    let landingStepId = firstActive.id;

    while (cursor && !visited.has(cursor.id)) {
      // Skip steps already satisfied (ex: pergunta nome quando self-intro já capturou)
      const resolvedCursor = resolveLandingStep(cursor);
      if (resolvedCursor && resolvedCursor.id !== cursor.id) {
        console.log(`[restart-cascade] skip ${cursor.step_key} → ${resolvedCursor.step_key} (captura já satisfeita)`);
        cursor = resolvedCursor;
        if (visited.has(cursor.id)) break;
      }
      visited.add(cursor.id);
      landingStepId = cursor.id;

      // 🔁 Honra `flow_step_media_order` por step: passa o texto pra sendStepMedia
      // emitir tudo (mídia + texto) no slot configurado pelo consultor. Sem isso,
      // todo o cascade vinha como mídia primeiro e os textos colados no fim.
      const tpl = (cursor.message_text || "").trim();
      const renderedText = tpl ? renderTemplate(tpl, vars) : "";
      const textDelay = Math.max(0, Number((cursor as any).text_delay_ms || 0));
      // 🔘 Se o passo tem botões configurados (captures._buttons), envia o texto
      // como mensagem interativa via sender.sendButtons() — assim o WhatsApp (e o
      // simulador) renderizam os botões reais com IDs do fluxo. Sem isso, o
      // welcome do fluxo D saía como texto puro e sumiam os 3 botões.
      const restartStepButtons = extractStepButtons(cursor);
      const restartWantsButtons = restartStepButtons.length > 0 && !!renderedText;
      const { mediaSent, textSentInline } = await sendStepMedia(
        ctx, cursor, consultantId, true,
        renderedText && !restartWantsButtons ? { text: renderedText, delayMs: textDelay } : null,
      );
      if (mediaSent === true) anyMediaSent = true;
      if (restartWantsButtons) {
        try {
          await ctx.sender.sendButtons(ctx.remoteJid, renderedText, restartStepButtons);
          if (ctx.customer?.id) {
            await ctx.supabase.from("conversations").insert({
              customer_id: ctx.customer.id,
              message_direction: "outbound",
              message_text: renderedText,
              message_type: "text",
              conversation_step: cursor.step_key,
            });
          }
          anyMediaSent = true;
        } catch (e) {
          console.error(`[restart-cascade] sendButtons falhou step=${cursor.step_key} — fallback texto:`, (e as Error)?.message || e);
          try {
            await ctx.sender.sendText(ctx.remoteJid, renderedText);
            anyMediaSent = true;
          } catch (_) { /* noop */ }
        }
      } else if (renderedText && !textSentInline && !mediaSent) {
        // Fallback: step sem mídia E sem ordem configurada → manda como texto puro.
        try {
          await ctx.sender.sendText(ctx.remoteJid, renderedText);
          if (ctx.customer?.id) {
            await ctx.supabase.from("conversations").insert({
              customer_id: ctx.customer.id,
              message_direction: "outbound",
              message_text: renderedText,
              message_type: "text",
              conversation_step: cursor.step_key,
            });
          }
          anyMediaSent = true;
        } catch (e) {
          console.error(`[restart-cascade] sendText fallback falhou step=${cursor.step_key}:`, (e as Error)?.message || e);
        }
      } else if (renderedText && textSentInline) {
        anyMediaSent = true;
      }

      const stepHasContent = !!tpl || mediaSent === true || textSentInline;
      // Para se o step espera resposta do cliente.
      if (cursor.wait_for === "reply" || cursor.wait_for === "media") break;
      // Se este step já entregou conteúdo (texto OU mídia), só cascateia se
      // o próximo tipo for "none" sem espera — preserva a UX configurada.
      const nextId: string | null = cursor.fallback?.mode === "goto" ? (cursor.fallback?.goto_step_id ?? null) : null;
      if (!nextId) break;
      const next: typeof cursor | undefined = dbSteps.find((s: any) => s.id === nextId && s.is_active);
      if (!next) break;
      // Continuamos cascateando enquanto não tivermos NADA para enviar OU
      // enquanto o consultor configurou cascata explícita (wait_for=none).
      if (stepHasContent && cursor.wait_for !== "none") break;
      cursor = next;
    }

    if (!anyMediaSent) {
      console.warn(`[conversational] restart sem conteúdo — step ${landingStepId} sem text/mídia válidos. Mantendo lead no step sem resposta para não inventar texto.`);
    }
    return {
      reply: "",
      updates: { conversation_step: landingStepId, __inline_sent: anyMediaSent || undefined },
    };
  }

  // Nota: a avaliação de bot_flow_rules agora roda DEPOIS de matchTransition
  // (como fallback inteligente, não como primeiro filtro) — ver bloco mais abaixo.

  // ---------------------------------------------------------------------------
  // Capture phase — extract data the consultor configured for this step
  // Roda ANTES do QA e do classifier para que "300 reais" nunca seja roubado
  // por uma pergunta FAQ com phrase "reais".
  // ---------------------------------------------------------------------------
  const captureUpdates: Record<string, any> = {};
  try {
    const extracted = extractCaptures(ctx.messageText || "", currentStep.captures || []);
    if (extracted.electricity_bill_value != null) captureUpdates.electricity_bill_value = extracted.electricity_bill_value;
    // Fallback contextual: se este passo claramente pergunta valor da conta
    // (slot/text/title mencionam valor|conta|luz) e o lead respondeu com um número plausível,
    // captura mesmo sem `captures` configurado e mesmo com texto extra ("200 mas ou menos").
    if (extracted.electricity_bill_value == null && !ctx.customer.electricity_bill_value) {
      const stepHaystack = `${currentStep.message_text || ""} ${(currentStep as any).title || ""} ${currentStep.slot_key || ""}`.toLowerCase();
      const isValueStep = /\bvalor\b|\bconta\b|\bluz\b|electricity|bill/.test(stepHaystack);
      if (isValueStep) {
        const permissive = extractValorPermissivo(ctx.messageText || "");
        if (permissive != null) {
          captureUpdates.electricity_bill_value = permissive;
          console.log(`[capture-fallback] valor=${permissive} via permissivo no step ${currentStep.step_key}`);
        }
      }
    }
    if (extracted.phone_whatsapp && !ctx.customer.phone_whatsapp) captureUpdates.phone_whatsapp = extracted.phone_whatsapp;
    if (extracted.cpf) captureUpdates.cpf = extracted.cpf;
    // Nome: se o passo atual é um "pergunta nome" (título/slot menciona nome,
    // ou tem capture explícita de name habilitada), sobrescreve.
    // Caso contrário, mantém a guarda anti-sobrescrita.
    // EXCEÇÃO CRÍTICA: se name_source vier de OCR (ocr_conta/ocr_doc) ou
    // user_confirmed, NUNCA sobrescreve por captura de texto livre — só os
    // passos editing_* explícitos podem trocar (no bot-flow.ts).
    const TRUSTED_LOCK = new Set(["ocr_conta", "ocr_doc", "user_confirmed"]);
    const nameLocked = TRUSTED_LOCK.has(String((ctx.customer as any).name_source || ""));
    // Detecta pergunta de nome também pela ÚLTIMA outbound — compensa cascade
    // que avança o currentStep antes do lead responder a pergunta anterior.
    let lastOutboundWasNameQuestion = false;
    try {
      const { data: lastOut } = await ctx.supabase
        .from("conversations")
        .select("message_text")
        .eq("customer_id", ctx.customer.id)
        .eq("message_direction", "outbound")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const txt = String((lastOut as any)?.message_text || "");
      lastOutboundWasNameQuestion = /qual\s+(?:é\s+)?(?:o\s+)?(?:seu\s+)?nome|como\s+(?:posso\s+)?(?:te\s+)?(?:chamar|chamo)|me\s+diz\s+(?:seu\s+)?nome/i.test(txt);
    } catch { /* best-effort */ }
    const stepIsAskName =
      lastOutboundWasNameQuestion ||
      /\bnome\b|\bchama\b/i.test(String((currentStep as any).title || "")) ||
      /\bnome\b/i.test(String((currentStep as any).slot_key || "")) ||
      (Array.isArray(currentStep.captures) &&
        currentStep.captures.some((c: any) => c?.field === "name" && c?.enabled !== false));
    // Quando a pergunta foi de nome (passo atual OU última outbound), sobrescreve
    // mesmo whatsapp_profile/freeform_multi anteriores — o nome digitado é mais confiável.
    const currentNameSource = String((ctx.customer as any).name_source || "");
    const weakNameSource = currentNameSource === "" || currentNameSource === "whatsapp_profile" || currentNameSource === "freeform_multi";
    // 🔘 Clique de botão NUNCA é nome — quando ctx.buttonId está presente, o
    // título do botão vinha sendo capturado como name (ex.: "Como funciona"
    // virava nome) e o motor avançava silenciosamente. Skip total.
    const isButtonClick = !!ctx.buttonId;
    // Também ignora texto que bate com título/id de algum botão visível neste passo
    // (lead que digitou em vez de clicar).
    const stepButtonsForCapture = extractStepButtons(currentStep);
    const msgNorm = String(ctx.messageText || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
    const matchesButtonText = stepButtonsForCapture.some((b) => {
      const t = String(b.title || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
      const i = String(b.id || "").toLowerCase().trim();
      return (!!t && (msgNorm === t || msgNorm.includes(t) || t.includes(msgNorm))) || (!!i && msgNorm === i);
    });
    if (extracted.name && !nameLocked && !isButtonClick && !matchesButtonText && (stepIsAskName || !ctx.customer.name || weakNameSource)) {
      captureUpdates.name = extracted.name;
      captureUpdates.name_source = "self_introduced";
      if (stepIsAskName) {
        console.log(`[name-capture] override "${ctx.customer.name || ""}"(${currentNameSource}) → "${extracted.name}" (askName via ${lastOutboundWasNameQuestion ? "last-outbound" : "current-step"})`);
      }
    } else if (extracted.name && (isButtonClick || matchesButtonText)) {
      console.log(`[name-capture] skip — entrada é clique/título de botão (msg="${(ctx.messageText || "").slice(0,40)}" buttonId=${ctx.buttonId || "—"})`);
    }

    if (Object.keys(captureUpdates).length > 0 && ctx.customer.id) {
      await ctx.supabase.from("customers").update(captureUpdates).eq("id", ctx.customer.id);
      // Reflete no objeto em memória pra re-resolver landing step abaixo.
      Object.assign(ctx.customer as any, captureUpdates);
    }

    // Após capturar, re-resolve landing step: se o próximo passo só perguntaria
    // o dado que acabou de chegar, pula automaticamente.
    if (Object.keys(captureUpdates).length > 0) {
      const advanced = resolveLandingStep(currentStep);
      if (advanced && advanced.id !== currentStep.id) {
        console.log(`[skip-step] post-capture: ${currentStep.step_key} → ${advanced.step_key}`);
        currentStep = advanced;
        stepKey = currentStep.id;
      }
    }
  } catch (e) {
    console.error("[conversational] capture phase failed", e);
  }

  // Intents virtuais derivados das capturas (precisamos cedo para suprimir QA/regras).
  const captureIntents: string[] = [];
  if (captureUpdates.electricity_bill_value != null) captureIntents.push("informou_valor", "valor_brl");
  if (captureUpdates.name) captureIntents.push("informou_nome");
  if (captureUpdates.phone_whatsapp) captureIntents.push("informou_telefone");
  if (captureUpdates.cpf) captureIntents.push("informou_cpf");
  const hasCapture = captureIntents.length > 0;

  // ─── Q&A FAQ matching ───────────────────────────────────────────────
  // Pula se a mensagem produziu captura legítima — captura tem prioridade.
  const qaHit = hasCapture ? null : await matchQA(ctx.supabase, flowId, consultantId, ctx.messageText || "");
  if (qaHit) {
    console.log(`[conversational] QA hit at step="${stepKey}"`);
    const qaText = renderTemplate(qaHit.text || "", {
      nome: ctx.customer.name,
      representante: ctx.nomeRepresentante,
      valor_conta: (ctx.customer as any).electricity_bill_value,
      telefone: ctx.customer.phone_whatsapp,
      cpf: (ctx.customer as any).cpf,
    });
    // 🔁 Honra `flow_step_media_order` para o slot virtual __qa__. Se o
    // consultor configurou ordem (ex.: text→audio), respeita; caso contrário,
    // mantém o legado (mídia primeiro, texto depois).
    const order = await getStepMediaOrder(ctx.supabase, consultantId, "__qa__");

    type QaItem =
      | { kind: "text"; text: string }
      | { kind: "audio" | "video" | "image" | "document"; m: { url: string; kind: string; mediaId: string | null } };
    const sequence: QaItem[] = [];

    if (order && order.length > 0) {
      const remaining = [...qaHit.mediaUrls];
      let textInjected = false;
      for (const slot of order) {
        const s = String(slot).toLowerCase();
        if (s === "text") {
          if (qaText && !textInjected) { sequence.push({ kind: "text", text: qaText }); textInjected = true; }
          continue;
        }
        const taken = remaining.filter((m) => String(m.kind).toLowerCase() === s);
        for (const m of taken) {
          const idx = remaining.indexOf(m);
          if (idx >= 0) remaining.splice(idx, 1);
          const k = ["audio", "video", "image"].includes(String(m.kind)) ? String(m.kind) as any : "document";
          sequence.push({ kind: k, m: m as any });
        }
      }
      // Mídias com kind não listado vão ao fim (preserva ordem original).
      for (const m of remaining) {
        const k = ["audio", "video", "image"].includes(String(m.kind)) ? String(m.kind) as any : "document";
        sequence.push({ kind: k, m: m as any });
      }
      if (qaText && !textInjected) sequence.push({ kind: "text", text: qaText });
    } else {
      // Legado: mídia primeiro, texto depois.
      for (const m of qaHit.mediaUrls) {
        const k = ["audio", "video", "image"].includes(String(m.kind)) ? String(m.kind) as any : "document";
        sequence.push({ kind: k, m: m as any });
      }
      if (qaText) sequence.push({ kind: "text", text: qaText });
    }

    let anyEmitted = false;
    for (const item of sequence) {
      if (item.kind === "text") {
        try {
          await ctx.sender.sendText(ctx.remoteJid, item.text);
          anyEmitted = true;
          if (ctx.customer?.id) {
            await ctx.supabase.from("conversations").insert({
              customer_id: ctx.customer.id,
              message_direction: "outbound",
              message_text: item.text,
              message_type: "text",
              conversation_step: stepKey,
            });
          }
        } catch (e) {
          console.error(`[qa] sendText falhou:`, (e as Error)?.message || e);
        }
        continue;
      }
      const m = item.m;
      if ((item.kind === "audio" || item.kind === "video" || item.kind === "image") && m.mediaId) {
        const { data: canSend } = await ctx.supabase.rpc("try_log_media_send", {
          _consultant_id: consultantId,
          _customer_id: ctx.customer.id,
          _media_id: m.mediaId,
          _slot_key: "__qa__",
          _kind: item.kind,
        });
        if (canSend === false) {
          console.log(`[conversational] ⏭️ QA: pulando ${item.kind} já enviado (media_id=${m.mediaId})`);
          continue;
        }
      }
      try {
        await ctx.sender.sendMedia(ctx.remoteJid, m.url, "", item.kind, Number((m as any).duration_sec || 0) || undefined);
        anyEmitted = true;
      } catch (_) {}
    }

    return _finalize(stepKey, {
      reply: "",
      updates: { conversation_step: stepKey, __inline_sent: anyEmitted || undefined, ...restoreDetourUpdates },
    });
  }

  const cls = await classifyIntent(
    ctx.messageText,
    stepKey as ConversationalStep,
    ctx.geminiApiKey,
    { customerId: ctx.customer?.id, consultantId: consultantId || null, traceId: ctx.messageId },
  );

  // Sprint 1.5: honra thresholds de confiança (action=handoff/repeat/execute).
  // - handoff (conf < 0.5): pausa o bot e devolve mensagem neutra; o consultor assume.
  // - repeat  (0.5–0.75): repete o passo atual sem avançar.
  // Quando a intenção é tem_duvida deixamos passar (cai no AI FAQ logo abaixo).
  if (cls.action === "handoff" && cls.intent !== "tem_duvida") {
    console.log(`[conversational] 🤝 baixa confiança (conf=${cls.confidence}) — tentando recuperar ao invés de pausar mudo`);

    const stepButtons = extractStepButtons(currentStep);
    const stepType = String(currentStep.step_type || "message");
    const isCaptureStep = stepType.startsWith("capture_") || stepType === "confirm_phone";
    const refusalCountKey = "ai_followups_count";
    const prevRefusals = Number((ctx.customer as any)[refusalCountKey] || 0);

    // (1) Passo com botões + texto livre → tenta IA mapear pra botão
    if (stepButtons.length > 0 && !ctx.buttonId) {
      const intent = await matchButtonIntent(ctx.messageText || "", stepButtons, {
        apiKey: Deno.env.get("LOVABLE_API_KEY"),
      });
      console.log(`[conversational] button-intent: ${JSON.stringify(intent)}`);

      if (intent.match) {
        // Cliente quis um botão — injeta como se tivesse clicado
        ctx.buttonId = intent.match;
        // Cai pro matchTransition logo abaixo (não retorna aqui)
      } else if (intent.refused) {
        // Recusa explícita → tchau gentil + pausa 24h
        const nome = (ctx.customer as any)?.name || "";
        const saida = `Tranquilo${nome ? `, ${nome}` : ""}! Quando quiser voltar é só me mandar uma mensagem. Tô por aqui 💚`;
        return _finalize(stepKey, {
          reply: saida,
          updates: {
            conversation_step: stepKey,
            bot_paused: true,
            bot_paused_reason: "lead_refused_softpause",
            bot_paused_at: new Date().toISOString(),
            ...restoreDetourUpdates,
          },
        });
      } else if (intent.confused) {
        // Confuso → reenviar passo com nudge; após 2 tentativas, escalar humano
        if (prevRefusals >= 2) {
          try {
            await notifyHandoff(
              consultantId || ctx.customer.consultant_id,
              { id: ctx.customer.id, name: (ctx.customer as any).name, phone_whatsapp: (ctx.customer as any).phone_whatsapp, conversation_step: stepKey },
              ctx.messageText || "",
              "cliente_confuso_botoes",
            ).catch(() => {});
          } catch (_) { /* noop */ }
          return _finalize(stepKey, {
            reply: "Vou chamar alguém do time pra te ajudar — em instantes te respondem por aqui 🙌",
            updates: {
              conversation_step: stepKey,
              bot_paused: true,
              bot_paused_reason: "confused_after_retries",
              bot_paused_at: new Date().toISOString(),
              [refusalCountKey]: 0,
              ...restoreDetourUpdates,
            },
          });
        }
        const btnList = stepButtons.slice(0, 3).map((b, i) => `${i + 1}) ${b.title}`).join("\n");
        const nudge = `Posso te ajudar com qualquer uma destas opções 👇\n\n${btnList}\n\nÉ só tocar no botão ou responder com o número 🙂`;
        return _finalize(stepKey, {
          reply: nudge,
          updates: {
            conversation_step: stepKey,
            [refusalCountKey]: prevRefusals + 1,
            ...restoreDetourUpdates,
          },
        });
      }
    }

    // (2) Passo de captura + texto livre → detecta recusa
    if (isCaptureStep && !ctx.buttonId) {
      const intent = await matchButtonIntent(ctx.messageText || "", [], { apiKey: Deno.env.get("LOVABLE_API_KEY") });
      if (intent.refused) {
        const nome = (ctx.customer as any)?.name || "";
        return _finalize(stepKey, {
          reply: `Tranquilo${nome ? `, ${nome}` : ""}! Quando quiser dar continuidade é só me mandar a foto da conta. Tô por aqui 💚`,
          updates: {
            conversation_step: stepKey,
            bot_paused: true,
            bot_paused_reason: "lead_refused_softpause",
            bot_paused_at: new Date().toISOString(),
            ...restoreDetourUpdates,
          },
        });
      }
    }

    // (3) Sem botões e sem recusa → notifica humano + mensagem amigável (nunca silêncio)
    if (!ctx.buttonId) {
      try {
        await notifyHandoff(
          consultantId || ctx.customer.consultant_id,
          { id: ctx.customer.id, name: (ctx.customer as any).name, phone_whatsapp: (ctx.customer as any).phone_whatsapp, conversation_step: stepKey },
          ctx.messageText || "",
          "low_confidence_handoff",
        ).catch(() => {});
      } catch (_) { /* noop */ }
      return _finalize(stepKey, {
        reply: "Deixa eu chamar alguém do time pra te responder direitinho — já já te respondem por aqui 🙌",
        updates: {
          conversation_step: stepKey,
          bot_paused: true,
          bot_paused_reason: "low_confidence_handoff",
          bot_paused_at: new Date().toISOString(),
          ...restoreDetourUpdates,
        },
      });
    }
    // ctx.buttonId foi injetado pela IA → não retorna; deixa fluxo normal seguir
  }
  // Nota: action="repeat" (confiança média) é tratado implicitamente — se
  // nenhuma transição casar, o fluxo default já é repetir o passo atual.

  // ─── AI Orchestrator (GPT-5.5 + memória persistente + RAG) ─────────
  // Quando o lead faz pergunta (tem_duvida) que NÃO casou em bot_flow_qa
  // E não é uma captura legítima, chama o orquestrador completo
  // (triagem → GPT-5.5 → Gemini 3.1 Pro RAG) com persona do consultor
  // e conversation_summary injetados. Sempre responde quando há reply
  // (mesmo com shouldHandoff) — silenciar a pergunta fazia o lead voltar
  // para "me manda a conta" sem resposta, frustrando a conversa.
  if (cls.intent === "tem_duvida" && !hasCapture) {
    try {
      // Histórico recente para contexto do orquestrador
      const { data: hist } = await ctx.supabase
        .from("conversations")
        .select("message_direction, message_text, created_at")
        .eq("customer_id", ctx.customer.id)
        .order("created_at", { ascending: false })
        .limit(8);
      const recentHistory = ((hist as any[]) || [])
        .slice()
        .reverse()
        .map((r) => `${r.message_direction === "inbound" ? "Lead" : "Bot"}: ${String(r.message_text || "").slice(0, 240)}`)
        .join("\n");

      const { runOrchestrator } = await import("../../../_shared/ai-orchestrator.ts");
      const orch = await runOrchestrator({
        supabase: ctx.supabase,
        customer: ctx.customer,
        consultantId: ctx.customer.consultant_id,
        message: ctx.messageText || "",
        step: stepKey,
        history: recentHistory,
        isButton: !!ctx.buttonId,
        hasMedia: false,
      });

      // Memória persistente: atualiza conversation_summary em background (~6 turnos)
      try {
        const { count: inboundCount } = await ctx.supabase
          .from("conversations")
          .select("id", { count: "exact", head: true })
          .eq("customer_id", ctx.customer.id)
          .eq("message_direction", "inbound");
        const { maybeUpdateSummary } = await import("../../../_shared/ai-summary.ts");
        void maybeUpdateSummary({
          supabase: ctx.supabase,
          customerId: ctx.customer.id,
          consultantId: ctx.customer.consultant_id,
          history: recentHistory,
          customer: ctx.customer,
          inboundTurnCount: inboundCount || 0,
          previousSummary: (ctx.customer as any).conversation_summary || null,
        });
      } catch (_) { /* best-effort */ }

      const answerText = (orch.reply || "").trim();
      if (answerText && orch.confidence >= 0.55) {
        console.log(`[conversational-orch] hit step="${stepKey}" route=${orch.route} conf=${orch.confidence.toFixed(2)} handoff=${orch.shouldHandoff} chain=${orch.modelChain.join("→")}`);

        // Se handoff sugerido, pausa o bot APÓS responder a pergunta
        const handoffUpdates = orch.shouldHandoff
          ? {
              bot_paused: true,
              bot_paused_reason: "ai_handoff_duvidas",
              bot_paused_at: new Date().toISOString(),
            }
          : {};

        if (orch.shouldHandoff) {
          try {
            await notifyHandoff(ctx.supabase, ctx.customer, `Dúvida exigiu humano (passo ${stepKey})`).catch(() => {});
          } catch (_) { /* best-effort */ }
        }

        return _finalize(stepKey, {
          reply: renderTemplate(answerText, {
            nome: ctx.customer.name,
            representante: ctx.nomeRepresentante,
            valor_conta: (ctx.customer as any).electricity_bill_value,
            telefone: ctx.customer.phone_whatsapp,
            cpf: (ctx.customer as any).cpf,
          }),
          updates: {
            conversation_step: stepKey,
            __intent: cls.intent,
            __confidence: cls.confidence,
            __ai_orch: true,
            ...handoffUpdates,
            ...restoreDetourUpdates,
          },
        });
      }
      console.log(`[conversational-orch] miss step="${stepKey}" route=${orch.route} conf=${orch.confidence.toFixed(2)} reply_len=${answerText.length} — fluxo default segue`);
    } catch (e) {
      console.warn("[conversational-orch] erro, ignorando:", (e as Error).message);
    }
  }

  // ─── Saudação ──────────────────────────────────────────────────────
  // "Bom dia/Boa tarde/Boa noite/Oi" não muda o fluxo. _finalize prefixa
  // a resposta no mesmo tom; o lead segue exatamente no passo em que está.



  // 🔒 DETERMINÍSTICO PRIMEIRO: tenta casar o input contra as transitions
  // configuradas no passo atual ANTES de qualquer override global do
  // classificador. Sem isso, um clique como "📸 Quero simular" no
  // d_como_funciona era reclassificado como `quer_cadastrar` e caía no
  // template legacy "me manda a conta de luz", ignorando a transição
  // configurada → d_pedir_conta. Regra de ouro: o consultor configurou →
  // o fluxo segue. IA é só fallback.
  const candidateIntents = [cls.intent, ...detectRegexIntents(ctx.messageText || ""), ...captureIntents];
  const transition = matchTransitionShared({
    transitions: currentStep.transitions ?? [],
    buttonId: ctx.buttonId,
    messageText: ctx.messageText,
    buttons: extractStepButtons(currentStep),
    intents: candidateIntents,
  });

  // (Global overrides quer_cadastrar/quer_humano foram movidos para depois das
  // declarações de goToStep/emitStep/vars — caso contrário, chamar goToStep
  // aqui dispara TDZ "Cannot access 'goToStep' before initialization".)


  const vars = {
    nome: captureUpdates.name || ctx.customer.name,
    representante: ctx.nomeRepresentante,
    valor_conta: captureUpdates.electricity_bill_value ?? (ctx.customer as any).electricity_bill_value,
    telefone: captureUpdates.phone_whatsapp || ctx.customer.phone_whatsapp,
    cpf: captureUpdates.cpf || (ctx.customer as any).cpf,
  };

  // Mapeia step_type especial → primeiro conversation_step do pipeline de cadastro
  const stepTypeToCadastro = (st: string | null | undefined): string | null => {
    if (st === "capture_conta") return "aguardando_conta";
    if (st === "capture_documento") return "aguardando_doc_auto";
    if (st === "capture_email") return "ask_email";
    if (st === "confirm_phone") return "ask_phone_confirm";
    if (st === "finalizar_cadastro") return "ask_finalizar";
    return null;
  };

  // Helper — render and return a step (respeita text_delay_ms configurado no passo)
  // 📐 REGRA: SEMPRE enviar a mídia configurada (áudio/vídeo/imagem) + o texto, se ambos existirem.
  //   - Mídia nunca é suprimida quando existe texto: as duas coisas vão.
  //   - Se a mídia falhou e o step tem texto → manda só o texto.
  //   - Se não tem nem mídia nem texto → cascateia sem inventar nada.
  // Durante cascade (wait_for=none), cada step intermediário é enviado como
  // MENSAGEM SEPARADA via ctx.sender (mídia + texto), e o último vira `reply`.
  const renderStepText = (st: DbStep): string =>
    renderTemplate(st.message_text || "", vars).trim();

  // Envia um step (mídia SEMPRE + texto SEMPRE quando existem), respeitando a ordem configurada.
  const emitStep = async (
    st: DbStep,
    asReply: boolean,
  ): Promise<{ replyText: string; inlineSent: boolean }> => {
    const text = renderStepText(st);
    const defaultTextDelay = isFlowInstantMode() ? 0 : 1500;
    const textDelay = Math.max(0, Math.min(120_000, st.text_delay_ms ?? defaultTextDelay));
    // Botões configurados no passo (captures._buttons). Quando o passo é o
    // reply final do turno, enviamos via sender.sendButtons em vez de texto puro
    // para que o WhatsApp (e o simulador) mostrem os botões reais.
    const stepButtons = asReply ? extractStepButtons(st) : [];
    const wantButtons = stepButtons.length > 0 && !!text;

    // 🛡️ Anti-repetição: se o MESMO step (por step_key OU id) saiu como outbound
    // nos últimos 10 minutos, não reenvia (texto nem mídia). Evita os disparos
    // duplicados de "Vou explicar..." / "Deu para entender..." observados nos logs.
    try {
      const since = new Date(Date.now() - 10 * 60_000).toISOString();
      const { data: recent } = await ctx.supabase
        .from("conversations")
        .select("conversation_step, created_at")
        .eq("customer_id", ctx.customer.id)
        .eq("message_direction", "outbound")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(5);
      const rows: any[] = (recent as any[]) || [];
      // Inclui também o step_key legado mapeado (aguardando_conta, ask_finalizar
      // etc) — sem isso o anti-rep não detecta duplicidade quando o passo emite
      // texto E depois o handler legado registra a mesma outbound com o step
      // cadastro correspondente.
      const _legacyMapped = stepTypeToCadastro(st.step_type);
      const stepIds = new Set<string>([
        st.id,
        st.step_key,
        `flow:${st.id}`,
        `flow:${st.step_key}`,
        ...(_legacyMapped ? [_legacyMapped, `flow:${_legacyMapped}`] : []),
      ]);
      const hit = rows.find((r) => stepIds.has(String(r.conversation_step || "")));
      if (hit) {
        const ageSec = Math.round((Date.now() - new Date(hit.created_at).getTime()) / 1000);
        console.log(`[conversational] 🛡️ anti-rep emitStep ${st.step_key} (saiu há ${ageSec}s) — pulando reenvio`);
        return { replyText: "", inlineSent: true };
      }
      if (text) {
        const normalizedText = text.trim().replace(/\s+/g, " ");
        const { data: recentText } = await ctx.supabase
          .from("conversations")
          .select("message_text, created_at")
          .eq("customer_id", ctx.customer.id)
          .eq("message_direction", "outbound")
          .eq("message_type", "text")
          .gte("created_at", since)
          .order("created_at", { ascending: false })
          .limit(10);
        const duplicateText = ((recentText as any[]) || []).find((r) =>
          String(r.message_text || "").trim().replace(/\s+/g, " ") === normalizedText,
        );
        if (duplicateText) {
          const ageSec = Math.round((Date.now() - new Date(duplicateText.created_at).getTime()) / 1000);
          console.log(`[conversational] 🛡️ anti-rep texto step=${st.step_key} (mesmo texto saiu há ${ageSec}s) — pulando reenvio`);
          return { replyText: "", inlineSent: true };
        }
      }
    } catch (_e) { /* best-effort */ }


    // Quando é reply final, o texto vai como reply (não inline). Quando é cascade
    // ou quando o consultor pediu texto antes da mídia, mandamos tudo inline aqui.
    const slotKey = st.slot_key || st.step_key || st.id;
    const uiOrder = await getStepMediaOrder(ctx.supabase, consultantId, slotKey);
    const stepOrder = Array.isArray(st.media_order) && st.media_order.length > 0
      ? st.media_order.map((k) => String(k).toLowerCase())
      : null;
    const configuredOrder = uiOrder || stepOrder;
    const textComesBeforeAllMedia = !!text && Array.isArray(configuredOrder)
      && configuredOrder.length > 0
      && configuredOrder.indexOf("text") >= 0
      && configuredOrder.every((k, i) => k !== "text" ? configuredOrder.indexOf("text") < i : true);

    // 🎯 BOTÕES NA POSIÇÃO CONFIGURADA (fix 2026-05-28):
    // Se o passo tem botões E a ordem coloca `text` antes das mídias
    // (ex.: [text, audio, image, video]), enviamos texto+botões PRIMEIRO
    // como mensagem interativa e depois as mídias na ordem restante.
    // Sem isso, o motor segurava o texto pro final e ignorava a ordem.
    let earlyButtonsSent = false;
    if (asReply && wantButtons && textComesBeforeAllMedia) {
      try {
        if (textDelay > 0 && !isMockMode()) await new Promise((r) => setTimeout(r, textDelay));
        await ctx.sender.sendButtons(ctx.remoteJid, text, stepButtons);
        if (ctx.customer?.id) {
          await ctx.supabase.from("conversations").insert({
            customer_id: ctx.customer.id,
            message_direction: "outbound",
            message_text: text,
            message_type: "text",
            conversation_step: st.step_key,
          });
        }
        earlyButtonsSent = true;
        console.log(`[conversational] 🎯 early-buttons step=${st.step_key} (text+botões antes das mídias)`);
      } catch (e) {
        console.error(`[conversational] early sendButtons falhou step=${st.step_key} — segue fluxo padrão:`, (e as Error)?.message || e);
      }
    }

    // Texto entra inline (na posição certa) em qualquer caso, EXCETO quando:
    // - é o reply final E não há ordem configurada (mantém comportamento legado)
    // - é o reply final E a ordem termina em "text" (texto fica por último → vira reply)
    // - vamos enviar botões inline no fim (texto vira caption do sendButtons)
    // - já mandamos texto+botões cedo (earlyButtonsSent)
    const orderEndsWithText = Array.isArray(configuredOrder) && configuredOrder.length > 0
      && configuredOrder[configuredOrder.length - 1] === "text";
    const sendTextInline = !!text && !earlyButtonsSent && !wantButtons && (!asReply || !orderEndsWithText && !!configuredOrder);

    let mediaResult: { mediaSent: boolean | null; textSentInline: boolean } =
      { mediaSent: false, textSentInline: false };
    try {
      mediaResult = await sendStepMedia(
        ctx, st, consultantId, false,
        sendTextInline ? { text, delayMs: textDelay } : null,
      );
    } catch (e) {
      console.error(`[conversational] sendStepMedia threw em step=${st.step_key}:`, (e as Error)?.message || e);
      mediaResult = { mediaSent: null, textSentInline: false };
    }
    const mediaSent = mediaResult.mediaSent;
    const inlineMedia = mediaSent === true || earlyButtonsSent;
    console.log(`[conversational] emitStep step=${st.step_key} asReply=${asReply} media=${mediaSent} hasText=${!!text} textInline=${mediaResult.textSentInline} earlyButtons=${earlyButtonsSent} order=${JSON.stringify(configuredOrder)}`);

    // Se já mandamos texto+botões cedo, encerramos aqui (mídias já saíram em sequência).
    if (earlyButtonsSent) {
      return { replyText: "", inlineSent: true };
    }


    if (!text) {
      if (mediaSent === null) {
        console.warn(`[conversational] ⚠️ step=${st.step_key}: mídia falhou e sem texto fallback — continuando cascata`);
      }
      // 🛟 Fallback anti-pulo-silencioso: se o passo não tem texto, nem mídia foi
      // enviada (mediaSent !== true), usa o título do passo como mensagem mínima.
      // Evita que passos "router" (transitions sem conteúdo) avancem invisíveis.
      if (mediaSent !== true && st.title && String(st.title).trim().length > 0) {
        const fallbackText = String(st.title).trim();
        console.warn(`[conversational] 🛟 step=${st.step_key} sem texto/mídia — usando título como fallback: "${fallbackText}"`);
        if (asReply) {
          return { replyText: fallbackText, inlineSent: false };
        }
        try {
          await ctx.sender.sendText(ctx.remoteJid, fallbackText);
          if (ctx.customer?.id) {
            await ctx.supabase.from("conversations").insert({
              customer_id: ctx.customer.id,
              message_direction: "outbound",
              message_text: fallbackText,
              message_type: "text",
              conversation_step: st.step_key,
            });
          }
        } catch (e) {
          console.error(`[conversational] fallback sendText falhou step=${st.step_key}:`, (e as Error)?.message || e);
        }
        return { replyText: "", inlineSent: true };
      }
      return { replyText: "", inlineSent: inlineMedia };
    }

    // Se o texto já foi enviado inline na posição configurada, não devolve replyText.
    if (mediaResult.textSentInline) {
      return { replyText: "", inlineSent: true };
    }

    // Texto ainda não enviado: aplica text_delay e devolve como reply (asReply)
    // ou envia inline como cascade (último recurso, sem ordem configurada).
    if (textDelay > 0 && !isMockMode()) {
      await new Promise((r) => setTimeout(r, textDelay));
    }
    if (asReply) {
      // Se o passo tem botões configurados, envia inline via sendButtons em vez
      // de devolver texto puro — assim o WhatsApp (e o simulador) renderizam
      // os botões clicáveis exatamente como configurado no /admin/fluxos.
      if (wantButtons) {
        try {
          await ctx.sender.sendButtons(ctx.remoteJid, text, stepButtons);
          if (ctx.customer?.id) {
            await ctx.supabase.from("conversations").insert({
              customer_id: ctx.customer.id,
              message_direction: "outbound",
              message_text: text,
              message_type: "text",
              conversation_step: st.step_key,
            });
          }
          return { replyText: "", inlineSent: true };
        } catch (e) {
          console.error(`[conversational] sendButtons falhou step=${st.step_key} — fallback texto:`, (e as Error)?.message || e);
          return { replyText: text, inlineSent: inlineMedia };
        }
      }
      return { replyText: text, inlineSent: inlineMedia };
    }
    try {
      await ctx.sender.sendText(ctx.remoteJid, text);
      // A1: log cascade text in conversations (was silently sent before)
      try {
        if (ctx.customer?.id) {
          await ctx.supabase.from("conversations").insert({
            customer_id: ctx.customer.id,
            message_direction: "outbound",
            message_text: text,
            message_type: "text",
            conversation_step: st.step_key,
          });
        }
      } catch (_) { /* noop */ }
    } catch (e) {
      console.error(`[conversational] cascade sendText falhou step=${st.step_key}:`, (e as Error)?.message || e);
      try {
        if (ctx.customer?.id) {
          await ctx.supabase.from("conversations").insert({
            customer_id: ctx.customer.id,
            message_direction: "outbound",
            message_text: `[failed:text] ${(e as Error)?.message || e}`,
            message_type: "text_failed",
            conversation_step: st.step_key,
          });
        }
      } catch (_) { /* noop */ }
    }
    return { replyText: "", inlineSent: true };
  };

  const goToStep = async (s: DbStep, extra: Record<string, any> = {}) => {
    // text_delay_ms é aplicado dentro de emitStep (após mídia, antes do texto).
    // Não esperamos aqui pra não criar espera dupla antes da mídia.

    const cadastroStep = stepTypeToCadastro(s.step_type);
    let nextConversationStep = cadastroStep || s.id;

    // Decide se este step vai cascatear (wait_for=none). Cascade segue fallback.goto
    // OU, se o consultor deixou repeat/sem goto mas marcou none, próximo por position.
    // GUARD: passos que capturam dados (name/cpf/valor/telefone) SEMPRE esperam resposta,
    // mesmo se configurados como wait_for=none — caso contrário o bot pergunta e cascateia.
    const stepCapturesAnything = Array.isArray(s.captures)
      && s.captures.some((c: any) => c?.enabled !== false && c?.field);
    const effectiveWaitFor = stepCapturesAnything ? "reply" : s.wait_for;
    const hasNextActive = !!dbSteps.find((step) => step.is_active && step.position > s.position);
    const gotoTargetId = s.fallback?.mode === "goto" ? s.fallback?.goto_step_id : null;
    const willCascade = !cadastroStep && effectiveWaitFor === "none"
      && (!!gotoTargetId || hasNextActive);

    const first = await emitStep(s, !willCascade);
    let replyText = first.replyText;
    let inlineSent = first.inlineSent;

    // Se o passo é do tipo cadastro mas o consultor não configurou texto/mídia,
    // emite o prompt padrão para não deixar o lead no escuro.
    if (cadastroStep && !replyText && !inlineSent) {
      if (cadastroStep === "aguardando_conta") {
        replyText = await getTemplate(ctx.supabase, "checkin_pos_video", "pedir_conta", vars);
      } else if (cadastroStep === "aguardando_doc_auto") {
        replyText = "📸 Agora preciso do seu *documento com foto* (RG ou CNH).\n\nEnvie a *frente* do documento.";
      } else if (cadastroStep === "ask_email") {
        replyText = "📧 Me passa seu *e-mail* (pode ser de qualquer provedor — Gmail, Outlook, iCloud, Yahoo...).";
      } else if (cadastroStep === "ask_phone_confirm") {
        replyText = "📞 Esse número é seu telefone de contato?\n\n1️⃣ ✅ Sim\n2️⃣ 📱 Outro número";
      } else if (cadastroStep === "ask_finalizar") {
        replyText = "✅ Tudo pronto! Toque no botão *Finalizar* ou responda *FINALIZAR* para concluir.";
      }
    }

    // Persiste o step alvo ANTES de dispatchar mídia pesada (anti-race entre webhooks paralelos).
    if (ctx.customer?.id) {
      try {
        await ctx.supabase
          .from("customers")
          .update({ conversation_step: nextConversationStep, last_step_advanced_at: new Date().toISOString() })
          .eq("id", ctx.customer.id);
      } catch (_) { /* best-effort */ }
    }

    // Se o passo `message` não tem texto E não enviou nada inline (sem mídia válida),
    // duas situações são possíveis:
    //   (a) passo é puro marcador / mídia já entregue em sessão anterior — devemos
    //       seguir cascateando para o próximo passo (default goto), senão o lead
    //       fica preso recebendo a muleta "Tô aqui 👀…" a cada inbound.
    //   (b) passo realmente espera resposta — para se houver capture ou pergunta.
    // O guard `cursorCascades` mais abaixo já cuida do caso (b).
    const firstIsSilentEmpty = !cadastroStep
      && !replyText
      && !inlineSent
      && !String(s.message_text || "").trim();
    if (firstIsSilentEmpty) {
      console.log(`[cascade-stop-check] pos=${s.position} step=${s.step_key} motivo=step-vazio-sem-midia (avaliando cascata)`);
    }
    // ANTES: cursor = (cadastroStep || firstIsSilentEmpty) ? null : s;
    // AGORA: só cancela cascata em cadastroStep. Se o passo é silent-empty mas
    // tem default goto, deixamos `cursorCascades` decidir (que continua honrando
    // capture/pergunta).
    let cursor: DbStep | null = cadastroStep ? null : s;
    // Helper para achar próximo step. ORDEM DE PRIORIDADE:
    //   1) transitions[default].goto_step_id — configuração explícita do consultor
    //   2) fallback.goto_step_id — somente se não houver transition default
    //   3) próximo por position — último recurso
    // (Antes priorizávamos fallback, o que fazia 5 → 7 pular o 6.)
    const findCascadeNext = (cur: DbStep): DbStep | undefined => {
      const defaultT = Array.isArray(cur.transitions)
        ? cur.transitions.find((t: any) => t?.trigger_intent === "default" && t?.goto_step_id)
        : null;
      if (defaultT?.goto_step_id) {
        const byDefault = dbSteps.find((step) => step.id === defaultT.goto_step_id && step.is_active);
        if (byDefault) return byDefault;
      }
      const gotoId = cur.fallback?.mode === "goto" ? cur.fallback.goto_step_id : null;
      if (gotoId) {
        const byGoto = dbSteps.find((step) => step.id === gotoId && step.is_active);
        if (byGoto) return byGoto;
      }
      return dbSteps.find((step) => step.is_active && step.position > cur.position);
    };
    // C1: guard reduzido (6→3) e cada hop com timeout — se a Edge Function
    // estourar 20s, perdíamos passos no meio da cascata sem deixar rastro.
    // Heurística: passo cujo texto termina em "?" é uma pergunta — aguarda resposta
    // mesmo se o consultor marcou wait_for=none por descuido.
    const _looksLikeQuestion = (st: DbStep): boolean =>
      String(st?.message_text || "")
        .trim()
        .replace(/[\s\u200B-\u200D\uFEFF]+$/g, "")
        .endsWith("?");
    // Captura textual (kind=text) ou com field — qualquer uma exige espera por resposta.
    const _hasTextCapture = (st: DbStep): boolean =>
      Array.isArray(st.captures) && st.captures.some((c: any) =>
        c?.enabled !== false && (c?.field || c?.kind === "text" || c?.name === "resposta_texto")
      );
    const cursorCascades = (st: DbStep): boolean => {
      if (_hasTextCapture(st)) return false;
      if (st.wait_for !== "none") return false;
      if (_looksLikeQuestion(st)) return false;
      return true;
    };
    // 🛟 Anti-silêncio: se o primeiro emitStep não produziu texto NEM mídia
    // (passo vazio configurado pelo consultor), força UMA cascata mesmo se
    // wait_for !== 'none' — caso contrário o lead fica sem resposta nenhuma.
    const forceFirstHop = !replyText && !inlineSent && cursor
      && !_hasTextCapture(cursor) && !_looksLikeQuestion(cursor);
    for (let guard = 0; cursor && (cursorCascades(cursor) || (guard === 0 && forceFirstHop)) && guard < 3; guard++) {
      const nextStep = findCascadeNext(cursor);
      if (!nextStep) {
        console.log(`[conversational] cascade parou em step=${cursor.step_key} (sem próximo step ativo)`);
        break;
      }
      if (nextStep.id === cursor.id) {
        console.warn(`[conversational] cascade quebrada step=${cursor.step_key} aponta para si mesmo`);
        break;
      }

      const cascadeCadastroStep = stepTypeToCadastro(nextStep.step_type);
      // Se o próximo passo parece pergunta, emite uma vez e para — não cascateia além.
      const nextIsQuestion = !cascadeCadastroStep && _looksLikeQuestion(nextStep);
      const nextWillCascade = !cascadeCadastroStep && !nextIsQuestion
        && nextStep.wait_for === "none"
        && !!findCascadeNext(nextStep);

      // PERSIST FIRST: marca o lead já no nextStep ANTES de enviar mídia pesada.
      // Se o envio demorar e a Edge Function reentrar, não regredimos pro passo
      // anterior nem reprocessamos a captura.
      nextConversationStep = cascadeCadastroStep || nextStep.id;
      if (ctx.customer?.id) {
        try {
          await ctx.supabase
            .from("customers")
            .update({ conversation_step: nextConversationStep, last_step_advanced_at: new Date().toISOString() })
            .eq("id", ctx.customer.id);
        } catch (_) { /* noop */ }
      }

      // Timeout ampliado para 30s — vídeos/áudios pesados (boas_vindas/como_funciona)
      // chegam a levar 15-25s de upload+envio. Se passar de 30s, paramos cascade
      // mas o lead já está persistido no passo correto.
      let emit: { replyText: string; inlineSent: boolean };
      try {
        emit = await Promise.race([
          emitStep(nextStep, !nextWillCascade),
          new Promise<{ replyText: string; inlineSent: boolean }>((_r, rej) =>
            setTimeout(() => rej(new Error("cascade_hop_timeout")), 30_000),
          ),
        ]);
      } catch (e) {
        console.warn(`[conversational] ⏱️ cascade hop timeout em ${nextStep.step_key} (lead persistido em ${nextConversationStep})`);
        break;
      }

      if (emit.replyText) replyText = emit.replyText;
      inlineSent = inlineSent || emit.inlineSent;
      console.log(`[conversational] auto-cascade ${cursor.step_key} → ${nextStep.step_key} (wait_for=${nextStep.wait_for})`);

      // G1: telemetria por hop — sem isso parece que pulamos passos.
      try {
        await ctx.supabase.from("bot_step_transitions").insert({
          customer_id: ctx.customer?.id || null,
          consultant_id: consultantId,
          phone: ctx.remoteJid?.replace(/\D/g, "") || null,
          from_step: cursor.step_key,
          to_step: nextStep.step_key,
          intent: "cascade",
        });
      } catch (_) { /* noop */ }

      if (cascadeCadastroStep) break;
      if (nextIsQuestion) {
        console.log(`[cascade-stop] pos=${nextStep.position} step=${nextStep.step_key} motivo=pergunta(text ends with ?)`);
        cursor = nextStep;
        break;
      }
      cursor = nextStep;
    }

    // 🔄 Reset de contadores de retry quando o lead avança para outro step.
    // Se o customer estava em retry-mode num step diferente do atual, zera
    // contadores antes de persistir (Property 5 / Requirements 1.5, 4.3).
    const customerRetriesStep = String((ctx.customer as any).custom_step_retries_step || "");
    if (customerRetriesStep && customerRetriesStep !== s.id) {
      console.log(`[conversational] retry-counters-reset step=${s.step_key}`);
      extra = {
        ...extra,
        custom_step_retries: 0,
        custom_step_retries_step: null,
      };
    }

    return {
      reply: replyText,
      updates: { conversation_step: nextConversationStep, __intent: cls.intent, __confidence: cls.confidence, ...captureUpdates, __inline_sent: inlineSent || undefined, ...extra },
    };
  };

  // Global overrides: cadastro / humano só vencem se NÃO houver transição
  // configurada para esse input no passo atual. (Movido para depois de goToStep
  // por causa de TDZ — antes disso a função ainda não está inicializada.)
  if (!transition && cls.intent === "quer_cadastrar") {
    const docStep = dbSteps.find((s) => s.is_active && s.step_type === "capture_documento");
    if (docStep) {
      return _finalize(stepKey, await goToStep(docStep, restoreDetourUpdates));
    }
    return _finalize(stepKey, {
      reply: await getTemplate(ctx.supabase, "checkin_pos_video", "pedir_conta", {
        nome: ctx.customer.name, representante: ctx.nomeRepresentante,
      }),
      updates: { conversation_step: "aguardando_conta", __intent: cls.intent, __confidence: cls.confidence, ...captureUpdates, ...restoreDetourUpdates },
    });
  }
  if (!transition && cls.intent === "quer_humano") {
    return _finalize(stepKey, {
      reply: await getTemplate(ctx.supabase, "aguardando_humano", "avisado", {
        nome: ctx.customer.name, representante: ctx.nomeRepresentante,
      }),
      updates: { conversation_step: "aguardando_humano", __intent: cls.intent, __confidence: cls.confidence, ...captureUpdates, ...restoreDetourUpdates },
    });
  }

  // Repeat inteligente: se a MESMA pergunta já foi enviada nos últimos 90s,
  // manda uma reformulação curta em vez de repetir literal (sem reenviar mídia).
  // Isso evita o "disco riscado" que o lead vê quando responde algo fora do esperado.
  const repeatCurrent = async (): Promise<BotResult> => _smartRepeat();
  const _smartRepeat = async (): Promise<BotResult> => {
    // GUARD 0: se este turno extraiu QUALQUER dado válido, NUNCA reformula —
    // significa que o lead respondeu e devemos avançar via fluxo (não nudge).
    if (Object.keys(captureUpdates).length > 0) {
      console.log(`[smart-repeat] skip nudge — captureUpdates=${Object.keys(captureUpdates).join(",")} (avança via fluxo)`);
      return { reply: "", updates: { conversation_step: currentStep.id, ...captureUpdates, ...restoreDetourUpdates, __inline_sent: true } };
    }
    // GUARD 1: debounce — se houve outbound nos últimos 30s, não nudge.
    try {
      const sinceDebounce = new Date(Date.now() - 30_000).toISOString();
      const { count: recentOut } = await ctx.supabase
        .from("conversations")
        .select("id", { count: "exact", head: true })
        .eq("customer_id", ctx.customer.id)
        .eq("message_direction", "outbound")
        .gte("created_at", sinceDebounce);
      if ((recentOut ?? 0) > 0) {
        return { reply: "", updates: { conversation_step: currentStep.id, ...restoreDetourUpdates } };
      }
    } catch (_) { /* segue */ }
    const baseText = renderStepText(currentStep);
    if (!baseText) return goToStep(currentStep, restoreDetourUpdates);
    let lastSameTextCount = 0;
    try {
      const since = new Date(Date.now() - 90_000).toISOString();
      const { data: recent } = await ctx.supabase
        .from("conversations")
        .select("message_text, message_type")
        .eq("customer_id", ctx.customer.id)
        .eq("message_direction", "outbound")
        .eq("message_type", "text")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(5);
      lastSameTextCount = ((recent as any[]) || []).filter(
        (r) => (r.message_text || "").trim() === baseText.trim(),
      ).length;
    } catch (_) { /* segue normal */ }

    if (lastSameTextCount === 0) {
      return goToStep(currentStep, restoreDetourUpdates);
    }

    // Já mandou esse texto nos últimos 90s → reformula, SEM reenviar mídia.
    // Sprint C4: pool ampliado + fallback de escalonamento quando esgotar
    const userName = vars.nome || ctx.customer.name || "";
    const reformVariants: Record<string, string[]> = {
      default: [
        "Pode me responder, por favor? 🙂",
        "Tô aqui esperando sua resposta 😉",
        "Me conta aí, posso te ajudar!",
        userName ? `${userName}, me dá um retorno rapidinho? 🙏` : "Me dá um retorno rapidinho? 🙏",
        "Posso continuar? É só responder aqui 😊",
        "Sem pressa, mas se puder me responder eu sigo o atendimento 🙂",
      ],
      valor: [
        userName ? `${userName}, me passa só o valor médio da conta de luz, por favor? Pode ser aproximado 😉` : "Me passa só o valor médio da conta de luz, por favor? Pode ser aproximado 😉",
        "Quanto vem em média sua conta de luz? Tipo R$ 200, R$ 400...",
        "Pode mandar só o número mesmo, ex: 350 🙏",
        "Me diz uma média da conta — não precisa ser exato, ok?",
        "Quanto você paga mais ou menos por mês de luz?",
      ],
      nome: [
        "Como posso te chamar? Só seu primeiro nome já tá ótimo 😊",
        "Me conta seu nome, por favor 🙂",
        "Qual seu nome? Pode ser só o primeiro 😉",
        "Me diz seu nome pra eu te chamar direitinho 🙏",
      ],
    };
    const stepKeyLower = (currentStep.title || currentStep.step_key || "").toLowerCase();
    const variantKey = /valor|conta/.test(stepKeyLower)
      ? "valor"
      : /nome|chama/.test(stepKeyLower)
      ? "nome"
      : "default";
    const pool = reformVariants[variantKey];

    // Esgotou o pool (5+ repetições da mesma pergunta) → escala silenciosamente pra humano
    if (lastSameTextCount >= pool.length) {
      console.warn(`[smart-repeat] pool esgotado em "${currentStep.step_key}" após ${lastSameTextCount} repetições — escalando`);
      try {
        await ctx.supabase.from("bot_handoff_alerts").insert({
          customer_id: ctx.customer.id,
          consultant_id: ctx.customer.consultant_id,
          reason: "lead_nao_responde",
          metadata: { step: currentStep.step_key, repetitions: lastSameTextCount },
        });
      } catch (_) { /* noop */ }
      return {
        reply: userName ? `${userName}, vou pedir pra um consultor humano te chamar daqui a pouco, ok? 🤝` : "Vou pedir pra um consultor humano te chamar daqui a pouco, ok? 🤝",
        updates: {
          conversation_step: currentStep.id,
          bot_paused: true,
          bot_paused_reason: "lead_nao_responde",
          bot_paused_at: new Date().toISOString(),
          __intent: cls.intent,
          __confidence: cls.confidence,
          ...captureUpdates,
          ...restoreDetourUpdates,
        },
      };
    }
    const reform = pool[Math.min(lastSameTextCount - 1, pool.length - 1)];

    return {
      reply: reform,
      updates: {
        conversation_step: currentStep.id,
        __intent: cls.intent,
        __confidence: cls.confidence,
        ...captureUpdates,
        ...restoreDetourUpdates,
      },
    };
  };

  // Resolve a transition (special or step) — sempre propaga restoreDetourUpdates
  // para limpar flags de detour quando o lead seguir o fluxo normal.
  const resolveTransition = async (t: DbTransition): Promise<BotResult> => {
    if (t.goto_special === "cadastro") {
      const docStep = findActiveByType("capture_documento");
      if (docStep) return goToStep(docStep, restoreDetourUpdates);
      const contaStep = findActiveByType("capture_conta");
      if (contaStep) return goToStep(contaStep, restoreDetourUpdates);
      return {
        reply: await getTemplate(ctx.supabase, "checkin_pos_video", "pedir_conta", vars),
        updates: { conversation_step: "aguardando_conta", sales_phase: "fechamento", __intent: cls.intent, __confidence: cls.confidence, ...captureUpdates, ...restoreDetourUpdates },
      };
    }
    if (t.goto_special === "humano") {
      return {
        reply: await getTemplate(ctx.supabase, "aguardando_humano", "avisado", vars),
        updates: { conversation_step: "aguardando_humano", __intent: cls.intent, __confidence: cls.confidence, ...captureUpdates, ...restoreDetourUpdates },
      };
    }
    if (t.goto_special === "repeat" || (!t.goto_step_id && !t.goto_special)) return repeatCurrent();
    const nextStep = dbSteps.find((s) => s.id === t.goto_step_id);
    if (!nextStep || !nextStep.is_active) {
      // 🩹 AUTO-CURA: quando o consultor configurou goto_step_id órfão (step
      // deletado/duplicado/movido entre variantes), em vez de fazer
      // repeatCurrent silencioso (que prende o lead pra sempre), pula pro
      // próximo step ativo por position e loga. Sem isso, fluxos editados
      // travam o lead em silêncio com o bot esperando resposta inalcançável.
      const fallbackByPos = dbSteps.find(
        (s) => s.is_active && s.position > currentStep.position,
      );
      console.warn(
        `[flow-orphan-goto] consultor=${ctx.customer.consultant_id} ` +
        `step="${currentStep.step_key}" goto_step_id="${t.goto_step_id}" não existe/inativo. ` +
        `${fallbackByPos ? `Auto-curando para "${fallbackByPos.step_key}" (pos ${fallbackByPos.position}).` : "Nenhum próximo step ativo. Repetindo."}`,
      );
      try {
        await ctx.supabase.from("bot_step_transitions").insert({
          customer_id: ctx.customer.id,
          consultant_id: ctx.customer.consultant_id,
          from_step: currentStep.step_key,
          to_step: fallbackByPos?.step_key ?? currentStep.step_key,
          reason: `orphan_goto:${String(t.goto_step_id).slice(0, 8)}`,
          intent: "auto_cure",
        } as any);
      } catch (_) { /* best-effort */ }
      if (!fallbackByPos) return repeatCurrent();
      if (fallbackByPos.step_key === "cadastro" || CADASTRO_STEPS.has(fallbackByPos.step_key)) {
        const docStep = findActiveByType("capture_documento");
        if (docStep) return goToStep(docStep, restoreDetourUpdates);
      }
      return goToStep(fallbackByPos, restoreDetourUpdates);
    }
    if (nextStep.step_key === "cadastro" || CADASTRO_STEPS.has(nextStep.step_key)) {
      const docStep = findActiveByType("capture_documento");
      if (docStep) return goToStep(docStep, restoreDetourUpdates);
      return {
        reply: await getTemplate(ctx.supabase, "checkin_pos_video", "pedir_conta", vars),
        updates: { conversation_step: "aguardando_conta", sales_phase: "fechamento", __intent: cls.intent, __confidence: cls.confidence, ...captureUpdates, ...restoreDetourUpdates },
      };
    }
    return goToStep(nextStep, restoreDetourUpdates);
  };

  // Helper: emite o conteúdo do passo atual (slot/texto) ANTES de pular para o
  // próximo. Evita pular passos com áudio/vídeo configurados quando o motor
  // auto-avança por captura/posição/default transition. O anti-rep interno do
  // emitStep (10 min) protege contra duplicidade se já foi emitido nesta sessão.
  const emitCurrentBeforeGoto = async (cur: DbStep, next: DbStep) => {
    if (!cur || !next || cur.id === next.id) return;
    const hasSlot = !!(cur.slot_key && String(cur.slot_key).trim());
    const hasText = !!(cur.message_text && String(cur.message_text).trim());
    if (!hasSlot && !hasText) return;
    try {
      console.log(`[emit-before-goto] emitindo "${cur.step_key}" antes de avançar para "${next.step_key}"`);
      await emitStep(cur, false);
    } catch (e) {
      console.warn(`[emit-before-goto] falhou em ${cur.step_key}:`, (e as Error)?.message || e);
    }
  };

  // 1) A regular rule matched
  if (transition) return _finalize(stepKey, await resolveTransition(transition));


  // 1.5) Captura sem transição configurada → segue o Plano B configurado
  // (PREFERE fallback.goto_step_id — é o que o consultor configurou em /admin/fluxos).
  // Só cai pra próximo por posição como último recurso.
  if (hasCapture) {
    let nextByConfig: DbStep | undefined;
    // PRIORIDADE: fallback.success_goto_step_id (override pós-captura-sucesso configurado pelo admin)
    // → fallback.goto_step_id (modo goto tradicional)
    // → próximo por position (último recurso).
    const successId = (currentStep.fallback as any)?.success_goto_step_id || null;
    const fbId = currentStep.fallback?.mode === "goto" ? currentStep.fallback.goto_step_id : null;
    const preferredId = successId || fbId;
    if (preferredId) nextByConfig = dbSteps.find((s) => s.is_active && s.id === preferredId);
    if (!nextByConfig) {
      nextByConfig = dbSteps.find((s) => s.is_active && s.position > currentStep.position);
    }
    if (nextByConfig) {
      console.log(`[conversational] auto-advance por captura ${currentStep.step_key} → ${nextByConfig.step_key} (intents=${captureIntents.join(",")}, source=${successId ? "fallback.success_goto" : fbId ? "fallback.goto" : "position"})`);
      if (nextByConfig.step_key === "cadastro" || CADASTRO_STEPS.has(nextByConfig.step_key)) {
        const docStep = findActiveByType("capture_documento");
        if (docStep) return _finalize(stepKey, await goToStep(docStep, restoreDetourUpdates));
        return _finalize(stepKey, {
          reply: await getTemplate(ctx.supabase, "checkin_pos_video", "pedir_conta", vars),
          updates: { conversation_step: "aguardando_conta", sales_phase: "fechamento", __intent: cls.intent, __confidence: cls.confidence, ...captureUpdates, ...restoreDetourUpdates },
        });
      }
      try {
        await emitCurrentBeforeGoto(currentStep, nextByConfig);
        return _finalize(stepKey, await goToStep(nextByConfig, restoreDetourUpdates));
      } catch (e) {
        console.error(`[conversational] 💥 goToStep falhou para ${nextByConfig.step_key}:`, (e as Error)?.message || e);
        // Salva pelo menos o avanço de step para não travar o lead no passo anterior.
        return _finalize(stepKey, {
          reply: "",
          updates: { conversation_step: nextByConfig.id, __inline_sent: true, ...captureUpdates, ...restoreDetourUpdates },
        });
      }
    }
  }

  // 1.75) GLOBAL KEYWORD RULES — removido em Sprint 2.5 (bot_flow_rules = 0).
  //       Para reativar: restaurar rules-engine.ts e o bloco evaluateRules aqui.


  // 2) FALLBACK (Plano B)
  const fb = currentStep.fallback || { mode: "repeat" };
  if (fb.mode === "goto" && fb.goto_step_id) {
    const nextStep = dbSteps.find((s) => s.id === fb.goto_step_id);
      if (nextStep && nextStep.is_active) {
        const nextIsMediaOnly = !String(nextStep.message_text || "").trim();
        // Só bloqueia o goto se o passo atual realmente exige uma captura "dura"
        // (com field obrigatório), não qualquer capture textual opcional.
        // Caso contrário, passos message→message (boas-vindas → vídeo) ficavam
        // travados aguardando uma "resposta" que nunca era exigida pelo consultor.
        const requiresHardCapture = Array.isArray(currentStep.captures)
          && currentStep.captures.some((c: any) =>
            c?.enabled !== false && !!c?.field && c?.required !== false
          );
        if (requiresHardCapture && !hasCapture && nextIsMediaOnly) {
          console.log(`[conversational] fallback goto bloqueado: step=${stepKey} exige captura antes de ${nextStep.step_key}`);
          return _finalize(stepKey, await repeatCurrent());
        }
      if (nextStep.step_key === "cadastro" || CADASTRO_STEPS.has(nextStep.step_key)) {
        return _finalize(stepKey, {
          reply: await getTemplate(ctx.supabase, "checkin_pos_video", "pedir_conta", vars),
          updates: { conversation_step: "aguardando_conta", sales_phase: "fechamento", __intent: cls.intent, __confidence: cls.confidence, ...captureUpdates, ...restoreDetourUpdates },
        });
      }
      await emitCurrentBeforeGoto(currentStep, nextStep);
      return _finalize(stepKey, await goToStep(nextStep, restoreDetourUpdates));
    }
  }
  // Sprint A2: passo terminal nunca deve cair no fallback AI nem voltar pra cadastro —
  // o lead já está finalizando. Mantém no passo, sem regredir para documento/conta.
  if (currentStep.step_type === "finalizar_cadastro") {
    console.log(`[conversational] terminal step ${currentStep.step_key} → mantendo (sem regressão)`);
    return _finalize(stepKey, {
      reply: "",
      updates: { conversation_step: currentStep.id, __inline_sent: true, ...captureUpdates, ...restoreDetourUpdates },
    });
  }

  // 🆕 fb.mode === "retry" — implementação validada via PBT (Property 1-5)
  // Honra a configuração do FluxoBuilder: envia retry_text, conta tentativas e
  // escala via fb.then ("humano" | "next" | "repeat") quando excede max_retries.
  if (fb.mode === "retry") {
    const maxRetries = Math.max(1, Number(fb.max_retries ?? 2));
    const sameStep = String((ctx.customer as any).custom_step_retries_step || "") === currentStep.id;
    const prevCount = sameStep ? Number((ctx.customer as any).custom_step_retries || 0) : 0;
    const newCount = prevCount + 1;

    console.log(
      `[conversational] retry-mode step=${currentStep.step_key} ` +
      `attempt=${newCount}/${maxRetries} prev=${prevCount} sameStep=${sameStep}`,
    );

    // Esgotou retries
    if (newCount > maxRetries) {
      const then = String(fb.then || "humano");

      if (then === "humano") {
        const handoffText = await getTemplate(
          ctx.supabase, "aguardando_humano", "avisado",
          { nome: ctx.customer.name, representante: ctx.nomeRepresentante },
        );
        try {
          await ctx.supabase.from("bot_handoff_alerts").insert({
            customer_id: ctx.customer.id,
            consultant_id: ctx.customer.consultant_id,
            reason: `${currentStep.step_key}_retry_exhausted`,
            metadata: {
              step: currentStep.step_key,
              retries: newCount,
              max: maxRetries,
              fallback: fb,
            },
          });
        } catch (_) { /* best-effort */ }
        return _finalize(stepKey, {
          reply: handoffText,
          updates: {
            conversation_step: "aguardando_humano",
            bot_paused: true,
            bot_paused_reason: `${currentStep.step_key}_retry_exhausted`,
            bot_paused_at: new Date().toISOString(),
            custom_step_retries: 0,
            custom_step_retries_step: null,
            ...captureUpdates,
            ...restoreDetourUpdates,
          },
        });
      }

      if (then === "next") {
        const nextByPos = dbSteps.find((s) => s.is_active && s.position > currentStep.position);
        if (nextByPos) {
          return _finalize(stepKey, await goToStep(nextByPos, {
            ...restoreDetourUpdates,
            custom_step_retries: 0,
            custom_step_retries_step: null,
          }));
        }
        // Sem próximo → cai pra repeat (envia retry_text uma última vez)
      }
      // then === "repeat" → continua para enviar retry_text abaixo
    }

    // Envia retry_text e incrementa contador
    const retryText = String(
      fb.retry_text ||
      renderStepText(currentStep) ||
      "Pode me responder, por favor? 🙂",
    );
    return _finalize(stepKey, {
      reply: retryText,
      updates: {
        conversation_step: currentStep.id,
        custom_step_retries: newCount,
        custom_step_retries_step: currentStep.id,
        __intent: cls.intent,
        __confidence: cls.confidence,
        ...captureUpdates,
        ...restoreDetourUpdates,
      },
    });
  }

  // 🤖 ai_answer: IA responde a pergunta do lead INLINE e mantém o passo.
  // Diferente do mode='ai' que ESCOLHE próximo step, esse responde a dúvida
  // e fica no passo (lead clica em botão pra avançar). Usado no bloco
  // duvidas_ia dos templates de fluxo.
  if (fb.mode === "ai_answer" && fb.ai_prompt && !strictMode && (ctx.messageText || "").trim()) {
    try {
      const { generateAiAnswer } = await import("../../../_shared/ai-answer.ts");
      const profile = await (async () => {
        try {
          const { getConsultantAiProfile, getConsultantAiProvider } = await import("../../../_shared/ai-config.ts");
          const [p, pr] = await Promise.all([
            getConsultantAiProfile(ctx.supabase, consultantId || ""),
            getConsultantAiProvider(ctx.supabase, consultantId || ""),
          ]);
          return { profile: p, provider: pr };
        } catch (_) {
          return { profile: "balanced" as const, provider: "google" as const };
        }
      })();
      const aiText = await generateAiAnswer({
        supabase: ctx.supabase,
        consultantId: consultantId || "global",
        systemPrompt: String(fb.ai_prompt),
        userQuestion: String(ctx.messageText || ""),
        knowledgeContext: { customer: ctx.customer },
        profile: profile.profile,
        provider: profile.provider,
        timeoutMs: 8000,
      });
      if (aiText && aiText.trim()) {
        // Envia a resposta e MANTÉM o lead no mesmo passo (after_ai='stay').
        // Lead clica num botão (transitions configuradas) pra avançar.
        try {
          await ctx.sender.sendText(ctx.remoteJid, aiText);
          await ctx.supabase.from("conversations").insert({
            customer_id: ctx.customer.id,
            message_direction: "outbound",
            message_text: aiText,
            message_type: "text",
            conversation_step: currentStep.step_key,
          });
        } catch (e) {
          console.warn("[ai_answer] sendText falhou:", (e as any)?.message);
        }
        return _finalize(stepKey, {
          reply: "",
          updates: {
            conversation_step: currentStep.id,
            __inline_sent: true,
            ...captureUpdates,
            ...restoreDetourUpdates,
          },
        });
      }
    } catch (e) {
      console.warn("[ai_answer] erro, caindo no fallback genérico:", (e as Error).message);
    }
    // se IA falhou, cai no comportamento padrão (repeatCurrent)
    return _finalize(stepKey, await repeatCurrent());
  }

  if (fb.mode === "ai" && fb.ai_prompt && !strictMode) {
    const candidates = dbSteps.filter(s => s.is_active && s.id !== currentStep.id).map(s => ({ id: s.id, step_key: s.step_key }));
    const choice = await aiDecideFallback(fb.ai_prompt, ctx.messageText || "", candidates, ctx.geminiApiKey, consultantId || "global", ctx.supabase);
    if (choice) {
      // Cláusula 2.19 + 2.31: rebaixar para REPEAT se a escolha do LLM
      // não for alcançável a partir do passo atual (transitions + goto_special)
      // OU se violar precondição conhecida (ex.: cadastro_portal exige
      // bill+document; aguardando_facial exige OTP validado).
      const reachableTransitions = (currentStep.transitions ?? []).map((t) => ({
        next_step_key: t?.goto_step_id
          ? (dbSteps.find((s) => s.id === t.goto_step_id)?.step_key ?? null)
          : null,
        goto_special: t?.goto_special ?? null,
      }));
      const validation = validateAiFallbackChoice(
        choice,
        currentStep.step_key,
        reachableTransitions,
        ctx.customer,
        ["cadastro", "humano", "menu", "repeat"],
      );
      if (validation.downgradeReason === "unreachable") {
        console.warn(JSON.stringify({
          kind: "ai_unreachable_step",
          proposed: validation.failedStep,
          currentStep: currentStep.step_key,
        }));
      } else if (validation.downgradeReason === "precondition_failed") {
        console.warn(JSON.stringify({
          kind: "ai_precondition_failed_fallback",
          proposed: validation.failedStep,
          reason: validation.preconditionReason,
        }));
      }
      const upper = validation.choice.toUpperCase();
      if (upper === "REPEAT") return _finalize(stepKey, await repeatCurrent());
      if (upper === "HUMANO") return _finalize(stepKey, await resolveTransition({ goto_special: "humano" } as DbTransition));
      if (upper === "CADASTRO") return _finalize(stepKey, await resolveTransition({ goto_special: "cadastro" } as DbTransition));
      const nextStep = dbSteps.find(s => s.step_key === validation.choice);
      if (nextStep && nextStep.is_active) return _finalize(stepKey, await goToStep(nextStep, restoreDetourUpdates));
    }
  } else if (fb.mode === "ai" && strictMode) {
    console.log(`[conversational] strict_mode=true → fallback IA ignorado, usando repeat`);
  }

  // Auto-advance se o passo não tem transições configuradas E intenção positiva
  const noTransitionsConfigured = !Array.isArray(currentStep.transitions) || currentStep.transitions.length === 0;
  const positiveIntent = ["afirmacao", "saudacao", "quer_cadastrar", "ja_assistiu_video"].includes(cls.intent);
  if (noTransitionsConfigured && positiveIntent) {
    const nextByPosition = dbSteps.find((s) => s.is_active && s.position > currentStep.position);
    if (nextByPosition) {
      console.log(`[conversational] auto-advance ${currentStep.step_key} → ${nextByPosition.step_key} (no transitions, intent=${cls.intent})`);
      if (nextByPosition.step_key === "cadastro" || CADASTRO_STEPS.has(nextByPosition.step_key)) {
        const docStep = findActiveByType("capture_documento");
        if (docStep) return _finalize(stepKey, await goToStep(docStep, restoreDetourUpdates));
        return _finalize(stepKey, {
          reply: await getTemplate(ctx.supabase, "checkin_pos_video", "pedir_conta", vars),
          updates: { conversation_step: "aguardando_conta", sales_phase: "fechamento", __intent: cls.intent, __confidence: cls.confidence, ...captureUpdates, ...restoreDetourUpdates },
        });
      }
      await emitCurrentBeforeGoto(currentStep, nextByPosition);
      return _finalize(stepKey, await goToStep(nextByPosition, restoreDetourUpdates));
    }
  }

  // Default: repeat
  return _finalize(stepKey, await repeatCurrent());
}

// Legacy hardcoded path — preserved for consultants without a custom flow.
async function runLegacyConversational(ctx: BotContext): Promise<BotResult> {
  const step = (ctx.customer.conversation_step || "welcome") as ConversationalStep;
  if (!CONVERSATIONAL_STEPS.has(step)) return { reply: "", updates: {} };

  const cls = await classifyIntent(ctx.messageText, step, ctx.geminiApiKey);
  const transition = decideTransition(step, cls.intent, ctx.customer);
  const vars = { nome: ctx.customer.name, representante: ctx.nomeRepresentante };
  let reply = "";
  if (transition.action.type === "send_template") {
    reply = await getTemplate(ctx.supabase, transition.action.step_key, transition.action.template_key, vars);
  }
  return {
    reply,
    updates: {
      conversation_step: transition.nextStep,
      __intent: cls.intent,
      __confidence: cls.confidence,
    },
  };
}
