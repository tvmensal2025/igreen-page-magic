/**
 * Aba "Academy" do painel admin.
 * Integra: hero de retomada, nível de conhecimento, progresso,
 *          catálogo, player YouTube e modal de prova.
 */
import { useMemo, useState, useCallback } from "react";
import { GraduationCap, Play, Award, Zap } from "lucide-react";
import { CATALOG, KNOWLEDGE_LEVELS } from "@/data/academyCatalog";
import { useAcademyProgress } from "@/hooks/useAcademyProgress";
import type { ExamResult } from "@/hooks/useAcademyProgress";
import { AcademyCatalog, buildFlatList, type FlatLesson } from "./AcademyCatalog";
import { AcademyPlayer } from "./AcademyPlayer";
import { AcademyQuizModal } from "./AcademyQuizModal";

/* ---- helpers ---- */
function thumbHi(yt: string) { return `https://i.ytimg.com/vi/${yt}/maxresdefault.jpg`; }
function thumbLo(yt: string) { return `https://i.ytimg.com/vi/${yt}/hqdefault.jpg`; }

/* ---- nível atual ---- */
function currentLevel(passed: number) {
  let lvl = KNOWLEDGE_LEVELS[0];
  for (const l of KNOWLEDGE_LEVELS) { if (passed >= l.min) lvl = l; }
  return lvl;
}
function nextLevel(passed: number) {
  return KNOWLEDGE_LEVELS.find(l => l.min > passed) ?? null;
}

