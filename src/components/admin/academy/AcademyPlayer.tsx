/**
 * Player de vídeo YouTube usando a IFrame API.
 * Rastreia progresso e expõe callbacks para o pai.
 */
import { useEffect, useRef, useCallback } from "react";
import {
  ChevronLeft, ChevronRight, ArrowLeft, CheckCircle
} from "lucide-react";
import type { AcademyLesson } from "@/data/academyCatalog";
import type { LessonProgress } from "@/hooks/useAcademyProgress";

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

function thumbUrl(yt: string) {
  return `https://i.ytimg.com/vi/${yt}/mqdefault.jpg`;
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
    /* slide up from bottom */
    <div className="fixed inset-0 z-[100] flex flex-col bg-[#0a0a0c]
                    animate-in slide-in-from-bottom-4 duration-300">

      {/* ---- barra superior ---- */}
      <div className="sticky top-0 z-10 flex items-center gap-2 h-14 px-3
                      bg-black/80 backdrop-blur-md border-b border-white/10 shrink-0">
        <button
          onClick={onClose}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg
                     text-white/70 hover:text-white hover:bg-white/10
                     text-sm font-semibold transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span className="hidden sm:inline">Voltar</span>
        </button>
        <span className="text-xs text-white/40 truncate flex-1 min-w-0">
          {lesson.catTitle} › {lesson.moduleTitle}
        </span>
      </div>

      {/* ---- vídeo ---- */}
      <div className="bg-black w-full shrink-0">
        <div className="relative w-full max-w-5xl mx-auto" style={{ aspectRatio: "16/9" }}>
          <div ref={mountRef} className="absolute inset-0 w-full h-full" />
        </div>
      </div>

      {/* ---- info + controles ---- */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-4 py-5 space-y-4">

          {/* título + badge concluída */}
          <div className="flex items-start gap-3">
            <h1 className="flex-1 text-lg sm:text-xl font-black text-white leading-snug">
              {lesson.title}
            </h1>
            {progress.done && (
              <span className="shrink-0 mt-0.5 flex items-center gap-1 text-xs font-black
                               text-[#00A859] bg-[#00A859]/15 border border-[#00A859]/30
                               px-2 py-1 rounded-full">
                <CheckCircle className="w-3 h-3" /> Concluída
              </span>
            )}
          </div>

          {/* progresso */}
          <div className="space-y-1">
            <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
              <div
                className="h-full bg-[#00A859] transition-all duration-500"
                style={{ width: `${progress.pct}%` }}
              />
            </div>
            <p className="text-xs text-white/40">{progress.pct}% assistido</p>
          </div>

          {/* ações */}
          <div className="flex gap-2">
            <button
              onClick={onPrev} disabled={!hasPrev}
              className="flex items-center gap-1 px-3 py-2.5 rounded-xl text-sm font-bold
                         border border-white/15 bg-white/5 text-white hover:bg-white/10
                         disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft className="w-4 h-4" /> Anterior
            </button>

            <button
              onClick={() => onMarkDone(videoId)}
              disabled={progress.done}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl
                          text-sm font-black transition-colors
                          ${progress.done
                            ? "border border-white/10 bg-white/5 text-white/30 cursor-default"
                            : "bg-[#00A859] hover:bg-[#007A3D] text-white"}`}
            >
              <CheckCircle className="w-4 h-4" />
              {progress.done ? "✓ Concluída" : "Marcar como concluída"}
            </button>

            <button
              onClick={onNext} disabled={!hasNext}
              className="flex items-center gap-1 px-3 py-2.5 rounded-xl text-sm font-bold
                         border border-white/15 bg-white/5 text-white hover:bg-white/10
                         disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              Próxima <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
