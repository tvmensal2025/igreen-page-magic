import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight, BookOpen, ExternalLink, HelpCircle, MessageCircle, Play, RefreshCw, Sparkles, X } from "lucide-react";
import { useTour } from "./useTour";
import { GuideCoach } from "./GuideCoach";
import { useGuideCoach } from "./GuideCoachProvider";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ADMIN_TAB_CHANGED_EVENT, isAdminDashboardSurface } from "@/lib/adminDashboardSurface";

const INTERNAL_ROUTES = ["/admin", "/ajuda", "/consultor", "/super-admin", "/experiments"];
const TARGET_PADDING = 8;
/** Abas do Admin demoram a montar após navigate — mais tentativas que o padrão antigo. */
const LOCATE_ATTEMPTS = 24;
const LOCATE_INTERVAL_MS = 300;
/** Espaço reservado para o card quando ele fica embaixo (conteúdo longo). */
const CARD_RESERVE_BOTTOM = 220;
const CARD_WIDTH = 420;

type TargetRect = { top: number; left: number; width: number; height: number };
type CardPlacement = "bottom" | "right" | "left" | "top";

function isMenuSelector(selector: string | null | undefined): boolean {
  return !!selector && selector.includes("menu-");
}

function isSidebarWhole(selector: string | null | undefined): boolean {
  return !!selector && selector.includes("menu-lateral");
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function computeHighlight(rect: DOMRect, selector: string | null | undefined): TargetRect {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const menu = isMenuSelector(selector);
  const wholeSidebar = isSidebarWhole(selector);

  const rawTop = rect.top - TARGET_PADDING;
  const rawLeft = rect.left - TARGET_PADDING;
  const rawWidth = rect.width + TARGET_PADDING * 2;
  const rawHeight = rect.height + TARGET_PADDING * 2;

  // Menu lateral / itens do menu: nunca cortar o alvo — só encaixar na viewport.
  // Conteúdo longo (dashboard etc.): limita altura para o card inferior continuar legível.
  const maxHighlight = menu
    ? vh - 16
    : Math.max(160, vh - CARD_RESERVE_BOTTOM - 24);

  const top = clamp(rawTop, 8, vh - 24);
  const left = clamp(rawLeft, 8, vw - 24);
  let width = Math.min(rawWidth, vw - left - 8);
  let height = Math.min(rawHeight, maxHighlight, vh - top - 8);

  // Sidebar inteira: destaca a coluna visível (sem estourar a direita / card).
  if (wholeSidebar) {
    const sideRoom = vw >= 900 ? CARD_WIDTH + 32 : 16;
    width = Math.min(rawWidth, Math.max(120, vw - left - sideRoom));
    // No mobile o card fica embaixo — reserva espaço pra não cobrir o destaque.
    const bottomReserve = vw < 720 ? CARD_RESERVE_BOTTOM : 8;
    height = Math.min(rawHeight, vh - top - bottomReserve);
  }

  // Itens do menu: garante highlight “inteiro” mesmo se o rect veio parcial por overflow.
  if (menu && !wholeSidebar) {
    height = Math.min(Math.max(rawHeight, rect.height + TARGET_PADDING * 2), vh - top - 8);
    width = Math.min(Math.max(rawWidth, 160), vw - left - 8);
  }

  return { top, left, width: Math.max(40, width), height: Math.max(40, height) };
}

function computeCardPlacement(target: TargetRect | null, selector: string | null | undefined): CardPlacement {
  if (!target) return "bottom";
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const menu = isMenuSelector(selector);

  if (menu && vw >= 720) {
    const rightSpace = vw - (target.left + target.width);
    if (rightSpace >= CARD_WIDTH + 24) return "right";
  }

  const belowSpace = vh - (target.top + target.height);
  if (belowSpace < CARD_RESERVE_BOTTOM && target.top > CARD_RESERVE_BOTTOM + 24) return "top";

  if (!menu && target.left > vw * 0.55 && target.left - 24 >= CARD_WIDTH) return "left";

  return "bottom";
}

export function TourProvider() {
  const location = useLocation();
  const navigate = useNavigate();
  const tour = useTour();
  const guide = useGuideCoach();
  const { ready, shouldAutoStart, progress, open, current, index, total, start, resume, restart, next, prev, dismiss } = tour;
  const [targetRect, setTargetRect] = useState<TargetRect | null>(null);
  const [viewportTick, setViewportTick] = useState(0);

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
    let measureTimer = 0;
    let cancelled = false;
    const selector = current.selector;
    const menuTarget = isMenuSelector(selector);

    const applyRect = (element: HTMLElement) => {
      if (cancelled) return;
      const rect = element.getBoundingClientRect();
      if (rect.width < 2 && rect.height < 2) {
        if (attempts++ < LOCATE_ATTEMPTS) timer = window.setTimeout(locate, LOCATE_INTERVAL_MS);
        else setTargetRect(null);
        return;
      }
      setTargetRect(computeHighlight(rect, selector));
    };

    const measure = (element: HTMLElement) => {
      // Áreas grandes (ex.: Dashboard) alinham no topo; itens do menu centralizam no nav.
      const preferTop = (selector || "").includes("dashboard") || isSidebarWhole(selector);
      element.scrollIntoView({
        behavior: "smooth",
        block: preferTop ? "nearest" : "center",
        inline: "nearest",
      });
      // Sidebar tem transition 300ms ao expandir — espera antes de medir.
      const delay = menuTarget ? 360 : 280;
      measureTimer = window.setTimeout(() => applyRect(element), delay);
    };

    const locate = () => {
      const element = document.querySelector<HTMLElement>(selector || "");
      if (!element) {
        if (attempts++ < LOCATE_ATTEMPTS) timer = window.setTimeout(locate, LOCATE_INTERVAL_MS);
        else setTargetRect(null);
        return;
      }
      measure(element);
    };

    // Pequeno atraso inicial para a rota/?tab= + expand do menu terminarem de renderizar
    timer = window.setTimeout(locate, menuTarget ? 320 : 200);

    let scrollDebounce = 0;
    const refresh = () => {
      attempts = 0;
      const element = document.querySelector<HTMLElement>(selector || "");
      if (element) applyRect(element);
      else locate();
      setViewportTick((t) => t + 1);
    };
    const onScroll = () => {
      window.clearTimeout(scrollDebounce);
      scrollDebounce = window.setTimeout(refresh, 80);
    };

    window.addEventListener("resize", refresh);
    // Scroll do nav do sidebar (overflow) e da página deslocam o alvo.
    window.addEventListener("scroll", onScroll, true);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.clearTimeout(measureTimer);
      window.clearTimeout(scrollDebounce);
      window.removeEventListener("resize", refresh);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open, current?.id, current?.selector, location.pathname, location.search]);

  const cardPlacement = useMemo(
    () => computeCardPlacement(targetRect, current?.selector),
    // viewportTick força recalcular após resize/scroll
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [targetRect, current?.selector, viewportTick],
  );

  const cardStyle = useMemo((): CSSProperties => {
    const base: CSSProperties = {
      width: `min(calc(100vw - 2rem), ${CARD_WIDTH}px)`,
      maxWidth: "calc(100vw - 2rem)",
    };
    if (!targetRect) {
      return { ...base, left: "50%", bottom: "1.25rem", transform: "translateX(-50%)" };
    }

    if (cardPlacement === "right") {
      const left = Math.min(
        window.innerWidth - CARD_WIDTH - 16,
        targetRect.left + targetRect.width + 16,
      );
      const top = clamp(targetRect.top, 16, window.innerHeight - CARD_RESERVE_BOTTOM - 16);
      return { ...base, left, top, transform: "none" };
    }

    if (cardPlacement === "left") {
      const left = Math.max(16, targetRect.left - CARD_WIDTH - 16);
      const top = clamp(targetRect.top, 16, window.innerHeight - CARD_RESERVE_BOTTOM - 16);
      return { ...base, left, top, transform: "none" };
    }

    if (cardPlacement === "top") {
      const bottom = Math.max(16, window.innerHeight - targetRect.top + 12);
      return { ...base, left: "50%", bottom, transform: "translateX(-50%)" };
    }

    return { ...base, left: "50%", bottom: "1.25rem", transform: "translateX(-50%)" };
  }, [cardPlacement, targetRect]);

  const [onDashboard, setOnDashboard] = useState(() => isAdminDashboardSurface(location.pathname));
  useEffect(() => {
    const refresh = () => setOnDashboard(isAdminDashboardSurface(location.pathname));
    refresh();
    window.addEventListener(ADMIN_TAB_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(ADMIN_TAB_CHANGED_EVENT, refresh);
  }, [location.pathname]);

  const isInternal = INTERNAL_ROUTES.some((route) => location.pathname === route || location.pathname.startsWith(`${route}/`));
  if (!isInternal) return null;

  const hasProgress = !!progress && (progress.current_step ?? 0) > 0 && !progress.completed_at;
  const percentage = total > 0 ? ((index + 1) / total) * 100 : 0;
  const isLast = index >= total - 1;
  const guideActive = guide.active;
  // FAB só no Dashboard — nas outras abas/rotas atrapalha o conteúdo
  const showFab = !open && !guideActive && onDashboard;

  return (
    <>
      {open && current && (
        <div className="fixed inset-0 z-[110] pointer-events-none" role="dialog" aria-modal="true" aria-labelledby="tour-title" aria-describedby="tour-description">
          {targetRect ? (
            <div
              className="fixed rounded-xl ring-4 ring-primary/70 transition-all duration-300"
              style={{
                top: targetRect.top,
                left: targetRect.left,
                width: targetRect.width,
                height: targetRect.height,
                boxShadow: "0 0 0 9999px hsl(var(--background) / 0.72)",
              }}
              aria-hidden="true"
            />
          ) : (
            <div className="fixed inset-0 bg-background/70" aria-hidden="true" />
          )}

          <div className="fixed pointer-events-auto z-[111]" style={cardStyle}>
            <div className="overflow-hidden rounded-2xl border border-primary/20 bg-background shadow-2xl max-h-[min(70vh,560px)] flex flex-col">
              <div className="relative border-b bg-primary/5 px-5 pb-3 pt-4 shrink-0">
                <button type="button" onClick={() => void dismiss()} className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Fechar o tour">
                  <X className="h-4 w-4" />
                </button>
                <div className="flex items-center gap-2 text-xs font-semibold text-primary">
                  <Sparkles className="h-3.5 w-3.5" />
                  Orientação {index + 1} de {total}
                </div>
                <h2 id="tour-title" className="mt-2 pr-8 text-lg font-bold leading-tight">{current.title || `Passo ${current.order_index}`}</h2>
              </div>
              <div className="space-y-3 px-5 py-4 overflow-y-auto min-h-0">
                <p id="tour-description" className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">{current.body || "Este conteúdo está sendo preparado."}</p>
                {current.selector && !targetRect && <p className="text-xs text-muted-foreground">O item ainda não apareceu nesta tela. Use o botão abaixo para abrir a área ou siga para o próximo passo.</p>}
                {current.cta_href && (
                  <Button variant="outline" size="sm" onClick={() => current.cta_href?.startsWith("http") ? window.open(current.cta_href, "_blank", "noopener,noreferrer") : navigate(current.cta_href)}>
                    {current.cta_label || "Abrir esta área"}<ExternalLink className="ml-2 h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
              <div className="px-5 shrink-0"><Progress value={percentage} className="h-1.5" aria-label={`Progresso do tour: ${index + 1} de ${total}`} /></div>
              <div className="flex flex-col-reverse gap-2 bg-muted/30 px-5 py-3 sm:flex-row sm:items-center sm:justify-between shrink-0">
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
