// Testes-guardião do ROTEAMENTO DE WORKER do portal (pt-BR) — Tarefa 11.2.
//
// Spec: `.kiro/specs/cerebro-ia/design.md` — seções "Pipeline de cadastro" e
// "Não quebrar o worker do portal".
//
// Valida: Requisito 16.3 (roteamento digital × autoconexao preservado).
//
// O QUE ESTES TESTES PROVAM
// -------------------------
// A escolha do worker (digital → worker original; autoconexao → worker-portal-2)
// continua 100% dentro de `portal-worker.ts`, decidida pelo `consultants.portal_kind`
// lido em `resolveWorker`. O Cérebro só REPASSA `(supabase, customerId)` e OBSERVA
// o resultado — nunca passa hint de worker nem interfere na decisão.
//
// Diferente da Tarefa 11.1 (que usa um espião do helper), aqui exercitamos o
// `dispatchPortalWorker` REAL com um Supabase falso que devolve `portal_kind`
// 'digital' ou 'autoconexao', e um `fetch` global stubado (sem rede). Assim
// provamos a ponta-a-ponta: muda o `portal_kind` no banco → muda o worker;
// o repassador do Cérebro só leva adiante o que o helper decidiu.
//
// Rodar:
//   deno test supabase/functions/_shared/cerebro/__tests__/roteamento-worker.test.ts --no-check --allow-read

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

// ─── Supabase falso (sem rede) ───────────────────────────────────────────────
//
// Devolve um customer único cujo `consultants.portal_kind` é controlado pelo
// teste. Ignora QUAIS colunas o `.select()` pede e responde sempre o mesmo
// registro completo — basta cobrir os campos que `resolveWorker`,
// `checkDocsPresentForPortal2` e `buildPortal2Payload` consultam.

function fazerSupabaseFalso(portalKind: "digital" | "autoconexao") {
  const updates: Array<Record<string, unknown>> = [];

  const customerRow = {
    id: "cliente-x",
    consultant_id: "consultor-1",
    consultants: { portal_kind: portalKind, igreen_id: 4242, name: "Consultor" },
    // Documentos presentes (gate do Portal 2 satisfeito) — URLs http válidas.
    document_type: "rg",
    electricity_bill_photo_url: "https://exemplo/conta.jpg",
    bill_base64: null,
    document_front_url: "https://exemplo/frente.jpg",
    document_front_base64: null,
    document_back_url: "https://exemplo/verso.jpg",
    document_back_base64: null,
    // Dados mínimos do payload do Portal 2.
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
    { key: "portal_worker_url", value: "http://worker-digital:3100" },
    { key: "worker_secret", value: "segredo-digital" },
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
    restaurar: () => {
      globalThis.fetch = original;
    },
  };
}

// ─── 1) digital → worker 'digital' (decisão do helper, observada pelo Cérebro) ─

Deno.test("11.2: portal_kind='digital' roteia para o worker digital, e o Cérebro só observa", async () => {
  const sb = fazerSupabaseFalso("digital");
  const stub = instalarFetchStub();
  try {
    const r = await despacharAcaoCadastro({
      supabase: sb.client,
      customerId: "cliente-x",
      acaoCadastro: PORTAL_SUBMIT,
      // SEM injetar deps: usa o dispatchPortalWorker REAL.
    });

    assertEquals(r.destino, "portal_worker");
    assert(r.acionouPortalWorker);
    // O worker escolhido veio do helper (a partir de portal_kind), não do Cérebro.
    assertEquals(r.resultadoPortal?.worker, "digital");
    assertEquals(r.resultadoPortal?.mode, "dispatched");
    // Bateu no worker digital (3100), nunca no Portal 2 (3101).
    assert(stub.chamadas.some((u) => u.includes("worker-digital:3100")));
    assert(!stub.chamadas.some((u) => u.includes("worker-portal-2:3101")));
  } finally {
    stub.restaurar();
  }
});

// ─── 2) autoconexao → worker 'autoconexao' (worker-portal-2) ─────────────────

Deno.test("11.2: portal_kind='autoconexao' roteia para o worker-portal-2, e o Cérebro só observa", async () => {
  const sb = fazerSupabaseFalso("autoconexao");
  const stub = instalarFetchStub();
  try {
    const r = await despacharAcaoCadastro({
      supabase: sb.client,
      customerId: "cliente-x",
      acaoCadastro: PORTAL_SUBMIT,
    });

    assertEquals(r.destino, "portal_worker");
    assert(r.acionouPortalWorker);
    assertEquals(r.resultadoPortal?.worker, "autoconexao");
    assertEquals(r.resultadoPortal?.mode, "dispatched");
    // Bateu no worker-portal-2 (3101), nunca no digital (3100).
    assert(stub.chamadas.some((u) => u.includes("worker-portal-2:3101")));
    assert(!stub.chamadas.some((u) => u.includes("worker-digital:3100")));
  } finally {
    stub.restaurar();
  }
});

// ─── 3) Mesmo cliente, só muda portal_kind → muda o worker (sem tocar Cérebro) ─

Deno.test("11.2: trocar portal_kind muda o worker sem qualquer mudança no Cérebro", async () => {
  const stub = instalarFetchStub();
  try {
    const rDigital = await despacharAcaoCadastro({
      supabase: fazerSupabaseFalso("digital").client,
      customerId: "cliente-x",
      acaoCadastro: PORTAL_SUBMIT,
    });
    const rAuto = await despacharAcaoCadastro({
      supabase: fazerSupabaseFalso("autoconexao").client,
      customerId: "cliente-x",
      acaoCadastro: PORTAL_SUBMIT,
    });

    // Única variável que mudou foi o portal_kind no banco — o resultado seguiu.
    assertEquals(rDigital.resultadoPortal?.worker, "digital");
    assertEquals(rAuto.resultadoPortal?.worker, "autoconexao");
  } finally {
    stub.restaurar();
  }
});

// ─── 4) Auditoria: o núcleo do Cérebro nunca lê portal_kind nem escolhe worker ─
//
// Se uma tarefa futura colocar a decisão de worker dentro do Cérebro (ler
// portal_kind, comparar 'autoconexao', citar worker-portal-2), este teste
// quebra — sinalizando regressão do Requisito 16.3.

const RAIZ_CEREBRO = new URL("../", import.meta.url);

async function lerArquivosTs(): Promise<Array<{ nome: string; texto: string }>> {
  const arquivos: Array<{ nome: string; texto: string }> = [];
  for await (const entry of Deno.readDir(RAIZ_CEREBRO)) {
    if (!entry.isFile || !entry.name.endsWith(".ts")) continue;
    const texto = await Deno.readTextFile(new URL(entry.name, RAIZ_CEREBRO));
    arquivos.push({ nome: entry.name, texto });
  }
  return arquivos;
}

Deno.test("11.2: o núcleo do Cérebro não lê portal_kind nem decide o worker", async () => {
  const arquivos = await lerArquivosTs();
  for (const a of arquivos) {
    assert(
      !/portal_kind/.test(a.texto),
      `${a.nome} leu portal_kind — a escolha do worker deve ficar no portal-worker.ts`,
    );
    // O Cérebro não deve comparar/decidir entre os workers por conta própria.
    assert(
      !/worker-portal-2|worker_portal_2/.test(a.texto),
      `${a.nome} referenciou o worker-portal-2 — roteamento é do helper`,
    );
  }
});
