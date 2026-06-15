import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/use-toast";
import { Loader2, Send, RotateCcw, Bot, User as UserIcon, FlaskConical } from "lucide-react";

const TEST_LEAD_ID = "11111111-1111-1111-1111-111111111111";

interface Msg {
  role: "user" | "assistant";
  text: string;
  acoes?: string[];
  rag?: { source: string; confidence: number } | null;
  modelUsed?: string;
}

interface Props {
  consultantId: string;
}

export default function SimulatorPanel({ consultantId }: Props) {
  const { toast } = useToast();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs]);

  async function send() {
    const text = input.trim();
    if (!text || sending) return;
    // Histórico local que a IA vai ver — inclui só user/assistant trocados ATÉ AGORA
    // (sem a msg nova). Em dryRun a edge não grava em `conversations`, então
    // precisamos mandar o histórico junto, senão a IA esquece a cada turno.
    const clientHistory = msgs.map((m) => ({ role: m.role, content: m.text }));
    setMsgs((m) => [...m, { role: "user", text }]);
    setInput("");
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("fluxo-b-ai", {
        body: {
          customerId: TEST_LEAD_ID,
          consultantId,
          inboundText: text,
          inboundKind: "text",
          dryRun: true,
          clientHistory,
        },
      });
      if (error) throw error;
      const replyText = (data?.sent && data.sent[0]) || data?.texto;
      if (!replyText) {
        toast({
          title: "IA não respondeu",
          description: "Verifique os logs da função fluxo-b-ai. Pode ser modelo indisponível, persona vazia, ou créditos esgotados.",
          variant: "destructive",
        });
        return;
      }
      setMsgs((m) => [...m, {
        role: "assistant",
        text: replyText,
        acoes: data?.acoes || [],
        rag: data?.rag || null,
        modelUsed: data?.modelUsed,
      }]);
    } catch (e: any) {
      toast({ title: "Erro no simulador", description: e?.message || String(e), variant: "destructive" });
    } finally {
      setSending(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }


  async function reset() {
    // limpa histórico de conversations do lead de teste para começar do zero
    setMsgs([]);
    try {
      await supabase.from("conversations").delete().eq("customer_id", TEST_LEAD_ID);
      await supabase.from("customers").update({
        bill_requested_at: null,
        bot_paused: false,
        bot_paused_at: null,
        bot_paused_reason: null,
        electricity_bill_photo_url: null,
        sales_phase: null,
      }).eq("id", TEST_LEAD_ID);
      toast({ title: "Conversa de teste resetada" });
    } catch (e: any) {
      toast({ title: "Erro ao resetar", description: e?.message, variant: "destructive" });
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2"><FlaskConical className="w-5 h-5 text-primary" />Simulador</CardTitle>
            <CardDescription>
              Converse com a IA usando o lead de teste. Roda em <code className="mx-1 px-1 bg-muted rounded text-xs">dryRun</code> — não envia WhatsApp e não fecha cadastro.
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={reset}>
            <RotateCcw className="w-4 h-4 mr-1" />Resetar
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="border rounded-md bg-muted/30 p-3 h-[420px] overflow-y-auto space-y-3">
          {msgs.length === 0 && (
            <div className="text-center text-sm text-muted-foreground py-12">
              Mande um "oi" pra começar.
            </div>
          )}
          {msgs.map((m, i) => (
            <div key={i} className={`flex gap-2 ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              {m.role === "assistant" && <Bot className="w-5 h-5 mt-1 text-primary shrink-0" />}
              <div className={`max-w-[75%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
                m.role === "user" ? "bg-primary text-primary-foreground" : "bg-background border"
              }`}>
                {m.text}
                {m.role === "assistant" && (m.acoes?.length || m.rag || m.modelUsed) && (
                  <div className="mt-2 pt-2 border-t border-border/40 flex flex-wrap gap-1">
                    {m.acoes?.map((a) => (
                      <Badge key={a} variant="secondary" className="text-[10px]">{a}</Badge>
                    ))}
                    {m.rag && (
                      <Badge variant="outline" className="text-[10px]">
                        RAG: {m.rag.source} ({(m.rag.confidence * 100).toFixed(0)}%)
                      </Badge>
                    )}
                    {m.modelUsed && (
                      <Badge variant="outline" className="text-[10px]">{m.modelUsed}</Badge>
                    )}
                  </div>
                )}
              </div>
              {m.role === "user" && <UserIcon className="w-5 h-5 mt-1 shrink-0" />}
            </div>
          ))}
          {sending && (
            <div className="flex gap-2 items-center text-sm text-muted-foreground">
              <Bot className="w-5 h-5 text-primary" />
              <Loader2 className="w-3 h-3 animate-spin" /> pensando...
            </div>
          )}
          <div ref={bottomRef} />
        </div>
        <div className="flex gap-2">
          <Input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") send(); }}
            placeholder="Digite como se fosse o cliente..."
            disabled={sending}
          />
          <Button onClick={send} disabled={sending || !input.trim()}>
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
