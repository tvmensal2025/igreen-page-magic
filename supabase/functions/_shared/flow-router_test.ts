// Tests for `_shared/flow-router.ts` — bugfix `whatsapp-flow-reliability-fix`,
// tasks 18 (cláusula 2.12) e 20 (cláusula 2.15).
//
// Cobre:
//   - routeEngine preserva `conversation_step` para qualquer
//     CADASTRO_STEP, mesmo quando a flag muda (PBT + casos unitários);
//   - matchTransition prioriza buttonId sobre messageText na ordem
//     definida no design §3.3.

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import fc from "https://esm.sh/fast-check@3.23.2";

import {
  CADASTRO_STEPS,
  type FlowTransition,
  matchTransition,
  resolveFlowButtonFromText,
  routeEngine,
  SPECIAL_GOTO_VALUES,
} from "./flow-router.ts";

// ─── routeEngine: unit ──────────────────────────────────────────────────

Deno.test("routeEngine preserves cadastro step when consultant flag flips on", () => {
  const r = routeEngine({
    currentStep: "aguardando_conta",
    conversationalFlowEnabled: true,
    customerOverride: null,
  });
  assertEquals(r, { engine: "sys", step: "aguardando_conta" });
});

Deno.test("routeEngine preserves cadastro step when consultant flag is off", () => {
  const r = routeEngine({
    currentStep: "aguardando_doc_frente",
    conversationalFlowEnabled: false,
    customerOverride: null,
  });
  assertEquals(r, { engine: "sys", step: "aguardando_doc_frente" });
});

Deno.test("routeEngine preserves cadastro step when customer override is false", () => {
  const r = routeEngine({
    currentStep: "aguardando_otp",
    conversationalFlowEnabled: true,
    customerOverride: false,
  });
  assertEquals(r, { engine: "sys", step: "aguardando_otp" });
});

Deno.test("routeEngine preserves cadastro step even when stored with flow: prefix", () => {
  // Pathological case: someone wrote a cadastro step with the flow:
  // prefix. routeEngine should still recognise it as cadastro and pin
  // engine=sys.
  const r = routeEngine({
    currentStep: "flow:aguardando_conta",
    conversationalFlowEnabled: true,
    customerOverride: null,
  });
  assertEquals(r, { engine: "sys", step: "aguardando_conta" });
});

Deno.test("routeEngine routes flow: prefix to flow when flag is on", () => {
  const r = routeEngine({
    currentStep: "flow:passo_abertura",
    conversationalFlowEnabled: true,
    customerOverride: null,
  });
  assertEquals(r, { engine: "flow", step: "passo_abertura" });
});

Deno.test("routeEngine resets to welcome when flow step but consultant flag off", () => {
  const r = routeEngine({
    currentStep: "flow:passo_abertura",
    conversationalFlowEnabled: false,
    customerOverride: null,
  });
  assertEquals(r, { engine: "sys", step: "welcome" });
});

Deno.test("routeEngine resets to welcome when flow step but customer override false", () => {
  const r = routeEngine({
    currentStep: "flow:passo_abertura",
    conversationalFlowEnabled: true,
    customerOverride: false,
  });
  assertEquals(r, { engine: "sys", step: "welcome" });
});

Deno.test("routeEngine treats UUID without prefix as flow step", () => {
  const r = routeEngine({
    currentStep: "12345678-1234-1234-1234-123456789abc",
    conversationalFlowEnabled: true,
    customerOverride: null,
  });
  assertEquals(r.engine, "flow");
});

Deno.test("routeEngine returns sys/null for fresh customer", () => {
  const r = routeEngine({
    currentStep: null,
    conversationalFlowEnabled: true,
    customerOverride: null,
  });
  assertEquals(r, { engine: "sys", step: null });
});

Deno.test("routeEngine routes welcome step to sys regardless of flag", () => {
  for (const flag of [true, false]) {
    const r = routeEngine({
      currentStep: "welcome",
      conversationalFlowEnabled: flag,
      customerOverride: null,
    });
    assertEquals(r, { engine: "sys", step: "welcome" });
  }
});

// ─── routeEngine: PBT (cláusula 2.12) ──────────────────────────────────
//
// Validates: Requirements 2.12
//
// Para qualquer (currentStep ∈ CADASTRO_STEPS, flag, override), o step
// retornado por routeEngine é exatamente igual ao step de entrada e o
// engine é 'sys'. Garante que toggling a flag mid-conversa nunca derruba
// um cliente em cadastro.

