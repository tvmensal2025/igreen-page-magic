// Casos REAIS de produção (conversations, 2026-07-29 a 2026-08-05).
// Positivos: as 20 conversas que eram URA de outra empresa.
// Negativos: mensagens reais de leads e clientes no mesmo período — nenhuma
// pode ser marcada como robô, sob risco de matar lead bom.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { detectAutoResponder, isAutoResponderText } from "./auto-responder-detect.ts";

const ROBOS_REAIS = [
  "A Farnese Seguros agradece seu contato. Como podemos ajudar?",
  "Olá, seja bem vindo(a) a Clinoftalmo Laser Pouso Alegre. ⏰",
  "A Academia Força Máxima agradece seu contato, responderemos em breve",
  "No momento não podemos atende-lo devido ao excesso de demanda",
  "Imobiliária Motta agradece seu contato. Aguarde que já vou lhe atender! 🏡",
  "LS DESPACHANTE agradece seu contato. Como podemos ajudar?",
  "Agradecemos sua mensagem. Não estamos disponíveis no momento",
  "Olá! 👋 Seja muito bem-vindo à Oficina Barbearia! 💈✨",
  "Seja bem vinda ao Salão da Naná e Equipe. Para agendamento responda",
  "Bem vindo(a), RAFAEL-IGREEN, selecione uma das opções abaixo para ser redirecionado",
  "🐾 Olá! Seja bem-vindo ao PET Shop Cães&Cia! 🐶🐱",
  "Casa Nova Imóveis agradece seu contato. Aguarde, responderemos",
  "Olá, seja bem vindo(a)! Sou Leandro Nunes, corretor de imóveis",
  "Seja bem-vindo à recepção da Tadeu Imóveis! Agradecemos o seu contato",
  "Olá! 👋🏼 Seja bem vindo a Prime Investimentos Imobiliários. Eu sou a Kelly",
  "Imobiliária Juliano Oliveira agradece seu contato. Para informações",
  "Pamela Neves Contadora agradece seu contato. Como podemos ajudar?",
  "Olá tudo bem? Janebel Artesanatos Fashion agradece seu contato",
  "Não entendi, escolha uma das opções acima, por favor.",
  "Gostaríamos da sua opinião. De 0 a 10 como você avalia nosso atendimento?",
  "Desculpe, digite uma nota válida, por favor.",
  "Prezado(a), Imobiliária Motta agradece o seu contato. Neste momento não estamos disponíveis",
  "Prime Negócios Imobiliários agradece seu contato 😀 Não estamos disponíveis",
];

const LEADS_REAIS = [
  // CTWA / abertura de lead de verdade
  "Olá! Quero saber mais sobre o desconto na energia e economizar.",
  "Olá bom dia",
  "Oi",
  // respostas do funil
  "150",
  "500",
  "Ativar benefício",
  "✅ Sim, é meu",
  "luizmelojose7@gmail.com",
  "337388",
  "Jose",
  "Cleusa Alves Rodrigues",
  "Cleusa alves Rodrigues 89804317672 data 12/01/67 3976924",
  "12/01/1967",
  "Sou de itapira",
  "Cpfl paulista",
  "É da minha sogra",
  "Vou pensar",
  // cortesia — NÃO pode casar com "agradece seu contato"
  "Obrigado",
  "Obrigada, agradeço demais a atenção",
  "Blz",
  "Depois falamos",
  "Pode almoçar tranquilo",
  "Já baixei",
  "Não estou conseguindo entrar",
  "Qd vem o desconto na conta de luz",
  "Precisa de outra",
  "Já estou acessando?",
];

Deno.test("detecta as 23 auto-respostas corporativas reais", () => {
  for (const t of ROBOS_REAIS) {
    const v = detectAutoResponder(t);
    assertEquals(v.isAutoResponder, true, `deveria detectar robô: ${t}`);
  }
});

Deno.test("NÃO marca lead real como robô (nenhum falso positivo)", () => {
  for (const t of LEADS_REAIS) {
    assertEquals(isAutoResponderText(t), false, `falso positivo em lead: ${t}`);
  }
});

Deno.test("expõe o sinal que casou (para log e auditoria)", () => {
  const v = detectAutoResponder("Imobiliária Motta agradece seu contato. Aguarde que já vou lhe atender!");
  assertEquals(v.isAutoResponder, true);
  if (v.isAutoResponder) assertEquals(v.signal, "agradece_contato");
});

Deno.test("texto curto e vazio nunca é robô", () => {
  assertEquals(isAutoResponderText(""), false);
  assertEquals(isAutoResponderText(null), false);
  assertEquals(isAutoResponderText(undefined), false);
  assertEquals(isAutoResponderText("ok"), false);
  assertEquals(isAutoResponderText("bem vindo"), false); // curto, sem empresa
});
