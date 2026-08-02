import { describe, expect, it } from "vitest";
import { isValidWhatsAppPhone, retentionPhoneKey } from "./birthdayMessages";

describe("retentionPhoneKey", () => {
  it("normaliza BR com DDI", () => {
    expect(retentionPhoneKey("5519987806293")).toBe("5519987806293");
    expect(retentionPhoneKey("(19) 98780-6293")).toBe("5519987806293");
  });

  it("ignora sufixo de colisão do sync (_igreen_code)", () => {
    expect(retentionPhoneKey("5519987806293_1137420")).toBe("5519987806293");
    expect(retentionPhoneKey("5519987806293_1137443")).toBe("5519987806293");
    expect(retentionPhoneKey("5519987806293")).toBe(
      retentionPhoneKey("5519987806293_1137488"),
    );
  });

  it("rejeita sem_celular", () => {
    expect(retentionPhoneKey("sem_celular_1142238")).toBeNull();
    expect(isValidWhatsAppPhone("sem_celular_1142238")).toBe(false);
  });

  it("aceita número com sufixo como válido para WA", () => {
    expect(isValidWhatsAppPhone("5519987806293_1137420")).toBe(true);
  });
});
