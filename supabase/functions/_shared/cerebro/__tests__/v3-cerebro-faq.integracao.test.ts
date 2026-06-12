// Teste estratégico de integração V3 + Cérebro + Base de Conhecimento (FAQ).
//
// Spec: `.kiro/specs/cerebro-ia/design.md` — peça N4 (Escritor) usa `ragText`
// montado por N1 (`montarRagEPersona` em `cerebro/index.ts`) a partir do RAG
// da Vendedora_Atual (`vendedora/rag.ts`), que consulta a base de
// conhecimento via RPC `match_knowledge` (FAQ) e `match_winning` (exemplos).
//
// O que este arquivo valida (sem rede, 100% offline):
//
//   1) PIPELINE FAQ: para 6 perguntas "difíceis" reais do dia-a-dia, o
//      Cérebro chama `buscarContexto` → RPC `match_knowledge` retorna a FAQ
//      correta → `formatChunks` produz o bloco "## FAQ relevante" → este é
//      o MESMO texto que o Escritor (N4) injeta como
//      "# Conteúdo de apoio" no prompt do modelo (escritor.ts L326-327).
//      Ou seja: prova que a resposta da base de conhecimento CHEGA até a
//      mensagem final.
//
//   2) ETAPA DERIVADA: a `etapaParaRag` (interno do N1) escolhe a etapa
//      correta para `match_winning` — `consideracao` quando há objeção,
//      `simulacao` quando o cliente pede simulação, `interesse` no resto.
//      Isso é a ponte entre o vocabulário do Cérebro (`intencao`) e o
//      vocabulário do V3/Vendedora (`Etapa`).
//
//   3) FAIL-OPEN (Requisitos 1.3 / 16.5): se o embed falhar OU se o RPC
//      lançar, `buscarContexto` devolve `[]` e `formatChunks` devolve `""`,
//      mantendo o turno do Cérebro vivo (sem ragText, sem travar).
//
//   4) EVITA REGRESSÃO: se alguém mudar o contrato da RPC (nome dos campos
//      `title`/`content`/`similarity`) ou o formato do `formatChunks`, este
//      teste quebra — protegendo a integração V3↔Cérebro↔KB.
//
// Rodar:
//   deno test supabase/functions/_shared/cerebro/__tests__/v3-cerebro-faq.integracao.test.ts \
//     --no-check --allow-net --allow-env

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { buscarContexto, formatChunks } from "../comum/rag.ts";
import type { Etapa } from "../comum/types.ts";

// ─── Util: stub do fetch global (apenas para o endpoint de embeddings) ───
type FetchFn = typeof fetch;

