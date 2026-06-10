// Testes unitários da peça N2 — Entendimento (pt-BR).
//
// Spec: `.kiro/specs/cerebro-ia/` — Tarefas 3.1 a 3.4.
//   - 3.1: identificar intenção comercial em conjunto pequeno e fechado.
//   - 3.2: extrair dados reusando os extratores existentes.
//   - 3.3: classificar o tipo da objeção reusando a lógica existente.
//   - 3.4: testes unitários consolidados dos quatro casos da peça N2 —
//          interesse, dúvida, objeção e indefinido (Requisito 4.1, 4.3).
//
// Valida: Requisito 4.1 (identificar a intenção a partir de conjunto fechado),
// Requisito 4.3 (classificar o tipo da objeção), Requisito 4.4 (fora do
// conjunto → indefinido) e Requisito 4.5 (conjunto pequeno — sem catálogo amplo).
//
// Mapa dos quatro casos da Tarefa 3.4:
//   - interesse  → intenção `demonstrar_interesse` (cliente quer prosseguir).
//   - dúvida     → pergunta informativa ("como funciona?", "qual a vantagem?").
//                  Não é objeção comercial; cai em `indefinido` sem `objecao`
//                  para o Decisor/Escritor (N3/N4) responderem a dúvida.
//   - objeção    → intenção `levantar_objecao` + tipo em `objecao`.
//   - indefinido → saudação/ruído fora do conjunto fechado (Requisito 4.4).
//
// A identificação é determinística (não chama IA), então os testes rodam sem
// rede nem mocks. Rodar:
//   deno test supabase/functions/_shared/cerebro/__tests__/entendimento.test.ts

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { entenderMensagem, extrairDados, identificarIntencao, classificarTipoObjecao } from "../entendimento.ts";
import type { CustomerSnapshot, EntradaEntendimento, IntencaoComercial, TipoObjecao } from "../tipos.ts";

// Conjunto fechado de intenções esperado (espelha tipos.ts). Os testes garantem
// que NENHUMA classificação saia desse conjunto (Requisito 4.5).
const CONJUNTO_FECHADO: ReadonlySet<IntencaoComercial> = new Set<IntencaoComercial>([
  "demonstrar_interesse",
  "pedir_simulacao",
  "levantar_objecao",
  "pedir_humano",
  "desistir",
  "indefinido",
]);

// ─── pedir_humano (Requisito 4.1) ────────────────────────────────────────────

Deno.test("intenção: pedir falar com humano/atendente → pedir_humano", () => {
  assertEquals(identificarIntencao("quero falar com um atendente"), "pedir_humano");
  assertEquals(identificarIntencao("me passa pra uma pessoa de verdade"), "pedir_humano");
  assertEquals(identificarIntencao("não quero falar com bot, quero humano"), "pedir_humano");
});

// ─── desistir (Requisito 4.1) ────────────────────────────────────────────────

Deno.test("intenção: desistência explícita → desistir", () => {
  assertEquals(identificarIntencao("não tenho interesse"), "desistir");
  assertEquals(identificarIntencao("desisti, deixa pra lá"), "desistir");
  assertEquals(identificarIntencao("pode parar, não quero mais"), "desistir");
});

// ─── pedir_simulacao (Requisito 4.1) ─────────────────────────────────────────

Deno.test("intenção: pedido de simulação/economia → pedir_simulacao", () => {
  assertEquals(identificarIntencao("me faz uma simulação?"), "pedir_simulacao");
  assertEquals(identificarIntencao("quanto eu vou economizar?"), "pedir_simulacao");
  assertEquals(identificarIntencao("qual seria meu desconto?"), "pedir_simulacao");
});

// ─── levantar_objecao (Requisito 4.1) ────────────────────────────────────────

Deno.test("intenção: objeção comercial reconhecida → levantar_objecao", () => {
  assertEquals(identificarIntencao("isso não é golpe?"), "levantar_objecao");
  assertEquals(identificarIntencao("tem fidelidade ou multa?"), "levantar_objecao");
  assertEquals(identificarIntencao("precisa fazer obra em casa?"), "levantar_objecao");
  assertEquals(identificarIntencao("tem taxa de adesão?"), "levantar_objecao");
});

// ─── demonstrar_interesse (Requisito 4.1) ────────────────────────────────────

