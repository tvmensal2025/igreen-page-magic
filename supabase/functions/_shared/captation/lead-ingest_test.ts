// Testes do lead-ingest: dedup_key, normalização e gravação idempotente.
//
// Usa um fake mínimo do SupabaseClient que registra o upsert e simula
// conflito de unique constraint (deduplicação) quando a dedup_key já existe.

import {
  assertEquals,
  assert,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { ingestLead } from "./lead-ingest.ts";

// ─── Fake Supabase client ────────────────────────────────────────────────
// Só implementa o encadeamento usado por ingestLead:
//   from(table).upsert(row,opts).select(cols).maybeSingle()
//   from(table).insert(row)   (para lead_consent_log)
function makeFakeSupabase(opts: { existingDedupKeys?: Set<string> } = {}) {
  const existing = opts.existingDedupKeys ?? new Set<string>();
  const captured: Record<string, unknown>[] = [];
  const consentRows: Record<string, unknown>[] = [];
  let idSeq = 0;

  const client = {
    from(table: string) {
      if (table === "captured_leads") {
        let pendingRow: Record<string, unknown> | null = null;
        const chain = {
          upsert(row: Record<string, unknown>, _opts: unknown) {
            pendingRow = row;
            return chain;
          },
          select(_cols: string) {
            return chain;
          },
          async maybeSingle() {
            const row = pendingRow!;
            const dk = row.dedup_key as string | null;
            if (dk && existing.has(dk)) {
              // ignoreDuplicates → linha nula (deduplicado)
              return { data: null, error: null };
            }
            if (dk) existing.add(dk);
            captured.push(row);
            const id = `lead-${++idSeq}`;
            return { data: { id }, error: null };
          },
        };
        return chain;
      }
      if (table === "lead_consent_log") {
        return {
          async insert(row: Record<string, unknown>) {
            consentRows.push(row);
            return { error: null };
          },
        };
      }
      throw new Error(`tabela inesperada: ${table}`);
    },
  };

  return { client: client as never, captured, consentRows };
}

const CONSULTANT = "00000000-0000-0000-0000-000000000001";

Deno.test("ingestLead rejeita sem consultant_id", async () => {
  const { client } = makeFakeSupabase();
  const r = await ingestLead(client, {
    consultantId: "",
    channel: "manual",
    phone: "11999998888",
  });
  assertEquals(r.ok, false);
  assertEquals(r.reason, "missing_consultant_id");
});

Deno.test("ingestLead rejeita sem nenhum contato (phone/email/cnpj)", async () => {
  const { client } = makeFakeSupabase();
  const r = await ingestLead(client, {
    consultantId: CONSULTANT,
    channel: "manual",
    fullName: "Fulano",
  });
  assertEquals(r.ok, false);
  assertEquals(r.reason, "missing_contact");
});

Deno.test("ingestLead normaliza telefone para 55+DDD+numero", async () => {
  const { client, captured } = makeFakeSupabase();
  const r = await ingestLead(client, {
    consultantId: CONSULTANT,
    channel: "landing",
    phone: "(11) 99999-8888",
  });
  assert(r.ok);
  assertEquals(r.deduped, false);
  assertEquals(captured[0].phone, "5511999998888");
});

Deno.test("ingestLead grava PJ com cnpj só dígitos", async () => {
  const { client, captured } = makeFakeSupabase();
  const r = await ingestLead(client, {
    consultantId: CONSULTANT,
    channel: "research",
    personType: "pj",
    companyName: "Padaria do Zé LTDA",
    cnpj: "12.345.678/0001-90",
    phone: "1133334444",
  });
  assert(r.ok);
  assertEquals(captured[0].person_type, "pj");
  assertEquals(captured[0].cnpj, "12345678000190");
  assertEquals(captured[0].company_name, "Padaria do Zé LTDA");
});

Deno.test("ingestLead deduplica o mesmo lead do mesmo consultor", async () => {
  const { client, captured } = makeFakeSupabase();
  const first = await ingestLead(client, {
    consultantId: CONSULTANT,
    channel: "meta_leadads",
    phone: "11999998888",
  });
  assert(first.ok);
  assertEquals(first.deduped, false);

  const second = await ingestLead(client, {
    consultantId: CONSULTANT,
    channel: "meta_leadads",
    phone: "11 99999-8888", // mesmo número, formato diferente
  });
  assert(second.ok);
  assertEquals(second.deduped, true);
  // Só gravou uma vez.
  assertEquals(captured.length, 1);
});

Deno.test("ingestLead PF e PJ com mesmo telefone NÃO colidem", async () => {
  const { client, captured } = makeFakeSupabase();
  await ingestLead(client, {
    consultantId: CONSULTANT,
    channel: "landing",
    personType: "pf",
    phone: "11999998888",
  });
  await ingestLead(client, {
    consultantId: CONSULTANT,
    channel: "landing",
    personType: "pj",
    phone: "11999998888",
  });
  assertEquals(captured.length, 2);
});

Deno.test("ingestLead grava consentimento quando consentText presente", async () => {
  const { client, consentRows } = makeFakeSupabase();
  const r = await ingestLead(client, {
    consultantId: CONSULTANT,
    channel: "landing",
    phone: "11999998888",
    consentText: "Aceito receber contato da iGreen sobre energia.",
    consentSource: "https://lp.exemplo/energia",
  });
  assert(r.ok);
  assertEquals(consentRows.length, 1);
  assertEquals(consentRows[0].channel, "landing");
  assert(String(consentRows[0].consent_text).includes("Aceito receber"));
});

Deno.test("ingestLead NÃO grava consentimento quando ausente", async () => {
  const { client, consentRows, captured } = makeFakeSupabase();
  const r = await ingestLead(client, {
    consultantId: CONSULTANT,
    channel: "research",
    personType: "pj",
    cnpj: "12345678000190",
  });
  assert(r.ok);
  assertEquals(consentRows.length, 0);
  assertEquals(captured[0].consent_at, null);
});
