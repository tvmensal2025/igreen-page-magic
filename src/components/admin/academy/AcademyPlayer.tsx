/**
 * Player de vídeo YouTube usando a IFrame API.
 * Rastreia progresso e expõe callbacks para o pai.
 * Tema: iGreen oficial (modo escuro) — ver ./theme.ts
 */
import { useEffect, useRef, useCallback } from "react";
import {
  ChevronLeft, ChevronRight, ArrowLeft, CheckCircle
} from "lucide-react";
import type { AcademyLesson } from "@/data/academyCatalog";
import type { LessonProgress } from "@/hooks/useAcademyProgress";
import { AC, AC_FONT_DISPLAY, AC_FONT_BODY } from "./theme";

/* ---- tipos globais da IFrame API (não instalar lib) ---- */
declare global {
  interface Window {
    YT: {
      Player: new (
        el: string | HTMLElement,
        opts: Record<string, unknown>
      ) => YTPlayerInstance;
      PlayerState: { PLAYING: number; PAUSED: number; ENDED: number };
    };
    onYouTubeIframeAPIReady?: () => void;
    _ytApiQueue: (() => void)[];
  }
}
interface YTPlayerInstance {
  destroy():         void;
  playVideo():       void;
  getDuration():     number;
  getCurrentTime():  number;
}

/* ---- carrega script UMA vez ---- */
let ytApiReady = false;
if (typeof window !== "undefined") {
  window._ytApiQueue = window._ytApiQueue ?? [];
  if (!window.YT) {
    const s = document.createElement("script");
    s.src   = "https://www.youtube.com/iframe_api";
    document.head.appendChild(s);
    window.onYouTubeIframeAPIReady = () => {
      ytApiReady = true;
      window._ytApiQueue.forEach(fn => fn());
      window._ytApiQueue = [];
    };
  } else {
    ytApiReady = true;
  }
}

/* ---- props ---- */
interface Props {
  videoId:    string;
  lesson:     AcademyLesson & { catTitle: string; moduleTitle: string };
  progress:   LessonProgress;
  hasPrev:    boolean;
  hasNext:    boolean;
  onPrev:     () => void;
  onNext:     () => void;
  onClose:    () => void;
  onProgress: (yt: string, pct: number, done: boolean) => void;
  onMarkDone: (yt: string) => void;
}

