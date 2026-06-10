// Testes unitários da peça N8 — Estado / Memória (pt-BR).
//
// Spec: `.kiro/specs/cerebro-ia/` — Tarefa 2.3.
// Valida: Requisito 5.4 (retomar conversa sem reiniciar cadastro / fail-open),
// apoiado nos Requisitos 5.1, 5.2, 5.3 e 20.1 que a peça também cobre.
//
// Cenários cobertos:
//   - PARCIAL:    cliente no meio do cadastro (tem `customer_flow_state` +
//                 `fluxo_b_state` preenchido) → leitura monta as camadas certas.
//   - VAZIO:      lead novo/sem `customer_flow_state` → snapshot de cliente novo
//                 sem reiniciar cadastro.
//   - CORROMPIDO: `fluxo_b_state` inválido → leitura não derruba (fail-open) e a
//                 camada operacional vira objeto vazio.
//   - ESCRITA:    patch campo a campo só toca o campo informado e preserva os
//                 demais; patch vazio é no-op; histórico de checkpoint gravado.
//
// Mocka o cliente Supabase por completo — não acessa banco real.
//
// Rodar:
//   deno test supabase/functions/_shared/cerebro/__tests__/estado.test.ts

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { atualizarEstado, lerEstado } from "../estado.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─── Mock do cliente Supabase ────────────────────────────────────────────────
//
// Construímos um cliente falso que cobre exatamente o que a peça N8 usa:
//   - leitura:  `.from(t).select(...).eq(...).maybeSingle()`
//   - escrita:  `.from(t).upsert(...)`           (persistFlowState)
//               `.from(t).update(...).eq(...)`   (last_outbound_content_hash)
//               `.from(t).insert(...)`           (engine_logs / checkpoint)
//
// O builder é "thenable": quando uma escrita (upsert/update/insert) é aguardada
// com `await`, resolve para `{ error }`. As leituras resolvem em `maybeSingle()`.

/** Configuração por tabela usada pelo mock. */
interface ConfigTabela {
  /** Linha devolvida por `maybeSingle()`. */
  data?: unknown;
  /** Erro devolvido na leitura. */
  error?: unknown;
  /** Quando true, `maybeSingle()` lança (simula exceção de rede/SDK). */
  throwOnSelect?: boolean;
  /** Erro devolvido por upsert/update/insert. */
  writeError?: unknown;
}

/** Registro das escritas feitas durante o teste, para inspeção. */
interface ChamadasRegistradas {
  upserts: Array<{ tabela: string; payload: Record<string, unknown> }>;
  updates: Array<{ tabela: string; payload: Record<string, unknown> }>;
  inserts: Array<{ tabela: string; payload: Record<string, unknown> }>;
}

function criarSupabaseMock(
  config: Record<string, ConfigTabela>,
): { client: SupabaseClient; chamadas: ChamadasRegistradas } {
  const chamadas: ChamadasRegistradas = {
    upserts: [],
    updates: [],
    inserts: [],
  };

  function criarBuilder(tabela: string) {
    const t = config[tabela] ?? {};
    let modo: "select" | "upsert" | "update" | "insert" = "select";
    let payloadEscrita: Record<string, unknown> = {};

    const builder = {
      select(_cols?: string) {
        modo = "select";
        return builder;
      },
      insert(payload: Record<string, unknown>) {
        modo = "insert";
        payloadEscrita = payload;
        chamadas.inserts.push({ tabela, payload });
        return builder;
      },
      update(payload: Record<string, unknown>) {
        modo = "update";
        payloadEscrita = payload;
        return builder;
      },
      upsert(payload: Record<string, unknown>, _opts?: unknown) {
        modo = "upsert";
        payloadEscrita = payload;
        chamadas.upserts.push({ tabela, payload });
        return builder;
      },
      eq(_col: string, _val: unknown) {
        return builder;
      },
      maybeSingle() {
        if (t.throwOnSelect) {
          return Promise.reject(new Error("falha simulada de leitura"));
        }
        return Promise.resolve({ data: t.data ?? null, error: t.error ?? null });
      },
      // Torna o builder "awaitable" para as escritas (upsert/update/insert).
      then(
        resolve: (v: { error: unknown }) => unknown,
        reject?: (e: unknown) => unknown,
      ) {
        if (modo === "update") {
          chamadas.updates.push({ tabela, payload: payloadEscrita });
        }
        return Promise.resolve({ error: t.writeError ?? null }).then(
          resolve,
          reject,
        );
      },
    };
    return builder;
  }

  const client = {
    from(tabela: string) {
      return criarBuilder(tabela);
    },
  } as unknown as SupabaseClient;

  return { client, chamadas };
}

