import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface CustomerTag {
  id: string;
  consultant_id: string;
  remote_jid: string;
  tag_name: string;
  tag_color: string;
  created_at: string;
}

export const TAG_COLOR_PALETTE = [
  "#22c55e",
  "#3b82f6",
  "#f59e0b",
  "#ef4444",
  "#a855f7",
  "#06b6d4",
  "#ec4899",
  "#64748b",
] as const;

export const MAX_TAGS_PER_CONTACT = 8;
export const MAX_TAG_NAME_LEN = 24;

/** Alinha com AddLeadDialog / Kanban: dígitos + DDI 55 se faltar. */
export function phoneToRemoteJid(phone: string | null | undefined): string | null {
  if (!phone || /sem_celular/i.test(phone)) return null;
  const cleaned = phone.replace(/[\s\-\(\)\+]/g, "");
  const digits = cleaned.replace(/\D/g, "");
  if (digits.length < 10) return null;
  const withDdi = digits.startsWith("55") ? digits : `55${digits}`;
  return `${withDdi}@s.whatsapp.net`;
}

export function useCustomerTags(remoteJid: string | null, consultantId: string | null) {
  const [tags, setTags] = useState<CustomerTag[]>([]);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    if (!remoteJid || !consultantId) {
      setTags([]);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("customer_tags")
      .select("id, consultant_id, remote_jid, tag_name, tag_color, created_at")
      .eq("consultant_id", consultantId)
      .eq("remote_jid", remoteJid)
      .order("created_at", { ascending: true });
    if (error) {
      console.warn("[useCustomerTags] load:", error.message);
      setTags([]);
    } else {
      setTags((data || []) as CustomerTag[]);
    }
    setLoading(false);
  }, [remoteJid, consultantId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const add = useCallback(
    async (tag_name: string, tag_color: string = TAG_COLOR_PALETTE[0]) => {
      if (!remoteJid || !consultantId) throw new Error("Telefone inválido para tag");
      const name = tag_name.trim().slice(0, MAX_TAG_NAME_LEN);
      if (!name) throw new Error("Nome da tag é obrigatório");
      if (tags.length >= MAX_TAGS_PER_CONTACT) {
        throw new Error(`Máximo de ${MAX_TAGS_PER_CONTACT} tags`);
      }
      if (tags.some((t) => t.tag_name.toLowerCase() === name.toLowerCase())) {
        throw new Error("Tag já existe");
      }
      const { data, error } = await supabase
        .from("customer_tags")
        .insert({
          consultant_id: consultantId,
          remote_jid: remoteJid,
          tag_name: name,
          tag_color,
        })
        .select("id, consultant_id, remote_jid, tag_name, tag_color, created_at")
        .single();
      if (error) throw error;
      const row = data as CustomerTag;
      setTags((prev) => [...prev, row]);
      return row;
    },
    [remoteJid, consultantId, tags],
  );

  const update = useCallback(async (id: string, patch: { tag_name?: string; tag_color?: string }) => {
    const payload: { tag_name?: string; tag_color?: string } = {};
    if (patch.tag_name !== undefined) {
      payload.tag_name = patch.tag_name.trim().slice(0, MAX_TAG_NAME_LEN);
      if (!payload.tag_name) throw new Error("Nome da tag é obrigatório");
    }
    if (patch.tag_color !== undefined) payload.tag_color = patch.tag_color;
    const { data, error } = await supabase
      .from("customer_tags")
      .update(payload)
      .eq("id", id)
      .select("id, consultant_id, remote_jid, tag_name, tag_color, created_at")
      .single();
    if (error) throw error;
    const row = data as CustomerTag;
    setTags((prev) => prev.map((t) => (t.id === id ? row : t)));
    return row;
  }, []);

  const remove = useCallback(async (id: string) => {
    const { error } = await supabase.from("customer_tags").delete().eq("id", id);
    if (error) throw error;
    setTags((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return { tags, loading, reload, add, update, remove };
}

/** Carrega tags de vários JIDs de uma vez (lista de captação). */
export async function loadCustomerTagsBatch(
  consultantId: string,
  remoteJids: string[],
): Promise<Map<string, CustomerTag[]>> {
  const map = new Map<string, CustomerTag[]>();
  const unique = Array.from(new Set(remoteJids.filter(Boolean)));
  if (!consultantId || unique.length === 0) return map;
  const { data, error } = await supabase
    .from("customer_tags")
    .select("id, consultant_id, remote_jid, tag_name, tag_color, created_at")
    .eq("consultant_id", consultantId)
    .in("remote_jid", unique)
    .order("created_at", { ascending: true });
  if (error) {
    console.warn("[loadCustomerTagsBatch]", error.message);
    return map;
  }
  for (const row of (data || []) as CustomerTag[]) {
    const list = map.get(row.remote_jid) || [];
    list.push(row);
    map.set(row.remote_jid, list);
  }
  return map;
}
