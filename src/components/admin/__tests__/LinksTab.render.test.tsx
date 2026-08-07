import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { LinksTab } from "../LinksTab";

vi.mock("@/components/ui/sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/features/produtos/catalogo", () => ({ useProducts: () => ({ data: undefined }) }));
vi.mock("@/lib/resolvePublicConsultant", () => ({
  resolvePublicConsultant: vi.fn().mockResolvedValue(null),
}));
vi.mock("../LinksDashboard", () => ({
  LinksDashboard: ({ embedded }: { embedded?: boolean }) => (
    <div data-testid="dash">{embedded ? "embedded" : "standalone"}</div>
  ),
}));

const onCopy = vi.fn();
const onQrOpen = vi.fn();
const onPanfletoOpen = vi.fn();

function renderTab() {
  return render(
    <LinksTab
      slug="rafael"
      baseUrl="igreenenergy.com.br"
      consultantId="c-1"
      onCopy={onCopy}
      onQrOpen={onQrOpen}
      onPanfletoOpen={onPanfletoOpen}
    />,
  );
}

describe("LinksTab — página Seus links", () => {
  beforeEach(() => {
    onCopy.mockClear();
    onQrOpen.mockClear();
  });

  it("mostra os links padrão e o painel de resultados embutido", () => {
    renderTab();
    expect(screen.getByText("Seus links")).toBeInTheDocument();
    expect(screen.getByText("Conexão Green")).toBeInTheDocument();
    expect(screen.getByText("https://igreenenergy.com.br/rafael")).toBeInTheDocument();
    expect(screen.getByTestId("dash")).toHaveTextContent("embedded");
  });

  it("troca para premium sem misturar com o link padrão", () => {
    renderTab();
    fireEvent.click(screen.getByRole("button", { name: /Página premium/i }));
    expect(screen.getByText("https://igreenenergy.com.br/premium/rafael")).toBeInTheDocument();
    expect(screen.queryByText("https://igreenenergy.com.br/rafael")).not.toBeInTheDocument();
    // Cadastro Rápido não tem premium — sai da lista.
    expect(screen.queryByText("Cadastro Rápido")).not.toBeInTheDocument();
  });

  it("copia o link do produto", () => {
    renderTab();
    fireEvent.click(screen.getAllByRole("button", { name: /^Copiar$/ })[0]);
    expect(onCopy).toHaveBeenCalledWith("https://igreenenergy.com.br/rafael");
  });

  it("abre compartilhar por rede com utm_source", () => {
    renderTab();
    const trigger = screen.getAllByRole("button", { name: /Compartilhar por rede/i })[0];
    fireEvent.click(trigger);
    const bloco = screen.getByText("Instagram").closest("div") as HTMLElement;
    fireEvent.click(within(bloco).getByRole("button", { name: /Copiar/i }));
    expect(onCopy).toHaveBeenCalledWith(
      "https://igreenenergy.com.br/rafael?utm_source=instagram",
    );
  });

  it("mantém os âncoras do tour guiado", () => {
    const { container } = renderTab();
    expect(container.querySelector('[data-tour="links-meus"]')).toBeTruthy();
    expect(container.querySelector('[data-tour="links-copiar"]')).toBeTruthy();
    expect(container.querySelector('[data-tour="links-panfleto"]')).toBeTruthy();
    expect(container.querySelector('[data-tour="links-panfleto-gerar"]')).toBeTruthy();
  });
});
