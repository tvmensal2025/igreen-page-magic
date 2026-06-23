import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { classifyCadastroInput } from "./cadastro-input-classifier.ts";

function mk(over: Partial<Parameters<typeof classifyCadastroInput>[0]>) {
  return classifyCadastroInput({
    stepBefore: over.stepBefore ?? "ask_email",
    text: over.text ?? null,
    isButton: over.isButton ?? false,
    hasImage: over.hasImage ?? false,
    hasDocument: over.hasDocument ?? false,
    hasAudio: over.hasAudio ?? false,
  });
}

Deno.test("mídia, botão e áudio → expected", () => {
  assertEquals(mk({ stepBefore: "aguardando_conta", hasImage: true }), "expected");
  assertEquals(mk({ stepBefore: "ask_email", hasDocument: true }), "expected");
  assertEquals(mk({ stepBefore: "ask_email", hasAudio: true, text: "qualquer coisa" }), "expected");
  assertEquals(mk({ stepBefore: "confirmando_dados_conta", isButton: true }), "expected");
});

Deno.test("texto vazio/curto → expected", () => {
  assertEquals(mk({ text: "" }), "expected");
  assertEquals(mk({ text: "ok" }), "expected");
  assertEquals(mk({ text: "sim senhor" }), "expected");
  assertEquals(mk({ stepBefore: "confirmando_dados_conta", text: "sim, está certo" }), "expected");
});

Deno.test("ask_email: e-mail válido → expected", () => {
  assertEquals(mk({ stepBefore: "ask_email", text: "meuemail@gmail.com" }), "expected");
  assertEquals(
    mk({ stepBefore: "ask_email", text: "meu email é joao arroba gmail" }),
    "expected",
  );
});

Deno.test("ask_email: pergunta livre → freeform_question", () => {
  assertEquals(
    mk({ stepBefore: "ask_email", text: "quanto vou economizar por mês com a iGreen?" }),
    "freeform_question",
  );
});

Deno.test("confirmando_dados_conta: SIM/NÃO → expected", () => {
  assertEquals(mk({ stepBefore: "confirmando_dados_conta", text: "sim" }), "expected");
  assertEquals(mk({ stepBefore: "confirmando_dados_conta", text: "Sim, está certo!" }), "expected");
  assertEquals(mk({ stepBefore: "confirmando_dados_conta", text: "editar" }), "expected");
});

Deno.test("confirmando_dados_conta: pergunta livre → freeform_question", () => {
  assertEquals(
    mk({ stepBefore: "confirmando_dados_conta", text: "como funciona a energia solar?" }),
    "freeform_question",
  );
});

Deno.test("ask_phone_confirm: número → expected", () => {
  assertEquals(mk({ stepBefore: "ask_phone_confirm", text: "11999999999" }), "expected");
  assertEquals(mk({ stepBefore: "ask_phone_confirm", text: "esse whats mesmo, confirma" }), "expected");
});

Deno.test("aguardando_conta: foto → expected (mídia)", () => {
  assertEquals(mk({ stepBefore: "aguardando_conta", hasImage: true }), "expected");
});

Deno.test("aguardando_conta: pergunta livre longa → freeform_question", () => {
  assertEquals(
    mk({ stepBefore: "aguardando_conta", text: "vocês cobram alguma taxa pra eu participar?" }),
    "freeform_question",
  );
});

Deno.test("texto longo neutro sem sinal de pergunta → expected (padrão seguro)", () => {
  assertEquals(
    mk({ stepBefore: "ask_email", text: "esse é o e-mail que uso no trabalho todos os dias" }),
    "expected",
  );
});
