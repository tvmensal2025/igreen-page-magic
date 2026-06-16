/**
 * Player de vídeo YouTube usando a IFrame API.
 * Layout cinematográfico premium: moldura com glow, topbar de vidro,
 * meta cards e CTA principal de grande peso visual.
 */
import { useEffect, useRef, useCallback, useState } from "react";
import {
  ChevronLeft, ChevronRight, ArrowLeft, CheckCircle, PlayCircle, Sparkles,
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

function fmtTime(sec: number): string {
  if (!sec || !isFinite(sec)) return "--:--";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function AcademyPlayer({
  videoId, lesson, progress,
  hasPrev, hasNext, onPrev, onNext, onClose,
  onProgress, onMarkDone,
}: Props) {
  const mountRef    = useRef<HTMLDivElement>(null);
  const playerRef   = useRef<YTPlayerInstance | null>(null);
  const timerRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const [duration, setDuration] = useState(0);
  const [current, setCurrent]   = useState(0);

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
    setDuration(dur);
    setCurrent(cur);
    const pct = Math.min(100, (cur / dur) * 100);
    onProgress(videoId, pct, pct >= 95);
  }, [videoId, onProgress]);

  const destroyPlayer = useCallback(() => {
    clearTimer();
    if (playerRef.current) {
      try { playerRef.current.destroy(); } catch { /* noop */ }
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
        playerVars: {
          autoplay: 1, rel: 0, modestbranding: 1, playsinline: 1,
          color: "white", iv_load_policy: 3,
        },
        events: {
          onReady: (e: { target: YTPlayerInstance }) => {
            try {
              e.target.playVideo();
              setDuration(e.target.getDuration());
            } catch { /* noop */ }
          },
          onStateChange: (e: { data: number }) => {
            if (e.data === window.YT.PlayerState.PLAYING) {
              clearTimer();
              timerRef.current = setInterval(track, 500);
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

  // fechar com ESC + navegação
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight" && hasNext) onNext();
      if (e.key === "ArrowLeft"  && hasPrev) onPrev();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose, onNext, onPrev, hasPrev, hasNext]);

  const pct = progress.pct;

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col overflow-hidden animate-in fade-in duration-300"
      style={{
        background: `
          radial-gradient(60% 50% at 50% 0%, ${AC.primarySoft} 0%, transparent 60%),
          radial-gradient(80% 60% at 50% 100%, rgba(0,168,89,0.08) 0%, transparent 70%),
          linear-gradient(180deg, #0A0A0A 0%, ${AC.bg} 100%)
        `,
        color: AC.text,
        fontFamily: AC_FONT_BODY,
      }}
    >
      {/* ====== AURORA BACKDROP ====== */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          className="absolute -top-40 -left-32 w-[480px] h-[480px] rounded-full blur-3xl opacity-30"
          style={{ background: `radial-gradient(circle, ${AC.primary} 0%, transparent 70%)` }}
        />
        <div
          className="absolute -bottom-40 -right-32 w-[520px] h-[520px] rounded-full blur-3xl opacity-25"
          style={{ background: `radial-gradient(circle, ${AC.primaryDeep} 0%, transparent 70%)` }}
        />
      </div>

      {/* ====== TOPBAR DE VIDRO ====== */}
      <header
        className="relative z-10 flex items-center gap-3 h-16 px-4 sm:px-6 shrink-0"
        style={{
          background: "linear-gradient(180deg, rgba(10,10,10,0.85) 0%, rgba(10,10,10,0.4) 100%)",
          backdropFilter: "blur(20px)",
          borderBottom: `1px solid ${AC.border}`,
        }}
      >
        <button
          onClick={onClose}
          className="group flex items-center gap-2 pl-2 pr-3.5 py-2 rounded-full text-sm font-medium transition-all"
          style={{
            color: AC.textDim,
            background: "rgba(255,255,255,0.04)",
            border: `1px solid ${AC.border}`,
          }}
          onMouseEnter={e => {
            e.currentTarget.style.color = AC.text;
            e.currentTarget.style.background = AC.primarySoft;
            e.currentTarget.style.borderColor = AC.borderHi;
          }}
          onMouseLeave={e => {
            e.currentTarget.style.color = AC.textDim;
            e.currentTarget.style.background = "rgba(255,255,255,0.04)";
            e.currentTarget.style.borderColor = AC.border;
          }}
        >
          <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-0.5" />
          <span className="hidden sm:inline">Voltar</span>
        </button>

        <div className="flex-1 min-w-0 flex items-center gap-2 text-xs">
          <span
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full"
            style={{
              color: AC.primary,
              background: AC.primarySoft,
              border: `1px solid ${AC.borderHi}`,
              letterSpacing: "0.16em",
              fontSize: "10px",
              fontWeight: 700,
              textTransform: "uppercase",
            }}
          >
            <Sparkles className="w-3 h-3" /> Academy
          </span>
          <span className="truncate hidden md:inline" style={{ color: AC.textMute }}>
            {lesson.catTitle} · {lesson.moduleTitle}
          </span>
        </div>

        {/* mini progresso na topbar */}
        <div className="hidden sm:flex items-center gap-2.5">
          <span className="text-[11px] tabular-nums" style={{ color: AC.textMute }}>
            {fmtTime(current)} / {fmtTime(duration)}
          </span>
          <div className="w-28 h-1 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.08)" }}>
            <div
              className="h-full transition-all duration-300"
              style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${AC.primaryDeep}, ${AC.primary})` }}
            />
          </div>
          <span className="text-[11px] font-semibold tabular-nums" style={{ color: AC.primary }}>
            {pct}%
          </span>
        </div>
      </header>

      {/* ====== SCROLL CONTAINER ====== */}
      <div className="relative z-10 flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 pb-10">

          {/* ====== MOLDURA CINEMA ====== */}
          <div className="relative group">
            {/* glow externo */}
            <div
              aria-hidden
              className="absolute -inset-6 rounded-3xl opacity-60 blur-2xl transition-opacity duration-700 group-hover:opacity-90"
              style={{
                background: `linear-gradient(135deg, ${AC.primary}, transparent 50%, ${AC.primaryDeep})`,
              }}
            />
            {/* moldura */}
            <div
              className="relative rounded-2xl overflow-hidden"
              style={{
                background: "#000",
                border: `1px solid ${AC.border}`,
                boxShadow: `0 30px 90px -20px rgba(0,0,0,0.8), 0 0 0 1px ${AC.border}, inset 0 0 0 1px rgba(255,255,255,0.04)`,
              }}
            >
              <div className="relative w-full" style={{ aspectRatio: "16/9" }}>
                <div ref={mountRef} className="absolute inset-0 w-full h-full" />
              </div>
              {/* faixa inferior com gradiente sutil */}
              <div
                aria-hidden
                className="pointer-events-none absolute bottom-0 left-0 right-0 h-20"
                style={{ background: "linear-gradient(180deg, transparent 0%, rgba(0,0,0,0.6) 100%)" }}
              />
            </div>
          </div>

          {/* ====== HEADER DA AULA ====== */}
          <div className="mt-8 grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-6 items-end">
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <span className="h-px flex-none w-10" style={{ background: AC.primary }} />
                <span
                  className="text-[10px] font-bold uppercase"
                  style={{ color: AC.primary, letterSpacing: "0.32em" }}
                >
                  Aula em curso
                </span>
              </div>
              <h1
                className="text-3xl sm:text-4xl lg:text-5xl leading-[1.05] tracking-tight"
                style={{ fontFamily: AC_FONT_DISPLAY, fontWeight: 700, color: AC.text }}
              >
                {lesson.title}
              </h1>
              <p className="text-sm" style={{ color: AC.textDim }}>
                {lesson.catTitle} <span style={{ color: AC.textMute }}>·</span> {lesson.moduleTitle}
              </p>
            </div>

            {progress.done && (
              <span
                className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase px-3 py-1.5 rounded-full self-start lg:self-end"
                style={{
                  color: AC.primary,
                  background: AC.primarySoft,
                  border: `1px solid ${AC.borderHi}`,
                  letterSpacing: "0.2em",
                }}
              >
                <CheckCircle className="w-3.5 h-3.5" /> Concluída
              </span>
            )}
          </div>

          {/* ====== STATS GRID ====== */}
          <div className="mt-8 grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="Progresso" value={`${pct}%`} />
            <StatCard label="Tempo" value={fmtTime(current)} />
            <StatCard label="Duração" value={fmtTime(duration)} />
            <StatCard
              label="Status"
              value={progress.done ? "Concluída" : pct > 0 ? "Em curso" : "Iniciar"}
              accent={progress.done}
            />
          </div>

          {/* ====== BARRA DE PROGRESSO PRINCIPAL ====== */}
          <div className="mt-6 space-y-2">
            <div className="h-1.5 rounded-full overflow-hidden relative" style={{ background: "rgba(255,255,255,0.06)" }}>
              <div
                className="h-full rounded-full transition-all duration-500 relative"
                style={{
                  width: `${pct}%`,
                  background: `linear-gradient(90deg, ${AC.primaryDeep}, ${AC.primary})`,
                  boxShadow: `0 0 20px ${AC.primary}`,
                }}
              >
                <div
                  className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 rounded-full"
                  style={{
                    background: AC.primary,
                    boxShadow: `0 0 12px ${AC.primary}, 0 0 0 4px rgba(0,168,89,0.2)`,
                  }}
                />
              </div>
            </div>
          </div>

          {/* ====== AÇÕES ====== */}
          <div className="mt-6 flex flex-col sm:flex-row gap-3">
            <button
              onClick={onPrev}
              disabled={!hasPrev}
              className="flex items-center justify-center gap-2 px-5 py-3.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-25 disabled:cursor-not-allowed hover:translate-x-[-2px]"
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
              className="flex-1 flex items-center justify-center gap-2.5 py-3.5 rounded-xl text-sm font-bold uppercase transition-all hover:scale-[1.01] active:scale-[0.99]"
              style={
                progress.done
                  ? {
                      color: AC.textMute,
                      background: "rgba(255,255,255,0.04)",
                      border: `1px solid ${AC.border}`,
                      letterSpacing: "0.18em",
                      cursor: "default",
                    }
                  : {
                      color: "#FFFFFF",
                      background: `linear-gradient(135deg, ${AC.primary} 0%, ${AC.primaryDeep} 100%)`,
                      border: "1px solid transparent",
                      letterSpacing: "0.18em",
                      boxShadow: `0 12px 40px -12px ${AC.primary}, inset 0 1px 0 rgba(255,255,255,0.2)`,
                    }
              }
            >
              {progress.done ? (
                <><CheckCircle className="w-4 h-4" /> Concluída</>
              ) : (
                <><PlayCircle className="w-4 h-4" /> Marcar como concluída</>
              )}
            </button>

            <button
              onClick={onNext}
              disabled={!hasNext}
              className="flex items-center justify-center gap-2 px-5 py-3.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-25 disabled:cursor-not-allowed hover:translate-x-[2px]"
              style={{
                color: AC.text,
                background: "rgba(255,255,255,0.04)",
                border: `1px solid ${AC.border}`,
              }}
            >
              Próxima <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* ====== ATALHOS ====== */}
          <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px]" style={{ color: AC.textMute }}>
            <Kbd>ESC</Kbd> <span>Voltar</span>
            <Kbd>←</Kbd> <span>Aula anterior</span>
            <Kbd>→</Kbd> <span>Próxima aula</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---- subcomponentes ---- */
function StatCard({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div
      className="px-4 py-3 rounded-xl"
      style={{
        background: accent ? AC.primarySoft : "rgba(255,255,255,0.03)",
        border: `1px solid ${accent ? AC.borderHi : AC.border}`,
      }}
    >
      <div
        className="text-[10px] font-semibold uppercase mb-1"
        style={{ color: AC.textMute, letterSpacing: "0.2em" }}
      >
        {label}
      </div>
      <div
        className="text-lg tabular-nums tracking-tight"
        style={{
          fontFamily: AC_FONT_DISPLAY,
          fontWeight: 700,
          color: accent ? AC.primary : AC.text,
        }}
      >
        {value}
      </div>
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd
      className="inline-flex items-center justify-center min-w-[24px] h-6 px-1.5 rounded-md text-[10px] font-mono font-semibold"
      style={{
        color: AC.textDim,
        background: "rgba(255,255,255,0.05)",
        border: `1px solid ${AC.border}`,
        boxShadow: "inset 0 -1px 0 rgba(0,0,0,0.3)",
      }}
    >
      {children}
    </kbd>
  );
}
