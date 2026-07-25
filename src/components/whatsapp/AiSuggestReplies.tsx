import { useState, useCallback } from "react";
import { Sparkles, Loader2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Suggestion {
  tone: "empatico" | "objetivo" | "consultivo";
  text: string;
}

const TONE_LABEL: Record<string, string> = {
  empatico: "Empático",
  objetivo: "Objetivo",
  consultivo: "Consultivo",
};

interface AiSuggestRepliesProps {
  customerId?: string;
  disabled?: boolean;
  onPick: (text: string) => void;
}

export function AiSuggestReplies({ customerId, disabled, onPick }: AiSuggestRepliesProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [error, setError] = useState<string | null>(null);

  const fetchSuggestions = useCallback(async () => {
    if (!customerId) return;
    setLoading(true);
    setError(null);
    try {
      const { data, error: fnError } = await supabase.functions.invoke("ai-suggest-reply", {
        body: { customer_id: customerId },
      });
      if (fnError) throw fnError;
      const list = (data?.suggestions || []) as Suggestion[];
      if (!list.length) {
        setError("Sem sugestões disponíveis. Tente novamente.");
      } else {
        setSuggestions(list);
      }
    } catch (e: any) {
      const msg = e?.message || "Falha ao gerar sugestões";
      if (msg.includes("429")) setError("Limite de IA atingido. Tente novamente em alguns segundos.");
      else if (msg.includes("402")) setError("Créditos de IA esgotados. Adicione créditos no workspace.");
      else setError(msg);
    } finally {
      setLoading(false);
    }
  }, [customerId]);

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen && !suggestions.length && !loading) {
      fetchSuggestions();
    }
  }, [suggestions.length, loading, fetchSuggestions]);

  const handlePick = useCallback((s: Suggestion) => {
    onPick(s.text);
    setOpen(false);
    toast.success(`Sugestão "${TONE_LABEL[s.tone]}" aplicada`);
  }, [onPick]);

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-11 w-11 shrink-0 text-muted-foreground hover:text-primary"
          disabled={disabled || !customerId}
          title="Sugerir resposta com IA"
        >
          <Sparkles className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        className="w-[360px] p-3 bg-card border-border"
      >
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium text-foreground">Sugestões da IA</span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-muted-foreground hover:text-primary"
            onClick={fetchSuggestions}
            disabled={loading}
          >
            {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : "Regenerar"}
          </Button>
        </div>

        {loading && (
          <div className="flex items-center gap-2 py-6 justify-center text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-xs">Gerando 3 variantes...</span>
          </div>
        )}

        {error && !loading && (
          <div className="text-xs text-destructive py-3 px-2 bg-destructive/10 rounded">
            {error}
          </div>
        )}

        {!loading && !error && suggestions.length > 0 && (
          <div className="space-y-2">
            {suggestions.map((s, i) => (
              <button
                key={i}
                type="button"
                onClick={() => handlePick(s)}
                className="w-full text-left p-2.5 rounded-lg bg-secondary/40 hover:bg-secondary/70 border border-border/40 hover:border-primary/40 transition-colors group"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] uppercase tracking-wider font-semibold text-primary/80">
                    {TONE_LABEL[s.tone] || s.tone}
                  </span>
                  <Check className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
                <p className="text-xs text-foreground/90 leading-relaxed whitespace-pre-wrap">
                  {s.text}
                </p>
              </button>
            ))}
            <p className="text-[10px] text-muted-foreground/70 text-center pt-1">
              Clique em uma variante para usar no campo de mensagem
            </p>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
