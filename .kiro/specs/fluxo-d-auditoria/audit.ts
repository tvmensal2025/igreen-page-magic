/**
 * Auditoria completa do Fluxo D.
 *
 * Regra inviolável: cada passo é uma entidade isolada — nunca comparamos cópias entre si
 * nem sugerimos sincronização. Defeitos são sempre *internos a um passo* ou link quebrado
 * a partir dele.
 *
 * Camadas:
 *   1) Auditoria estática (por passo)
 *   2) Reachability a partir de d_welcome
 *   3) Simulação de runtime (engine v3 emulado deterministicamente)
 *
 * Uso:  bun run .kiro/specs/fluxo-d-auditoria/audit.ts
 * Saída: .kiro/specs/fluxo-d-auditoria/report.md
 */

import { readFileSync, writeFileSync } from "node:fs";

type Step = {
  id: string;
  position: number;
  step_type: string;
  step_key: string;
  title: string;
  slot_key: string | null;
  transitions: Array<{
    goto_special: string | null;
    goto_step_id: string | null;
    trigger_intent: string;
    trigger_phrases: string[];
  }>;
  captures: Array<any>;
  fallback: any;
  is_active: boolean;
};

const stepsPath = new URL("./steps.json", import.meta.url).pathname;
const steps: Step[] = JSON.parse(readFileSync(stepsPath, "utf8"));
const byId = new Map(steps.map((s) => [s.id, s]));
const byKey = new Map(steps.map((s) => [s.step_key, s]));

// ============================================================
// 1. Auditoria estática
// ============================================================

type Finding = { sev: "CRIT" | "HIGH" | "MED" | "LOW" | "INFO"; msg: string };
const findings: Record<string, Finding[]> = {};
function add(stepKey: string, sev: Finding["sev"], msg: string) {
  (findings[stepKey] ??= []).push({ sev, msg });
}

function getButtons(s: Step) {
  const c = s.captures.find((c) => c?.field === "_buttons");
  return Array.isArray(c?.value) ? c.value : [];
}

