import { describe, expect, it } from "vitest";
import { dddsFromCampaignGeo, primaryDddForCity, expandNearbyDdds } from "./cityToDdd";

describe("cityToDdd", () => {
  it("Uberlândia → 34 + vizinhos", () => {
    expect(primaryDddForCity({ key: "273173", name: "Uberlândia" })).toBe(34);
    expect(dddsFromCampaignGeo({ cities: [{ key: "273173", name: "Uberlândia" }] })).toEqual([34, 35]);
  });

  it("BH → cluster 31", () => {
    const d = dddsFromCampaignGeo({ cities: [{ name: "Belo Horizonte" }] });
    expect(d).toContain(31);
    expect(d).not.toContain(19);
  });

  it("expandNearby não inventa SP a partir de MG", () => {
    expect(expandNearbyDdds([34])).toEqual([34, 35]);
  });
});
