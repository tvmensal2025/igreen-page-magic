import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  CheckCircle2,
  Circle,
  Compass,
  Power,
  PowerOff,
  Search,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  CAPACIDADES,
  ENVIOS_AUTOMATICOS,
  PASSOS_SUGERIDOS,
  RISCO_LABEL,
  type CapacidadeItem,
  type CapacidadeRisco,
} from "@/lib/sistemaCapacidadesMapa";
import {
  useAutomationToggles,
  type AutomationToggle,
} from "@/hooks/useAutomationToggles";

const CATEGORY_LABELS: Record<string, string> = {
  cadencia: "Sequências",
  voz: "Ligações",
  sms: "SMS",
  meta: "Anúncios / Meta",
  manual: "Manual",
  ia: "Robô e retenção",
  "pos-venda": "Pós-venda",
  parceiros: "Parceiros",
  geral: "Geral",
};

/** Chaves que merecem destaque no painel principal (ordem). */
const ESSENCIAIS_KEYS = [
  "send_scheduled_messages",
  "bot_followup_checker",
  "faq_reengagement_nudge",
  "process_followups",
  "bulk_campaigns_runner",
  "reactivation_cron",
  "cadence_engine",
] as const;

function riscoClass(risco?: CapacidadeRisco) {
  if (risco === "seguro") return "border-emerald-500/25 bg-emerald-500/5";
  if (risco === "cuidado") return "border-amber-500/30 bg-amber-500/5";
  if (risco === "avancado") return "border-rose-500/25 bg-rose-500/5";
  return "border-border bg-card";
}

function metaForKey(key: string): CapacidadeItem | undefined {
  return CAPACIDADES.find((c) => c.toggle === key);
}

type Props = {
  /** Se false, só visualiza (consultor). */
  canToggle?: boolean;
  /** Aba inicial */
  defaultSection?: "controle" | "todas" | "roteiro";
  className?: string;
};

/**
 * Painel principal de controle — linguagem clara + interruptores grandes.
 */
