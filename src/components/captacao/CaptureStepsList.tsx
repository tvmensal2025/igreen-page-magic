import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Send, Loader2, Check, Mic, ImageIcon, Video, Search } from "lucide-react";
import { CaptureStepPreview } from "./CaptureStepPreview";
import { HelpHint } from "@/components/ui/help-hint";

interface Props {
  consultantId: string;
  customerId: string;
  sentSteps: Set<string>;
  onSent: (stepKey: string) => void;
  defaultVariant?: string | null;
  currentStep?: string | null;
  /** expõe pra fora os passos carregados (usado pelo botão "Enviar tudo") */
  onStepsLoaded?: (steps: Array<{ step_key: string; step_id: string; title: string }>) => void;
}

interface StepRow {
  id: string;
  title: string | null;
  step_key: string | null;
  position: number;
  message_text: string | null;
  media_order: unknown;
  variant: string;
  flow_id: string;
}

interface StepGroup {
  step_key: string;
  position: number;
  title: string | null;
  preview: string;
  variants: Record<string, StepRow>; // A/B/C → StepRow
}

const VARIANT_META: Record<string, { label: string; hint: string }> = {
  A: { label: "A", hint: "com áudio" },
  B: { label: "B", hint: "só texto" },
  C: { label: "C", hint: "com vídeo" },
};