/* ========================================== */
export function AcademyTab() {
  const {
    getLessonProg, setLessonProg, markDone,
    getExam, setExamResult,
    lastIdx, saveLastIdx,
    passedCount,
    exams,
  } = useAcademyProgress();

  /* lista linear imutável */
  const flatList = useMemo<FlatLesson[]>(buildFlatList, []);

  /* índice a retomar */
  const resumeIdx = useMemo(() => {
    if (lastIdx !== null && flatList[lastIdx] && !getLessonProg(flatList[lastIdx].yt).done) {
      return lastIdx;
    }
    const i = flatList.findIndex(l => !getLessonProg(l.yt).done);
    return i === -1 ? 0 : i;
  }, [flatList, lastIdx, getLessonProg]);

  /* --- estado do player --- */
  const [playerIdx, setPlayerIdx] = useState<number | null>(null);

  const openPlayer = useCallback((gi: number) => {
    setPlayerIdx(gi);
    saveLastIdx(gi);
  }, [saveLastIdx]);

  const closePlayer = useCallback(() => setPlayerIdx(null), []);

  /* --- estado do quiz --- */
  const [quizKey, setQuizKey] = useState<string | null>(null);

  const handleQuizPass = useCallback((key: string, result: ExamResult) => {
    setExamResult(key, result.score, result.passed);
  }, [setExamResult]);

  /* --- estatísticas --- */
  const totalAulas = flatList.length;
  const doneAulas  = flatList.filter(l => getLessonProg(l.yt).done).length;
  const pct        = totalAulas ? Math.round(doneAulas / totalAulas * 100) : 0;
  const totalQuizzes = Object.keys(CATALOG.reduce((acc, cat) => {
    cat.modules.forEach((_, mi) => { acc[`${cat.id}-${mi}`] = 1; });
    return acc;
  }, {} as Record<string, number>)).length;

  const lvl  = currentLevel(passedCount);
  const nxt  = nextLevel(passedCount);
  const resumeLesson = flatList[resumeIdx];
  const anyProgress  = flatList.some(l => getLessonProg(l.yt).pct > 0);

  /* ---- player aberto? ---- */
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
          onMarkDone={(yt) => { markDone(yt); }}
        />
        {/* quiz modal pode aparecer em cima do player */}
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
    /* fundo escuro da Academy — isolado do tema claro do painel */
    <div
      className="min-h-full w-full"
      style={{ background: "#0a0a0c", color: "#f5f5f7" }}
    >
      <div className="max-w-4xl mx-auto px-4 py-5 space-y-5">

        {/* ---- HERO / CONTINUAR ---- */}
        {resumeLesson && (
          <section
            className="relative overflow-hidden rounded-2xl border border-[#00A859]/25"
            style={{ background: "linear-gradient(135deg, #15351f, #0e2417)" }}
          >
            {/* thumbnail de fundo */}
            <div
              className="absolute inset-0 bg-cover bg-center opacity-40"
              style={{ backgroundImage: `url('${thumbHi(resumeLesson.yt)}'), url('${thumbLo(resumeLesson.yt)}')` }}
            />
            <div
              className="absolute inset-0"
              style={{ background: "linear-gradient(90deg, rgba(8,20,12,.96) 0%, rgba(8,20,12,.7) 45%, rgba(8,20,12,.25) 100%)" }}
            />
            <div className="relative z-10 flex items-center gap-4 p-5">
              <div className="flex-1 min-w-0 space-y-1">
                <p className="text-[10px] font-black tracking-widest uppercase text-[#2ee06a]">
                  {anyProgress ? "Continuar de onde parou" : "Comece por aqui"}
                </p>
                <h2 className="text-base sm:text-xl font-black text-white leading-tight line-clamp-2">
                  {resumeLesson.title}
                </h2>
                <p className="text-xs text-white/50">
                  {resumeLesson.catTitle} · {resumeLesson.moduleTitle}
                </p>
              </div>
              <button
                onClick={() => openPlayer(resumeIdx)}
                className="shrink-0 flex items-center gap-2 px-4 py-3 rounded-xl
                           font-black text-sm text-black bg-[#2ee06a] hover:bg-white
                           transition-colors"
              >
                <Play className="w-4 h-4 fill-current" />
                {anyProgress ? "Continuar" : "Começar"}
              </button>
            </div>
          </section>
        )}

        {/* ---- NÍVEL DE CONHECIMENTO ---- */}
        <section
          className="flex items-center gap-4 rounded-2xl p-4 border"
          style={{ background: "linear-gradient(135deg, #1a1430, #0e1a24)", borderColor: "rgba(120,120,255,.22)" }}
        >
          <div className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl
                          bg-white/5 border border-white/10 shrink-0">
            {lvl.icon}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-widest text-white/40">
              Seu nível de conhecimento
            </p>
            <p className="text-lg font-black text-white">{lvl.name}</p>
            <p className="text-xs text-white/50 truncate">{lvl.desc}</p>
          </div>
          {nxt ? (
            <div className="shrink-0 text-right text-xs text-white/40 max-w-[110px] pl-3
                            border-l border-white/10">
              <span className="text-xl block">{nxt.icon}</span>
              Faltam <strong className="text-white">{nxt.min - passedCount}</strong> prova{nxt.min - passedCount !== 1 ? "s" : ""}{" "}
              para <strong className="text-white text-[11px]">{nxt.name}</strong>
            </div>
          ) : (
            <div className="shrink-0 text-right text-xs text-[#00A859] max-w-[90px] pl-3 border-l border-white/10">
              <span className="text-xl block">👑</span>
              Nível máximo!
            </div>
          )}
        </section>

        {/* ---- PROGRESSO GERAL ---- */}
        <section className="rounded-2xl p-4 border border-white/10 bg-[#16161b] space-y-3">
          <div className="flex justify-between items-baseline">
            <span className="text-xs font-semibold text-white/50">Aulas assistidas</span>
            <span className="text-2xl font-black text-[#2ee06a]">{pct}%</span>
          </div>
          <div className="h-2 rounded-full bg-white/10 overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{
                width: `${pct}%`,
                background: "linear-gradient(90deg, #00A859, #2ee06a)",
              }}
            />
          </div>
          <div className="flex justify-between text-xs text-white/40">
            <span>{doneAulas} de {totalAulas} aulas concluídas</span>
            <span className="text-[#2ee06a] font-bold">
              🏆 {passedCount} de {totalQuizzes} provas aprovadas
            </span>
          </div>
        </section>

        {/* ---- CATÁLOGO ---- */}
        <AcademyCatalog
          flatList={flatList}
          getLessonProg={getLessonProg}
          getExam={getExam}
          onOpenLesson={openPlayer}
          onOpenQuiz={setQuizKey}
        />

        {/* rodapé */}
        <footer className="text-center py-4 text-xs text-white/20 border-t border-white/8">
          iGreen Academy · Conteúdo de treinamento oficial iGreen Energy
        </footer>
      </div>

      {/* quiz modal */}
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
