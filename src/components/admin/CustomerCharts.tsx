import { useEffect, useMemo, useState } from "react";
import { Trophy, ScanFace, TrendingUp, MessageCircle, Trash2, Plus, Percent } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ReheatCyclePizza } from "@/components/admin/ReheatCyclePizza";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Combobox } from "@/components/ui/combobox";
import { normalizeBrazilPhone, validateBrazilPhone } from "@/lib/phone";
import { useEntradaRules, useGreenSettings } from "@/features/produtos/acompanhamento/greenHooks";
import {
  resolveEntradaTier,
  type CountMode,
  type EntradaRule,
} from "@/features/produtos/acompanhamento/greenCommission";

interface FunnelPerson {
  id: string;
  name: string;
  phone: string;
  status: string;
  valor: number;
  distribuidora?: string;
}

interface PeriodSlice {
  count: number;
  valor: number;
  cadastros?: number;
  faltaFacial?: number;
  ganhosPeople?: FunnelPerson[];
  faltaPeople?: FunnelPerson[];
  cadastrosPeople?: FunnelPerson[];
}

interface CustomerMetrics {
  totalCustomers: number;
  totalKw: number;
  avgKw: number;
  valorFechado?: number;
  fechamentosCount?: number;
  fechamentosDia?: PeriodSlice;
  fechamentosSemana?: PeriodSlice;
  fechamentosMes?: PeriodSlice;
  faltaFacialAberta?: number;
  faltaFacialPeople?: FunnelPerson[];
  funnelCandidates?: FunnelPerson[];
  customersByStatus: { status: string; count: number; label: string }[];
  weeklyNewCustomers: { week: string; count: number }[];
}

interface LicenciadoData {
  name: string;
  deals: number;
}

interface CustomerChartsProps {
  filteredMetrics: CustomerMetrics | null;
  topLicenciados?: LicenciadoData[];
  consultantId?: string;
  onOpenChat?: (phone: string, suggestedMessage?: string) => void;
}

type SliceKind = "ganhos" | "faltaFacial" | "cadastros";

interface SlicePick {
  periodo: string;
  kind: SliceKind;
  people: FunnelPerson[];
  valor: number;
}

interface GanhosOverrides {
  excluded: string[];
  /** Manuais por período (Hoje | Semana | Mês | Agora) */
  manualByPeriod: Record<string, FunnelPerson[]>;
  pctById: Record<string, number>;
}

function formatCompactBRL(value: number): string {
  if (!value) return "R$ 0";
  if (value >= 1_000_000) return `R$ ${(value / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi`;
  if (value >= 10_000) return `R$ ${(value / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`;
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}

const COLOR_GANHO = "hsl(152 100% 33%)";
const COLOR_PENDENTE = "hsl(38 92% 50%)";

const KIND_LABEL: Record<SliceKind, string> = {
  ganhos: "Ganhos",
  faltaFacial: "Falta facial",
  cadastros: "Cadastros",
};

const EMPTY_OVERRIDES: GanhosOverrides = { excluded: [], manualByPeriod: {}, pctById: {} };

function overridesKey(consultantId?: string) {
  return `funnel-ganhos-overrides:${consultantId || "anon"}`;
}

function loadOverrides(consultantId?: string): GanhosOverrides {
  try {
    const raw = localStorage.getItem(overridesKey(consultantId));
    if (!raw) return { ...EMPTY_OVERRIDES, manualByPeriod: {}, pctById: {} };
    const parsed = JSON.parse(raw) as GanhosOverrides;
    return {
      excluded: Array.isArray(parsed.excluded) ? parsed.excluded : [],
      manualByPeriod: parsed.manualByPeriod && typeof parsed.manualByPeriod === "object" ? parsed.manualByPeriod : {},
      pctById: parsed.pctById && typeof parsed.pctById === "object" ? parsed.pctById : {},
    };
  } catch {
    return { ...EMPTY_OVERRIDES, manualByPeriod: {}, pctById: {} };
  }
}

function saveOverrides(consultantId: string | undefined, next: GanhosOverrides) {
  try {
    localStorage.setItem(overridesKey(consultantId), JSON.stringify(next));
  } catch {
    /* noop */
  }
}

