/**
 * Frase dinâmica {{frase_disponibilidade}} — America/Sao_Paulo.
 * Defaults = catálogo Multicanal (aba Disponibilidade).
 * Overrides = bodies salvos em ai_media_library (slot multichannel_cadence_v2).
 */

export type AvailabilitySlot =
  | "before_1630"
  | "1630_1730"
  | "after_1730"
  | "after_1800"
  | "closed";

/** Chaves editáveis (sem "closed" — usa after_1800). */
export type AvailabilityOverrideKey =
  | "before_1630"
  | "1630_1730"
  | "after_1730"
  | "after_1800";

export type AvailabilityOverrides = Partial<Record<AvailabilityOverrideKey, string>>;

export const AVAILABILITY_BODY_KEYS: Record<AvailabilityOverrideKey, string> = {
  before_1630: "availability_before_1630",
  "1630_1730": "availability_1630_1730",
  after_1730: "availability_after_1730",
  after_1800: "availability_after_1800",
};

export const DEFAULT_AVAILABILITY_PHRASES: Record<AvailabilityOverrideKey, string> = {
  before_1630: "Estou por aqui hoje até *as 18h*. 😊",
  "1630_1730": "Ainda estou por aqui até *as 18h*. 😊",
  after_1730:
    "Ainda atendo até *as 18h* — se preferir, a gente continua amanhã no horário de atendimento. 😊",
  after_1800:
    "Já anotei seu interesse! ✅ No *próximo horário de atendimento* a gente continua de onde parou.",
};

const REMOTE_LIBRARY_SLOT = "multichannel_cadence_v2";

function pickOverride(
  overrides: AvailabilityOverrides | undefined,
  key: AvailabilityOverrideKey,
): string {
  const custom = overrides?.[key]?.trim();
  return custom || DEFAULT_AVAILABILITY_PHRASES[key];
}

export function buildAvailabilityPhrase(
  now: Date = new Date(),
  overrides?: AvailabilityOverrides,
): { phrase: string; slot: AvailabilitySlot } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Sao_Paulo",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const wd = parts.find((p) => p.type === "weekday")?.value ?? "Mon";
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  const mins = hour * 60 + minute;
  const closedPhrase = pickOverride(overrides, "after_1800");

  if (wd === "Sun" || wd === "Sat") {
    return { slot: "closed", phrase: closedPhrase };
  }
  if (mins >= 18 * 60) return { slot: "after_1800", phrase: closedPhrase };
  if (mins >= 17 * 60 + 30) {
    return { slot: "after_1730", phrase: pickOverride(overrides, "after_1730") };
  }
  if (mins >= 16 * 60 + 30) {
    return { slot: "1630_1730", phrase: pickOverride(overrides, "1630_1730") };
  }
  if (mins >= 9 * 60) {
    return { slot: "before_1630", phrase: pickOverride(overrides, "before_1630") };
  }
  return { slot: "closed", phrase: closedPhrase };
}

/** Extrai overrides dos bodies da biblioteca Multicanal. */
export function availabilityOverridesFromBodies(
  bodies: Record<string, string> | null | undefined,
): AvailabilityOverrides {
  if (!bodies) return {};
  const out: AvailabilityOverrides = {};
  for (const [slot, key] of Object.entries(AVAILABILITY_BODY_KEYS) as Array<
    [AvailabilityOverrideKey, string]
  >) {
    const v = bodies[key]?.trim();
    if (v) out[slot] = v;
  }
  return out;
}

export async function loadAvailabilityOverrides(
  supabase: { from: (t: string) => any },
  consultantId: string | null | undefined,
): Promise<AvailabilityOverrides> {
  if (!consultantId) return {};
  try {
    const { data, error } = await supabase
      .from("ai_media_library")
      .select("text_content")
      .eq("consultant_id", consultantId)
      .eq("slot_key", REMOTE_LIBRARY_SLOT)
      .eq("active", true)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data?.text_content) return {};
    const parsed = JSON.parse(String(data.text_content)) as {
      bodies?: Record<string, string>;
    };
    return availabilityOverridesFromBodies(parsed?.bodies);
  } catch {
    return {};
  }
}

/** Cache por consultor dentro de um tick do cron. */
export function createAvailabilityLoader(supabase: { from: (t: string) => any }) {
  const cache = new Map<string, AvailabilityOverrides>();
  return async (consultantId: string | null | undefined): Promise<AvailabilityOverrides> => {
    const key = consultantId || "__none__";
    if (cache.has(key)) return cache.get(key)!;
    const overrides = await loadAvailabilityOverrides(supabase, consultantId);
    cache.set(key, overrides);
    return overrides;
  };
}
