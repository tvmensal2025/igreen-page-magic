/**
 * Catálogo da Academy: trilhas → módulos (accordion) → pôsteres de aulas.
 */
import { useState, useRef, useEffect } from "react";
import { ChevronDown, BookOpen, Award, ClipboardList } from "lucide-react";
import { CATALOG, QUIZZES, type AcademyTrack, type AcademyModule } from "@/data/academyCatalog";
import type { LessonProgress, ExamResult } from "@/hooks/useAcademyProgress";

function thumb(yt: string) {
  return `https://i.ytimg.com/vi/${yt}/mqdefault.jpg`;
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

/* ---- tokens locais (paleta Esmeralda Premium) ---- */
const GOLD     = "#c9a84c";
const GOLD_SFT = "#d9bb6a";
const CREAM    = "#f5f0e0";
const EMERALD  = "#0d7a5f";
const EMERALD_DP = "#064e3b";
const SURFACE  = "#0f1d17";
const SURFACE2 = "#142a22";
const FONT_DISPLAY = "'Space Grotesk', 'DM Sans', system-ui, sans-serif";

/* ---- pôster individual (editorial) ---- */
function LessonCard({
  lesson, num, prog, onOpen,
}: {
  lesson: { title: string; yt: string };
  num:    number;
  color?: string;
  prog:   LessonProgress;
  onOpen: () => void;
}) {
  return (
    <button
      onClick={onOpen}
      className="group relative flex-none w-44 overflow-hidden text-left
                 transition-transform duration-200 hover:-translate-y-0.5
                 focus-visible:outline-2"
      style={{
        background: SURFACE,
        border: `1px solid ${prog.done ? GOLD : "rgba(245,240,224,.10)"}`,
        borderRadius: 3,
        outlineColor: GOLD,
      }}
    >
      {/* thumbnail */}
      <div className="relative aspect-video overflow-hidden" style={{ background: "#000" }}>
        <img
          loading="lazy"
          src={thumb(lesson.yt)}
          alt={lesson.title}
          className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.06]"
        />
        {/* vinheta */}
        <div className="absolute inset-0 pointer-events-none"
             style={{ background: `linear-gradient(180deg, transparent 50%, ${EMERALD_DP}cc 100%)` }} />

        {/* play */}
        <div className="absolute inset-0 flex items-center justify-center
                        opacity-0 group-hover:opacity-100 transition-opacity">
          <div className="w-9 h-9 rounded-full flex items-center justify-center"
               style={{ background: CREAM, boxShadow: `0 0 0 1px ${GOLD}` }}>
            <svg viewBox="0 0 24 24" className="w-4 h-4 ml-0.5" style={{ fill: EMERALD_DP }}>
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
        </div>

        {/* done badge */}
        {prog.done && (
          <div className="absolute top-1.5 right-1.5 w-5 h-5 flex items-center justify-center"
               style={{ background: GOLD, borderRadius: 1 }}>
            <svg viewBox="0 0 24 24" className="w-3 h-3" style={{ fill: EMERALD_DP }}>
              <path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z" />
            </svg>
          </div>
        )}

        {/* progress bar */}
        {prog.pct > 0 && !prog.done && (
          <div className="absolute bottom-0 left-0 right-0 h-[3px]" style={{ background: "rgba(0,0,0,.5)" }}>
            <div className="h-full" style={{ width: `${prog.pct}%`, background: GOLD }} />
          </div>
        )}
      </div>

      {/* info panel editorial */}
      <div className="p-2.5 space-y-1" style={{ background: SURFACE }}>
        <div className="flex items-center gap-1.5">
          <span className="h-px flex-1" style={{ background: GOLD }} />
          <p className="text-[9px] font-bold tracking-[0.25em] uppercase"
             style={{ color: GOLD, fontFamily: FONT_DISPLAY }}>
            Aula {String(num).padStart(2, "0")}
          </p>
          <span className="h-px flex-1" style={{ background: GOLD }} />
        </div>
        <p className="text-[11px] font-semibold leading-snug line-clamp-2"
           style={{ color: CREAM, fontFamily: FONT_DISPLAY }}>
          {lesson.title}
        </p>
        {prog.done && (
          <span className="inline-block text-[9px] font-bold tracking-wider uppercase px-1.5 py-0.5 mt-0.5"
                style={{ background: GOLD, color: EMERALD_DP, borderRadius: 1, fontFamily: FONT_DISPLAY }}>
            Concluída
          </span>
        )}
        {!prog.done && prog.pct > 0 && (
          <span className="inline-block text-[9px] font-bold tracking-wider px-1.5 py-0.5 mt-0.5"
                style={{ border: `1px solid ${GOLD}`, color: GOLD_SFT, borderRadius: 1, fontFamily: FONT_DISPLAY }}>
            {prog.pct}%
          </span>
        )}
      </div>
    </button>
  );
}

