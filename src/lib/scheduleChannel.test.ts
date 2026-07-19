import { describe, expect, it } from "vitest";
import { resolveScheduleChannel } from "./scheduleChannel";

describe("resolveScheduleChannel", () => {
  it("Whapi conectado usa whapi-superadmin", () => {
    const r = resolveScheduleChannel({ isWhapi: true, instanceName: null, isConnected: true });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.channel).toBe("whapi");
      expect(r.instanceName).toBe("whapi-superadmin");
    }
  });

  it("Whapi desconectado bloqueia", () => {
    const r = resolveScheduleChannel({ isWhapi: true, isConnected: false });
    expect(r.ok).toBe(false);
  });

  it("Evolution usa instanceName", () => {
    const r = resolveScheduleChannel({
      isWhapi: false,
      instanceName: "igreen-abc",
      isConnected: true,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.channel).toBe("evolution");
      expect(r.instanceName).toBe("igreen-abc");
    }
  });

  it("Evolution desconectado bloqueia mesmo com instanceName", () => {
    const r = resolveScheduleChannel({
      isWhapi: false,
      instanceName: "igreen-abc",
      isConnected: false,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.pending).toBe("whatsapp_disconnected");
  });

  it("sem canal → pendência", () => {
    const r = resolveScheduleChannel({ isWhapi: false, instanceName: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.pending).toBe("whatsapp_disconnected");
  });
});
