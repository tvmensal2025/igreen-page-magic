import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import type { TourStep, TourProgress } from "./types";

const LS_KEY = "tour_progress_v1";

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
      const cur = raw ? JSON.parse(raw) : { current_step: 0 };
      localStorage.setItem(LS_KEY, JSON.stringify({ ...cur, ...patch }));
    } catch { /* ignore */ }
    return;
  }
  await supabase
    .from("user_tour_progress" as never)
    .upsert({ user_id: userId, ...patch } as never, { onConflict: "user_id" });
}

export function useTour() {
  const navigate = useNavigate();
  const [steps, setSteps] = useState<TourStep[]>([]);
  const [progress, setProgress] = useState<TourProgress | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      const uid = user?.id || null;
      setUserId(uid);
      const [s, p] = await Promise.all([fetchSteps(), fetchProgress(uid)]);
      setSteps(s);
      setProgress(p);
      setReady(true);
    })();
  }, []);

  const goTo = useCallback(async (i: number, all: TourStep[]) => {
    const step = all[i];
    if (!step) return;
    if (step.route && typeof window !== "undefined" && !window.location.pathname.startsWith(step.route)) {
      navigate(step.route);
    }
    setIndex(i);
    await saveProgress(userId, { current_step: i });
    setProgress((p) => ({ ...(p || { user_id: userId || "", started_at: new Date().toISOString(), completed_at: null, dismissed_at: null }), current_step: i }));
  }, [navigate, userId]);

  const start = useCallback(async (opts?: { from?: number }) => {
    let all = steps;
    if (all.length === 0) {
      all = await fetchSteps();
      setSteps(all);
    }
    if (all.length === 0) return;
    const from = opts?.from ?? 0;
    setOpen(true);
    await goTo(from, all);
    await saveProgress(userId, { started_at: new Date().toISOString() });
  }, [steps, userId, goTo]);

  const next = useCallback(async () => {
    if (index >= steps.length - 1) {
      await saveProgress(userId, { completed_at: new Date().toISOString(), current_step: steps.length - 1 });
      setOpen(false);
      return;
    }
    await goTo(index + 1, steps);
  }, [index, steps, userId, goTo]);

  const prev = useCallback(async () => {
    if (index <= 0) return;
    await goTo(index - 1, steps);
  }, [index, steps, goTo]);

  const dismiss = useCallback(async () => {
    setOpen(false);
    await saveProgress(userId, { dismissed_at: new Date().toISOString() });
  }, [userId]);

  const resume = useCallback(() => {
    const from = Math.max(0, progress?.current_step ?? 0);
    start({ from });
  }, [progress, start]);

  const restart = useCallback(() => start({ from: 0 }), [start]);

  const shouldAutoStart = ready
    && steps.length > 0
    && !progress?.completed_at
    && !progress?.dismissed_at
    && (progress?.current_step ?? 0) === 0;

  return {
    ready, steps, progress, shouldAutoStart,
    open, setOpen, index, current: steps[index] || null, total: steps.length,
    start, resume, restart, next, prev, dismiss,
  };
}
