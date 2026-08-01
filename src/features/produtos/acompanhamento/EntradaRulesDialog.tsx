// =============================================================================
// Acompanhamento — Editor de regras de entrada Green
// =============================================================================
// O consultor configura, POR DISTRIBUIDORA, as faixas "a partir de N pessoas
// validadas → X% de entrada (parcela agora + parcela depois)". Também escolhe
// se a contagem das faixas é SOMADA (todas as distribuidoras) ou INDIVIDUAL.
// As regras são recorrentes: valem até o consultor editar.
//
// Tabela oficial Jul/2026: `oficialEntradaTabela.ts` + botão “Aplicar tabela”.
// =============================================================================

import { useMemo, useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, SlidersHorizontal, Layers, Building2, Sparkles } from "lucide-react";
import { toast } from "@/components/ui/sonner";
import { DISTRIBUIDORAS_POR_UF } from "@/lib/captacao/distribuidoras";
import {
  ENTRADA_BONUS_TIER_META,
} from "@/data/entradaBonusTiers";
import {
  OFICIAL_ENTRADA_ALTO,
  OFICIAL_ENTRADA_MEDIO,
} from "@/data/oficialEntradaTabela";
import {
  useEntradaRules,
  useSaveCountMode,
  useUpsertEntradaRule,
  useDeleteEntradaRule,
  useGreenSettings,
  useSeedOfficialEntradaRules,
} from "./greenHooks";
import type { CountMode } from "./greenCommission";
import type { EntradaRuleRow } from "./greenData";

const ALL_DISTRIBUIDORAS: string[] = Array.from(
  new Set(Object.values(DISTRIBUIDORAS_POR_UF).flat()),
).sort((a, b) => a.localeCompare(b));

interface Props {
  consultantId: string;
  trigger?: React.ReactNode;
}

