/**
 * Aba "Academy" do painel admin — redesign editorial magazine
 * Paleta: Esmeralda Premium (#064e3b, #0d7a5f, #c9a84c, #f5f0e0)
 * Tipografia: Space Grotesk (display) + DM Sans (body)
 */
import { useMemo, useState, useCallback, useEffect } from "react";
import { Play, ArrowRight } from "lucide-react";
import { CATALOG, KNOWLEDGE_LEVELS } from "@/data/academyCatalog";
import { useAcademyProgress } from "@/hooks/useAcademyProgress";
import type { ExamResult } from "@/hooks/useAcademyProgress";
import { AcademyCatalog, buildFlatList, type FlatLesson } from "./AcademyCatalog";
import { AcademyPlayer } from "./AcademyPlayer";
import { AcademyQuizModal } from "./AcademyQuizModal";

/* ---- thumbs ---- */
const thumbHi = (yt: string) => `https://i.ytimg.com/vi/${yt}/maxresdefault.jpg`;
const thumbLo = (yt: string) => `https://i.ytimg.com/vi/${yt}/hqdefault.jpg`;

/* ---- nível ---- */
function currentLevel(p: number) {
  let l = KNOWLEDGE_LEVELS[0];
  for (const x of KNOWLEDGE_LEVELS) if (p >= x.min) l = x;
  return l;
}
function nextLevel(p: number) {
  return KNOWLEDGE_LEVELS.find(l => l.min > p) ?? null;
}

/* ---- paleta tokens (escopo local) ---- */
const C = {
  bg:        "#08120e",
  surface:   "#0f1d17",
  surface2:  "#142a22",
  emerald:   "#0d7a5f",
  emeraldDp: "#064e3b",
  gold:      "#c9a84c",
  goldSoft:  "#d9bb6a",
  cream:     "#f5f0e0",
  cream60:   "rgba(245,240,224,.62)",
  cream40:   "rgba(245,240,224,.40)",
  cream20:   "rgba(245,240,224,.18)",
  cream10:   "rgba(245,240,224,.09)",
};

const FONT_FAMILY_BODY = "'DM Sans', system-ui, sans-serif";
const FONT_FAMILY_DISPLAY = "'Space Grotesk', 'DM Sans', system-ui, sans-serif";

/* injeta Google Fonts uma vez */
function useAcademyFonts() {
  useEffect(() => {
    const id = "academy-fonts-link";
    if (document.getElementById(id)) return;
    const l = document.createElement("link");
    l.id = id;
    l.rel = "stylesheet";
    l.href = "https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700&display=swap";
    document.head.appendChild(l);
  }, []);
}

