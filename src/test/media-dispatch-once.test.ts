/**
 * Áudio/vídeo queimado sem ter saído (auditoria 2026-08).
 *
 * `canSendMediaOnce` confirmava o slot como enviado ANTES do envio. Como a
 * regra é "nunca repetir áudio/vídeo para o mesmo lead", um envio recusado
 * depois queimava a mídia para sempre. `dispatchMediaOnce` só confirma com o
 * canal tendo aceitado.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { dispatchMediaOnce } from "../../supabase/functions/_shared/media-dedupe.ts";

const SLOT = {
  consultantId: "cons-1",
  customerId: "lead-1",
  mediaId: "media-1",
  slotKey: "a3_audio",
  kind: "audio",
};

function fakeSupabase(opts: { dispatchStatus?: string | null } = {}) {
  const confirms: Array<{ reservation: string; ok: boolean }> = [];
  const query: any = {
    select: () => query,
    eq: () => query,
    maybeSingle: async () => ({
      data: opts.dispatchStatus ? { dispatch_status: opts.dispatchStatus } : null,
    }),
  };
  return {
    confirms,
    from: () => query,
    rpc: vi.fn(async (name: string, args: any) => {
      if (name === "reserve_media_send") return { data: "res-1" };
      if (name === "confirm_media_send") {
        confirms.push({ reservation: args.p_res_id, ok: args.p_ok });
      }
      return { data: null };
    }),
  };
}

describe("dispatchMediaOnce", () => {
  it("confirma o slot quando o canal aceita o áudio", async () => {
    const sb = fakeSupabase();
    const out = await dispatchMediaOnce(sb as any, SLOT, async () => true);
    expect(out).toMatchObject({ skipped: false, sent: true });
    expect(sb.confirms).toEqual([{ reservation: "res-1", ok: true }]);
  });

  it("libera o slot quando o canal recusa — o lead ainda pode receber depois", async () => {
    const sb = fakeSupabase();
    const out = await dispatchMediaOnce(sb as any, SLOT, async () => false);
    expect(out.sent).toBe(false);
    expect(sb.confirms).toEqual([{ reservation: "res-1", ok: false }]);
  });

  it("libera o slot quando o guard de pausa devolve ok=false", async () => {
    const sb = fakeSupabase();
    const out = await dispatchMediaOnce(
      sb as any,
      SLOT,
      async () => ({ ok: false, status: 0, detail: "paused_by_human" }),
    );
    expect(out.sent).toBe(false);
    expect(sb.confirms).toEqual([{ reservation: "res-1", ok: false }]);
  });

  it("libera o slot quando o envio lança exceção", async () => {
    const sb = fakeSupabase();
    const out = await dispatchMediaOnce(sb as any, SLOT, async () => {
      throw new Error("minio 503");
    });
    expect(out.sent).toBe(false);
    expect((out.error as Error).message).toBe("minio 503");
    expect(sb.confirms).toEqual([{ reservation: "res-1", ok: false }]);
  });

  it("não reenvia mídia que já saiu para o lead", async () => {
    const sb = fakeSupabase({ dispatchStatus: "sent" });
    const send = vi.fn();
    const out = await dispatchMediaOnce(sb as any, SLOT, send as any);
    expect(out.skipped).toBe(true);
    expect(send).not.toHaveBeenCalled();
    expect(sb.rpc).not.toHaveBeenCalled();
  });

  it("imagem/documento não entram na regra de não repetir", async () => {
    const sb = fakeSupabase({ dispatchStatus: "sent" });
    const out = await dispatchMediaOnce(sb as any, { ...SLOT, kind: "image" }, async () => true);
    expect(out).toMatchObject({ skipped: false, sent: true });
    // Sem reserva: `reserve_media_send` só vale para áudio/vídeo.
    expect(sb.confirms).toEqual([]);
  });
});

const FN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../supabase/functions");

describe.each(["whapi-webhook", "evolution-webhook"])(
  "guarda estática — envio de mídia do Grupo A (%s)",
  (channel) => {
    const src = readFileSync(path.join(FN, channel, "handlers/bot-flow.ts"), "utf8");

    it("todo envio de mídia passa pelo fluxo de duas fases", () => {
      expect(src).toContain("dispatchMediaOnce");
      expect(src).not.toContain("canSendMediaOnce");
    });

    it("a mídia da FAQ não entra no histórico sem envio confirmado", () => {
      expect(src).toMatch(/if \(disp\.skipped \|\| !disp\.sent\) continue;/);
      expect(src).not.toMatch(
        /await sendMedia\(remoteJid, url, "", kind, durationSec \|\| undefined\);\s*sentSomething = true;/,
      );
    });
  },
);