export function EntradaRulesDialog({ consultantId, trigger }: Props) {
  const [open, setOpen] = useState(false);
  const { data: settings } = useGreenSettings(consultantId);
  const { data: rules = [] } = useEntradaRules(consultantId);
  const saveMode = useSaveCountMode(consultantId);
  const upsert = useUpsertEntradaRule(consultantId);
  const remove = useDeleteEntradaRule(consultantId);
  const seedOfficial = useSeedOfficialEntradaRules(consultantId);

  const [distribuidora, setDistribuidora] = useState<string>("");
  const [minPessoas, setMinPessoas] = useState<string>("");
  const [pctImediato, setPctImediato] = useState<string>("");
  const [pctDiferido, setPctDiferido] = useState<string>("");
  const [diasDiferido, setDiasDiferido] = useState<string>("90");

  const countMode: CountMode = settings?.countMode ?? "somado";

  const grouped = useMemo(() => {
    const map = new Map<string, EntradaRuleRow[]>();
    for (const r of rules) {
      const list = map.get(r.distribuidora) || [];
      list.push(r);
      map.set(r.distribuidora, list);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [rules]);

  function resetForm() {
    setDistribuidora("");
    setMinPessoas("");
    setPctImediato("");
    setPctDiferido("");
    setDiasDiferido("90");
  }

  async function handleAdd() {
    if (!distribuidora) { toast.error("Escolha a distribuidora."); return; }
    const min = parseInt(minPessoas, 10);
    const imediato = parseFloat(pctImediato.replace(",", "."));
    const diferido = parseFloat(pctDiferido.replace(",", "."));
    const dias = parseInt(diasDiferido, 10);
    if (!Number.isFinite(min) || min < 0) { toast.error("Informe a quantidade de pessoas (a partir de)."); return; }
    if (!Number.isFinite(imediato) || imediato < 0) { toast.error("Informe a % imediata."); return; }
    if (!Number.isFinite(diferido) || diferido < 0) { toast.error("Informe a % diferida."); return; }

    try {
      await upsert.mutateAsync({
        distribuidora,
        minPessoas: min,
        entradaTotalPct: imediato + diferido,
        pctImediato: imediato,
        pctDiferido: diferido,
        diasDiferido: Number.isFinite(dias) ? dias : 90,
      });
      toast.success("Faixa salva.");
      resetForm();
    } catch (e: any) {
      toast.error("Erro ao salvar: " + (e?.message || String(e)));
    }
  }

  async function handleDelete(r: EntradaRuleRow) {
    try {
      await remove.mutateAsync(r.id);
      toast.success("Faixa removida.");
    } catch (e: any) {
      toast.error("Erro ao remover: " + (e?.message || String(e)));
    }
  }

  async function handleModeChange(mode: CountMode) {
    try {
      await saveMode.mutateAsync(mode);
    } catch (e: any) {
      toast.error("Erro ao salvar modo: " + (e?.message || String(e)));
    }
  }

  async function handleSeedOfficial() {
    try {
      const n = await seedOfficial.mutateAsync();
      toast.success(`Tabela oficial aplicada (${n} faixas). Você pode editar qualquer uma.`);
    } catch (e: any) {
      toast.error("Erro ao aplicar tabela: " + (e?.message || String(e)));
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="outline" size="sm" className="gap-2 rounded-xl">
            <SlidersHorizontal className="w-4 h-4" />
            Regras de entrada
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="w-5 h-5 text-primary" />
            Bônus de entrada · cidades e faixas
          </DialogTitle>
          <DialogDescription>
            Tabela oficial Conexão Green (Jul/2026). Aplique no seu painel e edite por distribuidora.
            Entrada = % da fatura (agora + na injeção).
          </DialogDescription>
        </DialogHeader>

        {/* Tabela oficial (referência + seed) */}
        <div className="rounded-xl border border-primary/25 bg-primary/5 p-3 space-y-3">
          <div className="flex items-start justify-between gap-2 flex-wrap">
            <div>
              <p className="text-xs font-semibold text-foreground">Tabela oficial · Julho 2026</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Validada contra a arte comercial. Clique em aplicar para gravar nas suas regras.
              </p>
            </div>
            <Button
              size="sm"
              variant="default"
              className="gap-1.5 shrink-0"
              onClick={handleSeedOfficial}
              disabled={seedOfficial.isPending}
            >
              <Sparkles className="w-3.5 h-3.5" />
              {seedOfficial.isPending ? "Aplicando…" : "Aplicar tabela oficial"}
            </Button>
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <div className="rounded-lg border border-border/60 bg-card/60 p-2.5 space-y-1.5">
              <p className="text-[11px] font-semibold text-foreground">{ENTRADA_BONUS_TIER_META.alto.title}</p>
              <ul className="text-[10px] text-muted-foreground space-y-0.5 list-disc pl-3.5">
                {ENTRADA_BONUS_TIER_META.alto.faixas.map((f) => (
                  <li key={f.label}>{f.label}</li>
                ))}
              </ul>
              <p className="text-[10px] text-muted-foreground pt-1 border-t border-border/40">
                {OFICIAL_ENTRADA_ALTO.map((d) => `${d.ufs.join("/")}: ${d.label}`).join(" · ")}
              </p>
            </div>
            <div className="rounded-lg border border-border/60 bg-card/60 p-2.5 space-y-1.5">
              <p className="text-[11px] font-semibold text-foreground">{ENTRADA_BONUS_TIER_META.medio.title}</p>
              <ul className="text-[10px] text-muted-foreground space-y-0.5 list-disc pl-3.5">
                {ENTRADA_BONUS_TIER_META.medio.faixas.map((f) => (
                  <li key={f.label}>{f.label}</li>
                ))}
              </ul>
              <p className="text-[10px] text-muted-foreground pt-1 border-t border-border/40">
                {OFICIAL_ENTRADA_MEDIO.map((d) => `${d.ufs.join("/")}: ${d.label}`).join(" · ")}
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-border/60 p-3 space-y-2">
          <Label className="text-xs text-muted-foreground">Como contar as pessoas para destravar a faixa</Label>
          <div className="inline-flex rounded-lg border border-border p-0.5 bg-muted/40">
            <button
              type="button"
              onClick={() => handleModeChange("somado")}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors flex items-center gap-1.5 ${
                countMode === "somado" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Layers className="w-3.5 h-3.5" /> Somar distribuidoras
            </button>
            <button
              type="button"
              onClick={() => handleModeChange("individual")}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors flex items-center gap-1.5 ${
                countMode === "individual" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Building2 className="w-3.5 h-3.5" /> Individual por distribuidora
            </button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            {countMode === "somado"
              ? "Ex.: 5 Cemig + 5 CPFL = 10 pessoas → destrava a faixa de 10 em ambas."
              : "Ex.: precisa atingir a faixa dentro de uma única distribuidora (5 Cemig não destrava a faixa de 10)."}
          </p>
        </div>

        <div className="space-y-3">
          <p className="text-xs font-semibold text-foreground">Suas faixas (editáveis)</p>
          {grouped.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-4">
              Nenhuma faixa ainda. Aplique a tabela oficial ou adicione abaixo.
            </p>
          ) : (
            grouped.map(([dist, list]) => (
              <div key={dist} className="rounded-xl border border-border/60 overflow-hidden">
                <div className="px-3 py-2 border-b border-border/50 bg-muted/30 flex items-center gap-2">
                  <Building2 className="w-3.5 h-3.5 text-primary" />
                  <span className="text-xs font-semibold text-foreground">{dist}</span>
                </div>
                <div className="divide-y divide-border/40">
                  {list.map((r) => (
                    <div key={r.id} className="flex items-center justify-between px-3 py-2 gap-2">
                      <div className="flex items-center gap-2 flex-wrap text-xs">
                        <Badge variant="secondary" className="text-[10px]">A partir de {r.minPessoas}</Badge>
                        <span className="font-semibold text-foreground">{r.entradaTotalPct}%</span>
                        <span className="text-muted-foreground">
                          ({r.pctImediato}% agora + {r.pctDiferido}% em {r.diasDiferido}d)
                        </span>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive hover:bg-destructive/10"
                        onClick={() => handleDelete(r)}
                        disabled={remove.isPending}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>

        <div className="rounded-xl border border-dashed border-border p-3 space-y-3">
          <div className="text-xs font-semibold text-foreground flex items-center gap-1.5">
            <Plus className="w-3.5 h-3.5" /> Adicionar / ajustar faixa
          </div>
          <div className="space-y-1.5">
            <Label className="text-[11px] text-muted-foreground">Distribuidora</Label>
            <Select value={distribuidora} onValueChange={setDistribuidora}>
              <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Escolha a distribuidora" /></SelectTrigger>
              <SelectContent className="max-h-64">
                {ALL_DISTRIBUIDORAS.map((d) => (
                  <SelectItem key={d} value={d}>{d}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div className="space-y-1.5">
              <Label className="text-[11px] text-muted-foreground">A partir de (pessoas)</Label>
              <Input type="number" min={0} value={minPessoas} onChange={(e) => setMinPessoas(e.target.value)} placeholder="10" className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11px] text-muted-foreground">% agora</Label>
              <Input type="number" min={0} step="0.5" value={pctImediato} onChange={(e) => setPctImediato(e.target.value)} placeholder="10" className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11px] text-muted-foreground">% depois</Label>
              <Input type="number" min={0} step="0.5" value={pctDiferido} onChange={(e) => setPctDiferido(e.target.value)} placeholder="10" className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11px] text-muted-foreground">Dias p/ 2ª parcela</Label>
              <Input type="number" min={0} value={diasDiferido} onChange={(e) => setDiasDiferido(e.target.value)} placeholder="90" className="h-9" />
            </div>
          </div>
          <div className="flex items-center justify-between">
            <p className="text-[11px] text-muted-foreground">
              Total da faixa: <span className="font-semibold text-foreground">
                {(parseFloat(pctImediato.replace(",", ".")) || 0) + (parseFloat(pctDiferido.replace(",", ".")) || 0)}%
              </span>
            </p>
            <Button size="sm" onClick={handleAdd} disabled={upsert.isPending} className="gap-1.5">
              <Plus className="w-3.5 h-3.5" /> {upsert.isPending ? "Salvando…" : "Salvar faixa"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
