import { describe, expect, it } from "vitest";
import { buildConsultantBannerInitials } from "@/lib/consultantBannerLink";

describe("buildConsultantBannerInitials", () => {
  it("Rafael Ferreira Dias → rfd", () => {
    expect(buildConsultantBannerInitials("Rafael Ferreira Dias")).toBe("rfd");
  });

  it("ignora partículas PT (Abel Olympio de Oliveira → aoo)", () => {
    expect(buildConsultantBannerInitials("Abel Olympio de Oliveira")).toBe("aoo");
  });

  it("prefere display_name curto", () => {
    expect(
      buildConsultantBannerInitials(
        "Abel Olympio de Oliveira",
        "Abel Olympio",
      ),
    ).toBe("ao");
  });
});
