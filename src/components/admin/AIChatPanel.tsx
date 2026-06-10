import { useState, useRef, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Bot, Send, X, User, Loader2, Sparkles, UserPlus, Zap } from "lucide-react";

interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  timestamp: Date;
  actions?: ChatAction[];
}

interface ChatAction {
  label: string;
  icon: "licenciado" | "energia";
  message: string;
}

interface AIChatPanelProps {
  open: boolean;
  onClose: () => void;
}

const SUGGESTIONS = [
  "Como funciona a Conexão Green para o cliente?",
  "Quais as comissões de cada produto?",
  "Explique o plano de carreira completo",
  "Como funciona a Conexão Expansão?",
  "Quais distribuidoras são atendidas?",
  "Como usar o painel para gerenciar clientes?",
  "Me dê dicas de abordagem para vender",
  "Qual a diferença entre CP e CI?",
];

const CADASTRO_KEYWORDS = [
  "cadastrar", "cadastro", "como cadastro", "como faco para cadastrar",
  "registrar", "como registro", "quero cadastrar", "como me cadastro",
  "como se cadastrar", "fazer cadastro", "inscricao", "inscrever",
  "cadastra", "como funciona o cadastro", "preciso cadastrar",
  "quero registrar", "como faz pra cadastrar", "como cadastra",
];

const VIDEO_URLS_MAP: Record<string, string> = {
  "youtube.com/watch": "",
  "youtu.be/": "",
};

const ENERGY_VIDEO_URL = "https://zlzasfhcxcznaprrragl.supabase.co/storage/v1/object/public/video%20igreen/conta-de-energia.mp4";

function detectCadastroIntent(text: string): boolean {
  const lower = text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return CADASTRO_KEYWORDS.some((kw) => lower.includes(kw.normalize("NFD").replace(/[\u0300-\u036f]/g, "")));
}

function renderVideoInText(text: string): JSX.Element[] {
  const urlPattern = /(https?:\/\/[^\s)]+)/g;
  const parts = text.split(urlPattern);

  return parts.map((part, i) => {
    const isUrl = /^https?:\/\//.test(part);
    if (!isUrl) return <span key={i}>{part}</span>;

    const isYoutube = part.includes("youtube.com") || part.includes("youtu.be");
    const isVideoFile = /\.(mp4|webm|ogg)(\?|$)/i.test(part);

    if (isYoutube || isVideoFile) {
      const videoSrc = isYoutube ? ENERGY_VIDEO_URL : part;
      return (
        <div key={i} className="my-2 rounded-xl overflow-hidden border border-border/30">
          <video controls playsInline preload="metadata" className="w-full aspect-video">
            <source src={videoSrc} type="video/mp4" />
          </video>
        </div>
      );
    }

    return (
      <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="text-primary underline break-all">
        {part}
      </a>
    );
  });
}

const CADASTRO_ACTIONS: ChatAction[] = [
  { label: "Cadastrar Licenciado", icon: "licenciado", message: "Como faço para cadastrar um novo licenciado na plataforma iGreen?" },
  { label: "Cadastrar Conta de Energia", icon: "energia", message: "Como faço para cadastrar uma conta de energia de um cliente?" },
];

