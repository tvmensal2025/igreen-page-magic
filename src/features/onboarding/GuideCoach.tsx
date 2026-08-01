import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight, ExternalLink, Loader2, Play, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import type { HelpArticle } from "@/features/help/helpCatalog";
import { resolveGuideSteps } from "@/features/help/helpCatalog";
import { ADMIN_TAB_CHANGED_EVENT } from "@/lib/adminDashboardSurface";
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
  navigateAdminForGuide,
  prepareGuideTarget,
  queryGuideTargetChain,
  waitTourFrames,
  type TargetRect,
} from "./tourHighlight";

type GuideCoachProps = {
  article: HelpArticle;
  stepIndex: number;
  onStepIndexChange: (index: number) => void;
  onClose: () => void;
  onOpenFullTour?: () => void;
};

export function GuideCoach({ article, stepIndex, onStepIndexChange, onClose, onOpenFullTour }: GuideCoachProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const guided = useMemo(() => resolveGuideSteps(article), [article]);
  const total = Math.max(1, guided.length);
  const safeIndex = Math.max(0, Math.min(stepIndex, total - 1));
  const current = guided[safeIndex] || { text: article.summary, route: article.href };
  const percentage = ((safeIndex + 1) / total) * 100;
  const isLast = safeIndex >= total - 1;
  const stepRoute = current.route || article.href;

  const [targetRect, setTargetRect] = useState<TargetRect | null>(null);
  const [activeSelector, setActiveSelector] = useState<string | null>(current.selector || null);
  const [viewportTick, setViewportTick] = useState(0);
  const [locateFailed, setLocateFailed] = useState(false);
  const [locating, setLocating] = useState(true);
  const [softPreview, setSoftPreview] = useState(false);
  const [tabEpoch, setTabEpoch] = useState(0);

  useEffect(() => {
    navigateAdminForGuide(navigate, stepRoute);
    prepareGuideTarget(current.selector);
  }, [safeIndex, stepRoute, current.selector, navigate]);

  useEffect(() => {
    const onTab = () => setTabEpoch((n) => n + 1);
    window.addEventListener(ADMIN_TAB_CHANGED_EVENT, onTab);
    return () => window.removeEventListener(ADMIN_TAB_CHANGED_EVENT, onTab);
  }, []);

  useEffect(() => {
    let attempts = 0;
    let timer = 0;
    let measureTimer = 0;
    let cancelled = false;
    /** Só trava quando achou alvo HARD (ou soft no último recurso). */
    const lockedHard = { current: false };

    setLocateFailed(false);
    setLocating(true);
    setSoftPreview(false);
    setTargetRect(null);

    const applyRect = (element: HTMLElement, matchedSelector: string, soft: boolean) => {
      if (cancelled) return;
      const rect = element.getBoundingClientRect();
      if (rect.width < 2 && rect.height < 2) {
        lockedHard.current = false;
        if (attempts++ < LOCATE_ATTEMPTS) timer = window.setTimeout(() => void locate(), LOCATE_INTERVAL_MS);
        else {
          setTargetRect(null);
          setLocateFailed(true);
          setLocating(false);
        }
        return;
      }
      setActiveSelector(matchedSelector);
      setTargetRect(computeHighlight(rect, matchedSelector));
      setSoftPreview(soft);
      if (!soft) {
        lockedHard.current = true;
        setLocateFailed(false);
        setLocating(false);
      }
    };

    const measure = (element: HTMLElement, matchedSelector: string, soft: boolean) => {
      const preferTop =
        matchedSelector.includes("dashboard") || isSidebarWhole(matchedSelector);
      element.scrollIntoView({
        behavior: "smooth",
        block: preferTop ? "nearest" : "center",
        inline: "nearest",
      });
      const delay = isMenuSelector(matchedSelector) ? 360 : 280;
      measureTimer = window.setTimeout(() => applyRect(element, matchedSelector, soft), delay);
    };

    const locate = async () => {
      if (cancelled || lockedHard.current) return;

      prepareGuideTarget(current.selector);
      await waitTourFrames(2);
      if (cancelled || lockedHard.current) return;

      const nearEnd = attempts >= LOCATE_ATTEMPTS - 6;

      // 1) Preferred (alvo real) — sem menu/Ajuda
      const preferred = queryGuideTargetChain(current.selector, stepRoute, {
        prepare: true,
        allowSoft: false,
        allowSecondary: false,
      });
      if (preferred) {
        measure(preferred.element, preferred.matchedSelector, false);
        return;
      }

      // 2) Quase no fim: aceita menu da rota
      if (nearEnd) {
        const secondary = queryGuideTargetChain(current.selector, stepRoute, {
          prepare: false,
          allowSoft: false,
          allowSecondary: true,
        });
        if (secondary) {
          measure(secondary.element, secondary.matchedSelector, false);
          return;
        }
      }

      // 3) Preview soft SEM travar — continua tentando o alvo real
      const soft = queryGuideTargetChain(current.selector, stepRoute, {
        prepare: false,
        allowSoft: true,
        allowSecondary: false,
      });
      if (soft) {
        setActiveSelector(soft.matchedSelector);
        setTargetRect(computeHighlight(soft.element.getBoundingClientRect(), soft.matchedSelector));
        setSoftPreview(true);
        setLocating(true);
      }

      if (attempts++ < LOCATE_ATTEMPTS) {
        timer = window.setTimeout(() => void locate(), LOCATE_INTERVAL_MS);
        return;
      }

      // 4) Último recurso: menu → soft
      const lastSecondary = queryGuideTargetChain(current.selector, stepRoute, {
        prepare: false,
        allowSoft: false,
        allowSecondary: true,
      });
      if (lastSecondary) {
        lockedHard.current = true;
        measure(lastSecondary.element, lastSecondary.matchedSelector, false);
        setLocateFailed(true);
        setLocating(false);
        return;
      }
      if (soft) {
        lockedHard.current = true;
        measure(soft.element, soft.matchedSelector, true);
        setLocateFailed(true);
        setLocating(false);
        return;
      }
      setTargetRect(null);
      setLocateFailed(true);
      setLocating(false);
    };

    timer = window.setTimeout(() => void locate(), 500);

    let scrollDebounce = 0;
    const refresh = () => {
      if (cancelled) return;
      const hard = queryGuideTargetChain(current.selector, stepRoute, {
        prepare: false,
        allowSoft: false,
      });
      if (hard) {
        lockedHard.current = true;
        applyRect(hard.element, hard.matchedSelector, false);
      } else if (lockedHard.current && activeSelector) {
        const still = queryGuideTargetChain(activeSelector, stepRoute, { prepare: false, allowSoft: true });
        if (still) applyRect(still.element, still.matchedSelector, still.soft);
      }
      setViewportTick((t) => t + 1);
    };
    const onScroll = () => {
      window.clearTimeout(scrollDebounce);
      scrollDebounce = window.setTimeout(refresh, 80);
    };

    const mo = new MutationObserver(() => {
      if (cancelled || lockedHard.current) return;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [safeIndex, current.selector, stepRoute, location.pathname, location.search, tabEpoch]);

  const cardPlacement = useMemo(
    () => computeCardPlacement(targetRect, activeSelector),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [targetRect, activeSelector, viewportTick],
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
      const left = Math.min(window.innerWidth - CARD_WIDTH - 16, targetRect.left + targetRect.width + 16);
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

  const openArea = () => {
    if (!stepRoute) return;
    if (stepRoute.startsWith("http")) window.open(stepRoute, "_blank", "noopener,noreferrer");
    else navigateAdminForGuide(navigate, stepRoute);
  };

  return (
    <div className="fixed inset-0 z-[110] pointer-events-none" role="dialog" aria-modal="true" aria-labelledby="guide-coach-title" aria-describedby="guide-coach-description">
      {targetRect ? (
        <div
          className={`fixed rounded-xl transition-all duration-300 ${softPreview ? "ring-2 ring-amber-400/70" : "ring-4 ring-primary/80"}`}
          style={{
            top: targetRect.top,
            left: targetRect.left,
            width: targetRect.width,
            height: targetRect.height,
            boxShadow: softPreview
              ? "0 0 0 9999px hsl(var(--background) / 0.55)"
              : "0 0 0 9999px hsl(var(--background) / 0.72)",
          }}
          aria-hidden="true"
        />
      ) : (
        <div className="fixed inset-0 bg-background/70" aria-hidden="true" />
      )}

      <div className="fixed pointer-events-auto z-[111]" style={cardStyle}>
        <div className="overflow-hidden rounded-2xl border border-primary/20 bg-background shadow-2xl max-h-[min(70vh,560px)] flex flex-col">
          <div className="relative border-b bg-primary/5 px-5 pb-3 pt-4 shrink-0">
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
            <p className="mt-1 text-xs text-muted-foreground">
              {locating
                ? "Abrindo a área e localizando o botão certo…"
                : softPreview
                  ? "Ainda ajustando o destaque — leia o passo e avance se preferir"
                  : "Siga o destaque verde na tela"}
            </p>
          </div>
          <div className="space-y-3 px-5 py-4 overflow-y-auto min-h-0">
            <p id="guide-coach-description" className="text-sm leading-relaxed text-foreground/90">{current.text}</p>
            {locating && (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Esperando a tela carregar o controle…
              </p>
            )}
            {locateFailed && (
              <p className="text-xs text-amber-700 dark:text-amber-300">
                Não achei o botão exato. Use “Abrir esta área” ou avance para o próximo passo.
              </p>
            )}
            {stepRoute && (
              <Button variant="outline" size="sm" onClick={openArea}>
                Abrir esta área
                <ExternalLink className="ml-2 h-3.5 w-3.5" />
              </Button>
            )}
            {onOpenFullTour && (
              <Button variant="ghost" size="sm" className="h-auto px-0 text-primary" onClick={onOpenFullTour}>
                <Play className="mr-1.5 h-3.5 w-3.5" />
                Tour da plataforma
              </Button>
            )}
          </div>
          <div className="px-5 shrink-0">
            <Progress value={percentage} className="h-1.5" aria-label={`Progresso do guia: ${safeIndex + 1} de ${total}`} />
          </div>
          <div className="flex flex-col-reverse gap-2 bg-muted/30 px-5 py-3 sm:flex-row sm:items-center sm:justify-between shrink-0">
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