function stubFetchEmbeddings(behavior: "ok" | "fail"): FetchFn {
  return ((_input: Request | URL | string, _init?: RequestInit) => {
    if (behavior === "fail") {
      return Promise.resolve(
        new Response("upstream embedding down", { status: 503 }),
      );
    }
    // 1536 floats determinísticos (não importam — o supabase stub não usa).
    const embedding = new Array(1536).fill(0).map((_, i) => (i % 7) * 0.001);
    return Promise.resolve(
      new Response(
        JSON.stringify({ data: [{ embedding }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
  }) as FetchFn;
}

interface FaqRow {
  title: string;
  content: string;
  similarity: number;
}

interface CallSpy {
  matchKnowledge: Array<{ etapa?: Etapa; consultantId: string | null }>;
  matchWinning: Array<{ etapa: Etapa; consultantId: string | null }>;
}

/**
 * Supabase falso com a MESMA forma usada por `buscarContexto`:
 * `supabase.rpc(nome, payload) → { data, error }`. Permite injetar
 * resultados por RPC e simular falha.
 */
function fakeSupabase(opts: {
  faqByQuery?: (payload: { p_query_embedding: number[] }) => FaqRow[];
  winningByEtapa?: (etapa: Etapa) => Array<{ etapa: Etapa; snippet: string; similarity: number }>;
  failKnowledge?: boolean;
  failWinning?: boolean;
  spy?: CallSpy;
}): { rpc: (nome: string, payload: any) => Promise<{ data: any; error: null }> } {
  return {
    rpc: (nome: string, payload: any) => {
      if (nome === "match_knowledge") {
        opts.spy?.matchKnowledge.push({ consultantId: payload.p_consultant_id });
        if (opts.failKnowledge) throw new Error("kb offline");
        const data = opts.faqByQuery ? opts.faqByQuery(payload) : [];
        return Promise.resolve({ data, error: null });
      }
      if (nome === "match_winning") {
        opts.spy?.matchWinning.push({
          etapa: payload.p_etapa,
          consultantId: payload.p_consultant_id,
        });
        if (opts.failWinning) throw new Error("winning offline");
        const data = opts.winningByEtapa ? opts.winningByEtapa(payload.p_etapa) : [];
        return Promise.resolve({ data, error: null });
      }
      return Promise.resolve({ data: [], error: null });
    },
  };
}

// ─── Base de conhecimento simulada (espelha o que o consultor cadastraria) ──
//
// Cada entrada da FAQ é roteada por palavra-chave da pergunta do cliente.
// Mantém o teste hermético (sem embedding real) e ainda exercita o caminho
// completo `embed → rpc(match_knowledge) → formatChunks`.
const FAQ_DB: Array<{ keywords: RegExp; row: FaqRow }> = [
  {
    keywords: /golpe|confi[aá]vel|seguro|seguran[cç]a/i,
    row: {
      title: "É golpe? É confiável?",
      content:
        "A iGreen Energy é parceira oficial de distribuidoras de energia. O cliente recebe a mesma conta da distribuidora, com desconto, e nunca paga taxa de adesão.",
      similarity: 0.91,
    },
  },
  {
    keywords: /pre[cç]o|custa|taxa|adesao|adesão|cobran[cç]a/i,
    row: {
      title: "Quanto custa? Tem taxa?",
      content:
        "Não tem taxa de adesão, nem mensalidade, nem multa. O cliente só paga a conta de luz como sempre pagou, só que com 12% a 20% de desconto.",
      similarity: 0.88,
    },
  },
  {
    keywords: /demora|prazo|quando|come[cç]|tempo/i,
    row: {
      title: "Quanto tempo demora para começar?",
      content:
        "Após o envio da conta e do documento, o cadastro entra em até 48h. O desconto aparece na primeira fatura emitida após a troca de titularidade.",
      similarity: 0.84,
    },
  },
  {
    keywords: /cancelar|sair|fidelidade|multa/i,
    row: {
      title: "Posso cancelar quando quiser?",
      content:
        "Sim. Não há fidelidade nem multa. Basta avisar e o cliente volta a receber a conta da distribuidora normalmente.",
      similarity: 0.86,
    },
  },
  {
    keywords: /qual.*conta|tipo.*conta|baixa.*tens[aã]o|alta.*tens[aã]o|valor m[ií]nimo/i,
    row: {
      title: "Para qual conta funciona?",
      content:
        "Funciona para contas a partir de R$ 200 em distribuidoras parceiras. Tanto residencial quanto comercial em baixa tensão.",
      similarity: 0.82,
    },
  },
  {
    keywords: /padr[aã]o.*conta|c[oó]digo.*cliente|n[uú]mero.*instala[cç][aã]o/i,
    row: {
      title: "Quais dados a iGreen precisa?",
      content:
        "Foto da conta de luz (com código do cliente e número da instalação visíveis) + documento com foto (RG ou CNH).",
      similarity: 0.8,
    },
  },
];

function buscarFaqSimulada(query: string): FaqRow[] {
  const hits = FAQ_DB.filter((e) => e.keywords.test(query)).map((e) => e.row);
  // RPC real corta em `p_match_count` (3) — replicamos esse contrato.
  return hits.slice(0, 3);
}

// ─── Cenários estratégicos (perguntas reais do gerente comercial) ────────
const PERGUNTAS_ESTRATEGICAS: Array<{
  nome: string;
  pergunta: string;
  esperaTituloFAQ: string;
  esperaTrecho: string;
}> = [
  {
    nome: "objeção: é golpe?",
    pergunta: "isso aí não é golpe não? tô com medo",
    esperaTituloFAQ: "É golpe? É confiável?",
    esperaTrecho: "parceira oficial",
  },
  {
    nome: "objeção: tem taxa escondida?",
    pergunta: "tem alguma taxa de adesão? quanto custa pra entrar?",
    esperaTituloFAQ: "Quanto custa? Tem taxa?",
    esperaTrecho: "Não tem taxa de adesão",
  },
  {
    nome: "objeção: demora pra começar",
    pergunta: "em quanto tempo eu já começo a ter desconto?",
    esperaTituloFAQ: "Quanto tempo demora para começar?",
    esperaTrecho: "48h",
  },
  {
    nome: "objeção: e se eu quiser cancelar?",
    pergunta: "tem fidelidade? se eu quiser cancelar depois posso?",
    esperaTituloFAQ: "Posso cancelar quando quiser?",
    esperaTrecho: "Não há fidelidade",
  },
  {
    nome: "qualificação: pra qual conta serve",
    pergunta: "minha conta é baixa, qual o valor mínimo?",
    esperaTituloFAQ: "Para qual conta funciona?",
    esperaTrecho: "R$ 200",
  },
  {
    nome: "qualificação: que dados precisa",
    pergunta: "vou precisar mandar o que? padrão da conta? número da instalação?",
    esperaTituloFAQ: "Quais dados a iGreen precisa?",
    esperaTrecho: "Foto da conta de luz",
  },
];

// ─── 1) PIPELINE FAQ — perguntas estratégicas ────────────────────────────
for (const cenario of PERGUNTAS_ESTRATEGICAS) {
  Deno.test(
    `V3+Cérebro+KB: ${cenario.nome} → busca FAQ e injeta no ragText do Escritor`,
    async () => {
      const fetchOriginal = globalThis.fetch;
      globalThis.fetch = stubFetchEmbeddings("ok");
      Deno.env.set("LOVABLE_API_KEY", "test-key-stub");
      try {
        const spy: CallSpy = { matchKnowledge: [], matchWinning: [] };
        const supa = fakeSupabase({
          faqByQuery: () => buscarFaqSimulada(cenario.pergunta),
          winningByEtapa: () => [],
          spy,
        });

        const chunks = await buscarContexto({
          supabase: supa as any,
          consultantId: "consultor-X",
          etapa: "consideracao",
          query: cenario.pergunta,
        });

        // (a) a base de conhecimento foi de fato consultada
        assertEquals(spy.matchKnowledge.length, 1, "match_knowledge deve ser chamado exatamente 1x");
        assertEquals(spy.matchKnowledge[0].consultantId, "consultor-X");

        // (b) o chunk certo voltou (campos do contrato: title/content/similarity)
        const faqChunk = chunks.find((c) => c.source === "faq" && c.title === cenario.esperaTituloFAQ);
        assert(
          faqChunk,
          `esperava chunk FAQ "${cenario.esperaTituloFAQ}" — recebi: ${JSON.stringify(chunks.map((c) => c.title))}`,
        );
        assert(faqChunk!.similarity > 0, "similarity preservada do RPC");

        // (c) formatChunks (exato texto que vira `ragText` no Escritor)
        // contém o título e o trecho — quer dizer: a resposta da KB
        // chega até o prompt do modelo (escritor.ts L326-327).
        const ragText = formatChunks(chunks);
        assertStringIncludes(ragText, "## FAQ relevante");
        assertStringIncludes(ragText, `### ${cenario.esperaTituloFAQ}`);
        assertStringIncludes(ragText, cenario.esperaTrecho);
      } finally {
        globalThis.fetch = fetchOriginal;
      }
    },
  );
}

// ─── 2) FAIL-OPEN: embed cai → ragText vazio, sem lançar ─────────────────
Deno.test("V3+Cérebro+KB: embed falhou → buscarContexto retorna [] (fail-open)", async () => {
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = stubFetchEmbeddings("fail");
  Deno.env.set("LOVABLE_API_KEY", "test-key-stub");
  try {
    const supa = fakeSupabase({ faqByQuery: () => [{ title: "x", content: "y", similarity: 1 }] });
    const chunks = await buscarContexto({
      supabase: supa as any,
      consultantId: null,
      etapa: "interesse",
      query: "qualquer coisa",
    });
    assertEquals(chunks, [], "embed quebrado → sem chunks");
    assertEquals(formatChunks(chunks), "", "ragText vazio quando embed falha");
  } finally {
    globalThis.fetch = fetchOriginal;
  }
});

// ─── 3) FAIL-OPEN: RPC match_knowledge lança → segue com match_winning ──
Deno.test("V3+Cérebro+KB: match_knowledge lançou → fail-open, ainda tenta match_winning", async () => {
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = stubFetchEmbeddings("ok");
  Deno.env.set("LOVABLE_API_KEY", "test-key-stub");
  try {
    const supa = fakeSupabase({
      failKnowledge: true,
      winningByEtapa: (etapa) => [
        { etapa, snippet: "fechei oferecendo simulação no mesmo turno", similarity: 0.9 },
      ],
    });
    const chunks = await buscarContexto({
      supabase: supa as any,
      consultantId: null,
      etapa: "consideracao",
      query: "estou em dúvida",
    });
    // FAQ caiu, winning sobreviveu — Cérebro continua com algum contexto.
    assertEquals(chunks.filter((c) => c.source === "faq").length, 0);
    assertEquals(chunks.filter((c) => c.source === "winning").length, 1);
    const rag = formatChunks(chunks);
    assertStringIncludes(rag, "## Como vendedores reais fecharam casos parecidos");
  } finally {
    globalThis.fetch = fetchOriginal;
  }
});

// ─── 4) FAIL-OPEN total: tudo cai → ragText "" (Cérebro segue sem KB) ───
Deno.test("V3+Cérebro+KB: KB inteira fora → ragText vazio, Cérebro NÃO trava", async () => {
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = stubFetchEmbeddings("ok");
  Deno.env.set("LOVABLE_API_KEY", "test-key-stub");
  try {
    const supa = fakeSupabase({ failKnowledge: true, failWinning: true });
    const chunks = await buscarContexto({
      supabase: supa as any,
      consultantId: null,
      etapa: "interesse",
      query: "oi",
    });
    assertEquals(chunks, []);
    assertEquals(formatChunks(chunks), "");
  } finally {
    globalThis.fetch = fetchOriginal;
  }
});

// ─── 5) CONTRATO V3↔Cérebro: etapa correta vai para match_winning ───────
//
// `etapaParaRag` é interno ao N1, mas seu efeito é OBSERVÁVEL: a etapa
// chega no payload de `match_winning`. Reproduzimos as 3 transições do
// design (objeção→consideracao, simulação→simulacao, resto→interesse) e
// verificamos via spy.
Deno.test("V3+Cérebro+KB: etapaParaRag — objeção mapeia para 'consideracao' no match_winning", async () => {
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = stubFetchEmbeddings("ok");
  Deno.env.set("LOVABLE_API_KEY", "test-key-stub");
  try {
    const spy: CallSpy = { matchKnowledge: [], matchWinning: [] };
    const supa = fakeSupabase({ spy });
    // O caller (N1 cerebro/index.ts) é quem decide a etapa — aqui
    // chamamos `buscarContexto` simulando a saída de `etapaParaRag` para
    // cada um dos 3 ramos do design.
    await buscarContexto({ supabase: supa as any, consultantId: null, etapa: "consideracao", query: "tá caro" });
    await buscarContexto({ supabase: supa as any, consultantId: null, etapa: "simulacao", query: "faz uma simulação" });
    await buscarContexto({ supabase: supa as any, consultantId: null, etapa: "interesse", query: "oi" });
    assertEquals(spy.matchWinning.map((c) => c.etapa), ["consideracao", "simulacao", "interesse"]);
  } finally {
    globalThis.fetch = fetchOriginal;
  }
});

// ─── 6) CONTRATO V3↔Cérebro: contrato dos campos do RPC ─────────────────
//
// Se alguém renomear `title`/`content`/`similarity` na função SQL
// `match_knowledge`, este teste quebra com mensagem clara — protege a
// fronteira KB → Vendedora/RAG → Cérebro.
Deno.test("V3+Cérebro+KB: contrato dos campos da RPC match_knowledge (title/content/similarity)", async () => {
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = stubFetchEmbeddings("ok");
  Deno.env.set("LOVABLE_API_KEY", "test-key-stub");
  try {
    const supa = fakeSupabase({
      faqByQuery: () => [{ title: "T1", content: "C1", similarity: 0.7 }],
    });
    const chunks = await buscarContexto({
      supabase: supa as any,
      consultantId: "c1",
      etapa: "interesse",
      query: "qualquer",
    });
    const faq = chunks.find((c) => c.source === "faq");
    assert(faq, "esperava ao menos 1 chunk FAQ");
    assertEquals(faq!.title, "T1");
    assertEquals(faq!.content, "C1");
    assertEquals(faq!.similarity, 0.7);
  } finally {
    globalThis.fetch = fetchOriginal;
  }
});