Deno.test("PBT: routeEngine preserves CADASTRO step under any flag transition", () => {
  const cadastroSteps = [...CADASTRO_STEPS];
  fc.assert(
    fc.property(
      fc.constantFrom(...cadastroSteps),
      fc.boolean(),
      fc.option(fc.boolean(), { nil: null }),
      (step, consultantFlag, override) => {
        const r = routeEngine({
          currentStep: step,
          conversationalFlowEnabled: consultantFlag,
          customerOverride: override,
        });
        return r.engine === "sys" && r.step === step;
      },
    ),
    { numRuns: 200 },
  );
});

Deno.test("PBT: routeEngine preserves CADASTRO step even when stored with flow: prefix", () => {
  const cadastroSteps = [...CADASTRO_STEPS];
  fc.assert(
    fc.property(
      fc.constantFrom(...cadastroSteps),
      fc.boolean(),
      fc.option(fc.boolean(), { nil: null }),
      (step, consultantFlag, override) => {
        const r = routeEngine({
          currentStep: `flow:${step}`,
          conversationalFlowEnabled: consultantFlag,
          customerOverride: override,
        });
        return r.engine === "sys" && r.step === step;
      },
    ),
    { numRuns: 200 },
  );
});

// ─── matchTransition: unit (cláusula 2.15) ─────────────────────────────

const cadastroBtn: FlowTransition = {
  trigger_phrases: ["btn_cadastro", "Quero cadastro"],
  goto_step_id: "step-cadastro",
};
const humanoSpecial: FlowTransition = {
  trigger_phrases: [],
  goto_special: "humano",
};
const textOnly: FlowTransition = {
  trigger_phrases: ["preço", "quanto custa"],
  goto_step_id: "step-preco",
};
const intentOnly: FlowTransition = {
  trigger_intent: "interesse_alto",
  goto_step_id: "step-fechamento",
};

Deno.test("matchTransition: buttonId matches trigger_phrase (case-insensitive trim)", () => {
  const t = matchTransition({
    transitions: [cadastroBtn, textOnly],
    buttonId: "  BTN_CADASTRO  ",
    messageText: "preço",
  });
  assertEquals(t?.goto_step_id, "step-cadastro");
});

Deno.test("matchTransition: buttonId matches goto_special", () => {
  const t = matchTransition({
    transitions: [textOnly, humanoSpecial],
    buttonId: "humano",
    messageText: "",
  });
  assertEquals(t?.goto_special, "humano");
});

Deno.test("matchTransition: buttonId beats messageText when both could match", () => {
  // messageText "preço" would match `textOnly`, but buttonId points at
  // a different transition — buttonId wins.
  const t = matchTransition({
    transitions: [textOnly, cadastroBtn],
    buttonId: "btn_cadastro",
    messageText: "quanto custa o preço",
  });
  assertEquals(t?.goto_step_id, "step-cadastro");
});

Deno.test("matchTransition: falls back to messageText when buttonId is empty", () => {
  const t = matchTransition({
    transitions: [textOnly, cadastroBtn],
    buttonId: "",
    messageText: "qual o preço?",
  });
  assertEquals(t?.goto_step_id, "step-preco");
});

Deno.test("matchTransition: falls back to messageText when buttonId doesn't match anything", () => {
  const t = matchTransition({
    transitions: [textOnly, cadastroBtn],
    buttonId: "btn_inexistente",
    messageText: "quero saber o preço",
  });
  assertEquals(t?.goto_step_id, "step-preco");
});

Deno.test("matchTransition: intent match still works as middle priority", () => {
  const t = matchTransition({
    transitions: [textOnly, intentOnly],
    buttonId: "",
    messageText: "",
    intents: ["interesse_alto"],
  });
  assertEquals(t?.goto_step_id, "step-fechamento");
});

Deno.test("matchTransition: returns null when nothing matches", () => {
  const t = matchTransition({
    transitions: [textOnly, intentOnly],
    buttonId: "",
    messageText: "olá",
    intents: ["intent_qualquer"],
  });
  assertEquals(t, null);
});

Deno.test("matchTransition: returns null for empty / nullish transitions", () => {
  assertEquals(
    matchTransition({ transitions: null, buttonId: "x", messageText: "y" }),
    null,
  );
  assertEquals(
    matchTransition({ transitions: [], buttonId: "x", messageText: "y" }),
    null,
  );
});

