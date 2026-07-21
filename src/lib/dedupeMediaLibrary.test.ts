import { describe, expect, it } from "vitest";
import {
  dedupeMediaLibraryPreferLightest,
  mediaLibraryByteSize,
  normalizeMediaLibraryLabel,
} from "./dedupeMediaLibrary";

describe("dedupeMediaLibraryPreferLightest", () => {
  it("normaliza label ignorando acento e espaços", () => {
    expect(normalizeMediaLibraryLabel("  Conexão Green  ")).toBe("conexao green");
  });

  it("prefer final_size sobre original_size", () => {
    expect(
      mediaLibraryByteSize({ final_size_bytes: 100, original_size_bytes: 999 }),
    ).toBe(100);
    expect(mediaLibraryByteSize({ final_size_bytes: null, original_size_bytes: 50 })).toBe(
      50,
    );
  });

  it("mantém só a cópia mais leve do mesmo título", () => {
    const items = [
      {
        id: "heavy",
        label: "1. Conexão Green – Apresentação (1min)",
        url: "https://x/a.mp4",
        final_size_bytes: 80_000_000,
      },
      {
        id: "light",
        label: "1. Conexão Green – Apresentação (1min)",
        url: "https://x/b.mp4",
        final_size_bytes: 12_000_000,
      },
      {
        id: "other",
        label: "5. Conexão Club – Lojas, Saúde e Farmácias",
        url: "https://x/c.mp4",
        final_size_bytes: 20_000_000,
      },
    ];
    const out = dedupeMediaLibraryPreferLightest(items);
    expect(out.map((m) => m.id)).toEqual(["light", "other"]);
  });

  it("agrupa labels equivalentes com acento/caixa", () => {
    const out = dedupeMediaLibraryPreferLightest([
      { id: "a", label: "Conexão Club", final_size_bytes: 9 },
      { id: "b", label: "conexao club", final_size_bytes: 3 },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("b");
  });
});
