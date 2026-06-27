/**
 * Teste de INTEGRAÇÃO da função SQL `rodizio_next` real no Postgres
 * (Tarefa 3.3 do spec `rodizio-leads-anuncio`).
 *
 * // Feature: rodizio-leads-anuncio, Property 3
 *
 * **Property 3: Sem repetição na mesma volta sob concorrência**
 * Para toda pool com P participantes e qualquer lote de K chamadas concorrentes
 * de `rodizio_next` (K <= P), os participantes retornados são todos distintos
 * (nenhum participante é atribuído duas vezes dentro da mesma volta).
 *
 * **Validates: Requirements 9.1**
 *
 * ---------------------------------------------------------------------------
 * COMO ESTE TESTE FUNCIONA
 * ---------------------------------------------------------------------------
 * Diferente das Propriedades 1 e 2 (que testam o seletor circular puro em TS,
 * sem banco), a Propriedade 3 só faz sentido contra o Postgres REAL: a garantia
 * de "sem repetição sob concorrência" vem da atomicidade do
 * `UPDATE ... RETURNING` no `counter` da pool. Por isso este é um teste de
 * integração: ele dispara K chamadas CONCORRENTES (cada uma é uma requisição
 * HTTP independente via PostgREST, logo transações paralelas de verdade) e
 * verifica que todos os `partner_id` retornados são distintos.
 *
 * ---------------------------------------------------------------------------
 * EXECUÇÃO CONDICIONAL (skip quando não há banco)
 * ---------------------------------------------------------------------------
 * O projeto NÃO tem infraestrutura de teste de integração com banco: todos os
 * outros testes mockam o Supabase e rodam em jsdom. Não há credenciais de banco
 * no ambiente de CI/teste automatizado. Para não quebrar a suíte (e para nunca
 * fingir que passou sem rodar), este teste SÓ executa quando as variáveis de
 * ambiente de conexão estão presentes; caso contrário ele é PULADO (skip) com
 * uma mensagem explicando o motivo.
 *
 * Para rodar de verdade, exporte (use a SERVICE ROLE — o teste cria/limpa dados):
 *   SUPABASE_URL=https://<project-ref>.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
 *   npx vitest run src/lib/rodizio/rodizio-next.integration.test.ts
 *
 * O teste cria apenas dados de TESTE marcados com o prefixo `ZZZ_TEST_RODIZIO_P3`
 * e os REMOVE ao final (inclusive em caso de falha), sem deixar dados de
 * produção permanentes.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Configuração de conexão (somente via env; nunca hardcode credenciais)
// ---------------------------------------------------------------------------
const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "";
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  process.env.SUPABASE_SERVICE_ROLE ??
  process.env.SERVICE_ROLE_KEY ??
  "";

const HAS_DB = SUPABASE_URL.length > 0 && SERVICE_ROLE_KEY.length > 0;

// Marcador para identificar e limpar exclusivamente os dados deste teste.
const MARKER = "ZZZ_TEST_RODIZIO_P3";

// Tamanhos de pool a exercitar. K = P (uma volta completa concorrente).
// Poucas execuções, como manda o design (teste de integração é caro).
const POOL_SIZES = [2, 3, 4, 5, 8];

interface SeededPool {
  campaignId: string;
  poolId: string;
  partnerIds: string[];
}

describe.skipIf(!HAS_DB)("Property 3 — sem repetição sob concorrência (rodizio_next real)", () => {
  let admin: SupabaseClient;
  let consultantId: string;
  const seeded: SeededPool[] = [];

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Precisamos de um consultor dono válido (FK de referral_partners e da pool).
    const { data, error } = await admin
      .from("consultants")
      .select("id")
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("Sem consultor para o teste de integração.");
    consultantId = data.id as string;
  });

  // Limpeza garantida ao final (cascade remove pool e members via FK;
  // os participantes são removidos explicitamente).
  afterAll(async () => {
    if (!HAS_DB) return;
    const campaignIds = seeded.map((s) => s.campaignId);
    const partnerIds = seeded.flatMap((s) => s.partnerIds);
    if (campaignIds.length > 0) {
      await admin.from("facebook_campaigns").delete().in("id", campaignIds);
    }
    if (partnerIds.length > 0) {
      await admin.from("referral_partners").delete().in("id", partnerIds);
    }
    // Rede de segurança: apaga qualquer resíduo marcado deste teste.
    await admin.from("referral_partners").delete().like("nome", `${MARKER}%`);
    await admin.from("facebook_campaigns").delete().like("name", `${MARKER}%`);
  });

  /** Cria campanha + P participantes + pool ativa ligada à campanha + membros ordenados. */
  async function seedPool(p: number): Promise<SeededPool> {
    // 1) Campanha
    const { data: campaign, error: campErr } = await admin
      .from("facebook_campaigns")
      .insert({
        consultant_id: consultantId,
        name: `${MARKER}_${p}_${Date.now()}`,
        daily_budget_cents: 1000,
        status: "draft",
      })
      .select("id")
      .single();
    if (campErr) throw campErr;
    const campaignId = campaign.id as string;

    // 2) Participantes (referral_partners) — cli '0' (NOT NULL via design).
    const partnersPayload = Array.from({ length: p }, (_, i) => ({
      consultant_id: consultantId,
      nome: `${MARKER}_${p}_${i}_${Date.now()}`,
      cli: "0",
    }));
    const { data: partners, error: partErr } = await admin
      .from("referral_partners")
      .insert(partnersPayload)
      .select("id");
    if (partErr) throw partErr;
    const partnerIds = (partners ?? []).map((r) => r.id as string);

    // 3) Pool ativa ligada à campanha, contador zerado.
    const { data: pool, error: poolErr } = await admin
      .from("rodizio_pools")
      .insert({
        campaign_id: campaignId,
        label: `${MARKER}_${p}`,
        is_active: true,
        consultant_id: consultantId,
        counter: 0,
      })
      .select("id")
      .single();
    if (poolErr) throw poolErr;
    const poolId = pool.id as string;

    // 4) Membros ordenados (position 0..P-1).
    const membersPayload = partnerIds.map((partnerId, i) => ({
      pool_id: poolId,
      partner_id: partnerId,
      position: i,
      lead_count: 0,
    }));
    const { error: memErr } = await admin.from("rodizio_pool_members").insert(membersPayload);
    if (memErr) throw memErr;

    const result: SeededPool = { campaignId, poolId, partnerIds };
    seeded.push(result);
    return result;
  }

  for (const p of POOL_SIZES) {
    it(`K=${p} chamadas concorrentes retornam ${p} participantes distintos (uma volta)`, async () => {
      const pool = await seedPool(p);

      // Dispara K = P chamadas CONCORRENTES à rodizio_next real.
      // Cada rpc é uma requisição HTTP independente -> transações paralelas.
      const calls = Array.from({ length: p }, () =>
        admin.rpc("rodizio_next", { p_campaign_id: pool.campaignId }),
      );
      const results = await Promise.all(calls);

      // Nenhuma chamada deve falhar.
      for (const r of results) {
        expect(r.error).toBeNull();
      }

      // rodizio_next retorna uma tabela (array de 1 linha) por chamada.
      const rows = results.map((r) => {
        const data = r.data as Array<{ partner_id: string; position: number }> | null;
        expect(Array.isArray(data)).toBe(true);
        expect(data?.length).toBe(1);
        return data![0];
      });

      const returnedPartners = rows.map((row) => row.partner_id);
      const returnedPositions = rows.map((row) => row.position);

      // Property 3: participantes retornados na mesma volta são TODOS distintos.
      expect(new Set(returnedPartners).size).toBe(p);
      // E as posições também (consequência direta da ordem circular atômica).
      expect(new Set(returnedPositions).size).toBe(p);

      // Todos os participantes retornados pertencem à pool semeada.
      const seededSet = new Set(pool.partnerIds);
      for (const partnerId of returnedPartners) {
        expect(seededSet.has(partnerId)).toBe(true);
      }
    });
  }
});

// Quando não há banco configurado, registramos um teste pulado explícito para
// deixar claro na saída do Vitest que a Propriedade 3 NÃO foi validada aqui
// (e por quê), em vez de a suíte simplesmente não conter nada.
describe.runIf(!HAS_DB)("Property 3 — sem repetição sob concorrência (rodizio_next real)", () => {
  it.skip(
    "PULADO: defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY para rodar contra o Postgres real",
    () => {
      // Sem credenciais de banco no ambiente de teste automatizado.
    },
  );
});
