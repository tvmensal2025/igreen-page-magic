// Adapter idempotency: segundo sendText com mesma chave não chama fetch.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createWhapiAdapter } from "./whapi.ts";

interface OutboundRow {
  idempotency_key: string;
  customer_id: string;
  consultant_id: string;
  payload_hash: string;
  result_status: string | null;
}

function makeFakeSupabase() {
  const rows = new Map<string, OutboundRow>();
  function tryInsert(row: Omit<OutboundRow, "result_status">) {
    if (rows.has(row.idempotency_key)) return [];
    rows.set(row.idempotency_key, { ...row, result_status: null });
    return [{ result_status: null }];
  }
  return {
    from(_table: string) {
      return {
        upsert(row: Omit<OutboundRow, "result_status">) {
          return {
            select(_cols: string) {
              return Promise.resolve({ data: tryInsert(row), error: null });
            },
          };
        },
        update(patch: Partial<OutboundRow>) {
          return {
            eq(_col: string, val: string) {
              const existing = rows.get(val);
              if (existing) rows.set(val, { ...existing, ...patch });
              return Promise.resolve({ data: null, error: null });
            },
          };
        },
      };
    },
  };
}

Deno.test("whapi adapter sendText: segunda chamada com mesma idempotencyKey não chama fetch", async () => {
  let fetchCount = 0;
  const origFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = String(init?.body ?? "");
    fetchCount++;
    if (url.includes("/contacts")) {
      let phones: string[] = [];
      try {
        const parsed = JSON.parse(body);
        phones = Array.isArray(parsed?.contacts) ? parsed.contacts.map(String) : [];
      } catch { /* ignore */ }
      const rows = (phones.length ? phones : ["5511999999999"]).map((p) => {
        const digits = String(p).replace(/\D/g, "");
        return { input: digits, status: "valid", wa_id: `${digits}@s.whatsapp.net` };
      });
      return new Response(JSON.stringify({ contacts: rows }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ message: { id: `wamid.${fetchCount}` } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  const fakeSupabase = makeFakeSupabase();
  const adapter = createWhapiAdapter({ apiToken: "fake" });
  const ctx = {
    customerId: "cust-1",
    consultantId: "cons-1",
    stepId: "faq_nudge",
    idempotencyKey: "nudge:cust-1:bucket-1",
    supabase: fakeSupabase as any,
  };

  try {
    const r1 = await adapter.sendText("5511999999999@s.whatsapp.net", "Oi", ctx);
    const r2 = await adapter.sendText("5511999999999@s.whatsapp.net", "Oi", ctx);
    assertEquals(r1.ok, true);
    assertEquals(r2.ok, true);
    // 1º envio: /contacts + /messages/text; 2º: só replay (sem fetch)
    assertEquals(fetchCount, 2);
  } finally {
    globalThis.fetch = origFetch;
  }
});
