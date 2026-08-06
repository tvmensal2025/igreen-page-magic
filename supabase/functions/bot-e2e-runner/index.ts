/**
 * Simulador real do bot: cria um lead de teste, envia mensagens pelo whapi-webhook
 * e valida a conversa ponta-a-ponta sem custo de WhatsApp.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  buildWhapiBody,
  cleanStep,
  type CustomerSnapshot,
  loadStepIndex,
  nextReply,
  PROGRESSED_STEPS,
  type Reply,
  type StepIndex,
  TEST_IMAGE_BASE64,
} from "./scenario-script.ts";
import {
  runV3DirectScenario,
  V3_DIRECT_SCENARIOS,
  type V3DirectScenario,
} from "./v3-scenarios.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

type Scenario =
  | "happy_path"
  | "lead_indeciso"
  | "valor_baixo"
  | "lead_some"
  | "documento_cnh"
  | "recusa_conta"
  | "recusa_documento"
  | "joia_validacao"
  // ─── Cenários de validação retry (Task 11 do spec flow-d-retry-rules-fix) ───
  | "fluxo_d_ocr_ok"               // A1: foto válida → avança normalmente
  | "fluxo_d_ocr_retry_1x"         // A2: OCR fail 1x → retry_text, no escalate
  | "fluxo_d_ocr_retry_exhausted"  // A3: OCR fail 3x → bot_paused + handoff alert
  | "fluxo_a_ocr_fail"             // A4: variant=A sem retry → defaultText hardcoded
  | "ask_choice_retry_1x"          // B1: lixo em ask_choice mode=retry → retry_text
  | "ask_choice_retry_exhausted"   // B2: lixo 3x → bot_paused
  // ─── Cenários v3 diretos (Task 30 do spec flow-engine-v3-rewrite, design §4.3) ───
  // Drive `runEngine` puro com fixtures sintéticos. Não chama whapi-webhook.
  // Validam G1–G6 + assertivas de cada cenário antes do dispatcher real.
  | V3DirectScenario;

const RETRY_SCENARIOS = new Set<Scenario>([
  "fluxo_d_ocr_ok",
  "fluxo_d_ocr_retry_1x",
  "fluxo_d_ocr_retry_exhausted",
  "fluxo_a_ocr_fail",
  "ask_choice_retry_1x",
  "ask_choice_retry_exhausted",
]);

function commercialStatus(status: string, checks: Array<{ passed: boolean }>): string {
  if (status === "completed") return checks.every((c) => c.passed) ? "Pronto para vender" : "Corrigir antes de vender";
  if (status === "low_value") return "Regra de descarte validada";
  if (status === "lead_silent") return "Abandono identificado";
  return "Não colocar no mercado";
}

// ════════════════════════════════════════════════════════════════════════
// Cenários de retry (Task 11 do spec flow-d-retry-rules-fix)
// ════════════════════════════════════════════════════════════════════════
// Estes cenários NÃO seguem o loop de turns do happy_path — cada um faz
// chamadas pontuais ao whapi-webhook com headers específicos (incluindo o
// novo `x-bot-force-ocr-fail` que ativa um mock determinístico em
// `_shared/ocr.ts`, gated por `isTestMode()` para não afetar produção).
//
// Cada cenário valida três tabelas:
//   • `conversations` → outbound REPLIES emitidos pelo bot
//   • `customers`     → estado final (bot_paused, conversation_step, retries…)
//   • `bot_handoff_alerts` → criado APENAS em cenários "exhausted"
//
// Idempotência: como o customer é criado fresh por run e os dados de teste
// vivem em `bot_test_outbound`/`bot_test_runs`, não fazemos cleanup explícito;
// runs antigas ficam para auditoria.
// ════════════════════════════════════════════════════════════════════════

interface RetryScenarioCheck {
  name: string;
  passed: boolean;
  detail?: string;
}

interface RetryScenarioResult {
  ok: boolean;
  status: string;
  checks: RetryScenarioCheck[];
  customer: any;
  conversations: any[];
  handoffAlerts: any[];
  customStepKey?: string;
}

async function postWhapiTurn(
  runId: string,
  turn: number,
  phone: string,
  payload: any,
  opts: { forceOcrFail?: boolean } = {},
): Promise<{ ok: boolean; status: number; bodyPreview: string }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${SERVICE_ROLE}`,
    apikey: SERVICE_ROLE,
    "x-bot-test-run-id": runId,
    "x-bot-test-turn": String(turn),
    "x-bot-bypass-quiet-hours": "1",
    "x-bot-fast-clock": "1",
  };
  if (opts.forceOcrFail) headers["x-bot-force-ocr-fail"] = "1";
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/whapi-webhook`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    const txt = await res.text().catch(() => "");
    return { ok: res.ok, status: res.status, bodyPreview: txt.slice(0, 200) };
  } catch (e) {
    return { ok: false, status: 0, bodyPreview: String((e as Error)?.message || e) };
  }
}

async function loadCustomerState(supabase: any, customerId: string): Promise<any> {
  const { data } = await supabase
    .from("customers")
    .select("id, conversation_step, bot_paused, bot_paused_reason, bot_paused_at, ocr_conta_attempts, ocr_doc_attempts, custom_step_retries, custom_step_retries_step, flow_variant, name, status")
    .eq("id", customerId)
    .maybeSingle();
  return data || null;
}

async function loadConversations(supabase: any, customerId: string): Promise<any[]> {
  const { data } = await supabase
    .from("conversations")
    .select("id, message_direction, message_text, message_type, conversation_step, created_at")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: true });
  return data || [];
}

async function loadHandoffAlerts(supabase: any, customerId: string): Promise<any[]> {
  const { data } = await supabase
    .from("bot_handoff_alerts")
    .select("id, alert_type, reason, metadata, created_at")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: true });
  return data || [];
}

/**
 * Garante existência do step `capture_conta` configurado com `mode=retry` no
 * fluxo D ativo do consultor super-admin. Necessário porque o seed do flow D
 * já vem com retry, mas se a migration não rodou, o cenário falha silencioso.
 */
