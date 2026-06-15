// useFlowStepsCrud — persistência central dos passos do construtor (PR-1).
//
// PROBLEMA QUE RESOLVE
// --------------------
// O `FluxoBuilder` (rota /admin/fluxos, único construtor vivo) passava handlers
// ZERADOS para o inspetor e o diagrama (`onPatch={() => {}}`, `onAddStep={async
// () => null}` etc.). Resultado: editar um passo na tela principal NÃO salvava.
// Os únicos caminhos que gravavam eram `FlowTemplatesDialog` e `StepSuggestions`
// (ambos `insert`) — dava pra ADICIONAR, mas não EDITAR.
//
// Este hook centraliza add/patch/delete/duplicate em `bot_flow_steps`, com
// atualização OTIMISTA (a UI muda na hora) + REVERT em erro (volta ao estado
// anterior e avisa). Reusa exatamente o mesmo formato de linha que os caminhos
// já testados usam (schema idêntico ao `bot_flow_steps`).
//
// MODO PÚBLICO vs CUSTOM (a decisão "fork ao editar" — Opção A)
// -------------------------------------------------------------
// A maioria dos consultores está em `sync_mode='public'` (default): o construtor
// mostra o fluxo PRÓPRIO, mas o bot, em runtime, LÊ o fluxo PÚBLICO do Super
// Admin (`resolve-flow.ts`/`loader.ts`). Logo, gravar no fluxo próprio enquanto
// `public` salvaria num lugar que o bot ignora.
//
// Por isso, a edição em modo público é BLOQUEADA até o consultor "Personalizar":
// `personalizar()` chama o RPC `fork_flow_from_public` (que JÁ existe no banco —
// migration 20260605133252), que clona os passos do público para o fluxo do
// consultor, remapeia os ids de transitions/fallback e marca `sync_mode='custom'`.
// A partir daí, construtor e bot leem o MESMO fluxo (o próprio do consultor).
//
// O hook NÃO decide sozinho forkar no meio de uma digitação (isso remaparia ids
// de forma frágil). O fork é uma ação explícita e única, exposta por `personalizar`.

import { useCallback, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Step, Variant } from "./flowTypes";

/** Colunas de `bot_flow_steps` que o construtor pode escrever via patch. */
const PATCHABLE_COLUMNS = [
  "position",
  "step_type",
  "step_key",
  "title",
  "summary",
  "icon",
  "message_text",
  "text_delay_ms",
  "slot_key",
  "transitions",
  "captures",
  "fallback",
  "is_active",
  "auto_detect_doc_type",
  "layout",
] as const;

type PatchableColumn = (typeof PATCHABLE_COLUMNS)[number];

/** Mantém só as chaves que existem como coluna real (evita 400 do PostgREST). */
function sanitizePatch(patch: Partial<Step>): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const key of Object.keys(patch)) {
    if ((PATCHABLE_COLUMNS as readonly string[]).includes(key)) {
      clean[key] = (patch as Record<string, unknown>)[key];
    }
  }
  return clean;
}

export interface UseFlowStepsCrudArgs {
  /** `bot_flows.id` do fluxo PRÓPRIO do consultor na variante atual. */
  flowId: string | null;
  /** `sync_mode` do fluxo próprio: 'public' (herdado) ou 'custom' (editável). */
  syncMode: "public" | "custom";
  /** Id do consultor logado (dono do fluxo) — usado no fork. */
  consultantId: string | null;
  /** Variante em edição (A..Z). */
  variant: Variant;
  /** Passos atuais em memória (fonte da UI). */
  steps: Step[];
  /** Setter otimista da lista de passos. */
  setSteps: React.Dispatch<React.SetStateAction<Step[]>>;
  /** Recarrega os passos do banco (após fork ou para ressincronizar). */
  reload: () => Promise<void> | void;
}

export interface UseFlowStepsCrudResult {
  /** `true` enquanto o fluxo é herdado do público (edição bloqueada). */
  readOnlyHerdado: boolean;
  /** `true` durante uma operação de escrita/fork. */
  saving: boolean;
  /** Cria a cópia editável (fork do público) e recarrega. Idempotente no servidor. */
  personalizar: () => Promise<boolean>;
  /** Edita um passo (otimista + revert em erro). */
  patchStep: (id: string, patch: Partial<Step>) => Promise<void>;
  /** Cria um passo ao final do fluxo e devolve o passo criado (ou null). */
  addStep: (seed?: Partial<Step>) => Promise<Step | null>;
  /** Remove um passo (otimista + revert em erro). */
  deleteStep: (id: string) => Promise<void>;
  /** Duplica um passo logo após o original. */
  duplicateStep: (id: string) => Promise<void>;
}

