/**
 * Testes unitários de `useRodizioLogic` (Tarefa 12.2).
 *
 * Cobrem:
 *   - `validateInlineForm` de forma exaustiva: CONSULTOR exige `partner_igreen_id`;
 *     PARCEIRO exige `cli`; ambos exigem nome e telefone de aviso
 *     (Requisitos 3.2, 3.3, 4.2, 4.3).
 *   - Comportamento do hook renderizado:
 *       * toggle liga/desliga e descarta a seleção (Requisitos 1.2, 1.3);
 *       * bloqueio de participante duplicado com aviso (Requisito 2.4);
 *       * mínimo de 1 participante quando o destino exclusivo/rodízio está ligado.
 *
 * O serviço `@/services/referralPartners` e o `useToast` são mockados para
 * isolar a lógica do hook (sem rede e sem toasts reais).
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useState, useCallback } from "react";

// --- Mocks ------------------------------------------------------------------

// toast mockado (compartilhado entre os testes) via vi.hoisted para poder ser
// referenciado dentro da factory do vi.mock (que é içada para o topo).
const { toastMock } = vi.hoisted(() => ({ toastMock: vi.fn() }));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

const { listActiveReferralPartnersMock, createReferralPartnerMock } = vi.hoisted(
  () => ({
    listActiveReferralPartnersMock: vi.fn(),
    createReferralPartnerMock: vi.fn(),
  }),
);

vi.mock("@/services/referralPartners", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/referralPartners")>();
  return {
    ...actual,
    listActiveReferralPartners: listActiveReferralPartnersMock,
    createReferralPartner: createReferralPartnerMock,
  };
});

import { useRodizioLogic, validateInlineForm } from "../useRodizioLogic";
import type {
  WizardState,
  RodizioPartnerDraft,
  RodizioInlineForm,
} from "../useWizardState";

// --- Helpers ----------------------------------------------------------------

/** Constrói um WizardState mínimo (só o que o hook lê) para os testes. */
function makeState(partial: Partial<WizardState> = {}): WizardState {
  return {
    rodizioEnabled: false,
    rodizioPartners: [],
    rodizioPartnersLoading: false,
    rodizioInlineForm: null,
    ...partial,
  } as unknown as WizardState;
}

/** Participante de exemplo para a lista ordenada. */
function makePartner(id: string, nome = `Part ${id}`): RodizioPartnerDraft {
  return {
    id,
    nome,
    tipo: "parceiro",
    partner_igreen_id: null,
    cli: "10",
    notification_phone: "5511999999999",
  };
}

/**
 * Harness que simula o estado do wizard (state + patch + patchFn) e renderiza
 * o hook por cima, exatamente como o wizard real faz.
 */
function useHarness(initial: Partial<WizardState> = {}) {
  const [state, setState] = useState<WizardState>(() => makeState(initial));
  const patch = useCallback(
    (p: Partial<WizardState>) => setState((prev) => ({ ...prev, ...p })),
    [],
  );
  const patchFn = useCallback(
    (fn: (prev: WizardState) => Partial<WizardState>) =>
      setState((prev) => ({ ...prev, ...fn(prev) })),
    [],
  );
  const logic = useRodizioLogic({ open: true, state, patch, patchFn });
  return { state, logic };
}

/**
 * Drena os efeitos assíncronos do hook (ex.: carregamento de participantes
 * disparado quando o rodízio já inicia ligado), evitando avisos de `act(...)`.
 */
async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // Por padrão, carregar participantes não retorna nada (evita efeito colateral).
  listActiveReferralPartnersMock.mockResolvedValue([]);
});

// --- validateInlineForm (Req 3.2, 3.3, 4.2, 4.3) ----------------------------

function fieldsOf(erros: ReturnType<typeof validateInlineForm>) {
  return erros.map((e) => e.field);
}

