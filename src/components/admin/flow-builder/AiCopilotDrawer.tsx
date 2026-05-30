// Drawer lateral do copiloto de IA pro fluxo. Mantém histórico de chat
// em memória (não persiste), envia snapshot completo do fluxo a cada
// pergunta via edge function `flow-copilot`.
import { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Send, Loader2, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { Step } from "./flowTypes";
import { getButtons, resolveGotoLabel } from "./flowTypes";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  flowId: string | null;
  steps: Step[];
}

interface ChatMsg {
  role: "user" | "assistant";
  content: string;
}

const SUGGESTIONS = [
  "Revisa o fluxo todo e me diz o que tá ruim",
  "Tem alguma regra quebrada ou loop?",
  "Como melhorar a taxa de conversão até o cadastro?",
  "O passo 1 tá muito formal, sugere alternativa",
];

export default function AiCopilotDrawer({ open, onOpenChange, flowId, steps }: Props) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || loading || !flowId) return;
    const next: ChatMsg[] = [...messages, { role: "user", content: trimmed }];
    setMessages(next);
    setInput("");
    setLoading(true);
    try {
      const snapshot = steps.map((s) => ({
        id: s.id,
        position: s.position,
        title: s.title,
        step_type: s.step_type,
        message_text: s.message_text,
        is_active: s.is_active,
        buttons: getButtons(s),
        rules: s.transitions
          .filter((t) => t.trigger_intent !== "default")
          .map((t) => {
            const r = resolveGotoLabel(steps, t);
            return { intent: t.trigger_intent || "(sem)", goto: r.label };
          }),
      }));
      const { data, error } = await supabase.functions.invoke("flow-copilot", {
        body: { flowId, steps: snapshot, messages: next },
      });
      if (error) throw error;
      const reply = (data as { reply?: string })?.reply;
      if (!reply) throw new Error("resposta vazia");
      setMessages((m) => [...m, { role: "assistant", content: reply }]);
    } catch (e) {
      console.error("[AiCopilot] erro", e);
      toast({
        title: "Copiloto falhou",
        description: e instanceof Error ? e.message : "Tente novamente",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col p-0 sm:max-w-[480px]">
        <SheetHeader className="border-b p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="rounded-md bg-purple-500/10 p-1.5">
                <Sparkles className="h-4 w-4 text-purple-500" />
              </div>
              <div>
                <SheetTitle className="text-base">Copiloto de Fluxo</SheetTitle>
                <SheetDescription className="text-xs">
                  Conversa com IA sobre seu fluxo — {steps.length} passos carregados
                </SheetDescription>
              </div>
            </div>
            {messages.length > 0 && (
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-8 w-8"
                onClick={() => setMessages([])}
                title="Limpar conversa"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        </SheetHeader>

        <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
          {messages.length === 0 && (
            <div className="space-y-3">
              <div className="rounded-lg border border-purple-500/30 bg-purple-500/5 p-3 text-sm">
                <p className="font-medium">Como posso ajudar com este fluxo?</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Pergunte sobre conversão, regras quebradas, sugestões de passos, ou
                  reescrita de mensagens.
                </p>
              </div>
              <div className="space-y-1.5">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Sugestões
                </p>
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => send(s)}
                    disabled={loading || !flowId}
                    className="w-full rounded-md border bg-card px-3 py-2 text-left text-xs hover:bg-muted disabled:opacity-50"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) => (
            <div
              key={i}
              className={cn(
                "rounded-lg px-3 py-2 text-sm",
                m.role === "user"
                  ? "ml-8 bg-primary/10 text-foreground"
                  : "mr-8 border bg-card",
              )}
            >
              {m.role === "assistant" && (
                <Badge variant="outline" className="mb-1 h-4 px-1 text-[9px]">
                  IA
                </Badge>
              )}
              {m.role === "assistant" ? (
                <div className="prose prose-sm max-w-none dark:prose-invert prose-p:my-1 prose-ul:my-1 prose-headings:mt-2 prose-headings:mb-1">
                  <ReactMarkdown>{m.content}</ReactMarkdown>
                </div>
              ) : (
                <p className="whitespace-pre-wrap">{m.content}</p>
              )}
            </div>
          ))}

          {loading && (
            <div className="mr-8 flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Pensando…
            </div>
          )}
        </div>

        <div className="border-t bg-background p-3">
          <div className="flex gap-2">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Pergunte algo sobre o fluxo…"
              rows={2}
              className="resize-none text-sm"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send(input);
                }
              }}
              disabled={loading || !flowId}
            />
            <Button
              type="button"
              size="icon"
              className="h-auto"
              onClick={() => send(input)}
              disabled={loading || !input.trim() || !flowId}
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>
          <p className="mt-1 text-[10px] text-muted-foreground">
            Enter envia, Shift+Enter quebra linha
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
