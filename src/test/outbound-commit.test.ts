/**
 * Etapa 1 da correção do Fluxo A (auditoria 2026-08):
 *  - mensagem falsa no histórico (sender retornou false / lançou erro);
 *  - avanço de etapa antes da confirmação do envio.
 *
 * Os casos abaixo reproduzem o defeito original: com a ordem antiga
 * (persistir → enviar → gravar histórico sempre) todos falhariam.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  isSendConfirmed,
  stripProgressUpdatesOnFailedSend,
  commitOutboundTurn,
  shouldRevertStepAfterFailedSend,
} from "../../supabase/functions/_shared/bot/outbound-commit.ts";

function makeHarness(sendImpl: (text: string) => Promise<unknown>) {
  const persisted: Record<string, unknown>[] = [];
  const history: string[] = [];
  const order: string[] = [];
  return {
    persisted,
    history,
    order,
    send: vi.fn(async (text: string) => {
      order.push("send");
      return await sendImpl(text);
    }),
    persistUpdates: vi.fn(async (u: Record<string, unknown>) => {
      order.push("persist");
      persisted.push(u);
    }),
    recordHistory: vi.fn(async (t: string) => {
      order.push("history");
      history.push(t);
    }),
  };
}

const UPDATES = {
  conversation_step: "aguardando_conta",
  last_bot_reply_at: "2026-08-05T00:00:00.000Z",
  last_bot_interaction_at: "2026-08-05T00:00:00.000Z",
  followup_count: 0,
  full_name: "Maria",
};

describe("isSendConfirmed", () => {
  it("trata negação explícita do canal como falha", () => {
    expect(isSendConfirmed(false)).toBe(false);
    expect(isSendConfirmed({ ok: false })).toBe(false);
    expect(isSendConfirmed({ sent: false })).toBe(false);
    expect(isSendConfirmed({ success: false })).toBe(false);
    expect(isSendConfirmed({ error: "invalid_whatsapp" })).toBe(false);
  });

  it("não quebra senders legados com retorno atípico", () => {
    expect(isSendConfirmed(true)).toBe(true);
    expect(isSendConfirmed(undefined)).toBe(true);
    expect(isSendConfirmed({ id: "msg_1" })).toBe(true);
  });
});

describe("stripProgressUpdatesOnFailedSend", () => {
  it("remove só os campos de progresso e preserva dados do lead", () => {
    const out = stripProgressUpdatesOnFailedSend(UPDATES);
    expect(out).toEqual({ full_name: "Maria" });
    expect(UPDATES.conversation_step).toBe("aguardando_conta");
  });
});

describe("commitOutboundTurn — envio confirmado", () => {
  it("envia antes de persistir e grava histórico uma única vez", async () => {
    const h = makeHarness(async () => true);
    const res = await commitOutboundTurn({
      updates: { ...UPDATES },
      reply: "Qual o valor da sua conta?",
      send: h.send,
      persistUpdates: h.persistUpdates,
      recordHistory: h.recordHistory,
    });

    expect(h.order).toEqual(["send", "persist", "history"]);
    expect(res).toMatchObject({ sendAttempted: true, sendConfirmed: true, historyRecorded: true });
    expect(h.persisted[0]).toMatchObject({ conversation_step: "aguardando_conta" });
    expect(h.history).toEqual(["Qual o valor da sua conta?"]);
  });
});

describe("commitOutboundTurn — sender retornou false (guard de pausa/humano)", () => {
  it("não grava a mensagem no histórico", async () => {
    const h = makeHarness(async () => false);
    await commitOutboundTurn({
      updates: { ...UPDATES },
      reply: "Qual o valor da sua conta?",
      send: h.send,
      persistUpdates: h.persistUpdates,
      recordHistory: h.recordHistory,
    });
    expect(h.recordHistory).not.toHaveBeenCalled();
    expect(h.history).toEqual([]);
  });

  it("não avança conversation_step nem marca last_bot_reply_at", async () => {
    const h = makeHarness(async () => false);
    const res = await commitOutboundTurn({
      updates: { ...UPDATES },
      reply: "Qual o valor da sua conta?",
      send: h.send,
      persistUpdates: h.persistUpdates,
      recordHistory: h.recordHistory,
    });
    expect(res.progressStripped).toBe(true);
    expect(h.persisted[0]).toEqual({ full_name: "Maria" });
    expect(h.persisted[0]).not.toHaveProperty("conversation_step");
    expect(h.persisted[0]).not.toHaveProperty("last_bot_reply_at");
  });
});

describe("commitOutboundTurn — sender lançou exceção", () => {
  it("reporta a falha e não grava histórico nem avança etapa", async () => {
    const onSendFailure = vi.fn();
    const h = makeHarness(async () => {
      throw new Error("whapi 500");
    });
    const res = await commitOutboundTurn({
      updates: { ...UPDATES },
      reply: "oi",
      send: h.send,
      persistUpdates: h.persistUpdates,
      recordHistory: h.recordHistory,
      onSendFailure,
    });
    expect(res.sendConfirmed).toBe(false);
    expect(onSendFailure).toHaveBeenCalledTimes(1);
    expect(h.history).toEqual([]);
    expect(h.persisted[0]).toEqual({ full_name: "Maria" });
  });
});

describe("commitOutboundTurn — comportamentos preservados", () => {
  it("turno sem texto (handler enviou inline) persiste normalmente", async () => {
    const h = makeHarness(async () => true);
    const res = await commitOutboundTurn({
      updates: { ...UPDATES },
      reply: "",
      send: h.send,
      persistUpdates: h.persistUpdates,
      recordHistory: h.recordHistory,
    });
    expect(h.send).not.toHaveBeenCalled();
    expect(res.sendAttempted).toBe(false);
    expect(h.persisted[0]).toMatchObject({ conversation_step: "aguardando_conta" });
    expect(h.history).toEqual([]);
  });

  it("reply duplicado não reenvia mas mantém o estado do turno", async () => {
    const h = makeHarness(async () => true);
    await commitOutboundTurn({
      updates: { ...UPDATES },
      reply: "mesma mensagem",
      isDuplicate: true,
      send: h.send,
      persistUpdates: h.persistUpdates,
      recordHistory: h.recordHistory,
    });
    expect(h.send).not.toHaveBeenCalled();
    expect(h.persisted[0]).toMatchObject({ conversation_step: "aguardando_conta" });
    expect(h.history).toEqual([]);
  });

  it("turno sem updates não chama persistUpdates", async () => {
    const h = makeHarness(async () => true);
    await commitOutboundTurn({
      updates: {},
      reply: "só texto",
      send: h.send,
      persistUpdates: h.persistUpdates,
      recordHistory: h.recordHistory,
    });
    expect(h.persistUpdates).not.toHaveBeenCalled();
    expect(h.history).toEqual(["só texto"]);
  });
});

describe("shouldRevertStepAfterFailedSend — compensação do Evolution", () => {
  const base = {
    deliveryStatus: "failed" as const,
    stepBefore: "menu_inicial",
    stepAfter: "aguardando_conta",
    drainedTurns: 0,
    sendError: "connection_closed",
  };

  it("desfaz o avanço quando o canal recusou a pergunta do novo passo", () => {
    expect(shouldRevertStepAfterFailedSend(base)).toBe(true);
  });

  it("não desfaz quando a mensagem saiu (sent) ou ficou na fila (queued)", () => {
    expect(shouldRevertStepAfterFailedSend({ ...base, deliveryStatus: "sent" })).toBe(false);
    expect(shouldRevertStepAfterFailedSend({ ...base, deliveryStatus: "queued" })).toBe(false);
    expect(shouldRevertStepAfterFailedSend({ ...base, deliveryStatus: null })).toBe(false);
  });

  it("não desfaz se a rajada foi drenada — o estado já é de outro turno", () => {
    expect(shouldRevertStepAfterFailedSend({ ...base, drainedTurns: 1 })).toBe(false);
  });

  it("não desfaz quando o silêncio é intencional (humano assumiu / DNC)", () => {
    expect(shouldRevertStepAfterFailedSend({ ...base, sendError: "paused_by_human" })).toBe(false);
    expect(shouldRevertStepAfterFailedSend({ ...base, sendError: "dnc" })).toBe(false);
  });

  it("não desfaz quando o turno não mudou de etapa", () => {
    expect(shouldRevertStepAfterFailedSend({ ...base, stepAfter: "menu_inicial" })).toBe(false);
    expect(shouldRevertStepAfterFailedSend({ ...base, stepAfter: null })).toBe(false);
    expect(shouldRevertStepAfterFailedSend({ ...base, stepAfter: "  " })).toBe(false);
  });
});

const FN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../supabase/functions");

describe("guarda estática — caminho Whapi/Grupo A", () => {
  it("whapi-webhook usa commitOutboundTurn no fecho do turno", () => {
    const src = readFileSync(path.join(FN, "whapi-webhook/index.ts"), "utf8");
    expect(src).toContain("commitOutboundTurn");
    // A gravação do outbound não pode voltar a ficar solta logo após o envio.
    expect(src).not.toMatch(
      /await sender\.sendText\(remoteJid, finalReply\)[\s\S]{0,200}?from\("conversations"\)\.insert/,
    );
  });

  it("dispatchStep do bot-flow não grava histórico com envio recusado", () => {
    const src = readFileSync(path.join(FN, "whapi-webhook/handlers/bot-flow.ts"), "utf8");
    expect(src).toContain("okSend = await sendText(remoteJid, it.text)");
    expect(src).toMatch(/if \(okSend === false\)[\s\S]{0,240}continue;/);
  });
});

describe("guarda estática — caminho Evolution/Grupo A", () => {
  const src = readFileSync(path.join(FN, "evolution-webhook/index.ts"), "utf8");

  it("aplica a compensação de etapa com o resultado real do envio", () => {
    expect(src).toContain("shouldRevertStepAfterFailedSend");
    expect(src).toContain("sendError: sendResult.error ?? null");
    expect(src).toContain("conversation_step: primaryRawStepBefore");
  });

  it("alimenta a decisão com o número real de turnos drenados", () => {
    expect(src).toMatch(/drainedTurns = drained;/);
    expect(src).toContain("drainedTurns,");
  });
});
