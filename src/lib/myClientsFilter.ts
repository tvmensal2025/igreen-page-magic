import { isDirectCustomer, type GreenSettings } from "@/features/produtos/acompanhamento/greenCommission";
import { isIgreenWalletOrigin } from "@/lib/customerOrigin";

export type MyClientsSettings = Pick<GreenSettings, "myIgreenId" | "cadastroIgreenIds" | "consultantName">;

export type CustomerOriginSlice = {
  customer_origin?: string | null;
  registered_by_igreen_id?: string | number | null;
  registered_by_name?: string | null;
};

/** Lead WhatsApp/manual sempre é "meu"; carteira iGreen só se cadastrado pelo meu ID iGreen. */
export function isMyClient(customer: CustomerOriginSlice, settings: MyClientsSettings): boolean {
  const origin = customer.customer_origin || "whatsapp_lead";
  if (origin === "whatsapp_lead" || origin === "manual") return true;
  if (isIgreenWalletOrigin(origin)) {
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
