import { useState } from "react";
import { Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

interface Props {
  audioUrl: string;
  label?: string;
  trigger?: React.ReactNode;
  size?: "sm" | "default";
  className?: string;
}

function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 13) return null;
  return digits.startsWith("55") ? digits : `55${digits}`;
}

export function AudioWhatsAppPopover({ audioUrl, label, trigger, size = "sm", className }: Props) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState("");
  const [sending, setSending] = useState(false);

  async function handleSend() {
    const norm = normalizePhone(phone);
    if (!norm) {
      toast({ title: "Telefone inválido", description: "Use DDD + número (ex: 11999998888)", variant: "destructive" });
      return;
    }
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("admin-send-material", {
        body: { phone: norm, mediaUrl: audioUrl, mediatype: "audio", caption: label || "Áudio iGreen" },
      });
      if (error) throw error;
      const d = data as any;
      if (d?.error) {
        const detail = d.detail ? ` — ${d.detail}` : "";
        const hint = d.hint ? `\n${d.hint}` : "";
        throw new Error(`${d.error}${detail}${hint}`);
      }
      toast({ title: "Áudio enviado ✅", description: `Enviado pra ${norm}` });
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
        {trigger ?? (
          <Button type="button" size={size} variant="outline" className={className ?? "flex-1 gap-1.5"}>
            <Send className="w-3.5 h-3.5" />
            WhatsApp
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-72 p-3 space-y-2" align="end">
        <p className="text-xs font-medium text-foreground">Enviar áudio pela minha instância</p>
        <Input
          type="tel"
          placeholder="DDD + número (ex: 11999998888)"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          maxLength={20}
          autoFocus
        />
        <Button type="button" size="sm" className="w-full gap-1.5" disabled={sending || !phone} onClick={handleSend}>
          {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
          Enviar agora
        </Button>
        <p className="text-[10px] text-muted-foreground">Será entregue como mensagem de voz (PTT).</p>
      </PopoverContent>
    </Popover>
  );
}
