// Testes do módulo isolado da peça N1 — Orquestrador (pt-BR) — Tarefa 7.
//
// Spec: `.kiro/specs/cerebro-ia/design.md` — peça N1 e "Fluxo de um turno".
//
// Valida: Requisito 1.3 (caminho único, coordena as peças sem regra de negócio)
// e 16.5 (fail-open / controle de custo: erro nunca trava o atendimento).
//
// ESTRATÉGIA (entrada sintética → saída, sem enviar nada):
//   `processarTurno` chama as peças reais (N8/N2/N3/N4/N5), que por baixo tocam
//   o Supabase (via `loadContext`/`loadFlowState`) e o gateway de IA (via
//   `chatCascade`/`embed`). Para testar o ORQUESTRADOR de forma isolada e
//   offline, mockamos as duas únicas fronteiras de I/O:
//     - SUPABASE: um cliente fake que reproduz as consultas do `loadContext`
//       (customers + customer_flow_state aninhado, bot_flows, bot_flow_steps,
//       consultants, ai_media_library) — o MESMO mock usado no teste do N3.
//     - IA (gateway): sem `LOVABLE_API_KEY` o gateway lança na hora (sem rede),
//       então o Escritor cai no texto seguro do passo e o RAG devolve []. Tudo
//       determinístico e sem tráfego real.
//   Assim exercitamos a COORDENAÇÃO completa (ordem das peças, fail-open,
//   handoff, repasse de cadastro) sem nada sair para o cliente.
//
// Rodar:
//   deno test supabase/functions/_shared/cerebro/__tests__/index.test.ts --no-check

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { processarTurno } from "../index.ts";
import type {
  ChannelCapabilities,
  EntradaCerebro,
  InboundEvent,
} from "../tipos.ts";

// ─── Constantes do cenário ──────────────────────────────────────────────────

const CONSULTANT_ID = "consultor-1";
const CUSTOMER_ID = "cliente-1";
const FLOW_ID = "fluxo-1";

const ID_BOAS_VINDAS = "11111111-1111-1111-1111-111111111111";
const ID_PEDE_NOME = "22222222-2222-2222-2222-222222222222";

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

// ─── Fixture de linha crua de bot_flow_steps ────────────────────────────────

function passoCru(
  id: string,
  stepKey: string,
  position: number,
  over: Record<string, unknown> = {},
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
    transitions: [],
    fallback: { mode: "repeat" },
    wait_for: "none",
    wait_seconds: 0,
    slot_key: null,
    condition_text: null,
    preferred_choice_kind: null,
    is_active: true,
    ...over,
  };
}

