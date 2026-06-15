import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Sparkles, BookOpen, Pencil, AlertTriangle } from "lucide-react";

interface Props {
  consultantId: string;
  onEditPersona?: () => void;
}

export default function FluxoBHeaderStats({ consultantId, onEditPersona }: Props) {
  const navigate = useNavigate();
  const [promptChars, setPromptChars] = useState<number | null>(null);
  const [ragCount, setRagCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [{ data: cons }, { count }] = await Promise.all([
        supabase
          .from("consultants")
          .select("ai_persona_fluxo_b")
          .eq("id", consultantId)
          .maybeSingle(),
        supabase
          .from("ai_knowledge_sections")
          .select("id", { count: "exact", head: true })
          .eq("is_active", true),
      ]);
      if (cancelled) return;
      setPromptChars(((cons as any)?.ai_persona_fluxo_b || "").length);
      setRagCount(count ?? 0);
    })();
    return () => { cancelled = true; };
  }, [consultantId]);

  const promptEmpty = promptChars !== null && promptChars < 50;
  const ragEmpty = ragCount !== null && ragCount === 0;

  const fmtChars = (n: number | null) => {
    if (n === null) return "…";
    if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
    return String(n);
  };

  return (
    <TooltipProvider delayDuration={150}>
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="outline" className="text-[9px] py-0 h-4 border-primary/30 bg-primary/5 text-primary font-medium gap-1">
          <Sparkles className="h-2.5 w-2.5" />
          IA Livre
        </Badge>

        <Tooltip>
          <TooltipTrigger asChild>
            <Badge
              variant="outline"
              className={`text-[9px] py-0 h-4 font-medium gap-1 ${
                promptEmpty ? "border-amber-500/50 bg-amber-500/10 text-amber-600" : "border-border/40"
              }`}
            >
              {promptEmpty && <AlertTriangle className="h-2.5 w-2.5" />}
              Prompt {fmtChars(promptChars)}
            </Badge>
          </TooltipTrigger>
          <TooltipContent>
            {promptEmpty
              ? "Super prompt vazio ou muito curto — a IA não tem persona definida."
              : `Super prompt: ${promptChars} caracteres salvos.`}
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Badge
              variant="outline"
              className={`text-[9px] py-0 h-4 font-medium gap-1 ${
                ragEmpty ? "border-amber-500/50 bg-amber-500/10 text-amber-600" : "border-border/40"
              }`}
            >
              {ragEmpty && <AlertTriangle className="h-2.5 w-2.5" />}
              RAG {ragCount ?? "…"} trechos
            </Badge>
          </TooltipTrigger>
          <TooltipContent>
            {ragEmpty
              ? "Nenhum trecho ativo na base de conhecimento."
              : `${ragCount} trechos ativos no RAG.`}
          </TooltipContent>
        </Tooltip>

        <Button
          variant="ghost"
          size="sm"
          className="h-5 px-1.5 text-[10px] gap-1"
          onClick={onEditPersona}
        >
          <Pencil className="h-2.5 w-2.5" />
          Persona
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-5 px-1.5 text-[10px] gap-1"
          onClick={() => navigate("/admin?tab=conhecimento")}
        >
          <BookOpen className="h-2.5 w-2.5" />
          Conhecimento
        </Button>
      </div>
    </TooltipProvider>
  );
}
