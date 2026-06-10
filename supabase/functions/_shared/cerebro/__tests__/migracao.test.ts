// Testes unitários do mapa de migração — Tarefa 12.1 (pt-BR).
//
// Spec: `.kiro/specs/cerebro-ia/design.md` — "Migração de clientes que já estão
// em conversa". Valida: Requisito 5.4 (retomar sem reiniciar cadastro) e
// Requisito 14.1 (substituição gradual da sequência fixa).
//
// Cobre:
//   - cada `Etapa` conhecida → passo esperado (ou "sem equivalente");
//   - etapa desconhecida / ausente / null / undefined → "sem equivalente";
//   - todo `stepKey` do mapa existe no registro real de cadastro (sem inventar);
//   - o mapa cobre TODAS as etapas do tipo `Etapa` (sincronia com a vendedora).
//
// Rodar:
//   deno test supabase/functions/_shared/cerebro/__tests__/migracao.test.ts

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  ETAPAS_SEM_EQUIVALENTE,
  MAPA_ETAPA_PARA_PASSO,
  type PassoEquivalente,
  traduzirEtapaAntiga,
} from "../migracao.ts";
import { ETAPAS_ORDER } from "../../vendedora/types.ts";
import type { Etapa } from "../../vendedora/types.ts";
import { CADASTRO_STEP_REGISTRY } from "../../pipeline-cadastro/registry.ts";

// ─── 1. Cada etapa conhecida → passo esperado ────────────────────────────────

// Tabela de expectativas explícita (não derivada do mapa) para detectar
// mudanças acidentais no mapeamento.
const ESPERADO: Record<Etapa, PassoEquivalente | null> = {
  interesse: { stepKey: "ask_quero_cadastrar", pipelineKind: null },
  nome: { stepKey: "ask_name", pipelineKind: null },
  valor: { stepKey: "ask_bill_value", pipelineKind: null },
  simulacao: null,
  consideracao: null,
  foto_conta: { stepKey: "aguardando_conta", pipelineKind: "ocr_conta" },
  doc: { stepKey: "ask_tipo_documento", pipelineKind: "ocr_documento" },
  email: { stepKey: "ask_email", pipelineKind: null },
  finalizando: { stepKey: "finalizando", pipelineKind: "finalizar_cadastro" },
  pos_cadastro: { stepKey: "complete", pipelineKind: null },
};

Deno.test("traduzirEtapaAntiga: cada etapa conhecida cai no passo esperado", () => {
  for (const etapa of Object.keys(ESPERADO) as Etapa[]) {
    const esperado = ESPERADO[etapa];
    const resultado = traduzirEtapaAntiga(etapa);

    if (esperado === null) {
      assertEquals(
        resultado,
        { tipo: "sem_equivalente", etapa },
        `etapa "${etapa}" deveria ser sem_equivalente`,
      );
    } else {
      assertEquals(
        resultado,
        { tipo: "equivalente", passo: esperado },
        `etapa "${etapa}" deveria mapear para ${esperado.stepKey}`,
      );
    }
  }
});

// ─── 2. Etapas desconhecidas / ausentes → sem equivalente ────────────────────

Deno.test("traduzirEtapaAntiga: etapa desconhecida → sem_equivalente", () => {
  const r = traduzirEtapaAntiga("etapa_que_nao_existe");
  assertEquals(r, { tipo: "sem_equivalente", etapa: "etapa_que_nao_existe" });
});

Deno.test("traduzirEtapaAntiga: valores ausentes → sem_equivalente (conservador)", () => {
  assertEquals(traduzirEtapaAntiga(null), { tipo: "sem_equivalente", etapa: null });
  assertEquals(traduzirEtapaAntiga(undefined), {
    tipo: "sem_equivalente",
    etapa: null,
  });
  // String vazia preserva o valor recebido ("") — só null/undefined viram null.
  assertEquals(traduzirEtapaAntiga(""), { tipo: "sem_equivalente", etapa: "" });
});

// ─── 3. Integridade do mapa ──────────────────────────────────────────────────

Deno.test("MAPA_ETAPA_PARA_PASSO cobre TODAS as etapas conhecidas (ETAPAS_ORDER)", () => {
  for (const etapa of ETAPAS_ORDER) {
    assert(
      etapa in MAPA_ETAPA_PARA_PASSO,
      `etapa "${etapa}" do tipo Etapa não está no mapa`,
    );
  }
  // E o mapa não tem chaves a mais do que as etapas conhecidas.
  assertEquals(
    Object.keys(MAPA_ETAPA_PARA_PASSO).sort(),
    [...ETAPAS_ORDER].sort(),
  );
});

Deno.test("todo stepKey do mapa existe no registro real de cadastro (sem inventar)", () => {
  for (const etapa of Object.keys(MAPA_ETAPA_PARA_PASSO) as Etapa[]) {
    const passo = MAPA_ETAPA_PARA_PASSO[etapa];
    if (passo === null) continue;
    assert(
      passo.stepKey in CADASTRO_STEP_REGISTRY,
      `stepKey "${passo.stepKey}" (etapa "${etapa}") não existe em CADASTRO_STEP_REGISTRY`,
    );
  }
});