Deno.test("intenção: interesse explícito em seguir → demonstrar_interesse", () => {
  assertEquals(identificarIntencao("quero sim, vamos fechar"), "demonstrar_interesse");
  assertEquals(identificarIntencao("bora, pode mandar"), "demonstrar_interesse");
  assertEquals(identificarIntencao("fechado"), "demonstrar_interesse");
  // "quero mandar a foto agora" sinaliza avanço (foto_antes) → interesse.
  assertEquals(identificarIntencao("posso já mandar a foto da conta?"), "demonstrar_interesse");
});

// ─── indefinido (Requisito 4.4) ──────────────────────────────────────────────

Deno.test("intenção: mensagem fora do conjunto fechado → indefinido", () => {
  assertEquals(identificarIntencao("bom dia"), "indefinido");
  assertEquals(identificarIntencao("kkkk"), "indefinido");
  assertEquals(identificarIntencao("aiusdhasiud"), "indefinido");
  // Dúvida informativa genérica (como funciona) não é objeção comercial.
  assertEquals(identificarIntencao("como funciona?"), "indefinido");
});

Deno.test("intenção: texto vazio ou só espaços → indefinido", () => {
  assertEquals(identificarIntencao(""), "indefinido");
  assertEquals(identificarIntencao("   "), "indefinido");
  // @ts-expect-error: garante robustez contra entrada não-string.
  assertEquals(identificarIntencao(null), "indefinido");
});

// ─── dúvida (Tarefa 3.4 / Requisito 4.1, 4.3, 4.4) ───────────────────────────
// "Dúvida" = pergunta informativa do Cliente que NÃO é objeção comercial nem
// pedido de simulação. Pela peça N2, ela cai em `indefinido` SEM `objecao` —
// é o Decisor/Escritor (N3/N4) que respondem a dúvida e reancoram no fluxo.
// Este bloco torna o caso "dúvida" explícito (a tarefa pede um bloco por caso),
// separando-o do ruído/saudação puro do bloco `indefinido` acima.

Deno.test("intenção: dúvida (pergunta informativa) → indefinido, sem objeção", () => {
  const duvidas = [
    "como funciona?",
    "como é que funciona isso?",
    "o que é a iGreen?",
    "pode me explicar melhor?",
    "me explica como funciona",
    "qual a vantagem?",
    "o que vocês fazem?",
    "pode resumir de novo?",
  ];
  for (const msg of duvidas) {
    // Dúvida não pertence ao conjunto fechado de intenções → indefinido (4.4).
    assertEquals(
      identificarIntencao(msg),
      "indefinido",
      `"${msg}" deveria ser indefinido (dúvida informativa)`,
    );
    // E não é objeção comercial → sem tipo de objeção (4.3).
    assertEquals(
      classificarTipoObjecao(msg),
      undefined,
      `"${msg}" não deveria ser classificada como objeção`,
    );
  }
});

Deno.test("entenderMensagem: dúvida informativa → indefinido sem dados nem objeção", async () => {
  const entrada: EntradaEntendimento = {
    inboundText: "pode me explicar melhor como funciona?",
    historico: [],
    estado: snapshotVazio(),
  };

  const r = await entenderMensagem(entrada);

  assertEquals(r.intencao, "indefinido");
  assertEquals(r.dados, {});
  assertEquals(r.objecao, undefined);
});

// ─── Conjunto fechado garantido (Requisito 4.5) ──────────────────────────────

Deno.test("intenção: toda classificação permanece no conjunto pequeno e fechado", () => {
  const amostras = [
    "oi", "quero falar com humano", "não quero mais", "faz uma simulação",
    "isso é golpe?", "vamos fechar", "como funciona?", "tem fidelidade?",
    "quanto economizo?", "deixa pra lá", "🤔", "manda aí", "preço é caro?",
    "atende na minha cidade?", "vou pensar", "blz", "1234",
  ];
  for (const msg of amostras) {
    const intencao = identificarIntencao(msg);
    assert(
      CONJUNTO_FECHADO.has(intencao),
      `"${msg}" classificou como "${intencao}", fora do conjunto fechado`,
    );
  }
});

// ─── entenderMensagem: contrato N2 (Tarefa 3.1) ──────────────────────────────

function snapshotVazio(): CustomerSnapshot {
  // Snapshot mínimo só para satisfazer o contrato de entrada — a intenção da
  // Tarefa 3.1 depende apenas do texto.
  return {
    customerId: "cli-1",
    consultantId: "consultor-1",
    flowId: "",
    currentStepId: null,
    status: "new",
    customer: {},
  } as unknown as CustomerSnapshot;
}

