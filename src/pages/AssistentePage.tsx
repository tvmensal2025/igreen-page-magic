import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Send, User, Loader2, Trash2, Zap, MapPin, Users, DollarSign, Wifi, Leaf } from "lucide-react";
import ReactMarkdown from "react-markdown";
const igreenLogo = "/images/g-verde.png";

interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  actions?: { label: string; url: string }[];
}

const SUGGESTIONS = [
  { text: "Como funciona o desconto na conta de luz?", icon: DollarSign },
  { text: "Quais produtos a iGreen oferece?", icon: Leaf },
  { text: "Como é o plano de carreira?", icon: Users },
  { text: "Atende na minha cidade?", icon: MapPin },
  { text: "Diferença entre Green e Solar?", icon: Zap },
  { text: "Como funciona o Telecom?", icon: Wifi },
];

const CADASTRO_KEYWORDS = [
  "cadastrar", "cadastro", "como faço para", "como faz pra", "como registro",
  "quero me cadastrar", "inscrever", "como cadastra", "como me cadastro",
  "quero cadastrar", "preciso cadastrar", "inscricao", "inscrição",
];

const ENERGY_VIDEO_URL = "https://zlzasfhcxcznaprrragl.supabase.co/storage/v1/object/public/video%20igreen/WhatsApp%20Video%202025-05-29%20at%2021.37.39.mp4";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const STORAGE_KEY = "igreen-chat-history";

function loadSavedMessages(): ChatMessage[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as ChatMessage[];
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch { /* ignore */ }
  return [
    {
      role: "assistant",
      text: "Olá! 👋 Sou a assistente virtual da **iGreen Energy**.\n\nPosso te ajudar com dúvidas sobre:\n- 💡 Economia na conta de luz\n- 🌱 Nossos produtos e serviços\n- 📈 Plano de carreira\n- 📍 Cobertura na sua região\n\nComo posso te ajudar hoje?",
    },
  ];
}

function detectCadastroIntent(text: string): boolean {
  const lower = text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return CADASTRO_KEYWORDS.some(k => lower.includes(k));
}

function renderVideoInText(text: string): string {
  // Replace YouTube links and video URLs with a marker
  return text.replace(
    /https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/|.*\.(?:mp4|webm|mov))\S*/gi,
    ""
  ).trim();
}

