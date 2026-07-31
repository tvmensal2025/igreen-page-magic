// Testes-guardião do ROTEAMENTO DE WORKER do portal (pt-BR) — Tarefa 11.2.
//
// Histórico: o Portal 1 ("digital", `worker-portal/` via Playwright) foi
// descontinuado em 2026-06-19. Hoje TODO lead vai para o Portal 2
// (`worker-portal-2`, API direta), independente do `portal_kind` salvo
// no consultor — `consultants.portal_kind` segue no banco apenas como
// auditoria. Estes testes provam exatamente isso: muda o `portal_kind`
// no banco → ainda assim o helper dispara o worker-portal-2, e o Cérebro
// só observa o resultado.
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

function fazerSupabaseFalso(portalKind: "digital" | "autoconexao") {
  const updates: Array<Record<string, unknown>> = [];

  const customerRow = {
    id: "cliente-x",
    consultant_id: "consultor-1",
    consultants: { portal_kind: portalKind, igreen_id: 4242, name: "Consultor" },
    document_type: "rg",
    electricity_bill_photo_url: "https://exemplo/conta.jpg",
    bill_base64: "data:image/jpeg;base64,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", // preflight exige bytes
    document_front_url: "https://exemplo/frente.jpg",
    document_front_base64: "data:image/jpeg;base64,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    document_back_url: "https://exemplo/verso.jpg",
    document_back_base64: "data:image/jpeg;base64,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
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

  // Portal 1 saiu do ar: só as chaves do Portal 2 contam.
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

// ─── 1) portal_kind='autoconexao' → worker-portal-2 (caso normal) ────────────

Deno.test("11.2: portal_kind='autoconexao' dispara o worker-portal-2", async () => {
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
    assert(stub.chamadas.some((u) => u.includes("worker-portal-2:3101")));
  } finally {
    stub.restaurar();
  }
});

// ─── 2) portal_kind='digital' (legado) → AINDA assim Portal 2 ────────────────
//
// Garantia de que a desativação do Portal 1 está em pé: mesmo que algum
// consultor antigo ainda tenha `portal_kind='digital'` salvo no banco, o
// helper deve continuar despachando no Portal 2 (worker-portal-2).

Deno.test("11.2: portal_kind='digital' (legado) é forçado para Portal 2", async () => {
  const sb = fazerSupabaseFalso("digital");
  const stub = instalarFetchStub();
  try {
    const r = await despacharAcaoCadastro({
      supabase: sb.client,
      customerId: "cliente-x",
      acaoCadastro: PORTAL_SUBMIT,
    });

    assertEquals(r.resultadoPortal?.worker, "autoconexao");
    assertEquals(r.resultadoPortal?.mode, "dispatched");
    assert(stub.chamadas.some((u) => u.includes("worker-portal-2:3101")));
    // Nunca pode bater no Portal 1 (URL/porta não existe mais nas settings).
    assert(!stub.chamadas.some((u) => u.includes(":3100")));
  } finally {
    stub.restaurar();
  }
});

// ─── 3) Auditoria: o núcleo do Cérebro nunca decide worker por conta própria ─

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
    assert(
      !/worker-portal-2|worker_portal_2/.test(a.texto),
      `${a.nome} referenciou o worker-portal-2 — roteamento é do helper`,
    );
  }
});
