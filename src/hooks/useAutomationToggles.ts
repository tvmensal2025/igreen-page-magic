import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type AutomationToggle = {
  id: string;
  key: string;
  label: string;
  description: string | null;
  category: string;
  enabled: boolean;
  updated_at: string;
};

export function useAutomationToggles() {
  const [items, setItems] = useState<AutomationToggle[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("automation_toggles")
      .select("*")
      .order("category", { ascending: true })
      .order("label", { ascending: true });
    if (error) toast.error("Não foi possível carregar as automações.");
    setItems((data || []) as AutomationToggle[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const byKey = useMemo(() => {
    const m = new Map<string, AutomationToggle>();
    items.forEach((t) => m.set(t.key, t));
    return m;
  }, [items]);

  const onCount = items.filter((i) => i.enabled).length;
  const offCount = items.length - onCount;

  async function setEnabled(key: string, next: boolean, opts?: { confirmOn?: boolean }) {
    const row = byKey.get(key);
    if (!row) {
      toast.error("Automação não encontrada.");
      return false;
    }
    if (next && opts?.confirmOn !== false) {
      const ok = window.confirm(
        `Ligar “${row.label}”?\n\nIsso pode enviar mensagem automática para clientes.`,
      );
      if (!ok) return false;
    }

    setBusyKey(key);
    // RLS admin-only: sem permissão o UPDATE volta 0 linhas SEM erro. Se não
    // exigirmos a linha de volta, a tela diz "desligado" e o motor segue ligado.
    const { data: saved, error } = await supabase
      .from("automation_toggles")
      .update({ enabled: next })
      .eq("id", row.id)
      .select("id")
      .maybeSingle();
    setBusyKey(null);

    if (error) {
      toast.error(
        error.message.toLowerCase().includes("policy")
          ? "Sem permissão. Peça ao administrador."
          : error.message,
      );
      return false;
    }
    if (!saved) {
      toast.error("Sem permissão. Nada foi alterado — o motor continua como estava.");
      return false;
    }

    setItems((prev) => prev.map((x) => (x.id === row.id ? { ...x, enabled: next } : x)));
    toast.success(next ? `“${row.label}” ligado` : `“${row.label}” desligado`);
    return true;
  }


  async function bulkSet(next: boolean) {
    if (
      !confirm(
        next
          ? "Ligar TODAS as automações? Risco alto de envio em massa."
          : "Desligar TODAS as automações? Nenhum envio automático sairá.",
      )
    ) {
      return;
    }
    setBusyKey("__all__");
    // Mesmo caso: RLS admin-only. 0 linhas = nada mudou, não pode dizer
    // "todas desligadas — modo seguro" com os motores ainda ligados.
    const { data: rows, error } = await supabase
      .from("automation_toggles")
      .update({ enabled: next })
      .neq("id", "00000000-0000-0000-0000-000000000000")
      .select("id");
    setBusyKey(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    if (!rows || rows.length === 0) {
      toast.error("Sem permissão. Nenhuma automação foi alterada.");
      await load();
      return;
    }
    toast.success(next ? "Todas ligadas" : "Todas desligadas — modo seguro");
    await load();

  }

  return {
    items,
    byKey,
    loading,
    busyKey,
    onCount,
    offCount,
    load,
    setEnabled,
    bulkSet,
  };
}
