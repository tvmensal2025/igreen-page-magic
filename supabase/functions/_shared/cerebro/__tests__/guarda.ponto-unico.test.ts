// Testes da peça N5 — Guarda de Segurança, Tarefa 6.4 (pt-BR).
//
// Spec: `.kiro/specs/cerebro-ia/` — Tarefa 6.4
//   ("Teste: nenhuma mensagem sai sem passar pela Guarda").
//
// Property 5 do design.md — "Guarda sempre roda": NENHUMA mensagem ao cliente
// sai sem passar por N5 (`validarMensagem`).
//
// Validates: Requirements 9.1, 9.7
//   - 9.7: a Guarda é o PONTO ÚNICO de verificação antes do envio.
//   - 9.1: mensagem que inventa informação (ou é vazia/insegura) é bloqueada e
//     NÃO chega ao cliente.
//
// ESCOPO DESTA TAREFA (importante):
//   A peça N1 (Orquestrador) ainda NÃO existe (Tarefa 7) e o modo sombra/canário
//   (Tarefas 9/14) também não. Por isso, aqui provamos o CONTRATO/INVARIANTE da
//   própria Guarda — o "ponto único" — e não a amarração de produção. Em outras
//   palavras, garantimos que:
//     (a) toda saída passa por `validarMensagem` e devolve `{aprovado, textoFinal}`;
//     (b) texto vazio é SEMPRE bloqueado;
//     (c) quando bloqueado, o texto NÃO é "enviado" (aprovado === false);
//     (d) quando aprovado, `textoFinal` é o texto PÓS-glossário/sanitização.
//
//   A AMARRAÇÃO FINAL — "o N1 nunca envia ao cliente sem antes chamar a Guarda"
//   e "em `dark` nada é enviado" — será testada na Tarefa 7 (orquestrador liga as
//   peças) e nas Tarefas 9/9.4 (modo sombra não envia). Este arquivo é o degrau
//   determinístico que sustenta aquela garantia.
//
// NÃO duplica os testes das Tarefas 6.2/6.3 (detectores de bloqueio e glossário,
// em `guarda.test.ts`). Aqui o foco é a INVARIANTE do ponto único.
//
// Rodar:
//   deno test supabase/functions/_shared/cerebro/__tests__/guarda.ponto-unico.test.ts

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { sanitizarVazamentoTecnico, validarMensagem } from "../guarda.ts";
import { traduzirComGlossario } from "../glossario.ts";
import type { BotFlowStep, CustomerSnapshot } from "../tipos.ts";

// ─── Fixtures mínimos (só os campos relevantes) ──────────────────────────────

/** Passo do fluxo neutro. `over` permite ajustar `stepKey`/`pipelineKind`. */
function passo(over: Partial<BotFlowStep> = {}): BotFlowStep {
  return {
    id: "passo-1",
    flowId: "fluxo-1",
    stepKey: "interesse",
    stepType: "text_message",
    position: 0,
    messageText: "oi",
    persuasiveText: null,
    choiceOptions: null,
    preferredChoiceKind: null,
    captures: [],
    transitions: [],
    fallback: { mode: "safe_text", gotoStepId: null } as unknown as BotFlowStep["fallback"],
    waitFor: "none",
    waitSeconds: 0,
    pipelineKind: null,
    slotKey: null,
    conditionExpr: null,
    reachableStepIds: [],
    ...over,
  };
}

/** Estado do cliente; por padrão sem nome e sem valor de conta confirmados. */
function estado(
  customer: Partial<CustomerSnapshot["customer"]> = {},
): CustomerSnapshot {
  return {
    customerId: "c1",
    consultantId: "k1",
    flowId: "fluxo-1",
    currentStepId: "passo-1",
    status: "running",
    pauseReason: null,
    retries: 0,
    aiQuestionsThisStep: 0,
    enteredStepAt: "2024-01-01T00:00:00Z",
    expiresAt: null,
    lastInboundAt: "2024-01-01T00:00:00Z",
    lastOutboundAt: null,
    lastOutboundContentHash: null,
    customer: {
      name: null,
      electricityBillValue: null,
      documentUploaded: false,
      otpValidatedAt: null,
      phoneWhatsapp: null,
      ...customer,
    },
  };
}

// ─── Porta de saída ÚNICA (modelo do "ponto único", Requisito 9.7) ───────────
//
// Modela o ÚNICO caminho de saída ao cliente: nada é "enviado" sem antes passar
// por `validarMensagem`, e SÓ o que for aprovado é entregue. É um espelho fiel
// do contrato que a N1 (Tarefa 7) deverá respeitar: chamar a Guarda e só
// despachar `textoFinal` quando `aprovado === true`.

