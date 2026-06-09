import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { MessageTemplate } from "@/types/whatsapp";
import { deriveLegacyMediaFields } from "@/services/templateSender";

/**
 * Pure function that replaces placeholders in a template with customer data.
 * Exported separately so it can be tested independently.
 */
export function applyTemplate(
  template: MessageTemplate,
  customer: { name: string; electricity_bill_value?: number }
): string {
  const name = String(customer.name || "").trim();
  const firstName = name.split(/\s+/)[0] || "";
  const bill = customer.electricity_bill_value;
  const billStr =
    bill != null && Number.isFinite(Number(bill))
      ? String(bill)
      : "";

  // Substitui {chave} e {{chave}} em qualquer caixa (NOME, Nome, nome) com espaços.
  return String(template.content || "").replace(
    /\{\{?\s*([a-zA-ZÀ-ÿ_][\w\sÀ-ÿ-]{0,40})\s*\}?\}/g,
    (match, rawKey: string) => {
      const key = String(rawKey).trim().toLowerCase();
      if (key === "nome" || key === "first_name" || key === "primeiro_nome" || key === "cliente") return firstName;
      if (key === "nome_completo" || key === "name") return name;
      if (key === "valor_conta" || key === "valor" || key === "conta" || key === "fatura") return billStr;
      return match;
    },
  );
}

export function useTemplates(consultantId: string) {
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const fetchTemplates = useCallback(async () => {
    if (!mountedRef.current) return;
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from("message_templates")
        .select("*, items:template_items(*)");

      if (error) throw error;
      if (mountedRef.current) {
        // Ordena os itens de cada template por position.
        const rows = ((data as unknown as MessageTemplate[]) ?? []).map((t) => ({
          ...t,
          items: Array.isArray(t.items)
            ? [...t.items].sort((a, b) => a.position - b.position)
            : [],
        }));
        setTemplates(rows);
      }
    } catch (err) {
      console.warn("[useTemplates] fetch error:", err);
    } finally {
      if (mountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [consultantId]);

  const createTemplate = useCallback(
    async (name: string, content: string, mediaType: string = "text", mediaUrl: string | null = null, imageUrl: string | null = null, isPublic: boolean = false, items?: import("@/types/whatsapp").TemplateItem[]) => {
      // Compat: deriva media_type/media_url/image_url dos itens (convenção única).
      let topMediaType = mediaType;
      let topMediaUrl = mediaUrl;
      let topImageUrl = imageUrl;
      if (items && items.length > 0) {
        const derived = deriveLegacyMediaFields(items);
        topMediaType = derived.media_type;
        topMediaUrl = derived.media_url;
        topImageUrl = derived.image_url;
      }

      const { data: created, error } = await supabase
        .from("message_templates")
        .insert({
          consultant_id: consultantId,
          name,
          content,
          media_type: topMediaType,
          media_url: topMediaUrl,
          image_url: topImageUrl,
          is_public: isPublic,
        })
        .select("id")
        .single();
      if (error) throw error;

      // Persiste os itens (multi-arquivo) quando fornecidos.
      if (created?.id && items && items.length > 0) {
        const rows = items.map((it, i) => ({
          template_id: created.id,
          position: i,
          message_type: it.message_type || "text",
          message_text: it.message_text?.trim() || null,
          media_url: it.media_url?.trim() || null,
          image_url: it.image_url?.trim() || null,
          delay_seconds: it.delay_seconds || 0,
        }));
        const { error: itemsErr } = await supabase.from("template_items").insert(rows as never);
        if (itemsErr) throw itemsErr;
      }

      await fetchTemplates();
    },
    [consultantId, fetchTemplates]
  );

  const updateTemplate = useCallback(
    async (id: string, updates: { name?: string; image_url?: string | null; content?: string; media_url?: string | null; media_type?: string; is_quick_reply?: boolean; is_public?: boolean }, items?: import("@/types/whatsapp").TemplateItem[]) => {
      // Quando há itens, deriva os campos de compat (media_type/media_url/image_url)
      // dos itens usando a convenção única — mantém o legado sincronizado.
      let finalUpdates = updates;
      if (items) {
        finalUpdates = { ...updates, ...deriveLegacyMediaFields(items) };
      }

      const { error, data } = await supabase
        .from("message_templates")
        .update(finalUpdates)
        .eq("id", id)
        .select();
      if (error) throw error;
      if (!data || data.length === 0) {
        console.error("Template update blocked by RLS or not found. ID:", id, "Updates:", finalUpdates);
        throw new Error("Não foi possível atualizar o template. Verifique se você está autenticado.");
      }

      // Sincroniza os itens (multi-arquivo): apaga os antigos e regrava na ordem.
      if (items) {
        const { error: delErr } = await supabase.from("template_items").delete().eq("template_id", id);
        if (delErr) throw delErr;
        if (items.length > 0) {
          const rows = items.map((it, i) => ({
            template_id: id,
            position: i,
            message_type: it.message_type || "text",
            message_text: it.message_text?.trim() || null,
            media_url: it.media_url?.trim() || null,
            image_url: it.image_url?.trim() || null,
            delay_seconds: it.delay_seconds || 0,
          }));
          const { error: insErr } = await supabase.from("template_items").insert(rows as never);
          if (insErr) throw insErr;
        }
      }

      await fetchTemplates();
    },
    [fetchTemplates]
  );

  const deleteTemplate = useCallback(
    async (id: string) => {
      const { error, data } = await supabase
        .from("message_templates")
        .delete()
        .eq("id", id)
        .select();
      if (error) throw error;
      if (!data || data.length === 0) {
        throw new Error("Não foi possível excluir o template. Verifique se você é o proprietário.");
      }
      await fetchTemplates();
    },
    [fetchTemplates]
  );

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  // Permite refresh disparado por componentes filhos (ex: SaveMessageAsTemplateDialog)
  useEffect(() => {
    const handler = () => { fetchTemplates(); };
    window.addEventListener("templates:refresh", handler);
    return () => window.removeEventListener("templates:refresh", handler);
  }, [fetchTemplates]);

  return {
    templates,
    isLoading,
    refetchTemplates: fetchTemplates,
    createTemplate,
    updateTemplate,
    deleteTemplate,
    applyTemplate,
  };
}
