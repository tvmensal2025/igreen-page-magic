import { useRef, useState, useCallback } from "react";
import { Image, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { uploadMedia } from "@/services/minioUpload";
import { toast } from "sonner";

interface Props {
  templateId: string;
  onUpdateTemplate: (id: string, updates: { image_url?: string | null }) => Promise<void>;
}

export function AddImageToTemplate({ templateId, onUpdateTemplate }: Props) {
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const result = await uploadMedia(file, undefined, { scope: "template", kind: file.type.startsWith("image/") ? "image" : "audio" });
      await onUpdateTemplate(templateId, { image_url: result.url });
      toast.success("Imagem adicionada ao template!");
    } catch {
      toast.error("Erro ao enviar imagem");
    } finally {
      setUploading(false);
    }
  }, [templateId, onUpdateTemplate]);

  return (
    <div className="mt-2">
      <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={handleUpload} className="hidden" />
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="h-6 text-[10px] gap-1 border-dashed border-info/30 text-info hover:bg-info/10"
      >
        {uploading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Image className="w-3 h-3" />}
        {uploading ? "Enviando..." : "Adicionar imagem"}
      </Button>
    </div>
  );
}