for (const s of steps) {
  // (a) fallback ai_answer exige _buttons
  if (s.fallback?.mode === "ai_answer") {
    const btns = getButtons(s);
    if (btns.length === 0) {
      add(s.step_key, "CRIT", "fallback.mode=ai_answer SEM captures._buttons (bug original — IA responde mas usuário fica sem saída).");
    } else {
      add(s.step_key, "INFO", `fallback.mode=ai_answer + ${btns.length} botões re-emitidos OK.`);
    }
  }

  // (b) links quebrados em transitions
  for (let i = 0; i < s.transitions.length; i++) {
    const t = s.transitions[i];
    if (t.goto_step_id) {
      const dst = byId.get(t.goto_step_id);
      if (!dst) add(s.step_key, "HIGH", `transitions[${i}] (${t.trigger_intent}) aponta para ID inexistente ${t.goto_step_id}.`);
      else if (!dst.is_active) add(s.step_key, "HIGH", `transitions[${i}] (${t.trigger_intent}) aponta para passo INATIVO ${dst.step_key}.`);
    }
  }
  // fallback.goto_step_id
  if (s.fallback?.goto_step_id) {
    const dst = byId.get(s.fallback.goto_step_id);
    if (!dst) add(s.step_key, "HIGH", `fallback.goto_step_id aponta para ID inexistente ${s.fallback.goto_step_id}.`);
    else if (!dst.is_active) add(s.step_key, "HIGH", `fallback.goto_step_id aponta para passo INATIVO ${dst.step_key}.`);
  }
  if (s.fallback?.success_goto_step_id) {
    const dst = byId.get(s.fallback.success_goto_step_id);
    if (!dst) add(s.step_key, "HIGH", `fallback.success_goto_step_id aponta para ID inexistente.`);
    else if (!dst.is_active) add(s.step_key, "HIGH", `fallback.success_goto_step_id aponta para passo INATIVO ${dst.step_key}.`);
  }

  // (c) IDs de botões únicos
  const btns = getButtons(s);
  const ids = btns.map((b: any) => b.id);
  const dupBtn = ids.find((id: string, i: number) => ids.indexOf(id) !== i);
  if (dupBtn) add(s.step_key, "HIGH", `Botões com IDs duplicados: "${dupBtn}".`);

  // (d) trigger_phrases vazias quando não há goto_special
  for (let i = 0; i < s.transitions.length; i++) {
    const t = s.transitions[i];
    if (
      !t.goto_special &&
      t.trigger_intent !== "default" &&
      (!t.trigger_phrases || t.trigger_phrases.length === 0)
    ) {
      add(s.step_key, "LOW", `transitions[${i}] (intent=${t.trigger_intent}) sem goto_special e sem trigger_phrases — só dispara por ID de botão.`);
    }
  }

  // (e) typos: emoji colado em palavra (sem espaço)
  for (const b of btns) {
    if (typeof b?.title === "string" && /^[^\w\s]+[A-Za-zÀ-ÿ]/.test(b.title)) {
      add(s.step_key, "MED", `Typo em botão "${b.id}": título "${b.title}" sem espaço após o emoji.`);
    }
  }

  // (f) position única
  const dupPos = steps.filter((x) => x.position === s.position && x.id !== s.id);
  if (dupPos.length) add(s.step_key, "HIGH", `Position ${s.position} duplicada com ${dupPos.map((x) => x.step_key).join(", ")}.`);

  // (g) trigger_phrases curtas que viram substring de palavras válidas.
  // Runtime real faz messageText.includes(needle): "humano" contém "um", "tres" contém "três", etc.
  const SHORT_RISK = new Set(["um", "dois", "tres", "três", "para", "sim", "nao", "não", "como"]);
  for (let i = 0; i < s.transitions.length; i++) {
    const t = s.transitions[i];
    for (const p of t.trigger_phrases || []) {
      const np = norm(p);
      if (SHORT_RISK.has(np)) {
        add(
          s.step_key,
          "HIGH",
          `transitions[${i}] tem trigger_phrase "${p}" — runtime faz messageText.includes("${np}"), casa com qualquer texto contendo "${np}" (ex: "humano" contém "um"). Trocar por âncora exata ou remover.`,
        );
      }
    }
  }
}

// ============================================================
// 2. Reachability a partir de d_welcome
// ============================================================
const WELCOME = byKey.get("d_welcome")!;
const reached = new Set<string>();
function walk(id: string | null | undefined) {
  if (!id) return;
  if (reached.has(id)) return;
  const s = byId.get(id);
  if (!s) return;
  reached.add(id);
  for (const t of s.transitions) walk(t.goto_step_id);
  walk(s.fallback?.goto_step_id);
  walk(s.fallback?.success_goto_step_id);
}
walk(WELCOME.id);

const unreachable = steps.filter((s) => s.is_active && !reached.has(s.id));

// ============================================================
// 3. Simulação de runtime (engine v3 emulado)
// ============================================================
//
// Replica fielmente _shared/flow-router.matchTransition + variants/d.buildStepOutbound.
// Determinístico, sem rede, sem Gemini/Whapi.

type Outbound =
  | { kind: "text"; text: string }
  | { kind: "choice"; text: string; preferred: "button" | "list" | "number"; options: { id: string; title: string }[] }
  | { kind: "media_request"; field: string }
  | { kind: "ai_answer"; preferred?: "button" | "list" | "number"; options?: { id: string; title: string }[] }
  | { kind: "handoff" }
  | { kind: "finalizar" }
  | { kind: "missing"; reason: string };

type Caps = { supportsButtons: boolean; maxButtons: number; supportsList: boolean };
const WHAPI: Caps = { supportsButtons: true, maxButtons: 3, supportsList: true };
const EVO: Caps = { supportsButtons: false, maxButtons: 0, supportsList: false };

function norm(s: string | null | undefined) {
  return (s ?? "").toString().toLowerCase().trim();
}

