/**
 * Aba "Academy" do painel admin — estilo Netflix / streaming.
 * Hero billboard + fileiras horizontais de catálogo.
 * Tema: iGreen oficial (modo escuro) — ver ./theme.ts
 */
import { useMemo, useState, useCallback } from "react";
import { Play, Info, Award } from "lucide-react";
import { CATALOG, KNOWLEDGE_LEVELS } from "@/data/academyCatalog";
import { useAcademyProgress } from "@/hooks/useAcademyProgress";
import type { ExamResult } from "@/hooks/useAcademyProgress";
import { AcademyCatalog, buildFlatList, type FlatLesson } from "./AcademyCatalog";
import { AcademyPlayer } from "./AcademyPlayer";
import { AcademyQuizModal } from "./AcademyQuizModal";
import { AC, AC_FONT_DISPLAY, AC_FONT_BODY } from "./theme";

const thumbHi = (yt: string) => `https://i.ytimg.com/vi/${yt}/maxresdefault.jpg`;
const thumbLo = (yt: string) => `https://i.ytimg.com/vi/${yt}/hqdefault.jpg`;

function currentLevel(p: number) {
  let l = KNOWLEDGE_LEVELS[0];
  for (const x of KNOWLEDGE_LEVELS) if (p >= x.min) l = x;
  return l;
}
function nextLevel(p: number) {
  return KNOWLEDGE_LEVELS.find(l => l.min > p) ?? null;
}