interface Enviada {
  textoProposto: string;
  textoFinal: string;
}

/**
 * Tenta enviar `textoProposto` ao cliente PASSANDO pela Guarda. Registra em
 * `enviadas` apenas quando a Guarda aprova. Devolve o resultado da Guarda para
 * inspeção. Esta função é o "gargalo": é impossível registrar um envio sem ter
 * o `aprovado === true` que só a Guarda concede.
 */
async function tentarEnviar(
  textoProposto: string,
  passoAtual: BotFlowStep | null,
  est: CustomerSnapshot,
  enviadas: Enviada[],
): Promise<{ aprovado: boolean; textoFinal: string; motivoBloqueio?: string }> {
  const r = await validarMensagem({ textoProposto, passoAtual, estado: est });
  if (r.aprovado) {
    enviadas.push({ textoProposto, textoFinal: r.textoFinal });
  }
  return r;
}

// Corpus variado de textos propostos pelo Escritor (N4). Mistura mensagens
// comerciais válidas, vazias, inseguras (vazamento/invenção) e fora do fluxo.
// Usado para exercitar a invariante em muitas entradas (estilo "propriedade").
const CORPUS_TEXTOS: string[] = [
  // Válidas (devem ser aprovadas em passo "interesse").
  "Oi! Que bom seu interesse. Quer que eu te mostre quanto dá pra economizar?",
  "Posso te chamar como? Assim eu já adianto seu atendimento.",
  "A gente reduz sua conta de luz sem obra nenhuma. Faz sentido pra você?",
  // Com termo técnico no glossário (deve ser aprovada e traduzida).
  "Esse lead novo chegou agora, vamos seguir?",
  "Recebi o payload aqui, posso continuar com você?",
  // Com vazamento técnico embutido (deve ser sanitizada e seguir).
  "Tudo certo por aqui! (ref interno: sk-proj-ABCD1234efgh5678IJKL) seguimos?",
  // Vazias / só espaço (devem ser bloqueadas).
  "",
  "   ",
  "\n\n\t",
  // Só conteúdo técnico (deve sobrar nada → bloqueada).
  "sk-proj-ABCD1234efgh5678IJKL",
  // Insegura: inventa informação não confirmada (deve ser bloqueada — 9.1).
  "Seu nome é Carlos, certo?",
  "Sua conta de luz é R$ 450 por mês, então o desconto compensa.",
  // Fora do fluxo: afirma conclusão em passo que não finaliza (deve bloquear).
  "Pronto, seu cadastro finalizado e sua conta ativada!",
];

// ─── (a) Contrato: toda saída passa pela Guarda e devolve {aprovado, textoFinal} ─

Deno.test("Property 5 (9.7): validarMensagem SEMPRE devolve o contrato {aprovado:boolean, textoFinal:string}", async () => {
  for (const texto of CORPUS_TEXTOS) {
    const r = await validarMensagem({
      textoProposto: texto,
      passoAtual: passo({ stepKey: "interesse" }),
      estado: estado(),
    });
    assertEquals(
      typeof r.aprovado,
      "boolean",
      `aprovado deve ser boolean para: ${JSON.stringify(texto)}`,
    );
    assertEquals(
      typeof r.textoFinal,
      "string",
      `textoFinal deve ser string para: ${JSON.stringify(texto)}`,
    );
    // Quando bloqueia, deve sempre informar o motivo (rastreabilidade).
    if (!r.aprovado) {
      assert(
        typeof r.motivoBloqueio === "string" && r.motivoBloqueio.length > 0,
        `mensagem bloqueada deve ter motivo: ${JSON.stringify(texto)}`,
      );
    }
  }
});

// ─── (b) Texto vazio é SEMPRE bloqueado ──────────────────────────────────────

Deno.test("Property 5 (9.1/9.7): texto vazio ou só espaços é sempre bloqueado e não é enviado", async () => {
  const enviadas: Enviada[] = [];
  const vazios = ["", " ", "    ", "\n", "\n\n", "\t", "  \n  \t "];
  for (const v of vazios) {
    const r = await tentarEnviar(v, passo({ stepKey: "interesse" }), estado(), enviadas);
    assertEquals(r.aprovado, false, `deveria bloquear vazio: ${JSON.stringify(v)}`);
    assertEquals(r.textoFinal, "");
    assertEquals(r.motivoBloqueio, "texto_vazio");
  }
  // Nenhum texto vazio chegou ao cliente.
  assertEquals(enviadas.length, 0);
});