export default function AssistentePage() {
  const [messages, setMessages] = useState<ChatMessage[]>(loadSavedMessages);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    if (scrollRef.current)
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(messages)); } catch { /* quota */ }
  }, [messages]);

  const clearChat = () => {
    const initial = loadSavedMessages();
    setMessages([initial[0]]);
    localStorage.removeItem(STORAGE_KEY);
  };

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || loading) return;
      const clean = text.trim();
      setMessages((prev) => [...prev, { role: "user", text: clean }]);
      setInput("");
      setLoading(true);

      try {
        const history = messages.map((m) => ({
          role: m.role === "assistant" ? "model" : "user",
          text: m.text,
        }));

        const res = await fetch(
          `${SUPABASE_URL}/functions/v1/igreen-chat`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              apikey: SUPABASE_KEY,
            },
            body: JSON.stringify({ message: clean, history, stream: true }),
          }
        );

        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        if (!res.body) throw new Error("No stream body");

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let assistantText = "";
        let buffer = "";

        // Add empty assistant message
        setMessages((prev) => [...prev, { role: "assistant", text: "" }]);

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let newlineIdx: number;
          while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
            let line = buffer.slice(0, newlineIdx);
            buffer = buffer.slice(newlineIdx + 1);
            if (line.endsWith("\r")) line = line.slice(0, -1);
            if (!line.startsWith("data: ")) continue;
            const jsonStr = line.slice(6).trim();
            if (jsonStr === "[DONE]") break;

            try {
              const parsed = JSON.parse(jsonStr);
              const text = parsed?.candidates?.[0]?.content?.parts?.[0]?.text;
              if (text) {
                assistantText += text;
                const cleanedText = renderVideoInText(assistantText);
                const isCadastro = detectCadastroIntent(clean);
                setMessages((prev) => {
                  const updated = [...prev];
                  updated[updated.length - 1] = {
                    role: "assistant",
                    text: cleanedText,
                    actions: isCadastro ? [
                      { label: "📋 Cadastrar Licenciado", url: "/cadastro" },
                      { label: "⚡ Cadastrar Conta de Energia", url: "#energia" },
                    ] : undefined,
                  };
                  return updated;
                });
              }
            } catch { /* partial JSON, skip */ }
          }
        }

        // If no text was streamed, show error
        if (!assistantText) {
          setMessages((prev) => {
            const updated = [...prev];
            updated[updated.length - 1] = {
              role: "assistant",
              text: "Desculpe, não consegui responder. Tente novamente.",
            };
            return updated;
          });
        }
      } catch {
        setMessages((prev) => [
          ...prev.filter(m => m.text !== ""),
          {
            role: "assistant",
            text: "Erro de conexão. Tente novamente em instantes.",
          },
        ]);
      } finally {
        setLoading(false);
      }
    },
    [loading, messages]
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  const showVideo = messages.some(m =>
    m.actions?.some(a => a.url === "#energia")
  );

  return (
    <div className="h-[100dvh] bg-gradient-to-b from-[#060a07] via-[#0a1210] to-[#060a07] flex flex-col overflow-hidden">
      {/* Header */}
      <header className="shrink-0 border-b border-primary/10 bg-gradient-to-r from-[#0a1210]/95 via-[#0d1a14]/95 to-[#0a1210]/95 backdrop-blur-2xl px-4 py-3 flex items-center gap-3">
        <div className="relative">
          <img
            src={igreenLogo}
            alt="iGreen Energy"
            className="h-10 w-10 object-contain rounded-xl bg-primary/10 p-1 ring-1 ring-primary/20"
          />
          <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-primary border-2 border-[#0a1210] animate-pulse" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-white font-bold text-sm leading-tight tracking-tight">
            Assistente iGreen
          </h1>
          <span className="text-primary/60 text-[11px] font-medium">
            Gemini 2.5 Flash · Online
          </span>
        </div>
        <button
          onClick={clearChat}
          className="p-2 rounded-lg hover:bg-white/[0.06] text-white/30 hover:text-white/60 transition-all"
          title="Limpar conversa"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </header>

      {/* Messages */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto overscroll-contain px-3 py-4 space-y-3 scroll-smooth"
      >
        <div className="max-w-2xl mx-auto space-y-3">
          {messages.map((msg, i) => (
            <div
              key={i}
              className={`flex items-end gap-2.5 ${
                msg.role === "user" ? "flex-row-reverse" : "flex-row"
              } animate-in fade-in slide-in-from-bottom-2 duration-300`}
            >
              {/* Avatar */}
              {msg.role === "assistant" ? (
                <img
                  src={igreenLogo}
                  alt=""
                  className="h-8 w-8 rounded-xl object-contain shrink-0 bg-primary/10 p-1 ring-1 ring-primary/15"
                />
              ) : (
                <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-primary/20 to-primary/10 flex items-center justify-center shrink-0 ring-1 ring-primary/15">
                  <User className="h-4 w-4 text-primary/60" />
                </div>
              )}

              {/* Bubble */}
              <div className="max-w-[82%] space-y-2">
                <div
                  className={`rounded-2xl px-4 py-3 text-[13.5px] leading-relaxed ${
                    msg.role === "user"
                      ? "bg-gradient-to-br from-primary to-primary text-white rounded-br-md shadow-lg shadow-emerald-500/15"
                      : "bg-white/[0.04] text-white/90 rounded-bl-md border border-white/[0.06] backdrop-blur-sm"
                  }`}
                >
                  <div className="prose prose-invert prose-sm max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 prose-p:my-1.5 prose-ul:my-1.5 prose-ol:my-1.5 prose-li:my-0 prose-strong:text-white prose-headings:text-white">
                    <ReactMarkdown
                      components={{
                        a: ({ href, children }) => (
                          <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2 decoration-primary/30 hover:decoration-primary">
                            {children}
                          </a>
                        ),
                      }}
                    >
                      {msg.text}
                    </ReactMarkdown>
                  </div>
                </div>

                {/* Action buttons */}
                {msg.actions && msg.actions.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {msg.actions.map((action, j) => (
                      <button
                        key={j}
                        onClick={() => {
                          if (action.url === "#energia") {
                            // Scroll to video or show it
                          } else {
                            window.open(action.url, "_blank");
                          }
                        }}
                        className="px-3.5 py-2 rounded-xl text-[12px] font-semibold
                          bg-gradient-to-r from-primary/15 to-primary/10
                          border border-primary/25 hover:border-primary/50
                          text-primary hover:text-primary
                          transition-all duration-200 active:scale-[0.97]
                          shadow-sm shadow-emerald-500/5"
                      >
                        {action.label}
                      </button>
                    ))}
                  </div>
                )}

                {/* Energy video */}
                {msg.actions?.some(a => a.url === "#energia") && (
                  <div className="rounded-xl overflow-hidden border border-white/[0.06] bg-black/40">
                    <video
                      controls
                      playsInline
                      preload="metadata"
                      className="w-full max-h-[240px] object-contain"
                    >
                      <source src={ENERGY_VIDEO_URL} type="video/mp4" />
                    </video>
                    <div className="px-3 py-2 text-[11px] text-white/40">
                      📹 Tutorial: Como cadastrar conta de energia
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}

          {/* Typing indicator */}
          {loading && messages[messages.length - 1]?.text === "" && null}
          {loading && (messages.length === 0 || messages[messages.length - 1]?.text !== "") && (
            <div className="flex items-end gap-2.5 animate-in fade-in duration-300">
              <img
                src={igreenLogo}
                alt=""
                className="h-8 w-8 rounded-xl object-contain shrink-0 bg-primary/10 p-1 ring-1 ring-primary/15"
              />
              <div className="bg-white/[0.04] rounded-2xl rounded-bl-md px-4 py-3 border border-white/[0.06]">
                <div className="flex items-center gap-2">
                  <div className="flex gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: "0ms" }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: "150ms" }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: "300ms" }} />
                  </div>
                  <span className="text-[11px] text-white/30">Pensando...</span>
                </div>
              </div>
            </div>
          )}

          {/* Suggestions */}
          {messages.length === 1 && !loading && (
            <div className="grid grid-cols-2 gap-2 pt-3">
              {SUGGESTIONS.map((s, i) => {
                const Icon = s.icon;
                return (
                  <button
                    key={i}
                    onClick={() => sendMessage(s.text)}
                    className="text-left text-[12px] px-3 py-3 rounded-xl flex items-start gap-2.5
                      bg-white/[0.03] hover:bg-primary/10
                      border border-white/[0.05] hover:border-primary/20
                      text-white/50 hover:text-white/85
                      transition-all duration-200 active:scale-[0.97] group"
                  >
                    <Icon className="h-3.5 w-3.5 mt-0.5 shrink-0 text-primary/40 group-hover:text-primary transition-colors" />
                    <span>{s.text}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Input */}
      <div className="shrink-0 border-t border-primary/10 bg-gradient-to-r from-[#0a1210]/95 via-[#0d1a14]/95 to-[#0a1210]/95 backdrop-blur-2xl px-3 py-3 safe-area-pb">
        <div className="max-w-2xl mx-auto flex gap-2">
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Pergunte sobre a iGreen..."
            disabled={loading}
            className="flex-1 h-12 px-5 text-sm bg-white/[0.04] border border-white/[0.08] rounded-2xl
              focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/30
              text-white placeholder:text-white/25 disabled:opacity-40 transition-all"
          />
          <Button
            className="h-12 w-12 p-0 rounded-2xl bg-gradient-to-br from-primary to-primary hover:from-primary hover:to-primary text-white shadow-lg shadow-emerald-500/20 transition-all disabled:opacity-30 disabled:shadow-none"
            onClick={() => sendMessage(input)}
            disabled={!input.trim() || loading}
          >
            {loading ? (
              <Loader2 className="h-4.5 w-4.5 animate-spin" />
            ) : (
              <Send className="h-4.5 w-4.5" />
            )}
          </Button>
        </div>
        <p className="text-center text-[10px] text-white/15 mt-2">
          iGreen Energy © 2026 · Powered by Gemini 2.5 Flash
        </p>
      </div>
    </div>
  );
}
