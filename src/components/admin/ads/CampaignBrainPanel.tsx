import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { primaryDddForCity } from "@/lib/cityToDdd";
import CampaignBrainDiagnostics from "./CampaignBrainDiagnostics";
import {
  BRAIN_DEFAULT_STEP_PCT,
  BRAIN_MAX_STEP_PCT,
  BRAIN_TARGET_CPL_CENTS,
  clampBrainStepPct,
} from "@/lib/brainPolicy";
import {
  Brain,
  RefreshCw,
  ShieldAlert,
  ArrowRightLeft,
  Wallet,
  PauseCircle,
  Sparkles,
  Settings2,
  Play,
  Info,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Cell,
  RadialBarChart,
  RadialBar,
  PieChart,
  Pie,
} from "recharts";

type CityRow = {
  id: string;
  name: string;
  slug?: string;
  role: string;
  status: string;
  budget_cents: number;
  spend_48h_cents: number;
  conv_48h: number;
  cpl_cents: number | null;
  score: number;
  age_min_hard?: number;
  age_max_hard?: number;
  age_min_preferred?: number;
  age_range_ok?: boolean;
};

type Decision = {
  type: string;
  title: string;
  message: string;
  severity: string;
  impact_cents_per_day: number;
  action_label: string;
  action_payload: Record<string, unknown>;
};

type BrainConfig = {
  autopilot: boolean;
  mode: "conservative" | "balanced" | "aggressive";
  anchor_budget_cents: number;
  max_anchor_budget_cents: number;
  target_cpl_cents: number;
  scale_step_pct: number;
  explorer_budget_cents: number;
  max_explorers: number;
  age_min: number;
  age_max: number;
  min_runway_days: number;
  preferred_slugs: string[];
  extra_cities: Array<{ name: string; slug: string; ddd: number }>;
  /** Oficial Meta 2026: raio na sede. Legado: slots MG-ROT por cidade. */
  geo_mode: "radius_sede" | "cities_mg_rot";
  sede_name: string;
  sede_latitude: string;
  sede_longitude: string;
  sede_radius_km: number;
  sede_address: string;
  require_initial_message: boolean;
};

/** Defaults alinhados à política sede (editáveis por consultor no painel). */
const DEFAULT_CFG: BrainConfig = {
  autopilot: true,
  mode: "conservative",
  anchor_budget_cents: 1500,
  max_anchor_budget_cents: 50000,
  target_cpl_cents: BRAIN_TARGET_CPL_CENTS,
  scale_step_pct: BRAIN_DEFAULT_STEP_PCT,
  explorer_budget_cents: 517,
  max_explorers: 0,
  age_min: 30,
  age_max: 65,
  min_runway_days: 2,
  preferred_slugs: [],
  extra_cities: [],
  geo_mode: "radius_sede",
  sede_name: "",
  sede_latitude: "",
  sede_longitude: "",
  sede_radius_km: 50,
  sede_address: "",
  require_initial_message: true,
};

function brainFromApi(raw: Partial<BrainConfig> & Record<string, unknown>): BrainConfig {
  const lat = raw.sede_latitude;
  const lng = raw.sede_longitude;
  return {
    ...DEFAULT_CFG,
    ...raw,
    preferred_slugs: Array.isArray(raw.preferred_slugs) ? raw.preferred_slugs.map(String) : [],
    extra_cities: Array.isArray(raw.extra_cities) ? raw.extra_cities as BrainConfig["extra_cities"] : [],
    geo_mode: raw.geo_mode === "cities_mg_rot" ? "cities_mg_rot" : "radius_sede",
    sede_name: typeof raw.sede_name === "string" ? raw.sede_name : "",
    sede_latitude: lat == null || lat === "" ? "" : String(lat),
    sede_longitude: lng == null || lng === "" ? "" : String(lng),
    sede_radius_km: Math.max(1, Math.min(50, Number(raw.sede_radius_km) || 50)),
    sede_address: typeof raw.sede_address === "string" ? raw.sede_address : "",
    require_initial_message: raw.require_initial_message !== false,
    max_explorers: Number.isFinite(Number(raw.max_explorers))
      ? Math.max(0, Math.min(8, Math.round(Number(raw.max_explorers))))
      : DEFAULT_CFG.max_explorers,
  };
}

function brainToSavePayload(cfg: BrainConfig) {
  const lat = Number(cfg.sede_latitude);
  const lng = Number(cfg.sede_longitude);
  return {
    ...cfg,
    preferred_slugs: cfg.geo_mode === "radius_sede"
      ? []
      : cfg.preferred_slugs.slice(0, cfg.max_explorers),
    max_explorers: cfg.geo_mode === "radius_sede" ? 0 : cfg.max_explorers,
    sede_latitude: Number.isFinite(lat) ? lat : null,
    sede_longitude: Number.isFinite(lng) ? lng : null,
    sede_name: cfg.sede_name.trim() || null,
    sede_address: cfg.sede_address.trim() || null,
  };
}

type RotationBoard = {
  total_slots: number;
  preferred: string[];
  on_air: Array<{ id: string; name: string; slug: string; role: string; budget_cents: number; score: number }>;
  will_open: Array<{ slug: string; name: string; id: string | null; status: string }>;
  will_pause: Array<{ id: string; name: string; slug: string }>;
  queue: Array<{ id: string; name: string; slug: string; score: number }>;
  planned_daily_burn_cents: number;
  planned_daily_with_fee_cents: number;
};

type AgeMeta = {
  hard_min: number;
  hard_max: number;
  preference_min: number;
  preference_max: number;
  note: string;
  live_with_preference: number;
  live_total: number;
};

