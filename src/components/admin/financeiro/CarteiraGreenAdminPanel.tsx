import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { CarteiraGreenPanel } from "@/features/produtos/carteira-green/CarteiraGreenPanel";

interface Consultant {
  id: string;
  name: string | null;
  display_name?: string | null;
}

/**
 * Wrapper da Carteira Green para o Admin: mostra a carteira do consultor
 * logado; se for super-admin, permite trocar para qualquer consultor da rede.
 */
export function CarteiraGreenAdminPanel({
  userId,
  canPickConsultant,
}: {
  userId: string;
  canPickConsultant: boolean;
}) {
  const [consultants, setConsultants] = useState<Consultant[]>([]);
  const [selectedId, setSelectedId] = useState<string>(userId);

  useEffect(() => {
    if (!canPickConsultant) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("consultants")
        .select("id, name, display_name")
        .order("name")
        .limit(500);
      if (cancelled) return;
      setConsultants((data || []) as Consultant[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [canPickConsultant]);

  return (
    <div className="space-y-4">
      {canPickConsultant && consultants.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <label className="text-xs text-muted-foreground uppercase tracking-wide">Consultor</label>
          <select
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm min-w-[240px]"
          >
            <option value={userId}>Minha carteira</option>
            {consultants.map((c) => (
              <option key={c.id} value={c.id}>
                {c.display_name || c.name || c.id.slice(0, 8)}
              </option>
            ))}
          </select>
        </div>
      )}
      <CarteiraGreenPanel consultantId={selectedId} />
    </div>
  );
}
