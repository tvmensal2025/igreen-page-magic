/**
 * Catálogo da Academy — estilo Netflix.
 * Trilhas → módulos, cada módulo é uma "fileira" horizontal de pôsteres de aula
 * com scroll lateral e cards que crescem no hover. Tema: iGreen oficial (dark).
 */
import { useState, useRef } from "react";
import { ChevronLeft, ChevronRight, BookOpen, Award, ClipboardList, Search, Check } from "lucide-react";
import { CATALOG, QUIZZES, type AcademyTrack, type AcademyModule } from "@/data/academyCatalog";
import type { LessonProgress, ExamResult } from "@/hooks/useAcademyProgress";
import { AC, AC_FONT_DISPLAY, AC_FONT_BODY } from "./theme";

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

/* ---- pôster individual (estilo Netflix card) ---- */
function LessonCard({
  lesson, num, prog, onOpen,
}: {
  lesson: { title: string; yt: string };
  num:    number;
  prog:   LessonProgress;
  onOpen: () => void;
}) {
  return (
    <button
      onClick={onOpen}
      className="group/card relative flex-none w-40 sm:w-48 overflow-hidden text-left rounded-md
                 transition-all duration-200 ease-out hover:scale-[1.06] hover:z-10
                 focus-visible:outline-2 focus-visible:outline-offset-2"
      style={{ scrollSnapAlign: "start", outlineColor: AC.primary }}
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
            <div className="h-full" style={{ width: `${prog.pct}%`, background: AC.primary }} />
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
                onOpen={() => onOpenLesson(gi >= 0 ? gi : 0)}
              />
            );
          })}

          {/* card de prova ao fim da fileira */}
          {hasQuiz && (
            <button
              onClick={() => onOpenQuiz(quizKey)}
              className="group/card relative flex-none w-40 sm:w-48 aspect-video rounded-md overflow-hidden
                         flex flex-col items-center justify-center gap-2 transition-all duration-200 hover:scale-[1.06]"
              style={{
                scrollSnapAlign: "start",
                background: exam?.passed ? AC.primarySoft : "rgba(255,255,255,0.04)",
                border: `1px ${exam?.passed ? "solid" : "dashed"} ${exam?.passed ? AC.primary : AC.border}`,
              }}
            >
              {exam?.passed
                ? <Award className="w-7 h-7" style={{ color: AC.primary }} />
                : <ClipboardList className="w-7 h-7" style={{ color: AC.textDim }} />}
              <span className="text-[11px] font-bold uppercase tracking-wider px-2 text-center"
                    style={{ color: exam?.passed ? AC.primary : AC.textDim, fontFamily: AC_FONT_DISPLAY }}>
                {exam?.passed ? `Aprovado · ${exam.score}%` : "Fazer prova"}
              </span>
            </button>
          )}
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

  return (
    <div className="space-y-7" style={{ color: AC.text }}>
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

        return (
          <div key={cat.id} className="space-y-4">
            {divider}
            <section className="space-y-4">
              {/* cabeçalho da trilha */}
              <div className="flex items-end justify-between gap-3 pb-1"
                   style={{ borderBottom: `1px solid ${AC.border}` }}>
                <div>
                  <p className="text-[9px] font-bold tracking-[0.3em] uppercase"
                     style={{ color: AC.primary, fontFamily: AC_FONT_DISPLAY }}>
                    Trilha
                  </p>
                  <h3 className="text-lg sm:text-xl font-bold leading-tight mt-0.5"
                      style={{ color: AC.text, fontFamily: AC_FONT_DISPLAY }}>
                    {cat.title}
                  </h3>
                  <p className="text-[11px] mt-0.5" style={{ color: AC.textMute }}>
                    {cat.modules.length} módulo{cat.modules.length !== 1 ? "s" : ""} · {totalAulas} aulas
                    {cat.extra && (
                      <span className="ml-2 text-[9px] font-bold tracking-wider uppercase px-1.5 py-0.5 rounded"
                            style={{ background: AC.primarySoft, color: AC.primary }}>
                        Externo
                      </span>
                    )}
                  </p>
                </div>
                <BookOpen className="w-4 h-4 shrink-0 mb-1" style={{ color: AC.primary }} />
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