// ─── (c) Quando bloqueado, NADA é enviado ────────────────────────────────────

Deno.test("Property 5 (9.1/9.7): mensagem bloqueada nunca chega ao cliente (aprovado === false)", async () => {
  const enviadas: Enviada[] = [];
  // Conjunto que DEVE ser bloqueado por motivos distintos (vazio, vazamento
  // total, info inventada, conclusão fora do fluxo).
  const casos: Array<{ texto: string; passoAtual: BotFlowStep; est?: CustomerSnapshot }> = [
    { texto: "", passoAtual: passo({ stepKey: "interesse" }) },
    { texto: "sk-proj-ABCD1234efgh5678IJKL", passoAtual: passo({ stepKey: "interesse" }) },
    { texto: "Seu nome é Carlos!", passoAtual: passo({ stepKey: "interesse" }) },
    {
      texto: "Sua migração já está concluída, conta ativada!",
      passoAtual: passo({ stepKey: "interesse" }),
    },
  ];
  for (const c of casos) {
    const r = await tentarEnviar(c.texto, c.passoAtual, c.est ?? estado(), enviadas);
    assertEquals(
      r.aprovado,
      false,
      `deveria bloquear: ${JSON.stringify(c.texto)} (motivo: ${r.motivoBloqueio})`,
    );
  }
  // O gargalo do "ponto único" garante: nada bloqueado foi registrado como envio.
  assertEquals(enviadas.length, 0, "nenhuma mensagem bloqueada pode ser enviada");
});

// ─── (d) Quando aprovado, textoFinal é o texto PÓS-glossário/sanitização ─────

Deno.test("Property 5 (9.7): texto aprovado sai PÓS-glossário (termo técnico → comercial)", async () => {
  const r = await validarMensagem({
    textoProposto: "Esse lead novo chegou agora, vamos seguir?",
    passoAtual: passo({ stepKey: "interesse" }),
    estado: estado(),
  });
  assert(r.aprovado, `deveria aprovar: ${r.motivoBloqueio}`);
  // O glossário (fonte única) traduz "lead" → "cliente interessado".
  assertStringIncludes(r.textoFinal, "cliente interessado");
  assert(!/\blead\b/i.test(r.textoFinal), `não deveria conter 'lead': ${r.textoFinal}`);
  // É exatamente o que o glossário produz sobre o texto aprovado (sem termos
  // de bloqueio, o texto chega íntegro ao filtro do glossário).
  assertEquals(r.textoFinal, traduzirComGlossario("Esse lead novo chegou agora, vamos seguir?"));
});

Deno.test("Property 5 (9.7): texto aprovado sai PÓS-sanitização (sem vazamento técnico)", async () => {
  const proposto = "Tudo certo por aqui! (ref interno: sk-proj-ABCD1234efgh5678IJKL) seguimos?";
  const r = await validarMensagem({
    textoProposto: proposto,
    passoAtual: passo({ stepKey: "interesse" }),
    estado: estado(),
  });
  assert(r.aprovado, `deveria aprovar após sanitizar: ${r.motivoBloqueio}`);
  // A chave técnica não pode chegar ao cliente.
  assert(!/sk-proj-/.test(r.textoFinal), `não deveria vazar chave: ${r.textoFinal}`);
  // Confirma que houve sanitização efetiva (o texto bruto continha vazamento).
  assert(sanitizarVazamentoTecnico(proposto).removeu);
});

// ─── Invariante central: TODO envio é, exatamente, um textoFinal APROVADO ────

