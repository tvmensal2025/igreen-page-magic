// Testes unitários da peça N4 — Escritor (pt-BR).
//
// Spec: `.kiro/specs/cerebro-ia/` — Tarefas 5.1 e 5.4.
//   - 5.1: escrever a mensagem do passo reusando RAG, memória e o gateway
//          `chatCascade`.
//   - 5.4: PROVA de que o Escritor SÓ escreve o texto do passo recebido e NUNCA
//          decide nem altera o passo (Requisito 8.1).
//
// Valida: Requisito 8.1 (não decide passo), 8.2 (mensagem do passo recebido),
// 8.3 (reúso de gateway/RAG/memória) e 16.5 (controle de custo / fail-open).
//
// COMO MOCKAMOS A IA (sem rede real):
//   O Escritor usa `chatCascade` (vendedora/gateway.ts), que por baixo chama
//   `fetch` no endpoint do gateway e exige a env `LOVABLE_API_KEY`. Em vez de
//   alterar a assinatura pública do Escritor para injetar um cliente falso,
//   mockamos no nível mais baixo e estável:
//     - CAMINHO NORMAL: definimos `LOVABLE_API_KEY` e trocamos `globalThis.fetch`
//       por um stub que devolve uma resposta de chat válida. Assim exercitamos o
//       caminho em que a IA responde, mas SEM tráfego real.
//     - FAIL-OPEN: removemos `LOVABLE_API_KEY` (o gateway lança na hora, sem
//       `fetch`) OU fazemos o stub devolver 400/erro. Nos dois casos o Escritor
//       deve cair no texto seguro determinístico do PRÓPRIO passo.
//   Tudo determinístico e offline.
//
// Rodar:
//   deno test supabase/functions/_shared/cerebro/__tests__/escritor.test.ts

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { escreverMensagem } from "../escritor.ts";
import type {
  BotFlowStep,
  EntradaEscritor,
  EstadoCerebro,
  MemoriaEmCamadas,
  ResultadoEntendimento,
} from "../tipos.ts";

// ─── Mock do gateway de IA via fetch (sem rede real) ─────────────────────────

const fetchOriginal = globalThis.fetch;

