import { useState } from "react";
import { Send, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import type { MaterialItem } from "@/lib/materialsCatalog";

interface Props {
  item: MaterialItem;
  consultantId: string | null;
}

function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 13) return null;
  return digits.startsWith("55") ? digits : `55${digits}`;
}

function formatPhoneDisplay(digits: string): string {
  const d = digits.replace(/\D/g, "");
  const local = d.startsWith("55") && d.length >= 12 ? d.slice(2) : d;
  if (local.length === 11) {
    return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
  }
  if (local.length === 10) {
    return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
  }
  return digits;
}

function absolutizeMediaUrl(url: string): string {
  if (/^https?:\/\//.test(url)) return url;
  if (typeof window !== "undefined") {
    return `${window.location.origin}${url.startsWith("/") ? url : `/${url}`}`;
  }
  return url;
}

function formatSendError(data: Record<string, unknown> | null | undefined): string {
  if (!data?.error) return "Tente novamente";
  const parts = [String(data.error)];
  if (data.detail) parts.push(String(data.detail));
  if (data.hint) parts.push(String(data.hint));
  return parts.join(" — ");
}

async function sendMaterialInBackground(params: {
  phone: string;
  item: MaterialItem;
  caption: string;
  onSuccess: () => void;
  onError: (message: string) => void;
}) {
  try {
    const { data, error } = await supabase.functions.invoke("admin-send-material", {
      body: {
        phone: params.phone,
        mediaUrl: absolutizeMediaUrl(params.item.url),
        caption: params.caption.trim().slice(0, 500),
        mediatype: params.item.type === "video" ? "video" : "image",
      },
    });
    if (error) throw error;
    if (data?.error) throw new Error(formatSendError(data));
    params.onSuccess();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Tente novamente";
    params.onError(msg);
  }
}

export function SendViaWhatsAppPopover({ item, consultantId }: Props) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState("");
  const [caption, setCaption] = useState(item.title);

  const shareLink = `https://wa.me/?text=${encodeURIComponent(`${item.title}\n${item.url}`)}`;

  function handleSend() {
    const norm = normalizePhone(phone);
    if (!norm) {
      toast({ title: "Telefone inválido", description: "Use DDD + número (ex: 11999998888)", variant: "destructive" });
      return;
    }
    if (!consultantId) {
      toast({ title: "Sessão não encontrada", description: "Faça login novamente", variant: "destructive" });
      return;
    }

    const phoneLabel = formatPhoneDisplay(norm);
    const title = item.title;

    setOpen(false);
    setPhone("");

    toast({
      title: "Enviando em segundo plano",
      description: `"${title}" para ${phoneLabel}. Pode continuar navegando — avisamos quando chegar.`,
    });

    void sendMaterialInBackground({
      phone: norm,
      item,
      caption,
      onSuccess: () => {
        toast({
          title: "Enviado ✅",
          description: `"${title}" entregue para ${phoneLabel}`,
        });
      },
      onError: (message) => {
        toast({
          title: "Falha no envio",
          description: `"${title}" → ${phoneLabel}: ${message}`,
          variant: "destructive",
        });
      },
    });
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" size="sm" variant="outline" className="flex-1 gap-1.5">
          <Send className="w-3.5 h-3.5" />
          WhatsApp
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-3 space-y-3" align="end">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-foreground">Enviar pela minha instância</label>
          <Input
            type="tel"
            placeholder="DDD + número (ex: 11999998888)"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            maxLength={20}
          />
          <Input
            type="text"
            placeholder="Legenda (opcional)"
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            maxLength={500}
          />
          <Button type="button" size="sm" className="w-full gap-1.5" disabled={!phone} onClick={handleSend}>
            <Send className="w-3.5 h-3.5" />
            Enviar agora
          </Button>
          <p className="text-[10px] text-muted-foreground leading-snug">
            Vídeos grandes podem levar alguns minutos. O envio continua mesmo se você fechar este painel.
          </p>
        </div>
        <div className="border-t pt-2">
          <a
            href={shareLink}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-1.5 text-xs text-primary hover:underline"
          >
            <Share2 className="w-3.5 h-3.5" />
            Ou compartilhar via wa.me (escolher contato)
          </a>
        </div>
      </PopoverContent>
    </Popover>
  );
}