// Linha de `customer_flow_state` (com o join leve em `customers`) montada do
// jeito que `loadFlowState` espera consumir.
function linhaFlowState(over: Record<string, unknown> = {}) {
  return {
    customer_id: "cli-1",
    flow_id: "fluxo-energia",
    current_step_id: "passo-conta",
    status: "waiting_media",
    pause_reason: null,
    retries: 1,
    entered_step_at: "2024-01-01T10:00:00.000Z",
    expires_at: null,
    assigned_human_id: null,
    last_inbound_at: "2024-01-01T10:05:00.000Z",
    last_outbound_at: "2024-01-01T10:04:00.000Z",
    customers: {
      name: "Maria",
      electricity_bill_value: 350,
      document_uploaded: false,
      otp_validated_at: null,
      consultant_id: "consultor-1",
      phone_whatsapp: "5511999990000",
    },
    ...over,
  };
}

// Linha da consulta de memória/perfil em `customers`.
function linhaCustomers(over: Record<string, unknown> = {}) {
  return {
    id: "cli-1",
    consultant_id: "consultor-1",
    name: "Maria",
    electricity_bill_value: 350,
    distribuidora: "CPFL",
    address_state: "SP",
    email: "maria@example.com",
    sales_phase: "qualificacao",
    conversation_step: "aguardando_conta",
    document_uploaded: false,
    otp_validated_at: null,
    phone_whatsapp: "5511999990000",
    conversation_summary: "Cliente interessada, falta enviar a conta de luz.",
    fluxo_b_state: { etapa: "aguardando_conta", tentativas: 2 },
    ...over,
  };
}

// ─── Cenário PARCIAL — cliente no meio do cadastro ──────────────────────────

Deno.test("lerEstado (PARCIAL): monta as camadas de memória a partir do estado canônico", async () => {
  const { client } = criarSupabaseMock({
    customer_flow_state: { data: linhaFlowState() },
    customers: { data: linhaCustomers() },
  });

  const { snapshot, memoria } = await lerEstado({ supabase: client, customerId: "cli-1" });

  // Snapshot reflete o ponto atual do fluxo (não reinicia o cadastro).
  assertEquals(snapshot.customerId, "cli-1");
  assertEquals(snapshot.consultantId, "consultor-1");
  assertEquals(snapshot.flowId, "fluxo-energia");
  assertEquals(snapshot.currentStepId, "passo-conta");
  assertEquals(snapshot.status, "waiting_media");
  assertEquals(snapshot.retries, 1);
  assertEquals(snapshot.customer.name, "Maria");

  // Camada de sessão = resumo da conversa atual.
  assertEquals(memoria.sessao, "Cliente interessada, falta enviar a conta de luz.");

  // Camada de perfil = dados estáveis do cliente.
  assertEquals(memoria.perfil.name, "Maria");
  assertEquals(memoria.perfil.distribuidora, "CPFL");
  assertEquals(memoria.perfil.email, "maria@example.com");

  // Camada operacional = posição no fluxo + estado legado preservado cru.
  assertEquals(memoria.operacional.currentStepId, "passo-conta");
  assertEquals(memoria.operacional.conversationStep, "aguardando_conta");
  assertEquals(
    memoria.operacional.fluxoBState,
    { etapa: "aguardando_conta", tentativas: 2 },
  );
});

// ─── Cenário VAZIO — lead novo / sem customer_flow_state ────────────────────

