// Testes unitários da peça N5 — Guarda de Segurança, Tarefa 6.2 (pt-BR).
//
// Spec: `.kiro/specs/cerebro-ia/` — Tarefa 6.2 (bloqueios detalhados).
//
// Valida: Requisitos 9.1 (inventar info → bloquear), 9.2 (vazar chave/token/
// erro técnico → REMOVER e seguir), 9.3 (pedir dado antes do passo → bloquear e
// reancorar), 9.5 (alterar dado sem regra no fluxo → bloquear) e 9.6 (mensagem
// fora das regras do fluxo → impedir).
//
// São testes PUROS e determinísticos (sem rede, sem IA, sem mocks): exercitam
// diretamente os detectores e o orquestrador de bloqueios `aplicarBloqueios-
// Detalhados`, que são regras em TypeScript.
//
// Rodar:
//   deno test supabase/functions/_shared/cerebro/__tests__/guarda.test.ts

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  aplicarBloqueiosDetalhados,
  detectaAlteracaoSemRegra,
  detectaForaDoFluxo,
  detectaInfoInventada,
  detectaPedidoDeDadoCedo,
  sanitizarVazamentoTecnico,
} from "../guarda.ts";
import type { BotFlowStep, CustomerSnapshot } from "../tipos.ts";

// ─── Fixtures mínimos (só os campos relevantes) ──────────────────────────────

