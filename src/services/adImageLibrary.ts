import { supabase } from "@/integrations/supabase/client";

export type AdImageFormat = "square" | "vertical" | "story";

export interface AdImageLibraryItem {
  id: string;
  consultant_id: string;
  url: string;
  storage_path: string | null;
  format: AdImageFormat;
  width: number | null;
  height: number | null;
  file_size: number | null;
  content_type: string | null;
  filename: string | null;
  fb_image_hash: string | null;
  fb_image_hash_synced_at: string | null;
  usage_count: number;
  last_used_at: string | null;
  created_at: string;
  is_platform_shared?: boolean;
}

/** Basename sem query/hash — p/ dedupe quando a mesma foto foi reenviada com URL diferente. */
function imageDedupeKey(it: AdImageLibraryItem): string {
  const raw =
    (it.filename || "").trim() ||
    (it.url || "").split("?")[0].split("/").pop() ||
    it.url ||
    it.id;
  // Remove prefixo de timestamp do upload (ex.: 1783509770991-1000668840.png → 1000668840.png)
  const base = raw.toLowerCase().replace(/^\d{10,}-/, "");
  return `${base}|${it.format || "unknown"}`;
}

function preferImage(a: AdImageLibraryItem, b: AdImageLibraryItem): AdImageLibraryItem {
  const sa = a.is_platform_shared ? 1 : 0;
  const sb = b.is_platform_shared ? 1 : 0;
  if (sb !== sa) return sb > sa ? b : a;
  if ((b.usage_count || 0) !== (a.usage_count || 0)) {
    return (b.usage_count || 0) > (a.usage_count || 0) ? b : a;
  }
  return String(b.created_at || "") > String(a.created_at || "") ? b : a;
}

export async function listAdImageLibrary(consultantId: string): Promise<AdImageLibraryItem[]> {
  // Próprias + oficiais compartilhadas (is_platform_shared). RLS libera as shared.
  const { data: own, error: ownErr } = await supabase
    .from("ad_image_library" as any)
    .select("*")
    .eq("consultant_id", consultantId)
    .order("last_used_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(200);
  if (ownErr) throw ownErr;

  const { data: shared, error: sharedErr } = await supabase
    .from("ad_image_library" as any)
    .select("*")
    .eq("is_platform_shared", true)
    .neq("consultant_id", consultantId)
    .order("usage_count", { ascending: false })
    .limit(50);
  // Coluna ainda não aplicada → ignora shared sem quebrar a biblioteca própria.
  if (sharedErr && !/is_platform_shared|column/i.test(sharedErr.message || "")) {
    throw sharedErr;
  }

  // 1) por URL  2) por nome+formato (mesma arte reenviada com timestamp diferente)
  const byUrl = new Map<string, AdImageLibraryItem>();
  for (const row of [...(shared || []), ...(own || [])]) {
    const it = row as unknown as AdImageLibraryItem;
    if (!it.url) continue;
    const prev = byUrl.get(it.url);
    byUrl.set(it.url, prev ? preferImage(prev, it) : it);
  }

  const byCreative = new Map<string, AdImageLibraryItem>();
  for (const it of byUrl.values()) {
    const key = imageDedupeKey(it);
    const prev = byCreative.get(key);
    byCreative.set(key, prev ? preferImage(prev, it) : it);
  }
  return Array.from(byCreative.values());
}

export async function addToAdImageLibrary(item: {
  consultant_id: string;
  url: string;
  storage_path?: string | null;
  format: AdImageFormat;
  width?: number | null;
  height?: number | null;
  file_size?: number | null;
  content_type?: string | null;
  filename?: string | null;
}): Promise<AdImageLibraryItem | null> {
  // Evita duplicar mesma URL
  const { data: existing } = await supabase
    .from("ad_image_library" as any)
    .select("*")
    .eq("consultant_id", item.consultant_id)
    .eq("url", item.url)
    .maybeSingle();
  if (existing) return existing as unknown as AdImageLibraryItem;

  const { data, error } = await supabase
    .from("ad_image_library" as any)
    .insert(item as any)
    .select()
    .single();
  if (error) {
    console.warn("[adImageLibrary] insert falhou:", error.message);
    return null;
  }
  return data as unknown as AdImageLibraryItem;
}

export async function removeFromAdImageLibrary(id: string, storagePath?: string | null, opts?: { isPlatformShared?: boolean }) {
  if (opts?.isPlatformShared) {
    throw new Error("Imagem oficial da plataforma — não pode excluir.");
  }
  if (storagePath) {
    try {
      await supabase.storage.from("consultant-photos").remove([storagePath]);
    } catch (e) { console.warn("[adImageLibrary] remove storage falhou:", e); }
  }
  const { error } = await supabase.from("ad_image_library" as any).delete().eq("id", id);
  if (error) throw error;
}