Deno.test("lerEstado (VAZIO): lead sem customer_flow_state vira snapshot de cliente novo", async () => {
  const { client } = criarSupabaseMock({
    // Sem linha em customer_flow_state (lead legado/novo).
    customer_flow_state: { data: null },
    customers: {
      data: {
        id: "cli-novo",
        consultant_id: "consultor-9",
        name: null,
        electricity_bill_value: null,
        distribuidora: null,
        address_state: null,
        email: null,
        sales_phase: null,
        conversation_step: null,
        document_uploaded: false,
        otp_validated_at: null,
        phone_whatsapp: "5511888887777",
        conversation_summary: null,
        fluxo_b_state: null,
      },
    },
  });

  const { snapshot, memoria } = await lerEstado({ supabase: client, customerId: "cli-novo" });

  // Cliente novo: sem fluxo, status "new", sem passo atual.
  assertEquals(snapshot.status, "new");
  assertEquals(snapshot.currentStepId, null);
  assertEquals(snapshot.flowId, "");
  assertEquals(snapshot.consultantId, "consultor-9");
  assertEquals(snapshot.customer.phoneWhatsapp, "5511888887777");

  // Sem resumo de sessão e com camada operacional sem estado legado.
  assertEquals(memoria.sessao, null);
  assertEquals(memoria.operacional.fluxoBState, {});
});

// ─── Cenário CORROMPIDO — fluxo_b_state inválido ────────────────────────────

Deno.test("lerEstado (CORROMPIDO): fluxo_b_state inválido não derruba a leitura (fail-open)", async () => {
  // fluxo_b_state vindo como string (corrompido) — não é objeto.
  const { client } = criarSupabaseMock({
    customer_flow_state: { data: linhaFlowState() },
    customers: { data: linhaCustomers({ fluxo_b_state: "isso-nao-e-um-objeto" }) },
  });

  const { snapshot, memoria } = await lerEstado({ supabase: client, customerId: "cli-1" });

  // A leitura segue de pé e o snapshot continua íntegro.
  assertEquals(snapshot.currentStepId, "passo-conta");
  // A camada operacional protege contra o lixo: vira objeto vazio.
  assertEquals(memoria.operacional.fluxoBState, {});
});

Deno.test("lerEstado (CORROMPIDO): fluxo_b_state como array também é tratado como vazio", async () => {
  const { client } = criarSupabaseMock({
    customer_flow_state: { data: linhaFlowState() },
    customers: { data: linhaCustomers({ fluxo_b_state: [1, 2, 3] }) },
  });

  const { memoria } = await lerEstado({ supabase: client, customerId: "cli-1" });
  assertEquals(memoria.operacional.fluxoBState, {});
});

Deno.test("lerEstado (fail-open): exceção ao ler customers não derruba a leitura", async () => {
  // O estado canônico carrega normalmente; a consulta de memória explode.
  const { client } = criarSupabaseMock({
    customer_flow_state: { data: linhaFlowState() },
    customers: { throwOnSelect: true },
  });

  const { snapshot, memoria } = await lerEstado({ supabase: client, customerId: "cli-1" });

  // Mesmo sem a linha de customers, o snapshot do estado canônico permanece.
  assertEquals(snapshot.currentStepId, "passo-conta");
  assertEquals(snapshot.status, "waiting_media");
  // Sem dados de memória, a camada operacional cai no vazio seguro.
  assertEquals(memoria.operacional.fluxoBState, {});
});

// ─── Escrita campo a campo (Requisito 5.2) ──────────────────────────────────

