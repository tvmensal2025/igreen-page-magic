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
// answerFaqWithAI removido — agora usa runOrchestrator diretamente (linha ~1483).
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
import { safeFirstNameForAddress } from "../../../_shared/customer-display-name.ts";
import { resolveFlowId, resolveMediaOwnerId } from "../../../_shared/resolve-flow.ts";
import {
  resolveCanonicalFlowVariant,
  needsCanonicalFlowVariantRepair,
  CANONICAL_FLOW_VARIANT,
} from "../../../_shared/bot/canonical-flow-variant.ts";
import {
  ACTIVATE_CTA_NUDGE,
  pickActivateDestination,
  rewriteActivateAwayFromSimPath,
  resolveCanonicalNudgeChoice,
  isActivateIntent,
} from "../../../_shared/bot/flow-activate-routing.ts";
import { nextSeparatedCadastroStep, isSofiaPortalOtpStep, sofiaPortalContaunicaPrefill } from "../../../_shared/bot/cadastro-fixes.ts";
import { assignProtocolToCustomer } from "../../../_shared/protocol.ts";
import { formatFaqReply } from "../../../_shared/format-reply.ts";
import { withQaStepClose } from "../../../_shared/qa-step-close.ts";
import { reemitStepButtons } from "../../../_shared/bot/reemit-buttons.ts";
import { handleMakeCallStep } from "../../../_shared/bot/make-call-step.ts";
import { detectQuestionIntent } from "../../../_shared/conversation-helpers.ts";

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
  voice_audio_clip_id?: string | null;
  personalize_name?: boolean | null;
}

// Re-exporta CADASTRO_STEPS do _shared para que whapi-webhook/index.ts
// continue importando daqui sem quebrar. Fonte única de verdade: flow-router.ts.
export { CADASTRO_STEPS } from "../../../_shared/flow-router.ts";

// Alias local para uso interno neste arquivo
const CADASTRO_STEPS = CADASTRO_STEPS_SHARED;

interface LoadedFlow { flowId: string; steps: DbStep[]; strictMode: boolean; }

/**
 * a3b = “pode perguntar” (só áudio, sem botões). Depois da FAQ/IA o lead
 * DEVE voltar ao a3 (com CTA), senão fica o vazio mapeado no 11971254913.
 * Espelha custom-step-resolver do bot-flow.
 */
function resolveFaqReturnStep(current: DbStep, steps: DbStep[]): DbStep {
  const key = String(current?.step_key || "");
  if (key === "a3b_pedir_pergunta") {
    const a3 = steps.find((s) => s.step_key === "a3_explain_with_buttons" && s.is_active !== false);
    if (a3) return a3;
  }
  return current;
}

function stepHasInteractiveWait(st: DbStep | null | undefined): boolean {
  const captures = Array.isArray(st?.captures) ? st!.captures as any[] : [];
  const hasButtons = captures.some((c: any) =>
    c?.enabled !== false && c?.field === "_buttons" && Array.isArray(c?.value) && c.value.length > 0
  );
  if (hasButtons) return true;

  const transitions = Array.isArray(st?.transitions) ? st!.transitions as any[] : [];
  const hasReplyTransition = transitions.some((t: any) => {
    const intent = String(t?.trigger_intent || "").trim();
    const phrases = Array.isArray(t?.trigger_phrases) ? t.trigger_phrases.filter(Boolean) : [];
    return !!t?.goto_special || (!!t?.goto_step_id && (intent !== "default" || phrases.length > 0));
  });
  if (hasReplyTransition) return true;

  const fallbackMode = String(st?.fallback?.mode || "").trim();
  return fallbackMode === "repeat" || fallbackMode === "ai" || fallbackMode === "ai_answer";
}

async function loadFlow(supabase: any, consultantId: string, variant: string = "A"): Promise<LoadedFlow | null> {
  try {
    // Resolve via resolveFlowId para respeitar sync_mode:
    // - sync_mode='public' → fluxo PÚBLICO do superadmin (mesma fonte que bot-flow)
    // - sync_mode='custom' → fluxo próprio do consultor
    // Evita mismatch entre handlers que gravariam UUID de um fluxo e leriam de outro.
    const resolved = await resolveFlowId(supabase, consultantId, variant);
    if (!resolved?.id) {
      console.log(`[conversational] loadFlow: no active flow for consultant=${consultantId} variant=${variant}`);
      return null;
    }
    const flowId = resolved.id;

    const { data: flowMeta } = await supabase
      .from("bot_flows")
      .select("strict_mode")
      .eq("id", flowId)
      .maybeSingle();

    const { data: steps, error: stepsErr } = await supabase
      .from("bot_flow_steps")
      .select("id, step_key, step_type, message_text, wait_for, text_delay_ms, slot_key, is_active, position, transitions, captures, fallback, auto_detect_doc_type, media_order, voice_audio_clip_id, personalize_name")
      .eq("flow_id", flowId)
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
    const strictMode = !!(flowMeta as any)?.strict_mode;
    console.log(`[conversational] loadFlow: flow=${flowId} steps=${normalized.length} strict=${strictMode}`);
    return { flowId, steps: normalized, strictMode };
  } catch (e) {
    console.error("[conversational] loadFlow failed", e);
    return null;
  }
}

// ─── Q&A matching (FAQ) ────────────────────────────────────────────────
// Procura uma pergunta cadastrada em bot_flow_qa que case com a mensagem do
// lead. Match conservador compartilhado em `_shared/qa-phrase-match.ts`.
import {
  normalizeQaText,
  phraseMatchesMessage as phraseMatchesMessageShared,
} from "../../../_shared/qa-phrase-match.ts";

const _norm = (s: string) => normalizeQaText(s);

/** Re-export testável — mesma lógica endurecida do shared. */
export function phraseMatchesMessage(phrase: string, message: string): boolean {
  return phraseMatchesMessageShared(phrase, message);
}

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
      .select("qa_id, phrase, created_at")
      .in("qa_id", qaIds)
      .order("created_at", { ascending: true });

    // Longest-match wins: dois QAs com gatilhos parecidos (ex.: "como funciona"
    // e "como funciona 2") eram resolvidos pelo "primeiro que casar", o que
    // dependia da ordem que o Postgres devolvia. Agora escolhemos a frase
    // mais específica (maior length normalizada); empate → trigger mais antigo.
    let hit: { qa_id: string; phrase: string } | null = null;
    let hitLen = -1;
    for (const t of ((triggers as any[]) || [])) {
      const phrase = _norm(t.phrase);
      if (!phraseMatchesMessage(phrase, normalized)) continue;
      if (phrase.length > hitLen) {
        hit = { qa_id: t.qa_id, phrase: t.phrase };
        hitLen = phrase.length;
      }
    }
    if (!hit) return null;

    const qa = ((qaRows as any[]) || []).find((q) => q.id === hit!.qa_id);
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
        const mediaOwnerId = await resolveMediaOwnerId(supabase, consultantId, "A");
        const { data: personal } = await supabase
          .from("ai_media_library").select("id, url")
          .eq("consultant_id", mediaOwnerId).eq("slot_key", m.slot_key)
          .eq("active", true).limit(1).maybeSingle();
        if (personal?.url) { url = personal.url; mediaId = personal.id || mediaId; }
        if (!url) {
          const { data: pub } = await supabase
            .from("ai_media_library").select("id, url")
            .eq("is_public", true).eq("slot_key", m.slot_key)
            .eq("active", true).limit(1).maybeSingle();
          if (pub?.url) { url = pub.url; mediaId = pub.id || mediaId; }
        }
      }
      if (url) mediaUrls.push({ url, kind, mediaId });
    }

    return { text: String(qa.text_response || "").trim(), mediaUrls };
  } catch (e) {
    console.error("[conversational] matchQA failed", e);
    return null;
  }
}

