/**
 * Extrai URL pública de mídia gravada no texto da conversa (padrão Evolution/MinIO):
 * `[image] https://...`
 */
export function parseConversationEmbeddedMediaUrl(
  messageText: string | null | undefined,
): { kind: string; url: string } | null {
  const m = String(messageText || "").match(
    /^\[(image|document|video|audio|sticker)\]\s+(https?:\/\/\S+)/i,
  );
  if (!m?.[1] || !m?.[2]) return null;
  return { kind: m[1].toLowerCase(), url: m[2] };
}

/** Preferência de URL durável para last_inbound (Whapi): http > data. */
export function preferDurableMediaUrl(opts: {
  httpUrl?: string | null;
  dataOrOther?: string | null;
}): string | null {
  const http = opts.httpUrl && String(opts.httpUrl).startsWith("http") ? String(opts.httpUrl) : null;
  if (http) return http;
  const other = opts.dataOrOther ? String(opts.dataOrOther) : null;
  if (other && (other.startsWith("http") || other.startsWith("data:"))) return other;
  return null;
}
