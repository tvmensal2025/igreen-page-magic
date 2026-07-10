import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// Formato NOVO (profissional): YYYY-#### opcionalmente com sufixo de instância -A/-B/-C
// Ex.: 2026-0042, 2026-0042-A
export const TRACKING_PROTOCOL_V2_RE = /\b(20\d{2})[-–—](\d{4})(?:[-–—]([A-Z]))?\b/;

// Formato LEGADO mantido para retrocompatibilidade: FB-87321 / IG-87321 ...
export const TRACKING_PROTOCOL_LEGACY_RE = /\b(FB|IG|GG|TT|WA)\s*[-–—]?\s*(\d{4,8})\b/i;

// Ticket de atendimento (NÃO usado pra matching de campanha).
// Formato: IGR-XXX-#### (ex.: IGR-RFF-0042). É gerado do NOSSO lado, o cliente não digita.
export const SERVICE_TICKET_RE = /\bIGR-[A-Z0-9]{3}-\d{4}\b/;

// Regex composta usada nos webhooks (tenta o novo primeiro)
export const TRACKING_PROTOCOL_RE = TRACKING_PROTOCOL_V2_RE;

const MAX_INITIAL_MESSAGE_LEN = 280; // aumentado p/ acomodar o bloco visual

export function normalizeTrackingProtocol(value: string | null | undefined): string | null {
  if (!value) return null;
  const s = String(value);
  const m2 = s.match(TRACKING_PROTOCOL_V2_RE);
  if (m2) {
    const base = `${m2[1]}-${m2[2]}`;
    return m2[3] ? `${base}-${m2[3].toUpperCase()}` : base;
  }
  const m1 = s.match(TRACKING_PROTOCOL_LEGACY_RE);
  if (m1) return `${m1[1].toUpperCase()}-${m1[2]}`;
  return null;
}

/** Retorna apenas o "protocolo-base" (sem sufixo de instância) para lookup de campanha. */
export function protocolBase(protocol: string | null | undefined): string | null {
  const n = normalizeTrackingProtocol(protocol);
  if (!n) return null;
  const m2 = n.match(TRACKING_PROTOCOL_V2_RE);
  if (m2) return `${m2[1]}-${m2[2]}`;
  return n; // legado não tem sufixo
}

export function protocolSuffix(protocol: string | null | undefined): string | null {
  const n = normalizeTrackingProtocol(protocol);
  if (!n) return null;
  const m2 = n.match(TRACKING_PROTOCOL_V2_RE);
  return m2?.[3] ?? null;
}

const BLOCK_LINE = "━━━━━━━━━━━━━━━━━━";

export function stripTrackingProtocol(value: string | null | undefined): string {
  return String(value || "")
    // remove bloco visual completo (formato antigo com ━━━)
    .replace(new RegExp(`${BLOCK_LINE}[\\s\\S]*?${BLOCK_LINE}`, "g"), "")
    // formato novo e legado: "📋 Protocolo: *XXX*" / "Protocolo de atendimento"
    .replace(/📋\s*Protocolo[^\n]*/gi, "")
    .replace(/\s*[-–—]?\s*protocolo(?:\s+de\s+atendimento)?\s*:?[ \t]*/gi, " ")
    .replace(TRACKING_PROTOCOL_V2_RE, "")
    .replace(TRACKING_PROTOCOL_LEGACY_RE, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Bloco visual no wa.me da campanha. Sem ━━━ (quebra no WhatsApp).
 * Protocolo permanece em texto puro/negrito para matching nos webhooks. */
export function formatProtocolBlock(protocol: string): string {
  return `\n\n📋 Protocolo: *${protocol}*`;
}

export function appendTrackingProtocol(baseMessage: string, protocol: string | null | undefined): string {
  const normalized = normalizeTrackingProtocol(protocol);
  const cleanBase = stripTrackingProtocol(baseMessage);
  if (!normalized) return cleanBase.slice(0, MAX_INITIAL_MESSAGE_LEN);
  const block = formatProtocolBlock(normalized);
  const maxBase = Math.max(0, MAX_INITIAL_MESSAGE_LEN - block.length);
  const trimmedBase = cleanBase.length > maxBase
    ? cleanBase.slice(0, maxBase).replace(/[\s.,;:!?-]+$/g, "")
    : cleanBase;
  return `${trimmedBase}${block}`.slice(0, MAX_INITIAL_MESSAGE_LEN);
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
  // Fallback local com formato novo
  const year = new Date().getFullYear();
  const seq = Math.floor(1000 + Math.random() * 8999);
  return `${year}-${seq}`;
}

export async function resolveCampaignByTrackingProtocol(
  supabase: SupabaseClient,
  consultantId: string,
  text: string | null | undefined,
): Promise<string | null> {
  const base = protocolBase(text);
  if (!base) return null;
  try {
    const { data, error } = await supabase
      .from("facebook_campaigns")
      .select("id, status")
      .eq("consultant_id", consultantId)
      .eq("tracking_protocol", base)
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
    .filter((w) => w.length > 2 && !["protocolo", "facebook", "instagram", "atendimento"].includes(w));
}

export function jaccardSimilarity(a: string, b: string): number {
  const wa = new Set(normalizeWords(stripTrackingProtocol(a)));
  const wb = new Set(normalizeWords(stripTrackingProtocol(b)));
  if (!wa.size || !wb.size) return 0;
  let inter = 0;
  wa.forEach((w) => { if (wb.has(w)) inter++; });
  return inter / (wa.size + wb.size - inter);
}
