// Testes do hook de SOMBRA do Cérebro IA (pt-BR) — Tarefa 9.1.
//
// Spec: `.kiro/specs/cerebro-ia/design.md` — "Fluxo de um turno", "Ativação
// segura", "Error Handling".
// Valida: Requisitos 2.1 (lê a flag), 2.3 (só roda em `dark`, sem enviar),
// 3.1/3.3 (grava 1 registro por turno; nada é enviado ao cliente) e fail-open
// (erro no Cérebro não propaga).
//
// ESTRATÉGIA (isolado, sem rede): injetamos as dependências (`deps`) do hook —
// leitura de flag, `processarTurno` do Cérebro e o registrador — por mocks. Isso
// exercita SÓ a orquestração do hook (gate por estágio, montagem do inbound,
// registro, fail-open) sem tocar banco nem IA. O Supabase é um objeto inerte
// (nunca é usado de fato, pois os mocks substituem quem o usaria).
//
// Rodar:
//   deno test supabase/functions/_shared/cerebro/__tests__/sombra-hook.test.ts --no-check

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  derivarDecisaoSistemaAtual,
  executarCerebroSombra,
  montarInbound,
  type EntradaSombraHook,
} from "../sombra-hook.ts";
import type { FlowEngineV3Flag } from "../../feature-flag.ts";
import type { ResultadoCerebro } from "../tipos.ts";
import type { ResumoDecisaoTurno } from "../registro-decisao.ts";

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

/** Monta deps mockadas e captura as chamadas para asserção. */
function montarDeps(opts: {
  flag: FlowEngineV3Flag;
  coincide?: boolean;
  okRegistro?: boolean;
  cerebroLanca?: boolean;
  flagLanca?: boolean;
}) {
  const chamadas = {
    processarTurnoChamado: 0,
    registrarChamado: 0,
    ultimaDecisaoSistemaAtual: null as ResumoDecisaoTurno | null,
  };
  const deps = {
    // deno-lint-ignore no-explicit-any
    lerFlag: (_s: any, _c: string) => {
      if (opts.flagLanca) throw new Error("falha ao ler flag");
      return Promise.resolve(opts.flag);
    },
    // deno-lint-ignore no-explicit-any
    processarTurno: (_e: any) => {
      chamadas.processarTurnoChamado++;
      if (opts.cerebroLanca) throw new Error("falha simulada no Cérebro");
      return Promise.resolve(resultadoCerebro());
    },
    // deno-lint-ignore no-explicit-any
    registrarDecisaoSombra: (entrada: any) => {
      chamadas.registrarChamado++;
      chamadas.ultimaDecisaoSistemaAtual = entrada.decisaoSistemaAtual;
      return Promise.resolve({
        ok: opts.okRegistro ?? true,
        coincide: opts.coincide ?? true,
      });
    },
  };
  return { deps, chamadas };
}

function entradaBase(over: Partial<EntradaSombraHook> = {}): EntradaSombraHook {
  return {
    // deno-lint-ignore no-explicit-any
    supabase: SUPABASE_INERTE as any,
    customerId: "cliente-1",
    consultantId: "consultor-1",
    legacyStep: "passo-2",
    inboundText: "quero economizar",
    channel: "evolution",
    ...over,
  };
}

// ─── montarInbound / derivarDecisaoSistemaAtual (lógica pura) ───────────────

Deno.test("montarInbound: texto vira InboundEvent text", () => {
  const ev = montarInbound(entradaBase({ inboundText: "oi" }));
  assertEquals(ev.kind, "text");
});

Deno.test("montarInbound: mídia vira InboundEvent media", () => {
  const ev = montarInbound(entradaBase({ inboundText: null, inboundMediaKind: "image", inboundMessageId: "m1" }));
  assertEquals(ev.kind, "media");
});

Deno.test("montarInbound: dígitos viram number_reply; vazio vira no_input", () => {
  assertEquals(montarInbound(entradaBase({ inboundText: "2" })).kind, "number_reply");
  assertEquals(montarInbound(entradaBase({ inboundText: "" })).kind, "no_input");
});

Deno.test("derivarDecisaoSistemaAtual: texto → responder no passo legado; mídia → ocr", () => {
  const txt = derivarDecisaoSistemaAtual(entradaBase(), montarInbound(entradaBase()));
  assertEquals(txt, { passo: "passo-2", acao: "responder" });

  const ent = entradaBase({ inboundText: null, inboundMediaKind: "image", inboundMessageId: "m1" });
  const media = derivarDecisaoSistemaAtual(ent, montarInbound(ent));
  assertEquals(media.acao, "ocr");
});

