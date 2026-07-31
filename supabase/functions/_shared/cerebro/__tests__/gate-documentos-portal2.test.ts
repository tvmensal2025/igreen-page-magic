// Testes-guardião do GATE DE DOCUMENTOS do Portal 2 (pt-BR) — Tarefa 11.3.
//
// Spec: `.kiro/specs/cerebro-ia/design.md` — seções "Pipeline de cadastro" e
// "Não quebrar o worker do portal".
//
// Valida: Requisito 16.3 (gate de documentos do Portal 2 respeitado:
// conta de energia + documento frente; verso obrigatório quando é RG).
//
// O QUE ESTES TESTES PROVAM
// -------------------------
// O gate de documentos (`checkDocsPresentForPortal2`) continua 100% dentro de
// `portal-worker.ts` e é aplicado por `dispatchPortalWorker` ANTES de enviar
// qualquer coisa ao worker-portal-2. O Cérebro NÃO contorna esse gate: ele só
// repassa `(supabase, customerId)` pelo ponto único (`despacharAcaoCadastro`),
// e quando falta documento (ex.: sem verso de RG) o `dispatchPortalWorker` REAL
// NÃO faz POST /submit-lead — espelha o gate, nunca o burla.
//
// Igual à Tarefa 11.2: exercitamos o `dispatchPortalWorker` REAL com um Supabase
// falso (sem rede) e um `fetch` global stubado. Aqui controlamos a PRESENÇA dos
// documentos do customer para cobrir as três regras do gate.
//
// Rodar:
//   deno test supabase/functions/_shared/cerebro/__tests__/gate-documentos-portal2.test.ts --no-check --allow-read

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { despacharAcaoCadastro } from "../despacho-cadastro.ts";
import type { AcaoCadastroDeferida } from "../tipos.ts";

const PORTAL_SUBMIT: AcaoCadastroDeferida = {
  kind: "portal_submit",
  stepId: "passo-finalizar",
  flowId: "fluxo-1",
  pipeline: "finalizar_cadastro",
};

// ─── Documentos do customer (controláveis pelo teste) ────────────────────────
//
// Cada campo pode ser uma URL http válida (presente) ou null/sentinela (ausente).

interface DocsCustomer {
  document_type?: string | null;
  electricity_bill_photo_url?: string | null;
  bill_base64?: string | null;
  document_front_url?: string | null;
  document_front_base64?: string | null;
  document_back_url?: string | null;
  document_back_base64?: string | null;
}

// ─── Supabase falso (sem rede), sempre autoconexao (worker-portal-2) ─────────
//
// Só o Portal 2 (autoconexao) tem gate de documentos; por isso fixamos o
// portal_kind em 'autoconexao'. Os documentos vêm do parâmetro `docs`.

function fazerSupabaseFalso(docs: DocsCustomer) {
  const updates: Array<Record<string, unknown>> = [];

  const customerRow = {
    id: "cliente-x",
    consultant_id: "consultor-1",
    consultants: { portal_kind: "autoconexao", igreen_id: 4242, name: "Consultor" },
    // Documentos controlados pelo teste (gate do Portal 2).
    document_type: docs.document_type ?? "rg",
    electricity_bill_photo_url: docs.electricity_bill_photo_url ?? null,
    bill_base64: docs.bill_base64 ?? null,
    document_front_url: docs.document_front_url ?? null,
    document_front_base64: docs.document_front_base64 ?? null,
    document_back_url: docs.document_back_url ?? null,
    document_back_base64: docs.document_back_base64 ?? null,
    // Dados mínimos do payload do Portal 2 (caso o gate passe).
    cpf: "00000000000",
    name: "Fulano",
    doc_holder_name: "Fulano",
    data_nascimento: "1990-01-01",
    phone_whatsapp: "5511999999999",
    portal2_celular_alt: null,
    email: "f@e.com",
    cep: "00000000",
    address_street: "Rua",
    address_number: "1",
    address_complement: "",
    address_neighborhood: "Centro",
    address_city: "Cidade",
    address_state: "SP",
    numero_instalacao: "123",
    media_consumo: 300,
    electricity_bill_value: 350,
    distribuidora: "CPFL",
    referral_partners: null,
  };

  const settingsRows = [
    { key: "portal2_worker_url", value: "http://worker-portal-2:3101" },
    { key: "portal2_worker_secret", value: "segredo-portal2" },
  ];

  function from(table: string) {
    if (table === "settings") {
      return {
        select: (_cols?: string) => Promise.resolve({ data: settingsRows }),
      };
    }
    // customers
    return {
      select: (_cols?: string) => ({
        eq: (_col: string, _val: string) => ({
          maybeSingle: () => Promise.resolve({ data: customerRow }),
        }),
      }),
      update: (patch: Record<string, unknown>) => ({
        eq: (_col: string, _val: string) => {
          updates.push(patch);
          return Promise.resolve({ data: null });
        },
      }),
    };
  }

  return { client: { from }, updates };
}