export function AcademyTab() {
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

  const totalAulas   = flatList.length;
  const doneAulas    = flatList.filter(l => getLessonProg(l.yt).done).length;
  const pct          = totalAulas ? Math.round(doneAulas / totalAulas * 100) : 0;
  const totalQuizzes = CATALOG.reduce((s, c) => s + c.modules.length, 0);

  const lvl          = currentLevel(passedCount);
  const nxt          = nextLevel(passedCount);
  const resumeLesson = flatList[resumeIdx];
  const anyProgress  = flatList.some(l => getLessonProg(l.yt).pct > 0);

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
      style={{ background: AC.bg, color: AC.text, fontFamily: AC_FONT_BODY }}
    >
      {/* ===== HERO BILLBOARD (Netflix) ===== */}
      {resumeLesson && (
        <section className="relative w-full overflow-hidden" style={{ minHeight: "clamp(320px, 52vw, 520px)" }}>
          {/* imagem de fundo */}
          <img
            src={thumbHi(resumeLesson.yt)}
            onError={(e) => { (e.currentTarget as HTMLImageElement).src = thumbLo(resumeLesson.yt); }}
            alt=""
            aria-hidden
            className="absolute inset-0 w-full h-full object-cover object-top"
          />

          {/* gradientes cinematográficos */}
          <div className="absolute inset-0 pointer-events-none"
               style={{
                 background: [
                   `linear-gradient(90deg, ${AC.bg}ee 0%, ${AC.bg}88 45%, transparent 100%)`,
                   `linear-gradient(180deg, transparent 30%, ${AC.bg}cc 75%, ${AC.bg} 100%)`,
                 ].join(", "),
               }} />

          {/* conteúdo do billboard */}
          <div className="relative z-10 flex flex-col justify-end h-full min-h-[inherit] px-4 sm:px-8 pb-8 pt-24 max-w-6xl mx-auto">
            {/* badge de nível */}
            <div className="absolute top-5 right-4 sm:right-8 flex items-center gap-2 px-3 py-1.5 rounded-full"
                 style={{ background: "rgba(0,0,0,0.55)", border: `1px solid ${AC.border}` }}>
              <Award className="w-3.5 h-3.5" style={{ color: AC.primary }} />
              <span className="text-[11px] font-semibold" style={{ color: AC.text, fontFamily: AC_FONT_DISPLAY }}>
                {lvl.icon} {lvl.name}
              </span>
            </div>

            {/* kicker */}
            <p className="text-[10px] font-bold tracking-[0.3em] uppercase mb-2"
               style={{ color: AC.primary, fontFamily: AC_FONT_DISPLAY }}>
              {anyProgress ? "Continue assistindo" : "Comece por aqui"}
            </p>

            {/* título principal */}
            <h1 className="font-bold leading-[1.05] tracking-tight max-w-2xl"
                style={{
                  fontFamily: AC_FONT_DISPLAY,
                  color: AC.text,
                  fontSize: "clamp(1.6rem, 4vw, 2.75rem)",
                  textShadow: "0 2px 16px rgba(0,0,0,0.7)",
                }}>
              {resumeLesson.title}
            </h1>

            <p className="text-sm mt-2 max-w-xl" style={{ color: AC.textDim }}>
              {resumeLesson.catTitle} · {resumeLesson.moduleTitle}
            </p>

            {/* stats inline */}
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 mt-4 text-[12px]"
                 style={{ color: AC.textMute }}>
              <span><strong style={{ color: AC.text }}>{doneAulas}/{totalAulas}</strong> aulas</span>
              <span><strong style={{ color: AC.primary }}>{pct}%</strong> concluído</span>
              <span><strong style={{ color: AC.text }}>{passedCount}/{totalQuizzes}</strong> provas</span>
            </div>

            {/* CTAs estilo Netflix */}
            <div className="flex flex-wrap items-center gap-3 mt-5">
              <button
                onClick={() => openPlayer(resumeIdx)}
                className="inline-flex items-center gap-2 px-6 py-2.5 rounded-md font-bold text-sm
                           transition-transform hover:scale-[1.03] active:scale-[0.98]"
                style={{ background: AC.primary, color: "#FFFFFF", fontFamily: AC_FONT_DISPLAY }}
              >
                <Play className="w-4 h-4" style={{ fill: "#FFFFFF" }} />
                {anyProgress ? "Retomar" : "Assistir agora"}
              </button>
              <button
                onClick={() => {
                  document.getElementById("academy-catalog")?.scrollIntoView({ behavior: "smooth" });
                }}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-md font-semibold text-sm
                           transition-colors hover:bg-white/10"
                style={{
                  background: "rgba(255,255,255,0.12)",
                  color: AC.text,
                  border: `1px solid ${AC.border}`,
                  fontFamily: AC_FONT_DISPLAY,
                }}
              >
                <Info className="w-4 h-4" />
                Ver catálogo
              </button>
            </div>
          </div>
        </section>
      )}

      {/* ===== CORPO ===== */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-8">

        {/* barra de progresso da jornada */}
        <section className="space-y-2">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-[10px] tracking-[0.25em] uppercase font-bold"
               style={{ color: AC.primary, fontFamily: AC_FONT_DISPLAY }}>
              Sua jornada
            </p>
            <p className="text-[11px] text-right" style={{ color: AC.textMute }}>
              {nxt
                ? `Faltam ${nxt.min - passedCount} prova${nxt.min - passedCount !== 1 ? "s" : ""} para ${nxt.name}`
                : "Nível máximo alcançado"}
            </p>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ background: AC.surface2 }}>
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{ width: `${pct}%`, background: AC.primary }}
            />
          </div>
        </section>

        {/* catálogo em fileiras */}
        <section id="academy-catalog" className="space-y-4">
          <div>
            <p className="text-[10px] font-bold tracking-[0.3em] uppercase"
               style={{ color: AC.primary, fontFamily: AC_FONT_DISPLAY }}>
              Catálogo
            </p>
            <h2 className="text-lg sm:text-xl font-bold mt-0.5"
                style={{ color: AC.text, fontFamily: AC_FONT_DISPLAY }}>
              Todas as trilhas
            </h2>
          </div>
          <AcademyCatalog
            flatList={flatList}
            getLessonProg={getLessonProg}
            getExam={getExam}
            onOpenLesson={openPlayer}
            onOpenQuiz={setQuizKey}
          />
        </section>

        <footer className="text-center pt-4 pb-2 border-t" style={{ borderColor: AC.border }}>
          <p className="text-[10px] tracking-[0.25em] uppercase" style={{ color: AC.textMute, fontFamily: AC_FONT_DISPLAY }}>
            iGreen Academy
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
