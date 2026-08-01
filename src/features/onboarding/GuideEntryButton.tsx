import { useState } from "react";
import { CircleAlert, CircleHelp, ExternalLink, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { useGuideCoach } from "@/features/onboarding/GuideCoachProvider";
import { useTour } from "@/features/onboarding/useTour";
import { getHelpArticleById } from "@/features/help/helpCatalog";
import { cn } from "@/lib/utils";
import { useNavigate } from "react-router-dom";

type Props = {
  /** Id do guia em HELP_CATALOG (ex.: guia-whatsapp-conectar) ou slug curto (whatsapp-conectar). */
  articleId: string;
  /** "?" = dúvida; "!" = atenção / guia importante. */
  tone?: "help" | "alert";
  label?: string;
  className?: string;
  size?: "icon" | "sm";
  /** Se true, abre o diálogo imediatamente (útil quando o FAB dispara a ajuda da tela). */
  defaultOpen?: boolean;
};

/**
 * Botão ? / ! → abre a explicação do guia.
 * O tour (destaque na tela) só começa se o consultor clicar em “Me leve e explique”.
 */
export function GuideEntryButton({
  articleId,
  tone = "help",
  label,
  className,
  size = "icon",
  defaultOpen = false,
}: Props) {
  const navigate = useNavigate();
  const { startGuide } = useGuideCoach();
  const { start } = useTour();
  const [open, setOpen] = useState(defaultOpen);
  const article = getHelpArticleById(articleId);
  if (!article) return null;

  const Icon = tone === "alert" ? CircleAlert : CircleHelp;
  const aria = tone === "alert" ? `Atenção: ${article.title}` : `Ajuda: ${article.title}`;
  const tip = label || (tone === "alert" ? "Ver explicação e guia" : "Ajuda desta tela — explicação e tour passo a passo");

  const leadAndExplain = () => {
    setOpen(false);
    startGuide(article);
  };

  const startPlatformTour = () => {
    setOpen(false);
    void start(article.related_tour_step_id ? { stepId: article.related_tour_step_id } : undefined);
  };

  const openPage = () => {
    setOpen(false);
    if (!article.href) return;
    if (article.href.startsWith("http")) window.open(article.href, "_blank", "noopener,noreferrer");
    else navigate(article.href);
  };

  const btn = (
    <Button
      type="button"
      variant="ghost"
      size={size === "icon" ? "icon" : "sm"}
      aria-label={aria}
      data-tour="guide-entry"
      onClick={(e) => {
        e.stopPropagation();
        setOpen(true);
      }}
      className={cn(
        size === "icon" ? "h-8 w-8" : "h-8 gap-1.5 px-2.5",
        tone === "alert"
          ? "text-amber-700 dark:text-amber-400 hover:bg-amber-500/10 border border-amber-500/25 bg-transparent"
          : "text-muted-foreground hover:text-foreground hover:bg-muted/60 border border-border/70 bg-background/80",
        className,
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      {size === "sm" && <span className="text-xs font-medium tracking-wide">{label || "Ajuda"}</span>}
    </Button>
  );

  return (
    <>
      <TooltipProvider delayDuration={250}>
        <Tooltip>
          <TooltipTrigger asChild>{btn}</TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-[280px] text-xs">
            {tip}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] max-w-lg w-[calc(100%-2rem)] overflow-y-auto sm:rounded-2xl">
          <DialogHeader className="pr-8">
            <div className="mb-2">
              <Badge variant="secondary">{article.category}</Badge>
            </div>
            <DialogTitle className="text-xl">{article.title}</DialogTitle>
            <DialogDescription>{article.summary}</DialogDescription>
          </DialogHeader>

          <ol className="space-y-3 py-1">
            {article.steps.map((step, index) => (
              <li key={`${article.id}-${index}`} className="flex gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
                  {index + 1}
                </span>
                <p className="pt-0.5 text-sm leading-relaxed text-foreground/90">{step}</p>
              </li>
            ))}
          </ol>

          <DialogFooter className="gap-2 border-t pt-4 flex-col sm:flex-row sm:justify-between">
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={leadAndExplain}>
                <Play className="mr-2 h-4 w-4" />
                Me leve e explique
              </Button>
              <Button type="button" variant="outline" onClick={startPlatformTour}>
                <Play className="mr-2 h-4 w-4" />
                Tour da plataforma
              </Button>
            </div>
            <Button type="button" variant="ghost" onClick={openPage}>
              Abrir página
              <ExternalLink className="ml-2 h-4 w-4" />
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
