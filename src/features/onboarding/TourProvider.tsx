import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { AlertTriangle, ArrowLeft, ArrowRight, BookOpen, ExternalLink, HelpCircle, MessageCircle, Play, RefreshCw, Sparkles, X } from "lucide-react";
import { useTour } from "./useTour";
import { GuideCoach } from "./GuideCoach";
import { useGuideCoach } from "./GuideCoachProvider";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ADMIN_TAB_CHANGED_EVENT, isAdminDashboardSurface } from "@/lib/adminDashboardSurface";
import { getHelpArticleById } from "@/features/help/helpCatalog";
import { resolveGuideSlugFromLocation } from "@/features/help/tabGuideMap";
import {
  CARD_RESERVE_BOTTOM,
  CARD_WIDTH,
  LOCATE_ATTEMPTS,
  LOCATE_INTERVAL_MS,
  clamp,
  computeCardPlacement,
  computeHighlight,
  isMenuSelector,
  isSidebarWhole,
  prepareGuideTarget,
  queryGuideTargetChain,
  waitTourFrames,
  type TargetRect,
} from "./tourHighlight";

const INTERNAL_ROUTES = ["/admin", "/ajuda", "/consultor", "/super-admin", "/experiments"];

/** Bloco opcional `[[ALERT]]…[[/ALERT]]` no body do tour → callout visual. */
function splitTourBody(body: string): { intro: string; alertTitle: string | null; alertBody: string | null } {
  const match = body.match(/\[\[ALERT\]\]\s*([\s\S]*?)\s*\[\[\/ALERT\]\]/);
  if (!match) return { intro: body, alertTitle: null, alertBody: null };
  const alertRaw = match[1].trim();
  const nl = alertRaw.indexOf("\n");
  const alertTitle = nl === -1 ? alertRaw : alertRaw.slice(0, nl).trim();
  const alertBody = nl === -1 ? null : alertRaw.slice(nl + 1).trim() || null;
  const intro = body.replace(match[0], "").replace(/\n{3,}/g, "\n\n").trim();
  return { intro, alertTitle: alertTitle || null, alertBody };
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

  // Auto-start só no Dashboard, depois do setup (gate + prefs). Nunca no meio do preenchimento.
  useEffect(() => {
    if (!ready || !shouldAutoStart || open) return;
    if (!location.pathname.startsWith("/admin")) return;

    let cancelled = false;
    let timer = 0;
    let attempts = 0;
    const MAX_ATTEMPTS = 180; // ~90s — cobre gate + modal de automações
    const INTERVAL_MS = 500;

    let clearStreak = 0;
    const STABLE_TICKS = 2; // ~1s livre de blockers antes de abrir

    const canStartNow = () => {
      if (!isAdminDashboardSurface(location.pathname)) return false;
      if (document.querySelector("[data-tour-blocker]")) return false;
      return !!document.querySelector('[data-tour="dashboard"]');
    };

    const tryStart = () => {
      if (cancelled) return;
      if (canStartNow()) {
        clearStreak += 1;
        if (clearStreak >= STABLE_TICKS) {
          void start();
          return;
        }
      } else {
        clearStreak = 0;
      }
      if (attempts++ < MAX_ATTEMPTS) {
        timer = window.setTimeout(tryStart, INTERVAL_MS);
      }
    };

    timer = window.setTimeout(tryStart, 800);

    const onTab = () => {
      if (cancelled || open) return;
      window.clearTimeout(timer);
      attempts = 0;
      timer = window.setTimeout(tryStart, 300);
    };

    window.addEventListener(ADMIN_TAB_CHANGED_EVENT, onTab);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.removeEventListener(ADMIN_TAB_CHANGED_EVENT, onTab);
    };
  }, [ready, shouldAutoStart, location.pathname, start, open]);

  useEffect(() => {
    if (!open || !current?.selector) {
      setTargetRect(null);
      return;
    }
    let attempts = 0;
    let timer = 0;
    let measureTimer = 0;
    let cancelled = false;
    let lockedHard = false;
    const selector = current.selector;
    const stepRoute = current?.route || current?.cta_href;
    const menuTarget = isMenuSelector(selector);
    let activeMatched = selector;

    const applyRect = (element: HTMLElement, matchedSelector: string) => {
      if (cancelled) return;
      const rect = element.getBoundingClientRect();
      if (rect.width < 2 && rect.height < 2) {
        if (attempts++ < LOCATE_ATTEMPTS) timer = window.setTimeout(() => void locate(), LOCATE_INTERVAL_MS);
        else setTargetRect(null);
        return;
      }
      activeMatched = matchedSelector;
      setTargetRect(computeHighlight(rect, matchedSelector));
    };

    const measure = (element: HTMLElement, matchedSelector: string) => {
      const preferTop =
        matchedSelector.includes("dashboard") || isSidebarWhole(matchedSelector);
      element.scrollIntoView({
        behavior: "smooth",
        block: preferTop ? "nearest" : "center",
        inline: "nearest",
      });
      const delay = isMenuSelector(matchedSelector) ? 360 : 280;
      measureTimer = window.setTimeout(() => applyRect(element, matchedSelector), delay);
    };

    const locate = async () => {
      if (cancelled || lockedHard) return;

      prepareGuideTarget(selector);
      await waitTourFrames(2);
      if (cancelled || lockedHard) return;

      const nearEnd = attempts >= LOCATE_ATTEMPTS - 6;

      const preferred = queryGuideTargetChain(selector, stepRoute, {
        prepare: true,
        allowSoft: false,
        allowSecondary: false,
      });
      if (preferred) {
        lockedHard = true;
        measure(preferred.element, preferred.matchedSelector);
        return;
      }

      if (nearEnd) {
        const secondary = queryGuideTargetChain(selector, stepRoute, {
          prepare: false,
          allowSoft: false,
          allowSecondary: true,
        });
        if (secondary) {
          lockedHard = true;
          measure(secondary.element, secondary.matchedSelector);
          return;
        }
      }

      const soft = queryGuideTargetChain(selector, stepRoute, {
        prepare: false,
        allowSoft: true,
        allowSecondary: false,
      });
      if (soft) {
        activeMatched = soft.matchedSelector;
        setTargetRect(computeHighlight(soft.element.getBoundingClientRect(), soft.matchedSelector));
      }

      if (attempts++ < LOCATE_ATTEMPTS) {
        timer = window.setTimeout(() => void locate(), LOCATE_INTERVAL_MS);
        return;
      }

      const lastSecondary = queryGuideTargetChain(selector, stepRoute, {
        prepare: false,
        allowSoft: false,
        allowSecondary: true,
      });
      if (lastSecondary) {
        lockedHard = true;
        measure(lastSecondary.element, lastSecondary.matchedSelector);
        return;
      }
      if (soft) {
        lockedHard = true;
        measure(soft.element, soft.matchedSelector);
        return;
      }
      setTargetRect(null);
    };

    timer = window.setTimeout(() => void locate(), menuTarget ? 320 : 200);

    let scrollDebounce = 0;
    const refresh = () => {
      if (cancelled) return;
      const hard = queryGuideTargetChain(selector, stepRoute, {
        prepare: false,
        allowSoft: false,
      });
      if (hard) {
        lockedHard = true;
        applyRect(hard.element, hard.matchedSelector);
      } else if (lockedHard) {
        const still = queryGuideTargetChain(activeMatched, stepRoute, {
          prepare: false,
          allowSoft: true,
        });
        if (still) applyRect(still.element, still.matchedSelector);
      }
      setViewportTick((t) => t + 1);
    };
    const onScroll = () => {
      window.clearTimeout(scrollDebounce);
      scrollDebounce = window.setTimeout(refresh, 80);
    };

    const mo = new MutationObserver(() => {
      if (cancelled || lockedHard) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void locate(), 160);
    });
    mo.observe(document.body, { childList: true, subtree: true });

    window.addEventListener("resize", refresh);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      cancelled = true;
      mo.disconnect();
      window.clearTimeout(timer);
      window.clearTimeout(measureTimer);
      window.clearTimeout(scrollDebounce);
      window.removeEventListener("resize", refresh);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open, current?.id, current?.selector, location.pathname, location.search]);

  const cardPlacement = useMemo(
    () => computeCardPlacement(targetRect, current?.selector),
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

  const [onInternalHelpSurface, setOnInternalHelpSurface] = useState(() =>
    INTERNAL_ROUTES.some((route) => location.pathname === route || location.pathname.startsWith(`${route}/`)),
  );
  useEffect(() => {
    const refresh = () => {
      setOnInternalHelpSurface(
        INTERNAL_ROUTES.some((route) => location.pathname === route || location.pathname.startsWith(`${route}/`)),
      );
    };
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
  // FAB clicável fora de tour/guia. Mantém âncora no DOM durante guia (fallback de highlight).
  const showFabInteractive = !open && !guideActive && onInternalHelpSurface;
  const showFabAnchor = showFabInteractive || open || !!guideActive;

  const openPageGuide = () => {
    const entry = document.querySelector<HTMLElement>('[data-tour="guide-entry"]');
    if (entry) {
      entry.click();
      return;
    }
    const slug = resolveGuideSlugFromLocation(location.pathname, location.search);
    const article = getHelpArticleById(slug);
    if (article) guide.startGuide(article);
    else navigate("/ajuda");
  };
  const bodyParts = splitTourBody(current?.body || "");

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
                <div id="tour-description" className="space-y-3">
                  <p className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
                    {bodyParts.intro || "Este conteúdo está sendo preparado."}
                  </p>
                  {bodyParts.alertTitle && (
                    <div
                      role="alert"
                      className="rounded-xl border-2 border-amber-500/50 bg-amber-500/10 px-3.5 py-3 shadow-sm"
                    >
                      <div className="flex gap-2.5">
                        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
                        <div className="min-w-0 space-y-1.5">
                          <p className="text-sm font-bold leading-snug text-amber-800 dark:text-amber-300">
                            {bodyParts.alertTitle}
                          </p>
                          {bodyParts.alertBody && (
                            <p className="whitespace-pre-line text-sm leading-relaxed text-amber-900/90 dark:text-amber-100/90">
                              {bodyParts.alertBody}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
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

      {showFabAnchor && (
        <div
          className={`fixed bottom-5 right-4 z-[90] sm:right-5 ${showFabInteractive ? "" : "pointer-events-none"}`}
          data-tour="help-fab"
          aria-hidden={!showFabInteractive}
        >
          {showFabInteractive ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="lg"
                  variant="outline"
                  className="relative h-12 w-12 rounded-full border-border/80 bg-background/95 text-muted-foreground shadow-md backdrop-blur-sm hover:bg-muted hover:text-foreground"
                  aria-label="Abrir ajuda"
                  title="Ajuda — toque aqui"
                >
                  <HelpCircle className="h-6 w-6" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-72">
                <DropdownMenuLabel>Como podemos ajudar?</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={openPageGuide}>
                  <HelpCircle className="mr-2 h-4 w-4" />
                  Ajuda desta tela
                </DropdownMenuItem>
                {hasProgress && (
                  <DropdownMenuItem onClick={() => resume()}>
                    <Play className="mr-2 h-4 w-4" />
                    Continuar orientação
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={() => restart()}>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  {hasProgress ? "Reiniciar orientação" : "Conhecer a plataforma"}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate("/ajuda")}>
                  <BookOpen className="mr-2 h-4 w-4" />
                  Central de ajuda
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => window.dispatchEvent(new CustomEvent("open-support-chat"))}>
                  <MessageCircle className="mr-2 h-4 w-4" />
                  Perguntar ao suporte com IA
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <div className="h-12 w-12 rounded-full border border-border/50 bg-muted/40" />
          )}
        </div>
      )}
    </>
  );
}
