/**
 * Catálogo da Academy — estilo Netflix.
 * Trilhas → módulos, cada módulo é uma "fileira" horizontal de pôsteres de aula
 * com scroll lateral e cards que crescem no hover. Tema: iGreen oficial (dark).
 */
import { useState, useRef, useMemo } from "react";
import {
  ChevronLeft, ChevronRight, BookOpen, Award, ClipboardList, Search, Check,
  Lock, Play, Clock,
} from "lucide-react";
import { CATALOG, QUIZZES, type AcademyTrack, type AcademyModule } from "@/data/academyCatalog";
import type { LessonProgress, ExamResult } from "@/hooks/useAcademyProgress";
import { AC, AC_FONT_DISPLAY, AC_FONT_BODY } from "./theme";

function thumb(yt: string) {
  return `https://i.ytimg.com/vi/${yt}/mqdefault.jpg`;
}
function thumbHi(yt: string) {
  return `https://i.ytimg.com/vi/${yt}/hqdefault.jpg`;
}

function trackProgress(cat: AcademyTrack, getLessonProg: (yt: string) => LessonProgress) {
  let done = 0;
  let total = 0;
  for (const mod of cat.modules) {
    for (const l of mod.lessons) {
      total++;
      if (getLessonProg(l.yt).done) done++;
    }
  }
  return { done, total, pct: total ? Math.round(done / total * 100) : 0 };
}

/* ---- build flat list (igual ao JS original) ---- */
export interface FlatLesson {
  title: string;
  yt:    string;
  catId:       string;
  catTitle:    string;
  catColor:    string;
  moduleTitle: string;
  catIndex:    number;
  moduleIndex: number;
  lessonIndex: number;
  globalIndex: number;
}

export function buildFlatList(): FlatLesson[] {
  const list: FlatLesson[] = [];
  let gi = 0;
  CATALOG.forEach((cat, ci) => {
    cat.modules.forEach((mod, mi) => {
      mod.lessons.forEach((l, li) => {
        list.push({
          title:       l.title,
          yt:          l.yt,
          catId:       cat.id,
          catTitle:    cat.title,
          catColor:    cat.color,
          moduleTitle: mod.title,
          catIndex:    ci,
          moduleIndex: mi,
          lessonIndex: li,
          globalIndex: gi,
        });
        gi++;
      });
    });
  });
  return list;
}

/* ---- props ---- */
interface Props {
  flatList:       FlatLesson[];
  getLessonProg:  (yt: string) => LessonProgress;
  getExam:        (key: string) => ExamResult | null;
  onOpenLesson:   (globalIndex: number) => void;
  onOpenQuiz:     (key: string) => void;
}

