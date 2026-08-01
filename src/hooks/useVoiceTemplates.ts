import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/components/ui/sonner";

export type VoiceBlockKind = "fixed_audio" | "name_slot" | "variable_slot";

export interface VoiceBlock {
  id: string;
  template_id: string;
  position: number;
  kind: VoiceBlockKind;
  audio_url: string | null;
  variable_key: string | null;
  label: string | null;
}

export interface VoiceTemplate {
  id: string;
  consultant_id: string;
  name: string;
  shortcut: string | null;
  description: string | null;
  blocks?: VoiceBlock[];
}

export interface VoiceNameClip {
  id: string;
  consultant_id: string;
  name_normalized: string;
  name_display: string;
  audio_url: string;
}

export function normalizeName(input: string): string {
  return (input || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

export function useVoiceTemplates(consultantId: string | undefined) {
  const [templates, setTemplates] = useState<VoiceTemplate[]>([]);
  const [clips, setClips] = useState<VoiceNameClip[]>([]);
  const [loading, setLoading] = useState(false);

  const refetch = useCallback(async () => {
    if (!consultantId) return;
    setLoading(true);
    try {
      const [{ data: tpls }, { data: cls }] = await Promise.all([
        supabase.from("voice_templates").select("*").eq("consultant_id", consultantId).order("created_at"),
        supabase.from("voice_name_clips").select("*").eq("consultant_id", consultantId).order("name_display"),
      ]);
      // Filtra blocos apenas dos templates deste consultor
      const tplIds = (tpls || []).map((t: any) => t.id);
      let blks: any[] = [];
      if (tplIds.length > 0) {
        const { data: blksData } = await supabase
          .from("voice_template_blocks")
          .select("*")
          .in("template_id", tplIds)
          .order("position");
        blks = blksData || [];
      }
      const tplsWithBlocks: VoiceTemplate[] = (tpls || []).map((t: any) => ({
        ...t,
        blocks: blks.filter((b: any) => b.template_id === t.id),
      }));
      setTemplates(tplsWithBlocks);
      setClips((cls as VoiceNameClip[]) || []);
    } finally {
      setLoading(false);
    }
  }, [consultantId]);

  useEffect(() => { refetch(); }, [refetch]);

  const createTemplate = useCallback(async (name: string, shortcut?: string) => {
    if (!consultantId) return null;
    const { data, error } = await supabase.from("voice_templates").insert({
      consultant_id: consultantId,
      name: name.trim(),
      shortcut: shortcut?.trim() || null,
    }).select().single();
    if (error) { toast.error(error.message); return null; }
    await refetch();
    return data as VoiceTemplate;
  }, [consultantId, refetch]);

  const updateTemplate = useCallback(async (id: string, patch: Partial<Pick<VoiceTemplate, "name" | "shortcut" | "description">>) => {
    const { error } = await supabase.from("voice_templates").update(patch).eq("id", id);
    if (error) toast.error(error.message);
    await refetch();
  }, [refetch]);

  const deleteTemplate = useCallback(async (id: string) => {
    const { error } = await supabase.from("voice_templates").delete().eq("id", id);
    if (error) toast.error(error.message);
    await refetch();
  }, [refetch]);

  const addBlock = useCallback(async (templateId: string, kind: VoiceBlockKind, audioUrl?: string | null, variableKey?: string | null) => {
    // próxima posição
    const { data: existing } = await supabase.from("voice_template_blocks").select("position").eq("template_id", templateId).order("position", { ascending: false }).limit(1);
    const nextPos = (existing?.[0]?.position ?? -1) + 1;
    const { error } = await supabase.from("voice_template_blocks").insert({
      template_id: templateId,
      position: nextPos,
      kind,
      audio_url: audioUrl ?? null,
      variable_key: variableKey ?? null,
    });
    if (error) { toast.error(error.message); return; }
    // Invalida cache de renders
    await supabase.from("voice_template_renders").delete().eq("template_id", templateId);
    await refetch();
  }, [refetch]);

  const updateBlockAudio = useCallback(async (blockId: string, templateId: string, audioUrl: string) => {
    const { error } = await supabase.from("voice_template_blocks").update({ audio_url: audioUrl }).eq("id", blockId);
    if (error) { toast.error(error.message); return; }
    await supabase.from("voice_template_renders").delete().eq("template_id", templateId);
    await refetch();
  }, [refetch]);

  const updateBlockVariableKey = useCallback(async (blockId: string, templateId: string, variableKey: string) => {
    const { error } = await supabase.from("voice_template_blocks").update({ variable_key: variableKey }).eq("id", blockId);
    if (error) { toast.error(error.message); return; }
    await supabase.from("voice_template_renders").delete().eq("template_id", templateId);
    await refetch();
  }, [refetch]);

  const deleteBlock = useCallback(async (blockId: string, templateId: string) => {
    const { error } = await supabase.from("voice_template_blocks").delete().eq("id", blockId);
    if (error) { toast.error(error.message); return; }
    await supabase.from("voice_template_renders").delete().eq("template_id", templateId);
    await refetch();
  }, [refetch]);

  const moveBlock = useCallback(async (templateId: string, blockId: string, direction: -1 | 1) => {
    const tpl = templates.find((t) => t.id === templateId);
    if (!tpl?.blocks) return;
    const sorted = [...tpl.blocks].sort((a, b) => a.position - b.position);
    const idx = sorted.findIndex((b) => b.id === blockId);
    const swap = idx + direction;
    if (idx < 0 || swap < 0 || swap >= sorted.length) return;
    const a = sorted[idx], b = sorted[swap];
    // troca posições (usa valor temporário pra evitar conflito de unique se houvesse)
    await supabase.from("voice_template_blocks").update({ position: -1 }).eq("id", a.id);
    await supabase.from("voice_template_blocks").update({ position: a.position }).eq("id", b.id);
    await supabase.from("voice_template_blocks").update({ position: b.position }).eq("id", a.id);
    await supabase.from("voice_template_renders").delete().eq("template_id", templateId);
    await refetch();
  }, [templates, refetch]);

  const upsertNameClip = useCallback(async (displayName: string, audioUrl: string) => {
    if (!consultantId) return;
    const norm = normalizeName(displayName);
    if (!norm) { toast.error("Nome inválido"); return; }
    const { error } = await supabase.from("voice_name_clips").upsert({
      consultant_id: consultantId,
      name_normalized: norm,
      name_display: displayName.trim(),
      audio_url: audioUrl,
    }, { onConflict: "consultant_id,name_normalized" });
    if (error) { toast.error(error.message); return; }
    // invalida renders que dependam desse nome
    const { data: tpls } = await supabase.from("voice_templates").select("id").eq("consultant_id", consultantId);
    if (tpls?.length) {
      await supabase.from("voice_template_renders").delete().in("template_id", tpls.map((t: any) => t.id)).eq("name_normalized", norm);
    }
    await refetch();
  }, [consultantId, refetch]);

  const deleteNameClip = useCallback(async (id: string) => {
    const { error } = await supabase.from("voice_name_clips").delete().eq("id", id);
    if (error) toast.error(error.message);
    await refetch();
  }, [refetch]);

  /** Pede ao backend para costurar e retorna a URL final do áudio. */
  const renderTemplate = useCallback(async (templateId: string, name?: string, variables?: Record<string, string>): Promise<{ url?: string; error?: string; missing_name?: string; missing_key?: string }> => {
    const { data, error } = await supabase.functions.invoke("voice-template-stitch", {
      body: { action: "render", template_id: templateId, name: name || "", variables: variables || {} },
    });
    if (error) {
      const ctx: any = (error as any).context;
      if (ctx?.error === "name_not_recorded") {
        return { error: "name_not_recorded", missing_name: ctx.missing_name, missing_key: ctx.missing_key };
      }
      return { error: error.message };
    }
    if ((data as any)?.error === "name_not_recorded") {
      return { error: "name_not_recorded", missing_name: (data as any).missing_name, missing_key: (data as any).missing_key };
    }
    return { url: (data as any)?.url };
  }, []);

  return {
    templates, clips, loading, refetch,
    createTemplate, updateTemplate, deleteTemplate,
    addBlock, updateBlockAudio, updateBlockVariableKey, deleteBlock, moveBlock,
    upsertNameClip, deleteNameClip,
    renderTemplate,
  };
}
