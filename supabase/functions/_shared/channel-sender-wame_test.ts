// Regressão do resolver com o canal piloto WAME ligado.
//
// Duas garantias, nessa ordem de importância:
//   1. Whapi e Evolution resolvem exatamente como antes.
//   2. Lead do WAME NUNCA sai por outro chip — nem no ramo Whapi (que é o
//      default do resolver), nem no failover. Sem isso, o lead do número
//      piloto receberia resposta pelo número do superadmin.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  isUnavailable,
  isWameInstanceName,
  resolveChannelForCustomer,
  resolveChannelForCustomerWithFailover,
  resolveConsultantOutboundChannel,
  type ChannelEnv,
} from "./channel-sender.ts";

const SUPER = "super-consultant-id";

const ENV_COM_WAME: ChannelEnv = {
  evolutionUrl: "https://evo.local",
  evolutionKey: "evo-key",
  whapiToken: "whapi-token",
  superadminConsultantId: SUPER,
  wameServer: "https://us.api-wa.me",
  wameApiKey: "wame-key",
};

const ENV_SEM_WAME: ChannelEnv = {
  evolutionUrl: "https://evo.local",
  evolutionKey: "evo-key",
  whapiToken: "whapi-token",
  superadminConsultantId: SUPER,
};

interface FakeData {
  customer?: Record<string, unknown> | null;
  /** Linhas de `whatsapp_instances` indexadas por instance_name. */
  instances?: Record<string, Record<string, unknown>>;
}

/**
 * Fake mínimo do client Supabase: chain fluente que resolve em `maybeSingle`.
 * Só cobre o que o resolver usa (select/eq/like/not/order/limit).
 */
function fakeSupabase(data: FakeData) {
  const instances = data.instances ?? {};
  return {
    from(table: string) {
      const filters: Record<string, string> = {};
      let likePattern = "";
      const builder: Record<string, any> = {
        select: () => builder,
        order: () => builder,
        limit: () => builder,
        not: () => builder,
        eq: (col: string, val: string) => {
          filters[col] = String(val);
          return builder;
        },
        like: (_col: string, pattern: string) => {
          likePattern = pattern;
          return builder;
        },
        maybeSingle: () => {
          if (table === "customers") {
            return Promise.resolve({ data: data.customer ?? null, error: null });
          }
          if (table === "whatsapp_instances") {
            const rows = Object.entries(instances)
              .map(([name, row]) => ({ instance_name: name, ...row }))
              .filter((row) =>
                !filters.consultant_id ||
                String(row.consultant_id ?? "") === filters.consultant_id
              )
              .filter((row) =>
                !filters.instance_name || row.instance_name === filters.instance_name
              )
              .filter((row) =>
                !likePattern ||
                row.instance_name.startsWith(likePattern.replace(/%$/, ""))
              );
            return Promise.resolve({ data: rows[0] ?? null, error: null });
          }
          return Promise.resolve({ data: null, error: null });
        },
      };
      return builder;
    },
  };
}

// ─── Helper de nome ───────────────────────────────────────────────────────

Deno.test("isWameInstanceName reconhece só instâncias do piloto", () => {
  assertEquals(isWameInstanceName("wame-piloto"), true);
  assertEquals(isWameInstanceName("whapi-superadmin"), false);
  assertEquals(isWameInstanceName("evolution-rafael"), false);
  assertEquals(isWameInstanceName(null), false);
});

// ─── Regressão: canais atuais intactos ────────────────────────────────────

Deno.test("regressão: origem Whapi continua resolvendo Whapi", async () => {
  const supabase = fakeSupabase({
    customer: {
      origin_channel: "whapi",
      origin_instance_name: "whapi-superadmin",
      consultant_id: SUPER,
    },
  });
  const ch = await resolveChannelForCustomer(supabase, "c1", ENV_COM_WAME);
  assertEquals(isUnavailable(ch), false);
  if (!isUnavailable(ch)) {
    assertEquals(ch.kind, "whapi");
    assertEquals(ch.instanceName, "whapi-superadmin");
  }
});

Deno.test("regressão: origem Evolution continua resolvendo Evolution", async () => {
  const supabase = fakeSupabase({
    customer: {
      origin_channel: "evolution",
      origin_instance_name: "evo-rafael",
      consultant_id: "outro",
    },
    instances: { "evo-rafael": { status: "connected", consultant_id: "outro" } },
  });
  const ch = await resolveChannelForCustomer(supabase, "c1", ENV_COM_WAME);
  assertEquals(isUnavailable(ch), false);
  if (!isUnavailable(ch)) assertEquals(ch.kind, "evolution");
});

