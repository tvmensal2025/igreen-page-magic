// Teste de integração da peça N3 — Decisor de Passo (pt-BR) — Tarefa 4.5.
//
// Spec: `.kiro/specs/cerebro-ia/` — Tarefa 4.5
//   ("Teste: mudar `bot_flow_steps` muda a decisão sem mexer no código").
//
// Property 3 do design.md — "A ordem vem do dado": mudar `bot_flow_steps` muda
// a decisão de N3 sem alterar código.
//
// Validates: Requirements 6.2, 6.3
//   - 6.2: o Decisor determina a ORDEM dos passos a partir dos dados de
//          `bot_flow_steps`, sem sequência fixa escrita no código.
//   - 6.3: quando o consultor altera os passos no construtor visual, o Decisor
//          passa a decidir conforme os passos atualizados, SEM alteração de
//          código.
//
// Estratégia (conforme a tarefa): exercitamos `decidirPasso` — que chama
// `loadContext` + `runEngine` de verdade — com um Supabase MOCKADO que devolve
// DOIS conjuntos diferentes de `bot_flow_steps`/estado. O MESMO código produz
// decisões DIFERENTES porque a única coisa que muda entre as execuções são os
// dados do fluxo (os passos montados no construtor visual). Nenhuma linha de
// código de decisão é tocada entre um caso e outro — é exatamente isso que a
// Property 3 garante.
//
// O mock reproduz fielmente as consultas que `engine/loader.ts` (loadContext)
// faz: `customers` (com `customer_flow_state` aninhado), `bot_flows`,
// `bot_flow_steps`, `consultants` e `ai_media_library`.
//
// Puro de rede (sem internet). Rodar:
//   deno test supabase/functions/_shared/cerebro/__tests__/decisor-passo.fluxo-dados.test.ts --no-check

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

import { decidirPasso } from "../decisor-passo.ts";
import type {
  ChannelCapabilities,
  InboundEvent,
  ResultadoEntendimento,
} from "../tipos.ts";

// ─── Constantes do cenário ──────────────────────────────────────────────────

const CONSULTANT_ID = "consultor-1";
const CUSTOMER_ID = "cliente-1";
const FLOW_ID = "fluxo-1";

// Ids de passo em formato UUID — o loader trata `current_step_id` que não é
// UUID como cliente novo, então usamos UUIDs reais para os cenários com
// cliente já posicionado num passo.
const ID_BOAS_VINDAS = "11111111-1111-1111-1111-111111111111";
const ID_PEDE_NOME = "22222222-2222-2222-2222-222222222222";
const ID_PEDE_VALOR = "33333333-3333-3333-3333-333333333333";
const ID_PLANOS = "44444444-4444-4444-4444-444444444444";
const ID_CADASTRO = "55555555-5555-5555-5555-555555555555";

// Capacidades de canal mínimas e válidas (Evolution).
const CAPS: ChannelCapabilities = {
  channel: "evolution",
  supportsButtons: true,
  maxButtons: 3,
  supportsList: true,
  supportsAudio: true,
  supportsVideo: true,
  supportsTypingPresence: true,
  supportsReactions: false,
  inboundIdField: "messageId",
};

// Entendimento neutro (N2). O Decisor de Passo NÃO usa a etapa daqui — a etapa
// vem sempre do fluxo (Requisito 6.4) — então este objeto é só o contrato.
const ENTENDIMENTO: ResultadoEntendimento = { intencao: "indefinido", dados: {} };

// ─── Fixture de uma linha crua de `bot_flow_steps` ──────────────────────────
//
// Espelha as colunas que `loadContext` lê de `bot_flow_steps`. A ORDEM é dada
// por `position` (como na tabela real) — nunca por sequência fixa no código.
interface PassoCru {
  id: string;
  step_key: string;
  step_type: string;
  position: number;
  message_text: string;
  transitions: unknown[];
  fallback: Record<string, unknown>;
}

function passoCru(
  id: string,
  stepKey: string,
  position: number,
  over: Partial<PassoCru> = {},
): Record<string, unknown> {
  return {
    id,
    flow_id: FLOW_ID,
    step_key: stepKey,
    step_type: "text_message",
    position,
    message_text: `mensagem ${stepKey}`,
    persuasive_text: null,
    captures: [],
    transitions: over.transitions ?? [],
    fallback: over.fallback ?? { mode: "repeat" },
    wait_for: "none",
    wait_seconds: 0,
    slot_key: null,
    condition_text: null,
    preferred_choice_kind: null,
    is_active: true,
  };
}

