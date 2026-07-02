import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
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
  const [selectedId, setSelectedId] = useState<string>(userId);

  const { data: consultants = [], isLoading } = useQuery({
    queryKey: ["carteira-admin-consultants"],
    enabled: canPickConsultant,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Consultant[]> => {
      const { data, error } = await supabase
        .from("consultants")
        .select("id, name, display_name")
        .order("name")
        .limit(500);
      if (error) throw error;
      return (data || []) as Consultant[];
    },
  });

  return (
    <div className="space-y-4">
      {canPickConsultant && (
        <div className="flex items-center gap-2 flex-wrap">
          <label className="text-xs text-muted-foreground uppercase tracking-wide">Consultor</label>
          {isLoading ? (
            <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
              <Loader2 className="w-3 h-3 animate-spin" /> carregando…
            </span>
          ) : (
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
          )}
        </div>
      )}
      <CarteiraGreenPanel consultantId={selectedId} />
    </div>
  );
}