// ─── Regressão: botões diferenciados por sufixo com PONTOS ─────────────
// Cenário real (fluxo M): três botões com o mesmo rótulo base "beneficio"
// distinguidos por 1, 2 ou 3 pontos no final. Cliente ou clica no botão
// (Evolution devolve o title/id como texto inbound) ou digita "1"/"2"/"3".
// _norm preserva a pontuação e o fallback (d) ranqueia pela phrase mais
// longa — os três casos precisam ir para transições distintas SEM colisão.
const btnBeneficio1 = {
  trigger_phrases: ["beneficio ."],
  goto_step_id: "step-beneficio-1",
};
const btnBeneficio2 = {
  trigger_phrases: ["beneficio .."],
  goto_step_id: "step-beneficio-2",
};
const btnBeneficio3 = {
  trigger_phrases: ["beneficio ..."],
  goto_step_id: "step-beneficio-3",
};
const beneficioTransitions = [btnBeneficio1, btnBeneficio2, btnBeneficio3];
const beneficioButtons = [
  { id: "beneficio .", title: "Benefício ." },
  { id: "beneficio ..", title: "Benefício .." },
  { id: "beneficio ...", title: "Benefício ..." },
];

Deno.test("matchTransition: dot-suffix buttons — click #1 (buttonId path)", () => {
  const t = matchTransition({
    transitions: beneficioTransitions,
    buttonId: "beneficio .",
    messageText: "Benefício .",
    buttons: beneficioButtons,
  });
  assertEquals(t?.goto_step_id, "step-beneficio-1");
});

Deno.test("matchTransition: dot-suffix buttons — click #2 (buttonId path)", () => {
  const t = matchTransition({
    transitions: beneficioTransitions,
    buttonId: "beneficio ..",
    messageText: "Benefício ..",
    buttons: beneficioButtons,
  });
  assertEquals(t?.goto_step_id, "step-beneficio-2");
});

Deno.test("matchTransition: dot-suffix buttons — click #3 (buttonId path)", () => {
  const t = matchTransition({
    transitions: beneficioTransitions,
    buttonId: "beneficio ...",
    messageText: "Benefício ...",
    buttons: beneficioButtons,
  });
  assertEquals(t?.goto_step_id, "step-beneficio-3");
});

Deno.test("matchTransition: dot-suffix buttons — text '1' resolves button #1", () => {
  const t = matchTransition({
    transitions: beneficioTransitions,
    buttonId: "",
    messageText: "1",
    buttons: beneficioButtons,
  });
  assertEquals(t?.goto_step_id, "step-beneficio-1");
});

Deno.test("matchTransition: dot-suffix buttons — text '2' resolves button #2", () => {
  const t = matchTransition({
    transitions: beneficioTransitions,
    buttonId: "",
    messageText: "2",
    buttons: beneficioButtons,
  });
  assertEquals(t?.goto_step_id, "step-beneficio-2");
});

Deno.test("matchTransition: dot-suffix buttons — text '3' resolves button #3", () => {
  const t = matchTransition({
    transitions: beneficioTransitions,
    buttonId: "",
    messageText: "3",
    buttons: beneficioButtons,
  });
  assertEquals(t?.goto_step_id, "step-beneficio-3");
});

Deno.test("matchTransition: dot-suffix buttons — free text longest-match wins ('beneficio ...' beats '..'/'.' )", () => {
  const t = matchTransition({
    transitions: beneficioTransitions,
    buttonId: "",
    messageText: "beneficio ...",
    buttons: [],
  });
  assertEquals(t?.goto_step_id, "step-beneficio-3");
});

Deno.test("matchTransition: dot-suffix buttons — free text '..' picks 2 (not 1 nor 3)", () => {
  const t = matchTransition({
    transitions: beneficioTransitions,
    buttonId: "",
    messageText: "beneficio ..",
    buttons: [],
  });
  assertEquals(t?.goto_step_id, "step-beneficio-2");
});

Deno.test("matchTransition: buttonId 'menu' / 'cadastro' / 'humano' / 'repeat' route via goto_special", () => {
  for (const sp of SPECIAL_GOTO_VALUES) {
    const t = matchTransition({
      transitions: [{ goto_special: sp }],
      buttonId: sp,
      messageText: "",
    });
    assertEquals(t?.goto_special, sp);
  }
});

Deno.test("matchTransition: buttonId only routes via goto_special when value is recognised", () => {
  // 'desconhecido' is NOT in SPECIAL_GOTO_VALUES; should not match even
  // though goto_special equals buttonId.
  const t = matchTransition({
    transitions: [{ goto_special: "desconhecido" }],
    buttonId: "desconhecido",
    messageText: "",
  });
  assertEquals(t, null);
});

// ─── matchTransition: longest-match no fallback de texto (anti-ambiguidade) ─