type BrainPayload = {
  health_score: number;
  runway_days: number;
  money_at_risk_cents: number;
  daily_burn_cents: number;
  daily_burn_with_fee_cents: number;
  liquid_cents: number;
  anchor_cpl_cents: number | null;
  cities: CityRow[];
  decisions: Decision[];
  brain?: BrainConfig;
  rotation?: RotationBoard;
  age?: AgeMeta;
  insight_udi?: { first_multi: { note: string }; anchor_winner: { note: string } };
  generated_at: string;
};

function brl(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function scoreTone(score: number) {
  if (score >= 70) return "text-emerald-600";
  if (score >= 45) return "text-amber-600";
  return "text-destructive";
}

function scoreFill(score: number) {
  if (score >= 70) return "hsl(var(--primary))";
  if (score >= 45) return "hsl(38 92% 50%)";
  return "hsl(var(--destructive))";
}

function roleLabel(role: string) {
  switch (role) {
    case "ancora": return "Âncora";
    case "exploradora": return "Exploradora";
    case "fila": return "Fila";
    case "morta_waste": return "Pausada (waste)";
    case "duplicata": return "Duplicata";
    default: return role;
  }
}

export function CampaignBrainPanel({
  consultantId,
  embedded = false,
}: {
  consultantId: string;
  /** No dashboard: esconde título duplicado e aperta o padding. */
  embedded?: boolean;
}) {
  const { toast } = useToast();
  const [data, setData] = useState<BrainPayload | null>(null);
  const [cfg, setCfg] = useState<BrainConfig>(DEFAULT_CFG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [whatIfId, setWhatIfId] = useState<string | null>(null);
  const [newCity, setNewCity] = useState("");
  const [brainModalOpen, setBrainModalOpen] = useState(false);
  const [brainHelpOpen, setBrainHelpOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      const { data: res, error } = await supabase.functions.invoke("campaign-brain-rank", {
        body: { consultant_id: consultantId, action: "rank" },
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (error) throw error;
      if (res?.error) throw new Error(res.error);
      setData(res as BrainPayload);
      if (res?.brain) setCfg(brainFromApi(res.brain));
    } catch (e) {
      toast({
        title: "Cérebro indisponível",
        description: (e as Error).message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [consultantId, toast]);

  useEffect(() => { load(); }, [load]);

  async function saveAndApply(apply: boolean) {
    setSaving(true);
    try {
      const brain = brainToSavePayload(cfg);
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      const { data: res, error } = await supabase.functions.invoke("campaign-brain-rank", {
        body: {
          consultant_id: consultantId,
          action: apply ? "apply" : "save",
          brain,
        },
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (error) throw error;
      if (res?.error) throw new Error(res.error);
      if (res?.apply_result?.error) throw new Error(String(res.apply_result.error));
      setData(res as BrainPayload);
      if (res?.brain) setCfg(brainFromApi(res.brain));

      const explorers = Number(brain.max_explorers) || 0;
      const cfgSummary = brain.geo_mode === "radius_sede"
        ? `Modo sede · raio ${brain.sede_radius_km} km · custo-alvo R$ ${(Number(brain.target_cpl_cents) / 100).toFixed(2)}`
        : `${1 + explorers} praças · R$ ${(Number(brain.explorer_budget_cents) / 100).toFixed(0)}/cidade · idade ${brain.age_min}+`;

      if (!apply) {
        toast({ title: "Configuração salva", description: cfgSummary });
        return;
      }

      const skip = res?.apply_result?.skipped as string | undefined;
      if (skip === "ads_automation_disabled") {
        toast({
          title: "Configuração salva",
          description:
            "Automação expansiva desligada neste consultor. Regras gravadas; escala/slots não mudam sozinhos até liberar autonomia.",
        });
        return;
      }

      // apply_requires_direct_rotator_call (ou sem skip): clique humano → rotator com JWT
      if (skip === "apply_requires_direct_rotator_call" || !skip) {
        const { error: rotErr, data: rotData } = await supabase.functions.invoke(
          "facebook-mg-city-rotator",
          {
            body: {
              ensure_active_slots: true,
              seed: false,
              target_budget_cents: brain.explorer_budget_cents,
              anchor_budget_cents: brain.anchor_budget_cents,
              preferred_slugs: brain.preferred_slugs,
            },
            headers: token ? { Authorization: `Bearer ${token}` } : undefined,
          },
        );
        if (rotErr) throw rotErr;
        if ((rotData as { error?: string } | null)?.error) {
          throw new Error(String((rotData as { error: string }).error));
        }
        toast({
          title: "Config salva e ciclo alinhado",
          description: cfgSummary,
        });
        await load();
        return;
      }

      toast({ title: "Configuração salva", description: cfgSummary });
    } catch (e) {
      toast({ title: "Falha ao salvar", description: (e as Error).message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  function addPreferredFromQueue(slug: string) {
    if (cfg.preferred_slugs.includes(slug)) return;
    const next = [...cfg.preferred_slugs, slug].slice(0, Math.max(cfg.max_explorers, cfg.preferred_slugs.length + 1));
    setCfg({
      ...cfg,
      max_explorers: Math.max(cfg.max_explorers, next.length),
      preferred_slugs: next.slice(0, Math.max(cfg.max_explorers, next.length)),
    });
  }

  function addExtraCity() {
    const name = newCity.trim();
    if (!name) return;
    const slug = name
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (cfg.extra_cities.some((c) => c.slug === slug) || cfg.preferred_slugs.includes(slug)) {
      toast({ title: "Cidade já na lista", variant: "destructive" });
      return;
    }
    const ddd = primaryDddForCity({ name }) || 31;
    setCfg({
      ...cfg,
      extra_cities: [...cfg.extra_cities, { name, slug, ddd }],
      preferred_slugs: [...cfg.preferred_slugs, slug].slice(0, 8),
      max_explorers: Math.min(8, Math.max(cfg.max_explorers, cfg.preferred_slugs.length + 1)),
    });
    setNewCity("");
  }

  const active = useMemo(
    () => (data?.cities || []).filter((c) => c.status === "active" || c.status === "pending_review"),
    [data],
  );
  const queue = useMemo(
    () => (data?.cities || []).filter((c) => c.role === "fila"),
    [data],
  );

  const healthRing = useMemo(() => {
    if (!data) return [];
    return [{ name: "saúde", value: data.health_score, fill: scoreFill(data.health_score) }];
  }, [data]);

  const scoreBars = useMemo(
    () => active.map((c) => ({
      name: c.name.length > 12 ? c.name.slice(0, 11) + "…" : c.name,
      full: c.name,
      score: c.score,
      fill: scoreFill(c.score),
    })),
    [active],
  );

  const budgetPie = useMemo(
    () => active.map((c) => ({
      name: c.name,
      value: Math.max(1, c.budget_cents),
    })),
    [active],
  );

  const spendBars = useMemo(
    () => active.map((c) => ({
      name: c.name.length > 12 ? c.name.slice(0, 11) + "…" : c.name,
      gasto: Number((c.spend_48h_cents / 100).toFixed(2)),
      conversas: c.conv_48h,
    })),
    [active],
  );

  const PIE_COLORS = [
    "hsl(var(--primary))",
    "hsl(160 60% 40%)",
    "hsl(200 70% 45%)",
    "hsl(38 92% 50%)",
  ];

  const whatIf = useMemo(() => {
    if (!data || !whatIfId) return null;
    const city = data.cities.find((c) => c.id === whatIfId);
    if (!city) return null;
    const newBurn = Math.max(0, data.daily_burn_with_fee_cents - Math.round(city.budget_cents * 1.2));
    const runway = newBurn > 0 ? data.liquid_cents / newBurn : 99;
    return {
      city: city.name,
      savePerDay: Math.round(city.budget_cents * 1.2),
      runway: Number(runway.toFixed(1)),
    };
  }, [data, whatIfId]);

  async function applyDecision(d: Decision) {
    setBusy(d.type + d.title);
    try {
      const kind = String(d.action_payload?.kind || "");
      if (kind === "pause_campaign") {
        const id = String(d.action_payload.campaign_id);
        const { error } = await supabase.functions.invoke("facebook-toggle-campaign", {
          body: { campaign_id: id, action: "pause" },
        });
        if (error) throw error;
      } else if (kind === "swap_explorer") {
        const pauseId = String(d.action_payload.pause_campaign_id || "");
        if (pauseId) {
          const { error } = await supabase.functions.invoke("facebook-toggle-campaign", {
            body: { campaign_id: pauseId, action: "pause" },
          });
          if (error) throw error;
        }
        const activateId = String(d.action_payload.activate_campaign_id || "");
        if (activateId) {
          const { error } = await supabase.functions.invoke("facebook-toggle-campaign", {
            body: { campaign_id: activateId, action: "activate" },
          });
          if (error) throw error;
        } else {
          const { error } = await supabase.functions.invoke("facebook-mg-city-rotator", {
            body: {
              ensure_active_slots: true,
              seed: false,
              target_budget_cents: cfg.explorer_budget_cents,
              anchor_budget_cents: cfg.anchor_budget_cents,
              preferred_slugs: cfg.preferred_slugs,
            },
          });
          if (error) throw error;
        }
      } else if (kind === "open_wallet") {
        toast({ title: "Carteira", description: "Use o chip de saldo no topo da Central para recarregar." });
      }
      toast({ title: "Ação aplicada", description: d.title });
      await load();
    } catch (e) {
      toast({ title: "Falha na ação", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  }

  if (loading && !data) {
    return (
      <Card className="p-6 text-sm text-muted-foreground flex items-center gap-2">
        <RefreshCw className="w-4 h-4 animate-spin" /> Calculando cérebro de campanhas…
      </Card>
    );
  }
  if (!data) return null;

  return (
    <div className={`space-y-4 min-w-0 w-full ${embedded ? "pt-1" : ""}`}>
      {/* Mission control */}
      <Card className={`border-primary/20 bg-card/80 ${embedded ? "p-3 sm:p-4 border-0 shadow-none bg-transparent" : "p-4 sm:p-5"}`}>
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div className="min-w-0">
            {!embedded && (
              <div className="flex items-center gap-2 text-sm font-bold tracking-tight">
                <Brain className="w-4 h-4 text-primary" />
                Cérebro de Campanhas
                <button
                  type="button"
                  aria-label="Como funciona o Cérebro"
                  title="Como funciona o Cérebro"
                  onClick={() => setBrainHelpOpen(true)}
                  className="inline-flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                >
                  <Info className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
            <p className={`text-xs text-muted-foreground flex items-center gap-1.5 flex-wrap ${embedded ? "" : "mt-1"}`}>
              <span>Saúde · runway · rotação MG · decisões em 1 clique</span>
              {embedded && (
                <button
                  type="button"
                  aria-label="Como funciona o Cérebro"
                  title="Como funciona o Cérebro"
                  onClick={() => setBrainHelpOpen(true)}
                  className="inline-flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                >
                  <Info className="w-3.5 h-3.5" />
                </button>
              )}
            </p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {/* Botão escondido: quase invisível; hover revela. Abre modal dos controles. */}
            <button
              type="button"
              aria-label="Abrir controles do Cérebro"
              title="Controles do assistente"
              onClick={() => setBrainModalOpen(true)}
              className="h-8 w-8 inline-flex items-center justify-center rounded-md opacity-[0.08] hover:opacity-70 focus:opacity-70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring transition-opacity"
            >
              <Settings2 className="w-3.5 h-3.5 text-muted-foreground" />
            </button>
            <Button size="sm" variant="outline" onClick={load} disabled={loading}>
              <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`} />
              Atualizar
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-[160px_1fr] lg:grid-cols-[180px_1fr] gap-4 items-center">
          <div className="relative h-[140px] sm:h-[160px] w-full max-w-[180px] mx-auto">
            <ResponsiveContainer width="100%" height="100%">
              <RadialBarChart
                cx="50%"
                cy="50%"
                innerRadius="68%"
                outerRadius="100%"
                barSize={14}
                data={healthRing}
                startAngle={90}
                endAngle={-270}
              >
                <RadialBar background dataKey="value" cornerRadius={8} />
              </RadialBarChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <div className={`text-3xl font-bold tabular-nums ${scoreTone(data.health_score)}`}>
                {data.health_score}
              </div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Saúde</div>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="rounded-xl border border-border/60 p-3">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Runway</div>
              <div className="text-3xl font-bold tabular-nums">
                {data.runway_days}
                <span className="text-sm font-medium text-muted-foreground">d</span>
              </div>
            </div>
            <div className="rounded-xl border border-border/60 p-3">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                <ShieldAlert className="w-3 h-3" /> Em risco (48h)
              </div>
              <div className="text-xl font-bold tabular-nums text-destructive">{brl(data.money_at_risk_cents)}</div>
            </div>
            <div className="rounded-xl border border-border/60 p-3 col-span-2 sm:col-span-1">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                <Wallet className="w-3 h-3" /> Queima/dia c/ taxa
              </div>
              <div className="text-xl font-bold tabular-nums">{brl(data.daily_burn_with_fee_cents)}</div>
              <div className="text-[10px] text-muted-foreground">Saldo {brl(data.liquid_cents)}</div>
            </div>
          </div>
        </div>

        {data.anchor_cpl_cents != null && (
          <p className="text-xs text-muted-foreground mt-3">
            Âncora Uberlândia · custo/conversa 48h: <strong>{brl(data.anchor_cpl_cents)}</strong>
          </p>
        )}
        {data.insight_udi && (
          <div className="mt-3 rounded-lg border border-border/50 bg-secondary/20 p-3 text-[11px] text-muted-foreground space-y-1">
            <div><strong className="text-foreground">Histórico:</strong> {data.insight_udi.anchor_winner.note}</div>
            <div>{data.insight_udi.first_multi.note}</div>
          </div>
        )}
      </Card>

      {/* Explicação completa: objetivo + regras do Cérebro */}
      <Dialog open={brainHelpOpen} onOpenChange={setBrainHelpOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] p-0 gap-0 overflow-hidden">
          <DialogHeader className="px-5 pt-5 pb-3 border-b border-border/60">
            <DialogTitle className="flex items-center gap-2 text-base">
              <Info className="w-4 h-4 text-primary" />
              Como funciona o Cérebro
            </DialogTitle>
            <DialogDescription>
              Objetivo, regras e o que o automático faz (e o que não faz).
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[min(70vh,560px)]">
            <div className="px-5 py-4 space-y-4 text-sm text-muted-foreground leading-relaxed">
              <section className="space-y-1.5">
                <h4 className="text-foreground font-semibold text-[13px]">Onde as regras ficam</h4>
                <p>
                  Cada consultor tem o próprio <strong className="text-foreground font-medium">brain_config</strong>{" "}
                  (banco). Você edita no ícone de engrenagem → <strong className="text-foreground font-medium">Controles do assistente</strong>.
                  Não precisa mexer em código: salva aqui e o motor + Express leem no próximo ciclo.
                </p>
              </section>

              <section className="space-y-1.5">
                <h4 className="text-foreground font-semibold text-[13px]">Por quê personalizado</h4>
                <p>
                  Sede, raio, custo-alvo por conversa e quantas cidades no ar mudam por consultor e por momento.
                  Hardcoded no código travaria todo mundo no mesmo formato. Por isso a regra vive no config do consultor.
                </p>
              </section>

              <section className="space-y-1.5">
                <h4 className="text-foreground font-semibold text-[13px]">Objetivo</h4>
                <p>
                  Proteger a carteira e escalar a campanha que funciona. A Meta barateia conversa com{" "}
                  <strong className="text-foreground font-medium">1 anúncio amplo + orçamento concentrado</strong> —
                  o assistente serve a esse formato, não fragmenta em dezenas de cidades miúdas.
                </p>
              </section>

              <section className="space-y-1.5">
                <h4 className="text-foreground font-semibold text-[13px]">Modelo no ar (oficial)</h4>
                <ul className="list-disc pl-4 space-y-1">
                  <li>
                    <strong className="text-foreground font-medium">Raio na sede</strong> (recomendado): 1 âncora,
                    raio 40–50 km, <code className="text-[11px]">max_explorers = 0</code>, sem MG-ROT automático.
                  </li>
                  <li>
                    <strong className="text-foreground font-medium">Cidades MG-ROT</strong> (legado): âncora + N
                    exploradoras — só se você ligar de propósito neste painel.
                  </li>
                  <li>
                    Toda campanha criada precisa de <strong className="text-foreground font-medium">mensagem inicial WhatsApp</strong>{" "}
                    (mensagem inicial única no WhatsApp).
                  </li>
                </ul>
              </section>

              <section className="space-y-1.5">
                <h4 className="text-foreground font-semibold text-[13px]">Escala da âncora</h4>
                <ul className="list-disc pl-4 space-y-1">
                  <li>
                    Mede custo por conversa na janela de <strong className="text-foreground font-medium">48h</strong>.
                  </li>
                  <li>
                    Se o custo por conversa ≤ alvo (configurável; oficial R$&nbsp;7,50): sobe o budget em degraus, até o teto.
                  </li>
                  <li>Se o custo por conversa estiver alto: desce no mesmo passo percentual.</li>
                  <li>
                    Não espera 48h entre subidas — só usa 48h para medir. Intervalo anti-spam de ~{" "}
                    <strong className="text-foreground font-medium">4h</strong> entre degraus.
                  </li>
                  <li>Quando sobe ou desce, avisa no WhatsApp do consultor.</li>
                </ul>
              </section>

              <section className="space-y-1.5">
                <h4 className="text-foreground font-semibold text-[13px]">Waste (pausa automática)</h4>
                <ul className="list-disc pl-4 space-y-1">
                  <li>Em ~48h, se gasta sem conversa (ou sem clique), a campanha/ad pode ser pausada.</li>
                  <li>Campanha pausada por waste só volta no Play manual do consultor.</li>
                </ul>
              </section>

              <section className="space-y-1.5">
                <h4 className="text-foreground font-semibold text-[13px]">Criativos e WhatsApp do anúncio</h4>
                <ul className="list-disc pl-4 space-y-1">
                  <li>Frase do WhatsApp <strong className="text-foreground font-medium">sem nome de cidade</strong>.</li>
                  <li>Quem decide campanha/parceiro é o sinal da Meta (AD ID), não a palavra da mensagem.</li>
                  <li>Campanhas já no ar não são reescritas só para trocar copy.</li>
                </ul>
              </section>

              <section className="space-y-1.5">
                <h4 className="text-foreground font-semibold text-[13px]">O que você controla</h4>
                <p>
                  Engrenagem → Controles: estratégia (sede × cidades), sede/raio, mensagem obrigatória,
                  orçamento da âncora, teto, custo-alvo, degrau %, exploradoras (se legado), idade e ordem das praças.
                  <strong className="text-foreground font-medium"> Salvar só config</strong> grava;
                  <strong className="text-foreground font-medium"> Salvar e alinhar ciclo</strong> grava
                  e chama o rotator com seu login (slots/budget conforme as regras — sem recriar anúncio).
                </p>
              </section>

              <section className="space-y-1.5 pb-1">
                <h4 className="text-foreground font-semibold text-[13px]">Números desta tela</h4>
                <ul className="list-disc pl-4 space-y-1">
                  <li><strong className="text-foreground font-medium">Saúde</strong> — resumo de risco e performance.</li>
                  <li><strong className="text-foreground font-medium">Runway</strong> — dias de saldo com a queima atual.</li>
                  <li><strong className="text-foreground font-medium">Em risco (48h)</strong> — gasto em praças fracas.</li>
                  <li><strong className="text-foreground font-medium">Rotação</strong> — o que está no ar (no modo sede: só âncora).</li>
                </ul>
              </section>
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      {/* Controles do assistente — só no modal (botão escondido ao lado de Atualizar) */}
      <Dialog open={brainModalOpen} onOpenChange={setBrainModalOpen}>
        <DialogContent className="w-[calc(100%-1rem)] max-w-3xl max-h-[min(92dvh,920px)] p-4 sm:p-6 gap-3 overflow-hidden flex flex-col">
          <DialogHeader className="shrink-0">
            <DialogTitle className="flex items-center gap-2">
              <Settings2 className="w-4 h-4 text-primary" />
              Controles do assistente
              <button
                type="button"
                aria-label="Como funciona o Cérebro"
                title="Como funciona o Cérebro"
                onClick={() => setBrainHelpOpen(true)}
                className="inline-flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
              >
                <Info className="w-3.5 h-3.5" />
              </button>
            </DialogTitle>
            <DialogDescription>
              Regras personalizadas deste consultor (salvas em brain_config). Sem editar código —
              mude aqui, salve, e o motor/Express usam no próximo ciclo.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 space-y-3">
              <div>
                <Label className="text-[11px] font-semibold">Estratégia geográfica</Label>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  Por quê: a Meta barateia com 1 campanha ampla. Fragmentar em N cidades com budget miúdo
                  reinicia learning e encarece. Cada consultor define a sede dele.
                </p>
              </div>
              <div className="grid sm:grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setCfg({
                    ...cfg,
                    geo_mode: "radius_sede",
                    max_explorers: 0,
                    preferred_slugs: [],
                  })}
                  className={`text-left rounded-md border p-3 text-sm transition-colors ${
                    cfg.geo_mode === "radius_sede"
                      ? "border-primary bg-background shadow-sm"
                      : "border-border hover:bg-muted/40"
                  }`}
                >
                  <div className="font-medium text-[13px]">Raio na sede (recomendado)</div>
                  <div className="text-[10px] text-muted-foreground mt-1">
                    1 âncora · sem MG-ROT automático · Express pré-preenche o raio
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setCfg({
                    ...cfg,
                    geo_mode: "cities_mg_rot",
                    max_explorers: Math.max(1, cfg.max_explorers),
                  })}
                  className={`text-left rounded-md border p-3 text-sm transition-colors ${
                    cfg.geo_mode === "cities_mg_rot"
                      ? "border-primary bg-background shadow-sm"
                      : "border-border hover:bg-muted/40"
                  }`}
                >
                  <div className="font-medium text-[13px]">Cidades MG-ROT (legado)</div>
                  <div className="text-[10px] text-muted-foreground mt-1">
                    Âncora + slots por cidade — só com pedido / teste controlado
                  </div>
                </button>
              </div>

              {cfg.geo_mode === "radius_sede" && (
                <div className="grid sm:grid-cols-2 gap-3 pt-1">
                  <div className="sm:col-span-2">
                    <Label className="text-[11px]">Nome da sede</Label>
                    <Input
                      value={cfg.sede_name}
                      onChange={(e) => setCfg({ ...cfg, sede_name: e.target.value })}
                      placeholder="Ex.: Sede iGreen Uberlândia (Jaraguá)"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <Label className="text-[11px]">Endereço (texto)</Label>
                    <Input
                      value={cfg.sede_address}
                      onChange={(e) => setCfg({ ...cfg, sede_address: e.target.value })}
                      placeholder="Bairro, cidade, UF"
                    />
                  </div>
                  <div>
                    <Label className="text-[11px]">Latitude</Label>
                    <Input
                      value={cfg.sede_latitude}
                      onChange={(e) => setCfg({ ...cfg, sede_latitude: e.target.value })}
                      placeholder="-18.92417"
                    />
                  </div>
                  <div>
                    <Label className="text-[11px]">Longitude</Label>
                    <Input
                      value={cfg.sede_longitude}
                      onChange={(e) => setCfg({ ...cfg, sede_longitude: e.target.value })}
                      placeholder="-48.30179"
                    />
                  </div>
                  <div>
                    <Label className="text-[11px]">Raio (km) — 1 a 50</Label>
                    <Input
                      type="number"
                      min={1}
                      max={50}
                      value={cfg.sede_radius_km}
                      onChange={(e) => setCfg({
                        ...cfg,
                        sede_radius_km: Math.max(1, Math.min(50, Number(e.target.value) || 50)),
                      })}
                    />
                    <p className="text-[10px] text-muted-foreground mt-1">
                      Publisher corta em 50 km. Express usa este valor ao abrir.
                    </p>
                  </div>
                </div>
              )}

              <label className="flex items-start gap-2 text-[11px] cursor-pointer pt-1">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={cfg.require_initial_message}
                  onChange={(e) => setCfg({ ...cfg, require_initial_message: e.target.checked })}
                />
                <span>
                  <strong>Exigir mensagem inicial</strong> em toda campanha criada
                  (mensagem inicial única no WhatsApp — sem isso a publicação bloqueia).
                </span>
              </label>
            </div>

            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <Label className="text-[11px]">Budget Uberlândia (R$/dia)</Label>
              <Input
                type="number" min={5.17} step={1}
                value={(cfg.anchor_budget_cents / 100).toFixed(0)}
                onChange={(e) => setCfg({ ...cfg, anchor_budget_cents: Math.round(Number(e.target.value || 0) * 100) })}
              />
            </div>
            <div>
              <Label className="text-[11px]">Teto Uberlândia (R$/dia)</Label>
              <Input
                type="number" min={10} step={10}
                value={(cfg.max_anchor_budget_cents / 100).toFixed(0)}
                onChange={(e) => setCfg({ ...cfg, max_anchor_budget_cents: Math.round(Number(e.target.value || 0) * 100) })}
              />
              <p className="text-[10px] text-muted-foreground mt-1">Escala sobe até aqui se o custo por conversa estiver ok</p>
            </div>
            <div>
              <Label className="text-[11px]">Custo-alvo por conversa (R$)</Label>
              <Input
                type="number" min={0.5} step={0.1}
                value={(cfg.target_cpl_cents / 100).toFixed(2)}
                onChange={(e) => setCfg({ ...cfg, target_cpl_cents: Math.round(Number(e.target.value || 0) * 100) })}
              />
            </div>
            <div>
              <Label className="text-[11px]">Degrau de escala (%)</Label>
              <Input
                type="number" min={1} max={BRAIN_MAX_STEP_PCT}
                value={cfg.scale_step_pct}
                onChange={(e) => setCfg({ ...cfg, scale_step_pct: clampBrainStepPct(e.target.value) })}
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                Teto de segurança: {BRAIN_MAX_STEP_PCT}% por ajuste.
              </p>
            </div>
            <div>
              <Label className="text-[11px]">Budget outras cidades (R$/dia)</Label>
              <Input
                type="number" min={5.17} step={1}
                value={(cfg.explorer_budget_cents / 100).toFixed(0)}
                onChange={(e) => setCfg({ ...cfg, explorer_budget_cents: Math.round(Number(e.target.value || 0) * 100) })}
                disabled={cfg.geo_mode === "radius_sede"}
              />
            </div>
            <div>
              <Label className="text-[11px]">Qtd. outras cidades no ar</Label>
              <Input
                type="number" min={0} max={8}
                value={cfg.max_explorers}
                disabled={cfg.geo_mode === "radius_sede"}
                onChange={(e) => {
                  const n = Math.max(0, Math.min(8, Number(e.target.value) || 0));
                  setCfg({
                    ...cfg,
                    max_explorers: n,
                    preferred_slugs: cfg.preferred_slugs.slice(0, n),
                  });
                }}
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                {cfg.geo_mode === "radius_sede"
                  ? "Modo sede: 0 exploradoras (só a âncora)."
                  : `Total no ar = 1 + isso (= ${1 + cfg.max_explorers})`}
              </p>
            </div>
            <div>
              <Label className="text-[11px]">Idade mínima preferida (sugestão Meta)</Label>
              <Input
                type="number" min={18} max={65}
                value={cfg.age_min}
                onChange={(e) => setCfg({ ...cfg, age_min: Number(e.target.value) || 30 })}
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                Vai como <code>age_range</code> na Meta. Hard Advantage+ continua 25–65.
              </p>
            </div>
          </div>

          {data.age && (
            <div className="rounded-lg border border-border/60 bg-secondary/20 p-3 flex flex-wrap gap-3 items-center text-[11px]">
              <Badge variant={data.age.live_with_preference >= data.age.live_total && data.age.live_total > 0 ? "default" : "secondary"}>
                Preferência {data.age.preference_min}+ nas ativas: {data.age.live_with_preference}/{data.age.live_total}
              </Badge>
              <span className="text-muted-foreground">
                Hard Meta: {data.age.hard_min}–{data.age.hard_max} · Sugestão: {data.age.preference_min}–{data.age.preference_max}
              </span>
            </div>
          )}

          <div className={cfg.geo_mode === "radius_sede" ? "opacity-50 pointer-events-none" : ""}>
            <Label className="text-[11px]">
              Ordem das cidades no ar (1ª = prioridade)
              {cfg.geo_mode === "radius_sede" && (
                <span className="text-muted-foreground font-normal"> — desligado no modo sede</span>
              )}
            </Label>
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {cfg.preferred_slugs.map((slug, idx) => (
                <Badge key={slug} variant="secondary" className="gap-1 text-[11px]">
                  {idx + 1}. {slug}
                  <button
                    type="button"
                    className="hover:text-destructive"
                    onClick={() => setCfg({ ...cfg, preferred_slugs: cfg.preferred_slugs.filter((s) => s !== slug) })}
                  >
                    ×
                  </button>
                </Badge>
              ))}
              {cfg.preferred_slugs.length === 0 && (
                <span className="text-[11px] text-muted-foreground">Nenhuma exploradora na lista.</span>
              )}
            </div>
            <div className="flex flex-wrap gap-2 mt-2 items-end">
              <div className="flex-1 min-w-[140px]">
                <Label className="text-[11px]">Adicionar cidade à rotação</Label>
                <Input placeholder="Ex: Araxá" value={newCity} onChange={(e) => setNewCity(e.target.value)} />
              </div>
              <Button type="button" size="sm" variant="outline" onClick={addExtraCity}>Adicionar</Button>
            </div>
            {(data.rotation?.queue || []).length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                <span className="text-[10px] text-muted-foreground w-full">Clique para priorizar da fila:</span>
                {data.rotation!.queue.slice(0, 12).map((c) => (
                  <Button key={c.id} type="button" size="sm" variant="ghost" className="h-7 text-[11px]"
                    onClick={() => addPreferredFromQueue(c.slug)}>
                    + {c.name}
                  </Button>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-2 pt-1">
            <Button size="sm" variant="outline" disabled={saving} onClick={() => saveAndApply(false)}>
              Salvar só config
            </Button>
            <Button
              size="sm"
              disabled={saving}
              onClick={async () => {
                await saveAndApply(true);
                setBrainModalOpen(false);
              }}
            >
              <Play className="w-3.5 h-3.5 mr-1" />
              {saving ? "Aplicando…" : "Salvar e alinhar ciclo"}
            </Button>
            <span className="text-[11px] text-muted-foreground self-center">
              Plano: {brl(cfg.anchor_budget_cents + cfg.explorer_budget_cents * cfg.max_explorers)}/dia
              {" "}(+taxa ≈ {brl(Math.round((cfg.anchor_budget_cents + cfg.explorer_budget_cents * cfg.max_explorers) * 1.2))})
            </span>
          </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Rotação visual */}
      {data.rotation && (
        <Card className="p-4">
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-1.5">
            <ArrowRightLeft className="w-4 h-4 text-primary" />
            Rotação das cidades ({data.rotation.total_slots} slots)
          </h3>
          <div className="grid md:grid-cols-3 gap-3">
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
              <div className="text-[10px] uppercase tracking-wider text-emerald-700 font-semibold mb-2">No ar agora</div>
              <div className="space-y-1.5">
                {data.rotation.on_air.map((c) => (
                  <div key={c.id} className="flex justify-between text-xs gap-2">
                    <span className="font-medium">{c.name} {c.role === "ancora" ? "★" : ""}</span>
                    <span className="tabular-nums text-muted-foreground">{brl(c.budget_cents)} · {c.score}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
              <div className="text-[10px] uppercase tracking-wider text-amber-700 font-semibold mb-2">Vai abrir (próximo apply)</div>
              {data.rotation.will_open.length === 0 ? (
                <p className="text-xs text-muted-foreground">Nenhuma — slots preferidos já cobertos.</p>
              ) : (
                <div className="space-y-1.5">
                  {data.rotation.will_open.map((c) => (
                    <div key={c.slug} className="text-xs font-medium">{c.name}</div>
                  ))}
                </div>
              )}
            </div>
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
              <div className="text-[10px] uppercase tracking-wider text-destructive font-semibold mb-2">Vai pausar</div>
              {data.rotation.will_pause.length === 0 ? (
                <p className="text-xs text-muted-foreground">Nenhuma — todas no ar estão na lista preferida.</p>
              ) : (
                <div className="space-y-1.5">
                  {data.rotation.will_pause.map((c) => (
                    <div key={c.id} className="text-xs font-medium">{c.name}</div>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="mt-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Fila (aguarda slot)</div>
            <div className="flex flex-wrap gap-1.5">
              {data.rotation.queue.map((c) => (
                <Badge key={c.id} variant="outline" className="text-[11px]">{c.name} · {c.score}</Badge>
              ))}
            </div>
          </div>
        </Card>
      )}

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 min-w-0">
        <Card className="p-3 sm:p-4 lg:col-span-2 min-w-0 overflow-hidden">
          <h3 className="text-sm font-semibold mb-2">Score por cidade (no ar)</h3>
          <div className="ads-chart-h">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={scoreBars} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-25} textAnchor="end" height={48} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} width={28} />
                <Tooltip
                  formatter={(v: number) => [v, "Score"]}
                  labelFormatter={(_, payload) => payload?.[0]?.payload?.full || ""}
                />
                <Bar dataKey="score" radius={[6, 6, 0, 0]}>
                  {scoreBars.map((row, i) => (
                    <Cell key={i} fill={row.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-3 sm:p-4 min-w-0 overflow-hidden">
          <h3 className="text-sm font-semibold mb-2">Budget no ar</h3>
          <div className="ads-chart-h max-h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={budgetPie}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={42}
                  outerRadius={68}
                  paddingAngle={2}
                >
                  {budgetPie.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(v: number) => brl(v)} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="flex flex-wrap gap-1.5 justify-center">
            {budgetPie.map((c, i) => (
              <Badge key={c.name} variant="outline" className="text-[10px] gap-1">
                <span className="inline-block w-2 h-2 rounded-full" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                {c.name} · {brl(c.value)}
              </Badge>
            ))}
          </div>
        </Card>
      </div>

      <Card className="p-3 sm:p-4 min-w-0 overflow-hidden">
        <h3 className="text-sm font-semibold mb-2">Gasto 48h × conversas</h3>
        <div className="ads-chart-h">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={spendBars} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-25} textAnchor="end" height={48} />
              <YAxis yAxisId="left" tick={{ fontSize: 11 }} width={36} />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} width={28} />
              <Tooltip />
              <Bar yAxisId="left" dataKey="gasto" name="Gasto (R$)" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
              <Bar yAxisId="right" dataKey="conversas" name="Conversas" fill="hsl(160 60% 40%)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* Active constellation */}
      <div>
        <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
          <Sparkles className="w-4 h-4 text-primary" /> No ar agora
        </h3>
        <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-3">
          {active.map((c) => (
            <Card
              key={c.id}
              className={`p-3 cursor-pointer transition-colors ${whatIfId === c.id ? "border-primary" : "border-border/60"}`}
              onClick={() => setWhatIfId(c.id === whatIfId ? null : c.id)}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-semibold text-sm">{c.name}</div>
                  <div className="flex flex-wrap gap-1 mt-1">
                    <Badge variant="secondary" className="text-[10px]">{roleLabel(c.role)}</Badge>
                    <Badge
                      variant={c.age_range_ok ? "default" : "outline"}
                      className="text-[10px]"
                      title={`Hard Meta ${c.age_min_hard ?? 25}–${c.age_max_hard ?? 65}`}
                    >
                      {c.age_range_ok
                        ? `Idade ${c.age_min_preferred ?? cfg.age_min}+ ok`
                        : `Idade pendente (${c.age_min_preferred ?? "—"}+)`}
                    </Badge>
                  </div>
                </div>
                <div className={`text-2xl font-bold tabular-nums ${scoreTone(c.score)}`}>{c.score}</div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
                <div>
                  <div className="text-muted-foreground">Budget</div>
                  <div className="font-medium tabular-nums">{brl(c.budget_cents)}/d</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Custo/conv</div>
                  <div className="font-medium tabular-nums">{c.cpl_cents != null ? brl(c.cpl_cents) : "—"}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Gasto 48h</div>
                  <div className="font-medium tabular-nums">{brl(c.spend_48h_cents)}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Conversas</div>
                  <div className="font-medium tabular-nums">{c.conv_48h}</div>
                </div>
              </div>
            </Card>
          ))}
        </div>
        {whatIf && (
          <p className="text-xs mt-2 text-muted-foreground">
            What-if: pausar <strong>{whatIf.city}</strong> economiza ~{brl(whatIf.savePerDay)}/dia → runway ~{whatIf.runway} dias.
          </p>
        )}
      </div>

      <CampaignBrainDiagnostics consultantId={consultantId} />

      {/* Decisions */}
      <Card className="p-4">
        <h3 className="text-sm font-semibold mb-3">Decisões</h3>
        {(data.decisions || []).length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma ação urgente. Waste guard e rotação seguem no automático.</p>
        ) : (
          <div className="space-y-2">
            {data.decisions.map((d, i) => (
              <div key={i} className="flex flex-col sm:flex-row sm:items-center gap-2 p-3 rounded-lg border border-border/50 bg-secondary/20">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">{d.title}</div>
                  <div className="text-xs text-muted-foreground">{d.message}</div>
                  {d.impact_cents_per_day > 0 && (
                    <div className="text-[11px] text-primary mt-1">Impacto ~{brl(d.impact_cents_per_day)}/dia</div>
                  )}
                </div>
                <Button
                  size="sm"
                  disabled={busy === d.type + d.title}
                  onClick={() => applyDecision(d)}
                  className="shrink-0"
                >
                  {d.type.includes("swap") ? <ArrowRightLeft className="w-3.5 h-3.5 mr-1" /> : <PauseCircle className="w-3.5 h-3.5 mr-1" />}
                  {d.action_label}
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Queue */}
      <Card className="p-4">
        <h3 className="text-sm font-semibold mb-2">Fila MG ({queue.length})</h3>
        <div className="flex flex-wrap gap-1.5">
          {queue.slice(0, 24).map((c) => (
            <Badge key={c.id} variant="outline" className="text-[11px]">
              {c.name} · {c.score}
            </Badge>
          ))}
          {queue.length === 0 && <span className="text-xs text-muted-foreground">Fila vazia</span>}
        </div>
      </Card>
    </div>
  );
}
