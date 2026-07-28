import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  normalizeWaPhoneDigits,
  resolveConsultantConnectedWaPhone,
} from "./consultant-wa-phone.ts";

Deno.test("normalizeWaPhoneDigits: adiciona 9º dígito celular antigo", () => {
  assertEquals(normalizeWaPhoneDigits("553484314317"), "5534984314317");
  assertEquals(normalizeWaPhoneDigits("+55 34 8431-4317"), "5534984314317");
});

Deno.test("resolveConsultantConnectedWaPhone: channelKind=whapi prioriza settings", async () => {
  const supabase = {
    from(table: string) {
      if (table === "settings") {
        return {
          select: () => ({
            in: async () => ({
              data: [{ key: "whapi_connected_phone", value: "+553484314317" }],
            }),
          }),
        };
      }
      if (table === "whatsapp_instances") {
        return {
          select: () => ({
            eq: () => ({
              not: () => ({
                order: () => ({
                  limit: async () => ({
                    data: [{ connected_phone: "5514998155015", status: "needs_reconnect" }],
                  }),
                }),
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected ${table}`);
    },
  };
  const phone = await resolveConsultantConnectedWaPhone(supabase as any, "silvia", {
    channelKind: "whapi",
  });
  assertEquals(phone, "5534984314317");
});

Deno.test("resolveConsultantConnectedWaPhone: ignora Evolution needs_reconnect", async () => {
  const supabase = {
    from(table: string) {
      if (table === "whatsapp_instances") {
        return {
          select: () => ({
            eq: () => ({
              not: () => ({
                order: () => ({
                  limit: async () => ({
                    data: [{ connected_phone: "5514998155015", status: "needs_reconnect" }],
                  }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === "consultants") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { phone: null } }),
            }),
          }),
        };
      }
      if (table === "settings") {
        return {
          select: () => ({
            in: async () => ({
              data: [{ key: "whapi_connected_phone", value: "+553484314317" }],
            }),
          }),
        };
      }
      throw new Error(`unexpected ${table}`);
    },
  };
  const phone = await resolveConsultantConnectedWaPhone(supabase as any, "silvia");
  assertEquals(phone, "5534984314317");
});

Deno.test("resolveConsultantConnectedWaPhone: usa instance connected saudável", async () => {
  const supabase = {
    from(table: string) {
      if (table === "whatsapp_instances") {
        return {
          select: () => ({
            eq: () => ({
              not: () => ({
                order: () => ({
                  limit: async () => ({
                    data: [{ connected_phone: "5511999887766", status: "connected" }],
                  }),
                }),
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  const phone = await resolveConsultantConnectedWaPhone(supabase as any, "c1");
  assertEquals(phone, "5511999887766");
});