describe("validateInlineForm — CONSULTOR", () => {
  const baseConsultor: RodizioInlineForm = {
    tipo: "consultor",
    nome: "João",
    notification_phone: "5511999999999",
    partner_igreen_id: "12345",
    cli: "",
  };

  it("aceita CONSULTOR válido (cli opcional)", () => {
    expect(validateInlineForm(baseConsultor)).toEqual([]);
  });

  it("Req 3.2 — bloqueia quando partner_igreen_id está vazio", () => {
    const erros = validateInlineForm({ ...baseConsultor, partner_igreen_id: "" });
    expect(fieldsOf(erros)).toContain("partner_igreen_id");
  });

  it("Req 3.2 — partner_igreen_id só com espaços também é inválido", () => {
    const erros = validateInlineForm({ ...baseConsultor, partner_igreen_id: "   " });
    expect(fieldsOf(erros)).toContain("partner_igreen_id");
  });

  it("Req 3.3 — bloqueia quando o nome está vazio", () => {
    const erros = validateInlineForm({ ...baseConsultor, nome: "" });
    expect(fieldsOf(erros)).toContain("nome");
  });

  it("Req 3.3 — bloqueia quando o telefone de aviso está vazio", () => {
    const erros = validateInlineForm({ ...baseConsultor, notification_phone: "" });
    expect(fieldsOf(erros)).toContain("notification_phone");
  });

  it("Req 3.3 — não exige cli para CONSULTOR", () => {
    const erros = validateInlineForm({ ...baseConsultor, cli: "" });
    expect(fieldsOf(erros)).not.toContain("cli");
  });
});

describe("validateInlineForm — PARCEIRO/INDICADOR", () => {
  const baseParceiro: RodizioInlineForm = {
    tipo: "parceiro",
    nome: "Maria",
    notification_phone: "5511988888888",
    partner_igreen_id: "",
    cli: "777",
  };

  it("aceita PARCEIRO válido", () => {
    expect(validateInlineForm(baseParceiro)).toEqual([]);
  });

  it("Req 4.2 — bloqueia quando cli está vazio", () => {
    const erros = validateInlineForm({ ...baseParceiro, cli: "" });
    expect(fieldsOf(erros)).toContain("cli");
  });

  it("Req 4.2 — cli só com espaços também é inválido", () => {
    const erros = validateInlineForm({ ...baseParceiro, cli: "  " });
    expect(fieldsOf(erros)).toContain("cli");
  });

  it("Req 4.3 — bloqueia quando o nome está vazio", () => {
    const erros = validateInlineForm({ ...baseParceiro, nome: "" });
    expect(fieldsOf(erros)).toContain("nome");
  });

  it("Req 4.3 — bloqueia quando o telefone de aviso está vazio", () => {
    const erros = validateInlineForm({ ...baseParceiro, notification_phone: "" });
    expect(fieldsOf(erros)).toContain("notification_phone");
  });

  it("Req 4.2 — não exige partner_igreen_id para PARCEIRO", () => {
    const erros = validateInlineForm({ ...baseParceiro, partner_igreen_id: "" });
    expect(fieldsOf(erros)).not.toContain("partner_igreen_id");
  });
});

describe("validateInlineForm — múltiplos erros", () => {
  it("Req 3.3/4.3 — acumula nome + telefone + campo específico", () => {
    const erros = validateInlineForm({
      tipo: "consultor",
      nome: "",
      notification_phone: "",
      partner_igreen_id: "",
      cli: "",
    });
    expect(fieldsOf(erros)).toEqual(["nome", "notification_phone", "partner_igreen_id"]);
  });

  it("PARCEIRO com tudo vazio acumula nome + telefone + cli", () => {
    const erros = validateInlineForm({
      tipo: "parceiro",
      nome: "",
      notification_phone: "",
      partner_igreen_id: "",
      cli: "",
    });
    expect(fieldsOf(erros)).toEqual(["nome", "notification_phone", "cli"]);
  });
});

// --- Toggle liga/desliga (Req 1.2, 1.3) -------------------------------------

describe("useRodizioLogic — toggle de rodízio", () => {
  it("Req 1.2 — ligar o rodízio marca rodizioEnabled = true", () => {
    const { result } = renderHook(() => useHarness({ rodizioEnabled: false }));
    act(() => result.current.logic.setRodizioEnabled(true));
    expect(result.current.state.rodizioEnabled).toBe(true);
  });

  it("Req 1.3 — desligar o rodízio descarta a seleção e o form inline", async () => {
    const { result } = renderHook(() =>
      useHarness({
        rodizioEnabled: true,
        rodizioPartners: [makePartner("a"), makePartner("b")],
        rodizioInlineForm: {
          tipo: "parceiro",
          nome: "X",
          notification_phone: "1",
          partner_igreen_id: "",
          cli: "9",
        },
      }),
    );
    await flushEffects();

    act(() => result.current.logic.setRodizioEnabled(false));

    expect(result.current.state.rodizioEnabled).toBe(false);
    expect(result.current.state.rodizioPartners).toEqual([]);
    expect(result.current.state.rodizioInlineForm).toBeNull();
  });
});