// ─── Stub do fetch global (health + submit-lead) ─────────────────────────────

function instalarFetchStub() {
  const original = globalThis.fetch;
  const chamadas: string[] = [];
  globalThis.fetch = ((input: string | URL | Request, _init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    chamadas.push(url);
    if (url.endsWith("/health")) {
      return Promise.resolve(new Response("ok", { status: 200 }));
    }
    if (url.endsWith("/submit-lead")) {
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    }
    return Promise.resolve(new Response("", { status: 404 }));
    // deno-lint-ignore no-explicit-any
  }) as any;
  return {
    chamadas,
    enviouSubmitLead: () => chamadas.some((u) => u.endsWith("/submit-lead")),
    restaurar: () => {
      globalThis.fetch = original;
    },
  };
}

const URL_VALIDA = "https://exemplo/arquivo.jpg";
// Preflight real exige BYTES baixáveis. Em teste (sem rede/sem storage) usamos
// data-url >200 chars, que o `assertStorageReadable` aceita sem download.
const DATA_VALIDA = `data:image/jpeg;base64,${"A".repeat(400)}`;


// ─── 1) RG sem verso → gate bloqueia: NÃO despacha ao worker ─────────────────

Deno.test("11.3: RG sem verso — gate bloqueia, dispatchPortalWorker NÃO envia ao worker", async () => {
  const sb = fazerSupabaseFalso({
    document_type: "rg",
    electricity_bill_photo_url: URL_VALIDA, // conta presente
    document_front_url: URL_VALIDA, // frente presente
    document_back_url: null, // verso AUSENTE (RG exige)
  });
  const stub = instalarFetchStub();
  try {
    const r = await despacharAcaoCadastro({
      supabase: sb.client,
      customerId: "cliente-x",
      acaoCadastro: PORTAL_SUBMIT,
      // SEM injetar deps: usa o dispatchPortalWorker REAL (o gate é dele).
    });

    // O Cérebro passou pelo ponto único e acionou o helper...
    assertEquals(r.destino, "portal_worker");
    assert(r.acionouPortalWorker);
    // ...mas o gate barrou ANTES de enviar ao worker.
    assertEquals(r.resultadoPortal?.error, "missing_documents");
    assertEquals(r.resultadoPortal?.ok, false);
    // PROVA central: nenhum POST /submit-lead aconteceu — o Cérebro não contorna o gate.
    assert(!stub.enviouSubmitLead(), "submit-lead não deveria ter sido chamado com verso de RG ausente");
    // O helper marca o customer como awaiting_manual_submit (docs ilegíveis).
    assert(
      sb.updates.some((u) => u.status === "awaiting_manual_submit"),
      "esperava status awaiting_manual_submit no customer",
    );
  } finally {
    stub.restaurar();
  }
});

// ─── 2) Sem conta de energia → gate bloqueia ─────────────────────────────────

