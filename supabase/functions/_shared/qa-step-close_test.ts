import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildQaStepClose,
  stripShortcutBoilerplate,
  withQaStepClose,
} from "./qa-step-close.ts";

Deno.test("buildQaStepClose — etapas Sofia A", () => {
  assertEquals(
    buildQaStepClose("a2_text_ask_bill_value", { leadName: "Maria" }),
    "Maria, me passa o *valor* da sua conta de luz que eu calculo sua *economia*. ⚡🌱",
  );
  assertEquals(
    buildQaStepClose("a6_ask_bill_photo", { leadName: "João" }),
    "João, quando quiser continuar a ativação, é só me dizer *pode seguir*. 😊⚡",
  );
  assertEquals(
    buildQaStepClose("a8_ask_email"),
    "me passa seu *e-mail* que seguimos com a ativação. 📧⚡",
  );
});

Deno.test("stripShortcutBoilerplate remove fechamento genérico legado", () => {
  const raw = "Corpo da resposta.\n\nSe estiver tudo certo, é só me dizer *pode seguir* que a gente continua seu cadastro. 😊⚡🌱";
  assertEquals(stripShortcutBoilerplate(raw), "Corpo da resposta.");
});

Deno.test("withQaStepClose anexa fechamento da etapa", () => {
  const out = withQaStepClose("A *iGreen* é regulamentada.", "a3_explain_with_buttons", { leadName: "Ana" });
  assertEquals(out.includes("escolhe uma opção acima"), true);
  assertEquals(out.includes("pode seguir que a gente continua seu cadastro"), false);
});

Deno.test("fechamento do passo substitui o soft close genérico", () => {
  const out = withQaStepClose(
    "Funciona sem obra em casa.\n\nSe tiver qualquer outra dúvida, é só me chamar.",
    "a2_text_ask_bill_value",
    { leadName: "Fernando" },
  );
  assertEquals(out.includes("qualquer outra dúvida"), false);
  assertEquals(out.includes("me passa o *valor* da sua conta de luz"), true);
});

Deno.test("'quando quiser' no meio do texto não bloqueia o fechamento", () => {
  const out = withQaStepClose(
    "Você cancela quando quiser, sem multa.\nO desconto continua igual.",
    "a8_ask_email",
  );
  assertEquals(out.includes("me passa seu *e-mail*"), true);
});

Deno.test("pergunta no fim é preservada sem fechamento extra", () => {
  const out = withQaStepClose("Quer que eu te mande o contrato antes?", "a2_text_ask_bill_value");
  assertEquals(out, "Quer que eu te mande o contrato antes?");
});

Deno.test("passo custom reconduz com a pergunta do próprio passo", () => {
  const out = withQaStepClose("Somos regulamentados pela ANEEL.", "d_como_funciona", {
    stepQuestion: "Me conta: qual o valor médio da sua conta de luz?",
  });
  assertEquals(out.includes("📋 Voltando: Me conta: qual o valor médio da sua conta de luz?"), true);
});
