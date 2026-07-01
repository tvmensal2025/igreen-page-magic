// Painel de rede: onboarding, inativos e ranking de expansão.
// Lê dos JSONs capturados em `igreen_consultant_metrics` (novos endpoints do painel).
import { useQuery } from "@tanstack/react-query";
import { Users, UserMinus, TrendingUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type J = Record<string, unknown> | null;
type Item = Record<string, unknown>;

function extractList(json: J): Item[] {
  if (!json) return [];
  if (Array.isArray(json)) return json as Item[];
  if (Array.isArray((json as { items?: unknown[] }).items)) return (json as { items: Item[] }).items;
  if (Array.isArray((json as { data?: unknown[] }).data)) return (json as { data: Item[] }).data;
  return [];
}

function firstStr(it: Item, keys: string[]): string {
  for (const k of keys) {
    const v = it[k];
    if (typeof v === "string" && v.trim()) return v;
    if (typeof v === "number") return String(v);
  }
  return "";
}

export function RedeDashboardCard({ consultantId }: { consultantId: string }) {
  const mes = new Date().toISOString().slice(0, 7);
  const { data } = useQuery({
    queryKey: ["igreen-rede-painel", consultantId, mes],
    enabled: !!consultantId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("igreen_consultant_metrics" as never)
        .select("painel_onboarding_json, painel_inativos_json, painel_ranking_json")
        .eq("consultant_id", consultantId)
        .eq("mes_ref", mes)
        .maybeSingle();
      if (error) throw error;
      return data as {
        painel_onboarding_json: J;
        painel_inativos_json: J;
        painel_ranking_json: J;
      } | null;
    },
  });

  if (!data) return null;
  const onboarding = extractList(data.painel_onboarding_json);
  const inativos = extractList(data.painel_inativos_json);
  const ranking = extractList(
    (data.painel_ranking_json as Record<string, J> | null)?.top_expansao ?? data.painel_ranking_json,
  );

  if (!onboarding.length && !inativos.length && !ranking.length) return null;

  return (
    <section className="rounded-xl border border-border/60 bg-card p-4">
      <h3 className="text-sm font-semibold mb-3">Painel da rede · {mes}</h3>
      <div className="grid gap-3 md:grid-cols-3">
        <Block icon={Users} title="Novos em onboarding" items={onboarding.slice(0, 8)} nameKeys={["nome", "name", "consultor"]} subKeys={["dataAtivo", "data_ativo", "cidade"]} />
        <Block icon={UserMinus} title="Licenciados inativos" items={inativos.slice(0, 8)} nameKeys={["nome", "name", "consultor"]} subKeys={["motivo", "diasInativo", "cidade"]} />
        <Block icon={TrendingUp} title="Top expansão" items={ranking.slice(0, 8)} nameKeys={["nome", "name", "consultor"]} subKeys={["gp", "gi", "movimento"]} />
      </div>
    </section>
  );
}

function Block({
  icon: Icon,
  title,
  items,
  nameKeys,
  subKeys,
}: {
  icon: typeof Users;
  title: string;
  items: Item[];
  nameKeys: string[];
  subKeys: string[];
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-background/40 p-3">
      <div className="flex items-center gap-2 mb-2">
        <Icon className="h-4 w-4 text-primary" />
        <p className="text-xs font-semibold">{title}</p>
        <span className="text-[10px] text-muted-foreground ml-auto">{items.length}</span>
      </div>
      {items.length === 0 ? (
        <p className="text-[11px] text-muted-foreground italic">Sem dados</p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((it, i) => {
            const nome = firstStr(it, nameKeys) || `Item ${i + 1}`;
            const sub = subKeys.map((k) => firstStr(it, [k])).filter(Boolean).join(" · ");
            return (
              <li key={i} className="text-[11px]">
                <p className="font-medium truncate">{nome}</p>
                {sub && <p className="text-muted-foreground truncate">{sub}</p>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
