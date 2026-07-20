import { describe, expect, it } from "vitest";
import {
  resolveScheduleChannel,
  scheduleChannelBlockedReason,
} from "./scheduleChannel";

describe("resolveScheduleChannel", () => {
  it("Whapi conectado usa whapi-superadmin", () => {
    const r = resolveScheduleChannel({ isWhapi: true, instanceName: null, isConnected: true });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.channel).toBe("whapi");
      expect(r.instanceName).toBe("whapi-superadmin");
    }
    expect(scheduleChannelBlockedReason(r)).toBeNull();
  });

  it("Whapi desconectado bloqueia", () => {
    const r = resolveScheduleChannel({ isWhapi: true, isConnected: false });
    expect(r.ok).toBe(false);
    expect(scheduleChannelBlockedReason(r)).toMatch(/iGreen Chat desconectado/);
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
    expect(r.ok === false && r.pending).toBe("whatsapp_disconnected");
    expect(scheduleChannelBlockedReason(r)).toMatch(/desconectado/i);
  });

  it("sem canal → pendência", () => {
    const r = resolveScheduleChannel({ isWhapi: false, instanceName: "" });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.pending).toBe("whatsapp_disconnected");
  });
});
