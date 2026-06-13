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

const FONT_FAMILY_BODY = "'Fira Sans', system-ui, sans-serif";
const FONT_FAMILY_DISPLAY = "'DM Serif Display', 'Fira Sans', Georgia, serif";

/* injeta Google Fonts uma vez */
function useAcademyFonts() {
  useEffect(() => {
    const id = "academy-fonts-link";
    if (document.getElementById(id)) return;
    const l = document.createElement("link");
    l.id = id;
    l.rel = "stylesheet";
    l.href = "https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=Fira+Sans:wght@400;500;600;700&display=swap";
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
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-10">

        {/* ===== EDITORIAL MASTHEAD ===== */}
        <header className="flex items-end justify-between border-b pb-3"
                style={{ borderColor: C.cream20 }}>
          <div>
            <p className="text-[10px] font-bold tracking-[0.32em] uppercase"
               style={{ color: C.gold, fontFamily: FONT_FAMILY_BODY }}>
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
            <p className="text-base" style={{ color: C.cream, fontFamily: FONT_FAMILY_DISPLAY }}>
              {lvl.icon} {lvl.name}
            </p>
          </div>
        </header>

        {/* ===== HERO CINEMASCOPE (split-screen) ===== */}
        {resumeLesson && (
          <section className="grid grid-cols-1 lg:grid-cols-[1.15fr_1fr] gap-6 lg:gap-8 items-stretch">

            {/* COVER lateral — proporção controlada, nunca domina */}
            <button
              onClick={() => openPlayer(resumeIdx)}
              className="group relative block w-full overflow-hidden text-left aspect-[16/10] lg:aspect-auto lg:min-h-[380px] lg:max-h-[460px]"
              style={{
                borderRadius: 4,
                background: C.surface,
              }}
            >
              <img
                src={thumbHi(resumeLesson.yt)}
                onError={(e) => { (e.currentTarget as HTMLImageElement).src = thumbLo(resumeLesson.yt); }}
                alt={resumeLesson.title}
                className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-[1.04]"
              />
              {/* gradiente sutil só para legibilidade do play */}
              <div
                className="absolute inset-0"
                style={{
                  background: `linear-gradient(180deg, ${C.emeraldDp}22 0%, transparent 40%, ${C.bg}66 100%)`,
                }}
              />
              {/* moldura dourada fininha */}
              <div className="absolute inset-2 border pointer-events-none"
                   style={{ borderColor: `${C.gold}44`, borderRadius: 2 }} />

              {/* play centralizado */}
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2
                              w-16 h-16 rounded-full flex items-center justify-center
                              transition-transform duration-300 group-hover:scale-110"
                   style={{
                     background: C.cream,
                     boxShadow: `0 0 0 1px ${C.gold}, 0 20px 60px -10px ${C.emeraldDp}`,
                   }}>
                <Play className="w-6 h-6 ml-0.5" style={{ fill: C.emeraldDp, color: C.emeraldDp }} />
              </div>

              {/* legenda foto */}
              <div className="absolute left-0 right-0 bottom-0 px-4 py-3 flex items-center gap-2"
                   style={{ background: `linear-gradient(180deg, transparent, ${C.bg}cc)` }}>
                <span className="h-px w-6" style={{ background: C.gold }} />
                <p className="text-[10px] tracking-[0.25em] uppercase font-semibold"
                   style={{ color: C.goldSoft, fontFamily: FONT_FAMILY_BODY }}>
                  {resumeLesson.catTitle}
                </p>
              </div>
            </button>

            {/* CONTEÚDO lateral — manchete + meta + CTA */}
            <div className="flex flex-col justify-between gap-6 py-2">
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <span className="h-px w-8" style={{ background: C.gold }} />
                  <p className="text-[10px] font-bold tracking-[0.3em] uppercase"
                     style={{ color: C.gold, fontFamily: FONT_FAMILY_BODY }}>
                    {anyProgress ? "Continue assistindo" : "Comece por aqui"}
                  </p>
                </div>

                <h1 className="leading-[1.05] tracking-tight"
                    style={{
                      fontFamily: FONT_FAMILY_DISPLAY,
                      color: C.cream,
                      fontSize: "clamp(1.8rem, 4.2vw, 3rem)",
                    }}>
                  {resumeLesson.title}
                </h1>

                <p className="text-sm" style={{ color: C.cream60, fontFamily: FONT_FAMILY_BODY }}>
                  {resumeLesson.moduleTitle}
                </p>

                {/* mini-stats inline */}
                <dl className="grid grid-cols-3 gap-4 pt-4 border-t" style={{ borderColor: C.cream20 }}>
                  <MiniStat label="Aulas"     value={`${doneAulas}/${totalAulas}`} accent={C.gold} />
                  <MiniStat label="Progresso" value={`${pct}%`}                    accent={C.emerald} />
                  <MiniStat label="Provas"    value={`${passedCount}/${totalQuizzes}`} accent={C.gold} />
                </dl>
              </div>

              {/* CTA */}
              <button
                onClick={() => openPlayer(resumeIdx)}
                className="w-full flex items-center justify-between px-5 py-4 transition-all hover:translate-x-1"
                style={{
                  background: C.cream,
                  color: C.emeraldDp,
                  borderRadius: 2,
                  fontFamily: FONT_FAMILY_BODY,
                }}
              >
                <span className="text-sm font-bold tracking-wide uppercase">
                  {anyProgress ? "Retomar leitura" : "Assistir agora"}
                </span>
                <ArrowRight className="w-5 h-5" />
              </button>
            </div>
          </section>
        )}



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
