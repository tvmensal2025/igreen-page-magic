/** Formata geo do anúncio: cidade pura OU raio em km (nunca os dois misturados). */
export type CampaignCityLike = {
  key?: string | null;
  name?: string | null;
  radius?: number | null;
};

export function formatCampaignGeo(cities: CampaignCityLike[] | null | undefined): {
  mode: "city" | "radius" | "empty";
  lines: string[];
  summary: string;
} {
  const list = Array.isArray(cities) ? cities.filter(Boolean) : [];
  if (!list.length) return { mode: "empty", lines: [], summary: "Sem local definido" };

  const radiusLines: string[] = [];
  const cityLines: string[] = [];

  for (const c of list) {
    const key = String(c.key || "");
    const name = String(c.name || "").trim();
    // key sintético: radius:lat,lng:km
    const m = key.match(/^radius:[^:]+:(\d+(?:\.\d+)?)$/i);
    if (m) {
      const km = Math.round(Number(m[1]));
      const label = name.replace(/\s*\(\d+\s*km\)\s*$/i, "").trim() || "Ponto";
      radiusLines.push(`${label} · ${km} km`);
      continue;
    }
    if (typeof c.radius === "number" && c.radius > 0) {
      radiusLines.push(`${name || "Ponto"} · ${Math.round(c.radius)} km`);
      continue;
    }
    // Nome legado "Jaraguá (80km)"
    const fromName = name.match(/^(.*?)\s*\((\d+)\s*km\)\s*$/i);
    if (fromName) {
      radiusLines.push(`${fromName[1].trim()} · ${fromName[2]} km`);
      continue;
    }
    if (name) cityLines.push(name);
  }

  if (radiusLines.length && !cityLines.length) {
    return {
      mode: "radius",
      lines: radiusLines.slice(0, 4),
      summary: radiusLines.length === 1
        ? radiusLines[0]
        : `${radiusLines[0]} (+${radiusLines.length - 1})`,
    };
  }
  if (cityLines.length) {
    const uniq = [...new Set(cityLines)];
    return {
      mode: "city",
      lines: uniq.slice(0, 4),
      summary: uniq.length <= 2
        ? uniq.join(", ")
        : `${uniq.slice(0, 2).join(", ")} +${uniq.length - 2}`,
    };
  }
  return { mode: "empty", lines: [], summary: "Sem local definido" };
}

export function phoneDdd(phone: string | null | undefined): string | null {
  const d = String(phone || "").replace(/\D/g, "");
  const withCc = d.startsWith("55") ? d.slice(2) : d;
  if (withCc.length < 10) return null;
  return withCc.slice(0, 2);
}