// ─── Gate por estágio (Requisito 2.1, 2.2, 2.3) ─────────────────────────────

Deno.test("dark: dispara o Cérebro e registra a comparação, sem enviar (Req 2.3, 3.1, 3.3)", async () => {
  const { deps, chamadas } = montarDeps({ flag: "dark", coincide: true });
  const r = await executarCerebroSombra(entradaBase({ deps }));

  assertEquals(r.executou, true);
  assertEquals(r.flag, "dark");
  assertEquals(r.registrou, true);
  assertEquals(r.coincide, true);
  // Invariante de sombra: NADA é enviado ao cliente (Req 3.3).
  assertEquals(r.enviouAoCliente, false);
  // Rodou o Cérebro e gravou exatamente uma vez (Req 3.1).
  assertEquals(chamadas.processarTurnoChamado, 1);
  assertEquals(chamadas.registrarChamado, 1);
});

Deno.test("off: Cérebro inativo — não roda nem registra (Req 2.2)", async () => {
  const { deps, chamadas } = montarDeps({ flag: "off" });
  const r = await executarCerebroSombra(entradaBase({ deps }));
  assertEquals(r.executou, false);
  assertEquals(r.flag, "off");
  assertEquals(r.registrou, false);
  assertEquals(r.coincide, null);
  assertEquals(chamadas.processarTurnoChamado, 0);
  assertEquals(chamadas.registrarChamado, 0);
});

Deno.test("canary/on: hook de sombra não faz nada (envio é tratado por outra peça)", async () => {
  for (const flag of ["canary", "on"] as FlowEngineV3Flag[]) {
    const { deps, chamadas } = montarDeps({ flag });
    const r = await executarCerebroSombra(entradaBase({ deps }));
    assertEquals(r.executou, false);
    assertEquals(r.flag, flag);
    assertEquals(chamadas.processarTurnoChamado, 0);
    assertEquals(chamadas.registrarChamado, 0);
  }
});

// ─── Normalização da decisão do sistema atual ───────────────────────────────

Deno.test("dark: usa a decisão do sistema atual já normalizada quando fornecida", async () => {
  const { deps, chamadas } = montarDeps({ flag: "dark" });
  const decisaoSistemaAtual: ResumoDecisaoTurno = { passo: "passo-9", acao: "handoff" };
  await executarCerebroSombra(entradaBase({ deps, decisaoSistemaAtual }));
  assertEquals(chamadas.ultimaDecisaoSistemaAtual, decisaoSistemaAtual);
});

Deno.test("dark: deriva conservadoramente quando não há decisão normalizada", async () => {
  const { deps, chamadas } = montarDeps({ flag: "dark" });
  await executarCerebroSombra(entradaBase({ deps, decisaoSistemaAtual: undefined }));
  // legacyStep = "passo-2", inbound texto → { passo: "passo-2", acao: "responder" }.
  assertEquals(chamadas.ultimaDecisaoSistemaAtual, { passo: "passo-2", acao: "responder" });
});

// ─── Fail-open (Error Handling do design) ───────────────────────────────────

Deno.test("fail-open: erro no Cérebro é engolido — não propaga e devolve neutro", async () => {
  const { deps, chamadas } = montarDeps({ flag: "dark", cerebroLanca: true });
  const r = await executarCerebroSombra(entradaBase({ deps }));
  assertEquals(r.executou, false);
  assertEquals(r.registrou, false);
  assertEquals(r.enviouAoCliente, false);
  // O Cérebro foi chamado (e lançou), mas o registro nunca ocorreu.
  assertEquals(chamadas.processarTurnoChamado, 1);
  assertEquals(chamadas.registrarChamado, 0);
});

Deno.test("fail-open: erro ao ler a flag é engolido — não roda o Cérebro", async () => {
  const { deps, chamadas } = montarDeps({ flag: "dark", flagLanca: true });
  const r = await executarCerebroSombra(entradaBase({ deps }));
  assertEquals(r.executou, false);
  assertEquals(chamadas.processarTurnoChamado, 0);
});

Deno.test("dark: registro com coincide=false é refletido no resultado", async () => {
  const { deps } = montarDeps({ flag: "dark", coincide: false, okRegistro: true });
  const r = await executarCerebroSombra(entradaBase({ deps }));
  assertEquals(r.coincide, false);
  assertEquals(r.registrou, true);
});

Deno.test("invariante: o resultado do hook nunca expõe envio ao cliente", async () => {
  const { deps } = montarDeps({ flag: "dark" });
  const r = await executarCerebroSombra(entradaBase({ deps }));
  // `enviouAoCliente` é literalmente `false` no tipo — checagem em runtime.
  assert(r.enviouAoCliente === false);
});
