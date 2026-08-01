import { useState, useRef, useEffect, useCallback, lazy, Suspense } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { Sparkles, Send, Loader2, MessageCircleQuestion, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { toUserFacingError } from "@/lib/userFacingError";

// react-markdown (+ micromark/mdast) pesa ~50 kB gzip e este botão fica montado
// no shell do app em TODAS as rotas (inclusive /auth). Carregar o renderizador
// só quando uma resposta do assistente precisa ser exibida tira esse peso do
// carregamento inicial sem mudar o comportamento do chat.
const ReactMarkdown = lazy(() => import("react-markdown"));

interface Msg { role: "user" | "assistant"; content: string }


const WELCOME: Msg = {
  role: "assistant",
  content: "Olá. Sou a assistência da iGreen com IA. Consulto os guias da plataforma e os dados atuais da sua operação para orientar você. O que precisa fazer?",
};

const SUGGESTIONS = [
  "Como conecto ou reconecto meu WhatsApp?",
  "Como acompanho um cliente interessado?",
  "Por que minha campanha foi reprovada?",
  "Onde vejo saldo e comissões?",
];

const LS_PREFIX = "support-chat-history-v1:";
const HISTORY_LIMIT = 40;

interface SupportChatButtonProps {
  /** Classes extras no FAB (ex.: ocultar na aba Produtos mobile). */
  className?: string;
}

function lsKey(userId: string) {
  return `${LS_PREFIX}${userId}`;
}

function readLocal(userId: string): Msg[] | null {
  try {
    const raw = localStorage.getItem(lsKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Msg[];
    return Array.isArray(parsed) && parsed.length ? parsed : null;
  } catch {
    return null;
  }
}

function writeLocal(userId: string, messages: Msg[]) {
  try {
    localStorage.setItem(lsKey(userId), JSON.stringify(messages.slice(-HISTORY_LIMIT)));
  } catch { /* storage bloqueado */ }
}

function clearLocal(userId: string) {
  try {
    localStorage.removeItem(lsKey(userId));
  } catch { /* ignore */ }
}

export function SupportChatButton({ className }: SupportChatButtonProps = {}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([WELCOME]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [historyReady, setHistoryReady] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }); }, [msgs, sending]);

  useEffect(() => {
    const handleOpen = () => setOpen(true);
    window.addEventListener("open-support-chat", handleOpen);
    return () => window.removeEventListener("open-support-chat", handleOpen);
  }, []);

  const persistPair = useCallback(async (uid: string, all: Msg[], pair: Msg[]) => {
    writeLocal(uid, all);
    try {
      const { count } = await supabase
        .from("support_chat_messages" as never)
        .select("id", { count: "exact", head: true })
        .eq("user_id", uid);
      if ((count ?? 0) > HISTORY_LIMIT + 10) {
        const { data: old } = await supabase
          .from("support_chat_messages" as never)
          .select("id")
          .eq("user_id", uid)
          .order("created_at", { ascending: true })
          .limit(Math.max(0, (count ?? 0) - HISTORY_LIMIT));
        const ids = ((old as unknown as Array<{ id: string }>) || []).map((row) => row.id);
        if (ids.length) await supabase.from("support_chat_messages" as never).delete().in("id", ids);
      }
      await supabase.from("support_chat_messages" as never).insert(
        pair.map((m) => ({ user_id: uid, role: m.role, content: m.content })) as never,
      );
    } catch {
      // Fallback já gravado no localStorage
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      const uid = user?.id || null;
      if (cancelled) return;
      setUserId(uid);
      if (!uid) {
        setHistoryReady(true);
        return;
      }

      const local = readLocal(uid);
      try {
        const { data, error } = await supabase
          .from("support_chat_messages" as never)
          .select("role, content, created_at")
          .eq("user_id", uid)
          .order("created_at", { ascending: true })
          .limit(HISTORY_LIMIT);
        if (!cancelled && !error && data && (data as unknown as Msg[]).length > 0) {
          const loaded = (data as unknown as Array<{ role: "user" | "assistant"; content: string }>).map((row) => ({
            role: row.role,
            content: row.content,
          }));
          setMsgs(loaded[0]?.role === "assistant" ? loaded : [WELCOME, ...loaded]);
          writeLocal(uid, loaded[0]?.role === "assistant" ? loaded : [WELCOME, ...loaded]);
        } else if (!cancelled && local) {
          setMsgs(local);
        }
      } catch {
        if (!cancelled && local) setMsgs(local);
      }
      if (!cancelled) setHistoryReady(true);
    };
    void load();
    return () => { cancelled = true; };
  }, []);

  async function clearHistory() {
    setMsgs([WELCOME]);
    if (!userId) return;
    clearLocal(userId);
    try {
      await supabase.from("support_chat_messages" as never).delete().eq("user_id", userId);
    } catch { /* ignore */ }
    toast({ title: "Conversa limpa", description: "O histórico desta assistência foi apagado." });
  }

  async function send(text: string) {
    const txt = text.trim();
    if (!txt || sending) return;
    const next: Msg[] = [...msgs, { role: "user", content: txt }];
    setMsgs(next);
    if (userId) writeLocal(userId, next);
    setInput("");
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("support-chat", {
        body: { messages: next.slice(-HISTORY_LIMIT) },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const withReply: Msg[] = [...next, { role: "assistant", content: data?.reply || "Sem resposta." }];
      setMsgs(withReply);
      if (userId) {
        const pair = withReply.slice(-2);
        void persistPair(userId, withReply, pair);
      }
    } catch (e: unknown) {
      toast({
        title: "Suporte indisponível",
        description: toUserFacingError(e, "Tente novamente em instantes."),
        variant: "destructive",
        duration: 13000,
      });
      setMsgs(next);
      if (userId) writeLocal(userId, next);
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
            <div className="flex items-start justify-between gap-2 pr-6">
              <div>
                <SheetTitle className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-primary" /> Assistência iGreen com IA
                </SheetTitle>
                <p className="text-[11px] text-muted-foreground mt-1">Vê seus dados em tempo real e guarda esta conversa para você não perder o histórico.</p>
              </div>
              {historyReady && msgs.length > 1 && (
                <Button type="button" variant="ghost" size="icon" className="shrink-0 h-8 w-8" aria-label="Limpar conversa" onClick={() => void clearHistory()}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          </SheetHeader>

          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            {msgs.map((m, i) => (
              <div
                key={i}
                className={`text-sm rounded-lg px-3 py-2 ${m.role === "user" ? "bg-primary text-primary-foreground ml-8 whitespace-pre-line" : "bg-muted mr-8"}`}
              >
                {m.role === "assistant" ? (
                  <div className="prose prose-sm dark:prose-invert max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 prose-p:my-1.5 prose-ul:my-1.5 prose-ol:my-1.5 prose-li:my-0.5 prose-strong:text-foreground">
                    <ReactMarkdown
                      components={{
                        a: ({ href, children }) => (
                          <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2">
                            {children}
                          </a>
                        ),
                      }}
                    >
                      {m.content}
                    </ReactMarkdown>
                  </div>
                ) : (
                  m.content
                )}
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
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(input); } }}
              placeholder="Pergunte qualquer coisa..."
              rows={1}
              className="resize-none min-h-[40px] max-h-32"
              disabled={sending}
            />
            <Button size="icon" onClick={() => void send(input)} disabled={sending || !input.trim()}>
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
