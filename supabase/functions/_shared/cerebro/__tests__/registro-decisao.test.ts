// Testes unitários da peça N10 — Registro de decisão em sombra (pt-BR). Tarefa 8.1.
//
// Spec: `.kiro/specs/cerebro-ia/design.md` — peça "N10 — Métricas de sombra".
// Valida: Requisitos 3.1 (grava 1 registro por turno), 3.2 (decisão do Cérebro
// + saída do sistema atual no mesmo turno), 3.4 (flag de coincidência) e 17.3
// (reúso de `ai_decisions`, sem tabela equivalente).
//
// ESTRATÉGIA: mocka o cliente Supabase capturando a linha do `insert`, sem tocar
// banco real. Verifica:
//   - a gravação acontece em `ai_decisions` com os campos corretos;
//   - o passo/ação do Cérebro e do sistema atual ficam ambos no registro;
//   - a flag de coincidência é calculada por PASSO/AÇÃO (não pelo texto);
//   - em sombra `suppressed = true` e `reply_sent = null` (nada é enviado);
//   - falha de insert não lança (best-effort), mas devolve a flag.
//
// Rodar:
//   deno test supabase/functions/_shared/cerebro/__tests__/registro-decisao.test.ts --no-check

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  decisoesCoincidem,
  registrarDecisaoSombra,
  resumirDecisaoCerebro,
  type ResumoDecisaoTurno,
} from "../registro-decisao.ts";
import type { ResultadoCerebro } from "../tipos.ts";

// ─── Supabase MOCKADO: captura a linha inserida em ai_decisions ──────────────

interface InsertCapturado {
  tabela: string;
  row: Record<string, unknown>;
}

function montarSupabaseMock(opts: { falhar?: boolean } = {}) {
  const inserts: InsertCapturado[] = [];
  const cliente = {
    from(tabela: string) {
      return {
        insert(row: Record<string, unknown>) {
          inserts.push({ tabela, row });
          if (opts.falhar) {
            return Promise.resolve({ error: { message: "falha simulada" } });
          }
          return Promise.resolve({ error: null });
        },
      };
    },
  };
  // deno-lint-ignore no-explicit-any
  return { cliente: cliente as any, inserts };
}

// ─── Fixtures de ResultadoCerebro ───────────────────────────────────────────

function resultadoBase(over: Partial<ResultadoCerebro> = {}): ResultadoCerebro {
  return {
    reply: "Olá! Posso te ajudar a economizar na conta de luz.",
    outbound: [
      { kind: "text", text: "Olá!", idempotencyContent: "Olá!" },
    ],
    stateUpdate: {},
    shouldHandoff: false,
    decisao: {
      passoAtualId: "passo-1",
      proximoPassoId: "passo-2",
      intencao: "demonstrar_interesse",
    },
    ...over,
  };
}

// ─── Testes de resumo/comparação (lógica pura) ──────────────────────────────

Deno.test("resumirDecisaoCerebro: mensagem aprovada → ação 'responder' e próximo passo", () => {
  const resumo = resumirDecisaoCerebro(resultadoBase());
  assertEquals(resumo.acao, "responder");
  assertEquals(resumo.passo, "passo-2");
});

Deno.test("resumirDecisaoCerebro: handoff tem prioridade sobre resposta", () => {
  const resumo = resumirDecisaoCerebro(
    resultadoBase({ shouldHandoff: true, reply: "", outbound: [] }),
  );
  assertEquals(resumo.acao, "handoff");
});

Deno.test("resumirDecisaoCerebro: ação de cadastro (ocr) é refletida na ação do turno", () => {
  const resumo = resumirDecisaoCerebro(
    resultadoBase({
      reply: "",
      outbound: [],
      acaoCadastro: {
        kind: "ocr",
        stepId: "passo-2",
        flowId: "fluxo-1",
        pipeline: "ocr_conta",
        mediaRef: "media-1",
      },
    }),
  );
  assertEquals(resumo.acao, "ocr");
  assertEquals(resumo.passo, "passo-2");
});

Deno.test("decisoesCoincidem: coincide quando passo E ação são iguais", () => {
  const a: ResumoDecisaoTurno = { passo: "passo-2", acao: "responder" };
  const b: ResumoDecisaoTurno = { passo: "passo-2", acao: "responder" };
  assert(decisoesCoincidem(a, b));
});

Deno.test("decisoesCoincidem: NÃO coincide quando o passo difere", () => {
  const a: ResumoDecisaoTurno = { passo: "passo-2", acao: "responder" };
  const b: ResumoDecisaoTurno = { passo: "passo-9", acao: "responder" };
  assert(!decisoesCoincidem(a, b));
});

Deno.test("decisoesCoincidem: NÃO coincide quando a ação difere (mesmo passo)", () => {
  const a: ResumoDecisaoTurno = { passo: "passo-2", acao: "responder" };
  const b: ResumoDecisaoTurno = { passo: "passo-2", acao: "ocr" };
  assert(!decisoesCoincidem(a, b));
});

