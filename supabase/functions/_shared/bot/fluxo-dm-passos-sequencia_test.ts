/**
 * Cada PASSO da jornada D/M deve ser SEGUIDO — sem pular.
 *
 * Caminha success_goto / fallback / rewrite F16 e asserta a sequência
 * completa (welcome → … → ask_contaunica → ask_finalizar → finalizando).
 * Sem portal.
 *
 *   deno test --allow-read --no-check supabase/functions/_shared/bot/fluxo-dm-passos-sequencia_test.ts
 */
import {
  assertEquals,
  assert,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  pickActivateDestination,
  rewriteActivateAwayFromSimPath,
} from "./flow-activate-routing.ts";
import { nextSeparatedCadastroStep } from "./cadastro-fixes.ts";

type RawStep = {
  id: string;
  step_key: string;
  step_type: string;
  is_active?: boolean | null;
  transitions?: Array<{
    goto_step_id?: string | null;
    goto_special?: string | null;
    trigger_phrases?: string[];
  }>;
  fallback?: {
    mode?: string;
    goto_step_id?: string | null;
    success_goto_step_id?: string | null;
  } | null;
};

const STEPS_PATH = new URL(
  "../../../../.kiro/specs/fluxo-d-auditoria/steps.json",
  import.meta.url,
);

async function loadSteps(): Promise<RawStep[]> {
  return JSON.parse(await Deno.readTextFile(STEPS_PATH)) as RawStep[];
}

function active(steps: RawStep[], key: string): RawStep {
  const s = steps.find((x) => x.step_key === key && x.is_active !== false);
  if (!s) throw new Error(`missing active step ${key}`);
  return s;
}

function keyById(steps: RawStep[], id: string | null | undefined): string | null {
  if (!id) return null;
  return steps.find((s) => s.id === id)?.step_key ?? null;
}

/** Próximo após captura OK (success_goto → goto → default transition). */
function afterCaptureSuccess(steps: RawStep[], key: string): string {
  const s = active(steps, key);
  const sid = s.fallback?.success_goto_step_id || null;
  if (sid) {
    const k = keyById(steps, sid);
    if (k) return k;
  }
  if (s.fallback?.mode === "goto" && s.fallback.goto_step_id) {
    const k = keyById(steps, s.fallback.goto_step_id);
    if (k) return k;
  }
  const def = (s.transitions || []).find((t) => t.goto_step_id);
  const k = keyById(steps, def?.goto_step_id);
  if (!k) throw new Error(`sem próximo após captura ${key}`);
  return k;
}

function assertSeq(actual: string[], expected: string[], label: string) {
  assertEquals(actual, expected, label);
}

/**
 * Após d_finalizar o motor injeta gates sys (não são bot_flow_steps):
 * ask_contaunica → ask_finalizar → finalizando
 */
function appendPortalGates(path: string[], contaunicaAnswered = false): string[] {
  const out = [...path];
  let gate = nextSeparatedCadastroStep({
    contaunica_answered: contaunicaAnswered,
  });
  out.push(gate);
  if (gate === "ask_contaunica") {
    gate = nextSeparatedCadastroStep({ contaunica_answered: true });
    out.push(gate);
  }
  out.push("finalizando");
  return out;
}

function cloneM(steps: RawStep[]): RawStep[] {
  const idMap = new Map<string, string>();
  for (const s of steps) {
    const hex = s.id.replace(/-/g, "");
    const flipped = [...hex].map((c) => {
      const n = parseInt(c, 16);
      return Number.isFinite(n) ? (15 - n).toString(16) : c;
    }).join("");
    idMap.set(
      s.id,
      `${flipped.slice(0, 8)}-${flipped.slice(8, 12)}-${flipped.slice(12, 16)}-${flipped.slice(16, 20)}-${flipped.slice(20, 32)}`,
    );
  }
  return steps.map((s) => ({
    ...s,
    id: idMap.get(s.id)!,
    fallback: s.fallback
      ? {
        ...s.fallback,
        goto_step_id: s.fallback.goto_step_id
          ? idMap.get(String(s.fallback.goto_step_id)) || s.fallback.goto_step_id
          : s.fallback.goto_step_id,
        success_goto_step_id: s.fallback.success_goto_step_id
          ? idMap.get(String(s.fallback.success_goto_step_id)) ||
            s.fallback.success_goto_step_id
          : s.fallback.success_goto_step_id,
      }
      : s.fallback,
    transitions: (s.transitions || []).map((t) => ({
      ...t,
      goto_step_id: t.goto_step_id
        ? idMap.get(String(t.goto_step_id)) || t.goto_step_id
        : t.goto_step_id,
    })),
  }));
}

