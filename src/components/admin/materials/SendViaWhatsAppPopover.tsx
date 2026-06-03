import { useState } from "react";
import { Loader2, Send, Share2 } from "lucide-react";
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
  // Adiciona 55 se faltar
  return digits.startsWith("55") ? digits : `55${digits}`;
}

export function SendViaWhatsAppPopover({ item, consultantId }: Props) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState("");
  const [caption, setCaption] = useState(item.title);
  const [sending, setSending] = useState(false);

  const shareLink = `https://wa.me/?text=${encodeURIComponent(`${item.title}\n${item.url}`)}`;

  async function handleSend() {
    const norm = normalizePhone(phone);
    if (!norm) {
      toast({ title: "Telefone inválido", description: "Use DDD + número (ex: 11999998888)", variant: "destructive" });
      return;
    }
    if (!consultantId) {
      toast({ title: "Sessão não encontrada", description: "Faça login novamente", variant: "destructive" });
      return;
    }
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("admin-send-material", {
        body: {
          phone: norm,
          mediaUrl: item.url,
          caption: caption.trim().slice(0, 500),
          mediatype: item.type === "video" ? "video" : "image",
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast({ title: "Enviado ✅", description: `Mídia enviada pra ${norm}` });
      setOpen(false);
      setPhone("");
    } catch (e: any) {
      toast({ title: "Falha no envio", description: e?.message || "Tente novamente", variant: "destructive" });
    } finally {
      setSending(false);
    }
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
          <Button type="button" size="sm" className="w-full gap-1.5" disabled={sending || !phone} onClick={handleSend}>
            {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            Enviar agora
          </Button>
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