function buildOutbound(s: Step, caps: Caps): Outbound[] {
  if (s.step_type === "finalizar_cadastro") return [{ kind: "finalizar" }];
  if (s.step_type === "capture_conta" || s.step_type === "capture_documento")
    return [{ kind: "media_request", field: s.step_type === "capture_conta" ? "conta" : "documento" }];
  if (s.step_type === "capture_email") return [{ kind: "text", text: "pede email" }];
  if (s.step_type === "confirm_phone") return [{ kind: "text", text: "confirma telefone" }];

  const btns = getButtons(s);
  if (btns.length === 0) return [{ kind: "text", text: s.title }];

  // Variant D capability matrix
  let preferred: "button" | "list" | "number";
  let options = btns;
  if (caps.maxButtons === 0 && caps.supportsList) preferred = "list";
  else if (caps.supportsButtons && caps.maxButtons > 0) {
    preferred = "button";
    options = btns.slice(0, Math.min(3, caps.maxButtons));
  } else preferred = "number";

  return [{ kind: "choice", text: s.title, preferred, options }];
}

function matchTransition(
  s: Step,
  msg: string,
  buttonId: string | null,
): { nextId: string | null; special: string | null; via: string } {
  const m = norm(msg);
  const b = norm(buttonId);

  // (a) botão por trigger_phrases
  if (b) {
    for (const t of s.transitions) {
      const phrases = (t.trigger_phrases || []).map(norm);
      if (phrases.includes(b)) {
        return { nextId: t.goto_step_id, special: t.goto_special, via: `btn=${b}` };
      }
    }
    // (b) botão = goto_special
    for (const t of s.transitions) {
      if (norm(t.goto_special) === b) return { nextId: null, special: t.goto_special, via: `btn->special=${b}` };
    }
  }

  // (c) texto contém trigger_phrase
  if (m) {
    for (const t of s.transitions) {
      const phrases = (t.trigger_phrases || []).map(norm);
      for (const p of phrases) {
        if (!p) continue;
        if (m === p || m.includes(p) || (p.length <= 8 && p.includes(m))) {
          return { nextId: t.goto_step_id, special: t.goto_special, via: `txt~"${p}"` };
        }
      }
    }
    // (d) trigger_intent="default" (com trigger_phrases vazias)
    for (const t of s.transitions) {
      if (t.trigger_intent === "default") {
        return { nextId: t.goto_step_id, special: t.goto_special, via: "default" };
      }
    }
  }

  // (e) fallback
  const fb = s.fallback;
  if (fb?.mode === "goto" && fb.goto_step_id) return { nextId: fb.goto_step_id, special: null, via: "fb.goto" };
  if (fb?.mode === "repeat") return { nextId: s.id, special: null, via: "fb.repeat" };
  if (fb?.mode === "ai_answer") return { nextId: s.id, special: "ai_answer", via: "fb.ai_answer" };
  if (fb?.mode === "retry") return { nextId: s.id, special: "retry", via: "fb.retry" };
  return { nextId: null, special: null, via: "no-match" };
}

type Turn = {
  input: { text?: string; buttonId?: string; image?: boolean };
  expectStepKey?: string;
  expectKind?: Outbound["kind"];
  expectButtonCount?: number;
  expectAiButtons?: boolean; // dúvida + IA re-emite botões
};

type Journey = { name: string; startKey: string; turns: Turn[] };