/* ---- visão geral das trilhas (cards clicáveis) ---- */
function TrackOverview({
  getLessonProg,
  onScrollTo,
}: {
  getLessonProg: (yt: string) => LessonProgress;
  onScrollTo: (id: string) => void;
}) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
      {CATALOG.map(cat => {
        const { done, total, pct } = trackProgress(cat, getLessonProg);
        const cover = cat.modules[0]?.lessons[0]?.yt;
        const complete = pct === 100;
        return (
          <button
            key={cat.id}
            onClick={() => onScrollTo(cat.id)}
            className="group relative overflow-hidden rounded-xl text-left transition-all duration-200
                       hover:scale-[1.02] hover:shadow-lg focus-visible:outline-2 focus-visible:outline-offset-2"
            style={{ outlineColor: AC.primary }}
          >
            <div className="relative aspect-[16/10] overflow-hidden" style={{ background: "#000" }}>
              {cover && (
                <img
                  src={thumbHi(cover)}
                  alt=""
                  loading="lazy"
                  className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                />
              )}
              <div
                className="absolute inset-0"
                style={{
                  background: [
                    `linear-gradient(135deg, ${cat.color}55 0%, transparent 55%)`,
                    `linear-gradient(180deg, transparent 30%, ${AC.bg}ee 100%)`,
                  ].join(", "),
                }}
              />
              {complete && (
                <div
                  className="absolute top-2 right-2 w-6 h-6 rounded-full flex items-center justify-center"
                  style={{ background: AC.primary }}
                >
                  <Check className="w-3.5 h-3.5" style={{ color: "#fff" }} strokeWidth={3} />
                </div>
              )}
              <div className="absolute bottom-0 left-0 right-0 p-3">
                <p
                  className="text-[9px] font-bold uppercase tracking-[0.2em] mb-0.5"
                  style={{ color: cat.color, fontFamily: AC_FONT_DISPLAY }}
                >
                  Trilha
                </p>
                <p
                  className="text-sm font-bold leading-tight line-clamp-2"
                  style={{ color: AC.text, fontFamily: AC_FONT_DISPLAY, textShadow: "0 1px 6px rgba(0,0,0,.8)" }}
                >
                  {cat.title}
                </p>
              </div>
            </div>
            <div
              className="px-3 py-2.5 space-y-1.5"
              style={{ background: AC.surface, border: `1px solid ${AC.border}`, borderTop: "none" }}
            >
              <p className="text-[10px] line-clamp-1" style={{ color: AC.textMute }}>{cat.tagline}</p>
              <div className="flex items-center justify-between gap-2">
                <div className="flex-1 h-1 rounded-full overflow-hidden" style={{ background: AC.surface2 }}>
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${pct}%`, background: cat.color }}
                  />
                </div>
                <span className="text-[10px] font-bold tabular-nums shrink-0" style={{ color: AC.textDim }}>
                  {done}/{total}
                </span>
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

/* ---- fileira "Continuar assistindo" ---- */
function ContinueWatchingRow({
  flatList, getLessonProg, onOpenLesson,
}: {
  flatList: FlatLesson[];
  getLessonProg: (yt: string) => LessonProgress;
  onOpenLesson: (gi: number) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const items = useMemo(
    () => flatList
      .filter(l => { const p = getLessonProg(l.yt); return p.pct > 0 && !p.done; })
      .sort((a, b) => getLessonProg(b.yt).pct - getLessonProg(a.yt).pct)
      .slice(0, 12),
    [flatList, getLessonProg],
  );
  if (!items.length) return null;

  const scrollBy = (dir: number) => scrollRef.current?.scrollBy({ left: dir * 300, behavior: "smooth" });

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <Clock className="w-4 h-4" style={{ color: AC.primary }} />
        <h3 className="text-base font-bold" style={{ color: AC.text, fontFamily: AC_FONT_DISPLAY }}>
          Continuar assistindo
        </h3>
        <span className="text-[11px] ml-1" style={{ color: AC.textMute }}>
          {items.length} aula{items.length !== 1 ? "s" : ""} em andamento
        </span>
      </div>
      <div className="group/row relative">
        <button
          onClick={() => scrollBy(-1)}
          aria-label="Anterior"
          className="absolute left-0 top-1/2 -translate-y-1/2 z-20 w-9 h-9 rounded-full
                     flex items-center justify-center opacity-0 group-hover/row:opacity-100 transition-opacity"
          style={{ background: "rgba(17,17,17,0.9)", border: `1px solid ${AC.border}`, color: AC.text }}
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <div ref={scrollRef} className="flex gap-3 overflow-x-auto no-scrollbar pb-1" style={{ scrollSnapType: "x mandatory" }}>
          {items.map(l => {
            const prog = getLessonProg(l.yt);
            return (
              <button
                key={l.yt}
                onClick={() => onOpenLesson(l.globalIndex)}
                className="group/item relative flex-none w-52 sm:w-60 overflow-hidden rounded-lg text-left
                           transition-all duration-200 hover:scale-[1.04] focus-visible:outline-2"
                style={{ scrollSnapAlign: "start", outlineColor: AC.primary }}
              >
                <div className="relative aspect-video overflow-hidden rounded-lg" style={{ background: "#000" }}>
                  <img src={thumb(l.yt)} alt={l.title} loading="lazy"
                       className="w-full h-full object-cover transition-transform duration-500 group-hover/item:scale-105" />
                  <div className="absolute inset-0" style={{ background: `linear-gradient(180deg, transparent 40%, ${AC.bg}f0 100%)` }} />
                  <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover/item:opacity-100 transition-opacity">
                    <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: AC.primary }}>
                      <Play className="w-4 h-4 ml-0.5" style={{ fill: "#fff", color: "#fff" }} />
                    </div>
                  </div>
                  <div className="absolute bottom-0 left-0 right-0 h-1" style={{ background: "rgba(0,0,0,.5)" }}>
                    <div className="h-full" style={{ width: `${prog.pct}%`, background: AC.primary }} />
                  </div>
                  <p className="absolute left-2.5 right-2.5 bottom-2 text-xs font-semibold leading-snug line-clamp-2"
                     style={{ color: AC.text, textShadow: "0 1px 4px rgba(0,0,0,.9)" }}>
                    {l.title}
                  </p>
                </div>
                <p className="text-[10px] mt-1.5 truncate" style={{ color: AC.textMute }}>
                  {l.catTitle} · {prog.pct}% assistido
                </p>
              </button>
            );
          })}
        </div>
        <button
          onClick={() => scrollBy(1)}
          aria-label="Próximo"
          className="absolute right-0 top-1/2 -translate-y-1/2 z-20 w-9 h-9 rounded-full
                     flex items-center justify-center opacity-0 group-hover/row:opacity-100 transition-opacity"
          style={{ background: "rgba(17,17,17,0.9)", border: `1px solid ${AC.border}`, color: AC.text }}
        >
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>
    </section>
  );
}

/* ---- pôster individual (estilo Netflix card) ---- */
function LessonCard({
  lesson, num, prog, onOpen, accent,
}: {
  lesson: { title: string; yt: string };
  num:    number;
  prog:   LessonProgress;
  onOpen: () => void;
  accent?: string;
}) {
  return (
    <button
      onClick={onOpen}
      className="group/card relative flex-none w-40 sm:w-48 overflow-hidden text-left rounded-md
                 transition-all duration-200 ease-out hover:scale-[1.06] hover:z-10
                 focus-visible:outline-2 focus-visible:outline-offset-2"
      style={{ scrollSnapAlign: "start", outlineColor: accent ?? AC.primary }}
    >
      {/* thumbnail */}
      <div className="relative aspect-video overflow-hidden rounded-md" style={{ background: "#000" }}>
        <img
          loading="lazy"
          src={thumb(lesson.yt)}
          alt={lesson.title}
          className="w-full h-full object-cover transition-transform duration-500 group-hover/card:scale-[1.08]"
        />
        {/* vinheta inferior para legibilidade */}
        <div className="absolute inset-0 pointer-events-none"
             style={{ background: `linear-gradient(180deg, transparent 45%, ${AC.bg}f2 100%)` }} />

        {/* play no hover */}
        <div className="absolute inset-0 flex items-center justify-center
                        opacity-0 group-hover/card:opacity-100 transition-opacity duration-200">
          <div className="w-11 h-11 rounded-full flex items-center justify-center"
               style={{ background: AC.primary, boxShadow: `0 6px 20px -4px ${AC.primary}` }}>
            <svg viewBox="0 0 24 24" className="w-5 h-5 ml-0.5" style={{ fill: "#FFFFFF" }}>
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
        </div>

        {/* número da aula */}
        <span className="absolute top-1.5 left-2 text-[10px] font-bold tabular-nums"
              style={{ color: AC.text, fontFamily: AC_FONT_DISPLAY, textShadow: "0 1px 4px rgba(0,0,0,.8)" }}>
          {String(num).padStart(2, "0")}
        </span>

        {/* done badge */}
        {prog.done && (
          <div className="absolute top-1.5 right-1.5 w-5 h-5 flex items-center justify-center rounded-full"
               style={{ background: AC.primary }}>
            <Check className="w-3 h-3" style={{ color: "#FFFFFF" }} strokeWidth={3} />
          </div>
        )}

        {/* progress bar (em andamento) */}
        {prog.pct > 0 && !prog.done && (
          <div className="absolute bottom-0 left-0 right-0 h-[3px]" style={{ background: "rgba(0,0,0,.5)" }}>
            <div className="h-full" style={{ width: `${prog.pct}%`, background: accent ?? AC.primary }} />
          </div>
        )}

        {/* título sobre a vinheta */}
        <p className="absolute left-2 right-2 bottom-1.5 text-[11px] font-semibold leading-snug line-clamp-2"
           style={{ color: AC.text, fontFamily: AC_FONT_BODY, textShadow: "0 1px 4px rgba(0,0,0,.9)" }}>
          {lesson.title}
        </p>
      </div>
    </button>
  );
}

/* ---- fileira horizontal (Netflix row) ---- */
function ModuleRow({
  cat, mod, modIndex, flatList,
  getLessonProg, getExam, onOpenLesson, onOpenQuiz,
}: {
  cat: AcademyTrack; mod: AcademyModule; modIndex: number;
  flatList: FlatLesson[];
  getLessonProg: (yt: string) => LessonProgress;
  getExam:       (key: string) => ExamResult | null;
  onOpenLesson:  (gi: number) => void;
  onOpenQuiz:    (key: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const quizKey  = `${cat.id}-${modIndex}`;
  const hasQuiz  = !!QUIZZES[quizKey];
  const exam     = getExam(quizKey);

  const done  = mod.lessons.filter(l => getLessonProg(l.yt).done).length;
  const total = mod.lessons.length;
  const allDone = done === total && total > 0;

  const scrollBy = (dir: number) => {
    scrollRef.current?.scrollBy({ left: dir * 320, behavior: "smooth" });
  };

  return (
    <div className="space-y-2">
      {/* cabeçalho da fileira */}
      <div className="flex items-center gap-3">
        <span className="text-xs font-bold tabular-nums px-1.5 py-0.5 rounded"
              style={{ background: AC.primarySoft, color: AC.primary, fontFamily: AC_FONT_DISPLAY }}>
          {String(modIndex + 1).padStart(2, "0")}
        </span>
        <h4 className="text-sm sm:text-base font-semibold truncate"
            style={{ color: AC.text, fontFamily: AC_FONT_DISPLAY }}>
          {mod.title}
        </h4>
        {mod.certificate && (
          <span className="hidden sm:inline-flex items-center gap-1 text-[9px] font-bold tracking-wider uppercase"
                style={{ color: AC.primary }}>
            <Award className="w-3 h-3" /> Certificado
          </span>
        )}
        <span className="ml-auto text-[11px] font-semibold tabular-nums shrink-0"
              style={{ color: allDone ? AC.primary : AC.textMute, fontFamily: AC_FONT_DISPLAY }}>
          {done}/{total}
        </span>
      </div>

      {/* trilho horizontal com setas */}
      <div className="group/row relative">
        {/* seta esquerda */}
        <button
          onClick={() => scrollBy(-1)}
          aria-label="Anterior"
          className="absolute left-0 top-1/2 -translate-y-1/2 z-20 w-9 h-9 rounded-full
                     flex items-center justify-center opacity-0 group-hover/row:opacity-100
                     transition-opacity disabled:hidden"
          style={{ background: "rgba(17,17,17,0.85)", border: `1px solid ${AC.border}`, color: AC.text }}
        >
          <ChevronLeft className="w-5 h-5" />
        </button>

        <div
          ref={scrollRef}
          className="flex gap-2.5 overflow-x-auto no-scrollbar pb-1"
          style={{ scrollSnapType: "x mandatory" }}
        >
          {mod.lessons.map((l, li) => {
            const gi   = flatList.findIndex(f => f.yt === l.yt);
            const prog = getLessonProg(l.yt);
            return (
              <LessonCard
                key={l.yt}
                lesson={l}
                num={li + 1}
                prog={prog}
                accent={cat.color}
                onOpen={() => onOpenLesson(gi >= 0 ? gi : 0)}
              />
            );
          })}

          {/* card de prova ao fim da fileira */}
          {hasQuiz && (() => {
            const unlocked = allDone || exam?.passed;
            return (
              <button
                onClick={() => unlocked ? onOpenQuiz(quizKey) : undefined}
                disabled={!unlocked}
                title={unlocked ? undefined : "Conclua todas as aulas do módulo para liberar a prova"}
                className="group/card relative flex-none w-40 sm:w-48 aspect-video rounded-md overflow-hidden
                           flex flex-col items-center justify-center gap-2 transition-all duration-200
                           disabled:cursor-not-allowed"
                style={{
                  scrollSnapAlign: "start",
                  background: exam?.passed
                    ? AC.primarySoft
                    : unlocked
                    ? "rgba(255,255,255,0.04)"
                    : "rgba(255,255,255,0.02)",
                  border: `1px ${exam?.passed ? "solid" : "dashed"} ${
                    exam?.passed ? AC.primary : unlocked ? AC.border : "rgba(255,255,255,0.06)"
                  }`,
                }}
                onMouseEnter={e => { if (unlocked && !exam?.passed) e.currentTarget.style.transform = "scale(1.06)"; }}
                onMouseLeave={e => { e.currentTarget.style.transform = ""; }}
              >
                {exam?.passed
                  ? <Award className="w-7 h-7" style={{ color: AC.primary }} />
                  : unlocked
                  ? <ClipboardList className="w-7 h-7" style={{ color: AC.textDim }} />
                  : <Lock className="w-7 h-7" style={{ color: AC.textMute }} />}
                <span
                  className="text-[11px] font-bold uppercase tracking-wider px-2 text-center leading-snug"
                  style={{
                    color: exam?.passed ? AC.primary : unlocked ? AC.textDim : AC.textMute,
                    fontFamily: AC_FONT_DISPLAY,
                  }}
                >
                  {exam?.passed
                    ? `Aprovado · ${exam.score}%`
                    : unlocked
                    ? "Fazer prova"
                    : `Assista ${done}/${total} aulas`}
                </span>
              </button>
            );
          })()}
        </div>

        {/* seta direita */}
        <button
          onClick={() => scrollBy(1)}
          aria-label="Próximo"
          className="absolute right-0 top-1/2 -translate-y-1/2 z-20 w-9 h-9 rounded-full
                     flex items-center justify-center opacity-0 group-hover/row:opacity-100
                     transition-opacity"
          style={{ background: "rgba(17,17,17,0.85)", border: `1px solid ${AC.border}`, color: AC.text }}
        >
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}

/* ---- componente principal ---- */
export function AcademyCatalog({ flatList, getLessonProg, getExam, onOpenLesson, onOpenQuiz }: Props) {
  const [search, setSearch] = useState("");

  const searchTerm = search.toLowerCase().trim();
  const searchResults = searchTerm
    ? flatList.filter(l =>
        l.title.toLowerCase().includes(searchTerm) ||
        l.catTitle.toLowerCase().includes(searchTerm) ||
        l.moduleTitle.toLowerCase().includes(searchTerm)
      )
    : null;

  let lastSection = "oficial";

  const scrollToTrack = (id: string) => {
    document.getElementById(`track-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="space-y-7" style={{ color: AC.text }}>
      {/* visão geral das trilhas */}
      {searchResults === null && (
        <TrackOverview getLessonProg={getLessonProg} onScrollTo={scrollToTrack} />
      )}

      {/* continuar assistindo */}
      {searchResults === null && (
        <ContinueWatchingRow
          flatList={flatList}
          getLessonProg={getLessonProg}
          onOpenLesson={onOpenLesson}
        />
      )}

      {/* busca */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: AC.primary }} />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Buscar aula ou módulo..."
          className="w-full pl-9 pr-9 py-2.5 text-sm rounded-lg focus:outline-none transition-colors"
          style={{
            background: AC.surface,
            color: AC.text,
            border: `1px solid ${AC.border}`,
            fontFamily: AC_FONT_BODY,
          }}
        />
        {search && (
          <button
            onClick={() => setSearch("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-xs"
            style={{ color: AC.textMute }}
          >
            ✕
          </button>
        )}
      </div>

      {/* resultados da busca — grade simples */}
      {searchResults !== null && (
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.25em] mb-3"
             style={{ color: AC.primary, fontFamily: AC_FONT_DISPLAY }}>
            {searchResults.length} resultado{searchResults.length !== 1 ? "s" : ""}
          </p>
          {searchResults.length === 0 ? (
            <p className="text-sm py-8 text-center" style={{ color: AC.textMute }}>
              Nenhuma aula encontrada.
            </p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2.5">
              {searchResults.map(l => (
                <LessonCard
                  key={l.yt}
                  lesson={l}
                  num={l.lessonIndex + 1}
                  prog={getLessonProg(l.yt)}
                  onOpen={() => onOpenLesson(l.globalIndex)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* catálogo em fileiras */}
      {searchResults === null && CATALOG.map((cat) => {
        let section = "oficial";
        if (cat.id.startsWith("igreen-")) section = "igreen-pratica";
        else if (cat.id.startsWith("cap-") || cat.extra) section = "capacitacao";

        let divider: React.ReactNode = null;
        if (section !== lastSection) {
          lastSection = section;
          const txt = section === "igreen-pratica"
            ? "iGreen na Prática"
            : "Capacitação Profissional";
          const sub = section === "igreen-pratica"
            ? "aprenda com quem já faz acontecer"
            : "vendas, técnica e mercado";
          divider = (
            <div key={`div-${section}`} className="pt-2 pb-1">
              <div className="flex items-center gap-3">
                <span className="h-px w-6" style={{ background: AC.primary }} />
                <p className="text-[10px] font-bold uppercase tracking-[0.3em]"
                   style={{ color: AC.primary, fontFamily: AC_FONT_DISPLAY }}>
                  {txt}
                </p>
              </div>
              <p className="text-[11px] mt-1" style={{ color: AC.textMute }}>{sub}</p>
            </div>
          );
        }

        const totalAulas = cat.modules.reduce((s, m) => s + m.lessons.length, 0);
        const { done: trackDone, pct: trackPct } = trackProgress(cat, getLessonProg);
        const coverYt = cat.modules[0]?.lessons[0]?.yt;

        return (
          <div key={cat.id} className="space-y-4">
            {divider}
            <section id={`track-${cat.id}`} className="space-y-4 scroll-mt-6">
              {/* cabeçalho da trilha — banner com cor da trilha */}
              <div
                className="relative overflow-hidden rounded-xl"
                style={{ border: `1px solid ${AC.border}` }}
              >
                {coverYt && (
                  <img
                    src={thumbHi(coverYt)}
                    alt=""
                    aria-hidden
                    loading="lazy"
                    className="absolute inset-0 w-full h-full object-cover opacity-30"
                  />
                )}
                <div
                  className="absolute inset-0"
                  style={{
                    background: [
                      `linear-gradient(90deg, ${AC.bg}f5 0%, ${AC.bg}cc 55%, transparent 100%)`,
                      `linear-gradient(135deg, ${cat.color}33 0%, transparent 60%)`,
                    ].join(", "),
                  }}
                />
                <div className="relative flex items-end justify-between gap-4 p-4 sm:p-5">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ background: cat.color, boxShadow: `0 0 8px ${cat.color}` }}
                      />
                      <p
                        className="text-[9px] font-bold tracking-[0.3em] uppercase"
                        style={{ color: cat.color, fontFamily: AC_FONT_DISPLAY }}
                      >
                        Trilha
                      </p>
                    </div>
                    <h3
                      className="text-xl sm:text-2xl font-bold leading-tight"
                      style={{ color: AC.text, fontFamily: AC_FONT_DISPLAY }}
                    >
                      {cat.title}
                    </h3>
                    <p className="text-sm mt-1 max-w-lg" style={{ color: AC.textDim }}>
                      {cat.tagline}
                    </p>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-[11px]" style={{ color: AC.textMute }}>
                      <span>{cat.modules.length} módulo{cat.modules.length !== 1 ? "s" : ""}</span>
                      <span>·</span>
                      <span>{totalAulas} aulas</span>
                      <span>·</span>
                      <span style={{ color: trackPct === 100 ? cat.color : AC.textDim }}>
                        {trackDone}/{totalAulas} concluídas
                      </span>
                      {cat.extra && (
                        <span
                          className="text-[9px] font-bold tracking-wider uppercase px-1.5 py-0.5 rounded"
                          style={{ background: AC.primarySoft, color: AC.primary }}
                        >
                          Externo
                        </span>
                      )}
                    </div>
                    <div className="mt-3 max-w-xs flex items-center gap-2">
                      <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: AC.surface2 }}>
                        <div
                          className="h-full rounded-full transition-all duration-700"
                          style={{ width: `${trackPct}%`, background: cat.color }}
                        />
                      </div>
                      <span className="text-[11px] font-bold tabular-nums" style={{ color: cat.color }}>
                        {trackPct}%
                      </span>
                    </div>
                  </div>
                  <BookOpen className="w-5 h-5 shrink-0 hidden sm:block" style={{ color: cat.color }} />
                </div>
              </div>

              {/* fileiras dos módulos */}
              <div className="space-y-5">
                {cat.modules.map((mod, mi) => (
                  <ModuleRow
                    key={`${cat.id}-${mi}`}
                    cat={cat} mod={mod} modIndex={mi}
                    flatList={flatList}
                    getLessonProg={getLessonProg}
                    getExam={getExam}
                    onOpenLesson={onOpenLesson}
                    onOpenQuiz={onOpenQuiz}
                  />
                ))}
              </div>
            </section>
          </div>
        );
      })}
    </div>
  );
}