/** Monta uma resposta no formato que o gateway de chat espera consumir. */
function respostaChat(conteudo: string, status = 200): Response {
  const corpo = JSON.stringify({
    choices: [{ message: { content: conteudo } }],
  });
  return new Response(corpo, {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Executa `fn` com o gateway mockado: define a chave de IA e troca o `fetch`
 * global pelo stub informado. Restaura tudo ao final (mesmo em erro), para não
 * vazar estado entre testes.
 */
async function comGatewayMock(
  stub: (input: unknown, init?: unknown) => Promise<Response>,
  fn: () => Promise<void>,
): Promise<void> {
  Deno.env.set("LOVABLE_API_KEY", "chave-de-teste");
  globalThis.fetch = stub as typeof globalThis.fetch;
  try {
    await fn();
  } finally {
    globalThis.fetch = fetchOriginal;
    Deno.env.delete("LOVABLE_API_KEY");
  }
}

/**
 * Executa `fn` com o gateway INDISPONÍVEL (sem chave): qualquer chamada de IA
 * lança imediatamente, forçando o caminho fail-open do Escritor. Não troca o
 * `fetch` — sem chave, o gateway nem chega a chamar a rede.
 */
async function semGateway(fn: () => Promise<void>): Promise<void> {
  Deno.env.delete("LOVABLE_API_KEY");
  await fn();
}

// ─── Fixtures mínimos ────────────────────────────────────────────────────────

function passoTexto(texto: string): BotFlowStep {
  return {
    id: "step-1",
    flowId: "flow-1",
    stepKey: "boas_vindas",
    stepType: "text_message",
    position: 0,
    messageText: texto,
    persuasiveText: null,
    choiceOptions: null,
    preferredChoiceKind: null,
    captures: [],
    transitions: [],
    fallback: { mode: "repeat" },
    waitFor: "reply",
    waitSeconds: 0,
    pipelineKind: null,
    slotKey: null,
    conditionExpr: null,
    reachableStepIds: [],
  };
}

function memoriaVazia(): MemoriaEmCamadas {
  return { sessao: null, perfil: {}, operacional: {} };
}

function estadoMinimo(): EstadoCerebro {
  return {
    snapshot: {
      customerId: "c1",
      consultantId: "k1",
      flowId: "flow-1",
      currentStepId: "step-1",
      status: "running",
      pauseReason: null,
      retries: 0,
      aiQuestionsThisStep: 0,
      enteredStepAt: new Date().toISOString(),
      expiresAt: null,
      lastInboundAt: null,
      lastOutboundAt: null,
      lastOutboundContentHash: null,
      customer: {
        name: "Maria",
        electricityBillValue: 350,
        documentUploaded: false,
        otpValidatedAt: null,
        phoneWhatsapp: "5511999999999",
      },
    },
    memoria: memoriaVazia(),
  };
}

const entendimentoNeutro: ResultadoEntendimento = {
  intencao: "demonstrar_interesse",
  dados: {},
};

function entrada(passo: BotFlowStep | null): EntradaEscritor {
  return {
    passoAtual: passo,
    entendimento: entendimentoNeutro,
    estado: estadoMinimo(),
    ragText: "",
    memoria: memoriaVazia(),
    persona: null,
  };
}

// ─── CAMINHO NORMAL — gateway responde (Req 8.2, 8.3) ────────────────────────

Deno.test("Escritor (normal): devolve EXATAMENTE o texto que a IA escreveu para o passo", async () => {
  const textoIA = "Oi, Maria! Vi que sua conta é alta — dá pra economizar bastante. 😊";
  await comGatewayMock(
    () => Promise.resolve(respostaChat(textoIA)),
    async () => {
      const passo = passoTexto("texto base do passo (não deve ser usado quando a IA responde)");
      const r = await escreverMensagem(entrada(passo));
      // O Escritor só VERBALIZA: devolve o texto produzido pela IA para o passo.
      assertEquals(r.texto, textoIA);
    },
  );
});

Deno.test("Escritor (normal): saída é APENAS { texto } — nenhuma decisão de passo/estado (Req 8.1)", async () => {
  await comGatewayMock(
    () => Promise.resolve(respostaChat("Mensagem gerada pela IA.")),
    async () => {
      const r = await escreverMensagem(entrada(passoTexto("base")));
      // O contrato de saída expõe SÓ `texto`. Nada de passo, próximo passo,
      // transição, estado ou ação — o Escritor não decide nada disso.
      assertEquals(Object.keys(r), ["texto"]);
      assert(typeof r.texto === "string");
    },
  );
});

Deno.test("Escritor (normal): NÃO altera o passo recebido (objeto de entrada permanece intacto, Req 8.1)", async () => {
  await comGatewayMock(
    () => Promise.resolve(respostaChat("qualquer texto da IA")),
    async () => {
      const passo = passoTexto("texto base");
      const antes = structuredClone(passo);
      await escreverMensagem(entrada(passo));
      // O passo entra e sai idêntico: o Escritor não muta nem reescolhe o passo.
      assertEquals(passo, antes);
    },
  );
});

Deno.test("Escritor (normal): resposta vazia da IA cai para o texto seguro do passo (Req 16.5)", async () => {
  await comGatewayMock(
    () => Promise.resolve(respostaChat("   ")), // IA devolve em branco
    async () => {
      const passo = passoTexto("Olá! Posso te ajudar a economizar na conta de luz.");
      const r = await escreverMensagem(entrada(passo));
      // Sem texto útil da IA, usa o texto determinístico do PRÓPRIO passo.
      assertEquals(r.texto, "Olá! Posso te ajudar a economizar na conta de luz.");
    },
  );
});

// ─── FAIL-OPEN — gateway falha → texto seguro do passo (Req 16.5) ────────────

Deno.test("Escritor (fail-open sem chave): reusa o texto do passo recebido (Req 8.2, 16.5)", async () => {
  await semGateway(async () => {
    const passo = passoTexto("Olá! Sou da iGreen Energy e posso te ajudar com a conta de luz.");
    const r = await escreverMensagem(entrada(passo));
    // Sem IA, devolve o texto seguro do PRÓPRIO passo decidido — nunca o de
    // outro passo (o Escritor não escolhe passo, Req 8.1).
    assertEquals(r.texto, "Olá! Sou da iGreen Energy e posso te ajudar com a conta de luz.");
  });
});

Deno.test("Escritor (fail-open por erro do gateway): cai para o texto seguro do passo", async () => {
  await comGatewayMock(
    // 400 não é retentável; o gateway lança e o Escritor faz fail-open.
    () => Promise.resolve(respostaChat("erro", 400)),
    async () => {
      const passo = passoTexto("Texto seguro do passo atual.");
      const r = await escreverMensagem(entrada(passo));
      assertEquals(r.texto, "Texto seguro do passo atual.");
    },
  );
});

Deno.test("Escritor (fail-open): prefere persuasiveText quando o passo tem os dois textos", async () => {
  await semGateway(async () => {
    const passo = passoTexto("messageText do passo");
    passo.persuasiveText = "persuasiveText do passo";
    const r = await escreverMensagem(entrada(passo));
    // O texto seguro do passo usa persuasiveText ?? messageText.
    assertEquals(r.texto, "persuasiveText do passo");
  });
});

// ─── AUSÊNCIA DE PASSO (Req 8.1) ─────────────────────────────────────────────

Deno.test("Escritor (sem passo, fail-open): devolve vazio — handoff fica com N1 (Req 8.1)", async () => {
  await semGateway(async () => {
    const r = await escreverMensagem(entrada(null));
    // Sem passo e sem IA não há texto seguro a reusar: devolve "" e quem decide
    // o handoff é o Orquestrador (N1), não o Escritor.
    assertEquals(r.texto, "");
  });
});

Deno.test("Escritor (sem passo, normal): ainda devolve só { texto }, sem decidir passo (Req 8.1)", async () => {
  await comGatewayMock(
    () => Promise.resolve(respostaChat("Claro! Sobre isso, funciona em qualquer imóvel. 😉")),
    async () => {
      const r = await escreverMensagem(entrada(null));
      // Mesmo sem passo do fluxo, o Escritor só escreve uma resposta útil; não
      // inventa nem anuncia próximo passo. Saída continua sendo apenas { texto }.
      assertEquals(Object.keys(r), ["texto"]);
      assertEquals(r.texto, "Claro! Sobre isso, funciona em qualquer imóvel. 😉");
    },
  );
});

// ─── INVARIANTE 8.1 — saída sempre { texto }, qualquer que seja o passo ──────

Deno.test("INVARIANTE 8.1: para QUALQUER passo, a saída é só { texto } e nunca um passo/estado", async () => {
  // Variamos a natureza do passo (chave, tipo, pipeline). Se o Escritor
  // decidisse passo, alguma dessas variações vazaria um campo de passo/estado
  // na saída. Provamos que a saída é SEMPRE { texto: string } e nada mais.
  await semGateway(async () => {
    const variacoes: BotFlowStep[] = [];

    const p1 = passoTexto("abrir conversa");
    variacoes.push(p1);

    const p2 = passoTexto("pedir a conta de luz");
    p2.stepKey = "pede_conta";
    p2.stepType = "ask_media";
    variacoes.push(p2);

    const p3 = passoTexto("rodar OCR");
    p3.stepKey = "ocr_conta";
    p3.pipelineKind = "ocr" as unknown as BotFlowStep["pipelineKind"];
    variacoes.push(p3);

    const p4 = passoTexto("qualificar interesse");
    p4.stepKey = "qualifica_interesse";
    p4.stepType = "ask_text";
    variacoes.push(p4);

    for (const passo of variacoes) {
      const r = await escreverMensagem(entrada(passo));
      // Única chave: texto. Nenhum campo de decisão de passo escapa.
      assertEquals(Object.keys(r), ["texto"]);
      assert(typeof r.texto === "string");
      // E o texto reusado é o do PRÓPRIO passo, não o de outro.
      assertEquals(r.texto, (passo.persuasiveText ?? passo.messageText ?? "").trim());
    }
  });
});
