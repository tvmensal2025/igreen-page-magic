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

  const byUrl = new Map<string, AdVideoLibraryItem>();
  for (const row of [...(shared || []), ...(own || [])]) {
    const it = row as unknown as AdVideoLibraryItem;
    byUrl.set(it.url, it);
  }
  return Array.from(byUrl.values());
}
