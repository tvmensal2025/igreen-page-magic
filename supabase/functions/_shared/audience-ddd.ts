/**
 * Público por DDD — filtro de backend para o piloto (default DDD 34).
 * Não apaga leads: só decide se o motor pode tocar agora.
 */

export type AudienceMode = "off" | "shadow" | "enforced";

export type AudienceDecision = {
  allowed: boolean;
  mode: AudienceMode;
  ddd: string;
  reason: "ok" | "outside_ddd" | "invalid_phone" | "mode_off" | "shadow_observe";
};

/** Extrai DDD BR de dígitos (com ou sem 55). */
export function extractDdd(digits: string): string {
  const d = String(digits || "").replace(/\D/g, "");
  if (!d) return "??";
  if (d.startsWith("55") && d.length >= 4) return d.slice(2, 4);
  if (d.length >= 10) return d.slice(0, 2);
  if (d.length >= 2) return d.slice(0, 2);
  return "??";
}

export function phoneDigits(raw: string | null | undefined): string {
  return String(raw || "").replace(/\D/g, "");
}

/**
 * Decide se o telefone entra no público permitido.
 * - off: sempre allowed
 * - shadow: sempre allowed, mas reason=shadow_observe se fora
 * - enforced: bloqueia fora do DDD / inválido
 */
export function decideAudienceDdd(
  phone: string | null | undefined,
  opts: {
    mode?: AudienceMode | null;
    allowedDdds?: string[] | null;
  } = {},
): AudienceDecision {
  const mode: AudienceMode = opts.mode === "shadow" || opts.mode === "enforced" || opts.mode === "off"
    ? opts.mode
    : "enforced";
  const allowed = (opts.allowedDdds && opts.allowedDdds.length > 0)
    ? opts.allowedDdds.map(String)
    : ["34"];

  if (mode === "off") {
    return { allowed: true, mode, ddd: extractDdd(phoneDigits(phone)), reason: "mode_off" };
  }

  const digits = phoneDigits(phone);
  const ddd = extractDdd(digits);
  if (ddd === "??" || digits.length < 10) {
    if (mode === "shadow") {
      return { allowed: true, mode, ddd, reason: "shadow_observe" };
    }
    return { allowed: false, mode, ddd, reason: "invalid_phone" };
  }

  const inList = allowed.includes(ddd);
  if (inList) return { allowed: true, mode, ddd, reason: "ok" };

  if (mode === "shadow") {
    return { allowed: true, mode, ddd, reason: "shadow_observe" };
  }
  return { allowed: false, mode, ddd, reason: "outside_ddd" };
}

/** Lê config do piloto em app_settings (id=global) — fail-safe para enforced/34. */
export async function loadCadenceAudienceConfig(
  // deno-lint-ignore no-explicit-any
  supabase: any,
): Promise<{ mode: AudienceMode; allowedDdds: string[] }> {
  try {
    const { data } = await supabase
      .from("app_settings")
      .select("cadence_audience_mode, cadence_allowed_ddds")
      .eq("id", "global")
      .maybeSingle();
    const modeRaw = String(data?.cadence_audience_mode || "enforced").toLowerCase();
    const mode: AudienceMode =
      modeRaw === "off" || modeRaw === "shadow" || modeRaw === "enforced"
        ? modeRaw
        : "enforced";
    let allowedDdds = ["34"];
    const raw = data?.cadence_allowed_ddds;
    if (Array.isArray(raw) && raw.length > 0) {
      allowedDdds = raw.map(String);
    } else if (typeof raw === "string" && raw.trim()) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length) allowedDdds = parsed.map(String);
      } catch {
        allowedDdds = raw.split(",").map((s: string) => s.trim()).filter(Boolean);
      }
    }
    return { mode, allowedDdds };
  } catch {
    return { mode: "enforced", allowedDdds: ["34"] };
  }
}