Deno.test("ETAPAS_SEM_EQUIVALENTE reflete exatamente as etapas null do mapa", () => {
  const esperadas = (Object.keys(MAPA_ETAPA_PARA_PASSO) as Etapa[]).filter(
    (e) => MAPA_ETAPA_PARA_PASSO[e] === null,
  );
  assertEquals([...ETAPAS_SEM_EQUIVALENTE].sort(), esperadas.sort());
  // Confirmação explícita do conteúdo esperado (simulacao + consideracao).
  assertEquals([...ETAPAS_SEM_EQUIVALENTE].sort(), ["consideracao", "simulacao"]);
});

// ─── 4. Tarefa 12.2 — Aplicação da migração (ponto de entrada / handoff) ─────
//
// Valida o Requisito 5.4: cliente com cadastro parcial entra no passo
// equivalente (sem reiniciar); sem equivalente / desconhecida → handoff.

import {
  aplicarMigracao,
  type DecisaoMigracao,
  pontoDeEntradaMigracao,
} from "../migracao.ts";

// Monta um `EstadoCerebro` mínimo com a etapa antiga na camada operacional,
// como a N8 (`montarMemoriaEmCamadas`) preserva o `fluxo_b_state` cru.
function estadoComEtapa(
  etapa: unknown,
  info: Record<string, string> = {},
): Record<string, unknown> {
  return {
    snapshot: {},
    memoria: {
      sessao: null,
      perfil: {},
      operacional: {
        currentStepId: null,
        fluxoBState: { etapa, info },
      },
    },
  };
}

Deno.test("pontoDeEntradaMigracao: etapa com equivalente → entrar_no_passo", () => {
  // Cliente parou no envio do nome (já tem etapa antiga "nome").
  const estado = estadoComEtapa("nome");
  const decisao = pontoDeEntradaMigracao(estado);
  assertEquals(decisao, { acao: "entrar_no_passo", stepKey: "ask_name" });
});

Deno.test("pontoDeEntradaMigracao: cadastro parcial (dados já coletados) entra no passo, não reinicia", () => {
  // Cliente já informou nome e valor e parou no envio da foto da conta.
  const estado = estadoComEtapa("foto_conta", {
    nome: "Maria",
    valor: "450",
  });
  const decisao = pontoDeEntradaMigracao(estado);
  // Entra no passo da foto da conta — NUNCA volta para "ask_name"/início.
  assertEquals(decisao, {
    acao: "entrar_no_passo",
    stepKey: "aguardando_conta",
  });
  assert(decisao.acao !== "handoff", "não deve fazer handoff com etapa válida");
});

Deno.test("pontoDeEntradaMigracao: aceita fluxo_b_state cru (sem EstadoCerebro)", () => {
  const decisao = pontoDeEntradaMigracao({ etapa: "email", info: {} });
  assertEquals(decisao, { acao: "entrar_no_passo", stepKey: "ask_email" });
});

Deno.test("pontoDeEntradaMigracao: todas as etapas com equivalente entram no passo correto", () => {
  for (const etapa of ETAPAS_ORDER) {
    const passo = MAPA_ETAPA_PARA_PASSO[etapa];
    if (passo === null) continue; // sem equivalente é coberto abaixo
    const decisao = pontoDeEntradaMigracao(estadoComEtapa(etapa));
    assertEquals(
      decisao,
      { acao: "entrar_no_passo", stepKey: passo.stepKey },
      `etapa "${etapa}" deveria entrar em ${passo.stepKey}`,
    );
  }
});

Deno.test("pontoDeEntradaMigracao: etapa sem equivalente → handoff", () => {
  for (const etapa of ETAPAS_SEM_EQUIVALENTE) {
    const decisao = pontoDeEntradaMigracao(estadoComEtapa(etapa));
    assertEquals(decisao.acao, "handoff", `etapa "${etapa}" deveria virar handoff`);
    if (decisao.acao === "handoff") {
      assert(decisao.motivo.length > 0, "handoff deve ter motivo");
    }
  }
});

Deno.test("pontoDeEntradaMigracao: etapa desconhecida → handoff (não reinicia)", () => {
  const decisao = pontoDeEntradaMigracao(estadoComEtapa("etapa_que_nao_existe"));
  assertEquals(decisao.acao, "handoff");
});

Deno.test("pontoDeEntradaMigracao: estado ausente/corrompido → handoff conservador", () => {
  const casos: Array<Record<string, unknown> | null | undefined> = [
    null,
    undefined,
    {}, // sem memoria nem etapa
    { memoria: { operacional: {} } }, // sem fluxoBState
    { memoria: { operacional: { fluxoBState: {} } } }, // fluxoBState sem etapa
    estadoComEtapa(123), // etapa não-string
    estadoComEtapa(""), // etapa vazia
  ];
  for (const caso of casos) {
    const decisao = pontoDeEntradaMigracao(caso);
    assertEquals(
      decisao.acao,
      "handoff",
      `entrada ${JSON.stringify(caso)} deveria virar handoff`,
    );
  }
});

Deno.test("aplicarMigracao é alias de pontoDeEntradaMigracao", () => {
  const estado = estadoComEtapa("valor");
  const a: DecisaoMigracao = aplicarMigracao(estado);
  const b: DecisaoMigracao = pontoDeEntradaMigracao(estado);
  assertEquals(a, b);
  assertEquals(a, { acao: "entrar_no_passo", stepKey: "ask_bill_value" });
});
