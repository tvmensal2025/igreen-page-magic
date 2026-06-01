import { useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

export type CaptureDocKey =
  | "document_front_url"
  | "document_back_url"
  | "electricity_bill_photo_url";

const LABELS: Record<CaptureDocKey, string> = {
  document_front_url: "RG/CNH Frente",
  document_back_url: "RG/CNH Verso",
  electricity_bill_photo_url: "Conta de Energia",
};

async function urlToBlob(url: string): Promise<{ blob: Blob; ext: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Falha ao baixar mídia (${res.status})`);
  const blob = await res.blob();
  const mime = blob.type || "";
  let ext = "bin";
  if (mime.includes("pdf")) ext = "pdf";
  else if (mime.includes("png")) ext = "png";
  else if (mime.includes("jpeg") || mime.includes("jpg")) ext = "jpg";
  else if (mime.includes("webp")) ext = "webp";
  else {
    const m = url.split("?")[0].match(/\.([a-zA-Z0-9]{2,5})$/);
    if (m) ext = m[1].toLowerCase();
  }
  return { blob, ext };
}

export function useCaptureAttach() {
  const { toast } = useToast();

  const attachMediaToCapture = useCallback(
    async (opts: {
      customerId: string;
      key: CaptureDocKey;
      sourceUrl: string;
      fileName?: string | null;
    }) => {
      const { customerId, key, sourceUrl, fileName } = opts;
      const label = LABELS[key];
      try {
        const { blob, ext: detected } = await urlToBlob(sourceUrl);
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
          description: "Extraindo dados…",
          duration: 2000,
        });

        const kind = key === "electricity_bill_photo_url" ? "bill" : "doc";
        void supabase.functions
          .invoke("reprocess-capture", { body: { customerId, kind } })
          .catch((e) => console.warn("[reprocess-capture] falhou", e));

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
      const kind = key === "electricity_bill_photo_url" ? "bill" : "doc";
      try {
        const { error } = await supabase.functions.invoke("reprocess-capture", {
          body: { customerId, kind },
        });
        if (error) throw error;
        toast({ title: "🤖 Extraindo dados…", duration: 1500 });
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