function isCadastradoStatus(status: string): boolean {
  const s = (status || "").toLowerCase();
  return (
    s === "registered_igreen" ||
    s === "approved" ||
    s === "complete" ||
    s === "cadastro_concluido" ||
    s === "ganho"
  );
}

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  return (
    <div className="rounded-xl border border-border bg-popover px-3.5 py-2.5 text-xs shadow-lg min-w-[180px]">
      <p className="font-semibold text-foreground mb-2">{label}</p>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-6">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <span className="w-2 h-2 rounded-full" style={{ background: COLOR_GANHO }} />
            Ganhos
          </span>
          <span className="font-semibold tabular-nums text-foreground">{row?.ganhos ?? 0}</span>
        </div>
        <div className="flex items-center justify-between gap-6">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <span className="w-2 h-2 rounded-full" style={{ background: COLOR_PENDENTE }} />
            Falta facial
          </span>
          <span className="font-semibold tabular-nums text-foreground">{row?.faltaFacial ?? 0}</span>
        </div>
        <div className="pt-1.5 mt-1 border-t border-border/60 flex items-center justify-between gap-6">
          <span className="text-muted-foreground">Cadastros</span>
          <span className="font-semibold tabular-nums text-foreground">{row?.cadastros ?? 0}</span>
        </div>
        <div className="flex items-center justify-between gap-6">
          <span className="text-muted-foreground">Valor</span>
          <span className="font-semibold tabular-nums text-foreground">{formatCompactBRL(row?.valor ?? 0)}</span>
        </div>
        <p className="text-[10px] text-muted-foreground pt-1">Clique na barra pra ver quem é</p>
      </div>
    </div>
  );
}

