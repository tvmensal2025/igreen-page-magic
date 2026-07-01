// Painel de rotinas: transforma os JSONs de rotina_diaria/semanal/mensal
// em cards de tarefas acionáveis (aniversariantes, esfriando, licenças expirando, etc).
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarClock, ChevronDown, ChevronRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type J = Record<string, unknown> | null;

function extractLists(json: J): Array<{ label: string; items: unknown[] }> {
  if (!json || typeof json !== "object") return [];
  const out: Array<{ label: string; items: unknown[] }> = [];
  for (const [key, val] of Object.entries(json as Record<string, unknown>)) {
    if (Array.isArray(val)) out.push({ label: humanize(key), items: val });
    else if (val && typeof val === "object" && Array.isArray((val as { items?: unknown[] }).items)) {
      out.push({ label: humanize(key), items: (val as { items: unknown[] }).items });
    }
  }
  return out;
}

function humanize(k: string): string {
  return k
    .replace(/[_-]/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function itemLabel(it: unknown): string {
  if (typeof it === "string") return it;
  if (!it || typeof it !== "object") return String(it);
  const o = it as Record<string, unknown>;
  return (
    (o.nome as string) ||
    (o.cliente as string) ||
    (o.consultor as string) ||
    (o.name as string) ||
    JSON.stringify(o).slice(0, 80)
  );
}

export function RotinasPanel({ consultantId }: { consultantId: string }) {
  const mes = new Date().toISOString().slice(0, 7);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const { data } = useQuery({
    queryKey: ["igreen-rotinas", consultantId, mes],
    enabled: !!consultantId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("igreen_consultant_metrics" as never)
        .select("rotina_diaria, rotina_semanal, rotina_mensal")
        .eq("consultant_id", consultantId)
        .eq("mes_ref", mes)
        .maybeSingle();
      if (error) throw error;
      return data as { rotina_diaria: J; rotina_semanal: J; rotina_mensal: J } | null;
    },
  });

  if (!data) return null;
  const groups = [
    { key: "diaria", title: "Rotina diária", lists: extractLists(data.rotina_diaria) },
    { key: "semanal", title: "Rotina semanal", lists: extractLists(data.rotina_semanal) },
    { key: "mensal", title: "Rotina mensal", lists: extractLists(data.rotina_mensal) },
  ].filter((g) => g.lists.length > 0);

  if (groups.length === 0) return null;

  return (
    <section className="rounded-xl border border-border/60 bg-card p-4">
      <div className="flex items-center gap-2 mb-3">
        <CalendarClock className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">Tarefas da rotina</h3>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {groups.map((g) => (
          <div key={g.key} className="rounded-lg border border-border/60 bg-background/40 p-3">
            <p className="text-xs font-semibold mb-2">{g.title}</p>
            <ul className="space-y-1">
              {g.lists.map((l) => {
                const key = `${g.key}:${l.label}`;
                const open = openKey === key;
                return (
                  <li key={key}>
                    <button
                      type="button"
                      onClick={() => setOpenKey(open ? null : key)}
                      className="w-full text-left flex items-center justify-between gap-2 text-[11px] px-2 py-1 rounded hover:bg-muted/40"
                    >
                      <span className="flex items-center gap-1">
                        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                        {l.label}
                      </span>
                      <span className="text-muted-foreground tabular-nums">{l.items.length}</span>
                    </button>
                    {open && (
                      <ul className="mt-1 ml-4 space-y-0.5 max-h-40 overflow-y-auto">
                        {l.items.slice(0, 30).map((it, i) => (
                          <li key={i} className="text-[10.5px] text-muted-foreground truncate">
                            · {itemLabel(it)}
                          </li>
                        ))}
                        {l.items.length > 30 && (
                          <li className="text-[10px] italic text-muted-foreground">
                            +{l.items.length - 30} restantes
                          </li>
                        )}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
