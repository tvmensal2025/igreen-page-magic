// Teste E2E OFFLINE — conversa completa sem regressão (pt-BR) — Tarefa 11.5.
//
// Spec: `.kiro/specs/cerebro-ia/design.md` — seções "Pipeline de cadastro
// (mídia, OCR, OTP, portal)", "Não quebrar o worker do portal" e "Testing
// Strategy" (item E2E: "reusa bot-e2e-runner para conversas completas
// incluindo foto+documento+finalização antes de avançar estágio").
//
// Valida: Requisitos 6.1, 16.1, 16.3.
//   - 6.1: o Cérebro decide o passo via runEngine e REPASSA a DeferredAction
//     de cadastro ao dispatcher existente (não executa nada por conta própria);
//   - 16.1: o Cérebro opera sem alterar as integrações críticas;
//   - 16.3: o roteamento/worker do portal permanece intacto (reúso, não reescrita).
//
// POR QUE ESTE TESTE EXISTE (e como se relaciona com o `bot-e2e-runner`)
// ----------------------------------------------------------------------
// O runner E2E real do projeto é a skill `vendedora-e2e-conversations`
// (`.agents/skills/vendedora-e2e-conversations/scripts/run.ts`): ela roda 20
// conversas do "oi" até a finalização contra a edge `fluxo-b-ai` em `dryRun`.
// Esse runner EXIGE ambiente real (VITE_SUPABASE_URL, chave publishable,
// LOVABLE_API_KEY e a edge no ar) — indisponível neste sandbox.
//
// Para garantir a NÃO-REGRESSÃO de forma VERIFICÁVEL OFFLINE, este teste sobe
// um nível de abstração: simula a MESMA sequência da conversa completa —
// texto → foto da conta → documento → finalização — no nível do Cérebro
// (hook de sombra, N1) + repassador de cadastro (N3→despacho), provando que:
//
//   (1) em modo SOMBRA (`dark`), TODO turno roda o Cérebro, registra a decisão
//       e NUNCA envia ao cliente (enviouAoCliente=false) — o Cérebro em sombra
//       NÃO interfere no caminho atual (Tarefa 9 / Requisito 16.1);
//   (2) a sequência completa CHEGA à finalização e, só nela, aciona
//       `dispatchPortalWorker` — pelo PONTO ÚNICO (`despacharAcaoCadastro`);
//   (3) os turnos de mídia (foto/documento) viram ação `ocr` repassada ao
//       dispatcher existente, sem tocar o worker do portal (Requisito 16.3);
//   (4) nada lança: uma falha do Cérebro é fail-open e não derruba o turno.
//
// É um teste de integração PURO (sem rede): o `processarTurno` do Cérebro e a
// leitura de flag são injetados; o `dispatchPortalWorker` usado na finalização
// é o REAL, exercitado com um Supabase falso e `fetch` global stubado (mesmo
// padrão dos testes 11.2/11.3).
//
// Rodar:
//   deno test supabase/functions/_shared/cerebro/__tests__/e2e-conversa-completa.test.ts --no-check --allow-read

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  executarCerebroSombra,
  type EntradaSombraHook,
} from "../sombra-hook.ts";
import { despacharAcaoCadastro } from "../despacho-cadastro.ts";
import type {
  AcaoCadastroDeferida,
  EngineOutput,
  ResultadoCerebro,
} from "../tipos.ts";

// ─── Roteiro da conversa completa (espelha o `bot-e2e-runner` happy-path) ────
//
// Cada turno descreve o inbound do cliente e a AÇÃO DE CADASTRO que o motor
// (runEngine) produziria naquele passo. É exatamente a sequência do cenário
// "happy-path" do runner real: oi → interesse → nome/valor → foto da conta →
// documento → finalização.

type AcaoEsperada = AcaoCadastroDeferida | undefined;

interface TurnoRoteiro {
  nome: string;
  inbound: Partial<EntradaSombraHook>;
  /** Ação de cadastro que o motor exporia neste passo (undefined = só texto). */
  acaoCadastro: AcaoEsperada;
  /** Passo legado correspondente (para a comparação de sombra). */
  legacyStep: string;
}

