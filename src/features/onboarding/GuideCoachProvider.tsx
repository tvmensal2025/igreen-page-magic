import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import type { HelpArticle } from "@/features/help/helpCatalog";
import { resolveGuideSteps } from "@/features/help/helpCatalog";

type GuideCoachState = {
  article: HelpArticle;
  stepIndex: number;
} | null;

type GuideCoachContextValue = {
  active: GuideCoachState;
  startGuide: (article: HelpArticle) => void;
  setStepIndex: (index: number) => void;
  closeGuide: () => void;
};

const GuideCoachContext = createContext<GuideCoachContextValue | null>(null);

export function GuideCoachProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [active, setActive] = useState<GuideCoachState>(null);

  const startGuide = useCallback((article: HelpArticle) => {
    const steps = resolveGuideSteps(article);
    const firstRoute = steps[0]?.route || article.href || "/admin";
    if (!firstRoute.startsWith("http") && typeof window !== "undefined") {
      const destination = new URL(firstRoute, window.location.origin);
      const tab = destination.searchParams.get("tab") || "dashboard";
      const section = destination.searchParams.get("section") || undefined;
      const hubTab = destination.searchParams.get("hubTab") || undefined;
      window.dispatchEvent(
        new CustomEvent("igreen-admin-nav", {
          detail: { tab, whatsappSub: section, hubTab },
        }),
      );
      const current = `${window.location.pathname}${window.location.search}`;
      const target = `${destination.pathname}${destination.search}`;
      if (current !== target) navigate(target);
    }
    if (steps[0]?.selector?.includes("menu-")) {
      window.dispatchEvent(new CustomEvent("igreen-open-sidebar"));
    }
    setActive({ article, stepIndex: 0 });
  }, [navigate]);

  const setStepIndex = useCallback((index: number) => {
    setActive((previous) => previous ? { ...previous, stepIndex: Math.max(0, index) } : previous);
  }, []);

  const closeGuide = useCallback(() => setActive(null), []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && active) closeGuide();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, closeGuide]);

  const value = useMemo(
    () => ({ active, startGuide, setStepIndex, closeGuide }),
    [active, startGuide, setStepIndex, closeGuide],
  );

  return <GuideCoachContext.Provider value={value}>{children}</GuideCoachContext.Provider>;
}

export function useGuideCoach() {
  const value = useContext(GuideCoachContext);
  if (!value) throw new Error("useGuideCoach deve ser usado dentro de GuideCoachProvider");
  return value;
}