Deno.test("matchTransition: text fallback prefers the LONGEST trigger_phrase", () => {
  // Cliente digita "quero ver minha conta de luz 2". Duas transitions casam:
  // "conta" (curta) e "conta de luz 2" (mais específica). A mais longa ganha.
  const tShort: FlowTransition = {
    trigger_phrases: ["conta"],
    goto_step_id: "step-conta-1",
  };
  const tLong: FlowTransition = {
    trigger_phrases: ["conta de luz 2"],
    goto_step_id: "step-conta-2",
  };
  const t = matchTransition({
    transitions: [tShort, tLong],
    buttonId: "",
    messageText: "quero ver minha conta de luz 2",
  });
  assertEquals(t?.goto_step_id, "step-conta-2");
});

Deno.test("matchTransition: text fallback uses word boundary for short tokens", () => {
  // "conta" não deve casar dentro de "encontrar" (palavra parcial).
  const t = matchTransition({
    transitions: [{ trigger_phrases: ["conta"], goto_step_id: "X" }],
    buttonId: "",
    messageText: "vou encontrar amanhã",
  });
  assertEquals(t, null);
});

Deno.test("matchTransition: text fallback ignores 'sim'/'nao'/'ok' as standalone triggers", () => {
  // Stopwords curtíssimas casariam em quase toda mensagem — proibidas.
  const t = matchTransition({
    transitions: [{ trigger_phrases: ["sim"], goto_step_id: "X" }],
    buttonId: "",
    messageText: "sim quero",
  });
  assertEquals(t, null);
});

Deno.test("matchTransition: text fallback — tie-break prefers transition with goto_step_id", () => {
  // Duas phrases de mesmo tamanho casam: a transition com goto_step_id real
  // vence a que tem só goto_special. Mantém o desenho explícito do super admin.
  const tSpecial: FlowTransition = {
    trigger_phrases: ["cadastrar"],
    goto_special: "humano",
  };
  const tStep: FlowTransition = {
    trigger_phrases: ["cadastrar"],
    goto_step_id: "step-cadastro",
  };
  const t = matchTransition({
    transitions: [tSpecial, tStep],
    buttonId: "",
    messageText: "quero cadastrar agora",
  });
  assertEquals(t?.goto_step_id, "step-cadastro");
});



// ─── matchTransition: PBT (cláusula 2.15) ──────────────────────────────
//
// Validates: Requirements 2.15
//
// Quando há uma transição cuja `trigger_phrases` contém o `buttonId`,
// matchTransition retorna ESSA transição (e não a que casa apenas com
// messageText). Garante que a prioridade de buttonId é estável para
// qualquer arranjo de phrases/text.

Deno.test("PBT: when buttonId is in trigger_phrases, matchTransition picks that transition over messageText-only matches", () => {
  fc.assert(
    fc.property(
      // gera buttonId "BTN_x" e messageText distinto
      fc.string({ minLength: 1, maxLength: 12 }).filter((s) => /^[A-Za-z0-9_]+$/.test(s)),
      fc.string({ minLength: 1, maxLength: 12 }).filter((s) => /^[a-z]+$/.test(s)),
      (rawBtn, rawText) => {
        const btnId = `BTN_${rawBtn}`;
        const textPhrase = `txt_${rawText}`;
        if (btnId.toLowerCase() === textPhrase.toLowerCase()) return true; // skip rare collision

        const buttonTrans: FlowTransition = {
          trigger_phrases: [btnId],
          goto_step_id: "BUTTON",
        };
        const textTrans: FlowTransition = {
          trigger_phrases: [textPhrase],
          goto_step_id: "TEXT",
        };

        const t = matchTransition({
          transitions: [textTrans, buttonTrans], // intentionally text first
          buttonId: btnId,
          messageText: textPhrase,
        });
        return t?.goto_step_id === "BUTTON";
      },
    ),
    { numRuns: 200 },
  );
});

// ─── Sanity: CADASTRO_STEPS keeps the canonical entries ────────────────

Deno.test("CADASTRO_STEPS contains the canonical pipeline entries", () => {
  for (
    const expected of [
      "aguardando_conta",
      "ask_cpf",
      "aguardando_doc_frente",
      "aguardando_doc_verso",
      "aguardando_otp",
      "aguardando_facial",
      "complete",
    ]
  ) {
    assert(CADASTRO_STEPS.has(expected), `missing ${expected} from CADASTRO_STEPS`);
  }
});

Deno.test("resolveFlowButtonFromText: título do botão a3 → more_benefits", () => {
  const buttons = [
    { id: "more_benefits", title: "Saber mais benefício" },
    { id: "activate", title: "Quero ativar" },
    { id: "human", title: "Falar com humano" },
  ];
  assertEquals(resolveFlowButtonFromText("Saber mais benefício", buttons), "more_benefits");
  assertEquals(resolveFlowButtonFromText("1", buttons), "more_benefits");
});
