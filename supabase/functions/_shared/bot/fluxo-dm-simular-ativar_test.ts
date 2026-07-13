/**
 * Matriz EXAUSTIVA Fluxo D + Fluxo M:
 *   Quero SIMULAR | Quero CADASTRAR | ATIVAR benefício
 *
 * Usa o grafo real do Fluxo D (steps.json) e um clone M (mesmos step_key,
 * UUIDs diferentes). Sem WhatsApp, sem portal.
 *
 * Regra de ouro:
 *   SIMULAR  → d_escolher_simulacao / d_pedir_conta / d_simular_valor / d_resultado
 *   ATIVAR   → d_simular_pedir_conta (sem conta) | d_pedir_documento (com conta)
 *              NUNCA d_pedir_conta nem seletor Completa/Rápida
 *
 * Rodar:
 *   deno test supabase/functions/_shared/bot/fluxo-dm-simular-ativar_test.ts --allow-read
 */
import {
  assertEquals,
  assert,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { matchTransition } from "../flow-router.ts";
import {
  isActivateIntent,
  isSimulateIntent,
  pickActivateDestination,
  rewriteActivateAwayFromSimPath,
  resolveCanonicalNudgeChoice,
  type ActivateStepLike,
  type ActivateCustomerLike,
} from "./flow-activate-routing.ts";

type RawTransition = {
  goto_step_id?: string | null;
  goto_special?: string | null;
  trigger_phrases?: string[];
  trigger_intent?: string | null;
};

type RawStep = {
  id: string;
  step_key: string;
  step_type: string;
  is_active?: boolean | null;
  transitions?: RawTransition[];
  captures?: unknown[];
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

async function loadFluxoD(): Promise<RawStep[]> {
  const raw = JSON.parse(await Deno.readTextFile(STEPS_PATH));
  return raw as RawStep[];
}

/** Clone M: mesmos step_key/arestas, UUIDs remapeados (prova que motor não depende de UUID). */
function cloneAsFluxoM(steps: RawStep[]): RawStep[] {
  const idMap = new Map<string, string>();
  for (const s of steps) {
    // UUID v4-ish determinístico a partir do id original
    const hex = s.id.replace(/-/g, "");
    const flipped = [...hex].map((c) => {
      const n = parseInt(c, 16);
      return Number.isFinite(n) ? (15 - n).toString(16) : c;
    }).join("");
    const mid =
      `${flipped.slice(0, 8)}-${flipped.slice(8, 12)}-${flipped.slice(12, 16)}-${flipped.slice(16, 20)}-${flipped.slice(20, 32)}`;
    idMap.set(s.id, mid);
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

function byKey(steps: RawStep[], key: string): RawStep {
  const s = steps.find((x) => x.step_key === key && x.is_active !== false);
  if (!s) throw new Error(`step ativo não encontrado: ${key}`);
  return s;
}

function keyOf(steps: RawStep[], id: string | null | undefined): string | null {
  if (!id) return null;
  return steps.find((s) => s.id === id)?.step_key ?? null;
}

const SIM_PATH_KEYS = new Set([
  "d_pedir_conta",
  "d_escolher_simulacao",
  "d_simular_valor",
  "d_simular_resultado",
  "d_resultado",
]);

const ACTIVATE_OK_KEYS = new Set([
  "d_simular_pedir_conta",
  "d_pedir_documento",
]);

/**
 * Espelha o motor conversacional (match → rewrite F16 → pickActivate).
 * Retorna step_key final (ou special:humano / null se não resolve).
 */
function resolveDestination(
  steps: RawStep[],
  currentKey: string,
  customer: ActivateCustomerLike,
  opts: { messageText?: string | null; buttonId?: string | null },
): { destKey: string | null; special: string | null; rewritten: boolean } {
  const current = byKey(steps, currentKey);
  const matched = matchTransition({
    transitions: (current.transitions || []) as never,
    buttonId: opts.buttonId ?? null,
    messageText: opts.messageText ?? null,
    intents: [],
  });

  if (matched?.goto_special === "humano") {
    // F16: se passo SEM botões e intenção ativar → override (welcome TEM botões)
    const caps = current.captures || [];
    const hasButtons = caps.some((c: any) =>
      c?.field === "_buttons" && Array.isArray(c?.value) && c.value.length > 0
    );
    if (
      !hasButtons &&
      (resolveCanonicalNudgeChoice(opts.messageText) === "ativar" ||
        isActivateIntent(opts.messageText, opts.buttonId))
    ) {
      const dest = pickActivateDestination(steps, customer);
      return { destKey: dest?.step_key ?? null, special: null, rewritten: true };
    }
    return { destKey: null, special: "humano", rewritten: false };
  }

  if (matched?.goto_special === "cadastro") {
    const dest = pickActivateDestination(steps, customer);
    return { destKey: dest?.step_key ?? null, special: null, rewritten: false };
  }

  if (matched?.goto_step_id) {
    const intended = steps.find((s) => s.id === matched.goto_step_id) || null;
    const rewritten = rewriteActivateAwayFromSimPath(
      intended,
      steps,
      customer,
      opts,
    );
    if (rewritten) {
      return {
        destKey: rewritten.step_key ?? null,
        special: null,
        rewritten: true,
      };
    }
    return {
      destKey: intended?.step_key ?? null,
      special: null,
      rewritten: false,
    };
  }

  // Sem transition: nudge / intent ativar
  const choice = resolveCanonicalNudgeChoice(opts.messageText);
  const wantActivate =
    choice === "ativar" || isActivateIntent(opts.messageText, opts.buttonId);
  if (wantActivate) {
    const dest = pickActivateDestination(steps, customer);
    return { destKey: dest?.step_key ?? null, special: null, rewritten: false };
  }

  if (choice === "simular" || isSimulateIntent(opts.messageText, opts.buttonId)) {
    // Sem transition explícita: destino canônico de simulação = seletor
    const sel = steps.find((s) =>
      s.step_key === "d_escolher_simulacao" && s.is_active !== false
    );
    return { destKey: sel?.step_key ?? "d_pedir_conta", special: null, rewritten: false };
  }

  return { destKey: null, special: null, rewritten: false };
}

// ─── Frases / botões (todas as variantes) ───────────────────────────────

const SIMULAR_INPUTS: Array<{ label: string; messageText?: string; buttonId?: string }> = [
  { label: "texto quero simular", messageText: "quero simular" },
  { label: "texto simular economia", messageText: "simular economia" },
  { label: "texto simulação", messageText: "simulação" },
  { label: "btn quero_simular", buttonId: "quero_simular", messageText: "💚 Quero simular" },
  { label: "btn simular", buttonId: "simular", messageText: "Simular" },
  { label: "nudge 1", messageText: "1" },
];

const CADASTRAR_INPUTS: Array<{ label: string; messageText?: string; buttonId?: string }> = [
  { label: "texto quero me cadastrar", messageText: "quero me cadastrar" },
  { label: "texto quero cadastrar", messageText: "quero cadastrar" },
  { label: "texto cadastrar", messageText: "cadastrar" },
  { label: "texto cadastrar agora", messageText: "cadastrar agora" },
  { label: "btn cadastrar", buttonId: "cadastrar", messageText: "✅ Quero me cadastrar" },
  { label: "btn quero_cadastrar", buttonId: "quero_cadastrar", messageText: "Quero me cadastrar" },
  { label: "btn sim_cadastrar", buttonId: "sim_cadastrar" },
];

const ATIVAR_INPUTS: Array<{ label: string; messageText?: string; buttonId?: string }> = [
  { label: "texto ativar o benefício", messageText: "ativar o benefício" },
  { label: "texto ativar o beneficio", messageText: "ativar o beneficio" },
  { label: "texto ativar beneficio", messageText: "ativar beneficio" },
  { label: "texto quero ativar", messageText: "quero ativar" },
  { label: "texto ativar", messageText: "ativar" },
  { label: "nudge 3", messageText: "3" },
];

const ORIGINS = [
  "d_welcome",
  "d_como_funciona",
  "d_resultado",
  "d_simular_resultado",
  "d_escolher_simulacao",
  "d_duvidas",
  "d_como_funciona_copy_qwpu",
] as const;

const CUSTOMER_EMPTY: ActivateCustomerLike = {};
const CUSTOMER_WITH_BILL: ActivateCustomerLike = {
  electricity_bill_value: 380,
  bill_data_confirmed_at: "2026-07-01T12:00:00Z",
};

// ─── Testes base ────────────────────────────────────────────────────────

Deno.test("fixture Fluxo D carrega com os 2 pedir-conta + documento", async () => {
  const d = await loadFluxoD();
  assert(d.some((s) => s.step_key === "d_pedir_conta"));
  assert(d.some((s) => s.step_key === "d_simular_pedir_conta"));
  assert(d.some((s) => s.step_key === "d_pedir_documento"));
  assert(d.some((s) => s.step_key === "d_escolher_simulacao"));
});

Deno.test("clone M preserva step_keys e remapeia UUIDs", async () => {
  const d = await loadFluxoD();
  const m = cloneAsFluxoM(d);
  assertEquals(m.length, d.length);
  for (let i = 0; i < d.length; i++) {
    assertEquals(m[i].step_key, d[i].step_key);
    assert(m[i].id !== d[i].id, `UUID deveria mudar: ${d[i].step_key}`);
  }
  // aresta welcome→escolher_simulacao ainda resolve por id remapeado
  const welcome = byKey(m, "d_welcome");
  const t = welcome.transitions?.find((x) =>
    (x.trigger_phrases || []).includes("quero simular")
  );
  assert(t?.goto_step_id);
  assertEquals(keyOf(m, t!.goto_step_id!), "d_escolher_simulacao");
});

// ─── Classificação de intenção ──────────────────────────────────────────

Deno.test("matriz intent: SIMULAR nunca é ATIVAR e vice-versa", () => {
  for (const i of SIMULAR_INPUTS) {
    if (i.messageText === "1") continue; // "1" só é nudge, não isSimulateIntent puro
    assertEquals(
      isSimulateIntent(i.messageText, i.buttonId),
      true,
      `simular falhou: ${i.label}`,
    );
    assertEquals(
      isActivateIntent(i.messageText, i.buttonId),
      false,
      `simular marcado como ativar: ${i.label}`,
    );
  }
  for (const i of [...CADASTRAR_INPUTS, ...ATIVAR_INPUTS]) {
    if (i.messageText === "3") {
      // "3" sozinho não passa ACTIVATE_RX — só nudge canônico
      assertEquals(resolveCanonicalNudgeChoice("3"), "ativar");
      continue;
    }
    assertEquals(
      isActivateIntent(i.messageText, i.buttonId ?? null),
      true,
      `ativar/cadastrar falhou: ${i.label}`,
    );
    assertEquals(
      isSimulateIntent(i.messageText, i.buttonId ?? null),
      false,
      `ativar marcado como simular: ${i.label}`,
    );
  }
});

Deno.test("nudge canônico 1/2/3", () => {
  assertEquals(resolveCanonicalNudgeChoice("1"), "simular");
  assertEquals(resolveCanonicalNudgeChoice("2"), "como");
  assertEquals(resolveCanonicalNudgeChoice("3"), "ativar");
  assertEquals(resolveCanonicalNudgeChoice("Ativar o benefício"), "ativar");
  assertEquals(resolveCanonicalNudgeChoice("quero simular"), "simular");
});

// ─── Matriz por origem × intenção × customer × variante ─────────────────

for (const variant of ["D", "M"] as const) {
  for (const [custLabel, customer] of [
    ["sem_conta", CUSTOMER_EMPTY],
    ["com_conta", CUSTOMER_WITH_BILL],
  ] as const) {
    Deno.test(
      `MATRIZ ${variant}/${custLabel}: ATIVAR/CADASTRAR nunca cai em caminho de SIMULAÇÃO`,
      async () => {
        const base = await loadFluxoD();
        const steps = variant === "D" ? base : cloneAsFluxoM(base);
        const activateInputs = [...CADASTRAR_INPUTS, ...ATIVAR_INPUTS];

        for (const origin of ORIGINS) {
          for (const input of activateInputs) {
            // "3" no grafo com botões = humano (documentado à parte)
            if (input.messageText === "3") continue;

            const r = resolveDestination(steps, origin, customer, input);
            if (r.special === "humano") {
              throw new Error(
                `${variant}/${origin}/${input.label} → humano (deveria ativar)`,
              );
            }
            assert(
              r.destKey && ACTIVATE_OK_KEYS.has(r.destKey),
              `${variant}/${origin}/${input.label} → ${r.destKey} (esperado conta-cadastro ou documento)`,
            );
            assert(
              !SIM_PATH_KEYS.has(r.destKey!),
              `${variant}/${origin}/${input.label} caiu em SIM: ${r.destKey}`,
            );
          }
        }
      },
    );
  }
}

// ─── Casos canônicos por passo (happy paths) ────────────────────────────

async function stepsFor(variant: "D" | "M") {
  const base = await loadFluxoD();
  return variant === "D" ? base : cloneAsFluxoM(base);
}

for (const variant of ["D", "M"] as const) {
  Deno.test(`${variant}: SIMULAR no welcome → d_escolher_simulacao`, async () => {
    const steps = await stepsFor(variant);
    for (const input of [
      { messageText: "quero simular" },
      { buttonId: "quero_simular", messageText: "Quero simular" },
      { messageText: "1" },
      { messageText: "simular" },
    ]) {
      const r = resolveDestination(steps, "d_welcome", CUSTOMER_EMPTY, input);
      assertEquals(r.destKey, "d_escolher_simulacao", JSON.stringify(input));
      assertEquals(r.rewritten, false);
    }
  });

  Deno.test(`${variant}: Completa → d_pedir_conta | Rápida → d_simular_valor`, async () => {
    const steps = await stepsFor(variant);
    const completa = resolveDestination(steps, "d_escolher_simulacao", CUSTOMER_EMPTY, {
      buttonId: "simular_completa",
      messageText: "📸 Simulação completa",
    });
    assertEquals(completa.destKey, "d_pedir_conta");

    const rapida = resolveDestination(steps, "d_escolher_simulacao", CUSTOMER_EMPTY, {
      buttonId: "simular_rapida",
      messageText: "💡 Simulação rápida",
    });
    assertEquals(rapida.destKey, "d_simular_valor");
  });

  Deno.test(`${variant}: BUG F16 — cadastrar em d_como_funciona vai conta CADASTRO`, async () => {
    const steps = await stepsFor(variant);
    const raw = matchTransition({
      transitions: byKey(steps, "d_como_funciona").transitions as never,
      buttonId: "cadastrar",
      messageText: "quero me cadastrar",
      intents: [],
    });
    assertEquals(keyOf(steps, raw?.goto_step_id), "d_simular_pedir_conta");

    const fixed = resolveDestination(steps, "d_como_funciona", CUSTOMER_EMPTY, {
      buttonId: "cadastrar",
      messageText: "quero me cadastrar",
    });
    assertEquals(fixed.destKey, "d_simular_pedir_conta");

    const withBill = resolveDestination(steps, "d_como_funciona", CUSTOMER_WITH_BILL, {
      messageText: "ativar o benefício",
    });
    assertEquals(withBill.destKey, "d_pedir_documento");
  });

  Deno.test(`${variant}: ATIVAR no seletor Completa/Rápida → conta cadastro (não sim)`, async () => {
    const steps = await stepsFor(variant);
    const r = resolveDestination(steps, "d_escolher_simulacao", CUSTOMER_EMPTY, {
      messageText: "ativar o benefício",
    });
    assertEquals(r.destKey, "d_simular_pedir_conta");
    assert(r.rewritten || ACTIVATE_OK_KEYS.has(r.destKey!));
  });

  Deno.test(`${variant}: após simulação (d_resultado) cadastrar → documento`, async () => {
    const steps = await stepsFor(variant);
    // Já tem conta da simulação
    const r = resolveDestination(steps, "d_resultado", CUSTOMER_WITH_BILL, {
      buttonId: "cadastrar",
      messageText: "Continuar Cadastro",
    });
    assertEquals(r.destKey, "d_pedir_documento");
  });

  Deno.test(`${variant}: d_simular_resultado cadastrar → d_simular_pedir_conta`, async () => {
    const steps = await stepsFor(variant);
    const r = resolveDestination(steps, "d_simular_resultado", CUSTOMER_EMPTY, {
      buttonId: "cadastrar",
      messageText: "quero me cadastrar",
    });
    assertEquals(r.destKey, "d_simular_pedir_conta");
  });

  Deno.test(`${variant}: d_duvidas cadastrar → conta cadastro (não pula)`, async () => {
    const steps = await stepsFor(variant);
    const r = resolveDestination(steps, "d_duvidas", CUSTOMER_EMPTY, {
      buttonId: "cadastrar",
      messageText: "cadastrar",
    });
    assertEquals(r.destKey, "d_simular_pedir_conta");

    // Com conta pronta: mesmo botão cadastrar → documento (não pede foto de novo)
    const withBill = resolveDestination(steps, "d_duvidas", CUSTOMER_WITH_BILL, {
      buttonId: "cadastrar",
      messageText: "cadastrar",
    });
    assertEquals(withBill.destKey, "d_pedir_documento");
  });

  Deno.test(`${variant}: jornada SIMULAR completa até resultado`, async () => {
    const steps = await stepsFor(variant);
    let cur = "d_welcome";
    cur = resolveDestination(steps, cur, CUSTOMER_EMPTY, { messageText: "quero simular" }).destKey!;
    assertEquals(cur, "d_escolher_simulacao");
    cur = resolveDestination(steps, cur, CUSTOMER_EMPTY, { buttonId: "simular_completa" }).destKey!;
    assertEquals(cur, "d_pedir_conta");
    // após OCR conta de simulação → fallback goto resultado
    const conta = byKey(steps, "d_pedir_conta");
    assertEquals(keyOf(steps, conta.fallback?.goto_step_id), "d_resultado");
  });

  Deno.test(`${variant}: jornada ATIVAR sem conta → conta cadastro → documento`, async () => {
    const steps = await stepsFor(variant);
    const r1 = resolveDestination(steps, "d_welcome", CUSTOMER_EMPTY, {
      messageText: "ativar o benefício",
    });
    assertEquals(r1.destKey, "d_simular_pedir_conta");
    const contaCad = byKey(steps, "d_simular_pedir_conta");
    assertEquals(
      keyOf(steps, contaCad.fallback?.success_goto_step_id || contaCad.fallback?.goto_step_id),
      "d_pedir_documento",
    );
  });

  Deno.test(`${variant}: jornada ATIVAR com conta → documento direto`, async () => {
    const steps = await stepsFor(variant);
    const r = resolveDestination(steps, "d_welcome", CUSTOMER_WITH_BILL, {
      messageText: "quero me cadastrar",
    });
    assertEquals(r.destKey, "d_pedir_documento");
  });

  Deno.test(`${variant}: jornada SIMULAR rápida → valor → resultado-sim → cadastrar`, async () => {
    const steps = await stepsFor(variant);
    let cur = resolveDestination(steps, "d_welcome", CUSTOMER_EMPTY, {
      messageText: "quero simular",
    }).destKey!;
    cur = resolveDestination(steps, cur, CUSTOMER_EMPTY, {
      buttonId: "simular_rapida",
    }).destKey!;
    assertEquals(cur, "d_simular_valor");
    const valor = byKey(steps, "d_simular_valor");
    assertEquals(keyOf(steps, valor.fallback?.goto_step_id), "d_simular_resultado");
    const after = resolveDestination(steps, "d_simular_resultado", CUSTOMER_EMPTY, {
      buttonId: "cadastrar",
    });
    assertEquals(after.destKey, "d_simular_pedir_conta");
  });
}

// ─── Welcome "3" = humano no grafo (documentado) + ativar por TEXTO ─────

Deno.test("D+M: no welcome, texto 'ativar o benefício' NÃO é humano", async () => {
  for (const variant of ["D", "M"] as const) {
    const steps = await stepsFor(variant);
    const r = resolveDestination(steps, "d_welcome", CUSTOMER_EMPTY, {
      messageText: "ativar o benefício",
    });
    assertEquals(r.special, null);
    assertEquals(r.destKey, "d_simular_pedir_conta");
  }
});

Deno.test("D+M: no welcome, botão/número 3 ainda é humano (grafo atual)", async () => {
  for (const variant of ["D", "M"] as const) {
    const steps = await stepsFor(variant);
    const r = resolveDestination(steps, "d_welcome", CUSTOMER_EMPTY, {
      buttonId: "humano",
      messageText: "3",
    });
    assertEquals(r.special, "humano");
  }
});

// ─── pickActivateDestination isolado nos dois grafos ────────────────────

Deno.test("pickActivate Destination idêntico em D e M (por step_key)", async () => {
  const d = await loadFluxoD();
  const m = cloneAsFluxoM(d);
  for (const customer of [CUSTOMER_EMPTY, CUSTOMER_WITH_BILL]) {
    const dd = pickActivateDestination(d, customer);
    const mm = pickActivateDestination(m, customer);
    assertEquals(dd?.step_key, mm?.step_key);
    assert(dd?.id !== mm?.id);
  }
});

// ─── Contagem: nada ficou de fora ───────────────────────────────────────

Deno.test("cobertura: todos ORIGINS × (cadastrar+ativar) × 2 customers × D/M passam regra ouro", async () => {
  const variants: Array<"D" | "M"> = ["D", "M"];
  let cases = 0;
  let pass = 0;
  for (const variant of variants) {
    const steps = await stepsFor(variant);
    for (const customer of [CUSTOMER_EMPTY, CUSTOMER_WITH_BILL]) {
      for (const origin of ORIGINS) {
        for (const input of [...CADASTRAR_INPUTS, ...ATIVAR_INPUTS]) {
          if (input.messageText === "3") continue; // humano no grafo com botões
          cases++;
          const r = resolveDestination(steps, origin, customer, input);
          const ok =
            !!r.destKey &&
            ACTIVATE_OK_KEYS.has(r.destKey) &&
            !SIM_PATH_KEYS.has(r.destKey);
          if (!ok) {
            throw new Error(
              `FAIL ${variant}/${origin}/${input.label} → ${r.destKey}/${r.special}`,
            );
          }
          pass++;
        }
      }
    }
  }
  assertEquals(pass, cases);
  assert(cases >= 100, `poucos casos: ${cases}`);
  console.log(`[fluxo-dm] casos ativar/cadastrar validados: ${cases}`);
});

/** Destino canônico do pickActivate (quando não há aresta explícita boa). */
Deno.test("pickActivate: sem conta → conta-cadastro; com conta → documento (D e M)", async () => {
  for (const variant of ["D", "M"] as const) {
    const steps = await stepsFor(variant);
    assertEquals(
      pickActivateDestination(steps, CUSTOMER_EMPTY)?.step_key,
      "d_simular_pedir_conta",
    );
    assertEquals(
      pickActivateDestination(steps, CUSTOMER_WITH_BILL)?.step_key,
      "d_pedir_documento",
    );
  }
});

/** SIMULAR a partir de welcome/seletor fica no caminho de simulação. */
Deno.test("matriz SIMULAR: welcome→seletor; seletor→conta/valor (D e M)", async () => {
  for (const variant of ["D", "M"] as const) {
    const steps = await stepsFor(variant);

    for (const input of [
      { messageText: "quero simular" },
      { buttonId: "quero_simular", messageText: "Quero simular" },
      { messageText: "simular" },
      { messageText: "1" },
    ]) {
      const r = resolveDestination(steps, "d_welcome", CUSTOMER_EMPTY, input);
      assertEquals(r.destKey, "d_escolher_simulacao", `${variant} ${JSON.stringify(input)}`);
    }

    assertEquals(
      resolveDestination(steps, "d_escolher_simulacao", CUSTOMER_EMPTY, {
        buttonId: "simular_completa",
      }).destKey,
      "d_pedir_conta",
    );
    assertEquals(
      resolveDestination(steps, "d_escolher_simulacao", CUSTOMER_EMPTY, {
        buttonId: "simular_rapida",
      }).destKey,
      "d_simular_valor",
    );
    assertEquals(
      resolveDestination(steps, "d_escolher_simulacao", CUSTOMER_EMPTY, {
        messageText: "1",
      }).destKey,
      "d_pedir_conta",
    );
    assertEquals(
      resolveDestination(steps, "d_escolher_simulacao", CUSTOMER_EMPTY, {
        messageText: "2",
      }).destKey,
      "d_simular_valor",
    );
  }
});