export function CaptureStepsList({ consultantId, customerId, sentSteps, onSent, defaultVariant, currentStep, onStepsLoaded }: Props) {
  const { toast } = useToast();
  const [sending, setSending] = useState<string | null>(null);
  const [errorStep, setErrorStep] = useState<string | null>(null);
  const [groups, setGroups] = useState<StepGroup[]>([]);
  const [query, setQuery] = useState("");
  const [onlyPending, setOnlyPending] = useState(false);
  const [confirmStep, setConfirmStep] = useState<{ group: StepGroup; row: StepRow } | null>(null);

  const changeVariant = (v: string) => {
    if (!confirmStep) return;
    const row = confirmStep.group.variants[v];
    if (row) setConfirmStep({ group: confirmStep.group, row });
  };

  useEffect(() => {
    let mounted = true;
    (async () => {
      // Carrega TODOS os fluxos ativos do consultor (A, B, C…)
      const { data: flows } = await supabase
        .from("bot_flows")
        .select("id, variant, updated_at")
        .eq("consultant_id", consultantId)
        .eq("is_active", true)
        .order("updated_at", { ascending: false });
      let flowList = (flows || []) as Array<{ id: string; variant: string }>;
      if (flowList.length === 0) {
        // fallback: pega o mais recente (mesmo se inativo)
        const { data: anyFlow } = await supabase
          .from("bot_flows")
          .select("id, variant, updated_at")
          .eq("consultant_id", consultantId)
          .order("updated_at", { ascending: false }).limit(1);
        flowList = (anyFlow || []) as any;
      }
      if (flowList.length === 0) { if (mounted) setGroups([]); return; }

      // Deduplica variantes (uma por letra, a mais recente)
      const byVariant = new Map<string, { id: string; variant: string }>();
      for (const f of flowList) {
        const v = (f.variant || "A").toUpperCase();
        if (!byVariant.has(v)) byVariant.set(v, { ...f, variant: v });
      }

      const flowIds = Array.from(byVariant.values()).map((f) => f.id);
      const variantByFlow = new Map(Array.from(byVariant.values()).map((f) => [f.id, f.variant]));

      const { data: stepsData } = await supabase
        .from("bot_flow_steps")
        .select("id, title, step_key, position, message_text, media_order, flow_id")
        .in("flow_id", flowIds)
        .eq("is_active", true)
        .order("position", { ascending: true });

      const allRows: StepRow[] = ((stepsData || []) as any[]).map((s) => ({
        ...s,
        variant: variantByFlow.get(s.flow_id) || "A",
      }));

      // Agrupa por step_key (ou position se sem key). Variante A define ordem canônica.
      const groupMap = new Map<string, StepGroup>();
      // Primeiro passa A para fixar ordem
      const aRows = allRows.filter((r) => r.variant === "A");
      const orderedKeys: string[] = [];
      for (const r of aRows) {
        const key = r.step_key || `pos_${r.position}`;
        if (!groupMap.has(key)) {
          orderedKeys.push(key);
          groupMap.set(key, {
            step_key: key,
            position: r.position,
            title: r.title,
            preview: (r.message_text || "").replace(/\s+/g, " ").trim(),
            variants: {},
          });
        }
        groupMap.get(key)!.variants[r.variant] = r;
      }
      // Demais variantes (B/C…) anexam à mesma key
      for (const r of allRows) {
        if (r.variant === "A") continue;
        const key = r.step_key || `pos_${r.position}`;
        if (!groupMap.has(key)) {
          orderedKeys.push(key);
          groupMap.set(key, {
            step_key: key,
            position: r.position,
            title: r.title,
            preview: (r.message_text || "").replace(/\s+/g, " ").trim(),
            variants: {},
          });
        } else if (!groupMap.get(key)!.title) {
          groupMap.get(key)!.title = r.title;
        }
        groupMap.get(key)!.variants[r.variant] = r;
      }

      const ordered = orderedKeys
        .map((k) => groupMap.get(k)!)
        .filter(Boolean)
        .slice(0, 10);

      if (mounted) {
        setGroups(ordered);
        if (onStepsLoaded) {
          const dv = (defaultVariant || "A").toUpperCase();
          onStepsLoaded(ordered.map((g, i) => {
            const variantKeys = Object.keys(g.variants).sort();
            const row = g.variants[dv] || g.variants[variantKeys[0]];
            return {
              step_key: g.step_key,
              step_id: row?.id || "",
              title: g.title || g.step_key || `Passo ${i + 1}`,
            };
          }).filter((x) => x.step_id));
        }
      }
    })();
    return () => { mounted = false; };
  }, [consultantId, defaultVariant, onStepsLoaded]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return groups.filter((g) => {
      const allVariantIds = Object.values(g.variants).map((v) => v.id);
      const groupSent = allVariantIds.some((id) => sentSteps.has(id));
      if (onlyPending && groupSent) return false;
      if (!q) return true;
      return (g.title || "").toLowerCase().includes(q) ||
        (g.step_key || "").toLowerCase().includes(q) ||
        g.preview.toLowerCase().includes(q);
    });
  }, [groups, query, onlyPending, sentSteps]);

  const doSend = async (row: StepRow, groupKey: string, continueFlow: boolean) => {
    setSending(row.id);
    setErrorStep(null);
    try {
      const { sendStepWithFeedback } = await import("@/lib/whatsapp/send");
      const res = await sendStepWithFeedback({
        consultantId, customerId, stepId: row.id, part: "all", continueFlow, variant: row.variant as "A" | "B" | "C" | "D" | "E",
      });
      if (res.ok) {
        onSent(groupKey);
        setConfirmStep(null);
      } else {
        // Mantém modal aberto pra usuário ler o toast; pisca erro vermelho 3s.
        setErrorStep(row.id);
        setTimeout(() => setErrorStep((cur) => (cur === row.id ? null : cur)), 3000);
      }
    } finally {
      setSending(null);
    }
  };


  if (groups.length === 0) {
    return (
      <div className="p-6 text-center text-sm text-muted-foreground border border-dashed border-border rounded-lg">
        Nenhum passo configurado. Vá em <span className="font-semibold">/admin/fluxos</span>.
      </div>
    );
  }

  const defaultV = (defaultVariant || "A").toUpperCase();

  return (
    <div className="space-y-0.5">
      <div className="flex items-center gap-1 sticky top-0 z-10 bg-background/95 backdrop-blur py-0.5 -mx-1 px-1">
        <div className="relative flex-1">
          <Search className="absolute left-1.5 top-1/2 -translate-y-1/2 w-2.5 h-2.5 text-muted-foreground" />
          <Input
            placeholder="Buscar passo…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-6 pl-5 text-[10px]"
          />
        </div>
        <Button
          size="sm"
          variant={onlyPending ? "default" : "outline"}
          className="h-6 px-1.5 text-[9px] whitespace-nowrap"
          onClick={() => setOnlyPending((v) => !v)}
        >
          Pendentes
        </Button>
        <HelpHint
          title="Filtro Pendentes"
          summary="Mostra só passos que ainda não foram enviados"
          details="Quando ativo, esconde os passos já enviados (✓) e deixa visíveis apenas os que faltam. Útil para enxergar rápido o que ainda precisa disparar para este lead."
          align="end"
        />
      </div>

      <ul className="space-y-0.5">
        {filtered.map((g, idx) => {
          const num = idx + 1;
          const variantKeys = Object.keys(g.variants).sort();
          const anySent = sentSteps.has(g.step_key);
          const defaultRow = g.variants[defaultV] || g.variants[variantKeys[0]];
          const media = Array.isArray(defaultRow?.media_order) ? (defaultRow.media_order as string[]) : [];
          const isSending = sending === defaultRow?.id;
          const isError = errorStep === defaultRow?.id;
          const isCurrent = !!currentStep && (
            currentStep === g.step_key ||
            Object.values(g.variants).some((v) => v.id === currentStep)
          );
          return (
            <li key={g.step_key}>
              <div
                className={`rounded-md border flex items-center gap-1 pl-1 pr-1 py-0.5 transition-all ${
                  isError
                    ? "border-destructive/60 bg-destructive/10"
                    : isCurrent
                    ? "border-amber-400/60 bg-amber-400/10 ring-1 ring-amber-400/40"
                    : anySent
                    ? "border-primary/30 bg-primary/5"
                    : "border-border bg-card hover:border-primary/50"
                }`}
              >
                <div className="relative shrink-0">
                  <span
                    className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold tabular-nums ${
                      anySent
                        ? "bg-primary text-primary-foreground"
                        : isCurrent
                        ? "bg-amber-400 text-black"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {anySent ? <Check className="w-2.5 h-2.5" /> : num}
                  </span>
                  <span className="absolute -bottom-0.5 -right-1 text-[7px] font-bold bg-background border border-border rounded-sm px-0.5 leading-none py-px text-foreground/80">
                    {defaultRow?.variant || defaultV}
                  </span>
                </div>
                <div className="flex-1 min-w-0 flex items-center gap-1">
                  <p className="text-[11px] font-semibold truncate leading-tight">
                    {g.title || g.step_key || `Passo ${num}`}
                  </p>
                  {isCurrent && (
                    <span className="text-[8px] font-bold uppercase tracking-wide px-1 py-px rounded bg-amber-400 text-black shrink-0">
                      atual
                    </span>
                  )}
                  <div className="flex items-center gap-0.5 shrink-0">
                    {media.includes("audio") && <Mic className="w-2.5 h-2.5 text-emerald-500" />}
                    {media.includes("image") && <ImageIcon className="w-2.5 h-2.5 text-amber-500" />}
                    {media.includes("video") && <Video className="w-2.5 h-2.5 text-cyan-500" />}
                  </div>
                </div>
                <button
                  type="button"
                  disabled={isSending || !defaultRow}
                  onClick={() => defaultRow && setConfirmStep({ group: g, row: defaultRow })}
                  title={isError ? "Falhou — clique pra tentar de novo" : "Ver prévia e enviar"}
                  className={`relative shrink-0 w-6 h-6 rounded-full flex items-center justify-center transition-colors disabled:opacity-50 ${
                    isError
                      ? "bg-destructive text-destructive-foreground"
                      : anySent
                      ? "border border-primary/40 text-primary hover:bg-primary/10"
                      : "bg-primary text-primary-foreground hover:bg-primary/90"
                  }`}
                >
                  {isSending ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : isError ? (
                    <span className="text-[10px] font-bold">!</span>
                  ) : anySent ? (
                    <Check className="w-3 h-3" />
                  ) : (
                    <Send className="w-3 h-3" />
                  )}
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      <CaptureStepPreview
        open={!!confirmStep}
        onOpenChange={(o) => !o && setConfirmStep(null)}
        consultantId={consultantId}
        customerId={customerId}
        step={confirmStep ? { ...confirmStep.row } : null}
        variants={confirmStep?.group.variants}
        onVariantChange={changeVariant}
        sending={!!sending}
        onSend={(opts) => confirmStep && doSend(confirmStep.row, confirmStep.group.step_key, opts?.continueFlow === true)}
      />
    </div>
  );
}

