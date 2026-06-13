/**
 * Modal de prova da Academy.
 * Embaralha questões e alternativas a cada tentativa (Fisher-Yates).
 * Tema: Esmeralda Premium (deep emerald + gold + cream).
 */
import { useCallback, useEffect, useState } from "react";
import { X, RefreshCw, CheckCircle } from "lucide-react";
import { CATALOG, QUIZZES, PASS_SCORE, type QuizQuestion } from "@/data/academyCatalog";
import type { ExamResult } from "@/hooks/useAcademyProgress";

/* ---------- paleta Esmeralda Premium ---------- */
const C = {
  bg:        "#08120e",
  surface:   "#0d1a14",
  border:    "rgba(201,168,76,0.18)",
  borderHi:  "rgba(201,168,76,0.50)",
  gold:      "#c9a84c",
  goldSoft:  "rgba(201,168,76,0.12)",
  cream:     "#f5f0e0",
  creamDim:  "rgba(245,240,224,0.65)",
  creamMute: "rgba(245,240,224,0.42)",
  emerald:   "#0d7a5f",
  danger:    "#e07a6b",
  dangerBg:  "rgba(224,122,107,0.14)",
};
const FONT_DISPLAY = "'Space Grotesk', system-ui, sans-serif";
const FONT_BODY    = "'DM Sans', system-ui, sans-serif";

/* ---------- helpers ---------- */
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function shuffleQuiz(qs: QuizQuestion[]): QuizQuestion[] {
  return shuffle(qs).map(q => {
    const correct = q.options[q.answer];
    const opts    = shuffle(q.options);
    return { q: q.q, options: opts, answer: opts.indexOf(correct) };
  });
}

function moduleTitleByKey(key: string): { cat: string; mod: string } {
  const i    = key.lastIndexOf("-");
  const catId = key.slice(0, i);
  const mi    = Number(key.slice(i + 1));
  const cat   = CATALOG.find(c => c.id === catId);
  if (!cat) return { cat: "", mod: "Módulo" };
  return { cat: cat.title, mod: cat.modules[mi]?.title ?? "Módulo" };
}

/* ---------- tipos ---------- */
interface Props {
  quizKey:   string;
  onClose:   () => void;
  onPass:    (key: string, result: ExamResult) => void;
  lastResult: ExamResult | null;
}

type Screen = "intro" | "questions" | "result";