const J: Journey[] = [
  // 1. Happy path completo via foto
  {
    name: "Happy path FOTO",
    startKey: "d_welcome",
    turns: [
      { input: { buttonId: "quero_simular" }, expectStepKey: "d_escolher_simulacao", expectKind: "choice", expectButtonCount: 2 },
      { input: { buttonId: "simular_completa" }, expectStepKey: "d_pedir_conta", expectKind: "media_request" },
      { input: { image: true }, expectStepKey: "d_resultado", expectKind: "choice", expectButtonCount: 3 },
      { input: { buttonId: "cadastrar" }, expectStepKey: "d_pedir_documento", expectKind: "media_request" },
      { input: { image: true }, expectStepKey: "d_pedir_email" },
      { input: { text: "joao@email.com" }, expectStepKey: "d_confirmar_telefone" },
      { input: { text: "11999998888" }, expectStepKey: "d_finalizar", expectKind: "finalizar" },
    ],
  },
  // 2. Happy path VALOR
  {
    name: "Happy path VALOR",
    startKey: "d_welcome",
    turns: [
      { input: { buttonId: "quero_simular" }, expectStepKey: "d_escolher_simulacao" },
      { input: { buttonId: "simular_rapida" }, expectStepKey: "d_simular_valor" },
      { input: { text: "300" }, expectStepKey: "d_simular_resultado", expectKind: "choice", expectButtonCount: 3 },
      { input: { buttonId: "cadastrar" }, expectStepKey: "d_simular_pedir_conta", expectKind: "media_request" },
      { input: { image: true }, expectStepKey: "d_pedir_documento" },
    ],
  },
  // 3. Dúvida + IA (bug original)
  {
    name: "Dúvida + IA (BUG ORIGINAL)",
    startKey: "d_resultado",
    turns: [
      { input: { buttonId: "duvida" }, expectStepKey: "d_como_funciona_copy_qwpu" },
      { input: { buttonId: "duvida" }, expectStepKey: "d_duvidas", expectKind: "choice", expectButtonCount: 3 },
      // texto livre: cai no fallback ai_answer e DEVE re-emitir botões
      { input: { text: "tem fidelidade?" }, expectStepKey: "d_duvidas", expectAiButtons: true },
      { input: { buttonId: "cadastrar" }, expectStepKey: "d_pedir_documento" },
    ],
  },
  // 4. Loop de dúvida (3x perguntas)
  {
    name: "Loop dúvidas 3x",
    startKey: "d_duvidas",
    turns: [
      { input: { text: "como funciona?" }, expectStepKey: "d_duvidas", expectAiButtons: true },
      { input: { text: "e a multa?" }, expectStepKey: "d_duvidas", expectAiButtons: true },
      { input: { text: "demora quanto?" }, expectStepKey: "d_duvidas", expectAiButtons: true },
      { input: { buttonId: "humano" }, expectStepKey: null as any },
    ],
  },
  // 5. Handoff via texto "humano" no welcome
  {
    name: "Handoff via texto no welcome",
    startKey: "d_welcome",
    turns: [{ input: { text: "humano" }, expectStepKey: null as any }],
  },
  // 6. Handoff via texto no resultado
  {
    name: "Handoff via texto no resultado",
    startKey: "d_resultado",
    turns: [{ input: { text: "rafael" }, expectStepKey: null as any }],
  },
  // 7. Atalho "cadastrar" direto no welcome (não existe atalho global → vai cair em quero_simular ou nada)
  {
    name: "Texto 'cadastrar' no welcome (sem atalho global → fallback)",
    startKey: "d_welcome",
    turns: [{ input: { text: "cadastrar" }, expectStepKey: "d_welcome" /* fb.repeat */ }],
  },
  // 8. Inputs hostis: texto em capture_conta → fallback (vai pra d_resultado via default)
  {
    name: "Texto em capture_conta",
    startKey: "d_pedir_conta",
    turns: [{ input: { text: "qualquer coisa" }, expectStepKey: "d_resultado" }],
  },
  // 9. "1"/"2"/"3" numéricos (cobertura Evolution)
  {
    name: "Numéricos 1/2/3 no welcome",
    startKey: "d_welcome",
    turns: [{ input: { text: "1" }, expectStepKey: "d_escolher_simulacao" }],
  },
  {
    name: "Numérico 2 no welcome → como funciona",
    startKey: "d_welcome",
    turns: [{ input: { text: "2" }, expectStepKey: "d_como_funciona" }],
  },
  {
    name: "Numérico 3 no welcome → handoff",
    startKey: "d_welcome",
    turns: [{ input: { text: "3" }, expectStepKey: null as any }],
  },
];

type Result = { journey: string; channel: string; pass: boolean; log: string[] };
const results: Result[] = [];

