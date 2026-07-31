// ─── Unified Media Upload (MinIO → Supabase Storage fallback) ────────
// Estratégia de zero-falha: tenta MinIO com timeout curto; se falhar,
// faz fallback transparente para Supabase Storage (bucket whatsapp-media).
// Garante SEMPRE retornar uma URL pública curta — nunca data URL gigante.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { uploadBytesToMinio, base64ToBytes, MinioUploadInput } from "./minio-upload.ts";

const MINIO_TIMEOUT_MS = 5_000; // 5s — se MinIO está offline, nem espera

function normalizeName(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .replace(/_+/g, "_")
    .toLowerCase();
}

function extFromMime(mime: string): string {
  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/heic": "heic",
    "image/heif": "heif",
    "application/pdf": "pdf",
  };
  return map[mime?.toLowerCase()] || "bin";
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timeout (${ms}ms)`)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

export interface UnifiedUploadInput {
  fileBase64: string;
  mimeType: string;
  consultantFolder: string;
  consultantName?: string;
  customerName: string;
  customerBirth?: string | null;
  kind: "conta" | "doc_frente" | "doc_verso";
}

export interface UnifiedUploadResult {
  url: string;
  storage: "minio" | "supabase";
}

/**
 * Tenta MinIO primeiro (com timeout 8s). Se falhar, faz fallback para
 * Supabase Storage (bucket whatsapp-media, público). Retorna sempre uma URL.
 * Lança erro APENAS se ambos falharem (improvável — Supabase Storage é interno).
 */
export async function uploadMediaUnified(
  opts: UnifiedUploadInput,
): Promise<UnifiedUploadResult> {
  const bytes = base64ToBytes(opts.fileBase64);
  const contentType = opts.mimeType || "application/octet-stream";

  // 1) Tenta MinIO com timeout curto
  try {
    const result = await withTimeout(
      uploadBytesToMinio({
        bytes,
        contentType,
        consultantFolder: opts.consultantFolder,
        consultantName: opts.consultantName,
        customerName: opts.customerName,
        customerBirth: opts.customerBirth,
        kind: opts.kind,
      } as MinioUploadInput),
      MINIO_TIMEOUT_MS,
      "MinIO",
    );
    console.log(`📦✅ MinIO OK [${opts.kind}]: ${result.url}`);
    return { url: result.url, storage: "minio" };
  } catch (err: any) {
    console.warn(`📦⚠️  MinIO falhou [${opts.kind}] (${err?.message || err}) — fallback Supabase Storage`);
  }

  // 2) Fallback: Supabase Storage (bucket whatsapp-media é público)
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const fullName = (opts.customerName || "cliente").trim();
  const parts = fullName.split(/\s+/);
  const first = normalizeName(parts[0] || "cliente");
  const last = normalizeName(parts[parts.length - 1] || "x");
  let dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  if (opts.customerBirth) {
    const m = opts.customerBirth.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    if (m) dateStr = `${m[3]}${m[2]}${m[1]}`;
  }
  const ext = extFromMime(contentType);
  const consultantId = normalizeName(opts.consultantFolder || "sem_consultor");
  const consultantNameNorm = normalizeName(opts.consultantName || "");
  const consultantSlug = consultantNameNorm ? `${consultantId}_${consultantNameNorm}` : consultantId;
  const customerSlug = `${first}_${last}_${dateStr}`;
  const folder = `documentos/${consultantSlug}/${customerSlug}`;
  const objectKey = `${folder}/${opts.kind}_${Date.now()}.${ext}`;

  const { error: upErr } = await supabase.storage
    .from("whatsapp-media")
    .upload(objectKey, bytes, {
      contentType,
      upsert: true,
      cacheControl: "31536000",
    });

  if (upErr) {
    console.error(`📦❌ Supabase Storage também falhou [${opts.kind}]:`, upErr.message);
    throw new Error(`Both MinIO and Supabase Storage failed: ${upErr.message}`);
  }

  // O bucket `whatsapp-media` é PRIVADO: `getPublicUrl` devolveria uma URL que
  // responde 400 para o provedor (Whapi/Evolution) na hora de baixar a mídia.
  // Usamos URL assinada de longa duração (1 ano) para o fallback funcionar.
  const { data: signed, error: signErr } = await supabase.storage
    .from("whatsapp-media")
    .createSignedUrl(objectKey, 60 * 60 * 24 * 365);

  if (signErr || !signed?.signedUrl) {
    console.error(`📦❌ Falha ao assinar URL [${opts.kind}]:`, signErr?.message);
    throw new Error(`Supabase Storage signed URL failed: ${signErr?.message || "sem URL"}`);
  }

  console.log(`📦✅ Supabase Storage OK [${opts.kind}]: ${objectKey}`);
  return { url: signed.signedUrl, storage: "supabase" };
}