async function ensureFlowDRetryConfig(
  supabase: any,
  consultantId: string,
  stepType: "capture_conta" | "capture_documento",
  config: { max_retries: number; retry_text: string; then: "humano" | "next" | "repeat" },
): Promise<{ flowId: string; stepId: string } | null> {
  const { data: flow } = await supabase
    .from("bot_flows").select("id")
    .eq("consultant_id", consultantId).eq("variant", "D").eq("is_active", true)
    .order("created_at", { ascending: true }).limit(1).maybeSingle();
  if (!flow?.id) return null;
  const { data: step } = await supabase
    .from("bot_flow_steps").select("id, fallback")
    .eq("flow_id", flow.id).eq("step_type", stepType).eq("is_active", true)
    .order("position", { ascending: true }).limit(1).maybeSingle();
  if (!step?.id) return null;
  const desired = {
    mode: "retry",
    max_retries: config.max_retries,
    retry_text: config.retry_text,
    then: config.then,
  };
  await supabase
    .from("bot_flow_steps")
    .update({ fallback: { ...(step.fallback || {}), ...desired } })
    .eq("id", step.id);
  return { flowId: flow.id, stepId: step.id };
}

/**
 * Cria um step `ask_text` ad-hoc num fluxo dedicado de testes para validar
 * `mode=retry` em handler conversational (cenários B1/B2). Se já existir
 * step com a mesma `step_key` no fluxo, atualiza o fallback in-place.
 *
 * Usa `variant = "T"` (test) para não conflitar com fluxos reais A/B/C/D/E.
 * Cleanup feito por `cleanupAskChoiceTestFlow()` ao final do cenário.
 */
async function ensureAskChoiceRetryFlow(
  supabase: any,
  consultantId: string,
  config: { max_retries: number; retry_text: string; then: "humano" | "next" | "repeat" },
): Promise<{ flowId: string; stepId: string; stepKey: string } | null> {
  const stepKey = "test_ask_retry";
  // Cria/recupera fluxo de teste
  let { data: flow } = await supabase
    .from("bot_flows")
    .select("id")
    .eq("consultant_id", consultantId)
    .eq("variant", "T")
    .eq("is_active", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!flow?.id) {
    const { data: created, error } = await supabase
      .from("bot_flows")
      .insert({
        consultant_id: consultantId,
        variant: "T",
        name: "E2E Retry Test (auto)",
        is_active: true,
      })
      .select("id")
      .single();
    if (error) {
      console.error("[ensureAskChoiceRetryFlow] failed to create flow:", error.message);
      return null;
    }
    flow = created;
  }

  // Cria/atualiza step ask_text com mode=retry
  const fallback = {
    mode: "retry",
    max_retries: config.max_retries,
    retry_text: config.retry_text,
    then: config.then,
  };
  let { data: step } = await supabase
    .from("bot_flow_steps")
    .select("id")
    .eq("flow_id", flow.id)
    .eq("step_key", stepKey)
    .maybeSingle();
  if (!step?.id) {
    const { data: created, error } = await supabase
      .from("bot_flow_steps")
      .insert({
        flow_id: flow.id,
        step_key: stepKey,
        step_type: "ask_text",
        position: 1,
        is_active: true,
        message_text: "Manda *sim* ou *não* pra continuar 🙂",
        transitions: [
          { trigger_intent: "palavra_chave", trigger_phrases: ["sim"], goto_special: "humano" },
          { trigger_intent: "palavra_chave", trigger_phrases: ["não", "nao"], goto_special: "humano" },
        ],
        fallback,
      })
      .select("id")
      .single();
    if (error) {
      console.error("[ensureAskChoiceRetryFlow] failed to create step:", error.message);
      return null;
    }
    step = created;
  } else {
    await supabase.from("bot_flow_steps").update({ fallback, is_active: true }).eq("id", step.id);
  }
  return { flowId: flow.id, stepId: step.id, stepKey };
}

