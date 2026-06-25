// useFlowConflicts — detecta APENAS ambiguidades reais que podem fazer
// o runtime do bot escolher a rota errada. Ambiguidade "global" (mesma
// palavra usada em passos diferentes da conversa) NÃO é conflito: cada
// passo só avalia suas próprias transitions, então "cadastrar" em um
// passo e "cadastrar" em outro nunca competem entre si.
//
// Tipos de conflito reportados:
//   - sameStepPhrase: a MESMA frase aparece em duas transitions do MESMO
//     passo com destinos diferentes (o runtime escolheria a primeira e
//     ignoraria a outra — bug silencioso).
//   - duplicateTitle: dois passos distintos com o mesmo título (após
//     remover "(cópia)") — o super admin clica num e parece ter clicado
//     no outro.
//
// O hook é puro: zero rede, recalcula só quando `steps` muda.

import { useMemo } from "react";
import type { Step, Transition } from "./flowTypes";

export type ConflictKind = "sameStepPhrase" | "duplicateTitle";

export interface StepConflict {
  kind: ConflictKind;
  /** ids dos passos envolvidos (≥ 1 — sameStepPhrase usa 1 passo). */
  stepIds: string[];
  /** Texto curto que descreve o conflito. */
  label: string;
}

export interface UseFlowConflictsResult {
  conflicts: StepConflict[];
  byStep: Map<string, StepConflict[]>;
  involvedCount: number;
}

const COPY_SUFFIX_TITLE = /\s*\(c[oó]pia(?:\s+\d+)?\)\s*$/i;

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

function _destKey(t: Transition): string {
  return `${t.goto_step_id ?? ""}|${t.goto_special ?? ""}`;
}

/**
 * Função pura — calcula conflitos a partir de uma lista de passos.
 * Reutilizada pelo hook (renderização) e pelo CRUD (validação pós-salvar).
 */
export function detectConflicts(steps: Step[]): UseFlowConflictsResult {
  const conflicts: StepConflict[] = [];

  // 1) Conflito dentro do MESMO passo: mesma phrase em duas transitions
  //    apontando para destinos diferentes.
  for (const s of steps) {
    const txs = Array.isArray(s.transitions) ? s.transitions : [];
    if (txs.length < 2) continue;
    const byPhrase = new Map<string, Set<string>>();
    const phraseSamples = new Map<string, string>();
    for (const t of txs) {
      const dest = _destKey(t);
      for (const p of t.trigger_phrases || []) {
        const n = _norm(p);
        if (!n || n.length < 2) continue;
        const set = byPhrase.get(n) || new Set<string>();
        set.add(dest);
        byPhrase.set(n, set);
        if (!phraseSamples.has(n)) phraseSamples.set(n, p);
      }
    }
    const ambiguous: string[] = [];
    for (const [phrase, dests] of byPhrase) {
      if (dests.size > 1) ambiguous.push(phraseSamples.get(phrase) || phrase);
    }
    if (ambiguous.length) {
      const sample = ambiguous.slice(0, 3).join('", "');
      const more = ambiguous.length > 3 ? ` +${ambiguous.length - 3}` : "";
      conflicts.push({
        kind: "sameStepPhrase",
        stepIds: [s.id],
        label: `Mesma palavra em rotas diferentes deste passo: "${sample}"${more}`,
      });
    }
  }

  // 2) Títulos exatamente iguais entre passos distintos.
  const byTitle = new Map<string, Step[]>();
  for (const s of steps) {
    const k = _baseTitle(s.title || "");
    if (!k) continue;
    const arr = byTitle.get(k) || [];
    arr.push(s);
    byTitle.set(k, arr);
  }
  for (const group of byTitle.values()) {
    if (group.length < 2) continue;
    const rawTitles = new Set(group.map((s) => (s.title || "").trim()));
    if (rawTitles.size > 1) continue;
    conflicts.push({
      kind: "duplicateTitle",
      stepIds: group.map((s) => s.id),
      label: `${group.length} passos com o mesmo nome "${group[0].title}" — renomeie para distinguir`,
    });
  }

  const byStep = new Map<string, StepConflict[]>();
  for (const c of conflicts) {
    for (const id of c.stepIds) {
      const arr = byStep.get(id) || [];
      arr.push(c);
      byStep.set(id, arr);
    }
  }

  return { conflicts, byStep, involvedCount: byStep.size };
}

export function useFlowConflicts(steps: Step[]): UseFlowConflictsResult {
  return useMemo(() => detectConflicts(steps), [steps]);
}

