// flowExits — unifica TODAS as "saídas" de um passo num único conceito.
//
// Hoje "para onde o passo vai" está espalhado em três lugares do dado:
//   • `captures._buttons`  — os botões interativos do passo;
//   • `transitions`        — regras (botão casado por frase, palavra-chave,
//                            e a transição `default`);
//   • `fallback`           — o que fazer quando nada casa.
//
// Para o Consultor montar/entender o fluxo, isso precisa aparecer junto em
// cada passo: "o que o lead faz → para onde vai". Este helper resolve essa
// fragmentação produzindo uma lista plana de `StepExit`, na mesma ordem de
// prioridade que o runtime usa (`_shared/flow-router.ts::matchTransition`):
//   1) Botões            → casados por `trigger_phrases`/`goto_special`;
//   2) Palavras-chave    → transitions não-`default` que não pertencem a botão;
//   3) Padrão            → transição `default` + `fallback` (mesma lógica do
//      "Próximo passo (padrão)" do `StepInspector`).
//
// O destino é resolvido para um rótulo humano + (quando aplicável) o `Step`
// alvo, sinalizando problemas (`missing`) para destinos sem alvo, removidos
// ou inativos.

import { Step, getButtons } from "./flowTypes";

/** Origem da saída — o que o lead faz para disparar este caminho. */
export type ExitKind = "button" | "keyword" | "default";

/** Natureza do destino resolvido. */
export type ExitDestKind =
  | "step" // vai para outro passo ativo
  | "inactive" // vai para um passo inativo (alerta)
  | "missing" // aponta para passo removido (erro)
  | "none" // sem destino configurado (erro)
  | "order" // segue a ordem da lista (próximo passo ativo)
  | "end" // segue a ordem, mas não há próximo — fim do fluxo
  | "humano" // handoff humano
  | "cadastro" // pula para o cadastro
  | "repeat" // repete o passo atual
  | "ai"; // responde com IA

export type StepExit = {
  /** Chave estável para uso como `key` no React. */
  id: string;
  kind: ExitKind;
  /** O gatilho legível: título do botão, frases da regra, ou "padrão". */
  label: string;
  destKind: ExitDestKind;
  /** Passo de destino resolvido (quando `destKind` é `step`/`inactive`/`order`). */
  destStep?: Step;
  /** Rótulo humano do destino (ex.: "#4 Pedir conta", "👤 Falar com humano"). */
  destLabel: string;
  /** `true` quando o destino tem problema (sem destino, removido ou inativo). */
  missing: boolean;
};

type ResolvedDest = Pick<StepExit, "destKind" | "destStep" | "destLabel" | "missing">;

/** Resolve um par (goto_step_id, goto_special) para um destino legível. */
function resolveDest(
  steps: Step[],
  opts: { goto_step_id?: string | null; goto_special?: string | null },
): ResolvedDest {
  const sp = (opts.goto_special ?? "").toLowerCase().trim();
  if (sp === "humano") return { destKind: "humano", destLabel: "👤 Falar com humano", missing: false };
  if (sp === "cadastro") return { destKind: "cadastro", destLabel: "📝 Pular para cadastro", missing: false };
  if (sp === "repeat") return { destKind: "repeat", destLabel: "🔁 Repetir este passo", missing: false };
  if (sp === "ai") return { destKind: "ai", destLabel: "🤖 Responder com IA", missing: false };

  if (opts.goto_step_id) {
    const dest = steps.find((s) => s.id === opts.goto_step_id);
    if (!dest) return { destKind: "missing", destLabel: "⚠ Passo removido", missing: true };
    return {
      destKind: dest.is_active ? "step" : "inactive",
      destStep: dest,
      destLabel: `#${dest.position} ${dest.title}${dest.is_active ? "" : " (inativo)"}`,
      missing: !dest.is_active,
    };
  }

  return { destKind: "none", destLabel: "⚠ Sem destino", missing: true };
}

/** Próximo passo ativo por posição (caminho "seguir a ordem da lista"). */
function resolveOrderDest(step: Step, steps: Step[]): ResolvedDest {
  const next = [...steps]
    .sort((a, b) => a.position - b.position)
    .find((s) => s.position > step.position && s.is_active);
  if (next) {
    return {
      destKind: "order",
      destStep: next,
      destLabel: `#${next.position} ${next.title}`,
      missing: false,
    };
  }
  return { destKind: "end", destLabel: "🏁 Fim do fluxo", missing: false };
}

