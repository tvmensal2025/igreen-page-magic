import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface Message {
  id: string;
  message_direction: string;
  message_text: string | null;
  message_type: string | null;
  conversation_step: string | null;
  created_at: string;
}

interface Props {
  customerId: string;
}

export function ReaquecimentoLeadHistory({ customerId }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setError(null);
      const { data, error } = await supabase
        .from("conversations")
        .select("id, message_direction, message_text, message_type, conversation_step, created_at")
        .eq("customer_id", customerId)
        .not("message_text", "like", "[__safety_ping__]%")
        .not("message_text", "like", "[inline-sent]%")
        .not("message_text", "like", "[failed:%")
        .order("created_at", { ascending: false })
        .limit(20);

      if (!alive) return;
      if (error) {
        setError(error.message);
      } else {
        setMessages(((data as Message[]) || []).reverse());
      }
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [customerId]);

  if (loading) {
    return (
      <div className="grid place-items-center py-4">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 rounded-md bg-destructive/10 p-2 text-xs text-destructive">
        <AlertCircle className="h-3 w-3" />
        Erro: {error}
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <p className="py-2 text-center text-xs text-muted-foreground">
        Sem mensagens registradas para este lead.
      </p>
    );
  }

  return (
    <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
      {messages.map((m) => {
        const isInbound = m.message_direction === "inbound";
        const isOutbound = m.message_direction === "outbound";
        const sender = isInbound ? "Cliente" : isOutbound ? "Bot" : "Sistema";
        const text = m.message_text || `[${m.message_type || "evento"}]`;
        return (
          <div
            key={m.id}
            className={cn(
              "rounded-md p-2 text-[11px]",
              isInbound ? "bg-blue-500/10 mr-8" : "bg-emerald-500/10 ml-8 text-right",
            )}
          >
            <div className="mb-0.5 flex items-center gap-2 text-[10px] text-muted-foreground">
              <span className="font-medium">{sender}</span>
              <span>{new Date(m.created_at).toLocaleString("pt-BR")}</span>
            </div>
            <p className="whitespace-pre-wrap break-words">{text.slice(0, 300)}{text.length > 300 ? "…" : ""}</p>
          </div>
        );
      })}
    </div>
  );
}
