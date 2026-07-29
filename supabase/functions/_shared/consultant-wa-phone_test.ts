import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  normalizeWaPhoneDigits,
  resolveConsultantConnectedWaPhone,
  consultantHasConnectedWhatsApp,
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

Deno.test("resolveConsultantConnectedWaPhone: QR Evolution não cai no Whapi compartilhado", async () => {
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
  const phone = await resolveConsultantConnectedWaPhone(supabase as any, "evo-user", {
    allowSharedWhapiFallback: false,
  });
  assertEquals(phone, "");
});

Deno.test("consultantHasConnectedWhatsApp: superadmin ignora Evolution morta", async () => {
  const supabase = {
    from(table: string) {
      if (table === "settings") {
        return {
          select: () => ({
            in: async () => ({
              data: [
                { key: "superadmin_consultant_id", value: "rafael" },
                { key: "whapi_connected_phone", value: "+553484314317" },
              ],
            }),
          }),
        };
      }
      throw new Error(`unexpected ${table}`);
    },
  };
  const ok = await consultantHasConnectedWhatsApp(supabase as any, "rafael");
  assertEquals(ok, true);
});

Deno.test("consultantHasConnectedWhatsApp: needs_reconnect sem telefone = false", async () => {
  const supabase = {
    from(table: string) {
      if (table === "settings") {
        return {
          select: () => ({
            in: async () => ({
              data: [{ key: "superadmin_consultant_id", value: "outro" }],
            }),
          }),
        };
      }
      if (table === "whatsapp_instances") {
        return {
          select: () => ({
            eq: () => ({
              limit: async () => ({
                data: [{
                  connected_phone: null,
                  instance_name: "igreen-abc",
                  status: "needs_reconnect",
                }],
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected ${table}`);
    },
  };
  const ok = await consultantHasConnectedWhatsApp(supabase as any, "silvia");
  assertEquals(ok, false);
});

Deno.test("consultantHasConnectedWhatsApp: phone com status vazio = false", async () => {
  const supabase = {
    from(table: string) {
      if (table === "settings") {
        return {
          select: () => ({
            in: async () => ({ data: [] }),
          }),
        };
      }
      if (table === "whatsapp_instances") {
        return {
          select: () => ({
            eq: () => ({
              limit: async () => ({
                data: [{
                  connected_phone: "5511999887766",
                  instance_name: "igreen-c1",
                  status: null,
                }],
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected ${table}`);
    },
  };
  const ok = await consultantHasConnectedWhatsApp(supabase as any, "c1");
  assertEquals(ok, false);
});

Deno.test("consultantHasConnectedWhatsApp: instância saudável = true", async () => {
  const supabase = {
    from(table: string) {
      if (table === "settings") {
        return {
          select: () => ({
            in: async () => ({ data: [] }),
          }),
        };
      }
      if (table === "whatsapp_instances") {
        return {
          select: () => ({
            eq: () => ({
              limit: async () => ({
                data: [{
                  connected_phone: "5511999887766",
                  instance_name: "igreen-c1",
                  status: "connected",
                }],
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected ${table}`);
    },
  };
  const ok = await consultantHasConnectedWhatsApp(supabase as any, "c1");
  assertEquals(ok, true);
});

Deno.test("consultantHasConnectedWhatsApp: instance_name whapi spoof = false", async () => {
  const supabase = {
    from(table: string) {
      if (table === "settings") {
        return {
          select: () => ({
            in: async () => ({
              data: [{ key: "superadmin_consultant_id", value: "rafael" }],
            }),
          }),
        };
      }
      if (table === "whatsapp_instances") {
        return {
          select: () => ({
            eq: () => ({
              limit: async () => ({
                data: [{
                  connected_phone: null,
                  instance_name: "whapi-fake",
                  status: "connected",
                }],
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected ${table}`);
    },
  };
  const ok = await consultantHasConnectedWhatsApp(supabase as any, "spoof");
  assertEquals(ok, false);
});