const OCR_CONTA: AcaoCadastroDeferida = {
  kind: "ocr",
  stepId: "passo-foto-conta",
  flowId: "fluxo-1",
  pipeline: "ocr_conta",
  mediaRef: "msg-conta",
};

const OCR_DOC: AcaoCadastroDeferida = {
  kind: "ocr",
  stepId: "passo-documento",
  flowId: "fluxo-1",
  pipeline: "ocr_documento",
  mediaRef: "msg-doc",
};

const FINALIZAR: AcaoCadastroDeferida = {
  kind: "portal_submit",
  stepId: "passo-finalizar",
  flowId: "fluxo-1",
  pipeline: "finalizar_cadastro",
};

const ROTEIRO: TurnoRoteiro[] = [
  {
    nome: "texto: abertura",
    inbound: { inboundText: "oi", inboundKind: "text" },
    acaoCadastro: undefined,
    legacyStep: "saudacao",
  },
  {
    nome: "texto: demonstra interesse",
    inbound: { inboundText: "quero economizar na conta de luz", inboundKind: "text" },
    acaoCadastro: undefined,
    legacyStep: "interesse",
  },
  {
    nome: "texto: nome e valor",
    inbound: { inboundText: "Maria Silva, minha conta é 450", inboundKind: "text" },
    acaoCadastro: undefined,
    legacyStep: "coleta_dados",
  },
  {
    nome: "foto da conta de luz",
    inbound: { inboundMediaKind: "image", inboundMessageId: "msg-conta" },
    acaoCadastro: OCR_CONTA,
    legacyStep: "aguardando_foto_conta",
  },
  {
    nome: "documento (frente/verso)",
    inbound: { inboundMediaKind: "document", inboundMessageId: "msg-doc" },
    acaoCadastro: OCR_DOC,
    legacyStep: "aguardando_documento",
  },
  {
    nome: "finalização do cadastro",
    inbound: { inboundText: "maria@gmail.com", inboundKind: "text" },
    acaoCadastro: FINALIZAR,
    legacyStep: "finalizando",
  },
];

// ─── EngineOutput mínimo (formato real do motor) para compor o ResultadoCerebro ─

function engineOutputVazio(): EngineOutput {
  return {
    outbound: [],
    stateUpdate: {},
    logs: [],
    deferred: undefined,
  } as unknown as EngineOutput;
}

/**
 * Monta o `ResultadoCerebro` que o N1 (Orquestrador) produziria num turno, com
 * a `acaoCadastro` repassada quando o passo é de mídia/finalização. Em sombra,
 * o `reply`/`outbound` existem mas NUNCA são enviados (o hook ignora o envio).
 */
function resultadoDoTurno(t: TurnoRoteiro): ResultadoCerebro {
  return {
    reply: t.acaoCadastro ? "" : "Mensagem comercial do passo (não enviada em sombra).",
    outbound: [],
    stateUpdate: {},
    shouldHandoff: false,
    decisao: {
      passoAtualId: t.legacyStep,
      proximoPassoId: t.legacyStep,
      intencao: "demonstrar_interesse",
    },
    ...(t.acaoCadastro ? { acaoCadastro: t.acaoCadastro } : {}),
    _engineOutput: engineOutputVazio(),
  } as unknown as ResultadoCerebro;
}

// ─── Supabase falso + fetch stub para o dispatchPortalWorker REAL (finalização) ─
//
// Mesmo padrão dos testes 11.2/11.3: cliente com TODOS os documentos presentes
// (conta + frente + verso de RG) para o gate do Portal 2 liberar e o despacho
// ocorrer de verdade — provando que a sequência completa "fecha".

const URL_VALIDA = "https://exemplo/arquivo.jpg";