/* ---- módulo (accordion) ---- */
function ModuleBlock({
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
  const [open, setOpen] = useState(false);
  const quizKey  = `${cat.id}-${modIndex}`;
  const hasQuiz  = !!QUIZZES[quizKey];
  const exam     = getExam(quizKey);

  const done  = mod.lessons.filter(l => getLessonProg(l.yt).done).length;
  const total = mod.lessons.length;
  const allDone = done === total && total > 0;
  const trackW  = total ? `${(done / total) * 100}%` : "0%";

  return (
    <div
      className="overflow-hidden transition-colors"
      style={{
        background: SURFACE,
        border: `1px solid ${open ? GOLD : "rgba(245,240,224,.10)"}`,
        borderRadius: 3,
      }}
    >
      {/* cabeçalho clicável */}
      <button
        className="w-full flex items-center gap-3 p-3 sm:p-4 text-left transition-colors hover:bg-[rgba(245,240,224,.04)]"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
      >
        <span
          className="w-9 h-9 flex items-center justify-center text-xs font-bold shrink-0"
          style={{
            background: open ? GOLD : "transparent",
            color: open ? EMERALD_DP : GOLD,
            border: `1px solid ${GOLD}`,
            borderRadius: 1,
            fontFamily: FONT_DISPLAY,
          }}
        >
          {String(modIndex + 1).padStart(2, "0")}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate"
             style={{ color: CREAM, fontFamily: FONT_DISPLAY }}>
            {mod.title}
          </p>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[10px] tracking-wider uppercase"
                  style={{ color: "rgba(245,240,224,.4)" }}>
              {total} aula{total !== 1 ? "s" : ""}
            </span>
            {mod.certificate && (
              <span className="text-[9px] font-bold tracking-wider uppercase flex items-center gap-0.5"
                    style={{ color: GOLD, fontFamily: FONT_DISPLAY }}>
                <Award className="w-2.5 h-2.5" /> Certificado
              </span>
            )}
            <span
              className="text-[11px] font-bold ml-auto"
              style={{ color: allDone ? GOLD : "rgba(245,240,224,.3)", fontFamily: FONT_DISPLAY }}
            >
              {done}/{total}
            </span>
          </div>
        </div>
        <ChevronDown
          className="w-4 h-4 shrink-0 transition-transform duration-200"
          style={{ color: GOLD, transform: open ? "rotate(180deg)" : undefined }}
        />
      </button>

      {/* mini barra */}
      <div className="h-[2px]" style={{ background: "rgba(245,240,224,.08)" }}>
        <div
          className="h-full transition-all duration-500"
          style={{ width: trackW, background: `linear-gradient(90deg, ${EMERALD}, ${GOLD})` }}
        />
      </div>

      {open && (
        <div>
          <div
            className="flex gap-3 overflow-x-auto px-3 pt-3 pb-2
                       scrollbar-thin scrollbar-thumb-white/20 scrollbar-track-transparent"
            style={{ scrollSnapType: "x mandatory" }}
          >
            {mod.lessons.map((l, li) => {
              const gi   = flatList.findIndex(f => f.yt === l.yt);
              const prog = getLessonProg(l.yt);
              return (
                <div key={l.yt} style={{ scrollSnapAlign: "start" }}>
                  <LessonCard
                    lesson={l}
                    num={li + 1}
                    prog={prog}
                    onOpen={() => onOpenLesson(gi >= 0 ? gi : 0)}
                  />
                </div>
              );
            })}
          </div>

          {hasQuiz && (
            <div className="px-3 pb-3 pt-1">
              <button
                onClick={() => onOpenQuiz(quizKey)}
                className="w-full py-3 text-sm font-bold transition-colors
                           flex items-center justify-center gap-2 uppercase tracking-wider"
                style={{
                  background: exam?.passed ? GOLD : "transparent",
                  color: exam?.passed ? EMERALD_DP : GOLD,
                  border: `1px ${exam?.passed ? "solid" : "dashed"} ${GOLD}`,
                  borderRadius: 2,
                  fontFamily: FONT_DISPLAY,
                }}
              >
                {exam?.passed
                  ? <><Award className="w-4 h-4" /> Aprovado · {exam.score}%</>
                  : <><ClipboardList className="w-4 h-4" /> Fazer prova</>}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ---- componente principal ---- */
export function AcademyCatalog({ flatList, getLessonProg, getExam, onOpenLesson, onOpenQuiz }: Props) {
  const [search, setSearch] = useState("");

  // filtra aulas pelo termo
  const searchTerm = search.toLowerCase().trim();
  const searchResults = searchTerm
    ? flatList.filter(l =>
        l.title.toLowerCase().includes(searchTerm) ||
        l.catTitle.toLowerCase().includes(searchTerm) ||
        l.moduleTitle.toLowerCase().includes(searchTerm)
      )
    : null;

  // divisores de seção
  let lastSection = "oficial";

  return (
    <div className="space-y-4">
      {/* campo de busca */}
      <div className="relative">
        <svg
          className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30"
          viewBox="0 0 24 24"
        >
          <path fill="currentColor" d="M15.5 14h-.79l-.28-.27a6.5 6.5 0 1 0-.7.7l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0A4.5 4.5 0 1 1 14 9.5 4.5 4.5 0 0 1 9.5 14z" />
        </svg>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Buscar aula ou módulo..."
          className="w-full pl-9 pr-4 py-2.5 rounded-xl text-sm text-white
                     bg-white/5 border border-white/10 placeholder-white/30
                     focus:outline-none focus:border-[#00A859]/50 transition-colors"
        />
        {search && (
          <button
            onClick={() => setSearch("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40
                       hover:text-white/70 text-xs"
          >
            ✕
          </button>
        )}
      </div>

      {/* ---- RESULTADOS DE BUSCA ---- */}
      {searchResults !== null && (
        <div>
          <p className="text-xs text-white/40 font-semibold mb-3">
            {searchResults.length} resultado{searchResults.length !== 1 ? "s" : ""}
          </p>
          {searchResults.length === 0 ? (
            <p className="text-sm text-white/40 py-8 text-center">
              Nenhuma aula encontrada.
            </p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
              {searchResults.map(l => (
                <LessonCard
                  key={l.yt}
                  lesson={l}
                  num={l.lessonIndex + 1}
                  color={l.catColor}
                  prog={getLessonProg(l.yt)}
                  onOpen={() => onOpenLesson(l.globalIndex)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ---- CATÁLOGO COMPLETO ---- */}
      {searchResults === null && CATALOG.map((cat, ci) => {
        let section = "oficial";
        if (cat.id.startsWith("igreen-")) section = "igreen-pratica";
        else if (cat.id.startsWith("cap-") || cat.extra) section = "capacitacao";

        let divider: React.ReactNode = null;
        if (section !== lastSection) {
          lastSection = section;
          const txt = section === "igreen-pratica"
            ? "🚀 Treinamentos iGreen na Prática — aprenda com quem já faz acontecer"
            : "📚 Capacitação Profissional — vendas, técnica e mercado";
          divider = (
            <div key={`div-${section}`} className="flex items-center gap-3 my-2">
              <div className="flex-1 h-px bg-white/8" />
              <span className="text-[11px] font-bold text-white/30 uppercase tracking-wider shrink-0 max-w-[60%] text-center">
                {txt}
              </span>
              <div className="flex-1 h-px bg-white/8" />
            </div>
          );
        }

        const totalAulas = cat.modules.reduce((s, m) => s + m.lessons.length, 0);

        return (
          <div key={cat.id}>
            {divider}
            <section className="space-y-2">
              {/* cabeçalho da trilha */}
              <div
                className="flex items-center gap-3 pl-3 border-l-4"
                style={{ borderColor: cat.color }}
              >
                <div className="flex-1 min-w-0">
                  <h3 className="text-base sm:text-lg font-black text-white leading-tight truncate">
                    {cat.title}
                  </h3>
                  <p className="text-xs text-white/40 mt-0.5">
                    {cat.modules.length} módulo{cat.modules.length !== 1 ? "s" : ""} · {totalAulas} aulas
                    {cat.extra && (
                      <span className="ml-2 text-[9px] font-black bg-[#00A859] text-black px-1.5 py-0.5 rounded">
                        Externo
                      </span>
                    )}
                  </p>
                </div>
                <BookOpen className="w-4 h-4 text-white/20 shrink-0" />
              </div>

              {/* módulos */}
              <div className="space-y-2">
                {cat.modules.map((mod, mi) => (
                  <ModuleBlock
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
