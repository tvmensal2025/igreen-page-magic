import { describe, expect, it } from "vitest";
import { filterMyClients, isMyClient } from "@/lib/myClientsFilter";

const settings = {
  myIgreenId: "124170",
  consultantName: "Nilma Silva",
  cadastroIgreenIds: [] as string[],
};

describe("myClientsFilter", () => {
  it("inclui leads WhatsApp independente do licenciado", () => {
    expect(
      isMyClient(
        { customer_origin: "whatsapp_lead", registered_by_igreen_id: "999" },
        settings,
      ),
    ).toBe(true);
  });

  it("inclui cliente iGreen cadastrado pelo meu ID", () => {
    expect(
      isMyClient(
        { customer_origin: "igreen_sync", registered_by_igreen_id: "124170", registered_by_name: "Nilma" },
        settings,
      ),
    ).toBe(true);
  });

  it("exclui cliente iGreen da rede (outro licenciado)", () => {
    expect(
      isMyClient(
        { customer_origin: "igreen_sync", registered_by_igreen_id: "888888", registered_by_name: "Outro" },
        settings,
      ),
    ).toBe(false);
  });

  it("inclui carteira iGreen sincronizada quando o portal não trouxe código do cadastrador", () => {
    expect(
      isMyClient(
        { customer_origin: "igreen_sync", registered_by_igreen_id: null, registered_by_name: "Outro licenciado" },
        settings,
      ),
    ).toBe(true);
  });

  it("filterMyClients separa carteira própria da rede", () => {
    const rows = [
      { id: "1", customer_origin: "igreen_sync", registered_by_igreen_id: "124170" },
      { id: "2", customer_origin: "igreen_sync", registered_by_igreen_id: "555555" },
      { id: "3", customer_origin: "whatsapp_lead", registered_by_igreen_id: null },
    ];
    expect(filterMyClients(rows, settings).map((r) => r.id)).toEqual(["1", "3"]);
  });
});