/* ========================================== */
export function AcademyTab() {
  useAcademyFonts();

  const {
    getLessonProg, setLessonProg, markDone,
    getExam, setExamResult,
    lastIdx, saveLastIdx,
    passedCount,
  } = useAcademyProgress();

  const flatList = useMemo<FlatLesson[]>(buildFlatList, []);

  const resumeIdx = useMemo(() => {
    if (lastIdx !== null && flatList[lastIdx] && !getLessonProg(flatList[lastIdx].yt).done) return lastIdx;
    const i = flatList.findIndex(l => !getLessonProg(l.yt).done);
    return i === -1 ? 0 : i;
  }, [flatList, lastIdx, getLessonProg]);

  const [playerIdx, setPlayerIdx] = useState<number | null>(null);
  const openPlayer  = useCallback((gi: number) => { setPlayerIdx(gi); saveLastIdx(gi); }, [saveLastIdx]);
  const closePlayer = useCallback(() => setPlayerIdx(null), []);

  const [quizKey, setQuizKey] = useState<string | null>(null);
  const handleQuizPass = useCallback((key: string, r: ExamResult) => {
    setExamResult(key, r.score, r.passed);
  }, [setExamResult]);

  /* stats */
  const totalAulas = flatList.length;
  const doneAulas  = flatList.filter(l => getLessonProg(l.yt).done).length;
  const pct        = totalAulas ? Math.round(doneAulas / totalAulas * 100) : 0;
  const totalQuizzes = CATALOG.reduce((s, c) => s + c.modules.length, 0);

  const lvl = currentLevel(passedCount);
  const nxt = nextLevel(passedCount);
  const resumeLesson = flatList[resumeIdx];
  const anyProgress  = flatList.some(l => getLessonProg(l.yt).pct > 0);

  /* ---- player aberto ---- */
  if (playerIdx !== null && flatList[playerIdx]) {
    const l = flatList[playerIdx];
    return (
      <>
        <AcademyPlayer
          videoId={l.yt}
          lesson={{ title: l.title, yt: l.yt, catTitle: l.catTitle, moduleTitle: l.moduleTitle }}
          progress={getLessonProg(l.yt)}
          hasPrev={playerIdx > 0}
          hasNext={playerIdx < flatList.length - 1}
          onPrev={() => openPlayer(playerIdx - 1)}
          onNext={() => openPlayer(playerIdx + 1)}
          onClose={closePlayer}
          onProgress={setLessonProg}
          onMarkDone={(yt) => markDone(yt)}
        />
        {quizKey && (
          <AcademyQuizModal
            quizKey={quizKey}
            lastResult={getExam(quizKey)}
            onClose={() => setQuizKey(null)}
            onPass={handleQuizPass}
          />
        )}
      </>
    );
  }

  return (
    <div
      className="min-h-full w-full"
      style={{
        background: `radial-gradient(120% 60% at 50% 0%, ${C.emeraldDp}33 0%, ${C.bg} 60%)`,
        color: C.cream,
        fontFamily: FONT_FAMILY_BODY,
      }}
    >
      <div className="max-w-4xl mx-auto px-4 py-6 space-y-8">

        {/* ===== EDITORIAL MASTHEAD ===== */}
        <header className="flex items-end justify-between border-b pb-3"
                style={{ borderColor: C.cream20 }}>
          <div>
            <p className="text-[10px] font-bold tracking-[0.32em] uppercase"
               style={{ color: C.gold, fontFamily: FONT_FAMILY_DISPLAY }}>
              iGreen · Academy
            </p>
            <p className="text-[10px] mt-0.5" style={{ color: C.cream40 }}>
              Edição contínua · Treinamento oficial
            </p>
          </div>
          <div className="text-right">
            <p className="text-[10px] tracking-[0.2em] uppercase" style={{ color: C.cream40 }}>
              Nível
            </p>
            <p className="text-sm font-bold" style={{ color: C.cream, fontFamily: FONT_FAMILY_DISPLAY }}>
              {lvl.icon} {lvl.name}
            </p>
          </div>
        </header>

        {/* ===== HERO COVER (magazine) ===== */}
        {resumeLesson && (
          <section className="space-y-4">
            {/* capa de revista — imagem full-bleed com kicker dentro */}
            <button
              onClick={() => openPlayer(resumeIdx)}
              className="group relative block w-full overflow-hidden text-left aspect-[4/5] sm:aspect-[16/9] lg:aspect-[21/9]"
              style={{
                borderRadius: 4,
                background: C.surface,
              }}
            >
              {/* foto */}
              <img
                src={thumbHi(resumeLesson.yt)}
                onError={(e) => { (e.currentTarget as HTMLImageElement).src = thumbLo(resumeLesson.yt); }}
                alt={resumeLesson.title}
                className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-[1.04]"
              />
              {/* vinheta editorial */}
              <div
                className="absolute inset-0"
                style={{
                  background: `linear-gradient(180deg, ${C.emeraldDp}33 0%, transparent 30%, ${C.bg}cc 70%, ${C.bg} 100%)`,
                }}
              />
              {/* moldura interna */}
              <div className="absolute inset-3 border pointer-events-none"
                   style={{ borderColor: `${C.cream}26`, borderRadius: 2 }} />

              {/* kicker topo */}
              <div className="absolute top-5 left-5 right-5 flex items-center gap-2">
                <span className="h-px flex-1" style={{ background: C.gold }} />
                <span className="text-[10px] font-bold tracking-[0.3em] uppercase"
                      style={{ color: C.gold, fontFamily: FONT_FAMILY_DISPLAY }}>
                  {anyProgress ? "Continue · Capítulo em aberto" : "Comece por aqui"}
                </span>
                <span className="h-px flex-1" style={{ background: C.gold }} />
              </div>

              {/* play */}
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2
                              w-16 h-16 rounded-full flex items-center justify-center
                              transition-transform duration-300 group-hover:scale-110"
                   style={{
                     background: C.cream,
                     boxShadow: `0 0 0 1px ${C.gold}, 0 20px 60px -10px ${C.emeraldDp}`,
                   }}>
                <Play className="w-6 h-6 ml-0.5" style={{ fill: C.emeraldDp, color: C.emeraldDp }} />
              </div>

              {/* manchete */}
              <div className="absolute left-0 right-0 bottom-0 p-5 sm:p-7">
                <p className="text-[10px] font-semibold tracking-[0.25em] uppercase mb-2"
                   style={{ color: C.goldSoft }}>
                  {resumeLesson.catTitle}
                </p>
                <h1 className="font-bold leading-[1.05] tracking-tight"
                    style={{
                      fontFamily: FONT_FAMILY_DISPLAY,
                      color: C.cream,
                      fontSize: "clamp(1.6rem, 7vw, 2.4rem)",
                    }}>
                  {resumeLesson.title}
                </h1>
                <div className="mt-3 flex items-center gap-2 text-[11px]" style={{ color: C.cream60 }}>
                  <span>{resumeLesson.moduleTitle}</span>
                </div>
              </div>
            </button>

            {/* CTA editorial */}
            <button
              onClick={() => openPlayer(resumeIdx)}
              className="w-full flex items-center justify-between px-5 py-4 transition-colors"
              style={{
                background: C.cream,
                color: C.emeraldDp,
                borderRadius: 2,
                fontFamily: FONT_FAMILY_DISPLAY,
              }}
            >
              <span className="text-sm font-bold tracking-wide uppercase">
                {anyProgress ? "Retomar leitura" : "Assistir agora"}
              </span>
              <ArrowRight className="w-5 h-5" />
            </button>
          </section>
        )}

        {/* ===== STATS GRID (editorial) ===== */}
        <section className="grid grid-cols-3 gap-px border"
                 style={{ borderColor: C.cream20, background: C.cream20 }}>
          <Stat
            kicker="Aulas"
            value={`${doneAulas}`}
            sub={`de ${totalAulas}`}
            accent={C.gold}
          />
          <Stat
            kicker="Progresso"
            value={`${pct}%`}
            sub="completo"
            accent={C.emerald}
          />
          <Stat
            kicker="Provas"
            value={`${passedCount}`}
            sub={`de ${totalQuizzes}`}
            accent={C.gold}
          />
        </section>

        {/* ===== PROGRESS BAR EDITORIAL ===== */}
        <section className="space-y-2">
          <div className="flex items-baseline justify-between">
            <p className="text-[10px] tracking-[0.3em] uppercase font-bold"
               style={{ color: C.gold, fontFamily: FONT_FAMILY_DISPLAY }}>
              Sua jornada
            </p>
            <p className="text-[11px]" style={{ color: C.cream40 }}>
              {nxt
                ? `Faltam ${nxt.min - passedCount} prova${nxt.min - passedCount !== 1 ? "s" : ""} para ${nxt.name}`
                : "Nível máximo alcançado"}
            </p>
          </div>
          <div className="h-[6px] w-full overflow-hidden" style={{ background: C.cream10, borderRadius: 1 }}>
            <div
              className="h-full transition-all duration-700"
              style={{
                width: `${pct}%`,
                background: `linear-gradient(90deg, ${C.emerald}, ${C.gold})`,
              }}
            />
          </div>
        </section>

        {/* ===== CATÁLOGO ===== */}
        <section className="space-y-3">
          <div className="flex items-center gap-3">
            <span className="h-px flex-1" style={{ background: C.cream20 }} />
            <p className="text-[10px] font-bold tracking-[0.32em] uppercase"
               style={{ color: C.gold, fontFamily: FONT_FAMILY_DISPLAY }}>
              Sumário
            </p>
            <span className="h-px flex-1" style={{ background: C.cream20 }} />
          </div>
          <AcademyCatalog
            flatList={flatList}
            getLessonProg={getLessonProg}
            getExam={getExam}
            onOpenLesson={openPlayer}
            onOpenQuiz={setQuizKey}
          />
        </section>

        {/* ===== COLOFON ===== */}
        <footer className="text-center pt-6 pb-2 border-t"
                style={{ borderColor: C.cream20 }}>
          <p className="text-[10px] tracking-[0.3em] uppercase"
             style={{ color: C.cream40, fontFamily: FONT_FAMILY_DISPLAY }}>
            iGreen Academy
          </p>
          <p className="text-[10px] mt-1" style={{ color: C.cream20 }}>
            Conteúdo de treinamento oficial iGreen Energy
          </p>
        </footer>
      </div>

      {quizKey && (
        <AcademyQuizModal
          quizKey={quizKey}
          lastResult={getExam(quizKey)}
          onClose={() => setQuizKey(null)}
          onPass={handleQuizPass}
        />
      )}
    </div>
  );
}

/* ---- componente stat editorial ---- */
function Stat({ kicker, value, sub, accent }: {
  kicker: string; value: string; sub: string; accent: string;
}) {
  return (
    <div className="p-4 text-center" style={{ background: C.bg }}>
      <p className="text-[9px] font-bold tracking-[0.25em] uppercase"
         style={{ color: accent, fontFamily: FONT_FAMILY_DISPLAY }}>
        {kicker}
      </p>
      <p className="mt-1 text-2xl sm:text-3xl font-bold leading-none"
         style={{ color: C.cream, fontFamily: FONT_FAMILY_DISPLAY }}>
        {value}
      </p>
      <p className="mt-1 text-[10px]" style={{ color: C.cream40 }}>
        {sub}
      </p>
    </div>
  );
}
