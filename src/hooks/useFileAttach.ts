import { useState, useRef, useCallback } from "react";
import { uploadMedia, formatFileSize } from "@/services/minioUpload";
import { toast } from "sonner";
import { createLogger } from "@/lib/logger";

const logger = createLogger("useFileAttach");

type MediaType = "image" | "video" | "document" | "sticker";

export interface AttachedFile {
  url: string;
  name: string;
  type: MediaType | "audio";
}

export interface FileAttachContext {
  consultantId?: string;
  customerJid?: string;
  customerName?: string;
}

export function useFileAttach(context?: FileAttachContext) {
  const [attachedFile, setAttachedFile] = useState<AttachedFile | null>(null);
  const [pendingImageUrl, setPendingImageUrl] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 100 * 1024 * 1024) { toast.error("Arquivo muito grande (máximo 100MB)"); return; }

    setIsUploading(true);
    setUploadProgress(0);
    try {
      if (file.type === "audio/webm" || /\.webm$/i.test(file.name)) {
        toast.error("WhatsApp/Whapi não aceita áudio .webm. Use .ogg, .mp3 ou .m4a.");
        return;
      }
      const inferKind = (mime: string, name: string) => {
        if (mime === "image/webp" || /\.webp$/i.test(name)) return "sticker";
        if (mime.startsWith("image/")) return "image";
        if (mime.startsWith("audio/")) return "audio";
        if (mime.startsWith("video/")) return "video";
        return "document";
      };
      const result = await uploadMedia(file, (pct) => setUploadProgress(pct), {
        scope: "chat",
        consultant_id: context?.consultantId,
        customer_jid: context?.customerJid,
        customer_name: context?.customerName,
        kind: inferKind(file.type, file.name),
      });
      if (attachedFile?.type === "audio" && file.type.startsWith("image/") && file.type !== "image/webp") {
        setPendingImageUrl(result.url);
        toast.success("Imagem anexada: será enviada depois do áudio");
      } else {
        let fileType: MediaType | "audio" = "document";
        if (file.type === "image/webp" || /\.webp$/i.test(file.name)) fileType = "sticker";
        else if (file.type.startsWith("image/")) fileType = "image";
        else if (file.type.startsWith("audio/")) fileType = "audio";
        else if (file.type.startsWith("video/")) fileType = "video";
        setAttachedFile({ url: result.url, name: file.name, type: fileType });
        toast.success(
          fileType === "sticker"
            ? `Sticker anexado: ${formatFileSize(result.size)}`
            : `Arquivo anexado: ${formatFileSize(result.size)}`,
        );
      }
    } catch (err: unknown) {
      logger.error("Erro no upload:", err);
      toast.error(`Erro no upload: ${err instanceof Error ? err.message : "Falha desconhecida"}`, { duration: 8000 });
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, [attachedFile, context?.consultantId, context?.customerJid, context?.customerName]);

  const clearAttachment = useCallback(() => { setAttachedFile(null); setPendingImageUrl(null); }, []);

  return { attachedFile, setAttachedFile, pendingImageUrl, setPendingImageUrl, isUploading, uploadProgress, fileInputRef, handleFileSelect, clearAttachment };
}