export function AIChatPanel({ open, onClose }: AIChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      text: "Olá! 👋 Sou a assistente virtual da iGreen Energy. Posso te ajudar com dúvidas sobre produtos, cadastro de clientes, comissões, plano de carreira e muito mais. Como posso te ajudar?",
      timestamp: new Date(),
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || loading) return;
    const isCadastroQuestion = detectCadastroIntent(text);
    const userMsg: ChatMessage = { role: "user", text: text.trim(), timestamp: new Date() };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    try {
      const history = messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", text: m.text }));
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      };
      if (token) headers["Authorization"] = `Bearer ${token}`;

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/igreen-chat`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({ message: text.trim(), history }),
        }
      );

      if (!res.ok) {
        console.error("Chat API error:", res.status, await res.text());
        throw new Error(`HTTP ${res.status}`);
      }

      const data = await res.json();
      const reply = data.reply || "Desculpe, não consegui responder. Tente novamente.";
      
      const assistantMsg: ChatMessage = {
        role: "assistant",
        text: reply,
        timestamp: new Date(),
        actions: isCadastroQuestion ? CADASTRO_ACTIONS : undefined,
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: "Erro de conexão. Verifique sua internet e tente novamente. 💚", timestamp: new Date() },
      ]);
    } finally {
      setLoading(false);
    }
  }, [loading, messages]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:justify-end p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full sm:w-[400px] h-full sm:h-[600px] sm:max-h-[80vh] bg-card border border-border rounded-none sm:rounded-2xl shadow-2xl flex flex-col overflow-hidden sm:mr-4">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-gradient-to-r from-primary/10 to-transparent">
          <div className="flex items-center justify-center h-9 w-9 rounded-full bg-primary/20">
            <Sparkles className="h-4 w-4 text-primary" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-foreground">Assistente iGreen</h3>
            <p className="text-[10px] text-muted-foreground">Powered by Google AI</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-secondary/80 text-muted-foreground hover:text-foreground transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.map((msg, i) => (
            <div key={i}>
              <div className={`flex gap-2 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                {msg.role === "assistant" && (
                  <div className="h-7 w-7 rounded-full bg-primary/20 flex items-center justify-center shrink-0 mt-0.5">
                    <Bot className="h-3.5 w-3.5 text-primary" />
                  </div>
                )}
                <div
                  className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed ${
                    msg.role === "user"
                      ? "bg-primary text-primary-foreground rounded-br-md"
                      : "bg-secondary/60 text-foreground rounded-bl-md border border-border/50"
                  }`}
                >
                  <div className="whitespace-pre-wrap">{renderVideoInText(msg.text)}</div>
                </div>
                {msg.role === "user" && (
                  <div className="h-7 w-7 rounded-full bg-secondary flex items-center justify-center shrink-0 mt-0.5">
                    <User className="h-3.5 w-3.5 text-muted-foreground" />
                  </div>
                )}
              </div>

              {/* Action buttons for cadastro */}
              {msg.actions && msg.actions.length > 0 && (
                <div className="ml-9 mt-2 flex flex-col gap-2">
                  {msg.actions.map((action, j) => (
                    <button
                      key={j}
                      onClick={() => sendMessage(action.message)}
                      className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-primary/10 hover:bg-primary/20 border border-primary/30 text-foreground text-[13px] font-medium transition-colors text-left"
                    >
                      {action.icon === "licenciado" ? (
                        <UserPlus className="h-4 w-4 text-primary shrink-0" />
                      ) : (
                        <Zap className="h-4 w-4 text-warning shrink-0" />
                      )}
                      {action.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
          {loading && (
            <div className="flex gap-2 justify-start">
              <div className="h-7 w-7 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                <Bot className="h-3.5 w-3.5 text-primary" />
              </div>
              <div className="bg-secondary/60 rounded-2xl rounded-bl-md px-4 py-3 border border-border/50">
                <div className="flex gap-1">
                  <span className="w-2 h-2 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: "0ms" }} />
                  <span className="w-2 h-2 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: "150ms" }} />
                  <span className="w-2 h-2 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: "300ms" }} />
                </div>
              </div>
            </div>
          )}

          {/* Suggestions - only show at start */}
          {messages.length === 1 && !loading && (
            <div className="space-y-1.5 pt-2">
              <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Sugestões:</p>
              {SUGGESTIONS.map((s, i) => (
                <button
                  key={i}
                  onClick={() => sendMessage(s)}
                  className="block w-full text-left text-[12px] px-3 py-2 rounded-lg bg-secondary/40 hover:bg-secondary/80 border border-border/30 text-foreground transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Input */}
        <div className="border-t border-border p-3 bg-card">
          <div className="flex gap-2">
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Digite sua dúvida..."
              disabled={loading}
              className="flex-1 h-9 px-3 text-sm bg-secondary/50 border border-border rounded-xl focus:outline-none focus:ring-1 focus:ring-primary/50 text-foreground placeholder:text-muted-foreground disabled:opacity-50"
            />
            <Button
              size="sm"
              className="h-9 w-9 p-0 rounded-xl"
              onClick={() => sendMessage(input)}
              disabled={!input.trim() || loading}
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