// ─── Supabase MOCKADO (cobre loadContext + escrita best-effort) ─────────────
//
// Reaproveita a estratégia do teste do N3 (builder PostgREST fluente). Aceita
// também `.update(...)` (usado pela escrita de estado da N8) como no-op de
// sucesso, já que o foco aqui é a coordenação, não a persistência.

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
        distribuidora: null,
        address_state: null,
        email: null,
        sales_phase: null,
        conversation_step: null,
        document_uploaded: false,
        otp_validated_at: null,
        phone_whatsapp: "5511999999999",
        bot_paused: false,
        bot_paused_reason: null,
        conversation_summary: null,
        fluxo_b_state: null,
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
        sync_mode: "local",
        strict_mode: false,
        created_at: "2024-01-01T00:00:00.000Z",
      },
    ],
    bot_flow_steps: steps,
    consultants: [{ id: CONSULTANT_ID, flow_step_media_order: {} }],
    ai_media_library: [],
    customer_flow_state: flowStateRow
      ? [{ ...flowStateRow, customer_id: CUSTOMER_ID }]
      : [],
  };

  function builder(table: string) {
    const filters: Array<{ col: string; val: unknown }> = [];
    const aplicarFiltros = (rows: Array<Record<string, unknown>>) =>
      rows.filter((r) => filters.every((f) => r[f.col] === f.val));
    const resolver = () => {
      const tbl = store[table] ?? [];
      return { data: aplicarFiltros(tbl), error: null };
    };

    const chain: Record<string, unknown> = {
      select() {
        return chain;
      },
      update() {
        // Escrita de estado (N8): no-op de sucesso para o teste de coordenação.
        return chain;
      },
      upsert() {
        // Escrita campo a campo (N8 → persistFlowState usa .upsert): no-op de
        // sucesso. Mantém a gravação de estado offline e determinística, sem
        // o ruído de "supabase.from(...).upsert is not a function".
        return Promise.resolve({ data: null, error: null });
      },
      insert() {
        return Promise.resolve({ data: null, error: null });
      },
      eq(col: string, val: unknown) {
        filters.push({ col, val });
        return chain;
      },
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

function entrada(
  supabase: unknown,
  inbound: InboundEvent = TEXTO("oi, quero economizar na conta de luz"),
): EntradaCerebro {
  return {
    // deno-lint-ignore no-explicit-any
    supabase: supabase as any,
    customerId: CUSTOMER_ID,
    consultantId: CONSULTANT_ID,
    inbound,
    canalCapabilities: CAPS,
  };
}

// Sem chave de IA: o gateway lança na hora (sem rede). Garante caminho offline.
function semIA() {
  Deno.env.delete("LOVABLE_API_KEY");
}

// ─── Testes ─────────────────────────────────────────────────────────────────

Deno.test("N1 (cliente novo): coordena as peças e devolve a mensagem do passo de entrada", async () => {
  semIA();
  const steps = [
    passoCru(ID_BOAS_VINDAS, "boas_vindas", 0, {
      message_text: "Olá! Posso te ajudar a economizar na conta de luz.",
    }),
    passoCru(ID_PEDE_NOME, "pede_nome", 1),
  ];
  // Texto com gatilho FORTE de interesse reconhecido pelo classificador
  // determinístico reusado (N2) — mantém a asserção de intenção offline e
  // estável, sem depender de IA.
  const r = await processarTurno(
    entrada(montarSupabaseMock(steps, null), TEXTO("quero contratar, como faço?")),
  );

  // O Escritor caiu no texto seguro do passo (sem IA) e a Guarda aprovou.
  assertEquals(r.shouldHandoff, false);
  assert(r.reply.length > 0, "esperava uma mensagem aprovada");
  assertEquals(r.outbound.length, 1);
  assertEquals(r.outbound[0].kind, "text");
  // A decisão do turno reflete o passo de entrada decidido pelo motor.
  assertEquals(r.decisao.proximoPassoId, ID_BOAS_VINDAS);
  assertEquals(r.decisao.intencao, "demonstrar_interesse");
});

Deno.test("N1: a mensagem só sai se a Guarda aprovar — saída sempre passa pelo ponto único", async () => {
  semIA();
  const steps = [passoCru(ID_BOAS_VINDAS, "boas_vindas", 0)];
  const r = await processarTurno(entrada(montarSupabaseMock(steps, null)));
  // Quando há reply, há exatamente um outbound de texto correspondente.
  if (r.reply) {
    assertEquals(r.outbound.length, 1);
    assertEquals((r.outbound[0] as { text: string }).text, r.reply);
  } else {
    // Sem reply aprovado → handoff e nada sai.
    assertEquals(r.shouldHandoff, true);
    assertEquals(r.outbound.length, 0);
  }
});

Deno.test("N1 (fail-open): erro ao carregar o contexto → handoff, nunca lança", async () => {
  semIA();
  // Supabase que estoura em qualquer consulta: o turno deve cair em handoff.
  const supabaseQuebrado = {
    from() {
      throw new Error("falha simulada de banco");
    },
  };
  const r = await processarTurno(entrada(supabaseQuebrado));
  assertEquals(r.shouldHandoff, true);
  assertEquals(r.reply, "");
  assertEquals(r.outbound.length, 0);
  // Mesmo em falha, devolve uma decisão (intenção indefinida) — sem lançar.
  assertEquals(r.decisao.proximoPassoId, null);
});

Deno.test("N1 (handoff do motor): fluxo vazio → paused_system → handoff sem enviar", async () => {
  semIA();
  // Sem passos no fluxo, o runEngine sinaliza handoff (variante/empty flow).
  const r = await processarTurno(entrada(montarSupabaseMock([], null)));
  assertEquals(r.shouldHandoff, true);
  assertEquals(r.reply, "");
  assertEquals(r.outbound.length, 0);
});

Deno.test("N1: saída tem o formato do contrato ResultadoCerebro", async () => {
  semIA();
  const steps = [passoCru(ID_BOAS_VINDAS, "boas_vindas", 0)];
  const r = await processarTurno(entrada(montarSupabaseMock(steps, null)));
  // Campos obrigatórios do contrato presentes.
  assert("reply" in r);
  assert("outbound" in r);
  assert("stateUpdate" in r);
  assert("shouldHandoff" in r);
  assert("decisao" in r);
  assert(Array.isArray(r.outbound));
  assertEquals(typeof r.shouldHandoff, "boolean");
});
