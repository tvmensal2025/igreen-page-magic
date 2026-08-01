import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Sparkles, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/components/ui/sonner";

interface Suggestion {
  title: string;
  step_type: string;
  message_text: string;
  buttons?: { id: string; title: string }[];
  reasoning: string;
}

interface Props {
  consultantId: string;
  stepId: string;
  flowId: string;
  currentMaxPosition: number;
  onAdded: () => void;
}

export default function StepSuggestions({ consultantId, stepId, flowId, currentMaxPosition, onAdded }: Props) {
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [adding, setAdding] = useState<string | null>(null);

  async function fetchSuggestions() {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("flow-step-suggest", {
        body: { consultantId, stepId },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      setSuggestions(((data as any)?.suggestions || []) as Suggestion[]);
    } catch (e: any) {
      toast.error("IA não respondeu: " + (e?.message || "erro"));
    } finally {
      setLoading(false);
    }
  }

  async function addStep(s: Suggestion) {
    setAdding(s.title);
    try {
      const slotKey = `passo_${Date.now().toString(36)}`;
      const captures: any[] = [];
      if (s.buttons && s.buttons.length) {
        captures.push({ field: "_buttons", enabled: true, value: s.buttons });
      }
      const { error } = await supabase.from("bot_flow_steps").insert({
        flow_id: flowId,
        position: currentMaxPosition + 1,
        step_type: s.step_type,
        step_key: slotKey,
        title: s.title,
        summary: s.reasoning,
        icon: "msg",
        message_text: s.message_text,
        slot_key: slotKey,
        transitions: [],
        captures,
        fallback: { mode: "repeat" },
        is_active: true,
      } as any);
      if (error) throw error;
      toast.success("Passo adicionado ao final do fluxo");
      onAdded();
    } catch (e: any) {
      toast.error("Erro ao adicionar: " + (e?.message || "erro"));
    } finally {
      setAdding(null);
    }
  }

  if (!suggestions) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-full"
        onClick={fetchSuggestions}
        disabled={loading}
      >
        {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
        Sugerir próximos passos com IA
      </Button>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">Sugestões da IA</span>
        <Button type="button" variant="ghost" size="sm" onClick={fetchSuggestions} disabled={loading}>
          {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : "Gerar novas"}
        </Button>
      </div>
      {suggestions.length === 0 ? (
        <p className="text-xs text-muted-foreground">A IA não retornou sugestões.</p>
      ) : (
        suggestions.map((s, i) => (
          <div key={i} className="rounded-lg border bg-card p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{s.title}</p>
                <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{s.message_text}</p>
                <p className="mt-1 text-[10px] italic text-muted-foreground">💡 {s.reasoning}</p>
              </div>
              <Button
                size="sm"
                variant="secondary"
                disabled={!!adding}
                onClick={() => addStep(s)}
              >
                {adding === s.title ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
              </Button>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