export function useFlowStepsCrud({
  flowId,
  syncMode,
  consultantId,
  variant,
  steps,
  setSteps,
  reload,
}: UseFlowStepsCrudArgs): UseFlowStepsCrudResult {
  const [saving, setSaving] = useState(false);

  const readOnlyHerdado = syncMode === "public";

  /**
   * Garante que o fluxo está editável antes de qualquer escrita. Em modo
   * público, NÃO grava — avisa o consultor para "Personalizar" primeiro. Isso
   * impede o bug silencioso de salvar onde o bot não lê.
   */
  const guardEditavel = useCallback((): boolean => {
    if (!flowId) {
      toast.error("Fluxo ainda não carregado. Aguarde um instante.");
      return false;
    }
    if (readOnlyHerdado) {
      toast.info(
        'Este fluxo é o modelo padrão. Clique em "Personalizar" para criar a sua versão editável.',
      );
      return false;
    }
    return true;
  }, [flowId, readOnlyHerdado]);

  const personalizar = useCallback(async (): Promise<boolean> => {
    if (!consultantId) {
      toast.error("Consultor não identificado.");
      return false;
    }
    if (!readOnlyHerdado) return true; // já é custom — nada a fazer
    setSaving(true);
    try {
      const { error } = await supabase.rpc("fork_flow_from_public", {
        _consultant_id: consultantId,
        _variant: variant,
      });
      if (error) throw error;
      await reload();
      toast.success("Pronto! Agora você pode editar a sua versão do fluxo.");
      return true;
    } catch (e) {
      toast.error(
        "Não foi possível personalizar o fluxo: " +
          ((e as { message?: string })?.message ?? "erro desconhecido"),
      );
      return false;
    } finally {
      setSaving(false);
    }
  }, [consultantId, readOnlyHerdado, variant, reload]);

  const patchStep = useCallback(
    async (id: string, patch: Partial<Step>): Promise<void> => {
      if (!guardEditavel()) return;
      const clean = sanitizePatch(patch);
      if (Object.keys(clean).length === 0) return;

      // Snapshot para revert.
      const prev = steps;
      // Otimista.
      setSteps((cur) => cur.map((s) => (s.id === id ? { ...s, ...patch } : s)));
      setSaving(true);
      try {
        const { error } = await supabase
          .from("bot_flow_steps")
          .update(clean as never)
          .eq("id", id);
        if (error) throw error;
      } catch (e) {
        setSteps(prev); // revert
        toast.error(
          "Não foi possível salvar a alteração: " +
            ((e as { message?: string })?.message ?? "erro"),
        );
      } finally {
        setSaving(false);
      }
    },
    [guardEditavel, steps, setSteps],
  );

  const addStep = useCallback(
    async (seed?: Partial<Step>): Promise<Step | null> => {
      if (!guardEditavel() || !flowId) return null;
      const maxPosition = steps.reduce((m, s) => Math.max(m, s.position), 0);
      const slotKey = seed?.slot_key ?? `passo_${Date.now().toString(36)}`;
      const row = {
        flow_id: flowId,
        position: maxPosition + 1,
        step_type: seed?.step_type ?? "message",
        step_key: seed?.step_key ?? slotKey,
        title: seed?.title ?? "Novo passo",
        summary: seed?.summary ?? "",
        icon: seed?.icon ?? "msg",
        message_text: seed?.message_text ?? "",
        slot_key: slotKey,
        transitions: seed?.transitions ?? [],
        captures: seed?.captures ?? [],
        fallback: seed?.fallback ?? { mode: "repeat" },
        is_active: true,
      };
      setSaving(true);
      try {
        const { data, error } = await supabase
          .from("bot_flow_steps")
          .insert(row as never)
          .select()
          .single();
        if (error) throw error;
        await reload();
        return (data as unknown as Step) ?? null;
      } catch (e) {
        toast.error(
          "Não foi possível adicionar o passo: " +
            ((e as { message?: string })?.message ?? "erro"),
        );
        return null;
      } finally {
        setSaving(false);
      }
    },
    [guardEditavel, flowId, steps, reload],
  );

  const deleteStep = useCallback(
    async (id: string): Promise<void> => {
      if (!guardEditavel()) return;
      const prev = steps;
      setSteps((cur) => cur.filter((s) => s.id !== id));
      setSaving(true);
      try {
        const { error } = await supabase
          .from("bot_flow_steps")
          .delete()
          .eq("id", id);
        if (error) throw error;
      } catch (e) {
        setSteps(prev); // revert
        toast.error(
          "Não foi possível remover o passo: " +
            ((e as { message?: string })?.message ?? "erro"),
        );
      } finally {
        setSaving(false);
      }
    },
    [guardEditavel, steps, setSteps],
  );

  const duplicateStep = useCallback(
    async (id: string): Promise<void> => {
      if (!guardEditavel() || !flowId) return;
      const original = steps.find((s) => s.id === id);
      if (!original) return;
      const slotKey = `passo_${Date.now().toString(36)}`;
      // Duplicata NÃO copia transitions (os ids apontariam para destinos antigos
      // e poderiam confundir o roteamento); o consultor reconfigura as saídas.
      const row = {
        flow_id: flowId,
        position: original.position + 1,
        step_type: original.step_type,
        step_key: slotKey,
        title: `${original.title} (cópia)`,
        summary: original.summary ?? "",
        icon: original.icon,
        message_text: original.message_text ?? "",
        slot_key: slotKey,
        transitions: [],
        captures: original.captures ?? [],
        fallback: { mode: "repeat" },
        is_active: original.is_active,
      };
      setSaving(true);
      try {
        const { error } = await supabase
          .from("bot_flow_steps")
          .insert(row as never);
        if (error) throw error;
        await reload();
      } catch (e) {
        toast.error(
          "Não foi possível duplicar o passo: " +
            ((e as { message?: string })?.message ?? "erro"),
        );
      } finally {
        setSaving(false);
      }
    },
    [guardEditavel, flowId, steps, reload],
  );

  return {
    readOnlyHerdado,
    saving,
    personalizar,
    patchStep,
    addStep,
    deleteStep,
    duplicateStep,
  };
}
