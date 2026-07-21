import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight, BookOpen, ExternalLink, HelpCircle, MessageCircle, Play, RefreshCw, Sparkles, X } from "lucide-react";
import { useTour } from "./useTour";
import { GuideCoach } from "./GuideCoach";
import { useGuideCoach } from "./GuideCoachProvider";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

const INTERNAL_ROUTES = ["/admin", "/ajuda", "/consultor", "/super-admin", "/experiments"];
const TARGET_PADDING = 8;
/** Abas do Admin demoram a montar após navigate — mais tentativas que o padrão antigo. */
const LOCATE_ATTEMPTS = 24;
const LOCATE_INTERVAL_MS = 300;

type TargetRect = { top: number; left: number; width: number; height: number };

export function TourProvider() {
  const location = useLocation();
  const navigate = useNavigate();
  const tour = useTour();
  const guide = useGuideCoach();
  const { ready, shouldAutoStart, progress, open, current, index, total, start, resume, restart, next, prev, dismiss } = tour;
  const [targetRect, setTargetRect] = useState<TargetRect | null>(null);

  useEffect(() => {
    if (!open || !current?.selector?.includes("menu-")) return;
    window.dispatchEvent(new CustomEvent("igreen-open-sidebar"));
  }, [open, current?.id, current?.selector]);

  useEffect(() => {
    if (!ready || !location.pathname.startsWith("/admin") || !shouldAutoStart) return;
    const timer = window.setTimeout(() => void start(), 600);
    return () => window.clearTimeout(timer);
  }, [ready, shouldAutoStart, location.pathname, start]);

  useEffect(() => {
    if (!open || !current?.selector) {
      setTargetRect(null);
      return;
    }
    let attempts = 0;
    let timer = 0;
    let cancelled = false;

    const measure = (element: HTMLElement) => {
      // Áreas grandes (ex.: Dashboard) alinham no topo para o destaque não “sumir” atrás do card do tour
      const preferTop = (current.selector || "").includes("dashboard");
      element.scrollIntoView({ behavior: "smooth", block: preferTop ? "start" : "center", inline: "center" });
      window.setTimeout(() => {
        if (cancelled) return;
        const rect = element.getBoundingClientRect();
        if (rect.width < 2 && rect.height < 2) {
          if (attempts++ < LOCATE_ATTEMPTS) timer = window.setTimeout(locate, LOCATE_INTERVAL_MS);
          else setTargetRect(null);
          return;
        }
        // Limita a altura do spotlight para o conteúdo longo não cobrir o card inferior
        const maxHighlight = Math.max(160, window.innerHeight * 0.48);
        const rawHeight = rect.height + TARGET_PADDING * 2;
        setTargetRect({
          top: Math.max(8, rect.top - TARGET_PADDING),
          left: Math.max(8, rect.left - TARGET_PADDING),
          width: Math.min(rect.width + TARGET_PADDING * 2, window.innerWidth - 16),
          height: Math.min(rawHeight, maxHighlight),
        });
      }, 280);
    };

    const locate = () => {
      const element = document.querySelector<HTMLElement>(current.selector || "");
      if (!element) {
        if (attempts++ < LOCATE_ATTEMPTS) timer = window.setTimeout(locate, LOCATE_INTERVAL_MS);
        else setTargetRect(null);
        return;
      }
      measure(element);
    };

    // Pequeno atraso inicial para a rota/?tab= terminar de renderizar
    timer = window.setTimeout(locate, 200);
    const refresh = () => {
      attempts = 0;
      locate();
    };
    window.addEventListener("resize", refresh);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.removeEventListener("resize", refresh);
    };
  }, [open, current?.id, current?.selector, location.pathname, location.search]);

  const isInternal = INTERNAL_ROUTES.some((route) => location.pathname === route || location.pathname.startsWith(`${route}/`));
  if (!isInternal) return null;

  const hasProgress = !!progress && (progress.current_step ?? 0) > 0 && !progress.completed_at;
  const percentage = total > 0 ? ((index + 1) / total) * 100 : 0;
  const isLast = index >= total - 1;
  const guideActive = guide.active;
  const showFab = !open && !guideActive;

  return (
    <>
      {open && current && (
        <div className="fixed inset-0 z-[110] pointer-events-none" role="dialog" aria-modal="true" aria-labelledby="tour-title" aria-describedby="tour-description">
          {targetRect ? (
            <div
              className="fixed rounded-xl ring-4 ring-primary/70 transition-all duration-300"
              style={{ top: targetRect.top, left: targetRect.left, width: targetRect.width, height: targetRect.height, boxShadow: "0 0 0 9999px hsl(var(--background) / 0.72)" }}
              aria-hidden="true"
            />
          ) : <div className="fixed inset-0 bg-background/70" aria-hidden="true" />}

          <div className="fixed bottom-4 left-1/2 w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 pointer-events-auto sm:bottom-6">
            <div className="overflow-hidden rounded-2xl border border-primary/20 bg-background shadow-2xl">
              <div className="relative border-b bg-primary/5 px-5 pb-3 pt-4">
                <button type="button" onClick={() => void dismiss()} className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Fechar o tour">
                  <X className="h-4 w-4" />
                </button>
                <div className="flex items-center gap-2 text-xs font-semibold text-primary">
                  <Sparkles className="h-3.5 w-3.5" />
                  Orientação {index + 1} de {total}
                </div>
                <h2 id="tour-title" className="mt-2 pr-8 text-lg font-bold leading-tight">{current.title || `Passo ${current.order_index}`}</h2>
              </div>
              <div className="space-y-3 px-5 py-4">
                <p id="tour-description" className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">{current.body || "Este conteúdo está sendo preparado."}</p>
                {current.selector && !targetRect && <p className="text-xs text-muted-foreground">O item ainda não apareceu nesta tela. Use o botão abaixo para abrir a área ou siga para o próximo passo.</p>}
                {current.cta_href && (
                  <Button variant="outline" size="sm" onClick={() => current.cta_href?.startsWith("http") ? window.open(current.cta_href, "_blank", "noopener,noreferrer") : navigate(current.cta_href)}>
                    {current.cta_label || "Abrir esta área"}<ExternalLink className="ml-2 h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
              <div className="px-5"><Progress value={percentage} className="h-1.5" aria-label={`Progresso do tour: ${index + 1} de ${total}`} /></div>
              <div className="flex flex-col-reverse gap-2 bg-muted/30 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
                <Button variant="ghost" size="sm" onClick={() => void dismiss()} className="text-muted-foreground">Encerrar tour</Button>
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="outline" size="sm" onClick={() => void prev()} disabled={index === 0}><ArrowLeft className="mr-1 h-4 w-4" />Anterior</Button>
                  <Button size="sm" onClick={() => void next()}>{isLast ? "Concluir" : "Próximo"}{!isLast && <ArrowRight className="ml-1 h-4 w-4" />}</Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {!open && guideActive && (
        <GuideCoach
          article={guideActive.article}
          stepIndex={guideActive.stepIndex}
          onStepIndexChange={guide.setStepIndex}
          onClose={guide.closeGuide}
          onOpenFullTour={() => {
            const stepId = guideActive.article.related_tour_step_id;
            guide.closeGuide();
            void start(stepId ? { stepId } : undefined);
          }}
        />
      )}

      {showFab && (
        <div className="fixed bottom-5 right-4 z-[90] sm:right-5" data-tour="help-fab">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="lg" className="h-14 w-14 rounded-full shadow-2xl transition-transform hover:scale-105" aria-label="Abrir opções de ajuda"><HelpCircle className="h-6 w-6" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72">
              <DropdownMenuLabel>Como podemos ajudar?</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {hasProgress && <DropdownMenuItem onClick={() => resume()}><Play className="mr-2 h-4 w-4" />Continuar orientação</DropdownMenuItem>}
              <DropdownMenuItem onClick={() => restart()}><RefreshCw className="mr-2 h-4 w-4" />{hasProgress ? "Reiniciar orientação" : "Conhecer a plataforma"}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate("/ajuda")}><BookOpen className="mr-2 h-4 w-4" />Buscar um passo a passo</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => window.dispatchEvent(new CustomEvent("open-support-chat"))}><MessageCircle className="mr-2 h-4 w-4" />Perguntar ao suporte com IA</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </>
  );
}
