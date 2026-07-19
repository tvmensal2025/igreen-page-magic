import { describe, expect, it } from "vitest";
import { formatCampaignGeo } from "./campaignGeo";

describe("formatCampaignGeo", () => {
  it("cidade pura", () => {
    const g = formatCampaignGeo([{ key: "273173", name: "Uberlândia" }]);
    expect(g.mode).toBe("city");
    expect(g.summary).toBe("Uberlândia");
  });

  it("raio em km", () => {
    const g = formatCampaignGeo([{ key: "radius:-18.9,-48.3:80", name: "Jaraguá (80km)" }]);
    expect(g.mode).toBe("radius");
    expect(g.summary).toContain("80 km");
  });
});
