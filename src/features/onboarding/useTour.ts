import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { driver, type Driver, type DriveStep } from "driver.js";
import "driver.js/dist/driver.css";
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
  const driverRef = useRef<Driver | null>(null);

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

  const buildDriveSteps = useCallback((all: TourStep[], startIndex: number): DriveStep[] => {
    const slice = all.slice(startIndex);
    return slice.map((s, i) => ({
      element: s.selector || undefined,
      popover: {
        title: s.title || `Passo ${s.order_index}`,
        description: (s.body || "") + (s.cta_href
          ? `<div style="margin-top:8px"><a href="${s.cta_href}" style="color:hsl(var(--primary));text-decoration:underline">${s.cta_label || "Abrir"}</a></div>`
          : ""),
        side: "bottom",
        align: "start",
        onNextClick: async () => {
          const next = slice[i + 1];
          if (next?.route && typeof window !== "undefined" && !window.location.pathname.startsWith(next.route)) {
            navigate(next.route);
            await new Promise((r) => setTimeout(r, 450));
          }
          driverRef.current?.moveNext();
        },
        onPrevClick: async () => {
          const prev = slice[i - 1];
          if (prev?.route && typeof window !== "undefined" && !window.location.pathname.startsWith(prev.route)) {
            navigate(prev.route);
            await new Promise((r) => setTimeout(r, 450));
          }
          driverRef.current?.movePrevious();
        },
      },
      onHighlightStarted: async () => {
        const idx = all.findIndex((x) => x.id === s.id);
        await saveProgress(userId, { current_step: idx });
        setProgress((p) => ({ ...(p || { user_id: userId || "", started_at: new Date().toISOString(), completed_at: null, dismissed_at: null }), current_step: idx }));
      },
    }));
  }, [userId, navigate]);


  const start = useCallback(async (opts?: { from?: number; force?: boolean }) => {
    let all = steps;
    if (all.length === 0) {
      all = await fetchSteps();
      setSteps(all);
    }
    if (all.length === 0) return;
    const from = opts?.from ?? 0;

    // Navigate to the first step's route before starting
    const first = all[from];
    if (first && typeof window !== "undefined" && !window.location.pathname.startsWith(first.route)) {
      navigate(first.route);
      // Give the target route time to mount
      await new Promise((r) => setTimeout(r, 400));
    }

    driverRef.current?.destroy();
    const d = driver({
      showProgress: true,
      allowClose: true,
      overlayOpacity: 0.5,
      progressText: "{{current}} de {{total}}",
      nextBtnText: "Próximo →",
      prevBtnText: "← Voltar",
      doneBtnText: "Concluir",
      steps: buildDriveSteps(all, from),
      onDestroyed: async () => {
        await saveProgress(userId, { dismissed_at: new Date().toISOString() });
      },
      onDestroyStarted: async () => {
        const active = d.getActiveIndex();
        const total = buildDriveSteps(all, from).length;
        if (typeof active === "number" && active >= total - 1) {
          await saveProgress(userId, { completed_at: new Date().toISOString(), current_step: all.length - 1 });
        }
        d.destroy();
      },
    });
    driverRef.current = d;
    d.drive();
  }, [steps, buildDriveSteps, userId, navigate]);

  const resume = useCallback(() => {
    const from = Math.max(0, progress?.current_step ?? 0);
    start({ from });
  }, [progress, start]);

  const restart = useCallback(() => start({ from: 0, force: true }), [start]);

  const shouldAutoStart = ready
    && steps.length > 0
    && !progress?.completed_at
    && !progress?.dismissed_at
    && (progress?.current_step ?? 0) === 0;

  return { ready, steps, progress, shouldAutoStart, start, resume, restart };
}
