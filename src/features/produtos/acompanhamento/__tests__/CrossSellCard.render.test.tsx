import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CrossSellCard } from "../CrossSellCard";

vi.mock("@/integrations/supabase/client", () => {
  // Cadeia que aceita qualquer .select().eq().in()… e resolve vazio.
  const chain = (): unknown =>
    new Proxy(
      {
        then: (onFulfilled: (v: unknown) => unknown) =>
          Promise.resolve({ data: [], error: null }).then(onFulfilled),
      },
      {
        get: (target: Record<string, unknown>, prop: string) =>
          prop === "then" ? target.then : () => chain(),
      },
    );
  return { supabase: { from: () => chain() } };
});
vi.mock("../multiprodutoHooks", () => ({
  useTelecomCustomers: () => ({ data: [] }),
  useSegurosCustomers: () => ({ data: [] }),
}));
vi.mock("../CrossSellConfigDialog", () => ({ CrossSellConfigDialog: () => null }));

function renderCard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CrossSellCard consultantId="c-1" />
    </QueryClientProvider>,
  );
}

describe("CrossSellCard — recolhido por padrão", () => {
  it("nasce fechado e abre no clique, sem esconder o botão Configurar", async () => {
    renderCard();
    await screen.findByText("Oportunidades de venda cruzada");
    expect(screen.getByRole("button", { name: /Configurar/i })).toBeInTheDocument();
    expect(screen.queryByText(/Clientes de energia que ainda não têm/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Oportunidades de venda cruzada"));
    expect(screen.getByText(/Clientes de energia que ainda não têm/i)).toBeInTheDocument();
  });
});