/* ---------- componente ---------- */
export function AcademyQuizModal({ quizKey, onClose, onPass, lastResult }: Props) {
  const quiz = QUIZZES[quizKey];
  if (!quiz) return null;

  const { cat, mod } = moduleTitleByKey(quizKey);
  const [screen,    setScreen   ] = useState<Screen>("intro");
  const [questions, setQuestions] = useState<QuizQuestion[]>(() => shuffleQuiz(quiz.questions));
  const [current,   setCurrent  ] = useState(0);
  const [answers,   setAnswers  ] = useState<(number | null)[]>(() => Array(quiz.questions.length).fill(null));
  const [locked,    setLocked   ] = useState(false);
  const [result,    setResult   ] = useState<{ score: number; passed: boolean; acertos: number } | null>(null);

  // fecha com ESC
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const startQuiz = () => {
    setQuestions(shuffleQuiz(quiz.questions));
    setAnswers(Array(quiz.questions.length).fill(null));
    setCurrent(0);
    setLocked(false);
    setResult(null);
    setScreen("questions");
  };

  const answerQuestion = useCallback((choice: number) => {
    if (locked) return;
    setLocked(true);
    setAnswers(prev => { const a = [...prev]; a[current] = choice; return a; });
    setTimeout(() => {
      if (current + 1 < questions.length) {
        setCurrent(c => c + 1);
        setLocked(false);
      } else {
        const ans  = [...answers];
        ans[current] = choice;
        let acc = 0;
        questions.forEach((q, i) => { if (ans[i] === q.answer) acc++; });
        const score  = Math.round(acc / questions.length * 100);
        const passed = score >= PASS_SCORE;
        setResult({ score, passed, acertos: acc });
        onPass(quizKey, { score, passed });
        setScreen("result");
      }
    }, 850);
  }, [locked, current, questions, answers, quizKey, onPass]);

  const q    = questions[current];
  const pct  = Math.round(current / questions.length * 100);

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4"
      style={{ fontFamily: FONT_BODY, color: C.cream }}
    >
      <div
        className="absolute inset-0 backdrop-blur-md"
        style={{ background: "rgba(8,18,14,0.78)" }}
        onClick={onClose}
        aria-hidden="true"
      />

      <div
        role="dialog"
        aria-modal="true"
        className="relative z-10 w-full max-w-[560px] max-h-[92vh] overflow-y-auto rounded-2xl shadow-2xl animate-in fade-in zoom-in-95 duration-200"
        style={{
          background: `linear-gradient(160deg, #0f2018 0%, ${C.surface} 55%, ${C.bg} 100%)`,
          border: `1px solid ${C.border}`,
          boxShadow: "0 30px 80px -20px rgba(0,0,0,0.6), 0 0 0 1px rgba(201,168,76,0.08)",
        }}
      >
        {/* fechar */}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 w-9 h-9 rounded-full flex items-center justify-center transition-colors"
          style={{ background: "rgba(245,240,224,0.06)", color: C.creamDim }}
          onMouseEnter={e => { e.currentTarget.style.background = C.goldSoft; e.currentTarget.style.color = C.gold; }}
          onMouseLeave={e => { e.currentTarget.style.background = "rgba(245,240,224,0.06)"; e.currentTarget.style.color = C.creamDim; }}
          aria-label="Fechar"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="p-7 sm:p-9">

          {/* ===== INTRO ===== */}
          {screen === "intro" && (
            <div className="text-center space-y-5">
              <div className="flex items-center justify-center gap-3">
                <span className="h-px w-8" style={{ background: C.gold }} />
                <span className="text-[10px] font-semibold uppercase" style={{ color: C.gold, letterSpacing: "0.32em" }}>
                  Prova do módulo
                </span>
                <span className="h-px w-8" style={{ background: C.gold }} />
              </div>

              <h2
                className="text-2xl sm:text-3xl leading-tight tracking-tight"
                style={{ fontFamily: FONT_DISPLAY, fontWeight: 600, color: C.cream }}
              >
                {mod}
              </h2>
              <p className="text-sm" style={{ color: C.creamDim }}>{cat} · {questions.length} questões</p>

              <ul
                className="text-left rounded-xl p-5 space-y-3 text-sm"
                style={{ background: "rgba(245,240,224,0.03)", border: `1px solid ${C.border}`, color: C.creamDim }}
              >
                <li className="flex items-start gap-2">
                  <span style={{ color: C.gold }}>•</span>
                  <span>Aprovação: <strong style={{ color: C.cream }}>{PASS_SCORE}%</strong> de acerto</span>
                </li>
                <li className="flex items-start gap-2">
                  <span style={{ color: C.gold }}>•</span>
                  <span>Pode refazer quantas vezes quiser</span>
                </li>
                <li className="flex items-start gap-2">
                  <span style={{ color: C.gold }}>•</span>
                  <span>Aprovar libera o selo de conhecimento</span>
                </li>
              </ul>

              {lastResult && (
                <p className="text-xs" style={{ color: C.creamMute }}>
                  Último resultado:{" "}
                  <span style={{ color: lastResult.passed ? C.gold : C.danger, fontWeight: 600 }}>
                    {lastResult.score}% — {lastResult.passed ? "Aprovado" : "Reprovado"}
                  </span>
                </p>
              )}

              <button
                onClick={startQuiz}
                className="w-full py-4 rounded-xl text-sm uppercase transition-all"
                style={{
                  fontFamily: FONT_DISPLAY,
                  fontWeight: 600,
                  letterSpacing: "0.18em",
                  color: C.bg,
                  background: `linear-gradient(135deg, ${C.gold}, #b8943f)`,
                  boxShadow: "0 10px 28px -10px rgba(201,168,76,0.55)",
                }}
              >
                Começar prova
              </button>
            </div>
          )}

          {/* ===== QUESTÕES ===== */}
          {screen === "questions" && (
            <div className="space-y-6">
              <div>
                <div className="flex justify-between text-[10px] uppercase mb-2" style={{ color: C.creamMute, letterSpacing: "0.24em" }}>
                  <span>Questão {String(current + 1).padStart(2, "0")} / {String(questions.length).padStart(2, "0")}</span>
                  <span style={{ color: C.gold }}>{pct}%</span>
                </div>
                <div className="h-[3px] rounded-full overflow-hidden" style={{ background: "rgba(245,240,224,0.08)" }}>
                  <div
                    className="h-full transition-all duration-300"
                    style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${C.emerald}, ${C.gold})` }}
                  />
                </div>
              </div>

              <h3
                className="text-lg sm:text-xl leading-snug"
                style={{ fontFamily: FONT_DISPLAY, fontWeight: 500, color: C.cream }}
              >
                {q.q}
              </h3>

              <div className="space-y-2.5">
                {q.options.map((opt, i) => {
                  const chosen  = answers[current];
                  const correct = locked && i === q.answer;
                  const wrong   = locked && i === chosen && chosen !== q.answer;
                  const baseStyle: React.CSSProperties = correct
                    ? { borderColor: C.gold, background: C.goldSoft, color: C.cream }
                    : wrong
                    ? { borderColor: C.danger, background: C.dangerBg, color: C.cream }
                    : locked
                    ? { borderColor: C.border, background: "rgba(245,240,224,0.03)", color: C.creamMute, cursor: "default" }
                    : { borderColor: C.border, background: "rgba(245,240,224,0.04)", color: C.cream };
                  return (
                    <button
                      key={i}
                      onClick={() => answerQuestion(i)}
                      disabled={locked}
                      className="w-full text-left px-4 py-3.5 rounded-xl text-sm transition-all duration-150 flex items-center gap-3"
                      style={{ border: "1px solid transparent", ...baseStyle }}
                      onMouseEnter={e => {
                        if (locked) return;
                        e.currentTarget.style.borderColor = C.borderHi;
                        e.currentTarget.style.background = C.goldSoft;
                      }}
                      onMouseLeave={e => {
                        if (locked) return;
                        e.currentTarget.style.borderColor = C.border;
                        e.currentTarget.style.background = "rgba(245,240,224,0.04)";
                      }}
                    >
                      <span
                        className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-semibold"
                        style={{
                          fontFamily: FONT_DISPLAY,
                          border: `1px solid ${correct || wrong ? "currentColor" : C.border}`,
                          color: correct ? C.gold : wrong ? C.danger : C.creamDim,
                        }}
                      >
                        {String.fromCharCode(65 + i)}
                      </span>
                      <span className="flex-1">{opt}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* ===== RESULTADO ===== */}
          {screen === "result" && result && (
            <div className="text-center space-y-5">
              <div className="text-5xl">{result.passed ? "🏆" : "↻"}</div>
              <div className="flex items-center justify-center gap-3">
                <span className="h-px w-8" style={{ background: result.passed ? C.gold : C.danger }} />
                <span
                  className="text-[10px] font-semibold uppercase"
                  style={{ color: result.passed ? C.gold : C.danger, letterSpacing: "0.32em" }}
                >
                  {result.passed ? "Aprovado" : "Quase lá"}
                </span>
                <span className="h-px w-8" style={{ background: result.passed ? C.gold : C.danger }} />
              </div>

              <p
                className="text-6xl tracking-tight"
                style={{
                  fontFamily: FONT_DISPLAY,
                  fontWeight: 600,
                  color: result.passed ? C.gold : C.danger,
                }}
              >
                {result.score}%
              </p>

              <p className="text-sm" style={{ color: C.creamDim }}>
                {result.passed
                  ? `Você acertou ${result.acertos} de ${questions.length}. Parabéns!`
                  : `Você acertou ${result.acertos} de ${questions.length}. Precisa de ${PASS_SCORE}% — revise o módulo e tente de novo.`}
              </p>

              <div className="flex gap-3 pt-2">
                <button
                  onClick={startQuiz}
                  className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-medium transition-colors"
                  style={{
                    color: C.cream,
                    background: "rgba(245,240,224,0.04)",
                    border: `1px solid ${C.border}`,
                  }}
                >
                  <RefreshCw className="w-4 h-4" /> Refazer
                </button>
                <button
                  onClick={onClose}
                  className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-sm uppercase transition-all"
                  style={{
                    fontFamily: FONT_DISPLAY,
                    fontWeight: 600,
                    letterSpacing: "0.16em",
                    color: C.bg,
                    background: `linear-gradient(135deg, ${C.gold}, #b8943f)`,
                    boxShadow: "0 10px 28px -10px rgba(201,168,76,0.5)",
                  }}
                >
                  <CheckCircle className="w-4 h-4" /> Concluir
                </button>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