export function AcademyPlayer({
  videoId, lesson, progress,
  hasPrev, hasNext, onPrev, onNext, onClose,
  onProgress, onMarkDone,
}: Props) {
  const mountRef    = useRef<HTMLDivElement>(null);
  const playerRef   = useRef<YTPlayerInstance | null>(null);
  const timerRef    = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  }, []);

  const track = useCallback(() => {
    const p = playerRef.current;
    if (!p) return;
    const dur = p.getDuration();
    const cur = p.getCurrentTime();
    if (!dur) return;
    const pct = Math.min(100, (cur / dur) * 100);
    onProgress(videoId, pct, pct >= 95);
  }, [videoId, onProgress]);

  const destroyPlayer = useCallback(() => {
    clearTimer();
    if (playerRef.current) {
      try { playerRef.current.destroy(); } catch {}
      playerRef.current = null;
    }
    if (mountRef.current) mountRef.current.innerHTML = "";
  }, [clearTimer]);

  const createPlayer = useCallback(() => {
    if (!mountRef.current) return;
    mountRef.current.innerHTML = '<div id="yt-player-inner"></div>';
    const make = () => {
      playerRef.current = new window.YT.Player("yt-player-inner", {
        videoId,
        playerVars: { autoplay: 1, rel: 0, modestbranding: 1, playsinline: 1 },
        events: {
          onReady:       (e: { target: YTPlayerInstance }) => { try { e.target.playVideo(); } catch {} },
          onStateChange: (e: { data: number }) => {
            if (e.data === window.YT.PlayerState.PLAYING) {
              clearTimer();
              timerRef.current = setInterval(track, 1000);
            } else {
              clearTimer();
              if (e.data === window.YT.PlayerState.ENDED) {
                onProgress(videoId, 100, true);
              }
            }
          },
        },
      });
    };
    if (ytApiReady && window.YT) make();
    else window._ytApiQueue.push(make);
  }, [videoId, clearTimer, track, onProgress]);

  useEffect(() => {
    createPlayer();
    return destroyPlayer;
  }, [createPlayer, destroyPlayer]);

  // fechar com ESC
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onClose(); }
      if (e.key === "ArrowRight" && hasNext) onNext();
      if (e.key === "ArrowLeft"  && hasPrev) onPrev();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose, onNext, onPrev, hasPrev, hasNext]);

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col animate-in slide-in-from-bottom-4 duration-300"
      style={{
        background: `radial-gradient(120% 80% at 50% 0%, ${AC.surface} 0%, ${AC.bg} 60%)`,
        color: AC.text,
        fontFamily: AC_FONT_BODY,
      }}
    >
      {/* ---- barra superior ---- */}
      <div
        className="sticky top-0 z-10 flex items-center gap-3 h-14 px-3 sm:px-5 shrink-0 backdrop-blur-md"
        style={{ background: "rgba(17,17,17,0.85)", borderBottom: `1px solid ${AC.border}` }}
      >
        <button
          onClick={onClose}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
          style={{ color: AC.textDim }}
          onMouseEnter={e => { e.currentTarget.style.color = AC.text; e.currentTarget.style.background = AC.primarySoft; }}
          onMouseLeave={e => { e.currentTarget.style.color = AC.textDim; e.currentTarget.style.background = "transparent"; }}
        >
          <ArrowLeft className="w-4 h-4" />
          <span className="hidden sm:inline">Voltar</span>
        </button>
        <div className="flex-1 min-w-0 flex items-center gap-2 text-xs">
          <span className="uppercase tracking-[0.18em]" style={{ color: AC.primary, letterSpacing: "0.18em" }}>
            {lesson.catTitle}
          </span>
          <span style={{ color: AC.textMute }}>·</span>
          <span className="truncate" style={{ color: AC.textDim }}>{lesson.moduleTitle}</span>
        </div>
      </div>

      {/* ---- vídeo ---- */}
      <div className="w-full shrink-0" style={{ background: "#000" }}>
        <div className="relative w-full max-w-5xl mx-auto" style={{ aspectRatio: "16/9" }}>
          <div ref={mountRef} className="absolute inset-0 w-full h-full" />
        </div>
      </div>

      {/* ---- info + controles ---- */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-6">

          {/* kicker + título + badge */}
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <span className="h-px flex-none w-8" style={{ background: AC.primary }} />
              <span className="text-[10px] font-semibold uppercase" style={{ color: AC.primary, letterSpacing: "0.28em" }}>
                Aula em curso
              </span>
            </div>
            <div className="flex items-start gap-3">
              <h1
                className="flex-1 text-2xl sm:text-3xl leading-tight tracking-tight"
                style={{ fontFamily: AC_FONT_DISPLAY, fontWeight: 700, color: AC.text }}
              >
                {lesson.title}
              </h1>
              {progress.done && (
                <span
                  className="shrink-0 mt-1 inline-flex items-center gap-1 text-[10px] font-semibold uppercase px-2.5 py-1 rounded-full"
                  style={{
                    color: AC.primary,
                    background: AC.primarySoft,
                    border: `1px solid ${AC.borderHi}`,
                    letterSpacing: "0.18em",
                  }}
                >
                  <CheckCircle className="w-3 h-3" /> Concluída
                </span>
              )}
            </div>
          </div>

          {/* progresso */}
          <div className="space-y-2">
            <div className="flex justify-between text-[11px] uppercase" style={{ color: AC.textMute, letterSpacing: "0.2em" }}>
              <span>Progresso</span>
              <span style={{ color: AC.primary }}>{progress.pct}%</span>
            </div>
            <div className="h-[3px] rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.08)" }}>
              <div
                className="h-full transition-all duration-500"
                style={{
                  width: `${progress.pct}%`,
                  background: `linear-gradient(90deg, ${AC.primaryDeep}, ${AC.primary})`,
                }}
              />
            </div>
          </div>

          {/* ações */}
          <div className="flex gap-2 pt-2">
            <button
              onClick={onPrev} disabled={!hasPrev}
              className="flex items-center gap-1 px-4 py-3 rounded-lg text-sm font-medium transition-all disabled:opacity-25 disabled:cursor-not-allowed"
              style={{
                color: AC.text,
                background: "rgba(255,255,255,0.04)",
                border: `1px solid ${AC.border}`,
              }}
            >
              <ChevronLeft className="w-4 h-4" /> Anterior
            </button>

            <button
              onClick={() => onMarkDone(videoId)}
              disabled={progress.done}
              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-lg text-sm font-semibold uppercase transition-all"
              style={
                progress.done
                  ? {
                      color: AC.textMute,
                      background: "rgba(255,255,255,0.04)",
                      border: `1px solid ${AC.border}`,
                      letterSpacing: "0.14em",
                      cursor: "default",
                    }
                  : {
                      color: "#FFFFFF",
                      background: `linear-gradient(135deg, ${AC.primary}, ${AC.primaryDeep})`,
                      border: "1px solid transparent",
                      letterSpacing: "0.14em",
                      boxShadow: "0 8px 24px -12px rgba(0,168,89,0.6)",
                    }
              }
            >
              <CheckCircle className="w-4 h-4" />
              {progress.done ? "Concluída" : "Marcar concluída"}
            </button>

            <button
              onClick={onNext} disabled={!hasNext}
              className="flex items-center gap-1 px-4 py-3 rounded-lg text-sm font-medium transition-all disabled:opacity-25 disabled:cursor-not-allowed"
              style={{
                color: AC.text,
                background: "rgba(255,255,255,0.04)",
                border: `1px solid ${AC.border}`,
              }}
            >
              Próxima <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