export function CustomerCharts({ filteredMetrics, topLicenciados, consultantId, onOpenChat }: CustomerChartsProps) {
  const [slicePick, setSlicePick] = useState<SlicePick | null>(null);
  const [overrides, setOverrides] = useState<GanhosOverrides>(() => loadOverrides(consultantId));
  const [addId, setAddId] = useState("");

  const { data: entradaRules = [] } = useEntradaRules(consultantId);
  const { data: greenSettings } = useGreenSettings(consultantId);
  const countMode: CountMode = greenSettings?.countMode ?? "somado";

  useEffect(() => {
    setOverrides(loadOverrides(consultantId));
  }, [consultantId]);

  const patchOverrides = (fn: (prev: GanhosOverrides) => GanhosOverrides) => {
    setOverrides((prev) => {
      const next = fn(prev);
      saveOverrides(consultantId, next);
      return next;
    });
  };

  const licenciadosData = topLicenciados ?? [];
  const maxDeals = licenciadosData.reduce((m, l) => Math.max(m, l.deals), 0) || 1;

  const dia = filteredMetrics?.fechamentosDia ?? { count: 0, valor: 0, cadastros: 0, faltaFacial: 0 };
  const semana = filteredMetrics?.fechamentosSemana ?? { count: 0, valor: 0, cadastros: 0, faltaFacial: 0 };
  const mes = filteredMetrics?.fechamentosMes ?? { count: 0, valor: 0, cadastros: 0, faltaFacial: 0 };
  const faltaFacialAberta = filteredMetrics?.faltaFacialAberta ?? 0;
  const faltaFacialPeopleAgora = filteredMetrics?.faltaFacialPeople ?? [];
  const funnelCandidates = filteredMetrics?.funnelCandidates ?? [];

  const rulesAsEntrada: EntradaRule[] = useMemo(
    () =>
      entradaRules.map((r) => ({
        distribuidora: r.distribuidora,
        minPessoas: r.minPessoas,
        entradaTotalPct: r.entradaTotalPct,
        pctImediato: r.pctImediato,
        pctDiferido: r.pctDiferido,
        diasDiferido: r.diasDiferido,
      })),
    [entradaRules],
  );

  const countsByDistrib = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of [
      ...(dia.ganhosPeople ?? []),
      ...(semana.ganhosPeople ?? []),
      ...(mes.ganhosPeople ?? []),
      ...Object.values(overrides.manualByPeriod).flat(),
    ]) {
      const key = (p.distribuidora || "").trim().toLowerCase();
      if (!key) continue;
      if (overrides.excluded.includes(p.id)) continue;
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return map;
  }, [dia.ganhosPeople, semana.ganhosPeople, mes.ganhosPeople, overrides]);

  const defaultEntradaPct = (p: FunnelPerson): number => {
    const tier = resolveEntradaTier(rulesAsEntrada, p.distribuidora || null, countsByDistrib, countMode);
    if (tier) return tier.entradaTotalPct;
    // Sem faixa atingida: tenta a menor regra da distribuidora só como sugestão visual (0 efetivo)
    const key = (p.distribuidora || "").trim().toLowerCase();
    const first = rulesAsEntrada
      .filter((r) => r.distribuidora.trim().toLowerCase() === key)
      .sort((a, b) => a.minPessoas - b.minPessoas)[0];
    return first?.entradaTotalPct ?? 0;
  };

  const pctOf = (p: FunnelPerson): number => {
    if (overrides.pctById[p.id] != null && Number.isFinite(overrides.pctById[p.id])) {
      return overrides.pctById[p.id];
    }
    return defaultEntradaPct(p);
  };

  const applyGanhosOverrides = (periodo: string, base: FunnelPerson[]): FunnelPerson[] => {
    const excluded = new Set(overrides.excluded);
    const manual = overrides.manualByPeriod[periodo] ?? [];
    const byId = new Map<string, FunnelPerson>();
    for (const p of base) {
      if (excluded.has(p.id)) continue;
      byId.set(p.id, p);
    }
    for (const p of manual) {
      if (excluded.has(p.id)) continue;
      byId.set(p.id, p);
    }
    return Array.from(byId.values());
  };

  const sliceEffective = (label: string, slice: PeriodSlice) => {
    const ganhosPeople = applyGanhosOverrides(label, slice.ganhosPeople ?? []);
    const valor = ganhosPeople.reduce((s, p) => s + (p.valor || 0), 0);
    return {
      ...slice,
      ganhosPeople,
      count: ganhosPeople.length,
      valor,
    };
  };

  const diaE = sliceEffective("Hoje", dia);
  const semanaE = sliceEffective("Semana", semana);
  const mesE = sliceEffective("Mês", mes);

  const kpis = [
    { label: "Hoje", slice: diaE },
    { label: "Semana", slice: semanaE },
    { label: "Mês", slice: mesE },
  ];

  const chartData = kpis.map(({ label, slice }) => ({
    periodo: label,
    ganhos: slice.count,
    faltaFacial: slice.faltaFacial ?? 0,
    cadastros: slice.cadastros ?? 0,
    valor: slice.valor,
    ganhosPeople: slice.ganhosPeople ?? [],
    faltaPeople: slice.faltaPeople ?? [],
    cadastrosPeople: slice.cadastrosPeople ?? [],
  }));

  const openSlice = (periodo: string, kind: SliceKind, people: FunnelPerson[], valor = 0) => {
    setAddId("");
    setSlicePick({ periodo, kind, people, valor });
  };

  const sheetPeople = useMemo(() => {
    if (!slicePick) return [];
    if (slicePick.kind !== "ganhos") return slicePick.people;
    return applyGanhosOverrides(slicePick.periodo, slicePick.people);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slicePick, overrides]);

  const sheetValor = sheetPeople.reduce((s, p) => s + (p.valor || 0), 0);
  const sheetEntrada = sheetPeople.reduce((s, p) => s + (p.valor || 0) * (pctOf(p) / 100), 0);

  const addOptions = useMemo(() => {
    const inSheet = new Set(sheetPeople.map((p) => p.id));
    return funnelCandidates
      .filter((p) => !inSheet.has(p.id) && !overrides.excluded.includes(p.id))
      .map((p) => ({
        value: p.id,
        label: p.name,
        hint: p.phone || p.status || undefined,
      }));
  }, [funnelCandidates, sheetPeople, overrides.excluded]);

  const handleAddManual = () => {
    if (!slicePick || !addId) return;
    const person = funnelCandidates.find((p) => p.id === addId);
    if (!person) return;
    patchOverrides((prev) => {
      const excluded = prev.excluded.filter((id) => id !== person.id);
      const list = [...(prev.manualByPeriod[slicePick.periodo] ?? [])];
      if (!list.some((p) => p.id === person.id)) list.push(person);
      return {
        ...prev,
        excluded,
        manualByPeriod: { ...prev.manualByPeriod, [slicePick.periodo]: list },
      };
    });
    setAddId("");
  };

  const handleRemove = (id: string) => {
    if (!slicePick) return;
    patchOverrides((prev) => {
      const excluded = prev.excluded.includes(id) ? prev.excluded : [...prev.excluded, id];
      const manual = (prev.manualByPeriod[slicePick.periodo] ?? []).filter((p) => p.id !== id);
      return {
        ...prev,
        excluded,
        manualByPeriod: { ...prev.manualByPeriod, [slicePick.periodo]: manual },
      };
    });
  };

  const handlePctChange = (id: string, raw: string) => {
    const n = parseFloat(raw.replace(",", "."));
    patchOverrides((prev) => {
      const pctById = { ...prev.pctById };
      if (!Number.isFinite(n)) {
        delete pctById[id];
      } else {
        pctById[id] = Math.max(0, Math.min(100, n));
      }
      return { ...prev, pctById };
    });
  };

  return (
    <div className="space-y-6">
      <div className="min-w-0">
        <ReheatCyclePizza consultantId={consultantId} admin={!consultantId} onOpenChat={onOpenChat} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="premium-card">
          <h3 className="font-heading font-bold text-foreground mb-1 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-primary" /> Ranking de licenciados
          </h3>
          <p className="text-xs text-muted-foreground mb-4">Top licenciados por contas cadastradas</p>
          {licenciadosData && licenciadosData.length > 0 ? (
            <ol className="space-y-2.5">
              {licenciadosData.slice(0, 10).map((b, idx) => {
                const pct = (b.deals / maxDeals) * 100;
                return (
                  <li key={`${b.name}-${idx}`} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="truncate max-w-[220px] sensitive-name" title={b.name}>
                        <span className="text-muted-foreground mr-1.5">{idx + 1}.</span>
                        {b.name}
                      </span>
                      <span className="font-semibold tabular-nums text-foreground">{b.deals}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <div className="h-full rounded-full bg-primary/80" style={{ width: `${pct}%` }} />
                    </div>
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-8">Nenhum licenciado vinculado ainda</p>
          )}
        </div>

        <div className="premium-card relative overflow-hidden flex flex-col min-h-[380px]">
          <div
            className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full opacity-25"
            style={{ background: "radial-gradient(circle, hsl(var(--primary) / 0.4) 0%, transparent 70%)" }}
            aria-hidden
          />

          <div className="relative flex flex-col flex-1">
            <div className="flex items-start justify-between gap-3 mb-1">
              <div>
                <h3 className="font-heading font-bold text-foreground flex items-center gap-2">
                  <Trophy className="w-4 h-4 text-primary" /> Ganhos do funil
                </h3>
                <p className="text-xs text-muted-foreground mt-1">
                  Cadastros do funil · ganho = Encerrar (Ganho) ou OTP + facial
                </p>
                <p className="text-[10px] text-muted-foreground mt-0.5">Clique na barra ou no card pra ver quem é</p>
              </div>
              <div className="hidden sm:flex items-center gap-3 text-[10px] text-muted-foreground shrink-0 pt-1">
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full" style={{ background: COLOR_GANHO }} />
                  Ganhos
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full" style={{ background: COLOR_PENDENTE }} />
                  Falta facial
                </span>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 sm:gap-3 mt-4 mb-2">
              {kpis.map(({ label, slice }) => (
                <button
                  type="button"
                  key={label}
                  className="rounded-xl border border-border/70 bg-muted/30 px-2.5 sm:px-3 py-2.5 text-left transition hover:border-primary/40 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                  onClick={() =>
                    openSlice(label, "ganhos", slice.ganhosPeople ?? [], slice.valor)
                  }
                  title={`Ver ganhos de ${label}`}
                >
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
                  <p className="font-heading text-xl sm:text-2xl font-bold tabular-nums text-primary leading-tight mt-0.5">
                    {formatCompactBRL(slice.valor)}
                  </p>
                  <p
                    className="text-xs font-semibold tabular-nums text-foreground mt-1 hover:underline"
                    onClick={(e) => {
                      e.stopPropagation();
                      openSlice(label, "cadastros", slice.cadastrosPeople ?? [], 0);
                    }}
                  >
                    {(slice.cadastros ?? 0).toLocaleString("pt-BR")}{" "}
                    {(slice.cadastros ?? 0) === 1 ? "cadastro" : "cadastros"}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5 tabular-nums">
                    {slice.count} {slice.count === 1 ? "ganho" : "ganhos"}
                    {(slice.faltaFacial ?? 0) > 0 ? ` · ${slice.faltaFacial} falta` : ""}
                  </p>
                </button>
              ))}
            </div>

            <div className="flex-1 min-h-[220px] mt-2 -mx-1">
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={chartData} margin={{ top: 8, right: 8, left: -12, bottom: 0 }} barGap={6} barCategoryGap="28%">
                  <defs>
                    <linearGradient id="gGanho" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={COLOR_GANHO} stopOpacity={1} />
                      <stop offset="100%" stopColor={COLOR_GANHO} stopOpacity={0.75} />
                    </linearGradient>
                    <linearGradient id="gPendente" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={COLOR_PENDENTE} stopOpacity={0.95} />
                      <stop offset="100%" stopColor={COLOR_PENDENTE} stopOpacity={0.7} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 6" vertical={false} />
                  <XAxis
                    dataKey="periodo"
                    fontSize={12}
                    tick={{ fill: "hsl(var(--muted-foreground))", fontWeight: 600 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    allowDecimals={false}
                    fontSize={11}
                    tick={{ fill: "hsl(var(--muted-foreground))" }}
                    axisLine={false}
                    tickLine={false}
                    width={28}
                  />
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: "hsl(var(--muted) / 0.45)", radius: 8 }} />
                  <Bar
                    dataKey="ganhos"
                    name="Ganhos"
                    fill="url(#gGanho)"
                    radius={[8, 8, 4, 4]}
                    maxBarSize={42}
                    cursor="pointer"
                    onClick={(data: any) => {
                      const row = data?.payload ?? data;
                      if (!row) return;
                      openSlice(row.periodo, "ganhos", row.ganhosPeople ?? [], row.valor ?? 0);
                    }}
                  />
                  <Bar
                    dataKey="faltaFacial"
                    name="Falta facial"
                    fill="url(#gPendente)"
                    radius={[8, 8, 4, 4]}
                    maxBarSize={42}
                    cursor="pointer"
                    onClick={(data: any) => {
                      const row = data?.payload ?? data;
                      if (!row) return;
                      openSlice(row.periodo, "faltaFacial", row.faltaPeople ?? [], 0);
                    }}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="mt-auto pt-3 border-t border-border/60 flex items-center justify-between gap-2">
              <button
                type="button"
                className="text-[11px] text-muted-foreground flex items-center gap-1.5 hover:text-foreground transition"
                onClick={() => openSlice("Agora", "faltaFacial", faltaFacialPeopleAgora, 0)}
              >
                <ScanFace className="w-3.5 h-3.5 text-warning" />
                Falta facial agora:{" "}
                <span className="font-semibold tabular-nums text-foreground">{faltaFacialAberta}</span>
              </button>
              <p className="text-[10px] text-muted-foreground whitespace-nowrap">Ganho · funil</p>
            </div>
          </div>
        </div>
      </div>

      <Sheet open={!!slicePick} onOpenChange={(open) => !open && setSlicePick(null)}>
        <SheetContent side="right" className="w-full sm:max-w-md flex flex-col">
          <SheetHeader>
            <SheetTitle className="pr-6">
              {slicePick?.periodo} · {slicePick ? KIND_LABEL[slicePick.kind] : ""}
            </SheetTitle>
            <SheetDescription>
              {sheetPeople.length === 1
                ? "1 pessoa nesta fatia"
                : `${sheetPeople.length} pessoas nesta fatia`}
              {slicePick?.kind === "ganhos" && sheetValor > 0
                ? ` · ${formatCompactBRL(sheetValor)}`
                : ""}
              {slicePick?.kind === "ganhos" && sheetEntrada > 0
                ? ` · entrada ${formatCompactBRL(sheetEntrada)}`
                : ""}
            </SheetDescription>
          </SheetHeader>

          {slicePick?.kind === "ganhos" && (
            <div className="mt-3 space-y-2 rounded-lg border border-border/70 bg-muted/20 p-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
                <Plus className="w-3 h-3" /> Adicionar manual
              </p>
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <Combobox
                    options={addOptions}
                    value={addId || null}
                    onChange={(v) => setAddId(v || "")}
                    placeholder="Buscar cadastro…"
                    searchPlaceholder="Nome ou telefone…"
                    emptyText="Nenhum cadastro do funil"
                  />
                </div>
                <Button type="button" size="sm" className="h-9 shrink-0" disabled={!addId} onClick={handleAddManual}>
                  Add
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground">
                % de entrada segue as regras da distribuidora. Você pode alterar por cliente.
              </p>
            </div>
          )}

          <div className="mt-4 flex-1 overflow-y-auto space-y-2 pr-1">
            {sheetPeople.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">Ninguém nesta fatia agora</p>
            ) : (
              sheetPeople.map((p) => {
                const phoneCheck = p.phone ? validateBrazilPhone(p.phone) : { valid: false };
                const canChat = !!onOpenChat && phoneCheck.valid;
                const pct = pctOf(p);
                const entradaValor = (p.valor || 0) * (pct / 100);
                const cadastrado = isCadastradoStatus(p.status);
                const isCustomPct = overrides.pctById[p.id] != null;

                return (
                  <div
                    key={p.id}
                    className={`rounded-lg border px-3 py-2.5 space-y-2 ${
                      !cadastrado && slicePick?.kind === "ganhos"
                        ? "border-amber-500/35 bg-amber-500/5"
                        : "border-border/60 bg-card/50"
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate sensitive-name">
                          {p.name || "Sem nome"}
                        </p>
                        <p className="text-[11px] text-muted-foreground truncate">
                          {p.phone || "Sem WhatsApp"}
                          {p.status ? ` · ${p.status}` : ""}
                          {p.distribuidora ? ` · ${p.distribuidora}` : ""}
                        </p>
                        {!cadastrado && slicePick?.kind === "ganhos" && (
                          <p className="text-[10px] text-amber-700 dark:text-amber-400 mt-0.5">
                            Ainda não cadastrado no portal — pode remover
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {canChat && (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-8 gap-1.5"
                            title="Abrir conversa interna"
                            onClick={() => {
                              if (!p.phone) return;
                              onOpenChat?.(normalizeBrazilPhone(p.phone));
                              setSlicePick(null);
                            }}
                          >
                            <MessageCircle className="w-3.5 h-3.5" />
                          </Button>
                        )}
                        {slicePick?.kind === "ganhos" && (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                            title="Remover desta fatia"
                            onClick={() => handleRemove(p.id)}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        )}
                      </div>
                    </div>

                    {slicePick?.kind === "ganhos" && (
                      <div className="flex items-center gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-[10px] text-muted-foreground tabular-nums">
                            Conta {formatCompactBRL(p.valor)}
                            {pct > 0 ? ` → entrada ${formatCompactBRL(entradaValor)}` : ""}
                          </p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <Percent className="w-3 h-3 text-muted-foreground" />
                          <Input
                            type="number"
                            min={0}
                            max={100}
                            step={0.5}
                            value={Number.isFinite(pct) ? pct : 0}
                            onChange={(e) => handlePctChange(p.id, e.target.value)}
                            className="h-8 w-[72px] text-xs tabular-nums"
                            title={isCustomPct ? "%% customizada" : "%% padrão das regras"}
                          />
                          <span className="text-[10px] text-muted-foreground w-8">
                            {isCustomPct ? "edit" : "regra"}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