Deno.test("Property 5 (9.1/9.7): tudo que é enviado é o textoFinal aprovado pela Guarda — nada a mais", async () => {
  const enviadas: Enviada[] = [];
  const resultados: Array<{
    texto: string;
    aprovado: boolean;
    textoFinal: string;
  }> = [];

  for (const texto of CORPUS_TEXTOS) {
    const r = await tentarEnviar(texto, passo({ stepKey: "interesse" }), estado(), enviadas);
    resultados.push({ texto, aprovado: r.aprovado, textoFinal: r.textoFinal });
  }

  // 1) Toda mensagem registrada como ENVIADA tem um resultado APROVADO cujo
  //    textoFinal é idêntico ao que foi entregue. (Não há envio "por fora".)
  for (const env of enviadas) {
    const r = resultados.find((x) => x.texto === env.textoProposto);
    assert(r, `envio sem resultado correspondente: ${env.textoProposto}`);
    assert(r!.aprovado, "só pode enviar o que foi aprovado");
    assertEquals(env.textoFinal, r!.textoFinal, "o texto enviado deve ser o textoFinal da Guarda");
  }

  // 2) Toda mensagem APROVADA foi enviada exatamente uma vez (sem perdas).
  const aprovadas = resultados.filter((x) => x.aprovado).map((x) => x.texto);
  assertEquals(
    enviadas.map((e) => e.textoProposto).sort(),
    aprovadas.sort(),
    "o conjunto de enviadas deve ser exatamente o conjunto de aprovadas",
  );

  // 3) Houve pelo menos uma aprovada e uma bloqueada (o corpus exercita os dois
  //    lados — senão a invariante seria vácua).
  assert(aprovadas.length > 0, "o corpus deve ter ao menos uma mensagem válida");
  assert(
    resultados.some((x) => !x.aprovado),
    "o corpus deve ter ao menos uma mensagem bloqueada",
  );
});

// ─── Etapa "rica": a Guarda SEMPRE roda, inclusive o crítico de IA ───────────
//
// Nas etapas ricas (simulação/consideração/finalização) a Guarda também aciona
// o crítico de qualidade por IA (reúso de `vendedora/critico.ts`). Provamos que
// a Guarda continua sendo o ponto único MESMO quando há IA no caminho — com um
// stub de `fetch` (sem rede real), pra não depender de chave nem de custo.

/** Stub de fetch que finge a resposta do gateway de IA com um JSON do crítico. */
function instalarStubCritico(resposta: { aprovado: boolean; problemas?: string[] }): {
  restaurar: () => void;
  chamou: () => boolean;
} {
  const fetchOriginal = globalThis.fetch;
  const keyOriginal = Deno.env.get("LOVABLE_API_KEY");
  let chamado = false;

  // O crítico exige a chave pra montar o header; o stub não usa o valor real.
  Deno.env.set("LOVABLE_API_KEY", "test-key");

  globalThis.fetch = ((_input: string | URL | Request, _init?: RequestInit): Promise<Response> => {
    chamado = true;
    const body = {
      choices: [{ message: { content: JSON.stringify(resposta) } }],
    };
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  }) as typeof globalThis.fetch;

  return {
    chamou: () => chamado,
    restaurar: () => {
      globalThis.fetch = fetchOriginal;
      if (keyOriginal === undefined) Deno.env.delete("LOVABLE_API_KEY");
      else Deno.env.set("LOVABLE_API_KEY", keyOriginal);
    },
  };
}

// Mensagem válida para a etapa "simulacao" (passa na trava estrutural:
// apresenta a faixa 8%–20% + CTA, sem pedir foto/doc/e-mail).
const MSG_SIMULACAO = "Com base no seu valor, o desconto fica entre 8% e 20% por mês. Faz sentido pra você?";

Deno.test("Property 5 (9.7): em etapa rica, a Guarda roda o crítico de IA e aprova quando a IA aprova", async () => {
  const stub = instalarStubCritico({ aprovado: true, problemas: [] });
  try {
    const r = await validarMensagem({
      textoProposto: MSG_SIMULACAO,
      passoAtual: passo({ stepKey: "simulacao" }),
      estado: estado(),
    });
    assert(stub.chamou(), "a Guarda deveria ter chamado o crítico de IA na etapa rica");
    assert(r.aprovado, `deveria aprovar quando a IA aprova: ${r.motivoBloqueio}`);
    assertEquals(typeof r.textoFinal, "string");
  } finally {
    stub.restaurar();
  }
});

Deno.test("Property 5 (9.1/9.7): em etapa rica, a Guarda bloqueia quando a IA reprova — nada é enviado", async () => {
  const enviadas: Enviada[] = [];
  const stub = instalarStubCritico({ aprovado: false, problemas: ["fora do tom"] });
  try {
    const r = await tentarEnviar(
      MSG_SIMULACAO,
      passo({ stepKey: "simulacao" }),
      estado(),
      enviadas,
    );
    assert(stub.chamou(), "a Guarda deveria ter chamado o crítico de IA na etapa rica");
    assertEquals(r.aprovado, false, "deveria bloquear quando a IA reprova");
    assertStringIncludes(r.motivoBloqueio || "", "critico:");
    assertEquals(enviadas.length, 0, "mensagem reprovada pela IA não pode ser enviada");
  } finally {
    stub.restaurar();
  }
});
