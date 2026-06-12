/**
 * Hook que gerencia o progresso da Academy no localStorage.
 * Persistência: progresso por vídeo (YT id) e resultado de provas.
 */
import { useCallback, useEffect, useState } from "react";

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
      return map;
    });
  }, []);

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
      return map;
    });
  }, []);

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
