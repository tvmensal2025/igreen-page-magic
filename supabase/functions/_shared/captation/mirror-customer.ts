// mirror-customer.ts
// ──────────────────
// Espelha um registro de `customers` para `captured_leads`. Os webhooks de
// WhatsApp (Evolution / Whapi) criam customers no primeiro contato — sem este
// espelho, esses leads nunca apareciam no painel de Captação, que lê apenas
// `captured_leads`.
//
// Idempotente: usa `ingestLead` (dedup_key por consultor+telefone). Se já
// existir, atualiza o canal/atribuição quando descobrimos que o lead veio de
// anúncio (CTWA / Meta Ads).

// Aceita qualquer client: createClient(@2) e pins de patch divergem nos generics.
import { ingestLead, type LeadChannel } from "./lead-ingest.ts";
import { normalizePhone } from "../utils.ts";

export async function mirrorCustomerToCaptation(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  customerId: string,
): Promise<void> {
  try {
    const { data: c } = await supabase
      .from("customers")
      .select(
        "id, consultant_id, name, phone_whatsapp, email, address_city, address_state, lead_source, ctwa_clid, source_ctwa_clid, source_ad_id, source_campaign_id, customer_origin, origin_channel",
      )
      .eq("id", customerId)
      .maybeSingle();

    if (!c || !c.consultant_id) return;
    if (!c.phone_whatsapp && !c.email) return;

    const ls = JSON.stringify(c.lead_source || "").toLowerCase();
    const isAd =
      !!(c.source_campaign_id || c.source_ad_id || c.ctwa_clid || c.source_ctwa_clid) ||
      /(meta|face|insta|ctwa|ads|leadads)/.test(ls);

    const channel: LeadChannel = isAd ? "ctwa" : "manual";

    const res = await ingestLead(supabase, {
      consultantId: c.consultant_id,
      channel,
      personType: "pf",
      fullName: c.name,
      phone: c.phone_whatsapp,
      email: c.email,
      city: c.address_city,
      uf: c.address_state,
      sourceCampaignId: c.source_campaign_id ?? null,
      ctwaClid: c.ctwa_clid || c.source_ctwa_clid || null,
      consentSource: "whatsapp_inbound_mirror",
      rawPayload: {
        mirror: true,
        customer_id: c.id,
        origin_channel: c.origin_channel,
        customer_origin: c.customer_origin,
        lead_source: c.lead_source,
        source_ad_id: c.source_ad_id,
      },
    });

    // Quando já existia como 'manual' e agora descobrimos sinal de ad,
    // promove para 'ctwa' e fixa a atribuição.
    if (res.ok && res.deduped && isAd) {
      const phone = normalizePhone(c.phone_whatsapp || "");
      if (phone) {
        const patch: Record<string, unknown> = { channel: "ctwa" };
        if (c.source_campaign_id) patch.source_campaign_id = c.source_campaign_id;
        const clid = c.ctwa_clid || c.source_ctwa_clid;
        if (clid) patch.ctwa_clid = clid;
        await supabase
          .from("captured_leads")
          .update(patch)
          .eq("consultant_id", c.consultant_id)
          .eq("phone", phone);
      }
    }
  } catch (e) {
    console.warn("[mirror-customer] falhou:", (e as Error)?.message);
  }
}