// ─── Testes de gravação em ai_decisions ─────────────────────────────────────

Deno.test("registrarDecisaoSombra: grava 1 linha em ai_decisions com passo/ação dos dois lados (Req 3.1, 3.2)", async () => {
  const { cliente, inserts } = montarSupabaseMock();
  const r = await registrarDecisaoSombra({
    supabase: cliente,
    consultantId: "consultor-1",
    customerId: "cliente-1",
    decisaoCerebro: resultadoBase(),
    decisaoSistemaAtual: { passo: "passo-2", acao: "responder" },
    inboundText: "quero economizar",
    channel: "evolution",
    latencyMs: 123,
  });

  // Gravou exatamente uma linha, na tabela existente ai_decisions (Req 17.3).
  assertEquals(inserts.length, 1);
  assertEquals(inserts[0].tabela, "ai_decisions");

  const row = inserts[0].row;
  assertEquals(row.phase, "cerebro_sombra");
  assertEquals(row.source, "cerebro_dark");
  assertEquals(row.consultant_id, "consultor-1");
  assertEquals(row.customer_id, "cliente-1");
  // Passo/ação do Cérebro mapeados às colunas reais.
  assertEquals(row.tool_called, "responder");
  assertEquals(row.step_before, "passo-1");
  assertEquals(row.step_after, "passo-2");
  assertEquals(row.intent_detected, "demonstrar_interesse");

  // ai_output guarda a comparação completa + a flag de coincidência (Req 3.2, 3.4).
  // deno-lint-ignore no-explicit-any
  const out = row.ai_output as any;
  assertEquals(out.modo, "sombra");
  assertEquals(out.cerebro.acao, "responder");
  assertEquals(out.cerebro.proximoPassoId, "passo-2");
  assertEquals(out.sistema_atual.passo, "passo-2");
  assertEquals(out.sistema_atual.acao, "responder");
  assertEquals(out.coincide, true);

  assertEquals(r.ok, true);
  assertEquals(r.coincide, true);
});

Deno.test("registrarDecisaoSombra: em sombra nada é enviado — suppressed=true e reply_sent=null (Req 3.3)", async () => {
  const { cliente, inserts } = montarSupabaseMock();
  await registrarDecisaoSombra({
    supabase: cliente,
    consultantId: "consultor-1",
    customerId: "cliente-1",
    decisaoCerebro: resultadoBase(),
    decisaoSistemaAtual: { passo: "passo-2", acao: "responder" },
  });
  const row = inserts[0].row;
  assertEquals(row.suppressed, true);
  assertEquals(row.reply_sent, null);
});

Deno.test("registrarDecisaoSombra: flag de coincidência fica false quando o sistema atual decide diferente (Req 3.4)", async () => {
  const { cliente, inserts } = montarSupabaseMock();
  const r = await registrarDecisaoSombra({
    supabase: cliente,
    consultantId: "consultor-1",
    customerId: "cliente-1",
    decisaoCerebro: resultadoBase(),
    // Sistema atual decidiu pedir foto (ocr) no mesmo turno → não coincide.
    decisaoSistemaAtual: { passo: "passo-2", acao: "ocr" },
  });
  // deno-lint-ignore no-explicit-any
  const out = inserts[0].row.ai_output as any;
  assertEquals(out.coincide, false);
  assertEquals(r.coincide, false);
});

Deno.test("registrarDecisaoSombra: coincidência compara PASSO/AÇÃO, não o texto da mensagem (N10)", async () => {
  const { cliente, inserts } = montarSupabaseMock();
  // Cérebro com texto bem diferente, mas mesmo passo/ação do sistema atual.
  const r = await registrarDecisaoSombra({
    supabase: cliente,
    consultantId: "consultor-1",
    customerId: "cliente-1",
    decisaoCerebro: resultadoBase({ reply: "Texto totalmente diferente, blá blá." }),
    decisaoSistemaAtual: { passo: "passo-2", acao: "responder" },
  });
  // deno-lint-ignore no-explicit-any
  const out = inserts[0].row.ai_output as any;
  assertEquals(out.coincide, true);
  assertEquals(r.coincide, true);
});

Deno.test("registrarDecisaoSombra: falha de insert não lança (best-effort) e ainda devolve a flag", async () => {
  const { cliente, inserts } = montarSupabaseMock({ falhar: true });
  const r = await registrarDecisaoSombra({
    supabase: cliente,
    consultantId: "consultor-1",
    customerId: "cliente-1",
    decisaoCerebro: resultadoBase(),
    decisaoSistemaAtual: { passo: "passo-2", acao: "responder" },
  });
  assertEquals(inserts.length, 1); // tentou gravar
  assertEquals(r.ok, false); // mas o insert falhou
  assertEquals(r.coincide, true); // flag continua disponível
});
