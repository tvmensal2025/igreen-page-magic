// Testes do hook de FOLLOW-UP / REATIVAÇÃO do Cérebro IA (pt-BR) — Tarefa 13.
//
// Spec: `.kiro/specs/cerebro-ia/design.md` — "Automação (follow-up / reativação)
// religada ao Cérebro". Requisitos 14.1 e 14.2.
//
// O QUE PROVAMOS
// --------------
//   (1) Em `flow_engine_v3 = on`, o nudge passa pelo Cérebro: `usouCerebro=true`
//       e o `processarTurno` é chamado com inbound sintético `no_input`.
//   (2) Em `off`/`dark`/`canary`, o hook devolve `usouCerebro=false` (o cron
//       segue chamando a Vendedora_Atual, SEM mudança — Req 14.2).
//   (3) Fail-open: erro no Cérebro OU na leitura da flag NUNCA propaga; devolve
//       `usouCerebro=false` para o follow-up nunca parar.
//   (4) `decidirCanalFollowup` mapeia corretamente flag → destino.
//
// ESTRATÉGIA (isolado, sem rede): injetamos as dependências (`deps`) do hook —
// leitura de flag e `processarTurno` do Cérebro — por mocks. O Supabase é um
// objeto inerte (nunca usado de fato).
//
// Rodar:
//   deno test supabase/functions/_shared/cerebro/__tests__/followup-hook.test.ts --no-check

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  decidirCanalFollowup,
  executarFollowupCerebro,
  type EntradaFollowupHook,
} from "../followup-hook.ts";
import type { FlowEngineV3Flag } from "../../feature-flag.ts";
import type { InboundEvent, ResultadoCerebro } from "../tipos.ts";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const SUPABASE_INERTE = { from() { throw new Error("não deveria ser usado nos mocks"); } };

function resultadoCerebro(over: Partial<ResultadoCerebro> = {}): ResultadoCerebro {
  return {
    reply: "Oi! Voltei aqui pra te ajudar a economizar na conta de luz. 💚",
    outbound: [{ kind: "text", text: "Oi!", idempotencyContent: "Oi!" }],
    stateUpdate: { conversation_step: "reaquecimento" } as ResultadoCerebro["stateUpdate"],
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
  };
  return { deps, chamadas };
}

function entradaBase(over: Partial<EntradaFollowupHook> = {}): EntradaFollowupHook {
  return {
    // deno-lint-ignore no-explicit-any
    supabase: SUPABASE_INERTE as any,
    customerId: "cliente-1",
    consultantId: "consultor-1",
    channel: "evolution",
    ...over,
  };
}

// ─── (1) Em `on`: nudge passa pelo Cérebro com inbound `no_input` ────────────

Deno.test("14.1: em `on`, o follow-up vai pelo Cérebro (no_input) e devolve o texto", async () => {
  const { deps, chamadas } = montarDeps({ flag: "on" });
  const r = await executarFollowupCerebro({ ...entradaBase(), deps });

  assertEquals(r.usouCerebro, true);
  assertEquals(r.flag, "on");
  assert(r.reply && r.reply.length > 0, "deveria devolver o texto de reaquecimento");
  assertEquals(r.shouldHandoff, false);
  assertEquals(chamadas.processarTurnoChamado, 1, "o Cérebro deveria rodar 1 vez");
  assertEquals(chamadas.ultimoInbound?.kind, "no_input", "o nudge deve ser inbound sintético no_input");
});

// ─── (2) Fora de `on`: segue pela Vendedora_Atual (sem mudança) ──────────────

for (const flag of ["off", "dark", "canary"] as FlowEngineV3Flag[]) {
  Deno.test(`14.2: em \`${flag}\`, NÃO usa o Cérebro (cron segue na Vendedora_Atual)`, async () => {
    const { deps, chamadas } = montarDeps({ flag });
    const r = await executarFollowupCerebro({ ...entradaBase(), deps });

    assertEquals(r.usouCerebro, false);
    assertEquals(r.flag, flag);
    assertEquals(r.reply, null);
    assertEquals(chamadas.processarTurnoChamado, 0, "o Cérebro NÃO deve rodar fora de `on`");
  });
}

// ─── (3) Fail-open: erro no Cérebro nunca impede o follow-up ─────────────────

Deno.test("14.2: erro no Cérebro é engolido (fail-open → vendedora)", async () => {
  const { deps } = montarDeps({ flag: "on", cerebroLanca: true });
  const r = await executarFollowupCerebro({ ...entradaBase(), deps });

  assertEquals(r.usouCerebro, false, "com erro, cai na Vendedora_Atual");
  assertEquals(r.reply, null);
});

Deno.test("14.2: erro ao ler a flag é engolido (fail-open → vendedora)", async () => {
  const { deps } = montarDeps({ flag: "on", flagLanca: true });
  const r = await executarFollowupCerebro({ ...entradaBase(), deps });

  assertEquals(r.usouCerebro, false);
  assertEquals(r.flag, "off", "flag colapsa para off em erro");
});

// ─── (3b) Cérebro em `on` mas sem texto (handoff) → não envia ────────────────

Deno.test("14.1: em `on` com handoff/sem texto, usouCerebro=true porém reply=null", async () => {
  const { deps } = montarDeps({
    flag: "on",
    resultado: resultadoCerebro({ reply: "", outbound: [], shouldHandoff: true }),
  });
  const r = await executarFollowupCerebro({ ...entradaBase(), deps });

  assertEquals(r.usouCerebro, true);
  assertEquals(r.reply, null, "sem texto → cron não envia");
  assertEquals(r.shouldHandoff, true);
});

// ─── (4) decidirCanalFollowup: flag → destino ────────────────────────────────

Deno.test("decidirCanalFollowup mapeia flag → destino (só `on` vira Cérebro)", async () => {
  const casos: Array<[FlowEngineV3Flag, "cerebro" | "vendedora"]> = [
    ["off", "vendedora"],
    ["dark", "vendedora"],
    ["canary", "vendedora"],
    ["on", "cerebro"],
  ];
  for (const [flag, destinoEsperado] of casos) {
    const { deps } = montarDeps({ flag });
    const d = await decidirCanalFollowup(SUPABASE_INERTE as any, "consultor-1", deps);
    assertEquals(d.destino, destinoEsperado, `flag ${flag} deveria ir para ${destinoEsperado}`);
    assertEquals(d.flag, flag);
  }
});

Deno.test("decidirCanalFollowup é fail-open: erro de flag → vendedora/off", async () => {
  const { deps } = montarDeps({ flag: "on", flagLanca: true });
  const d = await decidirCanalFollowup(SUPABASE_INERTE as any, "consultor-1", deps);
  assertEquals(d.destino, "vendedora");
  assertEquals(d.flag, "off");
});
