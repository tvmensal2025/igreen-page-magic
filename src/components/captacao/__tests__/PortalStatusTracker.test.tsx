/**
 * Teste de render do Painel_Escritorio `PortalStatusTracker` (Task 10.2).
 *
 * Cobre os estados visuais do Requisito 5 (auto/manual/indeterminado + IA
 * Gemini + motivo do manual), o banner de intervenção humana do Requisito 10
 * (needs_human) e a proteção de PII da LGPD do Requisito 12.3 (somente PII
 * mascarada é renderizada — o painel nunca reconstrói o dado em claro).
 *
 * _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.7, 5.8, 12.3_
 *
 * O componente lê de `@/integrations/supabase/client` no mount via
 * `supabase.from("customers").select(...).eq(...).maybeSingle()` e
 * `supabase.from("portal2_audit_traces").select(...).eq(...).order(...).limit(1)`,
 * e assina realtime via `supabase.channel().on().on().subscribe()`.
 * Mockamos o client para resolver linhas controladas e tornar o realtime no-op,
 * espelhando o padrão de mock de `@/integrations/supabase/client` já usado nos
 * testes de hooks do repositório.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

// Estado mutável compartilhado entre o mock (hoisted) e os testes.
const mockState = vi.hoisted(() => ({
  customer: null as Record<string, unknown> | null,
  traces: [] as Array<Record<string, unknown>>,
}));

// Mock do supabase client: resolve as duas queries do componente conforme a
// tabela e transforma o canal realtime em no-op.
vi.mock("@/integrations/supabase/client", () => {
  const customerChain = {
    select: () => ({
      eq: () => ({
        maybeSingle: () =>
          Promise.resolve({ data: mockState.customer, error: null }),
      }),
    }),
    update: () => ({
      eq: () => Promise.resolve({ data: null, error: null }),
    }),
  };
  const tracesChain = {
    select: () => ({
      eq: () => ({
        order: () => ({
          limit: () => Promise.resolve({ data: mockState.traces, error: null }),
        }),
      }),
    }),
  };
  return {
    supabase: {
      from: (table: string) =>
        table === "customers" ? customerChain : tracesChain,
      channel: () => {
        const ch: Record<string, unknown> = {};
        ch.on = () => ch;
        ch.subscribe = () => ch;
        return ch;
      },
      removeChannel: () => {},
      functions: { invoke: () => Promise.resolve({ data: {}, error: null }) },
    },
  };
});

// Toast usado apenas no fluxo de "Reenviar" (não exercitado aqui), mockado por
// segurança para não tocar o DOM real.
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { PortalStatusTracker } from "../PortalStatusTracker";

// Linha base de `customers`: `conversation_step='portal_submitting'` é um
// ACTIVE_STEP, garantindo que o painel fique visível (badges só renderizam
// quando `visible`).
function baseRow(overrides: Record<string, unknown> = {}) {
  return {
    status: "portal_submitting",
    conversation_step: "portal_submitting",
    otp_code: null,
    link_assinatura: null,
    igreen_code: null,
    error_message: null,
    finalized_at: null,
    portal2_status: null,
    portal2_extraction_mode: null,
    portal2_error_kind: null,
    ocr_done: null,
    ocr_confianca: null,
    portal2_ocr_doc_result: null,
    portal2_ocr_bill_result: null,
    ...overrides,
  };
}

function renderTracker(customer: Record<string, unknown> | null, traces: Array<Record<string, unknown>> = []) {
  mockState.customer = customer;
  mockState.traces = traces;
  return render(
    <PortalStatusTracker customerId="cust-uuid-abc" consultantId="cons-uuid-xyz" />,
  );
}

beforeEach(() => {
  mockState.customer = null;
  mockState.traces = [];
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Req 5.1 / 5.2 / 5.3 — Badge de extração: auto / manual / não determinado
// ---------------------------------------------------------------------------
describe("badge de extração (auto/manual/indeterminado)", () => {
  it("mode='auto' → 'Extração automática' (Req 5.1)", async () => {
    renderTracker(baseRow({ portal2_extraction_mode: "auto" }));
    expect(await screen.findByText(/Extração automática/)).toBeInTheDocument();
    expect(screen.queryByText(/Preenchimento manual/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Extração não determinada/)).not.toBeInTheDocument();
  });

  it("mode='manual' → 'Preenchimento manual' (Req 5.2)", async () => {
    renderTracker(baseRow({ portal2_extraction_mode: "manual" }));
    expect(await screen.findByText(/Preenchimento manual/)).toBeInTheDocument();
    expect(screen.queryByText(/Extração automática/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Extração não determinada/)).not.toBeInTheDocument();
  });

  it("mode nulo → 'Extração em andamento' (Req 5.3)", async () => {
    renderTracker(baseRow({ portal2_extraction_mode: null }));
    expect(await screen.findByText(/Extração em andamento/)).toBeInTheDocument();
    expect(screen.queryByText(/Preenchimento manual/)).not.toBeInTheDocument();
  });

  it("mode inválido → 'Extração em andamento' (Req 5.3)", async () => {
    renderTracker(baseRow({ portal2_extraction_mode: "xpto" }));
    expect(await screen.findByText(/Extração em andamento/)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Req 5.4 / 5.5 — Badge IA Gemini: analisou (com/sem confiança) / aguardando
// ---------------------------------------------------------------------------
describe("badge IA Gemini", () => {
  it("ocr_done=true + confiança numérica → 'IA analisou (confiança N%)' (Req 5.4)", async () => {
    renderTracker(baseRow({ ocr_done: true, ocr_confianca: 87 }));
    expect(await screen.findByText(/IA analisou \(confiança 87%\)/)).toBeInTheDocument();
  });

  it("ocr_done=true sem confiança → 'confiança indisponível' (Req 5.4)", async () => {
    renderTracker(baseRow({ ocr_done: true, ocr_confianca: null }));
    expect(await screen.findByText(/IA analisou \(confiança indisponível\)/)).toBeInTheDocument();
  });

  it("ocr_done ausente/falso → 'Aguardando análise da IA' (Req 5.5)", async () => {
    renderTracker(baseRow({ ocr_done: false }));
    expect(await screen.findByText(/Aguardando análise da IA/)).toBeInTheDocument();
  });
});

describe("não polui a captação cedo", () => {
  it("step de captação + error_message de debug do bot → não mostra banner de recusa", async () => {
    renderTracker(
      baseRow({
        status: "pending",
        conversation_step: "aguard_conta",
        finalized_at: null,
        error_message: "aguard_conta: isFile=true hasImage=true fileBase64Len=86572 sandbox=false",
        portal2_status: null,
      }),
    );
    // dá tempo do efeito carregar
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByText(/Cadastro recusado/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Extração/)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Req 5.7 / 5.8 — Motivo da queda em manual
// ---------------------------------------------------------------------------
describe("motivo do preenchimento manual", () => {
  it("manual + rejection_reason da conta → exibe o motivo (Req 5.7)", async () => {
    renderTracker(
      baseRow({
        portal2_extraction_mode: "manual",
        portal2_ocr_bill_result: { success: false, mode: "manual", rejection_reason: "Conta ilegível ou rasurada" },
      }),
    );
    expect(await screen.findByText(/Motivo do manual:/)).toBeInTheDocument();
    expect(screen.getByText(/Conta ilegível ou rasurada/)).toBeInTheDocument();
  });

  it("manual + error do documento (sem bill) → exibe o motivo (Req 5.7)", async () => {
    renderTracker(
      baseRow({
        portal2_extraction_mode: "manual",
        portal2_ocr_doc_result: { success: false, mode: "manual", error: "Documento não reconhecido" },
        portal2_ocr_bill_result: null,
      }),
    );
    expect(await screen.findByText(/Documento não reconhecido/)).toBeInTheDocument();
  });

  it("manual sem motivo disponível → 'motivo não disponível' (Req 5.8)", async () => {
    renderTracker(
      baseRow({
        portal2_extraction_mode: "manual",
        portal2_ocr_doc_result: null,
        portal2_ocr_bill_result: null,
      }),
    );
    expect(await screen.findByText(/motivo não disponível/)).toBeInTheDocument();
  });

  it("auto → não exibe seção de motivo do manual", async () => {
    renderTracker(baseRow({ portal2_extraction_mode: "auto" }));
    // espera o painel renderizar (badge auto) antes de afirmar ausência do motivo
    await screen.findByText(/Extração automática/);
    expect(screen.queryByText(/Motivo do manual:/)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Req 10.3 / 10.5 — Banner needs_human (vermelho) + botão "Reenviar ao portal"
// ---------------------------------------------------------------------------
describe("banner needs_human (intervenção humana)", () => {
  it("portal2_status='needs_human' → banner vermelho com classe traduzida e botão Reenviar (Req 10.3/10.5)", async () => {
    const { container } = renderTracker(
      baseRow({
        portal2_status: "needs_human",
        portal2_error_kind: "duplicate_document",
      }),
    );
    // título de ação manual
    expect(await screen.findByText(/Cadastro precisa de ação manual/)).toBeInTheDocument();
    // tradução por Classe_de_Erro (ERROR_KIND_LABELS) — duplicate_document
    expect(screen.getByText(/CPF já cadastrado no iGreen/)).toBeInTheDocument();
    // botão de reenvio manual permanece disponível
    expect(screen.getByRole("button", { name: /Reenviar ao portal/ })).toBeInTheDocument();
    // banner é vermelho (tom de erro)
    const banner = container.firstElementChild as HTMLElement;
    expect(banner.className).toMatch(/destructive/);
  });
});

// ---------------------------------------------------------------------------
// already_registered — worker marca sucesso, UI não pode ficar em "Abrindo portal"
// ---------------------------------------------------------------------------
describe("cliente já cadastrado (already_registered)", () => {
  it("portal2_status=already_registered + step legado cadastro_em_analise → sucesso (não spinner)", async () => {
    renderTracker(
      baseRow({
        status: "registered_igreen",
        conversation_step: "cadastro_em_analise",
        portal2_status: "already_registered",
        finalized_at: "2026-07-15T12:00:00Z",
      }),
    );
    expect(await screen.findByText(/Cliente já cadastrado no iGreen/)).toBeInTheDocument();
    expect(screen.queryByText(/Abrindo portal no navegador da VPS/)).not.toBeInTheDocument();
  });

  it("status=registered_igreen sozinho → sucesso mesmo com step portal_submitting", async () => {
    renderTracker(
      baseRow({
        status: "registered_igreen",
        conversation_step: "portal_submitting",
        portal2_status: null,
        finalized_at: "2026-07-15T12:00:00Z",
      }),
    );
    expect(await screen.findByText(/Cadastro aprovado pela iGreen/)).toBeInTheDocument();
    expect(screen.queryByText(/Abrindo portal no navegador da VPS/)).not.toBeInTheDocument();
  });

  it("portal_submitting travado → botões Já cadastrado e Dispensar", async () => {
    renderTracker(
      baseRow({
        status: "portal_submitting",
        conversation_step: "portal_submitting",
        portal2_status: "submitting",
        finalized_at: "2026-07-15T12:00:00Z",
      }),
    );
    expect(await screen.findByText(/Abrindo portal no navegador da VPS/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Já cadastrado/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Dispensar/ })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Req 12.3 — LGPD: apenas PII mascarada é renderizada
// ---------------------------------------------------------------------------
describe("LGPD — somente PII mascarada (Req 12.3)", () => {
  it("exibe o CPF mascarado e nunca um CPF completo de 11 dígitos", async () => {
    const { container } = renderTracker(
      baseRow({
        portal2_extraction_mode: "manual",
        // resultado já sanitizado pelo worker: CPF reduzido aos últimos dígitos
        portal2_ocr_bill_result: {
          success: false,
          mode: "manual",
          rejection_reason: "CPF ***8904 não confere com o titular da conta",
        },
      }),
    );
    // a forma mascarada aparece
    expect(await screen.findByText(/\*\*\*8904/)).toBeInTheDocument();
    // nenhum CPF completo (11 dígitos seguidos) é renderizado em todo o painel
    expect(container.textContent || "").not.toMatch(/\d{11}/);
  });
});
