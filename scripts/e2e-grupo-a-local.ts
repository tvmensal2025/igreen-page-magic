/**
 * Conversa E2E do Grupo A rodando da máquina local, sem deploy.
 *
 * `whapi-webhook` tem `verify_jwt = false`, então dá para conduzir o lead simulado
 * daqui com a apikey anon. O telefone na faixa `5500000…` faz o webhook trocar o
 * sender real pelo mock (`isTestPhone` → `mockSender`), então nada sai no WhatsApp.
 *
 * Usa o MESMO roteiro da edge `bot-e2e-runner` (`scenario-script.ts`) para as duas
 * não divergirem.
 *
 *   deno run -A scripts/e2e-grupo-a-local.ts [cenario]
 *
 * Requer no ambiente: SUPABASE_URL, SUPABASE_ANON_KEY, E2E_EMAIL, E2E_PASSWORD.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  buildWhapiBody,
  cleanStep,
  loadStepIndex,
  nextReply,
  PROGRESSED_STEPS,
} from "../supabase/functions/bot-e2e-runner/scenario-script.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const EMAIL = Deno.env.get("E2E_EMAIL")!;
const PASSWORD = Deno.env.get("E2E_PASSWORD")!;
const scenario = Deno.args[0] || "happy_path";
const MAX_TURNS = Number(Deno.args[1] || 30);

if (!SUPABASE_URL || !ANON_KEY || !EMAIL || !PASSWORD) {
  console.error("Faltam SUPABASE_URL / SUPABASE_ANON_KEY / E2E_EMAIL / E2E_PASSWORD");
  Deno.exit(1);
}

const auth = createClient(SUPABASE_URL, ANON_KEY);
const { data: session, error: authErr } = await auth.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
if (authErr || !session?.session) {
  console.error("Login falhou:", authErr?.message);
  Deno.exit(1);
}
const token = session.session.access_token;
const userId = session.session.user.id;
const supabase = createClient(SUPABASE_URL, ANON_KEY, {
  global: { headers: { Authorization: `Bearer ${token}` } },
});

const { data: settingsRows } = await supabase.from("settings").select("key,value");
const consultantId = (settingsRows || []).find((s) => s.key === "superadmin_consultant_id")?.value;
if (!consultantId) {
  console.error("superadmin_consultant_id não encontrado em settings");
  Deno.exit(1);
}

const stepIndex = await loadStepIndex(supabase, consultantId);
console.log(`Passos indexados: ${stepIndex.size}`);

// RLS não deixa o JWT do consultor criar `bot_test_runs`/`customers`, então o lead
// sandbox e a run são preparados fora daqui (SQL administrativo) e chegam por env.
const runId = Deno.env.get("E2E_RUN_ID");
const phone = Deno.env.get("E2E_PHONE");
if (!runId || !phone) {
  console.error("Defina E2E_RUN_ID e E2E_PHONE (lead sandbox 5500000…).");
  Deno.exit(1);
}

// O lead sandbox é recriado pelo próprio webhook quando a limpeza da bateria
// apaga o anterior, então o id muda. Confiar no `E2E_CUSTOMER_ID` do ambiente
// fazia o roteiro observar um lead que não existe mais: toda leitura voltava
// vazia, o passo lido era sempre `welcome` e a conversa aparecia como
// "(silêncio)" mesmo com o bot respondendo certo. O telefone é a chave estável.
async function resolveCustomerId(): Promise<string | null> {
  const { data } = await supabase
    .from("customers")
    .select("id")
    .eq("phone_whatsapp", phone)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.id || null;
}

// Sem fallback para `E2E_CUSTOMER_ID`: um id de env obsoleto preenchia o campo
// e bloqueava a re-resolução depois do primeiro turno.
const customer = { id: (await resolveCustomerId()) || "" };
void userId;

console.log(`\nCenário: ${scenario} | telefone sandbox: ${phone}\n${"─".repeat(70)}`);

const stepHits: Record<string, number> = {};
const unknownSteps = new Set<string>();
const visitedSteps = new Set<string>();
let finalStatus = "running";
let stopReason = "max_turns";
let lastStep: string | null = null;
let stuckCount = 0;

const TERMINAL = ["complete", "portal_submitting", "aguardando_otp", "aguardando_facial", "cadastro_em_analise"];

for (let turn = 1; turn <= MAX_TURNS; turn++) {
  const { data: cur } = await supabase
    .from("customers")
    .select("conversation_step,status,bot_paused,electricity_bill_value,document_type")
    .eq("id", customer.id).maybeSingle();

  const stepBefore = cur?.conversation_step || null;
  const stepKey = cleanStep(stepBefore, stepIndex);
  visitedSteps.add(stepKey);

  if (TERMINAL.includes(stepKey)) { finalStatus = "completed"; stopReason = "conversion_step_reached"; break; }
  if (stepKey === "valor_baixo" || cur?.status === "rejected" || cur?.bot_paused === true) {
    finalStatus = scenario === "valor_baixo" ? "low_value" : "paused_or_rejected";
    stopReason = "lead_disqualified_or_paused";
    break;
  }

  const reply = nextReply(scenario, cur, turn, stepHits, { index: stepIndex, unknown: unknownSteps });
  if (!reply) {
    finalStatus = scenario === "lead_some" ? "lead_silent" : finalStatus;
    stopReason = scenario === "lead_some" ? "lead_stopped_replying" : "no_more_scripted_replies";
    break;
  }
  stepHits[stepKey] = (stepHits[stepKey] || 0) + 1;

  const shown = reply.kind === "text" ? reply.text : reply.kind === "audio" ? `[áudio] ${reply.transcript}` : "[imagem]";
  console.log(`\nturno ${turn} · passo ${stepKey}\n  LEAD → ${shown}`);

  const started = Date.now();
  const res = await fetch(`${SUPABASE_URL}/functions/v1/whapi-webhook`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ANON_KEY}`,
      apikey: ANON_KEY,
      "x-bot-test-run-id": runId,
      "x-bot-test-turn": String(turn),
      "x-bot-bypass-quiet-hours": "1",
      "x-bot-fast-clock": "1",
    },
    body: JSON.stringify(buildWhapiBody(phone, reply, turn)),
  });
  await res.text();
  const latency = Date.now() - started;

  // Primeiro turno de um telefone novo: o lead nasce dentro do webhook.
  if (!customer.id) customer.id = (await resolveCustomerId()) || "";

  const { data: botSaid } = await supabase
    .from("conversations")
    .select("message_text,message_type,created_at")
    .eq("customer_id", customer.id).eq("message_direction", "outbound")
    .gte("created_at", new Date(started).toISOString())
    .order("created_at", { ascending: true });
  for (const m of botSaid || []) {
    console.log(`  BOT  → ${String(m.message_text || `[${m.message_type}]`).replace(/\n/g, " ").slice(0, 150)}`);
  }
  if (!botSaid?.length) console.log("  BOT  → (silêncio)");

  const { data: after } = await supabase
    .from("customers").select("conversation_step,status,bot_paused").eq("id", customer.id).maybeSingle();
  const afterKey = cleanStep(after?.conversation_step, stepIndex);
  visitedSteps.add(afterKey);
  console.log(`  passo agora: ${afterKey} · http ${res.status} · ${latency}ms`);

  if (afterKey === cleanStep(lastStep, stepIndex)) {
    if (++stuckCount >= 4) { finalStatus = "stuck"; stopReason = `stuck_on_${afterKey}`; break; }
  } else stuckCount = 0;
  lastStep = after?.conversation_step || null;

  if (TERMINAL.includes(afterKey)) { finalStatus = "completed"; stopReason = "conversion_step_reached"; break; }
  if (afterKey === "valor_baixo" || after?.status === "rejected" || after?.bot_paused === true) {
    finalStatus = scenario === "valor_baixo" ? "low_value" : "paused_or_rejected";
    stopReason = "lead_disqualified_or_paused";
    break;
  }
}
if (finalStatus === "running") finalStatus = "max_turns";

const { data: finalCustomer } = await supabase
  .from("customers")
  .select("status,bot_paused,conversation_step,electricity_bill_value,document_type,email")
  .eq("id", customer.id).maybeSingle();
const { data: allConv } = await supabase
  .from("conversations").select("message_direction,message_text")
  .eq("customer_id", customer.id);

const visited = Array.from(visitedSteps).filter(Boolean);
const outbound = (allConv || []).filter((c) => c.message_direction === "outbound");
const inbound = (allConv || []).filter((c) => c.message_direction === "inbound");
const placeholders = outbound.filter((c) => /\{\{\s*\w+\s*\}\}/.test(String(c.message_text || "")));

const checks = [
  { name: "Saiu do check-in inicial", passed: visited.some((s) => PROGRESSED_STEPS.has(s)) || finalStatus === "low_value", detail: visited.join(" → ") },
  { name: "Roteiro cobriu os passos do fluxo", passed: unknownSteps.size === 0, detail: Array.from(unknownSteps).join(", ") || "todos reconhecidos" },
  { name: "Sem placeholders não substituídos", passed: placeholders.length === 0, detail: `${placeholders.length}` },
  { name: "Registrou conversa nos dois sentidos", passed: inbound.length > 0 && outbound.length > 0, detail: `${inbound.length} lead / ${outbound.length} bot` },
];
if (["happy_path", "joia_validacao", "documento_cnh", "lead_indeciso"].includes(scenario)) {
  checks.push({ name: "Chegou em estado de conversão", passed: finalStatus === "completed", detail: `${finalStatus} · ${finalCustomer?.conversation_step}` });
  checks.push({ name: "Valor da conta capturado", passed: Number(finalCustomer?.electricity_bill_value || 0) >= 100, detail: String(finalCustomer?.electricity_bill_value) });
}
if (scenario === "valor_baixo") checks.push({ name: "Valor baixo não seguiu para venda", passed: finalStatus === "low_value", detail: `${finalStatus}` });

console.log(`\n${"─".repeat(70)}\nResultado: ${finalStatus} (${stopReason})`);
for (const c of checks) console.log(`  ${c.passed ? "PASS " : "FALHA"} ${c.name} — ${c.detail}`);
console.log(`\n${checks.filter((c) => c.passed).length}/${checks.length} checks`);

console.log(`\nLead sandbox ${phone} (${customer.id}) — remover pelo SQL administrativo ao fim da bateria.`);
