// Testes do hook de RESPOSTA real do Cérebro IA (pt-BR) — Tarefa 14.1.
//
// Spec: `.kiro/specs/cerebro-ia/design.md` — "Ativação segura", "Fluxo de um
// turno", "Pipeline de cadastro" e "Error Handling".
// Valida: Requisitos 2.4 (em `canary` responde só para o subconjunto de
// consultores do rollout) e 14.2 (mantém a vendedora para os demais).
//
// O QUE PROVAMOS
// --------------
//   (1) `canary` (consultor NO subconjunto, flag = canary) → o Cérebro responde.
//   (2) `off`/`dark` (consultor FORA do canário) → NÃO responde (cai no atual).
//   (3) `on` → responde (todos os clientes do consultor).
//   (4) erro no Cérebro / na leitura da flag → fail-open (respondeu=false).
//   (5) reúso EXATO do critério: `deveResponderComCerebro` = `isV2Active(flag)`.
//   (6) despacho da ação de cadastro via o repassador (despacho-cadastro.ts).
//   (7) envio real pelo sender do canal quando há `enviarTexto`.
//
// ESTRATÉGIA (isolado, sem rede): injetamos as dependências (`deps`) do hook —
// leitura de flag, `processarTurno` do Cérebro e o repassador de cadastro — por
// mocks. O Supabase é um objeto inerte (nunca usado de fato).
//
// Rodar:
//   deno test supabase/functions/_shared/cerebro/__tests__/resposta-hook.test.ts --no-check

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  deveResponderComCerebro,
  responderComCerebro,
  type EntradaRespostaHook,
} from "../resposta-hook.ts";
import { isV2Active, type FlowEngineV3Flag } from "../../feature-flag.ts";
import type {
  AcaoCadastroDeferida,
  InboundEvent,
  ResultadoCerebro,
} from "../tipos.ts";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const SUPABASE_INERTE = { from() { throw new Error("não deveria ser usado nos mocks"); } };