Deno.test("entenderMensagem: devolve a intenção identificada e mantém o contrato", async () => {
  const entrada: EntradaEntendimento = {
    inboundText: "quero falar com um atendente",
    historico: [],
    estado: snapshotVazio(),
  };

  const r = await entenderMensagem(entrada);

  assertEquals(r.intencao, "pedir_humano");
  // sem dados de cadastro nessa mensagem → objeto vazio; objecao só na Tarefa 3.3.
  assertEquals(r.dados, {});
  assertEquals(r.objecao, undefined);
});

// ─── extrairDados: reúso dos extratores (Tarefa 3.2 / Requisito 4.2) ─────────

Deno.test("extrairDados: extrai nome reusando captureExtractors", async () => {
  assertEquals((await extrairDados("meu nome é Carlos Antunes")).nome, "Carlos Antunes");
  assertEquals((await extrairDados("sou Maria")).nome, "Maria");
  // Confirmação simples não é nome.
  assertEquals((await extrairDados("ok")).nome, undefined);
});

Deno.test("extrairDados: extrai valor da conta reusando captureExtractors", async () => {
  assertEquals((await extrairDados("minha conta vem uns 380 reais")).valorConta, 380);
  assertEquals((await extrairDados("pago R$ 450,00 por mês")).valorConta, 450);
  assertEquals((await extrairDados("trezentos")).valorConta, 300);
  // Sem indício de valor → ausente.
  assertEquals((await extrairDados("bom dia")).valorConta, undefined);
});

Deno.test("extrairDados: extrai e-mail reusando o extrator da vendedora", async () => {
  assertEquals(
    (await extrairDados("meu email é joao.silva@gmail.com")).email,
    "joao.silva@gmail.com",
  );
  // Normaliza para minúsculas (comportamento do extrator reusado).
  assertEquals(
    (await extrairDados("pode anotar MARIA@EMPRESA.COM.BR")).email,
    "maria@empresa.com.br",
  );
  // Sem "@" não há e-mail (e nem aciona a cascata de IA).
  assertEquals((await extrairDados("não tenho email")).email, undefined);
});

Deno.test("extrairDados: extrai múltiplos campos na mesma mensagem", async () => {
  const dados = await extrairDados("sou João, minha conta é uns 250 reais, joao@x.com");
  assertEquals(dados.nome, "João");
  assertEquals(dados.valorConta, 250);
  assertEquals(dados.email, "joao@x.com");
});

Deno.test("extrairDados: texto vazio → objeto vazio (sem suposição)", async () => {
  assertEquals(await extrairDados(""), {});
  assertEquals(await extrairDados("   "), {});
});

Deno.test("entenderMensagem: preenche dados extraídos junto com a intenção", async () => {
  const entrada: EntradaEntendimento = {
    inboundText: "quero fechar! sou Pedro Silva, pago uns 400 reais",
    historico: [],
    estado: snapshotVazio(),
  };

  const r = await entenderMensagem(entrada);

  assertEquals(r.intencao, "demonstrar_interesse");
  assertEquals(r.dados.nome, "Pedro Silva");
  assertEquals(r.dados.valorConta, 400);
});

// ─── classificarTipoObjecao: mapeamento reusando classificarObjecao ──────────
// Tarefa 3.3 / Requisito 4.3: a detecção da objeção é REUSADA do
// `classificarObjecao` da Vendedora_Atual; aqui validamos o mapeamento para o
// conjunto fechado `TipoObjecao` do Cérebro. Cada tipo mapeado tem cobertura,
// além do caso sem objeção.

// Conjunto fechado de tipos de objeção (espelha tipos.ts). Garante que nenhuma
// classificação saia desse conjunto.
const TIPOS_OBJECAO: ReadonlySet<TipoObjecao> = new Set<TipoObjecao>([
  "preco",
  "desconfianca",
  "sem_tempo",
  "ja_tem_solucao",
  "nao_entendeu",
  "outro",
]);

Deno.test("objeção: custo/não compensa → preco", () => {
  assertEquals(classificarTipoObjecao("tem taxa de adesão?"), "preco");
  assertEquals(classificarTipoObjecao("minha conta é baixa, compensa?"), "preco");
});