for (const channel of [
  { name: "Whapi", caps: WHAPI },
  { name: "Evolution", caps: EVO },
]) {
  for (const j of J) {
    const log: string[] = [];
    let cur = byKey.get(j.startKey);
    if (!cur) {
      results.push({ journey: j.name, channel: channel.name, pass: false, log: [`startKey ${j.startKey} não existe`] });
      continue;
    }
    let pass = true;
    for (let i = 0; i < j.turns.length; i++) {
      const turn = j.turns[i];
      const inputDesc = turn.input.buttonId ? `btn=${turn.input.buttonId}` : turn.input.text ? `txt="${turn.input.text}"` : "image";

      // Em capture_*: imagem avança via success_goto_step_id; texto cai no fallback
      let res: ReturnType<typeof matchTransition>;
      if (turn.input.image && (cur.step_type === "capture_conta" || cur.step_type === "capture_documento")) {
        const dst = cur.fallback?.success_goto_step_id ?? cur.fallback?.goto_step_id ?? cur.transitions.find((t) => t.trigger_intent === "default")?.goto_step_id;
        res = { nextId: dst ?? null, special: null, via: "media_ok" };
      } else if (cur.step_type === "capture_email" || cur.step_type === "confirm_phone") {
        // texto válido → success_goto_step_id
        res = { nextId: cur.fallback?.success_goto_step_id ?? null, special: null, via: "capture_ok" };
      } else {
        res = matchTransition(cur, turn.input.text ?? "", turn.input.buttonId ?? null);
      }

      // Próximo passo
      let nextKey: string | null = null;
      let nextStep: Step | undefined;
      if (res.special === "humano") nextKey = null; // handoff terminal
      else if (res.special === "ai_answer") {
        nextKey = cur.step_key; // fica no mesmo passo, mas re-emite outbound
        nextStep = cur;
      } else if (res.nextId) {
        nextStep = byId.get(res.nextId);
        nextKey = nextStep?.step_key ?? null;
      }

      // Outbound do próximo (ou re-emit do atual)
      let outboundStep: Step | undefined = nextStep ?? (res.special === "ai_answer" ? cur : undefined);
      let outbound: Outbound[] = [];
      if (res.special === "humano") outbound = [{ kind: "handoff" }];
      else if (outboundStep) outbound = buildOutbound(outboundStep, channel.caps);

      // Se ai_answer: além do outbound de choice, primeira mensagem é ai_answer.
      if (res.special === "ai_answer") {
        const btns = getButtons(cur);
        outbound = [
          { kind: "ai_answer", preferred: channel.caps.supportsButtons ? "button" : "number", options: btns },
          ...outbound,
        ];
      }

      // Validar expectativas
      const expK = turn.expectStepKey;
      const okStep = expK === null ? res.special === "humano" : nextKey === expK;
      let okKind = true;
      if (turn.expectKind) {
        const kinds = outbound.map((o) => o.kind);
        okKind = kinds.includes(turn.expectKind);
      }
      let okBtns = true;
      if (turn.expectButtonCount !== undefined) {
        const choice = outbound.find((o) => o.kind === "choice") as any;
        okBtns = choice && choice.options.length === Math.min(turn.expectButtonCount, channel.caps.supportsButtons ? turn.expectButtonCount : turn.expectButtonCount);
      }
      let okAi = true;
      if (turn.expectAiButtons) {
        const ai = outbound.find((o) => o.kind === "ai_answer") as any;
        okAi = ai && Array.isArray(ai.options) && ai.options.length >= 1;
      }

      const turnOk = okStep && okKind && okBtns && okAi;
      pass = pass && turnOk;
      log.push(
        `  turn ${i + 1}: ${inputDesc} via ${res.via} → ${nextKey ?? (res.special ?? "?")} | exp=${expK ?? "HUMANO"} ${turnOk ? "✅" : "❌"}` +
          (turn.expectKind ? ` kind?${okKind}` : "") +
          (turn.expectButtonCount !== undefined ? ` btns?${okBtns}` : "") +
          (turn.expectAiButtons ? ` aiBtns?${okAi}` : ""),
      );

      if (res.special === "humano") break;
      if (!nextStep && res.special !== "ai_answer") {
        log.push(`    (terminal sem próximo passo)`);
        break;
      }
      cur = nextStep ?? cur;
    }
    results.push({ journey: j.name, channel: channel.name, pass, log });
  }
}

