import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import type { TourStep, TourProgress } from "./types";
import { navigateAdminForGuide } from "./tourHighlight";

const LS_KEY = "tour_progress_v2";

async function fetchSteps(): Promise<TourStep[]> {
  const { data, error } = await supabase
    .from("tour_steps" as never)
    .select("*")
    .eq("is_active", true)
    .order("order_index");
  if (error) return [];
  return (data || []) as unknown as TourStep[];
}

async function fetchProgress(userId: string | null): Promise<TourProgress | null> {
  if (!userId) {
    try {
      const raw = localStorage.getItem(LS_KEY);
      return raw ? (JSON.parse(raw) as TourProgress) : null;
    } catch {
      return null;
    }
  }
  const { data } = await supabase
    .from("user_tour_progress" as never)
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  return (data as unknown as TourProgress) || null;
}

async function saveProgress(userId: string | null, patch: Partial<TourProgress>) {
  if (!userId) {
    try {
      const raw = localStorage.getItem(LS_KEY);
      const current = raw ? JSON.parse(raw) : { current_step: 0 };
      localStorage.setItem(LS_KEY, JSON.stringify({ ...current, ...patch }));
    } catch { /* Armazenamento local pode estar bloqueado. */ }
    return;
  }
  await supabase
    .from("user_tour_progress" as never)
    .upsert({ user_id: userId, ...patch } as never, { onConflict: "user_id" });
}

type TourContextValue = ReturnType<typeof useTourState>;
const TourContext = createContext<TourContextValue | null>(null);

function useTourState() {
  const navigate = useNavigate();
  const [steps, setSteps] = useState<TourStep[]>([]);
  const [progress, setProgress] = useState<TourProgress | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);

  const reload = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    const uid = user?.id || null;
    setUserId(uid);
    const [loadedSteps, loadedProgress] = await Promise.all([fetchSteps(), fetchProgress(uid)]);
    setSteps(loadedSteps);
    setProgress(loadedProgress);
    setReady(true);
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const goTo = useCallback(async (nextIndex: number, all: TourStep[]) => {
    const step = all[nextIndex];
    if (!step) return;
    if (step.route) {
      navigateAdminForGuide(navigate, step.route);
    }
    setIndex(nextIndex);
    await saveProgress(userId, { current_step: nextIndex });
    setProgress((previous) => ({
      ...(previous || { user_id: userId || "", started_at: new Date().toISOString(), completed_at: null, dismissed_at: null }),
      current_step: nextIndex,
    }));
  }, [navigate, userId]);

  const start = useCallback(async (options?: { from?: number; stepId?: string }) => {
    let all = steps;
    if (all.length === 0) {
      all = await fetchSteps();
      setSteps(all);
    }
    if (all.length === 0) return;
    const byId = options?.stepId ? all.findIndex((step) => step.id === options.stepId) : -1;
    const from = Math.max(0, Math.min(byId >= 0 ? byId : options?.from ?? 0, all.length - 1));
    setOpen(true);
    await goTo(from, all);
    const startedAt = new Date().toISOString();
    await saveProgress(userId, { started_at: startedAt, dismissed_at: null, completed_at: null });
    setProgress((previous) => ({
      ...(previous || { user_id: userId || "", current_step: from, completed_at: null, dismissed_at: null }),
      started_at: startedAt,
      dismissed_at: null,
      completed_at: null,
    }));
  }, [goTo, steps, userId]);

  const next = useCallback(async () => {
    if (index >= steps.length - 1) {
      const completedAt = new Date().toISOString();
      await saveProgress(userId, { completed_at: completedAt, current_step: Math.max(0, steps.length - 1) });
      setProgress((previous) => previous ? { ...previous, completed_at: completedAt } : previous);
      setOpen(false);
      return;
    }
    await goTo(index + 1, steps);
  }, [goTo, index, steps, userId]);

  const prev = useCallback(async () => {
    if (index > 0) await goTo(index - 1, steps);
  }, [goTo, index, steps]);

  const dismiss = useCallback(async () => {
    const dismissedAt = new Date().toISOString();
    setOpen(false);
    await saveProgress(userId, { dismissed_at: dismissedAt });
    setProgress((previous) => previous ? { ...previous, dismissed_at: dismissedAt } : previous);
  }, [userId]);

  const resume = useCallback(() => void start({ from: Math.max(0, progress?.current_step ?? 0) }), [progress, start]);
  const restart = useCallback(() => void start({ from: 0 }), [start]);
  const shouldAutoStart = ready && steps.length > 0 && !progress?.completed_at && !progress?.dismissed_at && (progress?.current_step ?? 0) === 0;

  return useMemo(() => ({
    ready, steps, progress, shouldAutoStart, open, setOpen, index,
    current: steps[index] || null, total: steps.length,
    start, resume, restart, next, prev, dismiss, reload,
  }), [ready, steps, progress, shouldAutoStart, open, index, start, resume, restart, next, prev, dismiss, reload]);
}

export function TourStateProvider({ children }: { children: ReactNode }) {
  const value = useTourState();
  return <TourContext.Provider value={value}>{children}</TourContext.Provider>;
}

export function useTour() {
  const value = useContext(TourContext);
  if (!value) throw new Error("useTour deve ser usado dentro de TourStateProvider");
  return value;
}