/** Passo do fluxo com captura opcional de um campo (autoriza coletar o dado). */
function passo(
  over: Partial<BotFlowStep> = {},
): BotFlowStep {
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

/** Passo que captura um campo (com validador opcional). */
function passoCaptura(field: string, validator?: "email" | "free"): BotFlowStep {
  return passo({
    stepKey: `pede_${field}`,
    stepType: "ask_text",
    captures: [{ field, enabled: true, validator } as unknown as BotFlowStep["captures"][number]],
  });
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

// ─── 9.2 — Vazamento técnico: REMOVER (sanitizar) e seguir ───────────────────

Deno.test("9.2: remove chave estilo sk- do texto", () => {
  const { texto, removeu } = sanitizarVazamentoTecnico(
    "Pronto! Usei a chave sk-proj-ABCD1234efgh5678IJKL pra configurar.",
  );
  assert(removeu);
  assert(!/sk-proj-/.test(texto), `não deveria conter a chave: ${texto}`);
});

Deno.test("9.2: remove token Bearer e JWT", () => {
  const r1 = sanitizarVazamentoTecnico("Authorization: Bearer abc123def456ghi789");
  assert(r1.removeu);
  assert(!/Bearer\s+abc123/.test(r1.texto));

  const jwt = "eyJhbGciOiJIUzI1Niwill.eyJzdWIiOiIxMjM0Nfile.SflKxwRJSMeKKF2QT4";
  const r2 = sanitizarVazamentoTecnico(`token: ${jwt}`);
  assert(r2.removeu);
  assert(!r2.texto.includes(jwt));
});

Deno.test("9.2: remove URL interna / endpoint de função", () => {
  const { texto, removeu } = sanitizarVazamentoTecnico(
    "Erro ao chamar https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/foo",
  );
  assert(removeu);
  assert(!/supabase\.co/.test(texto));
});

Deno.test("9.2: remove stack trace e nome de erro técnico", () => {
  const { texto, removeu } = sanitizarVazamentoTecnico(
    "Falhou: TypeError: cannot read x\n at handler (guarda.ts:42:7)",
  );
  assert(removeu);
  assert(!/TypeError/.test(texto));
  assert(!/guarda\.ts:42:7/.test(texto));
});

Deno.test("9.2: texto comercial limpo não é alterado", () => {
  const original = "Oi! Que bom te ver por aqui. Posso te contar como funciona?";
  const { texto, removeu } = sanitizarVazamentoTecnico(original);
  assertEquals(removeu, false);
  assertEquals(texto, original);
});

Deno.test("9.2: pelo orquestrador, vazamento é removido mas a mensagem segue aprovada", () => {
  const r = aplicarBloqueiosDetalhados(
    "Tudo certo! (debug: sk-proj-ABCD1234efgh5678IJKL)",
    passo(),
    estado(),
  );
  assert(r.aprovado, "mensagem com conteúdo útil deve seguir após sanitizar");
  assert(!/sk-proj-/.test(r.texto));
});

Deno.test("9.2: se sobrar nada útil após sanitizar, bloqueia com resposta segura", () => {
  const r = aplicarBloqueiosDetalhados(
    "sk-proj-ABCD1234efgh5678IJKL",
    passo(),
    estado(),
  );
  assertEquals(r.aprovado, false);
  assertEquals(r.motivoBloqueio, "vazio_apos_sanitizar");
});

// ─── 9.1 — Inventar informação não confirmada → BLOQUEAR ─────────────────────

Deno.test("9.1: afirmar nome sem nome confirmado bloqueia", () => {
  const motivo = detectaInfoInventada("Seu nome é Carlos, certo?", estado());
  assertEquals(motivo, "info_inventada:nome_nao_confirmado");
});

Deno.test("9.1: afirmar nome divergente do confirmado bloqueia", () => {
  const motivo = detectaInfoInventada(
    "Seu nome é Carlos",
    estado({ name: "Mariana" }),
  );
  assertEquals(motivo, "info_inventada:nome_divergente");
});

Deno.test("9.1: afirmar nome que casa com o confirmado é permitido", () => {
  const motivo = detectaInfoInventada(
    "Seu nome é Mariana, certo?",
    estado({ name: "Mariana Souza" }),
  );
  assertEquals(motivo, null);
});

Deno.test("9.1: afirmar valor da conta sem valor confirmado bloqueia", () => {
  const motivo = detectaInfoInventada("Sua conta de luz é R$ 450 por mês", estado());
  assertEquals(motivo, "info_inventada:valor_nao_confirmado");
});

Deno.test("9.1: perguntar o nome (sem afirmar) não bloqueia", () => {
  assertEquals(detectaInfoInventada("Qual é o seu nome?", estado()), null);
});

Deno.test("9.1: pelo orquestrador, info inventada bloqueia a mensagem", () => {
  const r = aplicarBloqueiosDetalhados("Seu nome é Carlos!", passo(), estado());
  assertEquals(r.aprovado, false);
  assertStringIncludes(r.motivoBloqueio || "", "info_inventada");
});

// ─── 9.3 — Pedir dado antes do passo previsto → BLOQUEAR e reancorar ─────────

Deno.test("9.3: pedir foto da conta fora do passo de coleta bloqueia", () => {
  const motivo = detectaPedidoDeDadoCedo(
    "Me manda a foto da conta de luz, por favor 📷",
    passo({ stepKey: "interesse" }),
  );
  assertEquals(motivo, "pediu_dado_cedo:midia");
});

Deno.test("9.3: pedir foto NO passo de coleta de mídia é permitido", () => {
  const motivo = detectaPedidoDeDadoCedo(
    "Me manda a foto da conta de luz 📷",
    passo({ stepKey: "foto_conta", pipelineKind: "ocr_conta" }),
  );
  assertEquals(motivo, null);
});

Deno.test("9.3: pedir e-mail fora do passo de e-mail bloqueia", () => {
  const motivo = detectaPedidoDeDadoCedo(
    "Qual é o seu e-mail?",
    passo({ stepKey: "interesse" }),
  );
  assertEquals(motivo, "pediu_dado_cedo:email");
});

Deno.test("9.3: pedir e-mail NO passo com validador de e-mail é permitido", () => {
  const motivo = detectaPedidoDeDadoCedo(
    "Me passa seu e-mail pra finalizar?",
    passoCaptura("email", "email"),
  );
  assertEquals(motivo, null);
});

Deno.test("9.3: pelo orquestrador, pedido de dado cedo bloqueia", () => {
  const r = aplicarBloqueiosDetalhados(
    "Manda o RG e a CNH agora",
    passo({ stepKey: "interesse" }),
    estado(),
  );
  assertEquals(r.aprovado, false);
  assertStringIncludes(r.motivoBloqueio || "", "pediu_dado_cedo");
});

// ─── 9.5 — Alterar dado do cliente sem regra no fluxo → BLOQUEAR ─────────────

Deno.test("9.5: anunciar alteração de nome sem passo que capture nome bloqueia", () => {
  const motivo = detectaAlteracaoSemRegra(
    "Pronto, alterei seu nome no cadastro.",
    passo({ stepKey: "interesse", captures: [] }),
  );
  assertEquals(motivo, "alteracao_sem_regra:nome");
});

Deno.test("9.5: alterar nome NO passo que captura nome é permitido", () => {
  const motivo = detectaAlteracaoSemRegra(
    "Certo, atualizei seu nome.",
    passoCaptura("nome"),
  );
  assertEquals(motivo, null);
});

Deno.test("9.5: 'seu e-mail agora é ...' sem passo de e-mail bloqueia", () => {
  const motivo = detectaAlteracaoSemRegra(
    "Seu e-mail agora é outro@x.com",
    passo({ stepKey: "interesse" }),
  );
  assertEquals(motivo, "alteracao_sem_regra:email");
});

Deno.test("9.5: mensagem sem anúncio de alteração não bloqueia", () => {
  assertEquals(
    detectaAlteracaoSemRegra("Qual valor vem na sua conta de luz?", passo()),
    null,
  );
});

Deno.test("9.5: pelo orquestrador, alteração sem regra bloqueia", () => {
  const r = aplicarBloqueiosDetalhados(
    "Mudei seus dados no sistema.",
    passo({ captures: [] }),
    estado(),
  );
  assertEquals(r.aprovado, false);
  assertStringIncludes(r.motivoBloqueio || "", "alteracao_sem_regra");
});

// ─── 9.6 — Mensagem fora das regras do fluxo → IMPEDIR ───────────────────────

Deno.test("9.6: afirmar cadastro concluído fora do passo de finalização bloqueia", () => {
  const motivo = detectaForaDoFluxo(
    "Pronto, seu cadastro finalizado e sua conta ativada!",
    passo({ stepKey: "interesse" }),
  );
  assertEquals(motivo, "fora_do_fluxo:conclusao_indevida");
});

Deno.test("9.6: afirmar conclusão NO passo de finalização é permitido", () => {
  const motivo = detectaForaDoFluxo(
    "Pronto, cadastro concluído com sucesso!",
    passo({ stepKey: "finalizar", pipelineKind: "finalizar_cadastro" }),
  );
  assertEquals(motivo, null);
});

Deno.test("9.6: pelo orquestrador, conclusão indevida bloqueia", () => {
  const r = aplicarBloqueiosDetalhados(
    "Sua migração já está concluída!",
    passo({ stepKey: "interesse" }),
    estado(),
  );
  assertEquals(r.aprovado, false);
  assertStringIncludes(r.motivoBloqueio || "", "fora_do_fluxo");
});

// ─── Caminho feliz: mensagem comercial válida passa ──────────────────────────

Deno.test("mensagem comercial dentro do passo passa sem bloqueio", () => {
  const r = aplicarBloqueiosDetalhados(
    "Oi! Que bom seu interesse. Quer que eu te mostre quanto dá pra economizar?",
    passo({ stepKey: "interesse" }),
    estado(),
  );
  assert(r.aprovado);
  assertEquals(r.motivoBloqueio, undefined);
});

// ─── Tarefa 6.3 — Glossário único (termo técnico → comercial) ────────────────
//
// Valida: Requisitos 9.4 (substituir termo técnico pelo Termo_Comercial na
// saída), 13.1, 13.2, 19.1 (glossário ÚNICO), 19.2 e 19.3. Exercita o filtro
// de texto puro `traduzirComGlossario` (fonte única em `glossario.ts`) e a
// aplicação integrada pelo ponto único `validarMensagem`.

import { traduzirComGlossario } from "../glossario.ts";
import { validarMensagem } from "../guarda.ts";

// 13.2 — substituições mínimas exigidas.
Deno.test("glossário 13.2: substitui termos técnicos básicos", () => {
  assertEquals(traduzirComGlossario("o payload chegou"), "o dados enviados chegou");
  assertEquals(
    traduzirComGlossario("configura o webhook"),
    "configura o integração automática",
  );
  assertEquals(traduzirComGlossario("crie um node novo"), "crie um etapa novo");
  assertEquals(
    traduzirComGlossario("o trigger disparou"),
    "o gatilho automático disparou",
  );
  assertEquals(
    traduzirComGlossario("siga o flow"),
    "siga o fluxo de atendimento",
  );
  assertEquals(traduzirComGlossario("novo lead hoje"), "novo cliente interessado hoje");
  assertEquals(
    traduzirComGlossario("chame o endpoint"),
    "chame o endereço de integração",
  );
  assertEquals(
    traduzirComGlossario("use o token aqui"),
    "use o chave de integração aqui",
  );
  assertEquals(traduzirComGlossario("a api respondeu"), "a integração respondeu");
  assertEquals(traduzirComGlossario("rodar o debug"), "rodar o diagnóstico");
});

Deno.test("glossário 13.2: undefined/null/error viram linguagem comercial", () => {
  assertEquals(traduzirComGlossario("valor undefined"), "valor não informado");
  assertEquals(traduzirComGlossario("ficou null"), "ficou não informado");
  assertEquals(
    traduzirComGlossario("deu error no sistema"),
    "deu não foi possível concluir no sistema",
  );
});

// 19.2 — termos adicionais do glossário único.
Deno.test("glossário 19.2: termos de produto viram linguagem do cliente", () => {
  assertEquals(traduzirComGlossario("qual a intenção?"), "qual a assunto?");
  assertEquals(
    traduzirComGlossario("falar com o agente"),
    "falar com o atendimento inteligente",
  );
  assertEquals(
    traduzirComGlossario("consulta a base de conhecimento"),
    "consulta a base de conteúdo",
  );
  assertEquals(traduzirComGlossario("salvar na memória"), "salvar na histórico útil");
  assertEquals(
    traduzirComGlossario("fazer handoff agora"),
    "fazer transferir para atendente agora",
  );
  assertEquals(
    traduzirComGlossario("usar a ferramenta certa"),
    "usar a ação automática certa",
  );
});

Deno.test("glossário 19.2: 'uso de token' vira 'consumo' (frase antes da palavra)", () => {
  // A frase mais longa tem prioridade: não deve virar "uso de chave de integração".
  assertEquals(
    traduzirComGlossario("o uso de token foi alto"),
    "o consumo foi alto",
  );
});

// Não-quebra de palavras: o termo não pode casar dentro de outra palavra.
Deno.test("glossário: não substitui termo dentro de outra palavra", () => {
  // "api" não pode casar em "apicultura" nem "rapidez".
  assertEquals(traduzirComGlossario("gosto de apicultura"), "gosto de apicultura");
  assertEquals(traduzirComGlossario("com rapidez total"), "com rapidez total");
  // "node" não pode casar em "anode"/"nodejs" parcial; "lead" não em "leaders".
  assertEquals(traduzirComGlossario("os leaders chegaram"), "os leaders chegaram");
  // "memória" não pode casar dentro de palavra maior com acento.
  assertEquals(traduzirComGlossario("memorial antigo"), "memorial antigo");
});

Deno.test("glossário: preserva o restante do texto e a pontuação", () => {
  assertEquals(
    traduzirComGlossario("Pronto! O lead chegou, veja o payload."),
    "Pronto! O cliente interessado chegou, veja o dados enviados.",
  );
});

Deno.test("glossário: preserva caixa (sigla e início de frase)", () => {
  // Sigla toda maiúscula.
  assertEquals(traduzirComGlossario("Use a API"), "Use a INTEGRAÇÃO");
  // Início de frase capitalizado.
  assertEquals(traduzirComGlossario("Lead novo"), "Cliente interessado novo");
});

Deno.test("glossário: texto sem termos técnicos não muda", () => {
  const original = "Oi! Que bom te ver por aqui, vamos começar?";
  assertEquals(traduzirComGlossario(original), original);
});

// 9.4 — aplicação integrada pelo ponto único (saída ao cliente).
Deno.test("9.4: validarMensagem aplica o glossário no texto aprovado", async () => {
  const r = await validarMensagem({
    textoProposto: "Recebemos o seu lead com sucesso, pode continuar.",
    passoAtual: passo({ stepKey: "interesse" }),
    estado: estado(),
  });
  assert(r.aprovado, `deveria aprovar: ${r.motivoBloqueio}`);
  assertStringIncludes(r.textoFinal, "cliente interessado");
  assert(!/\blead\b/i.test(r.textoFinal), `não deveria conter 'lead': ${r.textoFinal}`);
});
