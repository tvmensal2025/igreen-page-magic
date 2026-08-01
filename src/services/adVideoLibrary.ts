import { supabase } from "@/integrations/supabase/client";

export interface AdVideoLibraryItem {
  id: string;
  consultant_id: string;
  url: string;
  storage_path: string | null;
  thumb_url: string | null;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  file_size: number | null;
  content_type: string | null;
  filename: string | null;
  usage_count: number;
  last_used_at: string | null;
  created_at: string;
  is_platform_shared?: boolean;
}

/** Basename estável — ignora timestamp de upload e usa hash Meta quando existir. */
function videoDedupeKey(it: AdVideoLibraryItem): string {
  const raw =
    (it.filename || "").trim() ||
    (it.url || "").split("?")[0].split("/").pop() ||
    it.url ||
    it.id;
  const lower = raw.toLowerCase();

  // Mesmo arquivo reenviado várias vezes: .../video-TS-mp4-<hash>-....mp4
  const hashMatch = lower.match(/mp4-([a-f0-9]{16,})/);
  if (hashMatch) return `hash:${hashMatch[1]}`;

  // video-1780505120319-Rodrigo_e_daine.mp4 → rodrigo_e_daine.mp4
  const base = lower
    .replace(/^video-\d{10,}-/, "")
    .replace(/^\d{10,}-/, "");
  return base || lower;
}

function preferVideo(a: AdVideoLibraryItem, b: AdVideoLibraryItem): AdVideoLibraryItem {
  const sa = a.is_platform_shared ? 1 : 0;
  const sb = b.is_platform_shared ? 1 : 0;
  if (sb !== sa) return sb > sa ? b : a;
  const ta = a.thumb_url ? 1 : 0;
  const tb = b.thumb_url ? 1 : 0;
  if (tb !== ta) return tb > ta ? b : a;
  const fa = a.filename ? 1 : 0;
  const fb = b.filename ? 1 : 0;
  if (fb !== fa) return fb > fa ? b : a;
  if ((b.usage_count || 0) !== (a.usage_count || 0)) {
    return (b.usage_count || 0) > (a.usage_count || 0) ? b : a;
  }
  return String(b.created_at || "") > String(a.created_at || "") ? b : a;
}

/** Vídeos do consultor + oficiais compartilhados (Reels Uberaba limpo, etc.). */
export async function listAdVideoLibrary(consultantId: string): Promise<AdVideoLibraryItem[]> {
  const { data: own, error: ownErr } = await supabase
    .from("ad_video_library" as any)
    .select("*")
    .eq("consultant_id", consultantId)
    .order("usage_count", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(100);
  if (ownErr) throw ownErr;

  const { data: shared, error: sharedErr } = await supabase
    .from("ad_video_library" as any)
    .select("*")
    .eq("is_platform_shared", true)
    .neq("consultant_id", consultantId)
    .order("usage_count", { ascending: false })
    .limit(30);
  if (sharedErr && !/is_platform_shared|column/i.test(sharedErr.message || "")) {
    throw sharedErr;
  }

  // 1) por URL  2) por nome/hash (mesmo vídeo reenviado com timestamp diferente)
  const byUrl = new Map<string, AdVideoLibraryItem>();
  for (const row of [...(shared || []), ...(own || [])]) {
    const it = row as unknown as AdVideoLibraryItem;
    if (!it.url) continue;
    const prev = byUrl.get(it.url);
    byUrl.set(it.url, prev ? preferVideo(prev, it) : it);
  }

  const byCreative = new Map<string, AdVideoLibraryItem>();
  for (const it of byUrl.values()) {
    const key = videoDedupeKey(it);
    const prev = byCreative.get(key);
    byCreative.set(key, prev ? preferVideo(prev, it) : it);
  }

  // Oficiais primeiro na grade
  return Array.from(byCreative.values()).sort((a, b) => {
    const sa = a.is_platform_shared ? 1 : 0;
    const sb = b.is_platform_shared ? 1 : 0;
    if (sb !== sa) return sb - sa;
    return (b.usage_count || 0) - (a.usage_count || 0);
  });
}
