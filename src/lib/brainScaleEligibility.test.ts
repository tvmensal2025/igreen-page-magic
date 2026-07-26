import { describe, expect, it } from "vitest";
import {
  isAnchorCampaignId,
  isBrainScaleEligible,
  isMgRotCampaignName,
  LEGACY_ANCHOR_CAMPAIGN_ID,
} from "./brainScaleEligibility";

const ANCHOR = "944c5bf7-1851-4961-97ad-f8c4c46c5a28";
const PARTNER = "11111111-1111-1111-1111-111111111111";

describe("brainScaleEligibility", () => {
  it("bloqueia MG-ROT", () => {
    expect(isMgRotCampaignName("MG-ROT-araxa · foo")).toBe(true);
    expect(
      isBrainScaleEligible(
        { id: PARTNER, name: "MG-ROT-bh · x" },
        { anchorCampaignId: ANCHOR },
      ),
    ).toBe(false);
  });

  it("bloqueia âncora configurada, não bloqueia parceiro UDI", () => {
    expect(isAnchorCampaignId(ANCHOR, ANCHOR)).toBe(true);
    expect(
      isBrainScaleEligible(
        { id: ANCHOR, name: "SEDE-UDI-50km · …" },
        { anchorCampaignId: ANCHOR },
      ),
    ).toBe(false);
    expect(
      isBrainScaleEligible(
        { id: PARTNER, name: "UDI-CPL-A CEMIG Feed · …" },
        { anchorCampaignId: ANCHOR },
      ),
    ).toBe(true);
  });

  it("ainda bloqueia UUID legado mesmo sem config", () => {
    expect(isAnchorCampaignId(LEGACY_ANCHOR_CAMPAIGN_ID, null)).toBe(true);
    expect(
      isBrainScaleEligible({
        id: LEGACY_ANCHOR_CAMPAIGN_ID,
        name: "Âncora antiga",
      }),
    ).toBe(false);
  });

  it("sem anchorCampaignId não bloqueia SEDE por nome (não inventa bloqueio)", () => {
    expect(
      isBrainScaleEligible({
        id: ANCHOR,
        name: "SEDE-UDI-50km · …",
      }),
    ).toBe(true);
  });

  it("já ligado: sempre elegível para abrir e desligar", () => {
    expect(
      isBrainScaleEligible(
        {
          id: ANCHOR,
          name: "SEDE-UDI-50km",
          brain_scale_enabled: true,
        },
        { anchorCampaignId: ANCHOR },
      ),
    ).toBe(true);
    expect(
      isBrainScaleEligible(
        {
          id: PARTNER,
          name: "MG-ROT-bh",
          brain_scale_enabled: true,
        },
        { anchorCampaignId: ANCHOR },
      ),
    ).toBe(true);
  });
});
