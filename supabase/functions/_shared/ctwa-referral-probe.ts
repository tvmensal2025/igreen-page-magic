// Diagnostic probe: recursively scans an incoming webhook payload for any Meta CTWA
// referral identifiers and records what we found (or that we found nothing but the
// text looked like a CTWA opener). Purpose: prove/disprove whether Meta is actually
// sending referral fields and, if so, at what path — so we can fix the parsers
// without guessing.

import { matchesMetaCtwaPhrase } from "./meta-ctwa-fallback.ts";

const REFERRAL_KEYS = new Set([
  "referral",
  "referred_product",
  "externaladreply",
  "external_ad_reply",
  "ad_reply",
  "ctwaclid",
  "ctwa_clid",
  "sourceid",
  "source_id",
  "sourceurl",
  "source_url",
  "sourcetype",
  "source_type",
  "ad_id",
  "adid",
]);

export interface ProbeHit {
  matchedPaths: string[];
  ctwaClid: string | null;
  sourceAdId: string | null;
  sourceUrl: string | null;
  raw: Record<string, unknown>;
}

/** Recursively walks an object graph and returns every key path that looks CTWA-related. */
export function findReferralPaths(root: unknown, maxDepth = 12): ProbeHit {
  const matchedPaths: string[] = [];
  const raw: Record<string, unknown> = {};
  let ctwaClid: string | null = null;
  let sourceAdId: string | null = null;
  let sourceUrl: string | null = null;

  const seen = new WeakSet<object>();

  const walk = (node: unknown, path: string, depth: number) => {
    if (depth > maxDepth || node == null) return;
    if (typeof node !== "object") return;
    if (seen.has(node as object)) return;
    seen.add(node as object);

    if (Array.isArray(node)) {
      node.forEach((v, i) => walk(v, `${path}[${i}]`, depth + 1));
      return;
    }

    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      const lower = k.toLowerCase();
      const nextPath = path ? `${path}.${k}` : k;

      if (REFERRAL_KEYS.has(lower)) {
        matchedPaths.push(nextPath);
        raw[nextPath] = v;
        const strVal = typeof v === "string" ? v : null;
        if (lower === "ctwaclid" || lower === "ctwa_clid") ctwaClid = ctwaClid || strVal;
        if (lower === "sourceid" || lower === "source_id" || lower === "ad_id" || lower === "adid") {
          sourceAdId = sourceAdId || (strVal ?? (typeof v === "number" ? String(v) : null));
        }
        if (lower === "sourceurl" || lower === "source_url") sourceUrl = sourceUrl || strVal;
      }

      walk(v, nextPath, depth + 1);
    }
  };

  walk(root, "", 0);
  return { matchedPaths, ctwaClid, sourceAdId, sourceUrl, raw };
}

/** Fire-and-forget log to ctwa_referral_probe_log. Never throws. */
export async function logReferralProbe(
  supabase: any,
  args: {
    source: "evolution" | "whapi";
    payload: unknown;
    messageText?: string | null;
    customerId?: string | null;
    consultantId?: string | null;
  },
): Promise<ProbeHit | null> {
  try {
    const hit = findReferralPaths(args.payload);
    const hadCtwaPhrase = !!(args.messageText && matchesMetaCtwaPhrase(args.messageText));

    // Only log when there's SOMETHING interesting: either referral fields were found,
    // or the text opened with a Meta CTWA phrase (meaning we probably lost the referral).
    if (hit.matchedPaths.length === 0 && !hadCtwaPhrase) return hit;

    await supabase.from("ctwa_referral_probe_log").insert({
      source: args.source,
      had_ctwa_phrase: hadCtwaPhrase,
      matched_paths: hit.matchedPaths,
      extracted: {
        ctwa_clid: hit.ctwaClid,
        source_ad_id: hit.sourceAdId,
        source_url: hit.sourceUrl,
        raw_matched: hit.raw,
      },
      payload: args.payload as any,
      customer_id: args.customerId ?? null,
      consultant_id: args.consultantId ?? null,
    });

    return hit;
  } catch (e) {
    console.warn("[ctwa-probe] log failed:", (e as Error).message);
    return null;
  }
}
