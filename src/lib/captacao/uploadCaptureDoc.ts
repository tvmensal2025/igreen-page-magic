import { supabase } from "@/integrations/supabase/client";
import { uploadMedia } from "@/services/minioUpload";
import { createLogger } from "@/lib/logger";

const logger = createLogger("uploadCaptureDoc");

export type CaptureDocSlot =
  | "document_front_url"
  | "document_back_url"
  | "electricity_bill_photo_url"
  | "electricity_boleto_photo_url";

const KIND_BY_SLOT: Record<CaptureDocSlot, string> = {
  document_front_url: "doc_frente",
  document_back_url: "doc_verso",
  electricity_bill_photo_url: "conta",
  electricity_boleto_photo_url: "boleto",
};

/**
 * Padrão do projeto: documento do cliente vai para o MinIO
 * (`documentos/{consultor}/{cliente}/`), igual ao que o bot já faz em
 * `_shared/media-storage.ts`. Só cai no Supabase Storage se o MinIO/edge
 * falhar — mesma rede de segurança do fluxo automático, sem perder anexo.
 */
export async function uploadCaptureDoc(opts: {
  customerId: string;
  slot: CaptureDocSlot;
  file: File | Blob;
  fileName?: string | null;
  ext?: string;
}): Promise<{ url: string; storage: "minio" | "supabase" }> {
  const { customerId, slot, file } = opts;
  const ext =
    opts.ext ||
    opts.fileName?.split(".").pop()?.toLowerCase() ||
    ((file as File).name?.split(".").pop()?.toLowerCase() ?? "jpg");
  const kind = KIND_BY_SLOT[slot];
  const name = opts.fileName || (file as File).name || `${kind}.${ext}`;

  const asFile =
    file instanceof File
      ? file
      : new File([file], name, { type: file.type || "application/octet-stream" });

  try {
    const res = await uploadMedia(asFile, undefined, {
      scope: "doc",
      customer_id: customerId,
      kind,
    });
    return { url: res.url, storage: res.storage === "supabase" ? "supabase" : "minio" };
  } catch (err) {
    logger.warn("MinIO/upload-media falhou, fallback Supabase Storage:", err);
  }

  // Fallback: caminho antigo (bucket privado whatsapp-media).
  const path = `captacao/${customerId}/${slot}-${Date.now()}.${ext}`;
  const { error: upErr } = await supabase.storage
    .from("whatsapp-media")
    .upload(path, asFile, { upsert: true, contentType: asFile.type || "application/octet-stream" });
  if (upErr) throw upErr;
  const { data: pub } = supabase.storage.from("whatsapp-media").getPublicUrl(path);
  return { url: pub.publicUrl, storage: "supabase" };
}