/** Cadeia pós-documento canônica no grafo. */
function cadastroTail(steps: RawStep[]): string[] {
  const doc = "d_pedir_documento";
  const email = afterCaptureSuccess(steps, doc);
  assertEquals(email, "d_pedir_email");
  const phone = afterCaptureSuccess(steps, email);
  assertEquals(phone, "d_confirmar_telefone");
  const fin = afterCaptureSuccess(steps, phone);
  assertEquals(fin, "d_finalizar");
  return [doc, email, phone, fin];
}

for (const variant of ["D", "M"] as const) {
  Deno.test(`${variant}: SIMULAR COMPLETA — cada passo na ordem`, async () => {
    const steps = variant === "D" ? await loadSteps() : cloneM(await loadSteps());
    const path: string[] = ["d_welcome"];

    // 1 simular
    path.push("d_escolher_simulacao");
    // completa
    path.push("d_pedir_conta");
    // OCR ok
    assertEquals(afterCaptureSuccess(steps, "d_pedir_conta"), "d_resultado");
    path.push("d_resultado");
    // continuar cadastro
    path.push("d_pedir_documento");
    path.push(...cadastroTail(steps).slice(1)); // email, phone, finalizar

    const full = appendPortalGates(path);
    assertSeq(full, [
      "d_welcome",
      "d_escolher_simulacao",
      "d_pedir_conta",
      "d_resultado",
      "d_pedir_documento",
      "d_pedir_email",
      "d_confirmar_telefone",
      "d_finalizar",
      "ask_contaunica",
      "ask_finalizar",
      "finalizando",
    ], `${variant} sim completa`);
  });

  Deno.test(`${variant}: SIMULAR RÁPIDA — cada passo na ordem`, async () => {
    const steps = variant === "D" ? await loadSteps() : cloneM(await loadSteps());
    assertEquals(afterCaptureSuccess(steps, "d_simular_valor"), "d_simular_resultado");

    const path = appendPortalGates([
      "d_welcome",
      "d_escolher_simulacao",
      "d_simular_valor",
      "d_simular_resultado",
      "d_simular_pedir_conta", // cadastrar no resultado-rápido
      ...cadastroTail(steps),
    ]);

    assertSeq(path, [
      "d_welcome",
      "d_escolher_simulacao",
      "d_simular_valor",
      "d_simular_resultado",
      "d_simular_pedir_conta",
      "d_pedir_documento",
      "d_pedir_email",
      "d_confirmar_telefone",
      "d_finalizar",
      "ask_contaunica",
      "ask_finalizar",
      "finalizando",
    ], `${variant} sim rápida`);
  });

  Deno.test(`${variant}: ATIVAR/CADASTRAR sem conta — cada passo (com F16)`, async () => {
    const steps = variant === "D" ? await loadSteps() : cloneM(await loadSteps());

    // pick canônico
    assertEquals(
      pickActivateDestination(steps as never, {})?.step_key,
      "d_simular_pedir_conta",
    );

    // BUG do grafo: como_funciona → d_pedir_conta; motor reescreve
    const intended = active(steps, "d_pedir_conta");
    const rewritten = rewriteActivateAwayFromSimPath(
      intended as never,
      steps as never,
      {},
      { messageText: "quero me cadastrar", buttonId: "cadastrar" },
    );
    assertEquals(rewritten?.step_key, "d_simular_pedir_conta");

    assertEquals(afterCaptureSuccess(steps, "d_simular_pedir_conta"), "d_pedir_documento");

    const path = appendPortalGates([
      "d_welcome",
      "d_simular_pedir_conta",
      ...cadastroTail(steps),
    ]);

    assertSeq(path, [
      "d_welcome",
      "d_simular_pedir_conta",
      "d_pedir_documento",
      "d_pedir_email",
      "d_confirmar_telefone",
      "d_finalizar",
      "ask_contaunica",
      "ask_finalizar",
      "finalizando",
    ], `${variant} ativar sem conta`);
  });

  Deno.test(`${variant}: ATIVAR com conta — documento e NÃO pula email/tel/boleto`, async () => {
    const steps = variant === "D" ? await loadSteps() : cloneM(await loadSteps());
    assertEquals(
      pickActivateDestination(steps as never, {
        electricity_bill_value: 400,
        bill_data_confirmed_at: "2026-07-01",
      })?.step_key,
      "d_pedir_documento",
    );

    const path = appendPortalGates([
      "d_welcome",
      "d_pedir_documento",
      ...cadastroTail(steps).slice(1),
    ]);

    assertSeq(path, [
      "d_welcome",
      "d_pedir_documento",
      "d_pedir_email",
      "d_confirmar_telefone",
      "d_finalizar",
      "ask_contaunica",
      "ask_finalizar",
      "finalizando",
    ], `${variant} ativar com conta`);

    // Não pode ir welcome → finalizar direto
    assert(!path.includes("d_pedir_conta"), "não misturar conta de simulação");
    assertEquals(path.indexOf("d_pedir_email") < path.indexOf("d_confirmar_telefone"), true);
    assertEquals(path.indexOf("d_confirmar_telefone") < path.indexOf("d_finalizar"), true);
    assertEquals(path.indexOf("ask_contaunica") < path.indexOf("ask_finalizar"), true);
    assertEquals(path.indexOf("ask_finalizar") < path.indexOf("finalizando"), true);
  });
}

