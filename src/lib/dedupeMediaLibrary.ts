/**
 * Dedupe visual da biblioteca de mídia (ai_media_library).
 * Várias rows com o mesmo título (reuploads) → mostra só a mais leve.
 */

export function mediaLibraryByteSize(m: {
  final_size_bytes?: number | null;
  original_size_bytes?: number | null;
}): number {
  const f = m.final_size_bytes;
  const o = m.original_size_bytes;
  if (typeof f === "number" && f > 0) return f;
  if (typeof o === "number" && o > 0) return o;
  return Number.MAX_SAFE_INTEGER;
}

export function normalizeMediaLibraryLabel(label: string | null | undefined): string {
  return String(label || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function libraryDedupeKey(m: {
  id: string;
  label?: string | null;
  url?: string | null;
}): string {
  const byLabel = normalizeMediaLibraryLabel(m.label);
  if (byLabel) return `label:${byLabel}`;
  const url = String(m.url || "").split("?")[0].trim();
  if (url) return `url:${url}`;
  return `id:${m.id}`;
}

/**
 * Uma entrada por título (ou URL); em empate de conteúdo, fica a mais leve
 * (`final_size_bytes` → `original_size_bytes`). Ordem relativa do array original
 * é preservada entre os vencedores.
 */
export function dedupeMediaLibraryPreferLightest<
  T extends {
    id: string;
    label?: string | null;
    url?: string | null;
    final_size_bytes?: number | null;
    original_size_bytes?: number | null;
  },
>(items: T[]): T[] {
  const best = new Map<string, T>();
  for (const m of items) {
    const key = libraryDedupeKey(m);
    const prev = best.get(key);
    if (!prev || mediaLibraryByteSize(m) < mediaLibraryByteSize(prev)) {
      best.set(key, m);
    }
  }
  const seen = new Set<string>();
  const out: T[] = [];
  for (const m of items) {
    const key = libraryDedupeKey(m);
    if (best.get(key) !== m || seen.has(key)) continue;
    seen.add(key);
    out.push(m);
  }
  return out;
}
