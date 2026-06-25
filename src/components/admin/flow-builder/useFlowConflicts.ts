// useFlowConflicts — detecta passos do mesmo fluxo com nome/gatilho
// ambíguos, que historicamente confundiam o super admin ("editei o passo X
// mas o bot continuou pegando o Y") e o runtime ("dois passos com a mesma
// trigger_phrase, primeiro que casar ganha").
//
// Tipos de conflito reportados:
//   - duplicateTitle:    dois ou mais passos com o MESMO `title` normalizado
//                        (ignorando "(cópia)" e sufixos numéricos).
//   - duplicateKey:      dois ou mais passos com o mesmo `step_key` após
//                        remover sufixos `_copy_xxx` / `_2`.
//   - triggerOverlap:    dois ou mais passos que compartilham pelo menos
//                        uma `trigger_phrase` em comum.
//
// O hook é puro (não acessa rede) — só refaz o cálculo quando `steps` muda.

import { useMemo } from "react";
import type { Step } from "./flowTypes";

export type ConflictKind = "duplicateTitle" | "duplicateKey" | "triggerOverlap";

export interface StepConflict {
  kind: ConflictKind;
  /** ids dos passos envolvidos (≥ 2). */
  stepIds: string[];
  /** Texto curto que descreve o conflito. */
  label: string;
}

export interface UseFlowConflictsResult {
  /** Todos os conflitos detectados. */
  conflicts: StepConflict[];
  /** Mapa stepId → conflitos em que esse passo aparece. */
  byStep: Map<string, StepConflict[]>;
  /** Total de passos envolvidos em algum conflito. */
  involvedCount: number;
}

const COPY_SUFFIX_TITLE = /\s*\(c[oó]pia(?:\s+\d+)?\)\s*$/i;
const COPY_SUFFIX_KEY = /(?:_copy_[a-z0-9]+|_\d+)$/i;

function _norm(s: string): string {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function _baseTitle(title: string): string {
  return _norm(title.replace(COPY_SUFFIX_TITLE, ""));
}

function _baseKey(key: string | null | undefined): string {
  return _norm((key ?? "").replace(COPY_SUFFIX_KEY, ""));
}

function _stepPhrases(step: Step): string[] {
  const out: string[] = [];
  for (const t of step.transitions || []) {
    for (const p of t.trigger_phrases || []) {
      const n = _norm(p);
      // Frases muito curtas ("1", "2") ou stopwords são intencionalmente
      // duplicadas entre passos paralelos (botões numerados) — não
      // contabilizamos como conflito para não poluir a UI.
      if (n.length >= 3) out.push(n);
    }
  }
  return out;
}

export function useFlowConflicts(steps: Step[]): UseFlowConflictsResult {
  return useMemo(() => {
    const conflicts: StepConflict[] = [];

    // 1) Títulos duplicados (após remover "(cópia)").
    const byTitle = new Map<string, Step[]>();
    for (const s of steps) {
      const k = _baseTitle(s.title || "");
      if (!k) continue;
      const arr = byTitle.get(k) || [];
      arr.push(s);
      byTitle.set(k, arr);
    }
    for (const [k, group] of byTitle) {
      if (group.length < 2) continue;
      conflicts.push({
        kind: "duplicateTitle",
        stepIds: group.map((s) => s.id),
        label: `${group.length} passos com o nome "${group[0].title.replace(COPY_SUFFIX_TITLE, "")}"`,
      });
    }

    // 2) step_key duplicado (após remover sufixos _copy_*).
    const byKey = new Map<string, Step[]>();
    for (const s of steps) {
      const k = _baseKey(s.step_key);
      if (!k) continue;
      const arr = byKey.get(k) || [];
      arr.push(s);
      byKey.set(k, arr);
    }
    for (const [k, group] of byKey) {
      if (group.length < 2) continue;
      conflicts.push({
        kind: "duplicateKey",
        stepIds: group.map((s) => s.id),
        label: `${group.length} passos com identificador parecido "${k}"`,
      });
    }

    // 3) trigger_phrases sobrepostas entre passos distintos.
    const phraseIndex = new Map<string, Set<string>>(); // phrase → stepIds
    for (const s of steps) {
      for (const p of _stepPhrases(s)) {
        const set = phraseIndex.get(p) || new Set<string>();
        set.add(s.id);
        phraseIndex.set(p, set);
      }
    }
    // Agrupa por conjunto-de-passos para não duplicar a mesma fofoca.
    const overlapByGroup = new Map<string, { stepIds: string[]; phrases: string[] }>();
    for (const [phrase, idSet] of phraseIndex) {
      if (idSet.size < 2) continue;
      const ids = [...idSet].sort();
      const key = ids.join("|");
      const entry = overlapByGroup.get(key) || { stepIds: ids, phrases: [] };
      entry.phrases.push(phrase);
      overlapByGroup.set(key, entry);
    }
    for (const { stepIds, phrases } of overlapByGroup.values()) {
      const sample = phrases.slice(0, 3).join('", "');
      const more = phrases.length > 3 ? ` +${phrases.length - 3}` : "";
      conflicts.push({
        kind: "triggerOverlap",
        stepIds,
        label: `${stepIds.length} passos compartilham "${sample}"${more}`,
      });
    }

    // Index reverso: stepId → conflitos.
    const byStep = new Map<string, StepConflict[]>();
    for (const c of conflicts) {
      for (const id of c.stepIds) {
        const arr = byStep.get(id) || [];
        arr.push(c);
        byStep.set(id, arr);
      }
    }

    return { conflicts, byStep, involvedCount: byStep.size };
  }, [steps]);
}