Deno.test("atualizarEstado: patch toca SOMENTE o campo informado e preserva os demais", async () => {
  const { client, chamadas } = criarSupabaseMock({
    // loadFlowState é chamado de novo para achar a flow_id do checkpoint.
    customer_flow_state: { data: linhaFlowState() },
  });

  const r = await atualizarEstado({
    supabase: client,
    customerId: "cli-1",
    patch: { currentStepId: "passo-otp" },
  });

  assertEquals(r.ok, true);
  assertEquals(r.camposAlterados, ["currentStepId"]);

  // O upsert do estado canônico só carrega a chave + o campo do patch.
  assertEquals(chamadas.upserts.length, 1);
  const payload = chamadas.upserts[0].payload;
  assertEquals(Object.keys(payload).sort(), ["current_step_id", "customer_id"]);
  assertEquals(payload.current_step_id, "passo-otp");
  // Nenhum outro campo do estado é tocado (preserva os demais).
  assert(!("status" in payload));
  assert(!("retries" in payload));
});

Deno.test("atualizarEstado: patch com vários campos mapeia exatamente esses campos", async () => {
  const { client, chamadas } = criarSupabaseMock({
    customer_flow_state: { data: linhaFlowState() },
  });

  const r = await atualizarEstado({
    supabase: client,
    customerId: "cli-1",
    patch: { status: "running", retries: 3 },
  });

  assertEquals(r.ok, true);
  assertEquals(r.camposAlterados.sort(), ["retries", "status"]);

  const payload = chamadas.upserts[0].payload;
  assertEquals(Object.keys(payload).sort(), ["customer_id", "retries", "status"]);
  assertEquals(payload.status, "running");
  assertEquals(payload.retries, 3);
});

Deno.test("atualizarEstado: patch vazio é no-op de sucesso, sem escrita nem checkpoint", async () => {
  const { client, chamadas } = criarSupabaseMock({
    customer_flow_state: { data: linhaFlowState() },
  });

  const r = await atualizarEstado({ supabase: client, customerId: "cli-1", patch: {} });

  assertEquals(r.ok, true);
  assertEquals(r.camposAlterados, []);
  assertEquals(chamadas.upserts.length, 0);
  assertEquals(chamadas.updates.length, 0);
  assertEquals(chamadas.inserts.length, 0);
});

Deno.test("atualizarEstado: sem customerId retorna falha sem escrever nada", async () => {
  const { client, chamadas } = criarSupabaseMock({});

  const r = await atualizarEstado({ supabase: client, customerId: "", patch: { status: "lost" } });

  assertEquals(r.ok, false);
  assertEquals(r.camposAlterados, []);
  assertEquals(chamadas.upserts.length, 0);
});

Deno.test("atualizarEstado: lastOutboundContentHash vai por update separado, não pelo upsert", async () => {
  const { client, chamadas } = criarSupabaseMock({
    customer_flow_state: { data: linhaFlowState() },
  });

  const r = await atualizarEstado({
    supabase: client,
    customerId: "cli-1",
    patch: { lastOutboundContentHash: "abc123" },
  });

  assertEquals(r.ok, true);
  assertEquals(r.camposAlterados, ["lastOutboundContentHash"]);
  // Campo fora da superfície de persistFlowState: nada vai pelo upsert.
  assertEquals(chamadas.upserts.length, 0);
  // Vai pelo update dedicado em customer_flow_state.
  assertEquals(chamadas.updates.length, 1);
  assertEquals(chamadas.updates[0].payload, { last_outbound_content_hash: "abc123" });
});

// ─── Histórico de checkpoint para diagnóstico (Requisito 5.3) ───────────────

Deno.test("atualizarEstado: registra checkpoint em engine_logs com os campos alterados", async () => {
  const { client, chamadas } = criarSupabaseMock({
    customer_flow_state: { data: linhaFlowState() },
  });

  await atualizarEstado({
    supabase: client,
    customerId: "cli-1",
    patch: { currentStepId: "passo-otp" },
  });

  // Um checkpoint gravado no log estruturado já existente.
  assertEquals(chamadas.inserts.length, 1);
  const log = chamadas.inserts[0];
  assertEquals(log.tabela, "engine_logs");
  assertEquals(log.payload.kind, "cerebro_state_checkpoint");
  assertEquals(log.payload.customer_id, "cli-1");
  assertEquals(log.payload.flow_id, "fluxo-energia");
  const corpo = log.payload.payload as Record<string, unknown>;
  assertEquals(corpo.camposAlterados, ["currentStepId"]);
});
