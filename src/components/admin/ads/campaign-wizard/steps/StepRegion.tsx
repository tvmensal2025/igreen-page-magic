/**
 * StepRegion — Step 1: região (foco na CIDADE; distribuidora vira só aviso).
 * O consultor busca a cidade e a tela avisa a qual distribuidora ela pertence
 * (e o bônus). NÃO existe mais "adicionar distribuidora inteira" — cada cidade
 * é adicionada individualmente, mantendo a lista limpa.
 */
import { useMemo } from "react";
import { MapPin, Target, Search, TrendingUp, X, Check, Plus, RefreshCw } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ResponsiveContainer, BarChart, Bar, XAxis, Cell } from "recharts";
import { AddressRadiusPicker } from "../../AddressRadiusPicker";
import { findDistribuidoraForCity } from "@/data/distribuidoraPresets";
import { dddsFromCampaignGeo } from "@/lib/cityToDdd";
import type { CityHit } from "@/services/facebookAds";
import type { WizardState } from "../hooks/useWizardState";
import type { useRegionLogic } from "../hooks/useRegionLogic";

interface Props {
  state: WizardState;
  patch: (p: Partial<WizardState>) => void;
  region: ReturnType<typeof useRegionLogic>;
}

const TIER_LABEL: Record<string, string> = { alto: "🟢 Bônus alto", medio: "🟡 Bônus médio", sem_bonus: "⚪ Sem bônus" };

