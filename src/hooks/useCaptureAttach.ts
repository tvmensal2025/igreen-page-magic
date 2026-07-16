import { useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { whapiDownloadMedia } from "@/services/whapiApi";

export type CaptureDocKey =
  | "document_front_url"
  | "document_back_url"
  | "electricity_bill_photo_url"
  | "electricity_boleto_photo_url";

const LABELS: Record<CaptureDocKey, string> = {
  document_front_url: "RG/CNH Frente",
  document_back_url: "RG/CNH Verso",
  electricity_bill_photo_url: "Conta de Energia",
  electricity_boleto_photo_url: "Boleto Bancário",
};

function mimeToExt(mime: string, fallbackUrl = ""): string {
  if (mime.includes("pdf")) return "pdf";
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  const m = fallbackUrl.split("?")[0].match(/\.([a-zA-Z0-9]{2,5})$/);
  return m ? m[1].toLowerCase() : "bin";
}

function dataUrlToBlob(dataUrl: string): { blob: Blob; ext: string } {
  const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) throw new Error("Data URL inválida");
  const mime = m[1] || "application/octet-stream";
  const binary = atob(m[2]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { blob: new Blob([bytes], { type: mime }), ext: mimeToExt(mime) };
}

/** CDN WhatsApp / Wasabi bloqueiam fetch do browser (CORS/403) — usar proxy. */
function needsMediaProxy(url: string): boolean {
  if (!url || url.startsWith("data:")) return false;
  if (url.includes("supabase.co/storage/")) return false;
  return /^https?:\/\//i.test(url);
}

async function resolveToBlob(
  sourceUrl: string,
  mediaId?: string | null,
): Promise<{ blob: Blob; ext: string }> {
  if (sourceUrl.startsWith("data:")) return dataUrlToBlob(sourceUrl);

  // Proxy Whapi evita CORS do Wasabi / CDN WhatsApp.
  if (needsMediaProxy(sourceUrl) || mediaId) {
    const dl = await whapiDownloadMedia({
      url: needsMediaProxy(sourceUrl) ? sourceUrl : "",
      mediaId: mediaId || "",
    });
    if (dl?.base64) {
      const mime = dl.mimetype || "application/octet-stream";
      return dataUrlToBlob(`data:${mime};base64,${dl.base64}`);
    }
    // Fallback: tenta fetch só se for storage nosso (sem CORS).
    if (!needsMediaProxy(sourceUrl)) {
      const res = await fetch(sourceUrl);
      if (!res.ok) throw new Error(`Falha ao baixar mídia (${res.status})`);
      const blob = await res.blob();
      return { blob, ext: mimeToExt(blob.type || "", sourceUrl) };
    }
    throw new Error("Não consegui baixar a mídia (proxy). Tente de novo.");
  }

  const res = await fetch(sourceUrl);
  if (!res.ok) throw new Error(`Falha ao baixar mídia (${res.status})`);
  const blob = await res.blob();
  return { blob, ext: mimeToExt(blob.type || "", sourceUrl) };
}

export function useCaptureAttach() {
  const { toast } = useToast();

  const attachMediaToCapture = useCallback(
    async (opts: {
      customerId: string;
      key: CaptureDocKey;
      sourceUrl: string;
      fileName?: string | null;
      mediaId?: string | null;
    }) => {
      const { customerId, key, sourceUrl, fileName, mediaId } = opts;
      const label = LABELS[key];
      try {
        const { blob, ext: detected } = await resolveToBlob(sourceUrl, mediaId);
        const nameExt = fileName?.split(".").pop()?.toLowerCase();
        const ext = nameExt && nameExt.length <= 5 ? nameExt : detected;

        const path = `captacao/${customerId}/${key}-${Date.now()}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from("whatsapp-media")
          .upload(path, blob, {
            upsert: true,
            contentType: blob.type || "application/octet-stream",
          });
        if (upErr) throw upErr;

        const { data: pub } = supabase.storage
          .from("whatsapp-media")
          .getPublicUrl(path);

        const { error: updErr } = await supabase
          .from("customers")
          .update({ [key]: pub.publicUrl } as any)
          .eq("id", customerId);
        if (updErr) throw updErr;

        toast({
          title: `📎 Anexado como ${label}`,
          description: key === "electricity_boleto_photo_url" ? undefined : "Extraindo dados…",
          duration: 2000,
        });

        try {
          window.dispatchEvent(
            new CustomEvent("captacao:docs-updated", { detail: { customerId, key } }),
          );
        } catch { /* ignore */ }

        // Boleto bancário só anexa — sem OCR de conta/documento.
        if (key !== "electricity_boleto_photo_url") {
          const kind = key === "electricity_bill_photo_url" ? "bill" : "doc";
          try {
            const { data, error } = await supabase.functions.invoke("reprocess-capture", {
              body: { customerId, kind },
            });
            if (error) throw error;
            if (data && data.ok === false) {
              toast({
                title: "Não consegui ler o documento",
                description: String(data.detail || data.error || "falha").slice(0, 120),
                variant: "destructive",
                duration: 3500,
              });
            } else {
              toast({ title: "🤖 Dados preenchidos na ficha", duration: 2200 });
            }
            try {
              window.dispatchEvent(
                new CustomEvent("captacao:docs-updated", { detail: { customerId, key } }),
              );
            } catch { /* ignore */ }
          } catch (e: any) {
            console.warn("[reprocess-capture] falhou", e);
            toast({
              title: "OCR falhou",
              description: e?.message || "Tente de novo",
              variant: "destructive",
            });
          }
        }

        return pub.publicUrl;
      } catch (e: any) {
        toast({
          title: "Erro ao anexar",
          description: e?.message || String(e),
          variant: "destructive",
        });
        throw e;
      }
    },
    [toast]
  );

  const reextract = useCallback(
    async (customerId: string, key: CaptureDocKey) => {
      if (key === "electricity_boleto_photo_url") {
        toast({ title: "Boleto não tem OCR", description: "Só anexa na ficha", duration: 2000 });
        return;
      }
      const kind = key === "electricity_bill_photo_url" ? "bill" : "doc";
      try {
        const { data, error } = await supabase.functions.invoke("reprocess-capture", {
          body: { customerId, kind },
        });
        if (error) throw error;
        if (data && data.ok === false) {
          toast({
            title: "Não consegui ler o documento",
            description: String(data.detail || data.error || "falha").slice(0, 120),
            variant: "destructive",
          });
          return;
        }
        toast({ title: "🤖 Dados preenchidos na ficha", duration: 2200 });
      } catch (e: any) {
        toast({
          title: "Erro ao extrair",
          description: e?.message || String(e),
          variant: "destructive",
        });
      }
    },
    [toast]
  );

  return { attachMediaToCapture, reextract };
}