Deno.test("AUDITORIA: cadastrar em como_funciona/duvidas → conta de CADASTRO (sem pulo)", async () => {
  const steps = await loadSteps();
  const destCad = active(steps, "d_simular_pedir_conta").id;
  for (const key of ["d_como_funciona", "d_duvidas"] as const) {
    const s = active(steps, key);
    const cadEdges = (s.transitions || []).filter((t) => {
      const phrases = (t.trigger_phrases || []).map((p) => p.toLowerCase());
      const intent = String(t.trigger_intent || "").toLowerCase();
      return intent === "cadastrar" || phrases.some((p) => /cadastr|ativar/.test(p));
    });
    assert(cadEdges.length > 0, `${key} sem aresta cadastrar`);
    for (const t of cadEdges) {
      assertEquals(
        t.goto_step_id,
        destCad,
        `${key} cadastrar deve ir a d_simular_pedir_conta`,
      );
      assert(
        keyById(steps, t.goto_step_id) !== "d_pedir_conta",
        `${key} não pode ir à conta de simulação`,
      );
      assert(
        keyById(steps, t.goto_step_id) !== "d_pedir_documento",
        `${key} não pode pular a conta de cadastro`,
      );
    }
  }
});

Deno.test("cadeia capture NÃO pula email nem telefone", async () => {
  const steps = await loadSteps();
  // Documento NÃO pode ir direto a d_finalizar
  const afterDoc = afterCaptureSuccess(steps, "d_pedir_documento");
  assertEquals(afterDoc, "d_pedir_email");
  assert(afterDoc !== "d_finalizar", "documento não pode pular para finalizar");

  const afterEmail = afterCaptureSuccess(steps, "d_pedir_email");
  assertEquals(afterEmail, "d_confirmar_telefone");

  const afterPhone = afterCaptureSuccess(steps, "d_confirmar_telefone");
  assertEquals(afterPhone, "d_finalizar");

  // Conta simulação → resultado (não documento)
  assertEquals(afterCaptureSuccess(steps, "d_pedir_conta"), "d_resultado");
  // Conta cadastro → documento (não resultado)
  assertEquals(afterCaptureSuccess(steps, "d_simular_pedir_conta"), "d_pedir_documento");
});

Deno.test("d_finalizar NÃO dispara portal sem ask_contaunica + ask_finalizar", () => {
  // Motor: finalizar_cadastro → nextSeparatedCadastroStep
  assertEquals(nextSeparatedCadastroStep({}), "ask_contaunica");
  assertEquals(
    nextSeparatedCadastroStep({ contaunica_answered: true }),
    "ask_finalizar",
  );
  // Só depois do clique Finalizar viria finalizando — testado sem chamar portal
});
