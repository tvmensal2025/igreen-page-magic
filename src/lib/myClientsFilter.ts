import { isDirectCustomer, type GreenSettings } from "@/features/produtos/acompanhamento/greenCommission";
import { isIgreenWalletOrigin } from "@/lib/customerOrigin";

export type MyClientsSettings = Pick<GreenSettings, "myIgreenId" | "cadastroIgreenIds" | "consultantName">;

export type CustomerOriginSlice = {
  customer_origin?: string | null;
  registered_by_igreen_id?: string | number | null;
  registered_by_name?: string | null;
};

/**
 * Lead WhatsApp/manual sempre é "meu".
 * Carteira iGreen com ID do cadastrador confiável continua separando CP/rede.
 * Quando o sync do portal não traz esse ID, o registro já veio escopado pelo
 * consultant_id da conta sincronizada; nesses casos não podemos esconder da aba.
 */
export function isMyClient(customer: CustomerOriginSlice, settings: MyClientsSettings): boolean {
  const origin = customer.customer_origin || "whatsapp_lead";
  if (origin === "whatsapp_lead" || origin === "manual") return true;
  if (isIgreenWalletOrigin(origin)) {
    if (customer.registered_by_igreen_id == null || String(customer.registered_by_igreen_id).trim() === "") {
      return true;
    }
    return isDirectCustomer(
      customer.registered_by_igreen_id != null ? String(customer.registered_by_igreen_id) : null,
      customer.registered_by_name,
      settings,
    );
  }
  return true;
}

export function filterMyClients<T extends CustomerOriginSlice>(
  customers: T[],
  settings: MyClientsSettings,
): T[] {
  return customers.filter((c) => isMyClient(c, settings));
}
