/**
 * Modal de prova da Academy.
 * Embaralha questões e alternativas a cada tentativa (Fisher-Yates).
 * Tema: iGreen oficial (modo escuro) — ver ./theme.ts
 */
import { useCallback, useEffect, useState } from "react";
import { X, RefreshCw, CheckCircle } from "lucide-react";
import { CATALOG, QUIZZES, PASS_SCORE, type QuizQuestion } from "@/data/academyCatalog";
import type { ExamResult } from "@/hooks/useAcademyProgress";
import { AC, AC_FONT_DISPLAY, AC_FONT_BODY } from "./theme";

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
      style={{ fontFamily: AC_FONT_BODY, color: AC.text }}
    >
      <div
        className="absolute inset-0 backdrop-blur-md"
        style={{ background: "rgba(17,17,17,0.78)" }}
        onClick={onClose}
        aria-hidden="true"
      />

      <div
        role="dialog"
        aria-modal="true"
        className="relative z-10 w-full max-w-[560px] max-h-[92vh] overflow-y-auto rounded-2xl shadow-2xl animate-in fade-in zoom-in-95 duration-200"
        style={{
          background: `linear-gradient(160deg, ${AC.surface2} 0%, ${AC.surface} 55%, ${AC.bg} 100%)`,
          border: `1px solid ${AC.border}`,
          boxShadow: "0 30px 80px -20px rgba(0,0,0,0.6), 0 0 0 1px rgba(0,168,89,0.08)",
        }}
      >
        {/* fechar */}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 w-9 h-9 rounded-full flex items-center justify-center transition-colors"
          style={{ background: "rgba(255,255,255,0.06)", color: AC.textDim }}
          onMouseEnter={e => { e.currentTarget.style.background = AC.primarySoft; e.currentTarget.style.color = AC.primary; }}
          onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.06)"; e.currentTarget.style.color = AC.textDim; }}
          aria-label="Fechar"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="p-7 sm:p-9">

          {/* ===== INTRO ===== */}
          {screen === "intro" && (
            <div className="text-center space-y-5">
              <div className="flex items-center justify-center gap-3">
                <span className="h-px w-8" style={{ background: AC.primary }} />
                <span className="text-[10px] font-semibold uppercase" style={{ color: AC.primary, letterSpacing: "0.32em" }}>
                  Prova do módulo
                </span>
                <span className="h-px w-8" style={{ background: AC.primary }} />
              </div>

              <h2
                className="text-2xl sm:text-3xl leading-tight tracking-tight"
                style={{ fontFamily: AC_FONT_DISPLAY, fontWeight: 700, color: AC.text }}
              >
                {mod}
              </h2>
              <p className="text-sm" style={{ color: AC.textDim }}>{cat} · {questions.length} questões</p>

              <ul
                className="text-left rounded-xl p-5 space-y-3 text-sm"
                style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${AC.border}`, color: AC.textDim }}
              >
                <li className="flex items-start gap-2">
                  <span style={{ color: AC.primary }}>•</span>
                  <span>Aprovação: <strong style={{ color: AC.text }}>{PASS_SCORE}%</strong> de acerto</span>
                </li>
                <li className="flex items-start gap-2">
                  <span style={{ color: AC.primary }}>•</span>
                  <span>Pode refazer quantas vezes quiser</span>
                </li>
                <li className="flex items-start gap-2">
                  <span style={{ color: AC.primary }}>•</span>
                  <span>Aprovar libera o selo de conhecimento</span>
                </li>
              </ul>

              {lastResult && (
                <p className="text-xs" style={{ color: AC.textMute }}>
                  Último resultado:{" "}
                  <span style={{ color: lastResult.passed ? AC.primary : AC.danger, fontWeight: 600 }}>
                    {lastResult.score}% — {lastResult.passed ? "Aprovado" : "Reprovado"}
                  </span>
                </p>
              )}

              <button
                onClick={startQuiz}
                className="w-full py-4 rounded-xl text-sm uppercase transition-all"
                style={{
                  fontFamily: AC_FONT_DISPLAY,
                  fontWeight: 700,
                  letterSpacing: "0.18em",
                  color: "#FFFFFF",
                  background: `linear-gradient(135deg, ${AC.primary}, ${AC.primaryDeep})`,
                  boxShadow: "0 10px 28px -10px rgba(0,168,89,0.55)",
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
                <div className="flex justify-between text-[10px] uppercase mb-2" style={{ color: AC.textMute, letterSpacing: "0.24em" }}>
                  <span>Questão {String(current + 1).padStart(2, "0")} / {String(questions.length).padStart(2, "0")}</span>
                  <span style={{ color: AC.primary }}>{pct}%</span>
                </div>
                <div className="h-[3px] rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.08)" }}>
                  <div
                    className="h-full transition-all duration-300"
                    style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${AC.primaryDeep}, ${AC.primary})` }}
                  />
                </div>
              </div>

              <h3
                className="text-lg sm:text-xl leading-snug"
                style={{ fontFamily: AC_FONT_DISPLAY, fontWeight: 600, color: AC.text }}
              >
                {q.q}
              </h3>

              <div className="space-y-2.5">
                {q.options.map((opt, i) => {
                  const chosen  = answers[current];
                  const correct = locked && i === q.answer;
                  const wrong   = locked && i === chosen && chosen !== q.answer;
                  const baseStyle: React.CSSProperties = correct
                    ? { borderColor: AC.primary, background: AC.primarySoft, color: AC.text }
                    : wrong
                    ? { borderColor: AC.danger, background: AC.dangerBg, color: AC.text }
                    : locked
                    ? { borderColor: AC.border, background: "rgba(255,255,255,0.03)", color: AC.textMute, cursor: "default" }
                    : { borderColor: AC.border, background: "rgba(255,255,255,0.04)", color: AC.text };
                  return (
                    <button
                      key={i}
                      onClick={() => answerQuestion(i)}
                      disabled={locked}
                      className="w-full text-left px-4 py-3.5 rounded-xl text-sm transition-all duration-150 flex items-center gap-3"
                      style={{ border: "1px solid transparent", ...baseStyle }}
                      onMouseEnter={e => {
                        if (locked) return;
                        e.currentTarget.style.borderColor = AC.borderHi;
                        e.currentTarget.style.background = AC.primarySoft;
                      }}
                      onMouseLeave={e => {
                        if (locked) return;
                        e.currentTarget.style.borderColor = AC.border;
                        e.currentTarget.style.background = "rgba(255,255,255,0.04)";
                      }}
                    >
                      <span
                        className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-semibold"
                        style={{
                          fontFamily: AC_FONT_DISPLAY,
                          border: `1px solid ${correct || wrong ? "currentColor" : AC.border}`,
                          color: correct ? AC.primary : wrong ? AC.danger : AC.textDim,
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
                <span className="h-px w-8" style={{ background: result.passed ? AC.primary : AC.danger }} />
                <span
                  className="text-[10px] font-semibold uppercase"
                  style={{ color: result.passed ? AC.primary : AC.danger, letterSpacing: "0.32em" }}
                >
                  {result.passed ? "Aprovado" : "Quase lá"}
                </span>
                <span className="h-px w-8" style={{ background: result.passed ? AC.primary : AC.danger }} />
              </div>

              <p
                className="text-6xl tracking-tight"
                style={{
                  fontFamily: AC_FONT_DISPLAY,
                  fontWeight: 700,
                  color: result.passed ? AC.primary : AC.danger,
                }}
              >
                {result.score}%
              </p>

              <p className="text-sm" style={{ color: AC.textDim }}>
                {result.passed
                  ? `Você acertou ${result.acertos} de ${questions.length}. Parabéns!`
                  : `Você acertou ${result.acertos} de ${questions.length}. Precisa de ${PASS_SCORE}% — revise o módulo e tente de novo.`}
              </p>

              <div className="flex gap-3 pt-2">
                <button
                  onClick={startQuiz}
                  className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-medium transition-colors"
                  style={{
                    color: AC.text,
                    background: "rgba(255,255,255,0.04)",
                    border: `1px solid ${AC.border}`,
                  }}
                >
                  <RefreshCw className="w-4 h-4" /> Refazer
                </button>
                <button
                  onClick={onClose}
                  className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-sm uppercase transition-all"
                  style={{
                    fontFamily: AC_FONT_DISPLAY,
                    fontWeight: 700,
                    letterSpacing: "0.16em",
                    color: "#FFFFFF",
                    background: `linear-gradient(135deg, ${AC.primary}, ${AC.primaryDeep})`,
                    boxShadow: "0 10px 28px -10px rgba(0,168,89,0.5)",
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