Deno.test("objeção: medo de golpe/idoneidade → desconfianca", () => {
  assertEquals(classificarTipoObjecao("isso não é golpe?"), "desconfianca");
  assertEquals(classificarTipoObjecao("como vocês ganham com isso?"), "desconfianca");
  assertEquals(classificarTipoObjecao("vocês têm CNPJ?"), "desconfianca");
  assertEquals(classificarTipoObjecao("é homologado na ANEEL?"), "desconfianca");
});

Deno.test("objeção: adiar a decisão → sem_tempo", () => {
  assertEquals(classificarTipoObjecao("vou pensar e te falo depois"), "sem_tempo");
});

Deno.test("objeção: já tem outra empresa → ja_tem_solucao", () => {
  assertEquals(classificarTipoObjecao("já tenho desconto com outra empresa"), "ja_tem_solucao");
  assertEquals(classificarTipoObjecao("qual a diferença de vocês pra Órigo?"), "ja_tem_solucao");
});

Deno.test("objeção: confusão sobre o serviço → nao_entendeu", () => {
  assertEquals(classificarTipoObjecao("vocês trabalham com energia solar?"), "nao_entendeu");
});

Deno.test("objeção: demais objeções legítimas → outro", () => {
  assertEquals(classificarTipoObjecao("precisa fazer obra em casa?"), "outro");
  assertEquals(classificarTipoObjecao("tem fidelidade ou multa?"), "outro");
  assertEquals(classificarTipoObjecao("vou ter que trocar de distribuidora?"), "outro");
  assertEquals(classificarTipoObjecao("e se eu morar de aluguel?"), "outro");
  assertEquals(classificarTipoObjecao("vou receber outro boleto?"), "outro");
  assertEquals(classificarTipoObjecao("quanto tempo demora pra começar?"), "outro");
  assertEquals(classificarTipoObjecao("vocês atendem na minha cidade?"), "outro");
  assertEquals(classificarTipoObjecao("dá pra cancelar quando eu quiser?"), "outro");
  assertEquals(classificarTipoObjecao("fica no nome de quem paga a conta?"), "outro");
});

Deno.test("objeção: mensagem sem objeção comercial → undefined", () => {
  // Pedido de humano e desistência têm intenção própria, não são objeção.
  assertEquals(classificarTipoObjecao("quero falar com um atendente"), undefined);
  assertEquals(classificarTipoObjecao("não tenho interesse"), undefined);
  // Interesse / envio de foto não é objeção.
  assertEquals(classificarTipoObjecao("quero fechar, bora"), undefined);
  assertEquals(classificarTipoObjecao("posso já mandar a foto da conta?"), undefined);
  // Dúvida informativa genérica não é objeção comercial.
  assertEquals(classificarTipoObjecao("como funciona?"), undefined);
  // Saudação / ruído.
  assertEquals(classificarTipoObjecao("bom dia"), undefined);
  // Texto vazio.
  assertEquals(classificarTipoObjecao(""), undefined);
  assertEquals(classificarTipoObjecao("   "), undefined);
});

Deno.test("objeção: quando há tipo, permanece no conjunto fechado", () => {
  const amostras = [
    "tem taxa?", "isso é golpe?", "vou pensar", "já tenho outra empresa",
    "é solar?", "tem obra?", "tem fidelidade?", "atende aqui?",
  ];
  for (const msg of amostras) {
    const tipo = classificarTipoObjecao(msg);
    if (tipo !== undefined) {
      assert(
        TIPOS_OBJECAO.has(tipo),
        `"${msg}" classificou objeção como "${tipo}", fora do conjunto fechado`,
      );
    }
  }
});

// ─── entenderMensagem: campo objecao preenchido (Tarefa 3.3) ─────────────────

Deno.test("entenderMensagem: objeção comercial preenche intencao e objecao", async () => {
  const entrada: EntradaEntendimento = {
    inboundText: "isso não é golpe?",
    historico: [],
    estado: snapshotVazio(),
  };

  const r = await entenderMensagem(entrada);

  assertEquals(r.intencao, "levantar_objecao");
  assertEquals(r.objecao, "desconfianca");
});

Deno.test("entenderMensagem: sem objeção mantém objecao ausente", async () => {
  const entrada: EntradaEntendimento = {
    inboundText: "quero falar com um atendente",
    historico: [],
    estado: snapshotVazio(),
  };

  const r = await entenderMensagem(entrada);

  assertEquals(r.intencao, "pedir_humano");
  assertEquals(r.objecao, undefined);
});
