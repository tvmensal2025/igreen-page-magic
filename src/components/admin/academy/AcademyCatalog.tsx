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

/* ---- pôster individual ---- */
function LessonCard({
  lesson, num, color, prog, onOpen,
}: {
  lesson: { title: string; yt: string };
  num:    number;
  color:  string;
  prog:   LessonProgress;
  onOpen: () => void;
}) {
  return (
    <button
      onClick={onOpen}
      className="relative flex-none w-44 rounded-2xl overflow-hidden text-left
                 border border-white/10 bg-[#14141a] hover:scale-[1.03]
                 hover:-translate-y-0.5 transition-transform duration-200
                 focus-visible:outline-2 focus-visible:outline-[#00A859]"
      style={{ boxShadow: prog.done ? `0 0 0 1.5px ${color}80` : undefined }}
    >
      {/* thumbnail */}
      <div className="relative aspect-video bg-black overflow-hidden">
        <img
          loading="lazy"
          src={thumb(lesson.yt)}
          alt={lesson.title}
          className="w-full h-full object-contain bg-black"
        />
        {/* play overlay */}
        <div className="absolute inset-0 flex items-center justify-center
                        opacity-0 hover:opacity-100 transition-opacity">
          <div className="w-10 h-10 rounded-full bg-white/90 flex items-center justify-center">
            <svg viewBox="0 0 24 24" className="w-5 h-5 fill-black ml-0.5">
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
        </div>
        {/* done badge */}
        {prog.done && (
          <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-[#00A859]
                          flex items-center justify-center shadow">
            <svg viewBox="0 0 24 24" className="w-3 h-3 fill-white">
              <path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z" />
            </svg>
          </div>
        )}
        {/* progress bar */}
        {prog.pct > 0 && !prog.done && (
          <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-black/40">
            <div
              className="h-full bg-[#00A859]"
              style={{ width: `${prog.pct}%` }}
            />
          </div>
        )}
      </div>
      {/* info panel */}
      <div
        className="p-2.5 space-y-0.5"
        style={{
          background: `linear-gradient(160deg, color-mix(in srgb, ${color} 18%, #12121a) 0%, #0f0f14 90%)`,
          borderTop:  `2px solid ${color}aa`,
        }}
      >
        <p className="text-[9px] font-black tracking-widest uppercase" style={{ color }}>
          AULA {String(num).padStart(2, "0")}
        </p>
        <p className="text-[11px] font-bold text-white leading-tight line-clamp-2">
          {lesson.title}
        </p>
        {prog.done && (
          <span className="inline-block text-[9px] font-black bg-[#00A859] text-black
                           px-1.5 py-0.5 rounded-full mt-1">
            ✓ Concluída
          </span>
        )}
        {!prog.done && prog.pct > 0 && (
          <span className="inline-block text-[9px] font-black bg-white/80 text-black
                           px-1.5 py-0.5 rounded-full mt-1">
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
      className={`rounded-xl overflow-hidden border transition-colors
                  ${open ? "border-white/20" : "border-white/10"} bg-[#16161b]`}
    >
      {/* cabeçalho clicável */}
      <button
        className="w-full flex items-center gap-3 p-3 sm:p-4 text-left
                   hover:bg-white/5 transition-colors"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
      >
        <span
          className="w-8 h-8 rounded-lg flex items-center justify-center
                     text-xs font-black text-white shrink-0"
          style={{ background: cat.color }}
        >
          {modIndex + 1}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-white truncate">{mod.title}</p>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[11px] text-white/40">{total} aula{total !== 1 ? "s" : ""}</span>
            {mod.certificate && (
              <span className="text-[9px] font-black text-yellow-400 flex items-center gap-0.5">
                <Award className="w-2.5 h-2.5" /> Certificado
              </span>
            )}
            <span
              className={`text-[11px] font-bold ml-auto ${allDone ? "text-[#00A859]" : "text-white/30"}`}
            >
              {done}/{total}
            </span>
          </div>
        </div>
        <ChevronDown
          className={`w-4 h-4 text-white/40 shrink-0 transition-transform duration-200
                      ${open ? "rotate-180" : ""}`}
        />
      </button>

      {/* mini barra de progresso */}
      <div className="h-[3px] bg-white/5">
        <div
          className="h-full bg-[#00A859] transition-all duration-500"
          style={{ width: trackW }}
        />
      </div>

      {/* conteúdo aberto: carrossel + botão prova */}
      {open && (
        <div>
          {/* carrossel horizontal */}
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
                    color={cat.color}
                    prog={prog}
                    onOpen={() => onOpenLesson(gi >= 0 ? gi : 0)}
                  />
                </div>
              );
            })}
          </div>

          {/* botão prova */}
          {hasQuiz && (
            <div className="px-3 pb-3 pt-1">
              <button
                onClick={() => onOpenQuiz(quizKey)}
                className={`w-full py-3 rounded-xl text-sm font-black transition-colors
                            flex items-center justify-center gap-2
                            ${exam?.passed
                              ? "bg-[#00A859] text-white"
                              : "border border-dashed border-[#00A859]/50 bg-[#00A859]/8 text-[#00A859] hover:bg-[#00A859]/15"}`}
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