// ============================================================
// Relatório
// ============================================================
const SEV_ORDER = { CRIT: 0, HIGH: 1, MED: 2, LOW: 3, INFO: 4 } as const;

let md = `# Auditoria do Fluxo D\n\n`;
md += `Flow ID: \`320bf22c-e383-4f53-a3c0-b88b89b02558\`\n`;
md += `Total de passos: **${steps.length}** (todos ativos)\n`;
md += `Data: ${new Date().toISOString()}\n\n`;
md += `> **Regra:** cada passo é avaliado isoladamente. Cópias com IDs diferentes são passos independentes.\n\n`;

// Resumo de severidade
const sevCounts: Record<string, number> = { CRIT: 0, HIGH: 0, MED: 0, LOW: 0, INFO: 0 };
for (const k of Object.keys(findings)) for (const f of findings[k]) sevCounts[f.sev]++;

md += `## Resumo\n\n`;
md += `| Severidade | Quantidade |\n|---|---|\n`;
for (const s of ["CRIT", "HIGH", "MED", "LOW", "INFO"]) md += `| ${s} | ${sevCounts[s]} |\n`;
md += `\n`;

const totalRuntime = results.length;
const passRuntime = results.filter((r) => r.pass).length;
md += `Runtime: **${passRuntime}/${totalRuntime}** jornadas PASS (Whapi + Evolution).\n\n`;

// 1. Auditoria estática
md += `## 1. Auditoria estática por passo\n\n`;
for (const s of steps) {
  const fs = (findings[s.step_key] || []).slice().sort((a, b) => SEV_ORDER[a.sev] - SEV_ORDER[b.sev]);
  if (fs.length === 0) {
    md += `### ✅ pos${s.position} \`${s.step_key}\` (${s.step_type}) — sem defeitos\n\n`;
    continue;
  }
  const top = fs[0].sev;
  const emoji = top === "CRIT" ? "🔴" : top === "HIGH" ? "🟠" : top === "MED" ? "🟡" : top === "LOW" ? "🔵" : "ℹ️";
  md += `### ${emoji} pos${s.position} \`${s.step_key}\` (${s.step_type}) — "${s.title}"\n\n`;
  for (const f of fs) md += `- **${f.sev}** ${f.msg}\n`;
  md += `\n`;
}

// 2. Reachability
md += `## 2. Reachability a partir de d_welcome\n\n`;
md += `Passos alcançáveis: **${reached.size}/${steps.length}**\n\n`;
if (unreachable.length === 0) md += `Nenhum passo ativo inalcançável.\n\n`;
else {
  md += `Passos ativos inalcançáveis (candidatos a \`is_active=false\`):\n\n`;
  for (const s of unreachable) md += `- pos${s.position} \`${s.step_key}\` (id=${s.id})\n`;
  md += `\nMigration sugerida (desativa **apenas** estes passos, não toca em mais nada):\n\n`;
  md += "```sql\n";
  md += `UPDATE bot_flow_steps SET is_active=false WHERE id IN (${unreachable.map((s) => `'${s.id}'`).join(", ")});\n`;
  md += "```\n\n";
}

// 3. Runtime
md += `## 3. Simulação de runtime (engine v3 emulado)\n\n`;
md += `Capabilities: Whapi=\`{supportsButtons:true, maxButtons:3}\`, Evolution=\`{supportsButtons:false, maxButtons:0}\`.\n\n`;

for (const r of results) {
  md += `### ${r.pass ? "✅" : "❌"} [${r.channel}] ${r.journey}\n\n`;
  md += "```\n";
  for (const l of r.log) md += l + "\n";
  md += "```\n\n";
}

const reportPath = new URL("./report.md", import.meta.url).pathname;
writeFileSync(reportPath, md);
console.log(`✅ Relatório: ${reportPath}`);
console.log(`   ${sevCounts.CRIT} CRIT, ${sevCounts.HIGH} HIGH, ${sevCounts.MED} MED, ${sevCounts.LOW} LOW`);
console.log(`   Runtime: ${passRuntime}/${totalRuntime} jornadas PASS`);
console.log(`   Inalcançáveis: ${unreachable.length}`);
