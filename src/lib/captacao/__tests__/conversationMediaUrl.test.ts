import { describe, expect, it } from "vitest";
import {
  parseConversationEmbeddedMediaUrl,
  preferDurableMediaUrl,
} from "@/lib/captacao/conversationMediaUrl";

describe("parseConversationEmbeddedMediaUrl", () => {
  it("extrai URL Evolution/MinIO do message_text", () => {
    const r = parseConversationEmbeddedMediaUrl(
      "[image] https://cdn.example.com/whatsapp/x/foto.jpg",
    );
    expect(r).toEqual({
      kind: "image",
      url: "https://cdn.example.com/whatsapp/x/foto.jpg",
    });
  });

  it("aceita document/pdf", () => {
    const r = parseConversationEmbeddedMediaUrl(
      "[document] https://cdn.example.com/fatura.pdf",
    );
    expect(r?.kind).toBe("document");
    expect(r?.url).toContain("fatura.pdf");
  });

  it("ignora placeholder sem URL", () => {
    expect(parseConversationEmbeddedMediaUrl("[imagem]")).toBeNull();
    expect(parseConversationEmbeddedMediaUrl("oi")).toBeNull();
    expect(parseConversationEmbeddedMediaUrl(null)).toBeNull();
  });
});

describe("preferDurableMediaUrl", () => {
  it("prioriza http Whapi sobre data:", () => {
    expect(
      preferDurableMediaUrl({
        httpUrl: "https://gate.whapi.cloud/media/1",
        dataOrOther: "data:image/jpeg;base64,AAA",
      }),
    ).toBe("https://gate.whapi.cloud/media/1");
  });

  it("cai em data: se não houver http", () => {
    expect(
      preferDurableMediaUrl({
        httpUrl: null,
        dataOrOther: "data:image/jpeg;base64,AAA",
      }),
    ).toBe("data:image/jpeg;base64,AAA");
  });
});
