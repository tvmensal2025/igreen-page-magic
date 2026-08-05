/**
 * Etapa 2 — perda de mensagens em rajada (auditoria 2026-08).
 *
 * `enqueue_pending_inbound` sobrescreve o marcador: com 3 mensagens presas no
 * lock, a versão antiga reprocessava só uma (e, quando o id não batia, o
 * inbound mais recente — mensagem errada). Os casos abaixo cobrem o drain em
 * lote sobre a janela do turno.
 */
import { describe, it, expect, vi } from "vitest";
import {
  claimPendingInboundBatch,
  drainPendingInboundTurns,
} from "../../supabase/functions/_shared/bot/pending-inbound.ts";

type Row = {
  id: string;
  message_text: string;
  message_type?: string;
  external_message_id?: string | null;
  created_at: string;
};

function fakeSupabase(opts: {
  pendingId: string | null;
  pendingAt?: string | null;
  inbound: Row[];
}) {
  const cleared: string[] = [];
  let gteValue: string | null = null;

  const conversationsQuery = () => {
    const q: any = {
      select: () => q,
      eq: () => q,
      gte: (_col: string, v: string) => {
        gteValue = v;
        return q;
      },
      order: () => q,
      limit: () => ({
        data: opts.inbound
          .filter((r) => !gteValue || r.created_at >= gteValue!)
          .sort((a, b) => a.created_at.localeCompare(b.created_at)),
      }),
    };
    return q;
  };

  const customersQuery = () => {
    const q: any = {
      select: () => q,
      eq: () => q,
      maybeSingle: async () => ({
        data: {
          pending_inbound_message_id: opts.pendingId,
          pending_inbound_at: opts.pendingAt ?? null,
        },
      }),
    };
    return q;
  };

  return {
    cleared,
    from: (table: string) => (table === "customers" ? customersQuery() : conversationsQuery()),
    rpc: vi.fn(async (name: string, args: any) => {
      if (name === "clear_pending_inbound") {
        cleared.push(args._customer_id);
        opts.pendingId = null;
      }
      return { data: null };
    }),
  };
}

const CUSTOMER = "cus-1";
const TURN_START = "2026-08-05T10:00:00.000Z";

const BURST: Row[] = [
  { id: "c0", message_text: "oi", external_message_id: "m0", created_at: "2026-08-05T09:59:59.000Z" },
  { id: "c1", message_text: "quero saber", external_message_id: "m1", created_at: "2026-08-05T10:00:01.000Z" },
  { id: "c2", message_text: "sobre a conta de luz", external_message_id: "m2", created_at: "2026-08-05T10:00:02.000Z" },
  { id: "c3", message_text: "tem desconto?", external_message_id: "m3", created_at: "2026-08-05T10:00:03.000Z" },
];

describe("claimPendingInboundBatch", () => {
  it("devolve a rajada inteira em ordem cronológica", async () => {
    const sb = fakeSupabase({ pendingId: "m3", inbound: BURST });
    const batch = await claimPendingInboundBatch(sb as any, CUSTOMER, {
      since: TURN_START,
      excludeMessageIds: ["m0"],
      excludeConversationIds: ["c0"],
    });
    expect(batch.map((b) => b.messageText)).toEqual([
      "quero saber",
      "sobre a conta de luz",
      "tem desconto?",
    ]);
  });

  it("nunca reprocessa a mensagem do próprio turno", async () => {
    const sb = fakeSupabase({ pendingId: "m3", inbound: BURST });
    const batch = await claimPendingInboundBatch(sb as any, CUSTOMER, {
      since: "2026-08-05T09:00:00.000Z",
      excludeMessageIds: ["m0"],
      excludeConversationIds: ["c0"],
    });
    expect(batch.find((b) => b.messageId === "m0")).toBeUndefined();
  });

  it("sem marcador não lê conversas nem limpa nada", async () => {
    const sb = fakeSupabase({ pendingId: null, inbound: BURST });
    const batch = await claimPendingInboundBatch(sb as any, CUSTOMER, { since: TURN_START });
    expect(batch).toEqual([]);
    expect(sb.rpc).not.toHaveBeenCalled();
  });

  it("marcador sem inbound novo não reproduz mensagem antiga", async () => {
    const sb = fakeSupabase({ pendingId: "m9", inbound: [BURST[0]] });
    const batch = await claimPendingInboundBatch(sb as any, CUSTOMER, {
      since: TURN_START,
      excludeMessageIds: ["m0"],
      excludeConversationIds: ["c0"],
    });
    expect(batch).toEqual([]);
    expect(sb.cleared).toEqual([CUSTOMER]);
  });

  it("respeita o teto de mensagens por rodada", async () => {
    const sb = fakeSupabase({ pendingId: "m3", inbound: BURST });
    const batch = await claimPendingInboundBatch(sb as any, CUSTOMER, {
      since: TURN_START,
      excludeConversationIds: ["c0"],
      max: 2,
    });
    expect(batch).toHaveLength(2);
  });
});

describe("drainPendingInboundTurns", () => {
  it("processa cada mensagem da rajada uma única vez", async () => {
    const sb = fakeSupabase({ pendingId: "m3", inbound: BURST });
    const processed: string[] = [];
    const drained = await drainPendingInboundTurns(
      sb as any,
      CUSTOMER,
      async (replay) => {
        processed.push(replay.messageText);
      },
      3,
      {
        since: TURN_START,
        excludeMessageIds: ["m0"],
        excludeConversationIds: ["c0"],
      },
    );
    expect(drained).toBe(3);
    expect(processed).toEqual(["quero saber", "sobre a conta de luz", "tem desconto?"]);
  });

  it("não drena nada quando não há pendência", async () => {
    const sb = fakeSupabase({ pendingId: null, inbound: BURST });
    const processTurn = vi.fn();
    const drained = await drainPendingInboundTurns(sb as any, CUSTOMER, processTurn, 3, {
      since: TURN_START,
    });
    expect(drained).toBe(0);
    expect(processTurn).not.toHaveBeenCalled();
  });
});