export function StepRegion({ state, patch, region }: Props) {
  const reach = state.liveReach;
  const reachPct = reach ? Math.min(100, Math.round((reach.upper / 5_000_000) * 100)) : 0;
  const reachColor = !reach
    ? "hsl(var(--ads-muted))"
    : reach.lower < 50000 || reach.upper > 5_000_000
      ? "hsl(var(--destructive))"
      : "hsl(var(--primary))";
  const chartData = [{ name: "alcance", v: Math.max(4, reachPct) }];

  const inferredDdds = useMemo(
    () =>
      dddsFromCampaignGeo({
        cities: state.geoMode === "cities" ? state.cities : [],
        addresses:
          state.geoMode === "radius"
            ? state.radiusPoints.map((p) => p.address_string || p.name || "")
            : [],
      }),
    [state.geoMode, state.cities, state.radiusPoints],
  );

  function setRemarketing(on: boolean) {
    const nextPrefix = on
      ? (state.namePrefix.trim() ? state.namePrefix : "remarketing")
      : state.namePrefix.trim().toLowerCase() === "remarketing"
        ? ""
        : state.namePrefix;
    patch({ isRemarketing: on, namePrefix: nextPrefix });
  }

  return (
    <div className="space-y-4">
      {/* Objetivo: captação vs remarketing (DDDs automáticos) */}
      <div className="rounded-xl border border-[hsl(var(--ads-border))] bg-[hsl(var(--ads-surface))] p-3 space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-[hsl(var(--ads-text))] flex items-center gap-1.5">
              <RefreshCw className="w-3.5 h-3.5 text-[hsl(var(--ads-emerald))]" />
              Esta campanha é remarketing?
            </div>
            <p className="text-[11px] text-[hsl(var(--ads-muted))] mt-1 leading-relaxed">
              Ligado: o sistema reconhece as cidades (e vizinhas) e sobe só os DDDs certos
              na Custom Audience — sem misturar telefone de longe (ex.: 19).
            </p>
          </div>
          <Switch
            checked={state.isRemarketing}
            onCheckedChange={setRemarketing}
            aria-label="Marcar como remarketing"
          />
        </div>
        {state.isRemarketing && (
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <span className="text-[10px] text-[hsl(var(--ads-muted))]">DDDs que entram automaticamente:</span>
            {inferredDdds.length === 0 ? (
              <span className="text-[10px] text-amber-600">Escolha a cidade abaixo para detectar o DDD</span>
            ) : (
              inferredDdds.map((d) => (
                <Badge key={d} variant="secondary" className="text-[10px] px-1.5 py-0">
                  {d}
                </Badge>
              ))
            )}
          </div>
        )}
      </div>

      {/* Modo de geo */}
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={() => patch({ geoMode: "cities" })}
          className={`ads-select-card ${state.geoMode === "cities" ? "is-active" : ""}`}>
          <div className="font-semibold text-sm flex items-center gap-1.5 text-[hsl(var(--ads-text))]">
            {state.geoMode === "cities" && <Check className="w-3.5 h-3.5 text-[hsl(var(--ads-emerald))]" />}
            <MapPin className="w-3.5 h-3.5" /> Cidades
          </div>
          <div className="text-[11px] text-[hsl(var(--ads-muted))] mt-1">Busque a cidade — avisamos a distribuidora.</div>
        </button>
        <button type="button" onClick={() => patch({ geoMode: "radius" })}
          className={`ads-select-card ${state.geoMode === "radius" ? "is-active" : ""}`}>
          <div className="font-semibold text-sm flex items-center gap-1.5 text-[hsl(var(--ads-text))]">
            {state.geoMode === "radius" && <Check className="w-3.5 h-3.5 text-[hsl(var(--ads-emerald))]" />}
            <Target className="w-3.5 h-3.5" /> Endereço + raio
          </div>
          <div className="text-[11px] text-[hsl(var(--ads-muted))] mt-1">Anuncie a 1–50 km de um ponto.</div>
        </button>
      </div>

      {state.geoMode === "radius" ? (
        <AddressRadiusPicker value={state.radiusPoints} onChange={(v) => patch({ radiusPoints: v })} />
      ) : (
        <>
          {/* Busca de cidade — interação principal */}
          <div>
            <Label className="text-sm flex items-center gap-1.5 text-[hsl(var(--ads-text))]">
              <Search className="w-3.5 h-3.5 text-[hsl(var(--ads-emerald))]" /> Onde quer anunciar?
              <span className="text-[hsl(var(--ads-muted))] font-normal">({state.cities.length}/2 cidades · 1 é o ideal)</span>
            </Label>
            <div className="relative mt-1.5">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[hsl(var(--ads-muted))]" />
              <Input className="pl-9 bg-[hsl(var(--ads-surface))] border-[hsl(var(--ads-border))] text-[hsl(var(--ads-text))]"
                placeholder="Digite a cidade: São Paulo, Campinas, Belo Horizonte..."
                value={state.search} onChange={(e) => patch({ search: e.target.value })} />
            </div>
            {state.searchLoading && <div className="text-xs text-[hsl(var(--ads-muted))] mt-1">Buscando...</div>}
            {state.hits.length > 0 && (
              <div className="border border-[hsl(var(--ads-border))] rounded-lg divide-y divide-[hsl(var(--ads-border))] mt-1.5 max-h-60 overflow-y-auto bg-[hsl(var(--ads-surface))]">
                {state.hits.map((h) => <CityHitRow key={h.key} hit={h} onAdd={() => region.addCity(h)} />)}
              </div>
            )}
            {!state.searchLoading && state.search.trim().length >= 2 && state.hits.length === 0 && (
              <div className="text-xs text-[hsl(var(--ads-muted))] mt-1.5">Nenhuma cidade encontrada para "{state.search}".</div>
            )}
          </div>

          {/* Cidades selecionadas — chips com aviso de distribuidora */}
          {state.cities.length > 0 && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <div className="text-[11px] uppercase tracking-wide text-[hsl(var(--ads-muted))]">Cidades selecionadas</div>
                <button type="button" onClick={region.clearAllCities} className="text-[11px] text-[hsl(var(--ads-muted))] hover:text-destructive underline underline-offset-2">Limpar tudo</button>
              </div>
              <div className="flex flex-wrap gap-1.5 max-h-44 overflow-y-auto">
                {state.cities.map((c) => {
                  const dist = findDistribuidoraForCity(c.name);
                  return (
                    <Badge key={c.key} variant="secondary"
                      className="gap-1.5 py-1 px-2 text-xs bg-[hsl(var(--ads-emerald)/.1)] text-[hsl(var(--ads-emerald-2))] border border-[hsl(var(--ads-emerald)/.2)]">
                      {c.name}
                      {dist && <span className="text-[9px]" title={`${dist.nome} · ${dist.bonusLabel}`}>{TIER_LABEL[dist.tier].slice(0, 2)}</span>}
                      <button onClick={() => region.removeCityKey(c.key)} className="hover:text-destructive"><X className="w-3 h-3" /></button>
                    </Badge>
                  );
                })}
              </div>
            </div>
          )}

          {/* Alcance estimado com barra visual */}
          {(reach || state.liveReachLoading) && (
            <div className="rounded-lg border border-[hsl(var(--ads-border))] bg-[hsl(var(--ads-emerald)/.05)] p-3">
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-[hsl(var(--ads-muted))] flex items-center gap-1.5">
                  <TrendingUp className="w-3.5 h-3.5" /> Alcance estimado
                </span>
                {reach && <strong className="text-[hsl(var(--ads-text))]">{reach.lower.toLocaleString("pt-BR")}–{reach.upper.toLocaleString("pt-BR")}</strong>}
              </div>
              <div className="h-8">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} layout="vertical" margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                    <XAxis type="number" domain={[0, 100]} hide />
                    <Bar dataKey="v" radius={4} background={{ fill: "hsl(var(--ads-border))" }}>
                      <Cell fill={reachColor} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              {reach && reach.lower < 50000 && <div className="text-[11px] text-destructive mt-1">⚠ Público pequeno — adicione mais cidades.</div>}
              {reach && reach.upper > 5_000_000 && <div className="text-[11px] text-destructive mt-1">⚠ Muito amplo — considere dividir em 2 campanhas.</div>}
            </div>
          )}

          <div className="text-xs text-[hsl(var(--ads-muted))]">
            ✨ Pré-configurado: idade 25-65, Advantage+ Audience ON, posicionamentos automáticos FB+IG, objetivo Mensagens (WhatsApp).
          </div>
        </>
      )}
    </div>
  );
}

/** Linha de resultado da busca: nome + região + aviso de distribuidora/bônus. */
function CityHitRow({ hit, onAdd }: { hit: CityHit; onAdd: () => void }) {
  const dist = findDistribuidoraForCity(hit.name);
  return (
    <button type="button" onClick={onAdd}
      className="w-full text-left px-3 py-2 hover:bg-[hsl(var(--ads-emerald)/.08)] text-sm flex items-center gap-2 text-[hsl(var(--ads-text))]">
      <MapPin className="w-3.5 h-3.5 text-[hsl(var(--ads-emerald))] shrink-0" />
      <span className="font-medium">{hit.name}</span>
      <span className="text-[hsl(var(--ads-muted))] text-xs">{hit.region}</span>
      {dist && (
        <span className="ml-auto text-[10px] text-[hsl(var(--ads-emerald-2))] shrink-0" title={`Bônus: ${dist.bonusLabel}`}>
          {TIER_LABEL[dist.tier]} · {dist.nome}
        </span>
      )}
      <Plus className={`w-3.5 h-3.5 text-[hsl(var(--ads-muted))] shrink-0 ${dist ? "" : "ml-auto"}`} />
    </button>
  );
}