// ─── Supabase MOCKADO que cobre as consultas do loadContext ─────────────────
//
// Builder PostgREST fluente e enxuto: acumula filtros `.eq(...)`, resolve em
// `.maybeSingle()` (primeira linha) ou ao ser aguardado com `await` (lista).
// `.or()/.is()/.not()/.gte()/.order()/.limit()` são reconhecidos para manter a
// cadeia. As linhas de cada tabela são filtradas pelos `.eq(...)` aplicados.
function montarSupabaseMock(
  steps: Array<Record<string, unknown>>,
  flowStateRow: Record<string, unknown> | null,
) {
  const store: Record<string, Array<Record<string, unknown>>> = {
    customers: [
      {
        id: CUSTOMER_ID,
        consultant_id: CONSULTANT_ID,
        flow_variant: "A",
        name: flowStateRow ? "Cliente Teste" : null,
        electricity_bill_value: null,
        document_uploaded: false,
        otp_validated_at: null,
        phone_whatsapp: "5511999999999",
        bot_paused: false,
        bot_paused_reason: null,
        conversation_step: null,
        // O loader lê `customer.customer_flow_state` (objeto aninhado).
        customer_flow_state: flowStateRow,
      },
    ],
    bot_flows: [
      {
        id: FLOW_ID,
        consultant_id: CONSULTANT_ID,
        variant: "A",
        is_active: true,
        is_public: false,
        // `sync_mode: "local"` faz o loader usar o fluxo do próprio consultor,
        // sem buscar um fluxo público — mantém o mock focado no que importa.
        sync_mode: "local",
        strict_mode: false,
        created_at: "2024-01-01T00:00:00.000Z",
      },
    ],
    bot_flow_steps: steps,
    consultants: [{ id: CONSULTANT_ID, flow_step_media_order: {} }],
    ai_media_library: [],
  };

  function builder(table: string) {
    const filters: Array<{ col: string; val: unknown }> = [];

    const aplicarFiltros = (rows: Array<Record<string, unknown>>) =>
      rows.filter((r) => filters.every((f) => r[f.col] === f.val));

    const resolver = () => {
      const tbl = store[table] ?? [];
      const rows = aplicarFiltros(tbl);
      return { data: rows, error: null };
    };

    const chain: Record<string, unknown> = {
      select() {
        return chain;
      },
      eq(col: string, val: unknown) {
        filters.push({ col, val });
        return chain;
      },
      // Operadores que o loader encadeia mas que não precisamos filtrar aqui.
      or() {
        return chain;
      },
      is() {
        return chain;
      },
      not() {
        return chain;
      },
      gte() {
        return chain;
      },
      order() {
        return chain;
      },
      limit() {
        return chain;
      },
      maybeSingle() {
        const r = resolver();
        return Promise.resolve({ data: r.data[0] ?? null, error: r.error });
      },
      // Torna a cadeia "thenable": `await` numa SELECT lista devolve as linhas.
      then(onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) {
        return Promise.resolve(resolver()).then(onFulfilled, onRejected);
      },
    };
    return chain;
  }

  // deno-lint-ignore no-explicit-any
  return { from: builder } as any;
}

const TEXTO = (text: string): InboundEvent => ({ kind: "text", text });

// ────────────────────────────────────────────────────────────────────────────
// Property 3 — A ORDEM vem do dado (cliente novo): trocar qual passo é o
// primeiro no construtor visual (menor `position`) muda o passo decidido por
// N3, sem mexer no código. Requisitos 6.2 e 6.3.
// ────────────────────────────────────────────────────────────────────────────

