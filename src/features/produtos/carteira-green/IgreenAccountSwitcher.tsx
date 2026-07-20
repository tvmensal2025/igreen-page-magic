// Seletor de conta portal iGreen (principal + licenciados abaixo).
// Default = conta principal (position 1). "Todas" agrega com badge por linha
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type IgreenAccountOption = {
  id: string;
  position: number;
  label: string | null;
  portal_email: string;
  igreen_consultor_id: string | null;
};

const STORAGE_KEY = "igreen_selected_account_id";

export function useIgreenAccounts(consultantId?: string) {
  const [accounts, setAccounts] = useState<IgreenAccountOption[]>([]);
  const [selectedId, setSelectedId] = useState<string | "all" | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!consultantId) return;
    let alive = true;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("igreen_portal_accounts")
        .select("id, position, label, portal_email, igreen_consultor_id")
        .eq("consultant_id", consultantId)
        .order("position", { ascending: true });
      if (!alive) return;
      const list = (data as IgreenAccountOption[]) || [];
      setAccounts(list);
      const stored = typeof localStorage !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
      const principal = list.find((a) => a.position === 1)?.id;
      if (stored === "all" || (stored && list.some((a) => a.id === stored))) {
        setSelectedId(stored as string | "all");
      } else {
        setSelectedId(principal || list[0]?.id || null);
      }
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [consultantId]);

  const select = (id: string | "all") => {
    setSelectedId(id);
    try { localStorage.setItem(STORAGE_KEY, id); } catch { /* ignore */ }
  };

  const selectedAccount = selectedId && selectedId !== "all"
    ? accounts.find((a) => a.id === selectedId) || null
    : null;

  return { accounts, selectedId, selectedAccount, select, loading };
}

export function IgreenAccountSwitcher({
  consultantId,
  selectedId,
  onSelect,
  accounts,
}: {
  consultantId: string;
  selectedId: string | "all" | null;
  onSelect: (id: string | "all") => void;
  accounts: IgreenAccountOption[];
}) {
  if (accounts.length <= 1) return null;

  const labelOf = (a: IgreenAccountOption) => {
    const base = a.label || a.portal_email;
    return a.position === 1 ? `${base} (principal)` : base;
  };

  return (
    <div className="flex items-center gap-2 min-w-[200px]">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground whitespace-nowrap">
        Conta iGreen
      </span>
      <Select
        value={selectedId || undefined}
        onValueChange={(v) => onSelect(v as string | "all")}
      >
        <SelectTrigger className="h-8 text-sm" aria-label="Selecionar conta iGreen">
          <SelectValue placeholder="Selecionar conta" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Todas as contas</SelectItem>
          {accounts.map((a) => (
            <SelectItem key={a.id} value={a.id}>
              {labelOf(a)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
