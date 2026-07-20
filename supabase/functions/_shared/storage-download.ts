/**
 * Download de mídia no Supabase Storage.
 * Bucket `whatsapp-media` é PRIVADO — URL /object/public/ → HTTP 400.
 * Use sempre service role via supabase.storage.download(path).
 */

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

/** True se a URL/base64 parece arquivo resolvível (presença, não bytes). */
export function looksLikeFileRef(v: unknown): boolean {
  if (typeof v !== "string") return false;
  const s = v.trim();
  if (!s || s === "evolution-media:pending" || s === "collected" || s === "nao_aplicavel") {
    return false;
  }
  return s.startsWith("http") || s.startsWith("data:") || s.length > 200;
}

/**
 * Confirma que o arquivo é baixável AGORA (service role).
 * Evita avisar o cliente / despachar worker com URL pública morta.
 */
export async function assertStorageReadable(
  supabase: { storage: { from: (b: string) => { download: (p: string) => Promise<{ data: Blob | null; error: { message?: string } | null }> } } },
  url: string | null | undefined,
  label: string,
): Promise<{ ok: true } | { ok: false; label: string; reason: string }> {
  if (!url || !looksLikeFileRef(url)) {
    return { ok: false, label, reason: "ausente" };
  }
  if (String(url).startsWith("data:")) {
    return String(url).length > 200
      ? { ok: true }
      : { ok: false, label, reason: "data-url vazia" };
  }

  const parsed = parseSupabaseStorageUrl(String(url));
  if (parsed) {
    const { data, error } = await supabase.storage.from(parsed.bucket).download(parsed.path);
    if (error || !data) {
      return {
        ok: false,
        label,
        reason: error?.message || "storage.download falhou",
      };
    }
    const size = data.size ?? 0;
    if (size < 100) {
      return { ok: false, label, reason: "arquivo vazio" };
    }
    return { ok: true };
  }

  // MinIO / URL externa: HEAD/GET curto
  try {
    const r = await fetch(String(url), { method: "GET", signal: AbortSignal.timeout(15_000) });
    if (!r.ok) return { ok: false, label, reason: `HTTP ${r.status}` };
    const buf = await r.arrayBuffer();
    if (buf.byteLength < 100) return { ok: false, label, reason: "arquivo vazio" };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, label, reason: e?.message || "fetch falhou" };
  }
}

export type DocPreflightInput = {
  electricity_bill_photo_url?: string | null;
  electricity_boleto_photo_url?: string | null;
  bill_base64?: string | null;
  document_front_url?: string | null;
  document_front_base64?: string | null;
  document_back_url?: string | null;
  document_back_base64?: string | null;
  document_type?: string | null;
};

/**
 * Pré-voo dos anexos obrigatórios do Portal 2.
 * Conta (ou boleto fallback) + frente; verso se não for CNH.
 */
export async function preflightPortalDocuments(
  supabase: any,
  row: DocPreflightInput,
): Promise<{ ok: true } | { ok: false; missing: string[] }> {
  const isCnh =
    String(row.document_back_url || "") === "nao_aplicavel" ||
    String(row.document_type || "").toLowerCase().includes("cnh");

  const missing: string[] = [];

  const billOk =
    (looksLikeFileRef(row.bill_base64) && String(row.bill_base64).startsWith("data:")) ||
    (await assertStorageReadable(supabase, row.electricity_bill_photo_url, "conta de energia")).ok ||
    (await assertStorageReadable(supabase, row.electricity_boleto_photo_url, "boleto")).ok;
  if (!billOk) missing.push("conta de energia");

  const frontOk =
    (looksLikeFileRef(row.document_front_base64) && String(row.document_front_base64).startsWith("data:")) ||
    (await assertStorageReadable(supabase, row.document_front_url, "documento (frente)")).ok;
  if (!frontOk) missing.push("documento (frente)");

  if (!isCnh) {
    const backOk =
      (looksLikeFileRef(row.document_back_base64) && String(row.document_back_base64).startsWith("data:")) ||
      (await assertStorageReadable(supabase, row.document_back_url, "documento (verso)")).ok;
    if (!backOk) missing.push("documento (verso)");
  }

  return missing.length ? { ok: false, missing } : { ok: true };
}