/** Conjunto de chaves que identificam transitions pertencentes a um botão. */
function buttonKeySet(buttons: { id: string; title: string }[]): Set<string> {
  return new Set(
    buttons.flatMap((b) => [b.id, b.title, b.title.replace(/^\S+\s/, "").trim()]),
  );
}

/** Encontra a transition que materializa o destino de um botão. */
function findButtonTransition(step: Step, b: { id: string; title: string }) {
  const titleNoEmoji = b.title.replace(/^\S+\s/, "").trim();
  return step.transitions.find(
    (t) =>
      t.trigger_intent === b.id ||
      t.trigger_phrases.includes(b.id) ||
      t.trigger_phrases.includes(b.title) ||
      t.trigger_phrases.includes(titleNoEmoji),
  );
}

/**
 * Resolve o caminho "padrão" do passo — para onde o bot vai quando nenhum
 * botão nem palavra-chave casa.
 *
 * A ordem espelha EXATAMENTE o seletor "Próximo passo (padrão)" do
 * `StepInspector` (a superfície que o Consultor usa para editar este
 * destino), garantindo que Lista e Inspetor sempre mostrem o mesmo destino:
 *   1) `default` → humano / cadastro;
 *   2) `fallback.mode === "goto"` (é o que o Inspetor grava e lê primeiro);
 *   3) `default.goto_step_id`;
 *   4) `default` → repeat;
 *   5) `fallback` IA;
 *   6) caso contrário, segue a ordem da lista.
 *
 * Nota: o runtime tem comportamento dependente do caminho (o caminho de
 * cascade prioriza `default` sobre `fallback`), mas o Inspetor mantém os
 * dois campos sincronizados, então na prática apontam para o mesmo destino.
 */
function resolveDefaultExit(step: Step, steps: Step[]): StepExit {
  const defaultT = step.transitions.find((t) => t.trigger_intent === "default");
  const fb = step.fallback ?? { mode: "repeat" };

  let d: ResolvedDest;
  if (defaultT?.goto_special === "humano") {
    d = resolveDest(steps, { goto_special: "humano" });
  } else if (defaultT?.goto_special === "cadastro") {
    d = resolveDest(steps, { goto_special: "cadastro" });
  } else if (fb.mode === "goto" && fb.goto_step_id) {
    d = resolveDest(steps, { goto_step_id: fb.goto_step_id });
  } else if (defaultT?.goto_step_id) {
    d = resolveDest(steps, { goto_step_id: defaultT.goto_step_id });
  } else if (defaultT?.goto_special === "repeat") {
    d = resolveDest(steps, { goto_special: "repeat" });
  } else if (fb.mode === "ai" || fb.mode === "ai_limit") {
    d = { destKind: "ai", destLabel: "🤖 Responder com IA", missing: false };
  } else {
    d = resolveOrderDest(step, steps);
  }

  return { id: "default", kind: "default", label: "padrão", ...d };
}

/**
 * Retorna TODAS as saídas de um passo, na ordem em que o runtime as avalia:
 * botões → palavras-chave → padrão. A saída "padrão" está sempre presente
 * (todo passo tem um destino quando nada casa).
 */
export function getStepExits(step: Step, steps: Step[]): StepExit[] {
  const exits: StepExit[] = [];
  const buttons = getButtons(step);
  const keys = buttonKeySet(buttons);

  // (1) Botões — cada botão é uma saída explícita.
  for (const b of buttons) {
    const t = findButtonTransition(step, b);
    const d: ResolvedDest = t
      ? resolveDest(steps, t)
      : { destKind: "none", destLabel: "⚠ Sem destino", missing: true };
    exits.push({ id: `button:${b.id}`, kind: "button", label: b.title, ...d });
  }

  // (2) Palavras-chave — transitions não-`default` que não pertencem a botão.
  step.transitions.forEach((t, idx) => {
    if (t.trigger_intent === "default") return;
    if (t.trigger_phrases.some((p) => keys.has(p))) return;
    if (keys.has(t.trigger_intent)) return;
    const label = t.trigger_phrases.filter(Boolean).join(", ") || t.trigger_intent || "palavra-chave";
    exits.push({ id: `rule:${idx}`, kind: "keyword", label, ...resolveDest(steps, t) });
  });

  // (3) Padrão — sempre presente.
  exits.push(resolveDefaultExit(step, steps));

  return exits;
}