async function cleanupAskChoiceTestFlow(supabase: any, flowId: string): Promise<void> {
  try {
    await supabase.from("bot_flow_steps").delete().eq("flow_id", flowId);
    await supabase.from("bot_flows").delete().eq("id", flowId);
  } catch (e) {
    console.warn("[cleanupAskChoiceTestFlow]", (e as any)?.message);
  }
}

async function runRetryScenario(
  scenario: Scenario,
  supabase: any,
  runId: string,
  consultantId: string,
  customerId: string,
  phone: string,
): Promise<RetryScenarioResult> {
  const checks: RetryScenarioCheck[] = [];
  const tsBase = Math.floor(Date.now() / 1000);

  // Helper para inserir uma mensagem inbound (texto ou imagem) e logar em bot_test_outbound
  const sendInbound = async (turn: number, opts: { text?: string; isImage?: boolean; forceOcrFail?: boolean }) => {
    const id = `retry_${runId}_${turn}_${Math.random().toString(36).slice(2, 8)}`;
    const chatId = `${phone}@s.whatsapp.net`;
    const base = { id, chat_id: chatId, from: phone, from_me: false, timestamp: tsBase + turn };
    let payload: any;
    let kind = "text";
    let content = opts.text || "";
    if (opts.isImage) {
      kind = "image";
      content = "[imagem fictícia]";
      payload = {
        event: { type: "messages" },
        messages: [{
          ...base,
          type: "image",
          image: { mime_type: "image/png", data: TEST_IMAGE_BASE64, link: `data:image/png;base64,${TEST_IMAGE_BASE64}` },
        }],
      };
    } else {
      payload = {
        event: { type: "messages" },
        messages: [{ ...base, type: "text", text: { body: opts.text || "" } }],
      };
    }
    await supabase.from("bot_test_outbound").insert({
      run_id: runId,
      turn,
      direction: "inbound",
      kind,
      content,
    });
    return await postWhapiTurn(runId, turn, phone, payload, { forceOcrFail: opts.forceOcrFail });
  };

  // ─── A1 / A2 / A3: cenários OCR conta no fluxo D ───
  if (scenario === "fluxo_d_ocr_ok" || scenario === "fluxo_d_ocr_retry_1x" || scenario === "fluxo_d_ocr_retry_exhausted") {
    // Garante step capture_conta com fallback retry no fluxo D
    const cfg = await ensureFlowDRetryConfig(supabase, consultantId, "capture_conta", {
      max_retries: 2,
      retry_text: "📷 Não recebi a foto. Pode reenviar a *conta de luz*?",
      then: "humano",
    });
    checks.push({
      name: "Fluxo D ativo com capture_conta configurado",
      passed: !!cfg,
      detail: cfg ? `step=${cfg.stepId}` : "fluxo_D_ou_step_nao_encontrado",
    });

    // Coloca o customer direto em aguardando_conta para focar no OCR
    await supabase.from("customers").update({
      flow_variant: "D",
      conversation_step: "aguardando_conta",
      ocr_conta_attempts: 0,
      bot_paused: false,
      bot_paused_reason: null,
      bot_paused_at: null,
    }).eq("id", customerId);

    if (scenario === "fluxo_d_ocr_ok") {
      // 📷 foto válida (OCR real roda no Gemini) — usar foto real seria custoso;
      // aceitamos sucesso parcial (avança ou fica em aguardando_conta + erro de imagem ilegível).
      const r = await sendInbound(1, { isImage: true, forceOcrFail: false });
      checks.push({ name: "Webhook respondeu", passed: r.ok, detail: `status=${r.status}` });
      const after = await loadCustomerState(supabase, customerId);
      const advanced = after?.conversation_step !== "aguardando_conta";
      const stayedDueToBadPng = after?.conversation_step === "aguardando_conta" && (after?.ocr_conta_attempts ?? 0) >= 1;
      checks.push({
        name: "OCR processado (avançou ou contou tentativa)",
        passed: advanced || stayedDueToBadPng,
        detail: `step=${after?.conversation_step}, attempts=${after?.ocr_conta_attempts}`,
      });
      checks.push({
        name: "bot_paused permanece false",
        passed: after?.bot_paused !== true,
        detail: `paused=${after?.bot_paused}`,
      });
    }

    if (scenario === "fluxo_d_ocr_retry_1x") {
      // 1 foto com OCR forçado a falhar
      const r = await sendInbound(1, { isImage: true, forceOcrFail: true });
      checks.push({ name: "Webhook respondeu", passed: r.ok, detail: `status=${r.status}` });
      const after = await loadCustomerState(supabase, customerId);
      checks.push({
        name: "ocr_conta_attempts incrementado para 1",
        passed: after?.ocr_conta_attempts === 1,
        detail: `attempts=${after?.ocr_conta_attempts}`,
      });
      checks.push({
        name: "bot NÃO escalou para humano (attempts < max)",
        passed: after?.bot_paused !== true && after?.conversation_step === "aguardando_conta",
        detail: `paused=${after?.bot_paused}, step=${after?.conversation_step}`,
      });
      const conv = await loadConversations(supabase, customerId);
      const lastBot = [...conv].reverse().find((c: any) => c.message_direction === "outbound");
      const usedRetryText = !!lastBot && /n[ãa]o.*recebi|reenviar|conta de luz|nít|n[ií]tida/i.test(String(lastBot.message_text || ""));
      checks.push({
        name: "Resposta usou retry_text configurado (não bot_paused)",
        passed: usedRetryText,
        detail: lastBot ? String(lastBot.message_text || "").slice(0, 80) : "sem outbound",
      });
    }

    if (scenario === "fluxo_d_ocr_retry_exhausted") {
      // 3 fotos com OCR forçado a falhar (max_retries=2 → na 3ª escala)
      for (let t = 1; t <= 3; t++) {
        const r = await sendInbound(t, { isImage: true, forceOcrFail: true });
        if (!r.ok) {
          checks.push({ name: `Webhook respondeu turn ${t}`, passed: false, detail: `status=${r.status}` });
        }
        await new Promise((res) => setTimeout(res, 300));
      }
      const after = await loadCustomerState(supabase, customerId);
      checks.push({
        name: "ocr_conta_attempts >= max_retries",
        passed: (after?.ocr_conta_attempts ?? 0) >= 2,
        detail: `attempts=${after?.ocr_conta_attempts}`,
      });
      checks.push({
        name: "bot_paused = true",
        passed: after?.bot_paused === true,
        detail: `paused=${after?.bot_paused}, reason=${after?.bot_paused_reason}`,
      });
      checks.push({
        name: "bot_paused_reason termina com _retry_exhausted",
        passed: typeof after?.bot_paused_reason === "string" && after.bot_paused_reason.endsWith("_retry_exhausted"),
        detail: `reason=${after?.bot_paused_reason}`,
      });
      checks.push({
        name: "conversation_step = aguardando_humano",
        passed: after?.conversation_step === "aguardando_humano",
        detail: `step=${after?.conversation_step}`,
      });
      // Handoff alert (recordFlowDAlert + retry_exhausted insert)
      const alerts = await loadHandoffAlerts(supabase, customerId);
      checks.push({
        name: "bot_handoff_alerts >= 1 registro criado",
        passed: alerts.length >= 1,
        detail: `count=${alerts.length}`,
      });
    }
  }

  // ─── A4: variant=A sem retry → defaultText hardcoded (regressão) ───
  if (scenario === "fluxo_a_ocr_fail") {
    await supabase.from("customers").update({
      flow_variant: "A",
      conversation_step: "aguardando_conta",
      ocr_conta_attempts: 0,
      bot_paused: false,
      bot_paused_reason: null,
      bot_paused_at: null,
    }).eq("id", customerId);
    const r = await sendInbound(1, { isImage: true, forceOcrFail: true });
    checks.push({ name: "Webhook respondeu", passed: r.ok, detail: `status=${r.status}` });
    const after = await loadCustomerState(supabase, customerId);
    checks.push({
      name: "ocr_conta_attempts incrementado",
      passed: (after?.ocr_conta_attempts ?? 0) >= 1,
      detail: `attempts=${after?.ocr_conta_attempts}`,
    });
    // Para variant A SEM retry config, o helper retorna { retryText: defaultText, escalate: false }
    checks.push({
      name: "bot_paused permanece false (variant A não escala)",
      passed: after?.bot_paused !== true,
      detail: `paused=${after?.bot_paused}`,
    });
    const conv = await loadConversations(supabase, customerId);
    const lastBot = [...conv].reverse().find((c: any) => c.message_direction === "outbound");
    const usedDefault = !!lastBot && /n[ãa]o consegui|tente|n[ií]tida|reflexos/i.test(String(lastBot.message_text || ""));
    checks.push({
      name: "Resposta usou default text (regressão variant A)",
      passed: usedDefault,
      detail: lastBot ? String(lastBot.message_text || "").slice(0, 80) : "sem outbound",
    });
    const alerts = await loadHandoffAlerts(supabase, customerId);
    checks.push({
      name: "bot_handoff_alerts NÃO criado para variant A",
      passed: alerts.length === 0,
      detail: `count=${alerts.length}`,
    });
  }

  // ─── B1 / B2: ask_choice retry (engine flow) ───
  let askFlowId: string | null = null;
  let customStepKey: string | undefined;
  if (scenario === "ask_choice_retry_1x" || scenario === "ask_choice_retry_exhausted") {
    const cfg = await ensureAskChoiceRetryFlow(supabase, consultantId, {
      max_retries: 2,
      retry_text: "🤔 Não entendi. Manda só *sim* ou *não*.",
      then: "humano",
    });
    if (!cfg) {
      checks.push({ name: "Setup do fluxo de teste ask_choice", passed: false, detail: "falhou" });
      return { ok: false, status: "setup_failed", checks, customer: null, conversations: [], handoffAlerts: [] };
    }
    askFlowId = cfg.flowId;
    customStepKey = cfg.stepKey;
    checks.push({ name: "Setup do fluxo de teste ask_choice", passed: true, detail: `step=${cfg.stepKey}` });

    // Posiciona o customer no step de teste (usa ID do step para o engine flow router)
    await supabase.from("customers").update({
      flow_variant: "T",
      conversation_step: cfg.stepId,
      custom_step_retries: 0,
      custom_step_retries_step: null,
      bot_paused: false,
      bot_paused_reason: null,
      bot_paused_at: null,
    }).eq("id", customerId);

    const repeats = scenario === "ask_choice_retry_1x" ? 1 : 3;
    for (let t = 1; t <= repeats; t++) {
      const r = await sendInbound(t, { text: `lixo aleatório ${t} 🤡` });
      if (!r.ok) checks.push({ name: `Webhook respondeu turn ${t}`, passed: false, detail: `status=${r.status}` });
      await new Promise((res) => setTimeout(res, 300));
    }

    const after = await loadCustomerState(supabase, customerId);

    if (scenario === "ask_choice_retry_1x") {
      checks.push({
        name: "custom_step_retries incrementado para 1",
        passed: after?.custom_step_retries === 1,
        detail: `retries=${after?.custom_step_retries}`,
      });
      checks.push({
        name: "bot NÃO escalou (attempts < max)",
        passed: after?.bot_paused !== true,
        detail: `paused=${after?.bot_paused}`,
      });
      const conv = await loadConversations(supabase, customerId);
      const lastBot = [...conv].reverse().find((c: any) => c.message_direction === "outbound");
      const usedRetry = !!lastBot && /n[ãa]o entendi|sim ou n[ãa]o/i.test(String(lastBot.message_text || ""));
      checks.push({
        name: "Resposta usou retry_text configurado",
        passed: usedRetry,
        detail: lastBot ? String(lastBot.message_text || "").slice(0, 80) : "sem outbound",
      });
    }

    if (scenario === "ask_choice_retry_exhausted") {
      checks.push({
        name: "bot_paused = true após exceder max_retries",
        passed: after?.bot_paused === true,
        detail: `paused=${after?.bot_paused}, reason=${after?.bot_paused_reason}`,
      });
      checks.push({
        name: "bot_paused_reason endsWith _retry_exhausted",
        passed: typeof after?.bot_paused_reason === "string" && after.bot_paused_reason.endsWith("_retry_exhausted"),
        detail: `reason=${after?.bot_paused_reason}`,
      });
      checks.push({
        name: "conversation_step = aguardando_humano",
        passed: after?.conversation_step === "aguardando_humano",
        detail: `step=${after?.conversation_step}`,
      });
      checks.push({
        name: "custom_step_retries zerado pós-handoff",
        passed: (after?.custom_step_retries ?? -1) === 0,
        detail: `retries=${after?.custom_step_retries}`,
      });
      const alerts = await loadHandoffAlerts(supabase, customerId);
      const exhaustedAlert = alerts.find((a: any) => String(a.reason || "").endsWith("_retry_exhausted"));
      checks.push({
        name: "bot_handoff_alerts contém reason *_retry_exhausted",
        passed: !!exhaustedAlert,
        detail: `count=${alerts.length}, reasons=${alerts.map((a: any) => a.reason).join("|")}`,
      });
    }
  }

  // Snapshot final
  const finalCustomer = await loadCustomerState(supabase, customerId);
  const finalConv = await loadConversations(supabase, customerId);
  const finalAlerts = await loadHandoffAlerts(supabase, customerId);

  // Cleanup do fluxo ad-hoc (B1/B2) — idempotente
  if (askFlowId) await cleanupAskChoiceTestFlow(supabase, askFlowId);

  const allPassed = checks.every((c) => c.passed);
  return {
    ok: allPassed,
    status: allPassed ? "passed" : "failed",
    checks,
    customer: finalCustomer,
    conversations: finalConv,
    handoffAlerts: finalAlerts,
    customStepKey,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
    let body: any = {};
    try { body = await req.json(); } catch {}
    const scenario = (String(body.scenario || "happy_path") as Scenario);
    const maxTurns = Math.max(4, Math.min(Number(body.maxTurns || 35), 50));

    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || Deno.env.get("VITE_SUPABASE_PUBLISHABLE_KEY") || "";
    if (!ANON_KEY) {
      return new Response(JSON.stringify({ error: "SUPABASE_ANON_KEY/PUBLISHABLE_KEY ausente no ambiente da função" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: `Bearer ${token}` } } });
    const { data: userData } = await userClient.auth.getUser();
    const userId = userData?.user?.id;
    if (!userId) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { data: roleRows } = await supabase.from("user_roles").select("role").eq("user_id", userId);
    const isAdmin = (roleRows || []).some((r: any) => r.role === "admin" || r.role === "super_admin");
    if (!isAdmin) return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { data: settingsRows } = await supabase.from("settings").select("*");
    const settings: Record<string, string> = {};
    settingsRows?.forEach((s: any) => { settings[s.key] = s.value; });
    const consultantId = settings.superadmin_consultant_id || "";
    if (!consultantId) {
      return new Response(JSON.stringify({ error: "superadmin_consultant_id ausente: o webhook real precisa desse consultor para rodar" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const suffix = Math.floor(Math.random() * 9_999_999).toString().padStart(7, "0");
    const phone = `5500000${suffix}`;

    const { data: runRow, error: runErr } = await supabase
      .from("bot_test_runs")
      .insert({ scenario, status: "running", consultant_id: consultantId, created_by: userId })
      .select().single();
    if (runErr) throw runErr;
    const runId = runRow.id;

    // ────────────────────────────────────────────────────────────────────
    // 🆕 Cenários v3 diretos (Task 30 do flow-engine-v3-rewrite, design §4.3)
    // Drive `runEngine` puro com fixtures sintéticos. Não cria customer real
    // nem chama whapi-webhook — valida G1–G6 + assertivas in-process e flipa
    // `consultants.use_engine_v3 = true` durante a execução (Requirement 11.1).
    // ────────────────────────────────────────────────────────────────────
    if (V3_DIRECT_SCENARIOS.has(scenario as V3DirectScenario)) {
      const v3Result = await runV3DirectScenario({
        scenario: scenario as V3DirectScenario,
        supabase,
        consultantId,
      });
      const checksPassed = v3Result.checks.filter((c) => c.passed).length;

      await supabase.from("bot_test_runs").update({
        status: v3Result.status,
        finished_at: new Date().toISOString(),
        summary: {
          scenario,
          engine: "v3-direct",
          checks: v3Result.checks,
          checksPassed,
          checksTotal: v3Result.checks.length,
          turns: v3Result.turns,
          finalStateUpdate: v3Result.finalStateUpdate,
        },
      }).eq("id", runId);

      return new Response(JSON.stringify({
        ok: v3Result.ok,
        runId,
        scenario,
        engine: "v3-direct",
        status: v3Result.status,
        checks: v3Result.checks,
        checksPassed,
        checksTotal: v3Result.checks.length,
        turns: v3Result.turns,
        finalStateUpdate: v3Result.finalStateUpdate,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: customer, error: cErr } = await supabase.from("customers").insert({
      phone_whatsapp: phone,
      consultant_id: consultantId,
      status: "pending",
      conversation_step: "welcome",
      name: "Joao Silva Teste",
      name_source: "self_introduced",
    }).select().single();
    if (cErr) throw cErr;
    await supabase.from("bot_test_runs").update({ customer_id: customer.id }).eq("id", runId);

    // ────────────────────────────────────────────────────────────────────
    // 🆕 Cenários de retry (Task 11) — pulam o loop de turns padrão e usam
    // assertions específicas sobre conversations/customers/bot_handoff_alerts.
    // ────────────────────────────────────────────────────────────────────
    if (RETRY_SCENARIOS.has(scenario)) {
      const retryResult = await runRetryScenario(scenario, supabase, runId, consultantId, customer.id, phone);
      const checksPassed = retryResult.checks.filter((c) => c.passed).length;

      await supabase.from("bot_test_runs").update({
        status: retryResult.status,
        finished_at: new Date().toISOString(),
        summary: {
          scenario,
          checks: retryResult.checks,
          checksPassed,
          checksTotal: retryResult.checks.length,
          finalCustomer: retryResult.customer,
          conversationCount: retryResult.conversations.length,
          handoffAlertCount: retryResult.handoffAlerts.length,
        },
      }).eq("id", runId);

      return new Response(JSON.stringify({
        ok: retryResult.ok,
        runId,
        scenario,
        status: retryResult.status,
        phone,
        checks: retryResult.checks,
        checksPassed,
        checksTotal: retryResult.checks.length,
        customerId: customer.id,
        finalCustomer: retryResult.customer,
        conversations: retryResult.conversations,
        handoffAlerts: retryResult.handoffAlerts,
        customStepKey: retryResult.customStepKey,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const stepIndex = await loadStepIndex(supabase, consultantId);
    const unknownSteps = new Set<string>();
    const turns: any[] = [];
    const stepHits: Record<string, number> = {};
    const visitedSteps = new Set<string>();
    let lastStep: string | null = null;
    let repeatedMediaCount = 0;
    let stuckCount = 0;
    let finalStatus = "running";
    let stopReason = "max_turns";

    for (let turn = 1; turn <= maxTurns; turn++) {
      const { data: cur } = await supabase
        .from("customers")
        .select("conversation_step,status,bot_paused,electricity_bill_value,document_type")
        .eq("id", customer.id)
        .maybeSingle();
      const stepBefore = cur?.conversation_step || null;
      const stepKey = cleanStep(stepBefore, stepIndex);
      visitedSteps.add(stepKey);

      if (stepKey === "complete" || stepKey === "portal_submitting" || stepKey === "aguardando_otp" || stepKey === "aguardando_facial" || stepKey === "cadastro_em_analise") { finalStatus = "completed"; stopReason = "conversion_step_reached"; break; }
      if (stepKey === "valor_baixo" || cur?.status === "rejected" || cur?.bot_paused === true) { finalStatus = scenario === "valor_baixo" ? "low_value" : "paused_or_rejected"; stopReason = "lead_disqualified_or_paused"; break; }

      const reply = nextReply(scenario, cur, turn, stepHits, { index: stepIndex, unknown: unknownSteps });
      if (!reply) { finalStatus = scenario === "lead_some" ? "lead_silent" : finalStatus; stopReason = scenario === "lead_some" ? "lead_stopped_replying" : "no_more_scripted_replies"; break; }

      stepHits[stepKey] = (stepHits[stepKey] || 0) + 1;
      const payload = buildWhapiBody(phone, reply, turn);
      const startedAt = Date.now();
      await supabase.from("bot_test_outbound").insert({
        run_id: runId,
        turn,
        direction: "inbound",
        kind: reply.kind,
        content: reply.kind === "text" ? reply.text : reply.kind === "audio" ? `[áudio] ${reply.transcript}` : "[imagem fictícia]",
        conversation_step_before: stepBefore,
      });

      let resStatus = 0;
      try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/whapi-webhook`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${SERVICE_ROLE}`,
            apikey: SERVICE_ROLE,
            "x-bot-test-run-id": runId,
            "x-bot-test-turn": String(turn),
          },
          body: JSON.stringify(payload),
        });
        resStatus = res.status;
        await res.text();
      } catch (e: any) {
        await supabase.from("bot_test_outbound").insert({ run_id: runId, turn, direction: "error", kind: "fetch_error", content: e?.message || String(e) });
        finalStatus = "error";
        stopReason = "webhook_fetch_error";
        break;
      }

      const latency = Date.now() - startedAt;
      const { data: after } = await supabase.from("customers").select("conversation_step,status,bot_paused").eq("id", customer.id).maybeSingle();
      const stepAfter = after?.conversation_step || null;
      const afterKey = cleanStep(stepAfter, stepIndex);
      visitedSteps.add(afterKey);

      await supabase.from("bot_test_outbound").update({ conversation_step_after: stepAfter, latency_ms: latency })
        .eq("run_id", runId).eq("turn", turn).eq("direction", "inbound");

      turns.push({ turn, action: reply.kind === "text" ? reply.text : reply.kind, stepBefore, stepAfter, latencyMs: latency, httpStatus: resStatus });

      const { data: recentBot } = await supabase
        .from("bot_test_outbound")
        .select("kind,content")
        .eq("run_id", runId)
        .eq("turn", turn)
        .eq("direction", "outbound");
      const mediaKinds = (recentBot || []).filter((o: any) => String(o.kind || "").startsWith("media:")).map((o: any) => `${o.kind}:${String(o.content || "").split("|")[0]}`);
      if (mediaKinds.length >= 2 && stepKey === "checkin_pos_video") repeatedMediaCount += mediaKinds.length;

      if (afterKey === cleanStep(lastStep, stepIndex)) {
        stuckCount++;
        if (stuckCount >= 4) { finalStatus = "stuck"; stopReason = `stuck_on_${afterKey}`; break; }
      } else {
        stuckCount = 0;
      }
      lastStep = stepAfter;

      if (afterKey === "complete" || afterKey === "portal_submitting" || afterKey === "aguardando_otp" || afterKey === "aguardando_facial" || afterKey === "cadastro_em_analise") { finalStatus = "completed"; stopReason = "conversion_step_reached"; break; }
      if (afterKey === "valor_baixo" || after?.status === "rejected" || after?.bot_paused === true) { finalStatus = scenario === "valor_baixo" ? "low_value" : "paused_or_rejected"; stopReason = "lead_disqualified_or_paused"; break; }
    }

    if (finalStatus === "running") finalStatus = "max_turns";

    const { data: outboundAll } = await supabase
      .from("bot_test_outbound")
      .select("turn,direction,kind,content,conversation_step_before,conversation_step_after,latency_ms,created_at")
      .eq("run_id", runId)
      .order("created_at", { ascending: true });

    const { data: finalCustomer } = await supabase
      .from("customers")
      .select("status,bot_paused,conversation_step,electricity_bill_value,document_type,email,phone_contact_confirmed")
      .eq("id", customer.id)
      .maybeSingle();

    const botMsgs = (outboundAll || []).filter((o: any) => o.direction === "outbound");
    const inboundMsgs = (outboundAll || []).filter((o: any) => o.direction === "inbound");
    const fetchErrors = (outboundAll || []).filter((o: any) => o.kind === "fetch_error");
    const placeholderRegex = /\{\{\s*\w+\s*\}\}/;
    const withPlaceholder = botMsgs.filter((o: any) => placeholderRegex.test(String(o.content || "")));
    const repeatedOpeningMedia = botMsgs.filter((o: any) => String(o.kind || "").startsWith("media:") && /como_funciona|Green_Energy/i.test(String(o.content || ""))).length;
    const visited = Array.from(visitedSteps).filter(Boolean);

    const checks: Array<{ name: string; passed: boolean; detail?: string }> = [
      { name: "Webhook respondeu sem erro", passed: fetchErrors.length === 0, detail: fetchErrors.length ? `${fetchErrors.length} erro(s)` : undefined },
      { name: "Sem placeholders não substituídos", passed: withPlaceholder.length === 0, detail: withPlaceholder.length ? `${withPlaceholder.length} mensagem(ns)` : undefined },
      { name: "Saiu do check-in inicial", passed: visited.some((s) => PROGRESSED_STEPS.has(s)) || finalStatus === "low_value", detail: `steps=${visited.join(" → ")}` },
      { name: "Roteiro cobriu os passos do fluxo", passed: unknownSteps.size === 0, detail: unknownSteps.size ? `sem resposta roteirizada para: ${Array.from(unknownSteps).join(", ")}` : undefined },
      { name: "Não repetiu mídia em loop", passed: repeatedOpeningMedia <= 2 && repeatedMediaCount === 0, detail: `midias_repetidas=${repeatedOpeningMedia}` },
      { name: "Registrou conversa USER/BOT", passed: inboundMsgs.length > 0 && botMsgs.length > 0, detail: `${inboundMsgs.length} user / ${botMsgs.length} bot` },
    ];

    if (["happy_path", "joia_validacao", "documento_cnh", "recusa_conta", "recusa_documento", "lead_indeciso"].includes(scenario)) {
      checks.push({ name: "Chegou em estado de conversão", passed: finalStatus === "completed", detail: `status=${finalStatus}, step=${finalCustomer?.conversation_step}` });
      checks.push({ name: "Conta foi validada", passed: visited.includes("confirmando_dados_conta") || Number(finalCustomer?.electricity_bill_value || 0) >= 100, detail: `valor=${finalCustomer?.electricity_bill_value}` });
      checks.push({ name: "Documento foi validado", passed: visited.includes("confirmando_dados_doc") || ["complete", "portal_submitting", "aguardando_otp", "aguardando_facial", "cadastro_em_analise"].includes(cleanStep(finalCustomer?.conversation_step, stepIndex)), detail: `doc=${finalCustomer?.document_type || "∅"}` });
    }
    if (scenario === "valor_baixo") checks.push({ name: "Valor baixo não seguiu para venda", passed: finalStatus === "low_value", detail: `status=${finalCustomer?.status}, step=${finalCustomer?.conversation_step}` });
    if (scenario === "lead_some") checks.push({ name: "Lead silencioso detectado", passed: finalStatus === "lead_silent", detail: `status=${finalStatus}` });
    if (scenario === "lead_indeciso") checks.push({ name: "Dúvida foi tratada sem travar", passed: visited.some((s) => PROGRESSED_STEPS.has(s)) && finalStatus === "completed", detail: `steps=${visited.join(" → ")}` });
    if (scenario === "recusa_conta") checks.push({ name: "Recusa da conta recuperou o fluxo", passed: visited.some((s) => s === "aguardando_conta" || s === "a6_ask_bill_photo" || s === "d_pedir_conta") && finalStatus === "completed", detail: `steps=${visited.join(" → ")}` });
    if (scenario === "documento_cnh") checks.push({ name: "CNH não exigiu verso", passed: finalCustomer?.document_type === "cnh" && !visited.includes("aguardando_doc_verso"), detail: `doc=${finalCustomer?.document_type}, steps=${visited.join(" → ")}` });

    const checksPassed = checks.filter((c) => c.passed).length;
    const marketReadiness = commercialStatus(finalStatus, checks);
    const recommendation = checks.every((c) => c.passed)
      ? "Fluxo validado para este cenário. Rodar os demais cenários antes de escalar."
      : `Corrigir: ${checks.filter((c) => !c.passed).map((c) => c.name).join(", ")}`;

    await supabase.from("bot_test_runs").update({
      status: finalStatus,
      finished_at: new Date().toISOString(),
      summary: {
        turns: turns.length,
        lastStep,
        stopReason,
        visitedSteps: visited,
        checks,
        checksPassed,
        checksTotal: checks.length,
        finalStatus: finalCustomer?.status || null,
        marketReadiness,
        recommendation,
      },
    }).eq("id", runId);

    return new Response(JSON.stringify({
      ok: true,
      runId,
      status: finalStatus,
      phone,
      turns: turns.length,
      lastStep,
      stopReason,
      visitedSteps: visited,
      outbound: outboundAll,
      checks,
      checksPassed,
      checksTotal: checks.length,
      customerId: customer.id,
      finalCustomerStatus: finalCustomer?.status || null,
      marketReadiness,
      recommendation,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    console.error("bot-e2e-runner error:", e);
    return new Response(JSON.stringify({ error: e?.message || String(e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
