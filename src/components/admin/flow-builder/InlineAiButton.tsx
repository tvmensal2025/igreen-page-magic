// Botão ✨ inline que abre um menu de ações de IA pra reescrever/gerar
// texto. Chama a edge function `flow-ai-rewrite` e devolve o resultado
// via callback `onResult`.
import { useState } from "react";
import { Sparkles, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

type Action = "shorten" | "expand" | "formal" | "casual" | "fix" | "rewrite" | "generate";

interface Props {
  text: string;
  context?: string;
  onResult: (next: string) => void;
  className?: string;
  size?: "icon" | "sm";
}

const ACTIONS: { id: Action; label: string; emoji: string }[] = [
  { id: "shorten", label: "Encurtar", emoji: "✂️" },
  { id: "expand", label: "Expandir", emoji: "📝" },
  { id: "casual", label: "Mais casual", emoji: "😎" },
  { id: "formal", label: "Mais formal", emoji: "👔" },
  { id: "fix", label: "Corrigir gramática", emoji: "✅" },
];

export default function InlineAiButton({
  text,
  context,
  onResult,
  className,
  size = "icon",
}: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState<Action | null>(null);
  const [instruction, setInstruction] = useState("");

  async function run(action: Action, instructionOverride?: string) {
    setLoading(action);
    try {
      const { data, error } = await supabase.functions.invoke("flow-ai-rewrite", {
        body: {
          text,
          action,
          context,
          instruction: instructionOverride || instruction || undefined,
        },
      });
      if (error) throw error;
      const next = (data as { text?: string })?.text;
      if (!next) throw new Error("resposta vazia");
      onResult(next);
      setOpen(false);
      setInstruction("");
    } catch (e) {
      console.error("[InlineAiButton] erro", e);
      toast({
        title: "IA falhou",
        description: e instanceof Error ? e.message : "Tente novamente",
        variant: "destructive",
      });
    } finally {
      setLoading(null);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          size={size}
          variant="ghost"
          className={cn(
            "h-7 w-7 shrink-0 text-primary hover:bg-primary/10 hover:text-primary",
            size === "sm" && "w-auto px-2 text-xs",
            className,
          )}
          aria-label="Ações de IA"
          title="Ações de IA"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {size === "sm" && <span className="ml-1">IA</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-2" align="end">
        <div className="space-y-1">
          {ACTIONS.map((a) => (
            <button
              key={a.id}
              type="button"
              disabled={!!loading || !text.trim()}
              onClick={() => run(a.id)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted disabled:opacity-50"
            >
              <span>{a.emoji}</span>
              <span className="flex-1">{a.label}</span>
              {loading === a.id && <Loader2 className="h-3 w-3 animate-spin" />}
            </button>
          ))}
        </div>
        <div className="mt-2 border-t pt-2">
          <p className="mb-1 px-2 text-[10px] uppercase text-muted-foreground">
            Ou peça do seu jeito
          </p>
          <div className="flex gap-1 px-1">
            <Input
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder="ex: adicione emoji, fique mais persuasivo…"
              className="h-8 text-xs"
              onKeyDown={(e) => {
                if (e.key === "Enter" && instruction.trim()) {
                  e.preventDefault();
                  run(text.trim() ? "rewrite" : "generate");
                }
              }}
            />
            <Button
              type="button"
              size="sm"
              className="h-8 px-2"
              disabled={!!loading || !instruction.trim()}
              onClick={() => run(text.trim() ? "rewrite" : "generate")}
            >
              {loading === "rewrite" || loading === "generate" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