// --- Bloqueio de duplicado (Req 2.4) ----------------------------------------

describe("useRodizioLogic — adicionar/remover participantes", () => {
  it("adiciona um participante novo à lista ordenada", async () => {
    const { result } = renderHook(() => useHarness({ rodizioEnabled: true }));
    await flushEffects();
    act(() => result.current.logic.addPartner(makePartner("a")));
    expect(result.current.state.rodizioPartners.map((p) => p.id)).toEqual(["a"]);
  });

  it("Req 2.4 — impede duplicado e exibe aviso", async () => {
    const { result } = renderHook(() =>
      useHarness({ rodizioEnabled: true, rodizioPartners: [makePartner("a")] }),
    );
    await flushEffects();

    act(() => result.current.logic.addPartner(makePartner("a")));

    // Continua com 1 só (não duplica).
    expect(result.current.state.rodizioPartners.map((p) => p.id)).toEqual(["a"]);
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: "♻️ Já está no rodízio" }),
    );
  });

  it("remove um participante da lista ordenada pelo id", async () => {
    const { result } = renderHook(() =>
      useHarness({
        rodizioEnabled: true,
        rodizioPartners: [makePartner("a"), makePartner("b")],
      }),
    );
    await flushEffects();
    act(() => result.current.logic.removePartner("a"));
    expect(result.current.state.rodizioPartners.map((p) => p.id)).toEqual(["b"]);
  });
});

// --- Mínimo de 1 participante (destino exclusivo / rodízio) -----------------

describe("useRodizioLogic — mínimo de 1 participante", () => {
  it("rodízio desligado → sem erro de mínimo", () => {
    const { result } = renderHook(() => useHarness({ rodizioEnabled: false }));
    expect(result.current.logic.minParticipantsError).toBeNull();
  });

  it("ligado com 0 participantes → erro de mínimo", async () => {
    const { result } = renderHook(() => useHarness({ rodizioEnabled: true }));
    await flushEffects();
    expect(result.current.logic.minParticipantsError).toMatch(/pelo menos 1 pessoa/);
  });

  it("ligado com 1 participante → sem erro (destino exclusivo)", async () => {
    const { result } = renderHook(() =>
      useHarness({ rodizioEnabled: true, rodizioPartners: [makePartner("a")] }),
    );
    await flushEffects();
    expect(result.current.logic.minParticipantsError).toBeNull();
  });

  it("ligado com 2 participantes → sem erro (rodízio circular)", async () => {
    const { result } = renderHook(() =>
      useHarness({
        rodizioEnabled: true,
        rodizioPartners: [makePartner("a"), makePartner("b")],
      }),
    );
    await flushEffects();
    expect(result.current.logic.minParticipantsError).toBeNull();
  });
});

// --- submitInlineForm: validação bloqueia criação (Req 3.2, 4.2) ------------

describe("useRodizioLogic — submitInlineForm", () => {
  it("Req 3.2 — form inválido NÃO chama createReferralPartner e avisa", async () => {
    const { result } = renderHook(() =>
      useHarness({
        rodizioEnabled: true,
        rodizioInlineForm: {
          tipo: "consultor",
          nome: "João",
          notification_phone: "5511999999999",
          partner_igreen_id: "", // inválido para CONSULTOR
          cli: "",
        },
      }),
    );

    await act(async () => {
      await result.current.logic.submitInlineForm();
    });

    expect(createReferralPartnerMock).not.toHaveBeenCalled();
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: "⚠️ Confira os campos abaixo" }),
    );
  });

  it("form válido cria o participante e adiciona à lista ordenada", async () => {
    const novo = makePartner("novo", "Recém-criado");
    createReferralPartnerMock.mockResolvedValueOnce(novo);

    const { result } = renderHook(() =>
      useHarness({
        rodizioEnabled: true,
        rodizioInlineForm: {
          tipo: "parceiro",
          nome: "Maria",
          notification_phone: "5511988888888",
          partner_igreen_id: "",
          cli: "777",
        },
      }),
    );

    await act(async () => {
      await result.current.logic.submitInlineForm();
    });

    expect(createReferralPartnerMock).toHaveBeenCalledTimes(1);
    expect(result.current.state.rodizioPartners.map((p) => p.id)).toEqual([
      "novo",
    ]);
    expect(result.current.state.rodizioInlineForm).toBeNull();
  });
});
