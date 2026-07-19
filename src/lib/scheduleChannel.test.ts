import { describe, expect, it } from "vitest";
import { resolveScheduleChannel } from "./scheduleChannel";

describe("resolveScheduleChannel", () => {
  it("Whapi conectado usa whapi-superadmin", () => {
    const r = resolveScheduleChannel({ isWhapi: true, instanceName: null });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.channel).toBe("whapi");
      expect(r.instanceName).toBe("whapi-superadmin");
    }
  });

  it("Evolution usa instanceName", () => {
    const r = resolveScheduleChannel({ isWhapi: false, instanceName: "igreen-abc" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.channel).toBe("evolution");
      expect(r.instanceName).toBe("igreen-abc");
    }
  });

  it("sem canal → pendência", () => {
    const r = resolveScheduleChannel({ isWhapi: false, instanceName: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.pending).toBe("whatsapp_disconnected");
  });
});
