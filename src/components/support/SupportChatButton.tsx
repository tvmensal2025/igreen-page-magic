import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { Sparkles, Send, Loader2, MessageCircleQuestion } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface Msg { role: "user" | "assistant"; content: string }

const SUGGESTIONS = [
  "Por que minha campanha foi reprovada?",
  "Como migro pro WhatsApp Business?",
  "Meu saldo está baixo, o que faço?",
  "Como melhorar o CPL?",
];

interface SupportChatButtonProps {
  /** Classes extras no FAB (ex.: ocultar na aba Produtos mobile). */
  className?: string;
}

export function SupportChatButton({ className }: SupportChatButtonProps = {}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([
    { role: "assistant", content: "Oi! Sou o Suporte iGreen com IA. Posso ver seus dados (saldo, campanhas, conexão Facebook) e te ajudar agora. O que você precisa?" },
  ]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }); }, [msgs, sending]);

  async function send(text: string) {
    const txt = text.trim();
    if (!txt || sending) return;
    const next: Msg[] = [...msgs, { role: "user", content: txt }];
    setMsgs(next);
    setInput("");
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("support-chat", {
        body: { messages: next },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setMsgs([...next, { role: "assistant", content: data?.reply || "Sem resposta." }]);
    } catch (e: any) {
      toast({ title: "Suporte indisponível", description: e?.message || "Tente novamente em instantes", variant: "destructive" });
      setMsgs(next);
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        size="lg"
        aria-label="Pedir ajuda ao suporte iGreen"
        className={`fixed bottom-20 sm:bottom-5 right-4 sm:right-5 z-[90] min-h-[48px] min-w-[48px] rounded-full shadow-lg gap-2 bg-primary hover:bg-primary/90 ${className ?? ""}`}
      >
        <MessageCircleQuestion className="w-5 h-5 shrink-0" />
        <span className="hidden sm:inline">Pedir ajuda</span>
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="flex flex-col p-0 w-full sm:max-w-md">
          <SheetHeader className="px-4 pt-4 pb-2 border-b">
            <SheetTitle className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" /> Suporte iGreen com IA
            </SheetTitle>
            <p className="text-[11px] text-muted-foreground">Vê seus dados em tempo real e responde no contexto da sua operação.</p>
          </SheetHeader>

          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            {msgs.map((m, i) => (
              <div key={i} className={`text-sm whitespace-pre-line rounded-lg px-3 py-2 ${m.role === "user" ? "bg-primary text-primary-foreground ml-8" : "bg-muted mr-8"}`}>
                {m.content}
              </div>
            ))}
            {sending && (
              <div className="bg-muted mr-8 rounded-lg px-3 py-2 text-sm flex items-center gap-2 text-muted-foreground">
                <Loader2 className="w-3 h-3 animate-spin" /> Pensando...
              </div>
            )}
            {msgs.length <= 1 && !sending && (
              <div className="space-y-1.5 pt-2">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Sugestões</div>
                {SUGGESTIONS.map((s) => (
                  <button key={s} onClick={() => send(s)}
                    className="w-full text-left text-xs px-3 py-2 rounded border hover:bg-primary/10 transition">
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="p-3 border-t bg-card flex gap-2 items-end">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }}
              placeholder="Pergunte qualquer coisa..."
              rows={1}
              className="resize-none min-h-[40px] max-h-32"
              disabled={sending}
            />
            <Button size="icon" onClick={() => send(input)} disabled={sending || !input.trim()}>
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}