function fazerSupabaseFalsoCompleto() {
  const updates: Array<Record<string, unknown>> = [];
  const customerRow = {
    id: "cliente-e2e",
    consultant_id: "consultor-1",
    consultants: { portal_kind: "autoconexao", igreen_id: 4242, name: "Consultor" },
    document_type: "rg",
    electricity_bill_photo_url: URL_VALIDA,
    bill_base64: "data:image/jpeg;base64,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", // preflight exige bytes
    document_front_url: URL_VALIDA,
    document_front_base64: "data:image/jpeg;base64,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    document_back_url: URL_VALIDA, // verso presente → RG completo
    document_back_base64: "data:image/jpeg;base64,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    cpf: "00000000000",
    name: "Maria Silva",
    doc_holder_name: "Maria Silva",
    data_nascimento: "1990-01-01",
    phone_whatsapp: "5511999999999",
    portal2_celular_alt: null,
    email: "maria@gmail.com",
    cep: "00000000",
    address_street: "Rua",
    address_number: "1",
    address_complement: "",
    address_neighborhood: "Centro",
    address_city: "Cidade",
    address_state: "SP",
    numero_instalacao: "123",
    media_consumo: 300,
    electricity_bill_value: 450,
    distribuidora: "CPFL",
    referral_partners: null,
  };
  const settingsRows = [
    { key: "portal2_worker_url", value: "http://worker-portal-2:3101" },
    { key: "portal2_worker_secret", value: "segredo-portal2" },
  ];
  function from(table: string) {
    if (table === "settings") {
      return { select: (_c?: string) => Promise.resolve({ data: settingsRows }) };
    }
    return {
      select: (_c?: string) => ({
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

function instalarFetchStub() {
  const original = globalThis.fetch;
  const chamadas: string[] = [];
  globalThis.fetch = ((input: string | URL | Request, _init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    chamadas.push(url);
    if (url.endsWith("/health")) return Promise.resolve(new Response("ok", { status: 200 }));
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

// ─── Deps de sombra (offline): flag `dark`, Cérebro controlado pelo roteiro ──

function montarDepsSombra(resultado: ResultadoCerebro) {
  let processarChamado = 0;
  let registrarChamado = 0;
  const deps = {
    // deno-lint-ignore no-explicit-any
    lerFlag: (_s: any, _c: string) => Promise.resolve("dark" as const),
    // deno-lint-ignore no-explicit-any
    processarTurno: (_e: any) => {
      processarChamado++;
      return Promise.resolve(resultado);
    },
    // deno-lint-ignore no-explicit-any
    registrarDecisaoSombra: (_e: any) => {
      registrarChamado++;
      return Promise.resolve({ ok: true, coincide: true });
    },
  };
  return {
    deps,
    contagem: () => ({ processarChamado, registrarChamado }),
  };
}

function entradaTurno(t: TurnoRoteiro): EntradaSombraHook {
  return {
    // deno-lint-ignore no-explicit-any
    supabase: { from() { throw new Error("supabase de sombra não deve ser usado"); } } as any,
    customerId: "cliente-e2e",
    consultantId: "consultor-1",
    channel: "evolution",
    legacyStep: t.legacyStep,
    ...t.inbound,
  };
}

// ─── TESTE PRINCIPAL: a conversa completa, turno a turno ─────────────────────

Deno.test(
  "11.5 E2E: conversa completa (texto→foto→documento→finalização) — sombra não interfere e o cadastro fecha",
  async () => {
    const stub = instalarFetchStub();
    const sb = fazerSupabaseFalsoCompleto();

    // Trilha observável da conversa, para auditar a sequência ao final.
    const trilha: Array<{
      turno: string;
      enviouAoCliente: boolean;
      registrou: boolean;
      acaoKind?: string;
      destino?: string;
      acionouPortalWorker: boolean;
    }> = [];

    try {
      for (const t of ROTEIRO) {
        // 1) Turno passa pelo Cérebro em SOMBRA — NUNCA envia ao cliente.
        const { deps } = montarDepsSombra(resultadoDoTurno(t));
        const sombra = await executarCerebroSombra({ ...entradaTurno(t), deps });

        // Invariante de sombra (Tarefa 9 / Requisito 16.1): roda, registra, mas
        // nada é enviado ao cliente. O caminho atual segue intacto.
        assertEquals(sombra.executou, true, `${t.nome}: o Cérebro deveria rodar em dark`);
        assertEquals(sombra.flag, "dark");
        assertEquals(sombra.registrou, true, `${t.nome}: deveria registrar a decisão`);
        assertEquals(
          sombra.enviouAoCliente,
          false,
          `${t.nome}: sombra JAMAIS envia ao cliente`,
        );

        // 2) Quando o passo tem ação de cadastro, ela é REPASSADA pelo ponto
        //    único. Na finalização, isso aciona o dispatchPortalWorker REAL.
        let destino: string | undefined;
        let acionouPortalWorker = false;
        if (t.acaoCadastro) {
          const r = await despacharAcaoCadastro({
            supabase: sb.client,
            customerId: "cliente-e2e",
            acaoCadastro: t.acaoCadastro,
            // SEM deps na finalização: usa o dispatchPortalWorker REAL (gate dele).
          });
          destino = r.destino;
          acionouPortalWorker = r.acionouPortalWorker;
        }

        trilha.push({
          turno: t.nome,
          enviouAoCliente: sombra.enviouAoCliente,
          registrou: sombra.registrou,
          acaoKind: t.acaoCadastro?.kind,
          destino,
          acionouPortalWorker,
        });
      }

      // ─── Asserções sobre a SEQUÊNCIA completa ─────────────────────────────

      // (a) Todos os 6 turnos rodaram e NENHUM enviou ao cliente (sombra).
      assertEquals(trilha.length, ROTEIRO.length);
      assert(
        trilha.every((p) => p.enviouAoCliente === false),
        "nenhum turno pode enviar ao cliente em sombra",
      );
      assert(
        trilha.every((p) => p.registrou === true),
        "todo turno em sombra deve registrar a decisão (1 por turno)",
      );

      // (b) Os dois turnos de mídia (foto/documento) viraram OCR repassado ao
      //     dispatcher existente — sem tocar o worker do portal.
      const turnosOcr = trilha.filter((p) => p.acaoKind === "ocr");
      assertEquals(turnosOcr.length, 2, "esperava 2 turnos de OCR (conta + documento)");
      assert(
        turnosOcr.every((p) => p.destino === "dispatcher_existente"),
        "OCR deve ir ao dispatcher existente, não ao worker do portal",
      );
      assert(
        turnosOcr.every((p) => p.acionouPortalWorker === false),
        "turnos de OCR não podem acionar o worker do portal",
      );

      // (c) A finalização foi o ÚNICO turno a acionar o worker do portal, e o
      //     cadastro de fato FECHOU (POST /submit-lead via dispatchPortalWorker).
      const turnosPortal = trilha.filter((p) => p.acaoKind === "portal_submit");
      assertEquals(turnosPortal.length, 1, "esperava exatamente 1 finalização");
      assertEquals(turnosPortal[0].destino, "portal_worker");
      assert(turnosPortal[0].acionouPortalWorker, "a finalização deve acionar o worker do portal");
      assert(
        stub.enviouSubmitLead(),
        "a conversa completa deveria terminar com submit-lead no worker (cadastro fecha)",
      );

      // (d) Roteamento preservado pelo HELPER (não pelo Cérebro): o POST foi
      //     para a URL do worker-portal-2 (autoconexao), escolhida dentro do
      //     dispatchPortalWorker a partir de consultants.portal_kind.
      assert(
        stub.chamadas.some((u) => u.includes("worker-portal-2")),
        "o despacho deveria ter ido para o worker-portal-2 (roteamento autoconexao do helper)",
      );
    } finally {
      stub.restaurar();
    }
  },
);

// ─── Não-regressão sob falha: Cérebro fail-open não derruba a conversa ───────

Deno.test(
  "11.5 E2E: se o Cérebro falhar num turno, a conversa segue (fail-open, sombra neutra)",
  async () => {
    // Cérebro que LANÇA: o hook deve engolir e devolver resultado neutro,
    // sem enviar ao cliente e sem propagar o erro (não-regressão / Req 16.1).
    const deps = {
      // deno-lint-ignore no-explicit-any
      lerFlag: (_s: any, _c: string) => Promise.resolve("dark" as const),
      // deno-lint-ignore no-explicit-any
      processarTurno: (_e: any) => {
        throw new Error("falha simulada no Cérebro no meio da conversa");
      },
      // deno-lint-ignore no-explicit-any
      registrarDecisaoSombra: (_e: any) => Promise.resolve({ ok: true, coincide: true }),
    };

    const r = await executarCerebroSombra({
      ...entradaTurno(ROTEIRO[3]), // turno da foto da conta
      deps,
    });

    // Fail-open: não lançou, não registrou, e nada saiu ao cliente.
    assertEquals(r.executou, false);
    assertEquals(r.registrou, false);
    assertEquals(r.enviouAoCliente, false);
  },
);