Deno.test("regressão: superadmin sem hint continua caindo no Whapi", async () => {
  const supabase = fakeSupabase({ instances: {} });
  const ch = await resolveConsultantOutboundChannel(supabase, SUPER, ENV_COM_WAME);
  assertEquals(isUnavailable(ch), false);
  if (!isUnavailable(ch)) {
    assertEquals(ch.kind, "whapi");
    assertEquals(ch.instanceName, "whapi-superadmin");
  }
});

// ─── WAME resolve pelo próprio canal ──────────────────────────────────────

Deno.test("origem WAME resolve o adapter WAME", async () => {
  const supabase = fakeSupabase({
    customer: {
      origin_channel: "wame",
      origin_instance_name: "wame-piloto",
      consultant_id: SUPER,
    },
  });
  const ch = await resolveChannelForCustomer(supabase, "c1", ENV_COM_WAME);
  assertEquals(isUnavailable(ch), false);
  if (!isUnavailable(ch)) {
    assertEquals(ch.kind, "wame");
    assertEquals(ch.instanceName, "wame-piloto");
    assertEquals(ch.adapter.capabilities.channel, "wame");
  }
});

Deno.test("instância wame* com origin_channel errado ainda resolve WAME", async () => {
  // Origem gravada torta não pode jogar o lead no chip do superadmin.
  const supabase = fakeSupabase({
    customer: {
      origin_channel: "whapi",
      origin_instance_name: "wame-piloto",
      consultant_id: SUPER,
    },
  });
  const ch = await resolveChannelForCustomer(supabase, "c1", ENV_COM_WAME);
  if (!isUnavailable(ch)) assertEquals(ch.kind, "wame");
});

Deno.test("WAME sem credenciais fica indisponível — nunca cai no Whapi", async () => {
  const supabase = fakeSupabase({
    customer: {
      origin_channel: "wame",
      origin_instance_name: "wame-piloto",
      consultant_id: SUPER,
    },
  });
  const ch = await resolveChannelForCustomer(supabase, "c1", ENV_SEM_WAME);
  assertEquals(isUnavailable(ch), true);
  if (isUnavailable(ch)) {
    assertEquals(ch.kind, "wame");
    assertEquals(ch.reason, "missing_credentials");
  }
});

Deno.test("hint wame* vence o ramo superadmin/Whapi", async () => {
  const supabase = fakeSupabase({ instances: {} });
  const ch = await resolveConsultantOutboundChannel(
    supabase,
    SUPER,
    ENV_COM_WAME,
    "wame-piloto",
  );
  assertEquals(isUnavailable(ch), false);
  if (!isUnavailable(ch)) assertEquals(ch.kind, "wame");
});

// ─── Failover fail-closed ─────────────────────────────────────────────────

Deno.test("failover: lead WAME indisponível NÃO cai em Whapi nem Evolution", async () => {
  const supabase = fakeSupabase({
    customer: {
      origin_channel: "wame",
      origin_instance_name: "wame-piloto",
      consultant_id: SUPER,
    },
    // Whapi e Evolution saudáveis: o failover teria material para trocar.
    instances: {
      "whapi-superadmin": { status: "connected", consultant_id: SUPER },
      "evo-rafael": { status: "connected", consultant_id: SUPER },
    },
  });
  const ch = await resolveChannelForCustomerWithFailover(supabase, "c1", ENV_SEM_WAME);
  assertEquals(isUnavailable(ch), true);
  if (isUnavailable(ch)) assertEquals(ch.kind, "wame");
});

Deno.test("failover: lead Whapi mantém o comportamento atual", async () => {
  const supabase = fakeSupabase({
    customer: {
      origin_channel: "whapi",
      origin_instance_name: "whapi-superadmin",
      consultant_id: SUPER,
    },
    instances: { "whapi-superadmin": { status: "connected", consultant_id: SUPER } },
  });
  const ch = await resolveChannelForCustomerWithFailover(supabase, "c1", ENV_COM_WAME);
  assertEquals(isUnavailable(ch), false);
  if (!isUnavailable(ch)) assertEquals(ch.kind, "whapi");
});