async function sleepForMedia(_kind: string, _durationSec?: number | null, _delayBeforeMs?: number | null): Promise<void> {
  if (isMockMode()) return;
  // Delays de áudio/vídeo zerados — só micro-gap de ordenação.
  await new Promise((r) => setTimeout(r, 150));
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
  // Telefone antes de valor: "03481914644" NÃO pode virar R$ 34.819 (bug Isa).
  const phoneHit = extractTelefone(messageText);
  if (enabled.has("phone_whatsapp") && phoneHit) {
    out.phone_whatsapp = phoneHit;
  }
  if (enabled.has("electricity_bill_value") && !phoneHit) {
    // Permissivo: "200", "200 reais", "uns 200" — evita travar no passo do valor.
    const v = extractValorPermissivo(messageText);
    if (v != null) out.electricity_bill_value = v;
  }
  if (enabled.has("cpf")) {
    const c = extractCPF(messageText);
    if (c) out.cpf = c;
  }
  // Nome: sempre tenta extrair (cliente pode se apresentar em qualquer step).
  // Guard real (lock por OCR/user_confirmed) fica no consumer (~linha 754).
  // Quando o passo pede nome, aceita 1 palavra (ex.: "Rafael", "Maria").
  {
    const askName = enabled.has("name");
    const n = extractNome(messageText, { allowSingleWord: askName });
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
//   - abortedForPending: true quando abortou vídeo/restante porque chegou inbound novo (FAQ).
async function sendStepMedia(
  ctx: BotContext,
  step: DbStep,
  consultantId: string,
  _waitForSend = true,
  textPayload?: { text: string; delayMs: number } | null,
): Promise<{ mediaSent: boolean | null; textSentInline: boolean; abortedForPending?: boolean }> {
  const slotKey = step.slot_key || step.step_key || step.id;
  if (!slotKey) return { mediaSent: false, textSentInline: false };

  const variant = String((ctx.customer as any)?.flow_variant || "A").toUpperCase();
  const mediaOwnerId = await resolveMediaOwnerId(ctx.supabase, consultantId, variant);

  let { data: mediaRows } = await ctx.supabase
    .from("ai_media_library")
    .select("id, kind, label, url, slot_key, send_order, duration_sec, delay_before_ms, transcript")
    .eq("consultant_id", mediaOwnerId)
    .eq("slot_key", slotKey)
    .eq("active", true)
    .order("send_order", { ascending: true });

  // Sofia passo 3: painel antigo gravava em a3_audio_explain; fluxo usa
  // a3_explain_with_buttons. Sem fallback o áudio some mesmo com TTS gerado.
  if ((!mediaRows || mediaRows.length === 0) && slotKey === "a3_explain_with_buttons") {
    const { data: aliasRows } = await ctx.supabase
      .from("ai_media_library")
      .select("id, kind, label, url, slot_key, send_order, duration_sec, delay_before_ms, transcript")
      .eq("consultant_id", mediaOwnerId)
      .eq("slot_key", "a3_audio_explain")
      .eq("active", true)
      .order("send_order", { ascending: true });
    if (aliasRows?.length) {
      console.log(`[sendStepMedia] fallback slot a3_audio_explain → ${aliasRows.length} mídia(s)`);
      mediaRows = aliasRows;
    }
  }

  // Fallback: mídia marcada is_public (slots oficiais Multicanal).
  if (!mediaRows || mediaRows.length === 0) {
    const { data: publicRows } = await ctx.supabase
      .from("ai_media_library")
      .select("id, kind, label, url, slot_key, send_order, duration_sec, delay_before_ms, transcript")
      .eq("is_public", true)
      .eq("slot_key", slotKey)
      .eq("active", true)
      .order("send_order", { ascending: true });
    if (publicRows?.length) mediaRows = publicRows;
  }

  let medias = ((mediaRows as any[]) || []).filter((m) => !!m?.url);

  // Multicanal A2/A3: NUNCA enviar MP3 da prévia (Maria/Rodrigo).
  // Sempre aguarda o stitch (cache ou geração) e respeita media_order do passo
  // (A2 = áudio→texto). Sem early-text — evita texto antes do áudio.
  let earlyTextSent = false;
  try {
    const { isPersonalizedWaAudioSlot, pickSafePersonalizedWaAudio } = await import(
      "../../../_shared/wa-audio-stitch.ts"
    );
    if (isPersonalizedWaAudioSlot(slotKey)) {
      const nonAudio = medias.filter((m) => String(m.kind).toLowerCase() !== "audio");
      medias = nonAudio;

      // “Gravando” enquanto resolve/gera o stitch (pode levar vários segundos).
      const presenceKeepAlive = setInterval(() => {
        ctx.sender.sendPresence(ctx.remoteJid, "recording", 10).catch(() => {});
      }, 8_000);
      try {
        await ctx.sender.sendPresence(ctx.remoteJid, "recording", 12);
      } catch (_) { /* cosmético */ }

      let safe: Awaited<ReturnType<typeof pickSafePersonalizedWaAudio>>;
      try {
        safe = await pickSafePersonalizedWaAudio(ctx.supabase, {
          consultantId: consultantId || mediaOwnerId,
          mediaOwnerId,
          slotKey: String(slotKey),
          customerName: (ctx.customer as any)?.name,
          nameSource: (ctx.customer as any)?.name_source,
          // Nome digitado agora: gera Olá+corpo em paralelo; 90s evita skip no 1º nome.
          timeoutMs: 90_000,
        });
      } finally {
        clearInterval(presenceKeepAlive);
      }

      // Só stitch Sofia (nome+corpo) ou corpo fixo sem nome — nunca prévia Maria/Rodrigo.
      if (safe.ok && safe.url && (safe.mode === "stitch" || safe.mode === "body_only")) {
        medias = [
          ...nonAudio,
          {
            id: null,
            kind: "audio",
            label: `sofia ${slotKey} · ${safe.displayName || "sem-nome"} · ${safe.mode || "safe"}`,
            url: String(safe.url),
            slot_key: slotKey,
            send_order: 0,
            duration_sec: null,
            delay_before_ms: 0,
            transcript: null,
          },
        ];
        console.log(
          `[sendStepMedia] wa-audio SAFE slot=${slotKey} name=${safe.displayName} gender=${safe.gender} mode=${safe.mode} cached=${safe.cached}`,
        );
      } else {
        console.warn(
          `[sendStepMedia] wa-audio SKIP preview slot=${slotKey} err=${safe.error} — texto segue sem áudio (nunca Rodrigo)`,
        );
      }

      // Se já mandou o texto cedo, não reinjeta no sequence.
      if (earlyTextSent && textPayload) {
        textPayload = null;
      }
    }
  } catch (stitchErr) {
    console.warn("[sendStepMedia] wa-stitch erro:", (stitchErr as Error)?.message || stitchErr);
    try {
      const { isPersonalizedWaAudioSlot } = await import("../../../_shared/wa-audio-stitch.ts");
      if (isPersonalizedWaAudioSlot(slotKey)) {
        medias = medias.filter((m) => String(m.kind).toLowerCase() !== "audio");
      }
    } catch { /* ignore */ }
  }

  // Variante B: cada áudio vira um item de texto (transcript) na mesma posição.
  // Mantemos `kind: 'audio'` no item para que o slot "audio" do media_order
  // continue casando; o flag `_asText` faz a sequência empurrar como text item.
  if (variant === "B") {
    const transformed: any[] = [];
    const seenTranscripts = new Set<string>();
    for (const m of medias) {
      if (String(m.kind).toLowerCase() !== "audio") { transformed.push(m); continue; }
      const transcript = await ensureAudioTranscript(ctx.supabase, m);
      const norm = (transcript || "").trim().toLowerCase().replace(/\s+/g, " ");
      if (!norm) {
        console.warn(`[sendStepMedia] variant=B: audio "${m.label || m.id}" sem transcript → pulado`);
        continue;
      }
      if (seenTranscripts.has(norm)) {
        console.log(`[sendStepMedia] variant=B: audio "${m.label || m.id}" transcript duplicado → pulado`);
        continue;
      }
      seenTranscripts.add(norm);
      transformed.push({ ...m, _asText: true, _transcript: transcript!.trim() });
      console.log(`[sendStepMedia] variant=B: audio "${m.label || m.id}" → text (${transcript!.length} chars)`);
    }
    medias = transformed;
  }


  // Precedência: UI (consultants.flow_step_media_order) → step.media_order → default.
  // Precedência de chaves: step_key (ex.: `d_como_funciona`) > slot_key (ex.: `como_funciona`).
  // Sem isso, fluxo D herda a ordem do fluxo A quando ambos compartilham `slot_key`.
  const uiOrder = await getStepMediaOrder(
    ctx.supabase,
    mediaOwnerId,
    [step.step_key, step.slot_key, slotKey].filter(Boolean) as string[],
  );
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

  if (sequence.length === 0) return { mediaSent: false, textSentInline: earlyTextSent };

  let mediaSent = false;
  let mediaAttempted = false;
  let mediaFailed = false;
  let textSentInline = earlyTextSent;
  let abortedForPending = false;
  let prevForPause: { kind: string; duration_sec?: number | null } | null = earlyTextSent
    ? { kind: "text" }
    : null;

  const { customerHasPendingInbound } = await import("../../../_shared/bot/pending-inbound.ts");

  for (let i = 0; i < sequence.length; i++) {
    const item = sequence[i];

    // ⚡ Abort: lead mandou mensagem no meio da cascata (ex.: pergunta FAQ).
    // Pula vídeo/restante agora; o drain de pending responde a FAQ e o
    // reemit pós-FAQ continua o passo (CTA/botões).
    if (
      ctx.customer?.id &&
      i > 0 &&
      (item.kind === "video" || item.kind === "audio" || item.kind === "image" || item.kind === "document")
    ) {
      try {
        if (await customerHasPendingInbound(ctx.supabase, ctx.customer.id)) {
          console.log(
            `[sendStepMedia] ⚡ abort cascade step=${step.step_key} at ${item.kind} i=${i}/${sequence.length} — pending inbound (FAQ primeiro)`,
          );
          abortedForPending = true;
          break;
        }
      } catch (_) { /* best-effort */ }
    }

    if (item.kind === "text") {
      // text_delay_ms: só respeita se >0 e com teto baixo (FAQ/velocidade).
      if (!isMockMode() && !isFlowInstantMode()) {
        const wait = Math.max(0, Math.min(item.delayMs, 1_500));
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

    // ⏱️ Delays de áudio/vídeo ZERADOS (só micro-gap 150ms de ordenação).
    // Áudio com nome (stitch) já demora na geração — não soma pausa extra.
    if (!isMockMode() && !isFlowInstantMode() && prevForPause) {
      await new Promise((r) => setTimeout(r, 150));
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
  return { mediaSent: mediaResult, textSentInline, abortedForPending };
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
  // Defensivo: index.ts já faz stripPrefix, mas reinícios / testes / paths
  // paralelos podem chegar com `flow:<uuid>` — sem strip o lookup falha e o
  // restart reemite o a3 sem casar "Quero ativar" (BUG-SOFIA-A3).
  const { stripPrefix: _stripStep } = await import("../../../_shared/bot/step-namespace.ts");
  let stepKey = _stripStep(ctx.customer.conversation_step || "welcome");
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
  // Blindagem B: descobre se o passo ATUAL é de captura (conta x documento).
  // Quando é documento, o redirecionamento não pode ser bloqueado por já
  // existir foto da conta — e tem que ir pro OCR de documento, não de conta.
  const { resolveCaptureRedirectStep, resolveImageCaptureStep } =
    await import("../../../_shared/image-capture-step.ts");
  const _captureRedirect = (ctx.isFile || ctx.hasImage || ctx.hasDocument) && !ctx.hasAudio
    ? await resolveCaptureRedirectStep(ctx.supabase, (ctx.customer as any).consultant_id, stepKey)
    : null;
  const _isDocCapture = _captureRedirect === "aguardando_doc_auto";

  if (
    (ctx.isFile || ctx.hasImage || ctx.hasDocument) &&
    !ctx.hasAudio && // 🎧 áudio NUNCA vai pra OCR de conta — trata como mensagem comum
    // Conta: só redireciona se ainda não temos a foto. Documento: sempre
    // (a foto da conta já existir é o caso NORMAL nesse ponto do funil).
    (_isDocCapture || !(ctx.customer as any).electricity_bill_photo_url) &&
    !CADASTRO_STEPS.has(stepKey)
  ) {
    // Prioridade: passo de captura explícito (capture_conta/_documento) define
    // o destino canônico. Senão, usa o resolver genérico (fallback legado).
    const targetStep = _captureRedirect
      || await resolveImageCaptureStep(ctx.supabase, (ctx.customer as any).consultant_id);
    console.log(`[conversational] 📸 arquivo recebido em step="${stepKey}" (doc=${_isDocCapture}) → redirecionando para ${targetStep}`);
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
  // Trava canônica: sempre Grupo A (Sofia). Se o lead estava em F/D/M, corrige.
  let flowVariant = resolveCanonicalFlowVariant((ctx.customer as any)?.flow_variant);
  if (needsCanonicalFlowVariantRepair((ctx.customer as any)?.flow_variant)) {
    console.warn(
      `[conversational] forçando flow_variant=${CANONICAL_FLOW_VARIANT} (era ${(ctx.customer as any)?.flow_variant}) customer=${ctx.customer?.id}`,
    );
    (ctx.customer as any).flow_variant = flowVariant;
    try {
      await ctx.supabase
        .from("customers")
        .update({ flow_variant: flowVariant })
        .eq("id", ctx.customer.id);
    } catch (_) { /* best-effort */ }
  }
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
      // 🔒 PARIDADE EVOLUTION: teto reduzido para 15s — Edge Functions têm
      // timeout de 60s e um delay maior faz o inbound ficar dedupado sem
      // nunca enviar resposta.
      const delaySec = Math.min(Number((flowRow as any)?.initial_delay_seconds || 0), 15);
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
  let currentStepRaw =
    dbSteps.find((s) => s.id === stepKey) ||
    dbSteps.find((s) => s.step_key === stepKey);

  // Rede de segurança: stepKey é UUID que não existe no fluxo carregado
  // (ex.: lead vinha de outro fluxo após republicação / mudança de sync_mode).
  // Tenta recuperar pelo step_key equivalente antes de cair em restart.
  if (!currentStepRaw && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(stepKey))) {
    try {
      const { data: orphan } = await ctx.supabase
        .from("bot_flow_steps")
        .select("step_key")
        .eq("id", stepKey)
        .maybeSingle();
      const orphanKey = (orphan as any)?.step_key;
      if (orphanKey) {
        const recovered = dbSteps.find((s) => s.step_key === orphanKey && s.is_active);
        if (recovered) {
          console.log(`[conversational] 🛟 step_key recovery: UUID órfão "${stepKey}" → step_key="${orphanKey}" → id=${recovered.id}`);
          currentStepRaw = recovered;
          stepKey = recovered.id;
        }
      }
    } catch (e) {
      console.warn(`[conversational] step_key recovery failed: ${(e as Error)?.message}`);
    }
  }

  // ─── resolveLandingStep ────────────────────────────────────────────────
  // Se o passo atual existe SÓ pra capturar um dado que já temos (ex: Passo 1
  // pergunta o nome, mas o cliente já se apresentou no welcome), pula pro
  // próximo passo ativo por position. Loop limitado a 5 saltos com visited
  // set pra nunca ciclar. Falha silenciosa: se algo der errado, mantém o
  // passo original (comportamento atual).
  const TRUSTED_NAME_SKIP = new Set([
    "ocr", "ocr_conta", "ocr_doc", "user_confirmed", "self_introduced", "manual", "cadence",
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
      // slot_key tipo "a1_ask_name": underscore é word-char — \bnome\b NÃO casa.
      return /\bnome\b|\bchama\b/i.test(String((s as any).title || "")) ||
             /nome|ask_name/i.test(String((s as any).slot_key || ""));
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
      // Dados do passo já preenchidos → SEMPRE pula.
      // slot_key de catálogo (a1_ask_name / a2_audio_*) NÃO é motivo para re-perguntar.
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
  // `entryLandedByCapture` marca esse pouso: o dado do passo anterior já
  // estava salvo (auto-capture do webhook roda ANTES do motor), então o
  // passo pousado ainda NÃO foi apresentado ao lead — o bloco 1.9 emite.
  let entryLandedByCapture = false;
  if (currentStep && currentStepRaw && currentStep.id !== currentStepRaw.id) {
    stepKey = currentStep.id;
    entryLandedByCapture = true;
  }

  // ─── Blindagem B: passo de captura NUNCA fica preso no conversacional ──
  // Se o passo atual (custom) é de captura de conta/documento, o turno é
  // delegado ao pipeline determinístico (bot-flow.ts) via a chave CANÔNICA.
  // Lá o prompt é emitido (quando ainda não há arquivo) e o OCR roda (quando
  // o cliente já mandou a foto/PDF). Sem isso, um passo capture_* sem texto
  // deixa o lead mudo e o OCR nunca é extraído.
  {
    const _ct = String(currentStep?.step_type || "");
    const _captureToCanonical = _ct === "capture_conta" || _ct === "image_capture"
      ? "aguardando_conta"
      : (_ct === "capture_documento" || _ct === "capture_doc")
      ? "aguardando_doc_auto"
      : null;
    if (_captureToCanonical) {
      console.log(`[conversational] 🎯 passo de captura "${stepKey}" (${_ct}) → delegando ao bot-flow como ${_captureToCanonical}`);
      try {
        const { runBotFlow } = await import("../bot-flow.ts");
        (ctx.customer as any).conversation_step = _captureToCanonical;
        const result = await runBotFlow(ctx);
        const emittedInline = (!result.reply || result.reply === "")
          && !!result.updates && Object.keys(result.updates).length > 0;
        return {
          reply: result.reply,
          updates: {
            ...(result.updates || {}),
            conversation_step: result.updates?.conversation_step || _captureToCanonical,
            ...(emittedInline ? { __inline_sent: true } : {}),
          },
        };
      } catch (e) {
        console.error("[conversational] falha ao delegar passo de captura p/ bot-flow:", (e as Error)?.message || e);
        // Fail-safe: persiste a chave canônica pra próxima mensagem cair no OCR
        // e AVISA o lead — antes ficava mudo e o cadastro parecia travado.
        return {
          reply: "Tive um probleminha pra processar agora 🙈 Me manda a foto de novo, por favor?",
          updates: { conversation_step: _captureToCanonical },
        };
      }
    }
  }
  // Registra a pergunta do passo atual + vars para o fallback de _finalize.
  const _turnVars = {
    nome: ctx.customer.name, nome_source: (ctx.customer as any).name_source,
    representante: ctx.nomeRepresentante,
    consultor_gender: ctx.consultorGender || "consultor",
    valor_conta: (ctx.customer as any).electricity_bill_value,
    telefone: ctx.customer.phone_whatsapp,
    cpf: (ctx.customer as any).cpf,
  };
  _setTurnStepQuestion(currentStep?.message_text || "", _turnVars);
  const stepOutboundMatches = (stored: string, step: DbStep): boolean => {
    const s = String(stored || "");
    if (!s) return false;
    const keys = new Set([
      step.id,
      step.step_key,
      `flow:${step.id}`,
      `flow:${step.step_key}`,
    ]);
    return keys.has(s);
  };
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
        const landingForDup = resolveLandingStep(firstActive) || firstActive;
        const recentOnFlow = ((recentOut as any[]) || []).some((r) =>
          stepOutboundMatches(String((r as any).conversation_step || ""), firstActive)
          || stepOutboundMatches(String((r as any).conversation_step || ""), landingForDup)
        );
        if (
          recentOnFlow
          || recentSteps.has(firstActive.step_key)
          || recentSteps.has(firstActive.id)
          || recentSteps.has(`flow:${firstActive.id}`)
          || recentSteps.has("welcome")
          || recentSteps.has("a1_ask_name")
        ) {
          console.log(`[conversational] 🛡️ anti-welcome-duplicado: outbound recente do fluxo — pulando restart e processando input no landing=${landingForDup.step_key}`);
          currentStep = landingForDup;
          stepKey = landingForDup.id;
          _setTurnStepQuestion(landingForDup.message_text || "", _turnVars);
        }
      }
    } catch (e) {
      console.warn(`[conversational] anti-welcome-duplicado check falhou: ${(e as Error)?.message}`);
    }
  }
  // ❓ Pergunta/FAQ com step legacy (welcome) — NÃO reemitir A1 pedindo nome.
  // Caso Rute (2026-07-22): "achei que o desconto seria direto na conta da Cemig"
  // caía no restart-cascade e só pedia nome. Processa no landing → matchQA.
  if (!currentStep && detectQuestionIntent(ctx.messageText || "")) {
    const landingQ = resolveLandingStep(firstActive) || firstActive;
    if (landingQ) {
      console.log(
        `[conversational] ❓ pergunta com step desconhecido="${stepKey}" → landing=${landingQ.step_key} (FAQ antes de restart)`,
      );
      currentStep = landingQ;
      stepKey = landingQ.id;
      _setTurnStepQuestion(landingQ.message_text || "", _turnVars);
    }
  }
  if (!currentStep) {
    const landingProbe = resolveLandingStep(firstActiveRaw) || firstActiveRaw;
    const probeButtons = extractStepButtons(landingProbe);
    const activateInput = isActivateIntent(ctx.messageText, ctx.buttonId);
    const deterministicProbe = matchTransitionShared({
      transitions: landingProbe.transitions ?? [],
      buttonId: ctx.buttonId,
      messageText: ctx.messageText,
      buttons: probeButtons,
      intents: [],
    });
    if (activateInput || deterministicProbe) {
      console.log(
        `[conversational] 🛡️ skip restart-cascade — input determinístico no landing=${landingProbe.step_key} ` +
        `(activate=${activateInput} transition=${!!deterministicProbe})`,
      );
      currentStep = landingProbe;
      stepKey = landingProbe.id;
      _setTurnStepQuestion(landingProbe.message_text || "", _turnVars);
    }
  }
  if (!currentStep) {
    console.log(`[conversational] unknown step="${stepKey}" → restart at firstActive=${firstActive?.id} (steps=${dbSteps.length})`);
    let protocoloBoot = String((ctx.customer as any).tracking_protocol || "").trim();
    if (!protocoloBoot) {
      try {
        const assigned = await assignProtocolToCustomer(ctx.supabase, ctx.customer.id, {
          partnerId: (ctx.customer as any).referral_partner_id || null,
          consultantId: consultantId || ctx.customer.consultant_id || null,
          consultantName: ctx.nomeRepresentante || null,
        });
        protocoloBoot = String(assigned?.protocol || "").trim();
        if (protocoloBoot) (ctx.customer as any).tracking_protocol = protocoloBoot;
      } catch (e) {
        console.warn("[conversational] assignProtocol (boot) falhou:", (e as Error).message);
      }
    }
    const vars = {
      nome: ctx.customer.name, nome_source: (ctx.customer as any).name_source,
      representante: ctx.nomeRepresentante,
      consultor_gender: ctx.consultorGender || "consultor",
      protocolo: protocoloBoot,
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

      // Restart não passa por emitStep — marca name_ask + abre atendimento (welcome).
      try {
        const asksNameNow =
          String(cursor.step_type || "") === "capture_name" ||
          (Array.isArray(cursor.captures) &&
            cursor.captures.some((c: any) => c?.field === "name" && c?.enabled !== false)) ||
          /nome|ask_name/i.test(String(cursor.slot_key || cursor.step_key || ""));
        if (asksNameNow && ctx.customer?.id) {
          const ts = new Date().toISOString();
          const patch: Record<string, string> = {};
          if (!(ctx.customer as any).name_ask_sent_at) patch.name_ask_sent_at = ts;
          // A1 com protocolo = atendimento aberto automaticamente (UI + cadeados).
          if (!(ctx.customer as any).welcome_sent_at) patch.welcome_sent_at = ts;
          if (Object.keys(patch).length > 0) {
            await ctx.supabase.from("customers").update(patch).eq("id", ctx.customer.id);
            Object.assign(ctx.customer as any, patch);
          }
        }
      } catch (_) { /* best-effort */ }

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
  /** true se resolveLandingStep avançou após captura neste turno (emite o pouso, não re-avança). */
  let postCaptureLanded = false;
  try {
    // Detecta "pedido de nome" ANTES de capturar valor — evita RG/CPF/telefone
    // virar electricity_bill_value no A1 (bug Isa: branding "Conta de Luz" no
    // message_text fazia isValueStep=true no passo a1_ask_name).
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
      lastOutboundWasNameQuestion = /qual\s+(?:é\s+)?(?:o\s+)?(?:seu\s+)?(?:primeiro\s+)?nome|como\s+(?:posso\s+)?(?:te\s+)?(?:chamar|chamo)|me\s+diz(?:a)?\s+(?:o\s+)?(?:seu\s+)?(?:primeiro\s+)?nome|informe\s+(?:seu\s+)?(?:primeiro\s+)?nome|agilizar\s+(?:seu\s+)?atendimento|primeiro\s+nome/i.test(txt);
    } catch { /* best-effort */ }
    const stepIsAskName =
      lastOutboundWasNameQuestion ||
      /\bnome\b|\bchama\b/i.test(String((currentStep as any).title || "")) ||
      /nome|ask_name/i.test(String((currentStep as any).slot_key || "")) ||
      String(currentStep.step_type || "") === "capture_name" ||
      (Array.isArray(currentStep.captures) &&
        currentStep.captures.some((c: any) => c?.field === "name" && c?.enabled !== false));

    const extracted = extractCaptures(ctx.messageText || "", currentStep.captures || []);
    // No pedido de nome: SÓ nome. Número (RG/CPF/tel) NÃO vira conta nem CPF.
    if (!stepIsAskName && extracted.electricity_bill_value != null) {
      captureUpdates.electricity_bill_value = extracted.electricity_bill_value;
    }
    // Fallback contextual: só no passo que realmente pede valor da conta.
    // NÃO usar message_text — o A1 tem "Conta de Luz" no branding e disparava
    // captura falsa (Isa / "03481914644" → R$ 34.819).
    if (
      !stepIsAskName &&
      extracted.electricity_bill_value == null &&
      !ctx.customer.electricity_bill_value
    ) {
      const hasBillCapture = Array.isArray(currentStep.captures) &&
        currentStep.captures.some((c: any) => c?.field === "electricity_bill_value" && c?.enabled !== false);
      const stepMeta = `${(currentStep as any).title || ""} ${currentStep.slot_key || ""} ${currentStep.step_key || ""}`.toLowerCase();
      const isValueStep = hasBillCapture ||
        /ask_bill|bill_value|valor_conta|electricity_bill/i.test(stepMeta) ||
        (/\bvalor\b/.test(stepMeta) && /\b(conta|luz|bill)\b/.test(stepMeta));
      if (isValueStep) {
        const permissive = extractValorPermissivo(ctx.messageText || "");
        if (permissive != null) {
          captureUpdates.electricity_bill_value = permissive;
          console.log(`[capture-fallback] valor=${permissive} via permissivo no step ${currentStep.step_key}`);
        }
      }
    }
    if (!stepIsAskName && extracted.phone_whatsapp && !ctx.customer.phone_whatsapp) {
      captureUpdates.phone_whatsapp = extracted.phone_whatsapp;
    }
    if (!stepIsAskName && extracted.cpf) captureUpdates.cpf = extracted.cpf;
    // Nome: se o passo atual é um "pergunta nome" (título/slot menciona nome,
    // ou tem capture explícita de name habilitada), sobrescreve.
    // Caso contrário, mantém a guarda anti-sobrescrita.
    // EXCEÇÃO CRÍTICA: se name_source vier de OCR (ocr_conta/ocr_doc) ou
    // user_confirmed, NUNCA sobrescreve por captura de texto livre — só os
    // passos editing_* explícitos podem trocar (no bot-flow.ts).
    const TRUSTED_LOCK = new Set(["ocr_conta", "ocr_doc", "user_confirmed"]);
    const nameLocked = TRUSTED_LOCK.has(String((ctx.customer as any).name_source || ""));
    // stepIsAskName / lastOutboundWasNameQuestion já calculados acima.
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

    // A2: "gravando…" imediato ao receber o nome; reenvia a cada ~8s enquanto monta o stitch.
    if (captureUpdates.name && consultantId) {
      try {
        await ctx.sender.sendPresence(ctx.remoteJid, "recording", 12);
      } catch (_) { /* cosmético */ }
      try {
        const { probePersonalizedWaAudioCache, warmPersonalizedWaAudio } = await import(
          "../../../_shared/wa-audio-stitch.ts"
        );
        const cached = await probePersonalizedWaAudioCache(ctx.supabase, {
          consultantId,
          slotKey: "a2_audio_activate_name",
          customerName: captureUpdates.name,
          nameSource: captureUpdates.name_source || "self_introduced",
        });
        const presenceKeepAlive = !cached
          ? setInterval(() => {
            ctx.sender.sendPresence(ctx.remoteJid, "recording", 10).catch(() => {});
          }, 8_000)
          : null;
        try {
          const warmed = await warmPersonalizedWaAudio(ctx.supabase, {
            consultantId,
            slotKey: "a2_audio_activate_name",
            customerName: captureUpdates.name,
            nameSource: captureUpdates.name_source || "self_introduced",
          });
          console.log(
            `[wa-stitch] warm on name="${captureUpdates.name}" a2_ok=${warmed.ok} a2_cached=${warmed.cached} intros+stitch`,
          );
        } finally {
          if (presenceKeepAlive) clearInterval(presenceKeepAlive);
        }
        // Presence de novo logo antes do emitStep (áudio).
        try {
          await ctx.sender.sendPresence(ctx.remoteJid, "recording", 10);
        } catch (_) { /* cosmético */ }
      } catch (e) {
        console.warn("[warm a2]", (e as Error)?.message || e);
      }
    }
    // Pré-aquece A3 quando o valor chega (corpo + “Então, {nome}”).
    if (captureUpdates.electricity_bill_value != null && consultantId && (ctx.customer as any)?.name) {
      try {
        const { prefetchPersonalizedWaAudio } = await import("../../../_shared/wa-audio-stitch.ts");
        prefetchPersonalizedWaAudio(ctx.supabase, {
          consultantId,
          slotKey: "a3_explain_with_buttons",
          customerName: (ctx.customer as any).name,
          nameSource: (ctx.customer as any).name_source,
        });
      } catch (e) {
        console.warn("[prefetch a3]", (e as Error)?.message || e);
      }
    }

    // Após capturar, re-resolve landing step: se o próximo passo só perguntaria
    // o dado que acabou de chegar, pula automaticamente.
    // Flag: se avançamos aqui, o bloco hasCapture deve EMITIR o passo pousado
    // (ex.: a1 nome → a2 valor), NÃO avançar de novo (senão pula a2 → a3).
    if (Object.keys(captureUpdates).length > 0) {
      const advanced = resolveLandingStep(currentStep);
      if (advanced && advanced.id !== currentStep.id) {
        console.log(`[skip-step] post-capture: ${currentStep.step_key} → ${advanced.step_key}`);
        currentStep = advanced;
        stepKey = currentStep.id;
        postCaptureLanded = true;
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

  // 🔒 Transição DETERMINÍSTICA cedo (botão/frase) — ANTES de FAQ/orch.
  // Sem isso, "Quero ativar" / botão activate no a3 Sofia podia cair em
  // tem_duvida→orch ou FAQ, reemitir a3 e nunca chamar matchTransition
  // (docs/captacao/BUG-SOFIA-A3-QUERO-ATIVAR.md).
  const earlyStepButtons = extractStepButtons(currentStep);
  const earlyTransition = matchTransitionShared({
    transitions: currentStep.transitions ?? [],
    buttonId: ctx.buttonId,
    messageText: ctx.messageText,
    buttons: earlyStepButtons,
    intents: captureIntents,
  });
  const hasDeterministicTransition = !!earlyTransition;
  // Frase/botão de ATIVAR também não pode ir pra FAQ/orch (mesmo se transition
  // ainda não casou — ex. tipografia estranha; o bloco 1.25 resolve destino).
  const skipAiDetour =
    hasDeterministicTransition ||
    isActivateIntent(ctx.messageText, ctx.buttonId);
  if (hasDeterministicTransition) {
    console.log(
      `[conversational] 🔒 transição cedo step="${currentStep.step_key}" ` +
      `btn=${ctx.buttonId || "—"} msg="${(ctx.messageText || "").slice(0, 40)}" ` +
      `→ goto=${earlyTransition?.goto_step_id || earlyTransition?.goto_special || "?"}`,
    );
  }

  // ─── Q&A FAQ matching ───────────────────────────────────────────────
  // Pula se a mensagem produziu captura legítima — captura tem prioridade.
  // Também pula se já casou transição configurada (botão/frase do passo).
  const qaHit = (hasCapture || skipAiDetour)
    ? null
    : await matchQA(ctx.supabase, flowId, consultantId, ctx.messageText || "");
  if (qaHit) {
    console.log(`[conversational] QA hit at step="${stepKey}"`);
    const qaText = formatFaqReply(withQaStepClose(renderTemplate(qaHit.text || "", {
      nome: ctx.customer.name, nome_source: (ctx.customer as any).name_source,
      representante: ctx.nomeRepresentante,
      valor_conta: (ctx.customer as any).electricity_bill_value,
      telefone: ctx.customer.phone_whatsapp,
      cpf: (ctx.customer as any).cpf,
    }), stepKey, { leadName: ctx.customer.name }));
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
      const hasAudio = qaHit.mediaUrls.some((m) => String(m.kind).toLowerCase() === "audio");
      for (const slot of order) {
        const s = String(slot).toLowerCase();
        if (s === "text") {
          // Áudio FAQ: não manda o mesmo conteúdo escrito
          if (qaText && !textInjected && !hasAudio) { sequence.push({ kind: "text", text: qaText }); textInjected = true; }
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
      if (qaText && !textInjected && !hasAudio) sequence.push({ kind: "text", text: qaText });
    } else {
      // Legado: mídia primeiro; texto só se NÃO houver áudio.
      const hasAudio = qaHit.mediaUrls.some((m) => String(m.kind).toLowerCase() === "audio");
      for (const m of qaHit.mediaUrls) {
        const k = ["audio", "video", "image"].includes(String(m.kind)) ? String(m.kind) as any : "document";
        sequence.push({ kind: k, m: m as any });
      }
      if (qaText && !hasAudio) sequence.push({ kind: "text", text: qaText });
    }

    let anyEmitted = false;
    let audioEmitted = false;
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
        if (item.kind === "audio") audioEmitted = true;
        if (ctx.customer?.id) {
          await ctx.supabase.from("conversations").insert({
            customer_id: ctx.customer.id,
            message_direction: "outbound",
            message_text: `[flow-qa:${item.kind}]`,
            message_type: item.kind,
            conversation_step: stepKey,
          });
        }
      } catch (e) {
        console.warn(`[qa] sendMedia ${item.kind} falhou:`, (e as Error)?.message || e);
      }
    }

    // Áudio saiu: NÃO manda texto da mesma resposta (regra FAQ).
    // Se áudio falhou/pulou → fallback texto já coberto abaixo.
    if (!anyEmitted && qaText) {
      try {
        await ctx.sender.sendText(ctx.remoteJid, qaText);
        anyEmitted = true;
        if (ctx.customer?.id) {
          await ctx.supabase.from("conversations").insert({
            customer_id: ctx.customer.id,
            message_direction: "outbound",
            message_text: qaText,
            message_type: "text",
            conversation_step: stepKey,
          });
        }
        console.log(`[conversational] QA fallback texto (áudio não emitido) step="${stepKey}"`);
      } catch (e) {
        console.error(`[qa] fallback sendText falhou:`, (e as Error)?.message || e);
      }
    }

    // a3b sem botões → volta ao a3 e reemite CTAs (fix vazio 11971254913).
    const returnStep = resolveFaqReturnStep(currentStep, dbSteps);
    if (returnStep.id !== currentStep.id) {
      console.log(`[conversational] FAQ return ${currentStep.step_key} → ${returnStep.step_key}`);
      currentStep = returnStep;
      stepKey = returnStep.id;
    }

    // Reapresenta opções do passo (Whapi=botão; Evolution=número) — sem isso
    // o lead fica com a FAQ e sem CTA para avançar.
    if (anyEmitted) {
      try {
        await reemitStepButtons({
          supabase: ctx.supabase,
          customerId: ctx.customer.id,
          consultantId: consultantId || ctx.customer.consultant_id,
          flowVariant: flowVariant,
          stepKey: currentStep.id || stepKey,
          remoteJid: ctx.remoteJid,
          sendButtons: (jid, text, btns) => ctx.sender.sendButtons(jid, text, btns),
          sendText: (jid, text) => ctx.sender.sendText(jid, text),
          buttons: extractStepButtons(currentStep),
          followups: Number((ctx.customer as any).ai_followups_count || 0),
          delayMs: 500,
        });
      } catch (e) {
        console.warn("[conversational] reemit pós-QA falhou:", (e as Error)?.message || e);
      }
    }

    return _finalize(stepKey, {
      reply: "",
      updates: {
        conversation_step: stepKey,
        __inline_sent: anyEmitted || undefined,
        __qa_audio: audioEmitted || undefined,
        ...restoreDetourUpdates,
      },
    });
  }

  const cls = hasCapture
    ? {
        intent: "outro" as const,
        confidence: 0.99,
        source: "regex" as const,
        action: "execute" as const,
      }
    : await classifyIntent(
        ctx.messageText,
        stepKey as ConversationalStep,
        ctx.geminiApiKey,
        { customerId: ctx.customer?.id, consultantId: consultantId || null, traceId: ctx.messageId },
      );
  if (hasCapture) {
    console.log(`[conversational] classify skip (hasCapture=${captureIntents.join(",")}) — fluxo determinístico`);
  }

  // Sprint 1.5: honra thresholds de confiança (action=handoff/repeat/execute).
  // - handoff (conf < 0.5): pausa o bot e devolve mensagem neutra; o consultor assume.
  // - repeat  (0.5–0.75): repete o passo atual sem avançar.
  // Quando a intenção é tem_duvida deixamos passar (cai no AI FAQ logo abaixo).
  if (cls.action === "handoff" && cls.intent !== "tem_duvida") {
    console.log(`[conversational] 🤝 baixa confiança (conf=${cls.confidence}) — tentando recuperar ao invés de pausar mudo`);

    // 🛡️ GUARDA DETERMINÍSTICA (2026-05-30): antes de pausar/desviar por baixa
    // confiança da IA, checa se o input casa com uma transição CONFIGURADA pelo
    // consultor (clique de botão, frase-gatilho, intent de regex ou captura).
    // Se casar, o fluxo é determinístico e a IA NÃO tem direito de veto — segue
    // o que o consultor desenhou. Sem isso, "Quero simular"/"Falar com Rafael"
    // que caíam em fallback/0.6 podiam abortar o fluxo de forma não-determinística.
    // Regra de ouro: consultor configurou → fluxo segue; IA é só último recurso.
    try {
      const _guardIntents = [cls.intent, ...detectRegexIntents(ctx.messageText || ""), ...captureIntents];
      const _guardTransition = matchTransitionShared({
        transitions: currentStep.transitions ?? [],
        buttonId: ctx.buttonId,
        messageText: ctx.messageText,
        buttons: extractStepButtons(currentStep),
        intents: _guardIntents,
      });
      if (_guardTransition || hasCapture || entryLandedByCapture) {
        console.log(`[conversational] ✋ handoff IGNORADO — input casa transição/captura configurada (${_guardTransition ? "transition" : hasCapture ? "capture" : "entry-skip-land"}). Fluxo determinístico assume.`);
        // não retorna: deixa o fluxo normal (matchTransition logo abaixo) seguir
        // (entry-skip-land: o input foi a resposta do funil já salva pelo
        // auto-capture do webhook — o bloco 1.9 emite o passo pousado.)
      } else {

    const stepButtons = extractStepButtons(currentStep);
    const stepType = String(currentStep.step_type || "message");
    const isCaptureStep = stepType.startsWith("capture_") || stepType === "confirm_phone";
    const refusalCountKey = "ai_followups_count";
    const prevRefusals = Number((ctx.customer as any)[refusalCountKey] || 0);

    // (1) Passo com botões + texto livre → tenta IA mapear pra botão
    if (stepButtons.length > 0 && !ctx.buttonId) {
      try {
        const { isCoverageCityIntent, coverageCityReply } = await import("../../../_shared/coverage-city-intent.ts");
        if (isCoverageCityIntent(ctx.messageText || "")) {
          const cov = coverageCityReply((ctx.customer as any)?.name);
          const btnHint = stepButtons.slice(0, 3).map((b, i) => `${i + 1}) ${b.title}`).join("\n");
          const reply = `${cov}\n\nQuando quiser, pode seguir por aqui 👇\n${btnHint}`;
          console.log(`[conversational] coverage-city intent — respondendo FAQ antes do botão`);
          return _finalize(stepKey, {
            reply,
            updates: {
              conversation_step: stepKey,
              custom_step_retries: 0,
              custom_step_retries_step: null,
              ...restoreDetourUpdates,
            },
          });
        }
      } catch (e) {
        console.warn("[conversational] coverage-city check failed:", (e as Error)?.message);
      }

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
              { id: ctx.customer.id, name: (ctx.customer as any).name, name_source: (ctx.customer as any).name_source, phone_whatsapp: (ctx.customer as any).phone_whatsapp, conversation_step: stepKey },
              ctx.messageText || "",
              "cliente_confuso_botoes",
            ).catch(() => {});
          } catch (_) { /* noop */ }
          return _finalize(stepKey, {
            reply: "Pode escolher uma das opções acima, ou me explicar com outras palavras? Continuo te atendendo por aqui 🙌",
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
        // 🛡️ Anti-duplicação: se o mesmo nudge saiu pro lead há <30s, não reenvia.
        try {
          const since = new Date(Date.now() - 30_000).toISOString();
          const { data: dup } = await ctx.supabase
            .from("conversations")
            .select("id")
            .eq("customer_id", ctx.customer.id)
            .eq("message_direction", "outbound")
            .ilike("message_text", "Posso te ajudar com qualquer uma%")
            .gte("created_at", since)
            .limit(1)
            .maybeSingle();
          if (dup) {
            console.log(`[conversational/whapi] ⏭️ nudge confused suprimido (já enviado <30s)`);
            return _finalize(stepKey, {
              reply: "",
              updates: {
                conversation_step: stepKey,
                [refusalCountKey]: prevRefusals + 1,
                ...restoreDetourUpdates,
              },
            });
          }
        } catch (_e) { /* fail-open */ }
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

    // 🛡️ Fix 3 (2026-06-05): se o lead faz PERGUNTA em passo de captura
    // (foto da conta / doc), força o intent pra "tem_duvida" — assim o
    // bloco FAQ abaixo responde em vez de re-emitir o pedido do passo.
    if (isCaptureStep && !ctx.buttonId && ctx.messageText && (cls.intent as string) !== "tem_duvida") {
      const t = String(ctx.messageText || "").trim();
      const isQuestion = t.includes("?") || /^(quanto|como|quando|onde|qual|por que|porque|pq|o que|tem|posso|precisa|preciso|vai demorar|demora|tempo|prazo|cad[eê]|quem)\b/i.test(t);
      if (isQuestion) {
        console.log(`[conversational/whapi] 🔀 pergunta em capture step → forçando tem_duvida (step=${stepKey})`);
        cls.intent = "tem_duvida" as any;
      }
    }

    // (3) Sem botões e sem recusa.
    // Grupo A / captura (a1 nome, a2 valor…): NUNCA “chama alguém do time” nem
    // pausa — o lead continua com o mesmo consultor; só re-pede o dado do passo.
    // Handoff humano fica só fora do funil determinístico (passos sem captura).
    if (!ctx.buttonId) {
      const stepKeyStr = String(currentStep.step_key || currentStep.slot_key || stepKey || "");
      const slotKeyStr = String(currentStep.slot_key || "");
      const variantA = String((ctx.customer as any)?.flow_variant || "").toUpperCase() === "A";
      const isGrupoAStep =
        variantA ||
        /^a\d+_/i.test(stepKeyStr) ||
        /^a\d+_/i.test(slotKeyStr) ||
        isCaptureStep;
      if (isGrupoAStep) {
        console.log(
          `[conversational] 🔁 baixa confiança no Grupo A/captura — re-pede passo (sem handoff/pausa) step=${stepKeyStr} variant=${(ctx.customer as any)?.flow_variant || ""}`,
        );
        const nudgeAskName = /nome|ask_name|capture_name/i.test(
          `${stepKeyStr} ${currentStep.step_type || ""} ${slotKeyStr}`,
        );
        const reply = nudgeAskName
          ? "Desculpa, não peguei direito 😅 Me manda só seu *primeiro nome* (ou nome completo), por favor?"
          : "Não consegui entender essa mensagem 😅 Pode repetir de outro jeito, ou responder o que pedi acima?";
        return _finalize(stepKey, {
          reply,
          updates: {
            conversation_step: stepKey,
            custom_step_retries: prevRefusals + 1,
            ...restoreDetourUpdates,
          },
        });
      }
      try {
        await notifyHandoff(
          consultantId || ctx.customer.consultant_id,
          { id: ctx.customer.id, name: (ctx.customer as any).name, name_source: (ctx.customer as any).name_source, phone_whatsapp: (ctx.customer as any).phone_whatsapp, conversation_step: stepKey },
          ctx.messageText || "",
          "low_confidence_handoff",
        ).catch(() => {});
      } catch (_) { /* noop */ }
      // Fora do Grupo A: avisa o MESMO consultor (não troca dono) e pausa pra ele assumir.
      return _finalize(stepKey, {
        reply: "Deixa eu te responder com calma — já já continuo por aqui 🙌",
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
      } // fecha o else da guarda determinística
    } catch (_guardErr) {
      console.warn("[conversational] guarda determinística falhou — seguindo fluxo:", (_guardErr as Error)?.message);
    }
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
  if (cls.intent === "tem_duvida" && !hasCapture && !skipAiDetour) {
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

        const renderedFaq = renderTemplate(answerText, {
          nome: ctx.customer.name, nome_source: (ctx.customer as any).name_source,
          representante: ctx.nomeRepresentante,
          valor_conta: (ctx.customer as any).electricity_bill_value,
          telefone: ctx.customer.phone_whatsapp,
          cpf: (ctx.customer as any).cpf,
        });

        // Envia inline + reemit para o lead não ficar sem opções após a dúvida.
        try {
          await ctx.sender.sendText(ctx.remoteJid, renderedFaq);
          if (ctx.customer?.id) {
            await ctx.supabase.from("conversations").insert({
              customer_id: ctx.customer.id,
              message_direction: "outbound",
              message_text: renderedFaq,
              message_type: "text",
              conversation_step: stepKey,
            });
          }
        } catch (e) {
          console.warn("[conversational-orch] sendText falhou:", (e as Error)?.message || e);
        }

        // a3b sem botões → volta ao a3 (mesmo mapa do bot-flow / 11971254913).
        const returnStep = resolveFaqReturnStep(currentStep, dbSteps);
        if (returnStep.id !== currentStep.id) {
          console.log(`[conversational-orch] return ${currentStep.step_key} → ${returnStep.step_key}`);
          currentStep = returnStep;
          stepKey = returnStep.id;
        }

        if (!orch.shouldHandoff) {
          try {
            await reemitStepButtons({
              supabase: ctx.supabase,
              customerId: ctx.customer.id,
              consultantId: consultantId || ctx.customer.consultant_id,
              flowVariant: flowVariant,
              stepKey: currentStep.id || stepKey,
              remoteJid: ctx.remoteJid,
              sendButtons: (jid, text, btns) => ctx.sender.sendButtons(jid, text, btns),
              sendText: (jid, text) => ctx.sender.sendText(jid, text),
              buttons: extractStepButtons(currentStep),
              followups: Number((ctx.customer as any).ai_followups_count || 0),
              delayMs: 500,
            });
          } catch (e) {
            console.warn("[conversational-orch] reemit falhou:", (e as Error)?.message || e);
          }
        }

        return _finalize(stepKey, {
          reply: "",
          updates: {
            conversation_step: stepKey,
            __intent: cls.intent,
            __confidence: cls.confidence,
            __ai_orch: true,
            __inline_sent: true,
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
  // Reusa earlyTransition (botão/frase) se já casou; senão rematch com intents da IA.
  const transition = earlyTransition || matchTransitionShared({
    transitions: currentStep.transitions ?? [],
    buttonId: ctx.buttonId,
    messageText: ctx.messageText,
    buttons: extractStepButtons(currentStep),
    intents: candidateIntents,
  });

  // (Global overrides quer_cadastrar/quer_humano foram movidos para depois das
  // declarações de goToStep/emitStep/vars — caso contrário, chamar goToStep
  // aqui dispara TDZ "Cannot access 'goToStep' before initialization".)


  // Protocolo no A1 (autoridade): gera ANTES de renderizar {{protocolo}}.
  let protocolo = String((ctx.customer as any).tracking_protocol || "").trim();
  if (!protocolo) {
    try {
      const assigned = await assignProtocolToCustomer(ctx.supabase, ctx.customer.id, {
        partnerId: (ctx.customer as any).referral_partner_id || null,
        consultantId: consultantId || ctx.customer.consultant_id || null,
        consultantName: ctx.nomeRepresentante || null,
      });
      protocolo = String(assigned?.protocol || "").trim();
      if (protocolo) (ctx.customer as any).tracking_protocol = protocolo;
    } catch (e) {
      console.warn("[conversational] assignProtocol falhou:", (e as Error).message);
    }
  }

  const vars = {
    nome: captureUpdates.name || ctx.customer.name, nome_source: (captureUpdates as any).name_source || (ctx.customer as any).name_source,
    representante: ctx.nomeRepresentante,
    consultor_gender: ctx.consultorGender || "consultor",
    protocolo,
    valor_conta: captureUpdates.electricity_bill_value ?? (ctx.customer as any).electricity_bill_value,
    telefone: captureUpdates.phone_whatsapp || ctx.customer.phone_whatsapp,
    cpf: captureUpdates.cpf || (ctx.customer as any).cpf,
  };

  // Mapeia step_type especial → primeiro conversation_step do pipeline de cadastro
  const stepTypeToCadastro = (
    st: string | null | undefined,
    stepKey?: string | null,
  ): string | null => {
    if (st === "capture_conta") return "aguardando_conta";
    if (st === "capture_documento") return "aguardando_doc_auto";
    if (st === "capture_email") return "ask_email";
    if (st === "confirm_phone") return "ask_phone_confirm";
    // SEPARADO: boleto → confirmar (nunca finalizando direto)
    // Sofia a10: pula boleto/confirmação → finalizando (portal + OTP)
    if (st === "finalizar_cadastro") {
      return nextSeparatedCadastroStep(ctx.customer as any, { fromStepKey: stepKey });
    }
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
    // Passo make_call: dry-run por padrão (toggles OFF). Não gasta Velip/ElevenLabs.
    if (String(st.step_type || "") === "make_call") {
      const callRes = await handleMakeCallStep({
        supabase: ctx.supabase,
        consultantId: consultantId || ctx.customer.consultant_id,
        customerId: ctx.customer.id,
        customerName: (ctx.customer as any).name ?? null,
        nameSource: (ctx.customer as any).name_source ?? null,
        phoneWhatsapp: (ctx.customer as any).phone_whatsapp ?? null,
        stepKey: st.step_key,
        voiceAudioClipId: st.voice_audio_clip_id,
        personalizeName: !!st.personalize_name,
      });
      console.log(
        `[conversational] make_call step=${st.step_key} ok=${callRes.ok} dryRun=${callRes.dryRun} detail=${callRes.detail}`,
      );
      const note = callRes.dryRun
        ? ""
        : (renderStepText(st) || "");
      if (note && asReply) return { replyText: note, inlineSent: false };
      if (note) {
        try {
          await ctx.sender.sendText(ctx.remoteJid, note);
        } catch { /* noop */ }
        return { replyText: "", inlineSent: true };
      }
      // Sem texto: avança silencioso (cascata).
      return { replyText: "", inlineSent: true };
    }

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
      const _legacyMapped = stepTypeToCadastro(st.step_type, st.step_key);
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
        // NÃO marcar inlineSent=true: isso silencia o _finalize e o lead fica sem resposta.
        return { replyText: text || "", inlineSent: false };
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
          return { replyText: "", inlineSent: false };
        }
      }
    } catch (_e) { /* best-effort */ }

    // Marca name_ask_sent_at + abre atendimento quando emitimos o A1 (pedido de nome).
    try {
      const asksNameNow =
        String(st.step_type || "") === "capture_name" ||
        (Array.isArray(st.captures) &&
          st.captures.some((c: any) => c?.field === "name" && c?.enabled !== false)) ||
        /nome|ask_name/i.test(String(st.slot_key || st.step_key || ""));
      if (asksNameNow && ctx.customer?.id) {
        const ts = new Date().toISOString();
        const patch: Record<string, string> = {};
        if (!(ctx.customer as any).name_ask_sent_at) patch.name_ask_sent_at = ts;
        if (!(ctx.customer as any).welcome_sent_at) patch.welcome_sent_at = ts;
        if (Object.keys(patch).length > 0) {
          await ctx.supabase.from("customers").update(patch).eq("id", ctx.customer.id);
          Object.assign(ctx.customer as any, patch);
        }
      }
    } catch (_) { /* best-effort */ }

    // Quando é reply final, o texto vai como reply (não inline). Quando é cascade
    // ou quando o consultor pediu texto antes da mídia, mandamos tudo inline aqui.
    const slotKey = st.slot_key || st.step_key || st.id;
    const uiOrder = await getStepMediaOrder(
      ctx.supabase,
      consultantId,
      [st.step_key, st.slot_key, slotKey].filter(Boolean) as string[],
    );
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
    // - é o reply final E a ordem termina em "text" SEM áudio antes (texto fica por último → reply)
    // - vamos enviar botões inline no fim (texto vira caption do sendButtons)
    // - já mandamos texto+botões cedo (earlyButtonsSent)
    //
    // EXCEÇÃO A2: media_order [audio, text] → texto SEMPRE inline após o áudio
    // (com text_delay_ms, ex.: 4s). Se for só reply, o 2b some quando __inline_sent=true
    // e o lead fica só com o áudio (ou com “Oi!” de saudação).
    const orderEndsWithText = Array.isArray(configuredOrder) && configuredOrder.length > 0
      && configuredOrder[configuredOrder.length - 1] === "text";
    const audioThenText = Array.isArray(configuredOrder)
      && configuredOrder.includes("audio")
      && configuredOrder.includes("text")
      && configuredOrder.indexOf("audio") < configuredOrder.indexOf("text");
    const sendTextInline = !!text && !earlyButtonsSent && !wantButtons && (
      !asReply
      || audioThenText
      || (!orderEndsWithText && !!configuredOrder)
    );

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

    const sofiaPortal = isSofiaPortalOtpStep(s.step_key);
    let extraBag: Record<string, any> = {
      ...(sofiaPortal ? sofiaPortalContaunicaPrefill() : {}),
      ...extra,
    };
    const cadastroStep = stepTypeToCadastro(s.step_type, s.step_key);
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
      } else if (cadastroStep === "ask_contaunica") {
        replyText = "📄 *Como você prefere receber a fatura?*\n\n1️⃣ *Boleto unificado* — um boleto só\n2️⃣ *Boleto separado* — dois boletos\n\n_Toque ou digite *1* / *2*:_";
      } else if (cadastroStep === "ask_finalizar") {
        replyText = "✅ Tudo pronto! Toque no botão *Finalizar* ou responda *FINALIZAR* para concluir.";
      }
    }

    // Persiste o step alvo ANTES de dispatchar mídia pesada (anti-race entre webhooks paralelos).
    if (ctx.customer?.id) {
      try {
        await ctx.supabase
          .from("customers")
          .update({
            conversation_step: nextConversationStep,
            last_step_advanced_at: new Date().toISOString(),
            ...(sofiaPortal ? sofiaPortalContaunicaPrefill() : {}),
          })
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
      if (stepHasInteractiveWait(st)) return false;
      if (st.wait_for !== "none") return false;
      if (_looksLikeQuestion(st)) return false;
      return true;
    };
    // 🛟 Anti-silêncio: se o primeiro emitStep não produziu texto NEM mídia
    // (passo vazio configurado pelo consultor), força UMA cascata mesmo se
    // wait_for !== 'none' — caso contrário o lead fica sem resposta nenhuma.
    const forceFirstHop = !replyText && !inlineSent && cursor
      && !_hasTextCapture(cursor) && !stepHasInteractiveWait(cursor) && !_looksLikeQuestion(cursor);
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

      const cascadeCadastroStep = stepTypeToCadastro(nextStep.step_type, nextStep.step_key);
      // Se o próximo passo parece pergunta, emite uma vez e para — não cascateia além.
      const nextIsQuestion = !cascadeCadastroStep && (_looksLikeQuestion(nextStep) || stepHasInteractiveWait(nextStep));
      const nextWillCascade = !cascadeCadastroStep && cursorCascades(nextStep)
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
        console.log(`[cascade-stop] pos=${nextStep.position} step=${nextStep.step_key} motivo=aguarda_resposta(interativo/pergunta)`);
        cursor = nextStep;
        break;
      }
      cursor = nextStep;
    }

    // 🔄 Reset de contadores de retry quando o lead avança para outro step.
    // Se o customer estava em retry-mode num step diferente do atual, zera
    // contadores antes de persistir (Property 5 / Requirements 1.5,.4.3).
    const customerRetriesStep = String((ctx.customer as any).custom_step_retries_step || "");
    if (customerRetriesStep && customerRetriesStep !== s.id) {
      console.log(`[conversational] retry-counters-reset step=${s.step_key}`);
      extraBag = {
        ...extraBag,
        custom_step_retries: 0,
        custom_step_retries_step: null,
      };
    }

    // Sofia a10: após emitir o texto do portal+OTP, dispara o worker e fica em
    // aguardando_otp (facial só depois do OTP — portal-otp-watchdog).
    if (sofiaPortal && cadastroStep === "finalizando" && ctx.customer?.id) {
      try {
        const { dispatchPortalWorker } = await import("../../../_shared/portal-worker.ts");
        await ctx.supabase.from("customers").update({
          ...sofiaPortalContaunicaPrefill(),
          status: "cadastro_portal",
          conversation_step: "portal_submitting",
        }).eq("id", ctx.customer.id);
        const dr = await dispatchPortalWorker(ctx.supabase, ctx.customer.id);
        console.log(
          `[sofia-a10] portal dispatch ok=${dr.ok} mode=${dr.mode} status=${dr.status}`,
        );
        nextConversationStep = "aguardando_otp";
        extraBag = {
          ...extraBag,
          ...sofiaPortalContaunicaPrefill(),
          status: "awaiting_otp",
          conversation_step: "aguardando_otp",
        };
        await ctx.supabase.from("customers").update({
          conversation_step: "aguardando_otp",
          status: "awaiting_otp",
        }).eq("id", ctx.customer.id);
      } catch (e) {
        console.warn(`[sofia-a10] portal dispatch falhou:`, (e as Error)?.message || e);
        nextConversationStep = "finalizando";
        extraBag = { ...extraBag, ...sofiaPortalContaunicaPrefill(), conversation_step: "finalizando" };
      }
    }

    return {
      reply: replyText,
      updates: { conversation_step: nextConversationStep, __intent: cls.intent, __confidence: cls.confidence, ...captureUpdates, __inline_sent: inlineSent || undefined, ...extraBag },
    };
  };

  // Global overrides: cadastro / humano só vencem se NÃO houver transição
  // configurada para esse input no passo atual. (Movido para depois de goToStep
  // por causa de TDZ — antes disso a função ainda não está inicializada.)
  //
  // 🛡️ Nunca atalho quer_cadastrar enquanto o passo pede dado (nome/valor/cpf)
  // ou acabamos de capturar — LLM classificava "Rafael Ferreira" como
  // quer_cadastrar e pulava Sofia nome→valor→explicação direto pra conta.
  const stepAsksHardCapture = Array.isArray(currentStep?.captures)
    && currentStep.captures.some((c: any) =>
      c?.enabled !== false && ["name", "electricity_bill_value", "cpf", "phone_whatsapp"].includes(String(c?.field || ""))
    );
  const stepIsCaptureName = String(currentStep?.step_type || "") === "capture_name"
    || /\bnome\b/i.test(String((currentStep as any)?.title || ""))
    || /nome|ask_name/i.test(String(currentStep?.slot_key || ""));
  const looksLikeNameReply = !!extractNome(ctx.messageText || "", {
    allowSingleWord: stepIsCaptureName || stepAsksHardCapture,
  });
  const blockCadastroShortcut = hasCapture
    || stepAsksHardCapture
    || stepIsCaptureName
    || looksLikeNameReply
    || postCaptureLanded;

  if (!transition && cls.intent === "quer_cadastrar" && !blockCadastroShortcut) {
    const dest = pickActivateDestination(dbSteps as any[], ctx.customer as any);
    if (dest) {
      return _finalize(stepKey, await goToStep(dest as DbStep, restoreDetourUpdates));
    }
    return _finalize(stepKey, {
      reply: await getTemplate(ctx.supabase, "checkin_pos_video", "pedir_conta", {
        nome: ctx.customer.name, nome_source: (ctx.customer as any).name_source, representante: ctx.nomeRepresentante,
      }),
      updates: { conversation_step: "aguardando_conta", __intent: cls.intent, __confidence: cls.confidence, ...captureUpdates, ...restoreDetourUpdates },
    });
  }
  if (!transition && cls.intent === "quer_cadastrar" && blockCadastroShortcut) {
    console.log(
      `[conversational] quer_cadastrar ignorado (atalho bloqueado) step=${currentStep?.step_key} ` +
      `hasCapture=${hasCapture} asksHard=${stepAsksHardCapture} nameLike=${looksLikeNameReply}`,
    );
  }
  if (!transition && cls.intent === "quer_humano") {
    return _finalize(stepKey, {
      reply: await getTemplate(ctx.supabase, "aguardando_humano", "avisado", {
        nome: ctx.customer.name, nome_source: (ctx.customer as any).name_source, representante: ctx.nomeRepresentante,
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
    // GUARD 1: debounce — silêncio só nos primeiros 8s (proteção de corrida de
    // envio duplo). Acima disso, segue o fluxo normal: se o texto saiu há <90s
    // o lead recebe uma reformulação curta — bot mudo parece travamento.
    try {
      const sinceDebounce = new Date(Date.now() - 8_000).toISOString();
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
    // Nome só via fonte confiável — push-name/lixo nunca entra na saudação.
    const userName = safeFirstNameForAddress(
      (ctx.customer as any)?.name,
      (ctx.customer as any)?.name_source,
    ) || "";
    const reformVariants: Record<string, string[]> = {
      default: [
        "Sem pressa 🙂 Me conta com suas palavras que eu te oriento.",
        "Tô aqui — pode me falar do seu jeito 😊",
        "Entendi. Se puder me contar um pouquinho mais, eu te ajudo na sequência 🌱",
        userName ? `${userName}, fico no aguardo quando puder — respondo por aqui 💚` : "Fico no aguardo quando puder — respondo por aqui 💚",
        "Pode me falar do jeito que for mais fácil pra você 😊",
        "Sem cobrança — quando puder, me conta que eu sigo com você 🙂",
      ],
      valor: [
        userName ? `${userName}, me passa só o valor médio da conta de luz? Pode ser aproximado 😉` : "Me passa só o valor médio da conta de luz? Pode ser aproximado 😉",
        "Quanto vem em média sua conta de luz? Tipo R$ 200, R$ 400...",
        "Pode mandar só o número mesmo, ex: 350 🙏",
        "Me diz uma média da conta — não precisa ser exato, ok?",
        "Quanto você paga mais ou menos por mês de luz?",
      ],
      nome: [
        "Como posso te chamar? Só seu primeiro nome já tá ótimo 😊",
        "Me conta seu nome? 🙂",
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
    // F16: nudge "3) Ativar" (passo SEM botões) vs transition "3"=humano.
    // Com botões reais, "3" continua sendo o 3º botão (ex.: Falar com Rafael).
    const nudgeChoice = resolveCanonicalNudgeChoice(ctx.messageText);
    const stepHasButtons = extractStepButtons(currentStep).length > 0;
    if (
      t.goto_special === "humano" &&
      !stepHasButtons &&
      (nudgeChoice === "ativar" || isActivateIntent(ctx.messageText, ctx.buttonId))
    ) {
      const dest = pickActivateDestination(dbSteps as any[], ctx.customer as any);
      if (dest) {
        console.log(`[activate-routing] override humano→ativar step=${dest.step_key}`);
        return goToStep(dest as DbStep, restoreDetourUpdates);
      }
    }

    if (t.goto_special === "cadastro") {
      const dest = pickActivateDestination(dbSteps as any[], ctx.customer as any);
      if (dest) return goToStep(dest as DbStep, restoreDetourUpdates);
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
    // A9 "Quero outro": pede o número novo e NÃO avança (nem só repete o confirm).
    if (t.goto_special === "ask_other_phone") {
      const nome = safeFirstNameForAddress(
        (ctx.customer as any)?.name,
        (ctx.customer as any)?.name_source,
      );
      return _finalize(stepKey, {
        reply: `${nome ? nome + ", " : ""}me manda o *outro número* com DDD (ex.: 34 99999-0000) que eu atualizo aqui 📱`,
        updates: {
          conversation_step: stepKey,
          phone_contact_confirmed: false,
          ...captureUpdates,
          ...restoreDetourUpdates,
        },
      });
    }
    if (t.goto_special === "repeat" || (!t.goto_step_id && !t.goto_special)) return repeatCurrent();
    let nextStep = dbSteps.find((s) => s.id === t.goto_step_id);
    // F16: cadastrar/ativar NÃO pode cair na conta de simulação (→ resultado).
    if (nextStep) {
      const rewritten = rewriteActivateAwayFromSimPath(
        nextStep as any,
        dbSteps as any[],
        ctx.customer as any,
        { messageText: ctx.messageText, buttonId: ctx.buttonId },
      );
      if (rewritten) {
        console.log(
          `[activate-routing] rewrite ${nextStep.step_key}→${rewritten.step_key} (ativar≠simular)`,
        );
        nextStep = rewritten as DbStep;
      }
    }
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
    // Não reemitir pergunta já respondida (nome/valor/cpf/tel).
    const hardFields = ["name", "electricity_bill_value", "cpf", "phone_whatsapp"] as const;
    const asked = hardFields.filter((f) =>
      Array.isArray(cur.captures) &&
      cur.captures.some((c: any) => c?.field === f && c?.enabled !== false)
    );
    const justCaptured = asked.filter((f) =>
      (f === "name" && !!captureUpdates.name) ||
      (f === "electricity_bill_value" && captureUpdates.electricity_bill_value != null) ||
      (f === "cpf" && !!captureUpdates.cpf) ||
      (f === "phone_whatsapp" && !!captureUpdates.phone_whatsapp) ||
      isFieldAlreadyCaptured(f, ctx.customer)
    );
    if (asked.length > 0 && justCaptured.length === asked.length) {
      console.log(`[emit-before-goto] skip "${cur.step_key}" — captura satisfeita (${asked.join(",")}), indo para "${next.step_key}"`);
      return;
    }
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

  // 1.25) Nudge canônico sem transition (passo sem botões / texto "ativar")
  {
    const choice = resolveCanonicalNudgeChoice(ctx.messageText);
    const wantActivate = choice === "ativar" || isActivateIntent(ctx.messageText, ctx.buttonId);
    if (wantActivate && extractStepButtons(currentStep).length === 0) {
      const dest = pickActivateDestination(dbSteps as any[], ctx.customer as any);
      if (dest) {
        console.log(`[activate-routing] nudge/texto→${dest.step_key}`);
        return _finalize(stepKey, await goToStep(dest as DbStep, restoreDetourUpdates));
      }
    }
  }


  // 1.5) Captura sem transição configurada → segue o Plano B configurado
  // (PREFERE fallback.goto_step_id — é o que o consultor configurou em /admin/fluxos).
  // Só cai pra próximo por posição como último recurso.
  if (hasCapture) {
    // Pós-captura já pousou no próximo passo que AINDA precisa de resposta
    // (ex.: nome capturado → landing em a2 pedir valor). Emite esse passo
    // e PARA — não avance de novo por position (bug: nome → pulava valor).
    if (postCaptureLanded) {
      console.log(`[conversational] post-capture land → emitindo "${currentStep.step_key}" (sem re-advance)`);
      return _finalize(stepKey, await goToStep(currentStep, restoreDetourUpdates));
    }
    let nextByConfig: DbStep | undefined;
    // PRIORIDADE: fallback.success_goto_step_id (override pós-captura-sucesso configurado pelo admin)
    // → fallback.goto_step_id (modo goto tradicional)
    // → transitions[default].goto_step_id
    // → próximo por position (último recurso).
    const successId = (currentStep.fallback as any)?.success_goto_step_id || null;
    const fbId = currentStep.fallback?.mode === "goto" ? currentStep.fallback.goto_step_id : null;
    const defaultGoto = Array.isArray(currentStep.transitions)
      ? currentStep.transitions.find((t: any) => t?.trigger_intent === "default" && t?.goto_step_id)?.goto_step_id
      : null;
    const preferredId = successId || fbId || defaultGoto || null;
    if (preferredId) nextByConfig = dbSteps.find((s) => s.is_active && s.id === preferredId);
    if (!nextByConfig) {
      nextByConfig = dbSteps.find((s) => s.is_active && s.position > currentStep.position);
    }
    if (nextByConfig) {
      console.log(`[conversational] auto-advance por captura ${currentStep.step_key} → ${nextByConfig.step_key} (intents=${captureIntents.join(",")}, source=${successId ? "fallback.success_goto" : fbId ? "fallback.goto" : defaultGoto ? "transition.default" : "position"})`);
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

  // 1.9) POUSO POR SKIP NA ENTRADA — o auto-capture do webhook (index.ts) salva
  // nome/valor/cpf/telefone ANTES do motor rodar; o resolveLandingStep da
  // entrada então avança o passo (a1→a2, a2→a3) mas ninguém EMITE o passo
  // pousado: `hasCapture` fica false (o dado já estava no customer) e o turno
  // caía no reentry do _finalize — o lead recebia só o "tail" da pergunta,
  // sem áudio Sofia, sem o texto completo e sem botões (bug Marcio 19/07,
  // 01:00 UTC: a3 saiu como "*O que você prefere agora*?" truncado).
  // goToStep emite mídia+texto+botões e persiste o conversation_step; o
  // anti-rep interno do emitStep (10 min) protege contra reemissão.
  if (entryLandedByCapture && currentStep) {
    console.log(
      `[conversational] 🛬 entry-skip land → emitindo "${currentStep.step_key}" ` +
      `(dado capturado no webhook antes do motor; sem transition p/ este input)`,
    );
    return _finalize(stepKey, await goToStep(currentStep, restoreDetourUpdates));
  }

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
          { nome: ctx.customer.name, nome_source: (ctx.customer as any).name_source, representante: ctx.nomeRepresentante },
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
      "Sem pressa 🙂 Me conta com suas palavras que eu te oriento.",
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
      // Renderiza {{representante}}, {{nome}} etc. ANTES de mandar pro LLM
      // — sem isso, o prompt ia literal "Você é a {{representante}}..." e a IA
      // tentava preencher sozinha (ou se nomeava "{{representante}}").
      const renderedSystemPrompt = renderTemplate(String(fb.ai_prompt), {
        nome: ctx.customer.name || "", nome_source: (ctx.customer as any).name_source,
        representante: ctx.nomeRepresentante,
      });
      const aiText = await generateAiAnswer({
        supabase: ctx.supabase,
        consultantId: consultantId || "global",
        systemPrompt: renderedSystemPrompt,
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
            delivery_status: "sent",
          });
        } catch (e) {
          console.warn("[ai_answer] sendText falhou:", (e as any)?.message);
        }
        // 🔘 Re-emitir botões do passo (captures._buttons) logo após a IA falar.
        // Sem isso, o lead recebe só o texto e fica sem opções pra avançar
        // (Whapi=botão real, Evolution=lista numerada — renderChoice cuida).
        try {
          const stepButtons = extractStepButtons(currentStep);
          if (stepButtons.length > 0) {
            const prompt = "👇 É só escolher uma opção:";
            await ctx.sender.sendButtons(ctx.remoteJid, prompt, stepButtons);
            await ctx.supabase.from("conversations").insert({
              customer_id: ctx.customer.id,
              message_direction: "outbound",
              message_text: prompt,
              message_type: "text",
              conversation_step: currentStep.step_key,
              delivery_status: "sent",
            });
          } else {
            // F02: sem botões configurados — CTA textual para não ficar parado após áudio/dúvida
            const nudge = ACTIVATE_CTA_NUDGE;
            await ctx.sender.sendText(ctx.remoteJid, nudge);
            await ctx.supabase.from("conversations").insert({
              customer_id: ctx.customer.id,
              message_direction: "outbound",
              message_text: nudge,
              message_type: "text",
              conversation_step: currentStep.step_key,
              delivery_status: "sent",
            });
          }
        } catch (e) {
          console.warn("[ai_answer] sendButtons pós-IA falhou:", (e as any)?.message);
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
  const vars = { nome: ctx.customer.name, nome_source: (ctx.customer as any).name_source, representante: ctx.nomeRepresentante, consultor_gender: ctx.consultorGender || "consultor" };
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