export function CentralAutomacoesControle({
  canToggle = true,
  defaultSection = "controle",
  className,
}: Props) {
  const { items, byKey, loading, busyKey, onCount, offCount, setEnabled, bulkSet, load } =
    useAutomationToggles();
  const [section, setSection] = useState(defaultSection);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string>("all");

  const essenciais = useMemo(() => {
    return ESSENCIAIS_KEYS.map((key) => {
      const row = byKey.get(key);
      const meta = metaForKey(key);
      const envio = ENVIOS_AUTOMATICOS.find((e) => e.toggle === key);
      return {
        key,
        row,
        nome: meta?.nome ?? envio?.nome ?? row?.label ?? key,
        oQueFaz: meta?.oQueFaz ?? envio?.oQueFaz ?? row?.description ?? "",
        dica: meta?.dica,
        risco: meta?.risco,
        quando: envio?.quando,
      };
    });
  }, [byKey]);

  const categories = useMemo(() => {
    const s = new Set(items.map((i) => i.category));
    return Array.from(s);
  }, [items]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return items.filter((t) => {
      if (cat !== "all" && t.category !== cat) return false;
      if (!term) return true;
      const meta = metaForKey(t.key);
      const blob = `${t.label} ${t.description ?? ""} ${t.key} ${meta?.nome ?? ""}`.toLowerCase();
      return blob.includes(term);
    });
  }, [items, q, cat]);

  const grouped = useMemo(() => {
    return filtered.reduce<Record<string, AutomationToggle[]>>((acc, t) => {
      (acc[t.category] ||= []).push(t);
      return acc;
    }, {});
  }, [filtered]);

  return (
    <div className={cn("space-y-6", className)}>
      {/* Status */}
      <div
        className={cn(
          "relative overflow-hidden rounded-2xl border p-5 sm:p-6",
          onCount === 0
            ? "border-amber-500/30 bg-gradient-to-br from-amber-500/10 via-background to-background"
            : "border-emerald-500/25 bg-gradient-to-br from-emerald-500/10 via-background to-background",
        )}
      >
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <div
              className={cn(
                "mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border",
                onCount === 0
                  ? "border-amber-500/30 bg-amber-500/15 text-amber-800"
                  : "border-emerald-500/30 bg-emerald-500/15 text-emerald-800",
              )}
            >
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div className="min-w-0 space-y-1">
              <p className="text-base font-semibold tracking-tight">
                {onCount === 0
                  ? "Modo seguro — nenhum envio automático ligado"
                  : `${onCount} função(ões) ligada(s) · ${offCount} pausada(s)`}
              </p>
              <p className="text-sm text-muted-foreground leading-relaxed max-w-2xl">
                Desligado = o sistema <strong className="font-medium text-foreground/80">não manda</strong> mensagem
                sozinho. Ligue só o que você autorizar, uma por vez.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="rounded-xl"
              onClick={() => bulkSet(false)}
              disabled={!canToggle || busyKey === "__all__"}
            >
              <PowerOff className="h-3.5 w-3.5 mr-1.5" />
              Desligar todas
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="rounded-xl text-muted-foreground"
              onClick={load}
              disabled={loading}
            >
              Atualizar
            </Button>
          </div>
        </div>

        {/* Mini roteiro */}
        <div className="mt-5 flex gap-2 overflow-x-auto pb-1">
          {PASSOS_SUGERIDOS.slice(0, 4).map((p) => {
            const on = p.toggle ? byKey.get(p.toggle)?.enabled : undefined;
            return (
              <button
                key={p.passo}
                type="button"
                onClick={() => setSection("roteiro")}
                className={cn(
                  "flex min-w-[140px] items-center gap-2 rounded-xl border px-3 py-2 text-left text-xs transition-colors",
                  on
                    ? "border-emerald-500/30 bg-emerald-500/10"
                    : "border-border/80 bg-background/60 hover:bg-muted/50",
                )}
              >
                {on ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                ) : (
                  <Circle className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                )}
                <span className="leading-snug">
                  <span className="text-muted-foreground">{p.passo}. </span>
                  {p.titulo.replace(/Ligue só |Depois: |Por último: /g, "")}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Nav seções */}
      <div className="flex flex-wrap gap-1.5 rounded-xl border bg-muted/30 p-1.5">
        {(
          [
            { id: "controle" as const, label: "Controle principal", icon: Power },
            { id: "roteiro" as const, label: "Por onde começar", icon: Compass },
            { id: "todas" as const, label: "Todas as funções", icon: Search },
          ] as const
        ).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setSection(id)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              section === id
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      {loading && (
        <p className="text-sm text-muted-foreground">Carregando automações…</p>
      )}

      {section === "controle" && (
        <div className="space-y-3">
          <div className="flex items-end justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold tracking-tight">O que mais importa ligar</h2>
              <p className="text-sm text-muted-foreground">
                Interruptor grande. Nome em português. Sem código técnico.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
            {essenciais.map((e) => {
              const enabled = e.row?.enabled ?? false;
              const missing = !e.row;
              return (
                <div
                  key={e.key}
                  className={cn(
                    "rounded-2xl border p-4 sm:p-5 transition-colors",
                    missing ? "opacity-60" : riscoClass(e.risco),
                    enabled && "ring-1 ring-emerald-500/20",
                  )}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-semibold text-[15px] leading-snug">{e.nome}</h3>
                        <Badge
                          variant={enabled ? "default" : "secondary"}
                          className="text-[10px] rounded-full"
                        >
                          {missing ? "Indisponível" : enabled ? "Ligado" : "Desligado"}
                        </Badge>
                        {e.risco && (
                          <Badge variant="outline" className="text-[10px] font-normal rounded-full">
                            {RISCO_LABEL[e.risco]}
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground leading-relaxed">{e.oQueFaz}</p>
                      {e.quando && (
                        <p className="text-xs text-muted-foreground">Quando: {e.quando}</p>
                      )}
                      {e.dica && (
                        <p className="text-xs rounded-lg bg-background/70 border px-2.5 py-1.5 text-muted-foreground">
                          {e.dica}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-col items-center gap-1.5 shrink-0 pt-0.5">
                      <Switch
                        checked={enabled}
                        disabled={!canToggle || missing || busyKey === e.key}
                        onCheckedChange={(v) => setEnabled(e.key, v)}
                        className="scale-110 data-[state=checked]:bg-emerald-600"
                        aria-label={`Ligar ou desligar ${e.nome}`}
                      />
                      <span className="text-[10px] text-muted-foreground tabular-nums">
                        {enabled ? "ON" : "OFF"}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {section === "roteiro" && (
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold tracking-tight flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              Por onde começar (sem spam)
            </h2>
            <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
              Ordem sugerida: Captação diária → lembrar quem sumiu → toque pós-dúvida → lembrete no dia combinado.
            </p>
          </div>
          <ol className="space-y-3">
            {PASSOS_SUGERIDOS.map((s) => {
              const row = s.toggle ? byKey.get(s.toggle) : undefined;
              const ligado = row?.enabled ?? false;
              return (
                <li
                  key={s.passo}
                  className="rounded-2xl border bg-card p-4 sm:p-5 flex flex-col sm:flex-row gap-4"
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold">
                    {s.passo}
                  </div>
                  <div className="flex-1 min-w-0 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold text-[15px]">{s.titulo}</h3>
                      {s.toggle && (
                        <Badge variant={ligado ? "default" : "secondary"} className="text-[10px]">
                          {ligado ? "Já ligado" : "Ainda desligado"}
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">{s.porque}</p>
                    <p className="text-xs text-muted-foreground">
                      <span className="font-medium text-foreground/80">Como: </span>
                      {s.como}
                    </p>
                  </div>
                  {s.toggle && canToggle && (
                    <Button
                      type="button"
                      size="sm"
                      variant={ligado ? "outline" : "default"}
                      className="rounded-xl shrink-0 self-start sm:self-center"
                      disabled={busyKey === s.toggle || !row}
                      onClick={() => setEnabled(s.toggle!, !ligado)}
                    >
                      <Power className="h-3.5 w-3.5 mr-1.5" />
                      {ligado ? "Desligar" : "Ligar agora"}
                    </Button>
                  )}
                </li>
              );
            })}
          </ol>
          <div className="rounded-xl border bg-muted/30 p-4 text-sm text-muted-foreground">
            Captação (passo 1) é humana —{" "}
            <Link to="/admin" className="underline underline-offset-2 text-foreground">
              abra o menu Captação
            </Link>{" "}
            toda manhã enquanto o resto estiver desligado.
          </div>
        </div>
      )}

      {section === "todas" && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Buscar função…"
                className="pl-9 rounded-xl h-10"
              />
            </div>
            <div className="flex flex-wrap gap-1.5">
              <FilterChip active={cat === "all"} onClick={() => setCat("all")}>
                Todas
              </FilterChip>
              {categories.map((c) => (
                <FilterChip key={c} active={cat === c} onClick={() => setCat(c)}>
                  {CATEGORY_LABELS[c] || c}
                </FilterChip>
              ))}
            </div>
          </div>

          {Object.entries(grouped).map(([category, list]) => (
            <section key={category} className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground px-1">
                {CATEGORY_LABELS[category] || category}
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                {list.map((t) => {
                  const meta = metaForKey(t.key);
                  const nome = meta?.nome ?? t.label;
                  return (
                    <div
                      key={t.id}
                      className={cn(
                        "rounded-xl border p-3.5 flex items-start gap-3",
                        t.enabled
                          ? "border-emerald-500/25 bg-emerald-500/5"
                          : "bg-card",
                      )}
                    >
                      <Switch
                        checked={t.enabled}
                        disabled={!canToggle || busyKey === t.key}
                        onCheckedChange={(v) => setEnabled(t.key, v)}
                        className="mt-1"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-sm">{nome}</span>
                          <Badge
                            variant={t.enabled ? "default" : "outline"}
                            className="text-[10px]"
                          >
                            {t.enabled ? "Ligado" : "Off"}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                          {meta?.oQueFaz || t.description || "Função automática do sistema."}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}

          {!loading && filtered.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">
              Nenhuma função com esse filtro.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full px-3 py-1.5 text-xs font-medium border transition-colors",
        active
          ? "bg-foreground text-background border-foreground"
          : "bg-background text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
