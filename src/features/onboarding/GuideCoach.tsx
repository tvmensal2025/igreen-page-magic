import { useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight, ExternalLink, Play, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import type { HelpArticle } from "@/features/help/helpCatalog";

type GuideCoachProps = {
  article: HelpArticle;
  stepIndex: number;
  onStepIndexChange: (index: number) => void;
  onClose: () => void;
  onOpenFullTour?: () => void;
};

export function GuideCoach({ article, stepIndex, onStepIndexChange, onClose, onOpenFullTour }: GuideCoachProps) {
  const navigate = useNavigate();
  const total = Math.max(1, article.steps.length);
  const safeIndex = Math.max(0, Math.min(stepIndex, total - 1));
  const currentStep = article.steps[safeIndex] || article.summary;
  const percentage = ((safeIndex + 1) / total) * 100;
  const isLast = safeIndex >= total - 1;

  return (
    <div className="fixed inset-0 z-[110] pointer-events-none" role="dialog" aria-modal="true" aria-labelledby="guide-coach-title" aria-describedby="guide-coach-description">
      <div className="fixed inset-0 bg-background/50" aria-hidden="true" />
      <div className="fixed bottom-4 left-1/2 w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 pointer-events-auto sm:bottom-6">
        <div className="overflow-hidden rounded-2xl border border-primary/20 bg-background shadow-2xl">
          <div className="relative border-b bg-primary/5 px-5 pb-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Fechar o guia"
            >
              <X className="h-4 w-4" />
            </button>
            <div className="text-xs font-semibold text-primary">Guia {safeIndex + 1} de {total}</div>
            <h2 id="guide-coach-title" className="mt-2 pr-8 text-lg font-bold leading-tight">{article.title}</h2>
            <p className="mt-1 text-xs text-muted-foreground">{article.category} · siga o texto e clique exatamente onde indicado</p>
          </div>
          <div className="space-y-3 px-5 py-4">
            <p id="guide-coach-description" className="text-sm leading-relaxed text-muted-foreground">{currentStep}</p>
            {article.href && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (article.href.startsWith("http")) window.open(article.href, "_blank", "noopener,noreferrer");
                  else navigate(article.href);
                }}
              >
                Abrir esta área
                <ExternalLink className="ml-2 h-3.5 w-3.5" />
              </Button>
            )}
            {article.related_tour_step_id && onOpenFullTour && (
              <Button variant="ghost" size="sm" className="h-auto px-0 text-primary" onClick={onOpenFullTour}>
                <Play className="mr-1.5 h-3.5 w-3.5" />
                Continuar no tour completo
              </Button>
            )}
          </div>
          <div className="px-5">
            <Progress value={percentage} className="h-1.5" aria-label={`Progresso do guia: ${safeIndex + 1} de ${total}`} />
          </div>
          <div className="flex flex-col-reverse gap-2 bg-muted/30 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
            <Button variant="ghost" size="sm" onClick={onClose} className="text-muted-foreground">Encerrar</Button>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" size="sm" onClick={() => onStepIndexChange(safeIndex - 1)} disabled={safeIndex === 0}>
                <ArrowLeft className="mr-1 h-4 w-4" />
                Anterior
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  if (isLast) onClose();
                  else onStepIndexChange(safeIndex + 1);
                }}
              >
                {isLast ? "Concluir" : "Próximo"}
                {!isLast && <ArrowRight className="ml-1 h-4 w-4" />}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
