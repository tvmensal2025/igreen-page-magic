#!/usr/bin/env bun
/**
 * vendedora-e2e-conversations — roda 20 conversas simuladas contra a edge
 * function fluxo-b-ai em modo dryRun.
 *
 * Uso:
 *   bun /tmp/run.ts [--consultant-id <uuid>] [--out <dir>] [--only scripted|persona|all]
 *                   [--max-turns <n>] [--concurrency <n>]
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";

// ─── args ────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
function arg(name: string, def?: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
}
const CONSULTANT_ID = arg("consultant-id", "81fe673d-253e-46bc-993a-85c286ae54b5")!;
const ONLY = (arg("only", "all") || "all") as "all" | "scripted" | "persona";
const MAX_TURNS = parseInt(arg("max-turns", "25")!, 10);
const CONCURRENCY = parseInt(arg("concurrency", "3")!, 10);
const TS = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const OUT_DIR = arg("out", `/mnt/documents/vendedora-runs/${TS}`)!;

// ─── env ─────────────────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const ANON_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;
if (!SUPABASE_URL || !ANON_KEY) {
  console.error("[fatal] VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY são obrigatórios.");
  process.exit(1);
}
if (!LOVABLE_API_KEY && ONLY !== "scripted") {
  console.error("[warn] LOVABLE_API_KEY ausente — personas LLM vão usar fallback.");
}

// ─── tipos ───────────────────────────────────────────────────────────────────
type Turn = {
  turn: number;
  leadMsg: string;
  reply: string;
  etapaBefore?: string;
  etapaAfter?: string;
  modelUsed?: string;
  shouldHandoff?: boolean;
  conversationStepUpdate?: string | null;
  latencyMs: number;
  httpStatus: number;
  error?: string;
};
type ConvResult = {
  id: string;
  kind: "scripted" | "persona";
  persona?: string;
  turns: Turn[];
  endedBy: "portal" | "handoff" | "max_turns" | "script_exhausted" | "crash" | "lead_done";
  totalMs: number;
  finalStep: string | null;
  problems: string[];
};

// ─── scripted scenarios ─────────────────────────────────────────────────────
type ScriptedTurn = string | { text: string; media?: "conta" | "doc_frente" | "doc_verso" };
const MIDIA_CONTA: ScriptedTurn = { text: "[envia foto da conta]", media: "conta" };
const MIDIA_DOC: ScriptedTurn = { text: "[envia foto do documento]", media: "doc_frente" };

const SCRIPTED_SCENARIOS: { id: string; turns: ScriptedTurn[] }[] = [
  {
    id: "happy-path-curto",
    turns: ["oi", "sim", "Maria Silva", "450", "quero", MIDIA_CONTA, MIDIA_DOC, "maria@gmail.com"],
  },
  {
    id: "happy-path-longo",
    turns: [
      "oi", "sim", "Joao Pereira", "520",
      "quanto vou economizar?", "demora quanto pra começar?", "ok quero",
      MIDIA_CONTA, MIDIA_DOC, "joao.p@gmail.com",
    ],
  },
  {
    id: "cetico-golpe",
    turns: [
      "oi", "isso é golpe?", "e como funciona?", "ok João Lima", "300", "quero",
      MIDIA_CONTA, MIDIA_DOC, "joao@hotmail.com",
    ],
  },
  {
    id: "objecao-boleto",
    turns: [
      "oi", "vai vir boleto?", "vão chegar dois boletos?", "ok Ana", "Ana Souza", "600",
      "quero sim", MIDIA_CONTA, MIDIA_DOC, "ana@gmail.com",
    ],
  },
  {
    id: "objecao-fidelidade",
    turns: [
      "oi", "tem fidelidade?", "posso cancelar quando quiser?", "ok Pedro Henrique", "280",
      "quero", MIDIA_CONTA, MIDIA_DOC, "pedrohenrique@gmail.com",
    ],
  },
  {
    id: "objecao-obra-aluguel",
    turns: [
      "oi", "moro de aluguel, dá pra fazer?", "e se eu mudar de casa?", "ok Julia Lima", "350",
      "quero", MIDIA_CONTA, MIDIA_DOC, "julia@gmail.com",
    ],
  },
  {
    id: "objecao-prazo",
    turns: [
      "oi", "quanto tempo demora?", "e a economia começa quando?", "ok Carlos", "Carlos Antunes", "500",
      "quero", MIDIA_CONTA, MIDIA_DOC, "carlos.a@gmail.com",
    ],
  },
  {
    id: "pede-foto-cedo",
    turns: [
      "oi", "manda lá a foto", "quero economizar", "manda o que tem que fazer",
      "tá, Roberto Dias", "380", "quero", MIDIA_CONTA, MIDIA_DOC, "roberto@gmail.com",
    ],
  },
  {
    id: "loop-mesma-duvida",
    turns: [
      "oi", "tem fidelidade?", "tem fidelidade mesmo?", "mas tem fidelidade?", "ok entendi",
      "Sandra Maria", "420", "quero", MIDIA_CONTA, MIDIA_DOC, "sandra@gmail.com",
    ],
  },
  {
    id: "mudou-de-ideia",
    turns: [
      "oi", "sim", "Lucia Andrade", "400", "quero", "ah na verdade não quero", "tchau",
    ],
  },
];

// ─── personas LLM ───────────────────────────────────────────────────────────
const PERSONA_SYSTEM_COMUM = `Você é um lead BRASILEIRO simulando uma conversa real de WhatsApp com uma vendedora de economia na conta de luz. Responda APENAS com a próxima mensagem do lead. Sem aspas, sem prefixo "Lead:", sem narração. Linguagem informal de WhatsApp (minúsculas ok, abreviações ok, 1-2 frases curtas). Se a vendedora pedir foto da conta ou documento e fizer sentido, diga "manda aí como faço" ou "pode". Se ela pedir email, invente um plausível baseado no nome. Se a conversa estiver acabando ou já fechou, diga tchau ou "valeu" naturalmente. NUNCA narre que é uma simulação.`;

const PERSONAS = [
  { id: "persona-interessado", prompt: "Você é um interessado direto, quer economizar mas pergunta uma ou duas coisas antes de fechar. Conta de luz R$380." },
  { id: "persona-cetico", prompt: "Você desconfia de tudo. Já viu golpe na vida. Pergunta 'isso é seguro?', 'vai vir cobrança extra?', mas se for bem respondido, fecha. Conta R$520." },
  { id: "persona-aposentado", prompt: "Você é aposentado, 68 anos. Fala devagar, pergunta a mesma coisa 2× pra ter certeza. Conta R$280." },
  { id: "persona-jovem-apressado", prompt: "Você é jovem, apressado, responde super curto (tlg, blz, manda aí). Quer fechar rápido. Conta R$350." },
  { id: "persona-reclamao", prompt: "Você já foi enganado pela concessionária. Reclama da Enel logo de cara. Se a vendedora tratar bem, vai abrindo. Conta R$700." },
  { id: "persona-indeciso", prompt: "Você vai e volta: 'ah não sei', 'deixa eu pensar'. Pode chegar a fechar ou desistir aleatoriamente. Conta R$450." },
  { id: "persona-curioso-tecnico", prompt: "Você quer entender técnica: 'como funciona compensação', 'vou ter painel?'. Engenheiro frustrado. Conta R$900." },
  { id: "persona-alugado-receoso", prompt: "Você mora de aluguel, tem medo de comprometer o imóvel. Pergunta sobre mudança, multa, contrato. Conta R$320." },
  { id: "persona-conta-baixa", prompt: "Sua conta é R$120. Quer saber se vale a pena pra você. Se a vendedora disser que não atende, aceita; senão insiste." },
  { id: "persona-empolgado-confuso", prompt: "Empolgado mas confuso: 'é solar? é placa? é a Enel mesmo?'. Manda nome (Roberta Lima) e valor (R$ 410) cedo. Conta R$410." },
];

// ─── helpers ─────────────────────────────────────────────────────────────────
const sha1 = (s: string) => createHash("sha1").update(s.trim().toLowerCase()).digest("hex");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function deepMerge(a: any, b: any): any {
  if (!b) return a;
  if (typeof a !== "object" || a === null) return b;
  const out: any = Array.isArray(a) ? [...a] : { ...a };
  for (const k of Object.keys(b)) {
    if (b[k] && typeof b[k] === "object" && !Array.isArray(b[k])) {
      out[k] = deepMerge(out[k] || {}, b[k]);
    } else {
      out[k] = b[k];
    }
  }
  return out;
}

// Lê o dryRunLog do edge e aplica updates em customerState (table=customers).
function applyDryRunLog(customerState: any, dryRunLog: any[]): any {
  if (!Array.isArray(dryRunLog)) return customerState;
  let s = { ...customerState };
  for (const entry of dryRunLog) {
    if (entry.table !== "customers") continue;
    if (entry.op === "update" && entry.args && entry.args[0]) {
      s = deepMerge(s, entry.args[0]);
    }
  }
  return s;
}

async function callFluxoB(body: any): Promise<{ status: number; json: any; ms: number }> {
  const t0 = Date.now();
  let status = 0;
  let json: any = null;
  try {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/fluxo-b-ai`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: ANON_KEY!,
        Authorization: `Bearer ${ANON_KEY}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(160_000),
    });
    status = r.status;
    json = await r.json().catch(() => ({ error: "invalid_json" }));
  } catch (e: any) {
    json = { error: e?.message || "fetch_failed" };
  }
  return { status, json, ms: Date.now() - t0 };
}

async function callPersona(personaPrompt: string, history: { role: "user" | "assistant"; content: string }[], firstReply: string): Promise<string> {
  if (!LOVABLE_API_KEY) return "ok, entendi";
  // Constrói perspectiva do PERSONA: assistant = lead, user = vendedora.
  const msgs: any[] = [
    { role: "system", content: `${PERSONA_SYSTEM_COMUM}\n\n${personaPrompt}` },
    { role: "user", content: `Vendedora abriu a conversa dizendo: "${firstReply}"\nResponda como lead.` },
  ];
  // pula o primeiro reply, já está no system
  for (let i = 1; i < history.length; i++) {
    const h = history[i];
    if (h.role === "user") msgs.push({ role: "assistant", content: h.content });
    else msgs.push({ role: "user", content: `Vendedora disse: "${h.content}"` });
  }
  try {
    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: msgs,
        temperature: 0.9,
        max_tokens: 120,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const j: any = await r.json();
    const txt = j?.choices?.[0]?.message?.content?.trim();
    if (!txt) return "ok";
    return txt.replace(/^["']|["']$/g, "").slice(0, 240);
  } catch {
    return "ok";
  }
}

// ─── loop de conversa ───────────────────────────────────────────────────────
async function runConversation(opts: {
  id: string;
  kind: "scripted" | "persona";
  scripted?: ScriptedTurn[];
  persona?: { id: string; prompt: string };
}): Promise<ConvResult> {
  const result: ConvResult = {
    id: opts.id,
    kind: opts.kind,
    persona: opts.persona?.id,
    turns: [],
    endedBy: "max_turns",
    totalMs: 0,
    finalStep: null,
    problems: [],
  };

  // estado mantido localmente entre turnos
  let customerState: any = {
    name: null,
    electricity_bill_value: null,
    email: null,
    conversation_step: null,
    fluxo_b_state: null,
    conversation_summary: null,
    midia_recebida: undefined,
  };
  const history: { role: "user" | "assistant"; content: string }[] = [];
  const replyHashes: string[] = [];
  let scriptedIdx = 0;
  let lastReply = "";

  // turno 1: lead manda "oi" sempre (tanto scripted quanto persona)
  let leadMsg: string = opts.kind === "scripted"
    ? (typeof opts.scripted![0] === "string" ? (opts.scripted![0] as string) : (opts.scripted![0] as any).text)
    : "oi";
  let mediaTag: string | undefined = opts.kind === "scripted" && typeof opts.scripted![0] !== "string"
    ? (opts.scripted![0] as any).media
    : undefined;
  if (opts.kind === "scripted") scriptedIdx = 1;

  for (let turn = 1; turn <= MAX_TURNS; turn++) {
    // injeta media flag se houver
    const stateForTurn = mediaTag
      ? { ...customerState, midia_recebida: { ...(customerState.midia_recebida || {}), [mediaTag]: true } }
      : customerState;

    const { status, json, ms } = await callFluxoB({
      consultantId: CONSULTANT_ID,
      inboundText: leadMsg,
      dryRun: true,
      customerState: stateForTurn,
      history,
    });

    const reply = String(json?.reply || "").trim();
    const stepUpdate = json?.conversationStepUpdate ?? null;
    const t: Turn = {
      turn,
      leadMsg,
      reply,
      etapaBefore: json?.debug?.stateBefore?.etapa,
      etapaAfter: json?.debug?.stateAfter?.etapa,
      modelUsed: json?.modelUsed,
      shouldHandoff: !!json?.shouldHandoff,
      conversationStepUpdate: stepUpdate,
      latencyMs: ms,
      httpStatus: status,
      error: json?.error,
    };
    result.turns.push(t);
    result.totalMs += ms;
    if (stepUpdate) result.finalStep = stepUpdate;

    if (status !== 200 || json?.error) {
      result.endedBy = "crash";
      result.problems.push(`turn ${turn}: HTTP ${status} ${json?.error || ""}`);
      break;
    }

    // detecção de problemas
    const h = sha1(reply);
    if (replyHashes.length && replyHashes[replyHashes.length - 1] === h) {
      result.problems.push(`turn ${turn}: LOOP (mesma resposta 2x)`);
    }
    if (replyHashes.slice(-4).filter((x) => x === h).length >= 2) {
      result.problems.push(`turn ${turn}: REPETIÇÃO (3x na janela)`);
    }
    replyHashes.push(h);

    // foto-cedo: bot menciona foto/conta antes de interesse_confirmado
    const interesseOk = json?.debug?.stateAfter?.interesse_confirmado === true
      || json?.debug?.stateBefore?.interesse_confirmado === true;
    if (!interesseOk && /\b(foto|conta de luz|me manda a foto|fatura)\b/i.test(reply)) {
      result.problems.push(`turn ${turn}: FOTO_CEDO (bot pediu mídia antes de interesse confirmado)`);
    }

    // aplica updates ao state local
    customerState = applyDryRunLog(customerState, json?.dryRunLog || []);

    // append history
    history.push({ role: "user", content: leadMsg });
    history.push({ role: "assistant", content: reply });
    lastReply = reply;

    // critério de fim
    if (stepUpdate === "portal_submitting") { result.endedBy = "portal"; break; }
    if (t.shouldHandoff) { result.endedBy = "handoff"; break; }
    if (/^(tchau|valeu|obrigad[oa]|até)\b/i.test(leadMsg) && turn > 3) { result.endedBy = "lead_done"; break; }

    // próxima fala do lead
    mediaTag = undefined;
    if (opts.kind === "scripted") {
      if (scriptedIdx >= opts.scripted!.length) {
        result.endedBy = "script_exhausted";
        break;
      }
      const nx = opts.scripted![scriptedIdx++];
      if (typeof nx === "string") {
        leadMsg = nx;
      } else {
        leadMsg = nx.text;
        mediaTag = nx.media;
      }
    } else {
      leadMsg = await callPersona(opts.persona!.prompt, history, lastReply);
    }
  }

  // dedupe problems
  result.problems = [...new Set(result.problems)];
  return result;
}

// ─── runner com concorrência ────────────────────────────────────────────────
async function runAll(): Promise<ConvResult[]> {
  const jobs: { id: string; run: () => Promise<ConvResult> }[] = [];

  if (ONLY !== "persona") {
    for (const s of SCRIPTED_SCENARIOS) {
      jobs.push({ id: s.id, run: () => runConversation({ id: s.id, kind: "scripted", scripted: s.turns }) });
    }
  }
  if (ONLY !== "scripted") {
    for (const p of PERSONAS) {
      jobs.push({ id: p.id, run: () => runConversation({ id: p.id, kind: "persona", persona: p }) });
    }
  }

  const results: ConvResult[] = [];
  let idx = 0;
  let done = 0;
  const workers = Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, async () => {
    while (true) {
      const myIdx = idx++;
      if (myIdx >= jobs.length) return;
      const job = jobs[myIdx];
      const t0 = Date.now();
      try {
        const r = await job.run();
        results.push(r);
        done++;
        const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
        console.log(`[${done.toString().padStart(2, "0")}/${jobs.length}] ${job.id.padEnd(28)} ${r.endedBy.padEnd(18)} turnos=${r.turns.length} ${elapsed}s ${r.problems.length ? `⚠ ${r.problems.length}` : "✓"}`);
      } catch (e: any) {
        done++;
        console.log(`[${done.toString().padStart(2, "0")}/${jobs.length}] ${job.id} CRASH: ${e?.message}`);
        results.push({
          id: job.id, kind: "scripted", turns: [], endedBy: "crash",
          totalMs: 0, finalStep: null, problems: [`runner crash: ${e?.message}`],
        });
      }
    }
  });
  await Promise.all(workers);
  // ordena por id pra ficar previsível
  results.sort((a, b) => a.id.localeCompare(b.id));
  return results;
}

// ─── output ──────────────────────────────────────────────────────────────────
function transcriptMd(r: ConvResult): string {
  const lines: string[] = [];
  lines.push(`# ${r.id}`);
  lines.push("");
  lines.push(`- **Tipo:** ${r.kind}${r.persona ? ` (${r.persona})` : ""}`);
  lines.push(`- **Encerrou por:** \`${r.endedBy}\``);
  lines.push(`- **Etapa final / step:** \`${r.finalStep || "-"}\``);
  lines.push(`- **Turnos:** ${r.turns.length} • **Latência total:** ${(r.totalMs / 1000).toFixed(1)}s`);
  if (r.problems.length) {
    lines.push(`- **Problemas:**`);
    for (const p of r.problems) lines.push(`  - ⚠ ${p}`);
  }
  lines.push("");
  lines.push("## Transcrição");
  lines.push("");
  for (const t of r.turns) {
    lines.push(`**Turno ${t.turn}** — etapa \`${t.etapaBefore || "?"}\` → \`${t.etapaAfter || "?"}\` • ${t.modelUsed || "?"} • ${t.latencyMs}ms`);
    lines.push("");
    lines.push(`> 👤 **Lead:** ${t.leadMsg}`);
    lines.push("");
    lines.push(`> 🤖 **Bot:** ${t.reply || "_(sem resposta)_"}`);
    if (t.shouldHandoff) lines.push("> 🆘 _handoff solicitado_");
    if (t.conversationStepUpdate) lines.push(`> 📍 step → \`${t.conversationStepUpdate}\``);
    if (t.error) lines.push(`> ❌ erro: ${t.error}`);
    lines.push("");
    lines.push("---");
    lines.push("");
  }
  lines.push("");
  lines.push("<details><summary>JSON completo</summary>");
  lines.push("");
  lines.push("```json");
  lines.push(JSON.stringify(r, null, 2));
  lines.push("```");
  lines.push("");
  lines.push("</details>");
  return lines.join("\n");
}

function reportMd(results: ConvResult[]): string {
  const lines: string[] = [];
  lines.push("# REPORT — vendedora-e2e-conversations");
  lines.push("");
  lines.push(`Gerado em ${new Date().toISOString()} — consultor \`${CONSULTANT_ID}\``);
  lines.push("");
  lines.push("## Resumo");
  lines.push("");
  const total = results.length;
  const portal = results.filter((r) => r.endedBy === "portal").length;
  const handoff = results.filter((r) => r.endedBy === "handoff").length;
  const crash = results.filter((r) => r.endedBy === "crash").length;
  const maxed = results.filter((r) => r.endedBy === "max_turns").length;
  const withProblems = results.filter((r) => r.problems.length).length;
  lines.push(`- Conversas: **${total}**`);
  lines.push(`- Chegou a \`portal_submitting\`: **${portal}** (${((portal / total) * 100).toFixed(0)}%)`);
  lines.push(`- Handoff humano: **${handoff}**`);
  lines.push(`- Crash (HTTP/erro): **${crash}**`);
  lines.push(`- Atingiu max-turns: **${maxed}**`);
  lines.push(`- Com problemas detectados: **${withProblems}**`);
  lines.push("");
  lines.push("## Tabela");
  lines.push("");
  lines.push("| id | tipo | turnos | endedBy | step final | latência (s) | problemas |");
  lines.push("|----|------|-------:|---------|------------|-------------:|----------:|");
  for (const r of results) {
    lines.push(`| \`${r.id}\` | ${r.kind} | ${r.turns.length} | ${r.endedBy} | ${r.finalStep || "-"} | ${(r.totalMs / 1000).toFixed(1)} | ${r.problems.length} |`);
  }
  lines.push("");
  // top 5 latência por turno
  const allTurns = results.flatMap((r) => r.turns.map((t) => ({ conv: r.id, ...t })));
  const slow = [...allTurns].sort((a, b) => b.latencyMs - a.latencyMs).slice(0, 5);
  lines.push("## Top 5 turnos mais lentos");
  lines.push("");
  lines.push("| conv | turno | ms | modelo | etapa |");
  lines.push("|------|------:|---:|--------|-------|");
  for (const s of slow) lines.push(`| \`${s.conv}\` | ${s.turn} | ${s.latencyMs} | ${s.modelUsed || "-"} | ${s.etapaBefore || "-"} → ${s.etapaAfter || "-"} |`);
  lines.push("");
  // problemas agregados
  const allProblems = results.flatMap((r) => r.problems.map((p) => ({ conv: r.id, p })));
  if (allProblems.length) {
    lines.push("## Problemas detectados");
    lines.push("");
    for (const { conv, p } of allProblems) lines.push(`- \`${conv}\` — ${p}`);
    lines.push("");
  }
  const failed = results.filter((r) => r.endedBy !== "portal");
  if (failed.length) {
    lines.push("## Conversas que NÃO chegaram a portal_submitting");
    lines.push("");
    for (const r of failed) lines.push(`- \`${r.id}\` — endedBy=\`${r.endedBy}\`, turnos=${r.turns.length}`);
    lines.push("");
  }
  return lines.join("\n");
}

// ─── main ────────────────────────────────────────────────────────────────────
(async () => {
  await mkdir(OUT_DIR, { recursive: true });
  console.log(`[info] consultor=${CONSULTANT_ID} out=${OUT_DIR} only=${ONLY} max=${MAX_TURNS} concurrency=${CONCURRENCY}`);
  console.log(`[info] iniciando ${ONLY === "all" ? 20 : 10} conversas…`);
  const t0 = Date.now();
  const results = await runAll();
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const fname = `conv-${String(i + 1).padStart(2, "0")}-${r.id}.md`;
    await writeFile(join(OUT_DIR, fname), transcriptMd(r), "utf8");
  }
  await writeFile(join(OUT_DIR, "REPORT.md"), reportMd(results), "utf8");
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log("");
  console.log(`[done] ${results.length} conversas em ${elapsed}s`);
  console.log(`[done] REPORT: ${join(OUT_DIR, "REPORT.md")}`);
})();
