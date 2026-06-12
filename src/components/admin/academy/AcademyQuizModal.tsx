/**
 * Modal de prova da Academy.
 * Embaralha questões e alternativas a cada tentativa (Fisher-Yates).
 */
import { useCallback, useEffect, useState } from "react";
import { X, Trophy, RefreshCw, CheckCircle } from "lucide-react";
import { CATALOG, QUIZZES, PASS_SCORE, type QuizQuestion } from "@/data/academyCatalog";
import type { ExamResult } from "@/hooks/useAcademyProgress";

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
        // calcular resultado
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
    /* backdrop */
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      <div
        role="dialog"
        aria-modal="true"
        className="relative z-10 w-full max-w-[540px] max-h-[90vh] overflow-y-auto
                   rounded-2xl border border-white/10 shadow-2xl
                   bg-[#111118] animate-in fade-in zoom-in-95 duration-200"
        style={{ background: "linear-gradient(135deg, #0e1a14 0%, #111118 60%)" }}
      >
        {/* fechar */}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 w-8 h-8 rounded-full bg-white/10
                     hover:bg-white/20 flex items-center justify-center text-white/70
                     hover:text-white transition-colors"
          aria-label="Fechar"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="p-6 sm:p-8">

          {/* ===== INTRO ===== */}
          {screen === "intro" && (
            <div className="text-center space-y-5">
              <div className="inline-block text-xs font-black tracking-widest uppercase
                              text-[#00A859] mb-1">
                📝 PROVA DO MÓDULO
              </div>
              <h2 className="text-xl sm:text-2xl font-black text-white">{mod}</h2>
              <p className="text-sm text-white/60">{cat} · {questions.length} questões</p>

              <ul className="text-left bg-white/5 border border-white/10 rounded-xl
                             p-4 space-y-2 text-sm text-white/80">
                <li>✅ Aprovação: <strong className="text-white">{PASS_SCORE}%</strong> de acerto</li>
                <li>🔁 Pode refazer quantas vezes quiser</li>
                <li>🏆 Aprovar libera selo de conhecimento</li>
              </ul>

              {lastResult && (
                <p className="text-xs text-white/50">
                  Último resultado: <span className={lastResult.passed ? "text-[#00A859]" : "text-red-400"}>
                    {lastResult.score}% — {lastResult.passed ? "Aprovado" : "Reprovado"}
                  </span>
                </p>
              )}

              <button
                onClick={startQuiz}
                className="w-full py-4 rounded-xl font-black text-base bg-[#00A859]
                           hover:bg-[#007A3D] text-white transition-colors"
              >
                Começar prova
              </button>
            </div>
          )}

          {/* ===== QUESTÕES ===== */}
          {screen === "questions" && (
            <div className="space-y-5">
              {/* barra de progresso */}
              <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                <div
                  className="h-full bg-[#00A859] transition-all duration-300"
                  style={{ width: `${pct}%` }}
                />
              </div>

              <p className="text-xs font-bold text-white/40 uppercase tracking-widest">
                Questão {current + 1} de {questions.length}
              </p>

              <h3 className="text-base sm:text-lg font-bold text-white leading-snug">
                {q.q}
              </h3>

              <div className="space-y-2">
                {q.options.map((opt, i) => {
                  const chosen  = answers[current];
                  const correct = locked && i === q.answer;
                  const wrong   = locked && i === chosen && chosen !== q.answer;
                  return (
                    <button
                      key={i}
                      onClick={() => answerQuestion(i)}
                      disabled={locked}
                      className={`w-full text-left px-4 py-3 rounded-xl text-sm font-medium
                                  border transition-all duration-150
                                  ${correct ? "border-[#00A859] bg-[#00A859]/20 text-white" :
                                    wrong   ? "border-red-500 bg-red-500/15 text-white" :
                                    locked  ? "border-white/10 bg-white/5 text-white/50 cursor-default" :
                                    "border-white/10 bg-white/5 text-white hover:border-[#00A859]/60 hover:bg-[#00A859]/5"}`}
                    >
                      {opt}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* ===== RESULTADO ===== */}
          {screen === "result" && result && (
            <div className="text-center space-y-4">
              <div className="text-5xl">{result.passed ? "🎉" : "💪"}</div>
              <h2 className="text-2xl font-black text-white">
                {result.passed ? "Aprovado!" : "Quase lá!"}
              </h2>

              <p
                className={`text-5xl font-black ${result.passed ? "text-[#00A859]" : "text-red-400"}`}
              >
                {result.score}%
              </p>

              <p className="text-sm text-white/60">
                {result.passed
                  ? `Você acertou ${result.acertos} de ${questions.length}. Parabéns!`
                  : `Você acertou ${result.acertos} de ${questions.length}. Precisa de ${PASS_SCORE}% — revise o módulo e tente de novo!`}
              </p>

              <div className="flex gap-3 pt-2">
                <button
                  onClick={startQuiz}
                  className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl
                             border border-white/20 bg-white/5 hover:bg-white/10
                             text-white text-sm font-bold transition-colors"
                >
                  <RefreshCw className="w-4 h-4" /> Refazer
                </button>
                <button
                  onClick={onClose}
                  className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl
                             bg-[#00A859] hover:bg-[#007A3D] text-white text-sm font-bold
                             transition-colors"
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
