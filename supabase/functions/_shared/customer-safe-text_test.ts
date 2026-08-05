import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { checkCustomerSafeText, isCustomerSafeText } from "./customer-safe-text.ts";

Deno.test("bloqueia o prompt que vazou para 5 leads em 04/08", () => {
  const vazou =
    "INTRODUÇÃO\nVocê é a assistente virtual da iGreen Energy, especializada em ajudar " +
    "licenciados e potenciais clientes. Responda SEMPRE em português.";
  const v = checkCustomerSafeText(vazou);
  assertEquals(v.safe, false);
  assertEquals(v.reason, "instrucao_de_sistema");
});

Deno.test("bloqueia placeholder que não foi substituído", () => {
  const v = checkCustomerSafeText("Boa pergunta, {{nome}} 😊\n\nNo Reclame Aqui a iGreen aparece bem.");
  assertEquals(v.safe, false);
  assertEquals(v.reason, "placeholder_nao_substituido");
  assertEquals(v.evidence, "{{nome}}");
});

Deno.test("bloqueia estrutura de máquina", () => {
  assertEquals(checkCustomerSafeText('Retorne JSON: {"text": "..."}').safe, false);
  assertEquals(checkCustomerSafeText('{"text": "oi", "confidence": 0.9}').safe, false);
  assertEquals(checkCustomerSafeText("shouldHandoff=true").safe, false);
});

Deno.test("bloqueia outras marcas de instrução", () => {
  assertEquals(checkCustomerSafeText("REGRAS RÍGIDAS:\n1. Responda curto").safe, false);
  assertEquals(checkCustomerSafeText("Sua missão é esclarecer a dúvida do lead").safe, false);
  assertEquals(checkCustomerSafeText("Você é a vendedora da iGreen").safe, false);
});

Deno.test("deixa passar resposta normal ao cliente", () => {
  const boas = [
    "Oi! A iGreen dá desconto na conta de luz sem precisar instalar nada. Quer ver quanto economizaria?",
    "No *Reclame Aqui* a *iGreen* tem boa reputação e responde os chamados.",
    "Seu desconto é de 15% e vem já na próxima fatura.",
    "Consegue me mandar uma foto da conta de luz? Só a primeira página serve.",
    "Não tem fidelidade e você pode cancelar quando quiser.",
    "Perfeito! Com base no valor de R$ 379,00, hoje você economizaria cerca de R$ 56 por mês.",
  ];
  for (const t of boas) {
    assertEquals(isCustomerSafeText(t), true, `não deveria bloquear: ${t}`);
  }
});

Deno.test("cliente falando de assistente ou regras não é bloqueado à toa", () => {
  // O texto avaliado é o NOSSO envio, mas frases parecidas podem ser citadas.
  assertEquals(isCustomerSafeText("Sou eu que falo com você, não é robô 🙂"), true);
  assertEquals(isCustomerSafeText("As regras do programa são simples: sem fidelidade."), true);
  assertEquals(isCustomerSafeText("Você é o titular da conta de luz?"), true);
});

Deno.test("texto vazio é considerado seguro (nada a enviar)", () => {
  assertEquals(isCustomerSafeText(""), true);
  assertEquals(isCustomerSafeText(null), true);
  assertEquals(isCustomerSafeText(undefined), true);
});
