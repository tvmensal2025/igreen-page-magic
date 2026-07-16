import { supabase } from "@/integrations/supabase/client";

/** Extrai bucket + path de URL do Supabase Storage. */
export function parseSupabaseStorageUrl(
  url: string,
): { bucket: string; path: string } | null {
  try {
    const u = new URL(url);
    const m = u.pathname.match(
      /\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/]+)\/(.+)$/,
    );
    if (!m) return null;
    return {
      bucket: decodeURIComponent(m[1]),
      path: decodeURIComponent(m[2]),
    };
  } catch {
    return null;
  }
}

/**
 * Bucket whatsapp-media é privado — URL /object/public/ não carrega no browser.
 * Gera signed URL (1h) para exibir thumbnail na ficha.
 * URLs externas (MinIO etc.) passam direto.
 */
export async function resolveStorageDisplayUrl(
  url: string | null | undefined,
  expiresIn = 3600,
): Promise<string | null> {
  if (!url) return null;
  if (url.startsWith("data:")) return url;
  const parsed = parseSupabaseStorageUrl(url);
  if (!parsed) return url;
  const { data, error } = await supabase.storage
    .from(parsed.bucket)
    .createSignedUrl(parsed.path, expiresIn);
  if (error || !data?.signedUrl) {
    console.warn("[storageDisplayUrl] signed url fail:", error?.message);
    return url;
  }
  return data.signedUrl;
}