function resultadoCerebro(over: Partial<ResultadoCerebro> = {}): ResultadoCerebro {
  return {
    reply: "Olá! Posso te ajudar a economizar na conta de luz.",
    outbound: [{ kind: "text", text: "Olá!", idempotencyContent: "Olá!" }],
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

function montarDeps(opts: {
  flag: FlowEngineV3Flag;
  cerebroLanca?: boolean;
  flagLanca?: boolean;
  resultado?: ResultadoCerebro;
}) {
  const chamadas = {
    processarTurnoChamado: 0,
    ultimoInbound: null as InboundEvent | null,
    despachoChamado: 0,
    ultimaAcaoCadastro: null as AcaoCadastroDeferida | null,
  };
  const deps = {
    // deno-lint-ignore no-explicit-any
    lerFlag: (_s: any, _c: string) => {
      if (opts.flagLanca) throw new Error("falha ao ler flag");
      return Promise.resolve(opts.flag);
    },
    // deno-lint-ignore no-explicit-any
    processarTurno: (e: any) => {
      chamadas.processarTurnoChamado++;
      chamadas.ultimoInbound = e.inbound;
      if (opts.cerebroLanca) throw new Error("falha simulada no Cérebro");
      return Promise.resolve(opts.resultado ?? resultadoCerebro());
    },
    // deno-lint-ignore no-explicit-any
    despacharAcaoCadastro: (entrada: any) => {
      chamadas.despachoChamado++;
      chamadas.ultimaAcaoCadastro = entrada.acaoCadastro;
      return Promise.resolve({
        kind: entrada.acaoCadastro.kind,
        destino: "portal_worker" as const,
        acionouPortalWorker: entrada.acaoCadastro.kind === "portal_submit",
      });
    },
  };
  return { deps, chamadas };
}

function entradaBase(over: Partial<EntradaRespostaHook> = {}): EntradaRespostaHook {
  return {
    // deno-lint-ignore no-explicit-any
    supabase: SUPABASE_INERTE as any,
    customerId: "cliente-1",
    consultantId: "consultor-1",
    inboundText: "quero economizar",
    channel: "evolution",
    ...over,
  };
}

// ─── (5) Reúso EXATO do critério de canário (Req 2.4) ───────────────────────

Deno.test("deveResponderComCerebro espelha isV2Active (canary/on respondem; off/dark não)", async () => {
  const flags: FlowEngineV3Flag[] = ["off", "dark", "canary", "on"];
  for (const flag of flags) {
    const { deps } = montarDeps({ flag });
    const d = await deveResponderComCerebro(SUPABASE_INERTE as any, "consultor-1", deps);
    assertEquals(d.flag, flag);
    // O critério é LITERALMENTE o mesmo helper do engine v3.
    assertEquals(d.responder, isV2Active(flag), `flag ${flag} deveria seguir isV2Active`);
  }
});

Deno.test("deveResponderComCerebro é fail-open: erro de flag → não responde/off", async () => {
  const { deps } = montarDeps({ flag: "on", flagLanca: true });
  const d = await deveResponderComCerebro(SUPABASE_INERTE as any, "consultor-1", deps);
  assertEquals(d.responder, false);
  assertEquals(d.flag, "off");
});

// ─── (1) canary no subconjunto → responde (Req 2.4) ─────────────────────────

Deno.test("2.4: em `canary` (consultor no subconjunto), o Cérebro RESPONDE", async () => {
  const { deps, chamadas } = montarDeps({ flag: "canary" });
  const r = await responderComCerebro(entradaBase({ deps }));

  assertEquals(r.respondeu, true);
  assertEquals(r.flag, "canary");
  assert(r.reply && r.reply.length > 0, "deveria devolver o texto aprovado pela Guarda");
  assertEquals(r.shouldHandoff, false);
  assertEquals(chamadas.processarTurnoChamado, 1, "o Cérebro deveria rodar 1 vez");
});

// ─── (2) fora do canário (off/dark) → NÃO responde (Req 14.2) ───────────────

for (const flag of ["off", "dark"] as FlowEngineV3Flag[]) {
  Deno.test(`14.2: em \`${flag}\` (fora do canário), o Cérebro NÃO responde (cai no atual)`, async () => {
    const { deps, chamadas } = montarDeps({ flag });
    const r = await responderComCerebro(entradaBase({ deps }));

    assertEquals(r.respondeu, false);
    assertEquals(r.flag, flag);
    assertEquals(r.reply, null);
    assertEquals(r.enviou, false);
    assertEquals(chamadas.processarTurnoChamado, 0, "o Cérebro NÃO deve rodar fora de canary/on");
  });
}

// ─── (3) on → responde para todos ───────────────────────────────────────────

Deno.test("2.5/14.2: em `on`, o Cérebro responde (todos do consultor)", async () => {
  const { deps, chamadas } = montarDeps({ flag: "on" });
  const r = await responderComCerebro(entradaBase({ deps }));

  assertEquals(r.respondeu, true);
  assertEquals(r.flag, "on");
  assert(r.reply && r.reply.length > 0);
  assertEquals(chamadas.processarTurnoChamado, 1);
});

// ─── (4) Fail-open: erro no Cérebro nunca bloqueia ──────────────────────────

Deno.test("fail-open: erro no Cérebro é engolido — respondeu=false (cai no atual)", async () => {
  const { deps, chamadas } = montarDeps({ flag: "canary", cerebroLanca: true });
  const r = await responderComCerebro(entradaBase({ deps }));

  assertEquals(r.respondeu, false);
  assertEquals(r.reply, null);
  assertEquals(r.enviou, false);
  assertEquals(chamadas.processarTurnoChamado, 1, "o Cérebro foi chamado (e lançou)");
});

Deno.test("fail-open: erro ao ler a flag é engolido — não roda o Cérebro", async () => {
  const { deps, chamadas } = montarDeps({ flag: "canary", flagLanca: true });
  const r = await responderComCerebro(entradaBase({ deps }));
  assertEquals(r.respondeu, false);
  assertEquals(chamadas.processarTurnoChamado, 0);
});

// ─── (3b) on com handoff/sem texto → não envia ──────────────────────────────

Deno.test("em `on` com handoff/sem texto, respondeu=true porém reply=null e não envia", async () => {
  let enviouChamado = 0;
  const { deps } = montarDeps({
    flag: "on",
    resultado: resultadoCerebro({ reply: "", outbound: [], shouldHandoff: true }),
  });
  const r = await responderComCerebro(entradaBase({
    deps,
    enviarTexto: () => { enviouChamado++; return true; },
  }));

  assertEquals(r.respondeu, true);
  assertEquals(r.reply, null);
  assertEquals(r.shouldHandoff, true);
  assertEquals(r.enviou, false);
  assertEquals(enviouChamado, 0, "sem texto → sender não é chamado");
});

// ─── (6) Despacho da ação de cadastro via repassador existente ──────────────

Deno.test("11.1/14.1: ação de cadastro é repassada via despacho-cadastro.ts", async () => {
  const acaoCadastro: AcaoCadastroDeferida = { kind: "portal_submit" } as AcaoCadastroDeferida;
  const { deps, chamadas } = montarDeps({
    flag: "canary",
    resultado: resultadoCerebro({ acaoCadastro }),
  });
  const r = await responderComCerebro(entradaBase({ deps }));

  assertEquals(chamadas.despachoChamado, 1, "deveria repassar a ação de cadastro");
  assertEquals(chamadas.ultimaAcaoCadastro?.kind, "portal_submit");
  assertEquals(r.acaoCadastro?.kind, "portal_submit");
  assertEquals(r.despachoCadastro?.acionouPortalWorker, true);
});

Deno.test("sem ação de cadastro, o repassador NÃO é chamado", async () => {
  const { deps, chamadas } = montarDeps({ flag: "on" });
  const r = await responderComCerebro(entradaBase({ deps }));
  assertEquals(chamadas.despachoChamado, 0);
  assertEquals(r.acaoCadastro, undefined);
  assertEquals(r.despachoCadastro, undefined);
});

// ─── (7) Envio real pelo sender do canal ────────────────────────────────────

Deno.test("envia o reply pelo sender do canal quando `enviarTexto` é fornecido", async () => {
  const enviados: string[] = [];
  const { deps } = montarDeps({ flag: "canary" });
  const r = await responderComCerebro(entradaBase({
    deps,
    enviarTexto: (t) => { enviados.push(t); return true; },
  }));

  assertEquals(r.enviou, true);
  assertEquals(enviados.length, 1);
  assert(enviados[0].length > 0);
});

Deno.test("sem `enviarTexto`, devolve reply/outbound mas não envia (chamador envia)", async () => {
  const { deps } = montarDeps({ flag: "canary" });
  const r = await responderComCerebro(entradaBase({ deps }));
  assertEquals(r.enviou, false);
  assert(r.reply && r.reply.length > 0, "reply é devolvido para o chamador enviar");
  assert(r.outbound.length > 0);
});

Deno.test("falha no sender do canal não derruba o turno (enviou=false)", async () => {
  const { deps } = montarDeps({ flag: "on" });
  const r = await responderComCerebro(entradaBase({
    deps,
    enviarTexto: () => { throw new Error("canal fora do ar"); },
  }));
  assertEquals(r.respondeu, true, "o turno rodou mesmo com falha de envio");
  assertEquals(r.enviou, false);
});

// ─── Inbound sintético montado a partir do webhook ──────────────────────────

Deno.test("monta o InboundEvent a partir do inbound do webhook (texto)", async () => {
  const { deps, chamadas } = montarDeps({ flag: "canary" });
  await responderComCerebro(entradaBase({ deps, inboundText: "oi" }));
  assertEquals(chamadas.ultimoInbound?.kind, "text");
});

Deno.test("monta o InboundEvent a partir do inbound do webhook (mídia)", async () => {
  const { deps, chamadas } = montarDeps({ flag: "canary" });
  await responderComCerebro(entradaBase({
    deps,
    inboundText: null,
    inboundMediaKind: "image",
    inboundMessageId: "m1",
  }));
  assertEquals(chamadas.ultimoInbound?.kind, "media");
});

// ─── (8) Rollback em segundos via chave (Req 2.6 / Tarefa 14.3) ─────────────
//
// PROVA do rollback: MESMA entrada (mesmo cliente, consultor e mensagem), só a
// flag do consultor muda. Em `canary`/`on` o Cérebro responde; depois de baixar
// a flag para `dark`/`off` (rollback pelo RolloutPanel ou UPDATE por consultor),
// o gate `deveResponderComCerebro` passa a devolver false e o Cérebro NÃO
// responde mais — o caminho atual (vendedora) volta a responder. Sem deploy.

for (const flagLigado of ["canary", "on"] as FlowEngineV3Flag[]) {
  for (const flagDesligado of ["dark", "off"] as FlowEngineV3Flag[]) {
    Deno.test(
      `2.6: rollback \`${flagLigado}\` → \`${flagDesligado}\` desliga a resposta na mesma entrada`,
      async () => {
        // Estado mutável da flag: simula o operador baixando a chave do consultor.
        let flagAtual: FlowEngineV3Flag = flagLigado;
        const chamadas = { processarTurno: 0 };
        const deps = {
          // deno-lint-ignore no-explicit-any
          lerFlag: (_s: any, _c: string) => Promise.resolve(flagAtual),
          // deno-lint-ignore no-explicit-any
          processarTurno: (_e: any) => {
            chamadas.processarTurno++;
            return Promise.resolve(resultadoCerebro());
          },
        };

        const entrada = () => entradaBase({ deps });

        // ANTES do rollback: o Cérebro é fonte de verdade e responde.
        const antes = await responderComCerebro(entrada());
        assertEquals(antes.respondeu, true, `em \`${flagLigado}\` deveria responder`);
        assertEquals(antes.flag, flagLigado);
        assert(antes.reply && antes.reply.length > 0);

        // ROLLBACK: baixar a chave do consultor (sem mexer em código/deploy).
        flagAtual = flagDesligado;

        // DEPOIS do rollback: MESMA entrada, só a flag mudou → não responde.
        const depois = await responderComCerebro(entrada());
        assertEquals(depois.respondeu, false, `em \`${flagDesligado}\` NÃO deveria responder`);
        assertEquals(depois.flag, flagDesligado);
        assertEquals(depois.reply, null);
        assertEquals(depois.enviou, false);
        // O Cérebro só rodou no turno "ligado"; após o rollback nem é invocado.
        assertEquals(chamadas.processarTurno, 1, "o Cérebro não deve rodar após o rollback");
      },
    );
  }
}

// ─── Fase 2 (migração Vendedora→Cérebro): nudge interno ─────────────────────
//
// Quando o cron `process-followups` chama o hook com
// `inboundKind="nudge_interno"`, o turno é traduzido para `no_input` (mesma
// porta de reaquecimento que o `followup-hook.ts` já usa). O `nudgeHook`
// textual é metadata para auditoria — NÃO entra como `text` no motor, para
// evitar que o Cérebro responda achando que o lead falou algo.

Deno.test("Fase 2: nudge_interno é tratado como `no_input` (não vira `text`)", async () => {
  const { deps, chamadas } = montarDeps({ flag: "on" });
  const r = await responderComCerebro(entradaBase({
    deps,
    inboundKind: "nudge_interno",
    inboundText: "lead silente há 24h",
    nudgeHook: "reaqueça com prova social",
  }));

  assertEquals(r.respondeu, true);
  assertEquals(chamadas.processarTurnoChamado, 1);
  assertEquals(
    chamadas.ultimoInbound?.kind,
    "no_input",
    "nudge_interno deve virar no_input para o Cérebro (não `text`)",
  );
});

Deno.test("Fase 2: nudge_interno sem hook ainda funciona (hook é opcional)", async () => {
  const { deps, chamadas } = montarDeps({ flag: "canary" });
  const r = await responderComCerebro(entradaBase({
    deps,
    inboundKind: "nudge_interno",
    inboundText: null,
  }));
  assertEquals(r.respondeu, true);
  assertEquals(chamadas.ultimoInbound?.kind, "no_input");
});

Deno.test("Fase 2: nudge_interno em `off` NÃO responde (cai no caminho atual)", async () => {
  const { deps, chamadas } = montarDeps({ flag: "off" });
  const r = await responderComCerebro(entradaBase({
    deps,
    inboundKind: "nudge_interno",
    nudgeHook: "reaqueça",
  }));
  assertEquals(r.respondeu, false);
  assertEquals(chamadas.processarTurnoChamado, 0);
});