Deno.test("11.3: sem conta de energia — gate bloqueia, NÃO envia ao worker", async () => {
  const sb = fazerSupabaseFalso({
    document_type: "rg",
    electricity_bill_photo_url: null, // conta AUSENTE
    bill_base64: null,
    document_front_url: URL_VALIDA,
    document_back_url: URL_VALIDA,
  });
  const stub = instalarFetchStub();
  try {
    const r = await despacharAcaoCadastro({
      supabase: sb.client,
      customerId: "cliente-x",
      acaoCadastro: PORTAL_SUBMIT,
    });

    assertEquals(r.resultadoPortal?.error, "missing_documents");
    assert(!stub.enviouSubmitLead(), "submit-lead não deveria ter sido chamado sem conta de energia");
  } finally {
    stub.restaurar();
  }
});

// ─── 3) Sem documento (frente) → gate bloqueia ───────────────────────────────

Deno.test("11.3: sem documento (frente) — gate bloqueia, NÃO envia ao worker", async () => {
  const sb = fazerSupabaseFalso({
    document_type: "rg",
    electricity_bill_photo_url: URL_VALIDA,
    document_front_url: null, // frente AUSENTE
    document_back_url: URL_VALIDA,
  });
  const stub = instalarFetchStub();
  try {
    const r = await despacharAcaoCadastro({
      supabase: sb.client,
      customerId: "cliente-x",
      acaoCadastro: PORTAL_SUBMIT,
    });

    assertEquals(r.resultadoPortal?.error, "missing_documents");
    assert(!stub.enviouSubmitLead(), "submit-lead não deveria ter sido chamado sem a frente do documento");
  } finally {
    stub.restaurar();
  }
});

// ─── 4) RG completo (conta + frente + verso) → gate libera: despacha ─────────

Deno.test("11.3: RG completo — gate libera, dispatchPortalWorker envia ao worker-portal-2", async () => {
  const sb = fazerSupabaseFalso({
    document_type: "rg",
    electricity_bill_photo_url: URL_VALIDA,
    bill_base64: DATA_VALIDA,
    document_front_url: URL_VALIDA,
    document_front_base64: DATA_VALIDA,
    document_back_url: URL_VALIDA, // verso presente
    document_back_base64: DATA_VALIDA,
  });

  const stub = instalarFetchStub();
  try {
    const r = await despacharAcaoCadastro({
      supabase: sb.client,
      customerId: "cliente-x",
      acaoCadastro: PORTAL_SUBMIT,
    });

    assertEquals(r.resultadoPortal?.worker, "autoconexao");
    assertEquals(r.resultadoPortal?.mode, "dispatched");
    // Com tudo presente, o despacho ocorre de verdade.
    assert(stub.enviouSubmitLead(), "submit-lead deveria ter sido chamado com documentos completos");
  } finally {
    stub.restaurar();
  }
});

// ─── 5) CNH sem verso → gate libera (verso não obrigatório para CNH) ─────────

Deno.test("11.3: CNH sem verso — gate libera (verso só é obrigatório para RG)", async () => {
  const sb = fazerSupabaseFalso({
    document_type: "cnh",
    electricity_bill_photo_url: URL_VALIDA,
    bill_base64: DATA_VALIDA,
    document_front_url: URL_VALIDA,
    document_front_base64: DATA_VALIDA,
    document_back_url: "nao_aplicavel", // sentinela de CNH (sem verso)

  });
  const stub = instalarFetchStub();
  try {
    const r = await despacharAcaoCadastro({
      supabase: sb.client,
      customerId: "cliente-x",
      acaoCadastro: PORTAL_SUBMIT,
    });

    // CNH não exige verso: o gate libera e o despacho ocorre.
    assertEquals(r.resultadoPortal?.mode, "dispatched");
    assert(stub.enviouSubmitLead(), "submit-lead deveria ter sido chamado para CNH sem verso");
  } finally {
    stub.restaurar();
  }
});
