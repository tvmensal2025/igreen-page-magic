/**
 * Hook que gerencia o progresso da Academy.
 * Persistência: banco (`academy_progress`, por usuário) + localStorage como cache offline.
 * O localStorage sozinho perdia o progresso ao trocar de aparelho/limpar cache.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

const PROGRESS_KEY = "igreen_academy_progress_v1";
const EXAMS_KEY    = "igreen_academy_exams_v1";
const LAST_KEY     = "igreen_academy_last_v1";

export interface LessonProgress {
  pct:  number;
  done: boolean;
}

export interface ExamResult {
  score:  number;
  passed: boolean;
}

type ProgressMap = Record<string, LessonProgress>;
type ExamsMap    = Record<string, ExamResult>;

function load<T>(key: string): T | null {
  try { return JSON.parse(localStorage.getItem(key) ?? "null") as T; }
  catch { return null; }
}
function persist(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

export function useAcademyProgress() {
  const [progress, setProgress] = useState<ProgressMap>(() => load<ProgressMap>(PROGRESS_KEY) ?? {});
  const [exams,    setExams   ] = useState<ExamsMap   >(() => load<ExamsMap   >(EXAMS_KEY   ) ?? {});
  const [lastIdx,  setLastIdx ] = useState<number | null>(() => load<number | null>(LAST_KEY) ?? null);
  const userIdRef = useRef<string | null>(null);

  // -------- sincronização com o banco --------
  useEffect(() => {
    let active = true;
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth?.user?.id ?? null;
      if (!active || !uid) return;
      userIdRef.current = uid;

      const { data, error } = await supabase
        .from("academy_progress")
        .select("item_key, kind, pct, done, score, passed")
        .eq("user_id", uid);
      if (!active || error || !data) {
        if (error) console.error("[useAcademyProgress] load", error);
        return;
      }

      const remoteProgress: ProgressMap = {};
      const remoteExams: ExamsMap = {};
      for (const row of data) {
        if (row.kind === "exam") {
          remoteExams[row.item_key] = { score: row.score ?? 0, passed: !!row.passed };
        } else {
          remoteProgress[row.item_key] = { pct: row.pct ?? 0, done: !!row.done };
        }
      }

      // Merge conservador: mantém sempre o melhor resultado entre local e banco.
      setProgress((local) => {
        const merged: ProgressMap = { ...remoteProgress };
        for (const [k, v] of Object.entries(local)) {
          const r = merged[k];
          merged[k] = r
            ? { pct: Math.max(r.pct, v.pct), done: r.done || v.done }
            : v;
        }
        persist(PROGRESS_KEY, merged);
        return merged;
      });
      setExams((local) => {
        const merged: ExamsMap = { ...remoteExams };
        for (const [k, v] of Object.entries(local)) {
          const r = merged[k];
          merged[k] = r
            ? { score: Math.max(r.score, v.score), passed: r.passed || v.passed }
            : v;
        }
        persist(EXAMS_KEY, merged);
        return merged;
      });
    })();
    return () => { active = false; };
  }, []);

  const upsertRemote = useCallback(async (row: {
    item_key: string; kind: "lesson" | "exam";
    pct?: number; done?: boolean; score?: number; passed?: boolean;
  }) => {
    const uid = userIdRef.current;
    if (!uid) return; // deslogado: fica só no cache local
    const { error } = await supabase
      .from("academy_progress")
      .upsert({ user_id: uid, ...row }, { onConflict: "user_id,kind,item_key" });
    if (error) console.error("[useAcademyProgress] upsert", error);
  }, []);

  // -------- helpers --------
  const getLessonProg = useCallback((yt: string): LessonProgress =>
    progress[yt] ?? { pct: 0, done: false }, [progress]);

  const setLessonProg = useCallback((yt: string, pct: number, done?: boolean) => {
    setProgress(prev => {
      const cur  = prev[yt] ?? { pct: 0, done: false };
      const next: LessonProgress = {
        pct:  Math.max(cur.pct, Math.round(pct)),
        done: done ?? cur.done ?? Math.round(pct) >= 95,
      };
      const map = { ...prev, [yt]: next };
      persist(PROGRESS_KEY, map);
      // Não regride no banco: só grava quando houve avanço real.
      if (next.pct !== cur.pct || next.done !== cur.done) {
        void upsertRemote({ item_key: yt, kind: "lesson", pct: next.pct, done: next.done });
      }
      return map;
    });
  }, [upsertRemote]);

  const markDone = useCallback((yt: string) => setLessonProg(yt, 100, true), [setLessonProg]);

  const getExam = useCallback((key: string): ExamResult | null => exams[key] ?? null, [exams]);

  const setExamResult = useCallback((key: string, score: number, passed: boolean) => {
    setExams(prev => {
      const cur  = prev[key];
      // mantém melhor resultado
      const next: ExamResult = {
        score:  cur ? Math.max(cur.score, score) : score,
        passed: passed || (cur?.passed ?? false),
      };
      const map = { ...prev, [key]: next };
      persist(EXAMS_KEY, map);
      void upsertRemote({ item_key: key, kind: "exam", score: next.score, passed: next.passed, pct: 100, done: next.passed });
      return map;
    });
  }, [upsertRemote]);

  const saveLastIdx = useCallback((idx: number) => {
    setLastIdx(idx);
    persist(LAST_KEY, idx);
  }, []);

  // -------- estatísticas derivadas --------
  const passedCount = Object.values(exams).filter(e => e.passed).length;

  return {
    progress, exams,
    getLessonProg, setLessonProg, markDone,
    getExam, setExamResult,
    lastIdx, saveLastIdx,
    passedCount,
  };
}
