import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export const TRACKING_PROTOCOL_RE = /\b(FB|IG|GG|TT|WA)\s*[-–—]?\s*(\d{4,8})\b/i;
const MAX_INITIAL_MESSAGE_LEN = 160;

export function normalizeTrackingProtocol(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = String(value).match(TRACKING_PROTOCOL_RE);
  if (!match) return null;
  return `${match[1].toUpperCase()}-${match[2]}`;
}

export function stripTrackingProtocol(value: string | null | undefined): string {
  return String(value || "")
    .replace(/\s*[-–—]?\s*protocolo\s*:?[ \t]*/gi, " ")
    .replace(TRACKING_PROTOCOL_RE, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function appendTrackingProtocol(baseMessage: string, protocol: string | null | undefined): string {
  const normalized = normalizeTrackingProtocol(protocol);
  const cleanBase = stripTrackingProtocol(baseMessage);
  if (!normalized) return cleanBase.slice(0, MAX_INITIAL_MESSAGE_LEN);
  const suffix = ` Protocolo ${normalized}`;
  const maxBase = Math.max(0, MAX_INITIAL_MESSAGE_LEN - suffix.length);
  const trimmedBase = cleanBase.length > maxBase
    ? cleanBase.slice(0, maxBase).replace(/[\s.,;:!?-]+$/g, "")
    : cleanBase;
  return `${trimmedBase}${suffix}`.trim().slice(0, MAX_INITIAL_MESSAGE_LEN);
}

export function detectTrackingChannel(input: {
  placement_mode?: string | null;
  placements?: string[] | null;
}): "FB" | "IG" {
  const placements = Array.isArray(input.placements) ? input.placements : [];
  if (input.placement_mode === "manual" && placements.length > 0) {
    const hasInstagram = placements.some((p) => String(p).startsWith("ig:"));
    const hasFacebook = placements.some((p) => String(p).startsWith("fb:"));
    if (hasInstagram && !hasFacebook) return "IG";
  }
  return "FB";
}

export async function ensureCampaignTrackingProtocol(
  supabase: SupabaseClient,
  channel: string = "FB",
): Promise<string> {
  const normalizedChannel = ["FB", "IG", "GG", "TT", "WA"].includes(String(channel).toUpperCase())
    ? String(channel).toUpperCase()
    : "FB";
  try {
    const { data, error } = await supabase.rpc("generate_campaign_tracking_protocol", {
      _channel: normalizedChannel,
    });
    if (!error && typeof data === "string" && normalizeTrackingProtocol(data)) {
      return normalizeTrackingProtocol(data)!;
    }
  } catch (e) {
    console.warn("[campaign-tracking] protocol RPC falhou:", (e as Error)?.message);
  }
  // Fallback local alto, mantendo aparência profissional mesmo se a RPC falhar.
  return `${normalizedChannel}-${Math.floor(70000 + Math.random() * 20000)}`;
}

export async function resolveCampaignByTrackingProtocol(
  supabase: SupabaseClient,
  consultantId: string,
  text: string | null | undefined,
): Promise<string | null> {
  const protocol = normalizeTrackingProtocol(text);
  if (!protocol) return null;
  try {
    const { data, error } = await supabase
      .from("facebook_campaigns")
      .select("id, status")
      .eq("consultant_id", consultantId)
      .eq("tracking_protocol", protocol)
      .in("status", ["active", "pending_review"])
      .maybeSingle();
    if (error) {
      console.warn("[campaign-tracking] lookup falhou:", error.message);
      return null;
    }
    return (data as any)?.id ?? null;
  } catch (e) {
    console.warn("[campaign-tracking] lookup exceção:", (e as Error)?.message);
    return null;
  }
}

function normalizeWords(s: string): string[] {
  return (s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 2 && !["protocolo", "facebook", "instagram"].includes(w));
}

export function jaccardSimilarity(a: string, b: string): number {
  const wa = new Set(normalizeWords(stripTrackingProtocol(a)));
  const wb = new Set(normalizeWords(stripTrackingProtocol(b)));
  if (!wa.size || !wb.size) return 0;
  let inter = 0;
  wa.forEach((w) => { if (wb.has(w)) inter++; });
  return inter / (wa.size + wb.size - inter);
}