Deno.test("Property 3 (6.2/6.3): reordenar bot_flow_steps muda o passo de entrada decidido por N3 — mesmo código", async () => {
  // Conjunto A — o consultor montou "boas_vindas" como PRIMEIRO passo (pos 0).
  const conjuntoA = [
    passoCru(ID_BOAS_VINDAS, "boas_vindas", 0),
    passoCru(ID_PEDE_NOME, "pede_nome", 1),
    passoCru(ID_PEDE_VALOR, "pede_valor", 2),
  ];

  // Conjunto B — MESMOS passos, porém reordenados no construtor visual:
  // agora "pede_nome" é o primeiro (pos 0) e "boas_vindas" foi para o fim.
  const conjuntoB = [
    passoCru(ID_PEDE_NOME, "pede_nome", 0),
    passoCru(ID_PEDE_VALOR, "pede_valor", 1),
    passoCru(ID_BOAS_VINDAS, "boas_vindas", 2),
  ];

  const entradaBase = {
    customerId: CUSTOMER_ID,
    inbound: TEXTO("oi, tudo bem?"),
    entendimento: ENTENDIMENTO,
    capabilities: CAPS,
  };

  // Cliente NOVO (sem estado): o motor entra pelo passo de menor `position`.
  const decisaoA = await decidirPasso({
    ...entradaBase,
    supabase: montarSupabaseMock(conjuntoA, null),
  });
  const decisaoB = await decidirPasso({
    ...entradaBase,
    supabase: montarSupabaseMock(conjuntoB, null),
  });

  // A decisão segue OS DADOS: no conjunto A entra em "boas_vindas"; no B, em
  // "pede_nome". Nenhuma linha de código mudou entre as duas execuções.
  assertEquals(decisaoA.proximoPasso?.stepKey, "boas_vindas");
  assertEquals(decisaoB.proximoPasso?.stepKey, "pede_nome");

  // E, de fato, as decisões divergem só por causa do dado do fluxo.
  assert(
    decisaoA.proximoPasso?.id !== decisaoB.proximoPasso?.id,
    "mudar a ordem dos passos no construtor deve mudar a decisão de N3",
  );
});

// ────────────────────────────────────────────────────────────────────────────
// Property 3 — A ORDEM vem do dado (cliente em conversa): mudar o DESTINO de
// uma transição no construtor visual muda para qual passo N3 avança, com o
// mesmo gatilho do cliente e sem mexer no código. Requisitos 6.2 e 6.3.
// ────────────────────────────────────────────────────────────────────────────

Deno.test("Property 3 (6.2/6.3): mudar o destino da transição em bot_flow_steps muda o próximo passo de N3 — mesmo código", async () => {
  // Passo inicial onde o cliente já está; ele responde "sim".
  const flowStateNoPasso = {
    current_step_id: ID_BOAS_VINDAS,
    status: "running",
    pause_reason: null,
    retries: 0,
    ai_questions_this_step: 0,
    entered_step_at: "2024-01-01T00:00:00.000Z",
    expires_at: null,
    last_inbound_at: null,
    last_outbound_at: null,
    last_outbound_content_hash: null,
    flow_id: FLOW_ID,
    updated_at: "2024-01-01T00:00:00.000Z",
  };

  // Conjunto A — no construtor, "sim" a partir de boas_vindas leva a PLANOS.
  const conjuntoA = [
    passoCru(ID_BOAS_VINDAS, "boas_vindas", 0, {
      transitions: [{ trigger_phrases: ["sim"], goto_step_id: ID_PLANOS }],
    }),
    passoCru(ID_PLANOS, "planos", 1),
    passoCru(ID_CADASTRO, "cadastro", 2),
  ];

  // Conjunto B — MESMO gatilho ("sim"), MESMO passo de origem, mas o consultor
  // mudou o destino no construtor: agora leva direto ao CADASTRO.
  const conjuntoB = [
    passoCru(ID_BOAS_VINDAS, "boas_vindas", 0, {
      transitions: [{ trigger_phrases: ["sim"], goto_step_id: ID_CADASTRO }],
    }),
    passoCru(ID_PLANOS, "planos", 1),
    passoCru(ID_CADASTRO, "cadastro", 2),
  ];

  const entradaBase = {
    customerId: CUSTOMER_ID,
    inbound: TEXTO("sim"),
    entendimento: ENTENDIMENTO,
    capabilities: CAPS,
  };

  const decisaoA = await decidirPasso({
    ...entradaBase,
    supabase: montarSupabaseMock(conjuntoA, flowStateNoPasso),
  });
  const decisaoB = await decidirPasso({
    ...entradaBase,
    supabase: montarSupabaseMock(conjuntoB, flowStateNoPasso),
  });

  // O passo ATUAL é o mesmo nos dois casos (o cliente está em boas_vindas)...
  assertEquals(decisaoA.passoAtual?.stepKey, "boas_vindas");
  assertEquals(decisaoB.passoAtual?.stepKey, "boas_vindas");

  // ...mas o PRÓXIMO passo segue o destino configurado no fluxo: planos no
  // conjunto A, cadastro no conjunto B. Só o dado mudou.
  assertEquals(decisaoA.proximoPasso?.stepKey, "planos");
  assertEquals(decisaoB.proximoPasso?.stepKey, "cadastro");
  assert(
    decisaoA.proximoPasso?.id !== decisaoB.proximoPasso?.id,
    "mudar o destino da transição no construtor deve mudar a decisão de N3",
  );
});
