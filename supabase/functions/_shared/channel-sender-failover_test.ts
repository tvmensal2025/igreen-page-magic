/**
 * Failover de canal: NUNCA usar Whapi compartilhado (número do superadmin)
 * para consultor Evolution sem instância própria.
 */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  isUnavailable,
  resolveChannelForCustomerWithFailover,
} from "./channel-sender.ts";

function mockSupabase(opts: {
  customer: { consultant_id: string; origin_channel: string | null; origin_instance_name: string | null };
  /** Instâncias Evolution/Whapi do consultor (podem ser vazias). */
  instances?: Array<{
    instance_name: string;
    status: string;
    manual_review_required?: boolean;
    fatal_lock_until?: string | null;
  }>;
  /** Status da instância de origem (resolveChannelForCustomer). */
  originInst?: {
    status: string;
    manual_review_required?: boolean;
    fatal_lock_until?: string | null;
  } | null;
}) {
  const instances = opts.instances ?? [];
  return {
    from(table: string) {
      if (table === "customers") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: opts.customer }),
            }),
          }),
        };
      }
      if (table === "whatsapp_instances") {
        const api: any = {
          _filters: {} as Record<string, string>,
          select() {
            return api;
          },
          eq(col: string, val: string) {
            api._filters[col] = val;
            return api;
          },
          like(col: string, val: string) {
            api._filters[`like:${col}`] = val;
            return api;
          },
          order() {
            return api;
          },
          limit() {
            return api;
          },
          maybeSingle: async () => {
            // Busca por instance_name exata (origem)
            if (api._filters.instance_name) {
              if (opts.originInst === null) return { data: null };
              if (opts.originInst) return { data: opts.originInst };
              return { data: null };
            }
            let list = instances.filter((i) =>
              !api._filters.consultant_id || true
            );
            const like = api._filters["like:instance_name"];
            if (like === "whapi%") {
              list = list.filter((i) => i.instance_name.startsWith("whapi"));
            } else if (api._filters.consultant_id && !like) {
              // failover Evolution: excluímos whapi no código; aqui devolvemos a 1ª
              list = list.filter((i) => !i.instance_name.startsWith("whapi"));
            }
            return { data: list[0] ?? null };
          },
        };
        return api;
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}

const env = {
  evolutionUrl: "https://evo.example",
  evolutionKey: "key",
  whapiToken: "shared-token-rafael",
};

Deno.test("failover: Evolution offline SEM whapi próprio → unavailable (não usa Zap do Rafael)", async () => {
  const supabase = mockSupabase({
    customer: {
      consultant_id: "sirlene-id",
      origin_channel: "evolution",
      origin_instance_name: "igreen-sirlene",
    },
    originInst: null, // instância sumiu
    instances: [], // consultor sem canal
  });
  const ch = await resolveChannelForCustomerWithFailover(supabase as any, "cust-1", env);
  assertEquals(isUnavailable(ch), true);
  if (isUnavailable(ch)) {
    assertEquals(ch.reason, "instance_not_found");
  }
});

Deno.test("failover: Evolution offline COM whapi próprio → usa whapi do consultor", async () => {
  const supabase = mockSupabase({
    customer: {
      consultant_id: "rafael-id",
      origin_channel: "evolution",
      origin_instance_name: "igreen-rafael-old",
    },
    originInst: { status: "close" },
    instances: [
      { instance_name: "whapi-superadmin", status: "connected" },
    ],
  });
  const ch = await resolveChannelForCustomerWithFailover(supabase as any, "cust-2", env);
  assertEquals(isUnavailable(ch), false);
  if (!isUnavailable(ch)) {
    assertEquals(ch.kind, "whapi");
    assertEquals(ch.instanceName, "whapi-superadmin");
  }
});
